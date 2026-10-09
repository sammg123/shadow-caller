// Mounting components defensively (ui-architecture.md 9.1; owner A0). DOM side.
// Every component module is imported in parallel, then mounted in table order (the field host before the review
// banner that shares its root). A module that fails to load, has no mount(), or throws while mounting leaves a
// visible notice and boot goes on. The boot screen and the toast fall back to built-in text-only versions.
// The Form hub forwards ctx.form calls to whichever mounted component provides each method (2.6, 9.1).
import { setClass, setData, setHidden, setText } from "../ui/dom.js";

const FORM_DEFAULTS = Object.freeze({
  readYards: "", readTD: false, readTO: false, readAutoFirst: false,
  writeYards: undefined, writeTD: undefined, writeTO: undefined, writeAutoFirst: undefined, focusYards: undefined,
});

/** ctx.form: each Form method goes to the first registered component that has it (directly or under .form). */
export function createFormHub() {
  const providers = [];
  const targetFor = (name) => {
    for (const p of providers) {
      if (typeof p?.[name] === "function") return p;
      if (typeof p?.form?.[name] === "function") return p.form;
    }
    return null;
  };
  const form = Object.freeze(Object.fromEntries(Object.entries(FORM_DEFAULTS).map(([name, fallback]) => [name,
    (...args) => {
      const target = targetFor(name);
      return target ? target[name](...args) : fallback;
    }])));
  return { form, register: (component) => { providers.push(component); } };
}

/** Start every import at once; the results come back in table order. */
export function loadModules(specs) {
  return Promise.allSettled(specs.map((spec) => Promise.resolve().then(() => spec.load())));
}

/** A text-only toast with the legacy hooks (#toast.show, .err, data-tone; FI 4.5). */
export function fallbackToast(node) {
  return {
    update(toast) {
      setText(node, toast?.text ?? "");
      setClass(node, "show", Boolean(toast));
      setClass(node, "err", Boolean(toast?.err));
      setData(node, "tone", toast ? (toast.err ? "error" : "info") : null);
    },
    destroy() {},
  };
}

/** Drives the static boot placeholder in index.html from bootVm when the boot screen component is missing. */
export function fallbackBoot(holder) {
  const line = holder.querySelector(".sc-boot-static-text");
  return {
    update(vm) {
      setHidden(holder, Boolean(vm?.hidden));
      setData(holder, "phase", vm?.phase ?? null);
      const text = [vm?.heading, vm?.text].filter((t) => typeof t === "string" && t !== "")
        .map((t) => t.replace(/\.$/, "")).join(". ");
      if (line) setText(line, text ? `${text}.` : "");
    },
    destroy() {},
  };
}

function fallbackFor(spec, root) {
  if (spec.fallback === "toast") return fallbackToast(root);
  if (spec.fallback === "boot") return fallbackBoot(root.querySelector("[data-boot-static]") ?? root);
  return null;
}

/** Mount one component; throws when its module failed to load, has no mount(), or mount() misbehaves. */
function mountOne(spec, result, root, ctx) {
  if (result?.status !== "fulfilled") throw result?.reason ?? new Error(`${spec.name} was not loaded`);
  const mod = result.value;
  if (typeof mod?.mount !== "function") throw new TypeError(`${spec.name} has no mount() export`);
  const component = mod.mount(root, ctx);
  if (!component || typeof component.update !== "function") {
    throw new TypeError(`${spec.name}: mount() must return { update, destroy }`);
  }
  return component;
}

/** Ids that vanished from the page: a component removed part of the shell it does not own. */
function lostIds(doc, ids) {
  return ids.filter((id) => !doc.getElementById(id));
}

function asBinding(spec, component) {
  return { name: spec.name, region: spec.region, label: spec.label, component, deps: spec.deps, select: spec.select };
}

/**
 * Mount `specs` (in order) from `settled` (loadModules). Returns { bindings, failed: names }.
 * @param {object[]} specs   shell/bindings.js COMPONENTS
 * @param {PromiseSettledResult[]} settled
 * @param {{ doc: Document, ctx: object, notices: object, formHub: { register(c): void }, shellIds?: string[] }} deps
 *   shellIds: ids index.html provides; one that disappears while a component mounts is reported with its name.
 */
export function mountComponents(specs, settled, { doc, ctx, notices, formHub, shellIds = [] }) {
  const bindings = [];
  const failed = [];
  let present = shellIds.filter((id) => doc.getElementById(id));
  specs.forEach((spec, i) => {
    const root = doc.querySelector(spec.root);
    if (!root) {
      failed.push(spec.name);
      notices.regionFailed(null, spec, new Error(`${spec.root} is missing from the page`));
      return;
    }
    try {
      const component = mountOne(spec, settled[i], root, ctx);
      formHub.register(component);
      bindings.push(asBinding(spec, component));
      if (spec.fallback === "boot") root.querySelector("[data-boot-static]")?.remove();
    } catch (err) {
      failed.push(spec.name);
      const fallback = fallbackFor(spec, root);
      notices.regionFailed(root, spec, err, { inline: !fallback });
      if (fallback) bindings.push(asBinding(spec, fallback));
    }
    const lost = lostIds(doc, present);
    if (lost.length) notices.componentError(spec, new Error(`it removed #${lost.join(", #")} from the page`));
    present = present.filter((id) => !lost.includes(id));
  });
  return { bindings, failed };
}
