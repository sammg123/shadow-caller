// Test harness for components that ask for actions (ui-architecture.md 2.6, 9.1): mounts one component on the fake
// DOM with a recording actions stub and the real copy. The page takes no user input into the game (restructure-v2.md
// 1), so there is no form stub. Every call that touches the DOM runs inside withDocument (ui/dom.js creates nodes on
// globalThis.document).
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

/** Mount `mod` on `root` inside withDocument; returns the component plus the stub. `ctx` adds to main.js's context
 * (reportHref, say). */
export function mountWith(doc, mod, root, { results = {}, ctx: extra = {} } = {}) {
  const act = stubActions(results);
  const ctx = Object.freeze({ actions: act.actions, engine: () => null, copy: Copy, ...extra });
  const component = withDocument(doc, () => mod.mount(root, ctx));
  return { component, ...act, ctx };
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
