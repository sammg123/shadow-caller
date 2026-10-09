// Test harness for the A7 input surfaces (ui-architecture.md 2.6, 9.1): mounts one component on the fake DOM with a
// recording actions stub, a Form stub and the real copy, and builds view models from the real state fixtures.
// Every call that touches the DOM runs inside withDocument (ui/dom.js creates nodes on globalThis.document).
import * as Copy from "../../static/js/model/copy.js";
import { createDocument, withDocument } from "./fake-dom.mjs";

/**
 * An actions object that records every call as [name, ...args]. `results[name]` is returned (or called with the
 * arguments when it is a function), so a test decides what an action resolves to.
 */
export function stubActions(results = {}) {
  const calls = [];
  const actions = new Proxy({}, {
    get(_, name) {
      if (typeof name !== "string" || name === "then") return undefined;
      return (...args) => {
        calls.push([name, ...args]);
        const r = results[name];
        return typeof r === "function" ? r(...args) : r;
      };
    },
  });
  return { actions, calls, named: (name) => calls.filter((c) => c[0] === name).map((c) => c.slice(1)) };
}

/** A Form stub that records calls; reads return what `values` holds. */
export function stubForm(values = {}) {
  const calls = [];
  const record = (name, fallback) => (...args) => {
    calls.push([name, ...args]);
    return values[name] ?? fallback;
  };
  return {
    calls,
    form: {
      readYards: record("readYards", "0"), writeYards: record("writeYards"), readTD: record("readTD", false),
      writeTD: record("writeTD"), readTO: record("readTO", false), writeTO: record("writeTO"),
      readAutoFirst: record("readAutoFirst", false), writeAutoFirst: record("writeAutoFirst"),
      focusYards: record("focusYards"),
    },
  };
}

/** A tiny timer queue so tests decide when time passes. */
export function fakeTimers() {
  let seq = 0;
  const pending = new Map();
  return {
    setTimeout: (fn, ms) => { seq += 1; pending.set(seq, { fn, ms }); return seq; },
    clearTimeout: (id) => { pending.delete(id); },
    runAll() {
      for (const [id, { fn }] of [...pending]) {
        pending.delete(id);
        fn();
      }
    },
    get size() { return pending.size; },
  };
}

/**
 * A document with the shell pieces a component needs, built from a spec: [{ tag, id?, attrs?, children? }].
 * Returns { doc, byId(id) }.
 */
export function shellDocument(spec) {
  const doc = createDocument();
  const build = (parent, nodes) => {
    for (const n of nodes) {
      const node = doc.createElement(n.tag);
      if (n.id) node.setAttribute("id", n.id);
      for (const [k, v] of Object.entries(n.attrs ?? {})) node.setAttribute(k, v);
      parent.appendChild(node);
      build(node, n.children ?? []);
    }
  };
  build(doc.body, spec);
  return { doc, byId: (id) => doc.getElementById(id) };
}

/** Mount `mod` on `root` inside withDocument; returns the component plus the stubs. */
export function mountWith(doc, mod, root, { results = {}, formValues = {}, timers = null } = {}) {
  const act = stubActions(results);
  const formStub = stubForm(formValues);
  const ctx = Object.freeze({ actions: act.actions, form: formStub.form, engine: () => null, copy: Copy,
    ...(timers ? { timers } : {}) });
  const component = withDocument(doc, () => mod.mount(root, ctx));
  return { component, ...act, formCalls: formStub.calls, ctx };
}

/** Run `fn` with this document as globalThis.document (sync or async). */
export const inDoc = (doc, fn) => withDocument(doc, fn);

/** Fire an event on a fake node; returns whether preventDefault was called. */
export function fire(node, type, extra = {}) {
  let prevented = false;
  node.dispatchEvent({ type, preventDefault() { prevented = true; }, ...extra });
  return prevented;
}

/** Focus a fake node and fire its focus event, as a browser does. */
export function focusIn(node) {
  node.focus();
  fire(node, "focus");
}

/** Type into a fake input: set the value and fire `input`. */
export function typeInto(node, text) {
  node.value = text;
  fire(node, "input");
}

/** Let pending promise callbacks run. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Every element under `node` (depth first) that `test` accepts. */
export function findAll(node, test) {
  const out = [];
  const walk = (n) => {
    for (const child of n.kids ?? []) {
      if (child.nodeType !== 1) continue;
      if (test(child)) out.push(child);
      walk(child);
    }
  };
  walk(node);
  return out;
}

export const hasClass = (node, cls) => (node.getAttribute("class") ?? "").split(/\s+/).includes(cls);
export const text = (node) => (node ? node.textContent : null);
