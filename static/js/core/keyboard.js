// The one keydown listener (ui-architecture.md section 4; restructure-v2.md 2; G4, G5; owner A2). DOM side: it
// classifies the event target, asks the pure keymap what to do, prevents the default when told, and runs the intent on
// `actions`.
import { own } from "./domain.js";
import { keyContext, normalizeKey, resolveKey } from "./keymap.js";

const TEXT_ROLES = new Set(["textbox", "combobox", "spinbutton"]);
const ACTIVATABLE_ROLES = new Set(["button", "checkbox", "switch", "menuitem", "tab", "option"]);
const ACTIVATABLE_INPUTS = new Set(["checkbox", "radio", "button", "submit", "reset", "file", "image"]);
const IME_KEYCODE = 229;

function attr(node, name) {
  return typeof node.getAttribute === "function" ? String(node.getAttribute(name) ?? "").toLowerCase() : "";
}

/**
 * Target class of a keydown (4.x table). Inputs are text unless they are buttons, checkboxes or radios (G4); an
 * unknown input type counts as text, because browsers treat it as one. A slider has its own class (the top bar's
 * progress bar keeps only its own keys; keymap.js passes the rest on).
 * @returns {"text" | "slider" | "activatable" | "other"}
 */
export function classifyTarget(node) {
  if (!node || typeof node.tagName !== "string") return "other";
  const tag = node.tagName.toLowerCase();
  const role = attr(node, "role");
  if (role === "slider" || (tag === "input" && attr(node, "type") === "range")) return "slider";
  if (tag === "input") return ACTIVATABLE_INPUTS.has(attr(node, "type")) ? "activatable" : "text";
  if (tag === "textarea" || tag === "select" || node.isContentEditable === true) return "text";
  if (TEXT_ROLES.has(role)) return "text";
  const isLink = tag === "a" && typeof node.hasAttribute === "function" && node.hasAttribute("href");
  if (tag === "button" || tag === "summary" || isLink || ACTIVATABLE_ROLES.has(role)) return "activatable";
  return "other";
}

const RUN = Object.freeze({
  togglePlay: (a) => a.togglePlay(),
  stepBack: (a) => a.stepBack(),
  stepForward: (a) => a.stepForward(),
  setSpeed: (a, i) => a.setSpeed(i.speed),
  cycleCamera: (a) => a.cycleCamera(),
  goLive: (a) => a.goLive(),
  closeSettings: (a) => a.closeSettings(),
  dismissToast: (a) => a.dismissToast(),
});

function reportError(err) {
  if (typeof globalThis.reportError === "function") globalThis.reportError(err);
  else queueMicrotask(() => { throw err; });
}

/**
 * Run one keymap intent on the actions object. Returns false for an unknown intent. A throw, or the rejection of an
 * action's promise (most actions are async), goes to `onError`, never to the page as an unhandled error.
 */
export function runIntent(actions, intent, onError = reportError) {
  const run = intent ? own(RUN, intent.type) : undefined;
  if (!run) return false;
  try {
    const result = run(actions, intent);
    if (result && typeof result.then === "function") result.then(undefined, onError);
  } catch (err) {
    onError(err);
  }
  return true;
}

/** Attach the listener to `doc`; returns detach. `onError` sees any error an action throws (default: reportError). A
 * keydown a component already handled (defaultPrevented: the focused progress bar's own keys, Escape rolling up an
 * unrolled list) is not the page's. */
export function attachKeyboard(doc, { store, actions, onError = reportError }) {
  function onKeyDown(e) {
    if (e.defaultPrevented) return;   // a component already handled it (the progress bar, a list rolling up on Escape)
    const input = {
      key: normalizeKey(e.key),
      repeat: Boolean(e.repeat),
      mods: { meta: Boolean(e.metaKey), ctrl: Boolean(e.ctrlKey), alt: Boolean(e.altKey), shift: Boolean(e.shiftKey) },
      composing: Boolean(e.isComposing) || e.keyCode === IME_KEYCODE,
      target: classifyTarget(e.target),
      ctx: keyContext(store.getState()),
    };
    const { intent, prevent } = resolveKey(input);
    if (prevent) e.preventDefault();
    if (intent) runIntent(actions, intent, onError);
  }
  doc.addEventListener("keydown", onKeyDown);
  return () => doc.removeEventListener("keydown", onKeyDown);
}
