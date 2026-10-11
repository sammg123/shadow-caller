// Test harness for the A8 game surfaces (ui/{scoreboard, play-feed, drive-chart, win-prob, box-score, scorecard,
// tendencies}.js): a fake document, a root region like index.html's, a ctx whose actions record every call,
// and view models built from the real TB at DAL captures (tests/fixtures), exactly as the scheduler would build them.
import * as Copy from "../../static/js/model/copy.js";
import { createDocument, withDocument } from "./fake-dom.mjs";

export { makePv, state, timeline, tlOf, patch } from "./model-fixtures.mjs";

/** Run fn(doc) with a fresh fake document installed as globalThis.document. */
export function inDoc(fn) {
  return withDocument(createDocument(), () => fn(globalThis.document));
}

/** A region root attached to <body>, as index.html provides it. */
export function regionRoot(doc, { tag = "section", id = "rg-test" } = {}) {
  const root = doc.createElement(tag);
  root.setAttribute("id", id);
  doc.body.appendChild(root);
  return root;
}

/** ctx (ui-architecture 2.6) whose actions record [name, ...args] for every call. */
export function fakeCtx() {
  const calls = [];
  const actions = new Proxy({}, {
    get: (_, name) => (...args) => { calls.push([String(name), ...args]); },
  });
  const ctx = Object.freeze({ actions, form: Object.freeze({}), engine: () => null, copy: Copy });
  return { ctx, calls };
}

/** Every element under root (inclusive of none) matching a simple selector, as an array. */
export function all(root, selector) {
  return [...root.querySelectorAll(selector)];
}

export function one(root, selector) {
  const node = root.querySelector(selector);
  if (!node) throw new Error(`no ${selector}`);
  return node;
}

export const click = (node) => node.dispatchEvent({ type: "click" });

/** Normalized text of a node (whitespace collapsed). */
export const text = (node) => node.textContent.replace(/\s+/g, " ").trim();
