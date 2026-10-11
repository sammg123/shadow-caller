// static/js/ask/keys.js: the question box's keys. Enter asks, Shift+Enter starts a new line, nothing is sent while an
// input method is composing, and Escape is the panel's. The app's own shortcuts (restructure-v2.md 2: Space, Left,
// Right, 1 to 4, V, Escape) never fire inside the box: core/keyboard.js classifies a textarea as text and the keymap
// leaves text alone, which these tests hold as a contract.
import assert from "node:assert/strict";
import test from "node:test";
import { classifyTarget } from "../../../static/js/core/keyboard.js";
import { resolveKey } from "../../../static/js/core/keymap.js";
import { composerAction, isPlainEscape } from "../../../static/js/ask/keys.js";

const key = (k, over = {}) => ({ key: k, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false,
  isComposing: false, keyCode: 0, ...over });

test("Enter asks; Ctrl or Cmd with Enter asks too", () => {
  assert.equal(composerAction(key("Enter")), "send");
  assert.equal(composerAction(key("Enter", { ctrlKey: true })), "send");
  assert.equal(composerAction(key("Enter", { metaKey: true })), "send");
});

test("Shift+Enter and Alt+Enter leave the new line to the box", () => {
  assert.equal(composerAction(key("Enter", { shiftKey: true })), null);
  assert.equal(composerAction(key("Enter", { altKey: true })), null);
});

test("an input method composing (or the 229 key code it sends) never sends", () => {
  assert.equal(composerAction(key("Enter", { isComposing: true })), null);
  assert.equal(composerAction(key("Enter", { keyCode: 229 })), null);
  assert.equal(composerAction(key("Process", { keyCode: 229 })), null);
});

test("every other key types", () => {
  for (const k of ["a", " ", "ArrowLeft", "ArrowRight", "1", "4", "v", "V", "Tab", "Backspace"]) {
    assert.equal(composerAction(key(k)), null, k);
  }
  assert.equal(composerAction(null), null);
});

test("a plain Escape is the panel's; with a modifier or mid-composition it is not", () => {
  assert.equal(isPlainEscape(key("Escape")), true);
  assert.equal(isPlainEscape(key("Esc")), true);
  assert.equal(isPlainEscape(key("Escape", { shiftKey: true })), false);
  assert.equal(isPlainEscape(key("Escape", { isComposing: true })), false);
  assert.equal(isPlainEscape(key("Escape", { keyCode: 229 })), false);
  assert.equal(isPlainEscape(key("Enter")), false);
  assert.equal(isPlainEscape(undefined), false);
});

/** A node the way core/keyboard.js sees it: a tag name and attributes. */
const node = (tag, attrs = {}) => ({ tagName: tag.toUpperCase(), getAttribute: (n) => attrs[n] ?? null,
  hasAttribute: (n) => n in attrs, isContentEditable: false });

test("contract: the page's keyboard classifies the question box as text", () => {
  assert.equal(classifyTarget(node("textarea", { class: "sc-ask-input", maxlength: "500" })), "text");
});

test("contract: no app shortcut fires from the question box, and none is prevented there", () => {
  const ctx = { feedOn: false, watchState: "paused", toastErr: false, settingsOpen: false };
  for (const k of [" ", "ArrowLeft", "ArrowRight", "1", "2", "3", "4", "v", "V", "Escape"]) {
    const res = resolveKey({ key: k, target: "text", ctx });
    assert.equal(res.intent, null, k);
    assert.equal(res.prevent, false, k);
  }
});

test("contract: outside a text field the same keys are the page's (so the box is what keeps them out)", () => {
  const ctx = { feedOn: false, watchState: "paused", toastErr: false, settingsOpen: false };
  assert.equal(resolveKey({ key: "ArrowLeft", target: "other", ctx }).intent.type, "stepBack");
  assert.equal(resolveKey({ key: "Escape", target: "other", ctx }).intent.type, "goLive");
});
