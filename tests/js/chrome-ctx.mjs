// Test helpers for the A9 chrome components (ui-architecture.md 2.6, 9.1): a page with the shell roots, a ctx whose
// actions record every call, and small event helpers for the fake DOM. Owner A9.
import * as Copy from "../../static/js/model/copy.js";
import { createDocument } from "./fake-dom.mjs";

/** A fresh fake document whose body holds one element per [tag, id] pair, plus an outsider the components must leave alone. */
export function chromePage(roots = [["header", "rg-masthead"]]) {
  const doc = createDocument();
  for (const [tag, id] of roots) {
    const node = doc.createElement(tag);
    node.setAttribute("id", id);
    doc.body.appendChild(node);
  }
  const outsider = doc.createElement("p");
  outsider.setAttribute("id", "outsider");
  outsider.textContent = "not yours";
  doc.body.appendChild(outsider);
  return doc;
}

/** Actions that record [name, ...args] for every call; any method name works. */
export function recordingActions() {
  const calls = [];
  const actions = new Proxy({}, {
    get(_, name) {
      if (name === "calls") return calls;
      if (typeof name !== "string" || name === "then") return undefined;
      return (...args) => { calls.push([name, ...args]); };
    },
  });
  return { actions, calls };
}

/** The UiContext main.js passes (2.6): actions, form, engine(), copy. */
export function chromeCtx({ engine = null } = {}) {
  const { actions, calls } = recordingActions();
  let current = engine;
  const ctx = Object.freeze({ actions, form: {}, engine: () => current, copy: Copy });
  return { ctx, calls, setEngine: (next) => { current = next; } };
}

export const click = (node) => node.dispatchEvent({ type: "click", preventDefault() {} });

/** A keydown on `node`; returns the event so tests can see whether the handler prevented its default. */
export function keydown(node, key) {
  const evt = { type: "keydown", key, prevented: false };
  evt.preventDefault = () => { evt.prevented = true; };   // the fake dispatch copies the event; this closes over the original
  node.dispatchEvent(evt);
  return evt;
}

/** Element children of `node`, outside any NodeList quirks. */
export const kids = (node) => [...node.children];

export { Copy };
