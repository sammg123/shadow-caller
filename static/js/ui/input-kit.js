// Small DOM pieces the input surfaces share (owner A7; ui-architecture.md 9.6, v1.2): key caps, select-on-focus,
// bar geometry as CSS custom properties, and running an action from an event handler without ever throwing into
// the page. DOM side; text goes in only through ui/dom.js (G27).
import { el, setHidden, setText } from "./dom.js";

const PCT_MIN = 0;
const PCT_MAX = 100;

/** The browser's error report (a page error, so tests and the console see it), never a silent swallow. */
function report(err) {
  if (typeof globalThis.reportError === "function") globalThis.reportError(err);
  else queueMicrotask(() => { throw err; });
}

/**
 * Run an action from an event handler. Resolves with its result; a throw or a rejection is reported and resolves
 * undefined, so a handler can chain `.then` without a try/catch of its own.
 * @param {() => unknown} fn
 * @returns {Promise<unknown>}
 */
export function act(fn) {
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      return result.then((value) => value, (err) => {
        report(err);
        return undefined;
      });
    }
    return Promise.resolve(result);
  } catch (err) {
    report(err);
    return Promise.resolve(undefined);
  }
}

/** True when `node` has focus in its own document. */
export function isFocused(node) {
  return Boolean(node) && node.ownerDocument?.activeElement === node;
}

/** select() when the node has it (text inputs do). */
export function selectAll(input) {
  if (typeof input?.select === "function") input.select();
}

const deferToNextTask = (fn) => globalThis.setTimeout(fn, 0);

/**
 * Select the whole value when the input gets focus (FI 1.8), and once more on the next task: a mouse click places
 * its caret after the focus event, which would undo the first select. The second select is skipped once anything was
 * typed since the focus (a fast typist's first digit is never selected away), when `pristine` says so, or when focus
 * has moved on.
 * @param {HTMLInputElement} input
 * @param {{ pristine?: () => boolean, later?: (fn: () => void) => unknown }} [opts]
 */
export function selectOnFocus(input, { pristine = () => true, later = deferToNextTask } = {}) {
  let typed = false;
  input.addEventListener("input", () => { typed = true; });
  input.addEventListener("focus", () => {
    typed = false;
    selectAll(input);
    later(() => {
      if (isFocused(input) && !typed && pristine()) selectAll(input);
    });
  });
}

/**
 * A percentage custom property for bar geometry ("47.5%"), clamped to 0..100; null or a non-number removes it, so
 * the stylesheet's own default applies.
 */
export function setPct(node, name, pct) {
  const style = node.style;
  if (!Number.isFinite(pct)) {
    if (style.getPropertyValue(name) !== "") style.removeProperty(name);
    return;
  }
  const value = `${Math.min(PCT_MAX, Math.max(PCT_MIN, pct))}%`;
  if (style.getPropertyValue(name) !== value) style.setProperty(name, value);
}

function capParts(key, name, hint) {
  const cap = el("span", { cls: "sc-key-cap", attrs: { "aria-hidden": "true" }, text: key });
  const label = el("span", { cls: "sc-key-name", text: name });
  const note = el("span", { cls: "sc-key-hint", text: hint });
  setHidden(cap, !key);
  setHidden(note, !hint);
  return [cap, label, note];
}

/**
 * A key cap (DESIGN.md "Keys"; FI 3.6): <button class="sc-key"> with the key letter in its window (.sc-key-cap),
 * the name (.sc-key-name) and an optional hint (.sc-key-hint). An empty letter or hint is hidden, never a blank gap.
 * The same markup as A9's ui/keycap.js: the cap is decoration (aria-hidden) and aria-keyshortcuts names the key, so
 * a screen reader hears the name and the hint once and a world styles every key on the page with one rule.
 * @param {{ key?: string, name: string, hint?: string, cls?: string[], data?: object, attrs?: object,
 *   on?: object }} spec
 */
export function keyCap({ key = "", name, hint = "", cls = [], data = {}, attrs = {}, on = {} }) {
  const shortcut = key ? { "aria-keyshortcuts": key } : {};
  return el("button", { cls: ["sc-key", ...cls], attrs: { type: "button", ...shortcut, ...attrs }, data, on },
    capParts(key, name, hint));
}

/** Rewrite a key cap's letter, name and hint in place. */
export function setKeyCap(button, { key = "", name = "", hint = "" }) {
  const cap = button.querySelector(".sc-key-cap");
  const label = button.querySelector(".sc-key-name");
  const note = button.querySelector(".sc-key-hint");
  setText(cap, key);
  setHidden(cap, !key);
  setText(label, name);
  setText(note, hint);
  setHidden(note, !hint);
}
