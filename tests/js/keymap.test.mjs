import assert from "node:assert/strict";
import test from "node:test";

import { keyContext, modeOf, normalizeKey, resolveKey } from "../../static/js/core/keymap.js";
import { initialState } from "../../static/js/core/reducer.js";

const IDLE = Object.freeze({ feedOn: false, watchState: "idle", toastErr: false, settingsOpen: false });
const ctxOf = (over = {}) => ({ ...IDLE, ...over });
const PAUSED = ctxOf({ watchState: "paused" });
const PLAYING = ctxOf({ watchState: "playing" });
const NO_MODS = Object.freeze({ meta: false, ctrl: false, alt: false, shift: false });

function press(key, ctx = PAUSED, { target = "other", repeat = false, mods = {}, composing = false } = {}) {
  return resolveKey({ key: normalizeKey(key), repeat, mods: { ...NO_MODS, ...mods }, composing, target, ctx });
}
const intentOf = (...a) => press(...a).intent;
const NOTHING = { intent: null, prevent: false };
const PREVENT_ONLY = { intent: null, prevent: true };
const strip = ({ intent, prevent }) => ({ intent, prevent });

test("normalizeKey uppercases single characters and names Space (and legacy names)", () => {
  const cases = { p: "P", P: "P", " ": "Space", Spacebar: "Space", Esc: "Escape", Left: "ArrowLeft", Right: "ArrowRight",
    Enter: "Enter", ArrowLeft: "ArrowLeft", 1: "1", "-": "-", Tab: "Tab", Space: "Space", v: "V" };
  for (const [raw, out] of Object.entries(cases)) assert.equal(normalizeKey(raw), out, raw);
  assert.equal(normalizeKey(undefined), "");
});

test("restructure-v2.md 2: Space, Left/Right, 1 to 4, V and Escape, and no others", () => {
  const table = {
    " ": { type: "togglePlay" }, ArrowLeft: { type: "stepBack" }, ArrowRight: { type: "stepForward" },
    1: { type: "setSpeed", speed: 1 }, 2: { type: "setSpeed", speed: 2 }, 3: { type: "setSpeed", speed: 4 },
    4: { type: "setSpeed", speed: 10 }, v: { type: "cycleCamera" }, V: { type: "cycleCamera" },
    Escape: { type: "goLive" },
  };
  for (const [key, intent] of Object.entries(table)) {
    for (const ctx of [IDLE, PAUSED, PLAYING, ctxOf({ feedOn: true }), ctxOf({ watchState: "done" })]) {
      assert.deepEqual(strip(press(key, ctx)), { intent, prevent: true }, `${key} (${ctx.watchState})`);
    }
  }
  for (const key of ["B", "G", "X", "U", "P", "J", "K", "L", "A", "N", "O", "R", "T", "F", "I", "S", "C", "Enter",
    "5", "0", "-", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "Tab", "Backspace", "?"]) {
    assert.deepEqual(strip(press(key)), NOTHING, `${key} does nothing`);
  }
});

test("the guard: Meta, Ctrl and Alt never act and never prevent", () => {
  for (const mod of ["meta", "ctrl", "alt"]) {
    for (const key of [" ", "ArrowLeft", "ArrowRight", "1", "4", "V", "Escape"]) {
      assert.deepEqual(strip(press(key, PAUSED, { mods: { [mod]: true } })), NOTHING, `${mod}+${key}`);
    }
  }
  assert.deepEqual(intentOf("v", PAUSED, { mods: { shift: true } }), { type: "cycleCamera" }, "Shift+V acts as V");
});

test("the guard: shortcuts never fire inside an inline input or while an IME composes", () => {
  for (const key of [" ", "ArrowLeft", "ArrowRight", "1", "2", "3", "4", "V", "Escape"]) {
    assert.deepEqual(strip(press(key, PAUSED, { target: "text" })), NOTHING, `text target ${key}`);
    assert.deepEqual(strip(press(key, PAUSED, { composing: true })), NOTHING, `composing ${key}`);
  }
});

test("Space on a focused button or switch is the browser's (it activates that control)", () => {
  assert.deepEqual(strip(press(" ", PAUSED, { target: "activatable" })), NOTHING);
  assert.deepEqual(intentOf("ArrowRight", PAUSED, { target: "activatable" }), { type: "stepForward" });
  assert.deepEqual(intentOf("3", PAUSED, { target: "activatable" }), { type: "setSpeed", speed: 4 });
});

test("the progress bar (a slider) keeps its own keys; V, digits and Escape work on it as anywhere", () => {
  for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown", " "]) {
    assert.deepEqual(strip(press(key, PAUSED, { target: "slider" })), NOTHING, `slider ${key}`);
  }
  assert.deepEqual(intentOf("V", PAUSED, { target: "slider" }), { type: "cycleCamera" });
  assert.deepEqual(intentOf("2", PAUSED, { target: "slider" }), { type: "setSpeed", speed: 2 });
  assert.deepEqual(intentOf("Escape", PAUSED, { target: "slider" }), { type: "goLive" });
});

test("Escape takes the topmost layer first: an error toast, then the open settings menu, then Go Live", () => {
  assert.deepEqual(intentOf("Escape", ctxOf({ toastErr: true, settingsOpen: true })), { type: "dismissToast" });
  assert.deepEqual(intentOf("Escape", ctxOf({ settingsOpen: true })), { type: "closeSettings" });
  assert.deepEqual(intentOf("Escape", ctxOf()), { type: "goLive" });
});

test("held keys: Left and Right repeat (each press waits its turn in the playback lane); the rest do not", () => {
  assert.deepEqual(intentOf("ArrowLeft", PAUSED, { repeat: true }), { type: "stepBack" });
  assert.deepEqual(intentOf("ArrowRight", PAUSED, { repeat: true }), { type: "stepForward" });
  for (const key of [" ", "1", "V", "Escape"]) {
    assert.deepEqual(strip(press(key, PAUSED, { repeat: true })), PREVENT_ONLY, `held ${key}`);
  }
  assert.deepEqual(strip(press("Escape", ctxOf({ settingsOpen: true }), { repeat: true })), PREVENT_ONLY);
});

test("modeOf: a watched game, else the live feed, else normal (#app[data-mode])", () => {
  for (const ws of ["playing", "paused", "done", "error"]) assert.equal(modeOf(ctxOf({ watchState: ws })), "watch", ws);
  assert.equal(modeOf(ctxOf({ watchState: "playing", feedOn: true })), "watch", "a session beats the feed");
  assert.equal(modeOf(ctxOf({ feedOn: true })), "feed");
  assert.equal(modeOf(ctxOf({ watchState: "stopped" })), "normal");
  assert.equal(modeOf(ctxOf({ watchState: undefined })), "normal", "an old server has no watch");
  assert.equal(press("V", ctxOf({ feedOn: true })).mode, "feed", "resolveKey reports the mode it resolved in");
});

test("keyContext reads the store: the freshest feed and watch (version first), the toast and the settings menu", () => {
  const base = initialState();
  assert.deepEqual(keyContext(base), IDLE);
  const s = { ...base, server: { feed: { on: false }, watch: { state: "paused" } },
    version: { feed: { on: true }, watch: { state: "playing" } },
    view: { ...base.view, toast: { id: 1, text: "x", err: true }, settingsOpen: true } };
  assert.deepEqual(keyContext(s), { feedOn: true, watchState: "playing", toastErr: true, settingsOpen: true });
});
