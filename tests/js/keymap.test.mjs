import assert from "node:assert/strict";
import test from "node:test";

import { FLAG_KEYS } from "../../static/js/core/flags.js";
import { inputKeyAction, keyContext, modeOf, normalizeKey, resolveKey } from "../../static/js/core/keymap.js";

const NORMAL = Object.freeze({ feedOn: false, watchState: "idle", flagOpen: false, scorecardOpen: false, reviewing: false });
const ctxOf = (over = {}) => ({ ...NORMAL, ...over });
const FLAG = ctxOf({ flagOpen: true });
const FEED = ctxOf({ feedOn: true });
const PLAYING = ctxOf({ watchState: "playing" });
const PAUSED = ctxOf({ watchState: "paused" });
const DONE = ctxOf({ watchState: "done" });
const NO_MODS = Object.freeze({ meta: false, ctrl: false, alt: false, shift: false });

function press(key, ctx = NORMAL, { target = "other", repeat = false, mods = {}, composing = false } = {}) {
  return resolveKey({ key: normalizeKey(key), repeat, mods: { ...NO_MODS, ...mods }, composing, target, ctx });
}
const intentOf = (...a) => press(...a).intent;
const NOTHING = { intent: null, prevent: false };
const PREVENT_ONLY = { intent: null, prevent: true };
const strip = ({ intent, prevent }) => ({ intent, prevent });

test("normalizeKey uppercases single characters and names Space (and legacy names)", () => {
  const cases = { p: "P", P: "P", " ": "Space", Spacebar: "Space", Esc: "Escape", Left: "ArrowLeft", Right: "ArrowRight",
    Enter: "Enter", ArrowLeft: "ArrowLeft", 1: "1", "-": "-", Tab: "Tab", Space: "Space" };
  for (const [raw, out] of Object.entries(cases)) assert.equal(normalizeKey(raw), out, raw);
  assert.equal(normalizeKey(undefined), "");
});

test("modeOf: flag, then watch, then feed, then normal (section 4.2)", () => {
  assert.equal(modeOf(NORMAL), "normal");
  assert.equal(modeOf(FLAG), "flag");
  assert.equal(modeOf(ctxOf({ flagOpen: true, watchState: "stopped" })), "flag");
  assert.equal(modeOf(ctxOf({ flagOpen: true, feedOn: true })), "feed", "feed on hides the panel but keeps it");
  for (const ws of ["playing", "paused", "done", "error"]) {
    assert.equal(modeOf(ctxOf({ watchState: ws })), "watch", ws);
    assert.equal(modeOf(ctxOf({ watchState: ws, flagOpen: true, feedOn: true })), "watch", `${ws} beats flag and feed`);
  }
  assert.equal(modeOf(FEED), "feed");
  assert.equal(modeOf(ctxOf({ watchState: "stopped" })), "normal");
  assert.equal(modeOf(ctxOf({ watchState: undefined })), "normal", "an old server has no watch");
});

test("guard: Meta, Ctrl and Alt never act and never prevent (#50)", () => {
  for (const ctx of [NORMAL, FLAG, FEED, PLAYING]) {
    for (const mod of ["meta", "ctrl", "alt"]) {
      for (const key of ["P", "U", "Enter", "Escape", " ", "1", "ArrowLeft", "V"]) {
        assert.deepEqual(strip(press(key, ctx, { mods: { [mod]: true } })), NOTHING, `${mod}+${key}`);
      }
    }
  }
  assert.deepEqual(intentOf("P", NORMAL, { mods: { shift: true } }), { type: "tap", key: "P" }, "Shift+P acts as P");
});

test("guard: composing and text targets never act (#49, PRODUCT.md)", () => {
  for (const ctx of [NORMAL, FLAG, FEED, PLAYING, PAUSED]) {
    for (const key of ["J", "P", "U", "Enter", "Escape", " ", "1", "ArrowLeft", "V", "B", "G", "X"]) {
      assert.deepEqual(strip(press(key, ctx, { target: "text" })), NOTHING, `text target ${key}`);
      assert.deepEqual(strip(press(key, ctx, { composing: true })), NOTHING, `composing ${key}`);
    }
  }
});

test("guard: a checkbox is activatable, so shortcuts keep working (G4, #61)", () => {
  assert.deepEqual(intentOf("J", NORMAL, { target: "activatable" }), { type: "tap", key: "J" });
  assert.deepEqual(intentOf("T", NORMAL, { target: "activatable" }), { type: "toggleTD" });
});

test("normal mode: every FI 1.3 key", () => {
  for (const k of ["J", "K", "L", "R", "P", "A", "N", "O"]) {
    assert.deepEqual(press(k.toLowerCase()).intent, { type: "tap", key: k }, k);
    assert.equal(press(k).prevent, true);
  }
  const table = { I: { type: "outcome", out: "incomplete" }, S: { type: "outcome", out: "sack" },
    C: { type: "outcome", out: "scramble" }, T: { type: "toggleTD" }, F: { type: "toggleTO" }, X: { type: "openFlag" },
    U: { type: "undo" }, Escape: { type: "clearPick" }, Enter: { type: "logPlay" } };
  for (const [k, intent] of Object.entries(table)) {
    assert.deepEqual(strip(press(k)), { intent, prevent: true }, k);
    assert.deepEqual(strip(press(k, NORMAL, { target: "yards" })), { intent, prevent: true }, `${k} in Yards`);
  }
});

test("normal mode: Enter on a focused button activates the button, never logs (G5)", () => {
  assert.deepEqual(strip(press("Enter", NORMAL, { target: "activatable" })), NOTHING);
});

test("normal mode: Yards takes digits and minus; other characters are blocked (#48)", () => {
  for (const k of ["0", "5", "9", "-"]) assert.deepEqual(strip(press(k, NORMAL, { target: "yards" })), NOTHING, k);
  for (const k of ["q", "Z", ".", " ", "+", "e"]) assert.deepEqual(strip(press(k, NORMAL, { target: "yards" })), PREVENT_ONLY, k);
  assert.deepEqual(strip(press("constructor", NORMAL)), NOTHING, "inherited names are not keys");
  assert.deepEqual(strip(press("toString", FLAG)), NOTHING);
  for (const k of ["Tab", "Backspace", "ArrowLeft", "ArrowRight", "Home"]) {
    assert.deepEqual(strip(press(k, NORMAL, { target: "yards" })), NOTHING, `${k} edits Yards natively`);
  }
  for (const k of ["q", "5", " ", "Tab", "Home"]) assert.deepEqual(strip(press(k)), NOTHING, `${k} elsewhere`);
});

test("global keys V, B, G work in every mode except flag", () => {
  for (const ctx of [NORMAL, FEED, PLAYING, PAUSED, DONE]) {
    assert.deepEqual(strip(press("v", ctx)), { intent: { type: "cycleCamera" }, prevent: true });
    assert.deepEqual(strip(press("b", ctx)), { intent: { type: "toggleBooth" }, prevent: true });
    assert.deepEqual(strip(press("g", ctx)), { intent: { type: "toggleScorecard" }, prevent: true });
  }
});

test("Space plays or pauses a watch session, unless a button has focus (4.4)", () => {
  for (const ctx of [PLAYING, PAUSED]) {
    assert.deepEqual(strip(press(" ", ctx)), { intent: { type: "watchToggle" }, prevent: true });
    assert.deepEqual(strip(press(" ", ctx, { target: "activatable" })), NOTHING);
  }
  for (const ctx of [NORMAL, FEED, DONE, ctxOf({ watchState: "error" })]) {
    assert.deepEqual(strip(press(" ", ctx)), NOTHING, `no session: ${ctx.watchState}`);
    assert.deepEqual(strip(press(" ", ctx, { target: "activatable" })), NOTHING);
  }
});

test("Left and Right review, except inside Yards where they move the caret", () => {
  for (const ctx of [NORMAL, FEED, PLAYING, PAUSED, DONE]) {
    assert.deepEqual(strip(press("ArrowLeft", ctx)), { intent: { type: "review", delta: -1, repeat: false }, prevent: true });
    assert.deepEqual(strip(press("ArrowRight", ctx, { target: "activatable" })),
      { intent: { type: "review", delta: 1, repeat: false }, prevent: true });
  }
  assert.deepEqual(strip(press("ArrowLeft", NORMAL, { target: "yards" })), NOTHING);
  assert.deepEqual(strip(press("ArrowRight", NORMAL, { target: "yards" })), NOTHING);
});

test("digits 1 to 4 pick 1x, 2x, 4x, 10x only in a watch session and outside Yards (4.4)", () => {
  const speeds = { 1: 1, 2: 2, 3: 4, 4: 10 };
  for (const ctx of [PLAYING, PAUSED]) {
    for (const [k, speed] of Object.entries(speeds)) {
      assert.deepEqual(strip(press(k, ctx)), { intent: { type: "watchSpeed", speed }, prevent: true }, k);
    }
    assert.deepEqual(strip(press("5", ctx)), NOTHING);
  }
  assert.deepEqual(strip(press("1", NORMAL, { target: "yards" })), NOTHING, "Yards owns digits during entry");
  assert.deepEqual(strip(press("1", DONE)), NOTHING);
  assert.deepEqual(strip(press("2", FEED)), NOTHING, "digits do nothing with the feed on (#99)");
});

test("Escape layering: flag panel, then scorecard, then review, then clear pick", () => {
  assert.deepEqual(intentOf("Escape", ctxOf({ flagOpen: true, scorecardOpen: true, reviewing: true })), { type: "closeFlag" });
  assert.deepEqual(intentOf("Escape", ctxOf({ scorecardOpen: true, reviewing: true })), { type: "closeScorecard" });
  assert.deepEqual(intentOf("Escape", ctxOf({ reviewing: true })), { type: "exitReview" });
  assert.deepEqual(intentOf("Escape", NORMAL), { type: "clearPick" });
  for (const base of [FEED, PLAYING]) {
    assert.deepEqual(intentOf("Escape", { ...base, scorecardOpen: true }), { type: "closeScorecard" });
    assert.deepEqual(intentOf("Escape", { ...base, reviewing: true }), { type: "exitReview" });
    assert.deepEqual(strip(press("Escape", base)), NOTHING, "never a request in feed or watch mode (#99)");
  }
});

test("feed mode: retag keys and U only (FI 1.7, #97 to #99)", () => {
  for (const k of ["A", "N", "O", "P", "J", "K", "L", "R"]) {
    assert.deepEqual(strip(press(k.toLowerCase(), FEED)), { intent: { type: "retag", key: k, pauseFirst: false }, prevent: true });
  }
  assert.deepEqual(intentOf("U", FEED), { type: "undo" });
  for (const k of ["X", "Escape", "Enter", "T", "F", "I", "S", "C", "0", "7", "H", "W"]) {
    assert.deepEqual(strip(press(k, FEED)), NOTHING, k);
  }
  assert.deepEqual(intentOf("H", ctxOf({ feedOn: true, flagOpen: true })), null, "a kept panel is not flag mode");
});

test("watch mode: retag pauses a playing watch first; U is refused; nothing else acts", () => {
  for (const k of ["A", "N", "O", "P", "J", "K", "L", "R"]) {
    assert.deepEqual(intentOf(k, PLAYING), { type: "retag", key: k, pauseFirst: true }, k);
    assert.deepEqual(intentOf(k, PAUSED), { type: "retag", key: k, pauseFirst: false }, k);
    assert.deepEqual(intentOf(k, DONE), { type: "retag", key: k, pauseFirst: false }, k);
  }
  assert.deepEqual(strip(press("U", PLAYING)), { intent: { type: "undoRefused" }, prevent: true });
  for (const k of ["X", "Enter", "T", "F", "I", "S", "C", "W", "Escape"]) assert.deepEqual(strip(press(k, PAUSED)), NOTHING, k);
});

test("flag mode: every flag letter applies its code, B and G included (FI 1.6, #68 to #75)", () => {
  for (const [k, code] of Object.entries(FLAG_KEYS)) {
    assert.deepEqual(strip(press(k.toLowerCase(), FLAG)), { intent: { type: "applyFlag", code }, prevent: true }, k);
  }
  assert.deepEqual(intentOf("U", FLAG), { type: "applyFlag", code: "URD" }, "U is unnecessary roughness, not undo (#74)");
  assert.deepEqual(intentOf("I", FLAG), { type: "applyFlag", code: "IG" });
});

test("flag mode: Escape and X close and keep the pick (#66)", () => {
  assert.deepEqual(strip(press("Escape", FLAG)), { intent: { type: "closeFlag" }, prevent: true });
  assert.deepEqual(strip(press("x", FLAG)), { intent: { type: "closeFlag" }, prevent: true });
});

test("flag mode: digits type into Yards; everything else is swallowed (#67)", () => {
  for (const k of ["0", "4", "9", "-"]) {
    assert.deepEqual(strip(press(k, FLAG)), NOTHING, k);
    assert.deepEqual(strip(press(k, FLAG, { target: "yards" })), NOTHING, `${k} in Yards`);
  }
  for (const k of ["J", "T", "V", "K", "A", "S", "Q", ".", " "]) assert.deepEqual(strip(press(k, FLAG)), PREVENT_ONLY, k);
  assert.deepEqual(strip(press("Enter", FLAG)), PREVENT_ONLY, "Enter never logs a play in flag mode");
  assert.deepEqual(strip(press("Enter", FLAG, { target: "yards" })), PREVENT_ONLY);
  assert.deepEqual(strip(press("Enter", FLAG, { target: "activatable" })), NOTHING, "a focused flag button activates");
  assert.deepEqual(strip(press(" ", FLAG, { target: "activatable" })), NOTHING);
  for (const k of ["Tab", "ArrowLeft", "ArrowRight", "Backspace"]) assert.deepEqual(strip(press(k, FLAG)), NOTHING, k);
});

test("repeats: request keys and toggles are swallowed; picks, outcomes, T/F and arrows repeat (4.1 rule 4)", () => {
  const rep = (key, ctx, target) => strip(press(key, ctx, { repeat: true, target }));
  assert.deepEqual(rep("Enter", NORMAL), PREVENT_ONLY);
  assert.deepEqual(rep("U", NORMAL), PREVENT_ONLY);
  assert.deepEqual(rep("X", NORMAL), PREVENT_ONLY);
  assert.deepEqual(rep("U", FEED), PREVENT_ONLY);
  assert.deepEqual(rep("A", FEED), PREVENT_ONLY);
  assert.deepEqual(rep("U", PLAYING), PREVENT_ONLY);
  assert.deepEqual(rep("H", FLAG), PREVENT_ONLY);
  assert.deepEqual(rep("X", FLAG), PREVENT_ONLY);
  assert.deepEqual(rep(" ", PLAYING), PREVENT_ONLY);
  assert.deepEqual(rep("3", PAUSED), PREVENT_ONLY);
  for (const k of ["V", "B", "G"]) assert.deepEqual(rep(k, NORMAL), PREVENT_ONLY, k);
  assert.deepEqual(rep("P", NORMAL).intent, { type: "tap", key: "P" }, "holding P keeps cycling");
  assert.deepEqual(rep("I", NORMAL).intent, { type: "outcome", out: "incomplete" });
  assert.deepEqual(rep("T", NORMAL).intent, { type: "toggleTD" });
  assert.deepEqual(rep("Escape", NORMAL), PREVENT_ONLY, "a held Esc that closed the panel must not then clear the pick");
  assert.deepEqual(rep("Escape", ctxOf({ scorecardOpen: true })), PREVENT_ONLY);
  assert.deepEqual(rep("ArrowLeft", PAUSED).intent, { type: "review", delta: -1, repeat: true });
  assert.deepEqual(rep("Enter", NORMAL, "activatable"), NOTHING, "a native repeat on a button stays native");
});

test("resolveKey reports the mode it resolved in and the mode right after the intent", () => {
  assert.deepEqual([press("X", { ...NORMAL, driveActive: true }).mode, press("X", { ...NORMAL, driveActive: true }).nextMode],
    ["normal", "flag"]);
  assert.equal(press("X", { ...NORMAL, driveActive: false }).nextMode, "normal", "no drive: the panel stays shut");
  assert.equal(press("Escape", FLAG).nextMode, "normal");
  assert.equal(press("H", FLAG).nextMode, "flag", "the panel closes only when the server accepts");
  assert.equal(press("A", FEED).nextMode, "feed");
  assert.equal(press(" ", PLAYING).nextMode, "watch");
});

test("keyContext reads the store: freshest feed and watch, flag, scorecard, review, drive", () => {
  const state = {
    server: { feed: { on: false }, watch: { state: "idle" }, drive_active: true },
    version: { feed: { on: true }, watch: { state: "paused" } },
    view: { flag: { open: true }, scorecardOpen: true, review: { seq: 12 } },
  };
  assert.deepEqual(keyContext(state), { feedOn: true, watchState: "paused", flagOpen: true, scorecardOpen: true,
    reviewing: true, driveActive: true });
  assert.deepEqual(keyContext({ server: null, version: null, view: { flag: { open: false }, scorecardOpen: false, review: { seq: null } } }),
    { feedOn: false, watchState: "idle", flagOpen: false, scorecardOpen: false, reviewing: false, driveActive: false });
});

test("keys inside specific inputs follow FI 1.8 (component-owned, shared here)", () => {
  assert.deepEqual(inputKeyAction("strip", "Enter"), { action: "commit", prevent: true }, "blur, commit if edited (G2, #21)");
  assert.deepEqual(inputKeyAction("strip", "Escape"), { action: "restore", prevent: true }, "server value back, no request (G1)");
  assert.deepEqual(inputKeyAction("strip", "Esc"), { action: "restore", prevent: true });
  assert.equal(inputKeyAction("strip", "Tab"), null, "Tab moves focus natively; the blur commits (#20)");
  assert.equal(inputKeyAction("strip", "5"), null);
  assert.deepEqual(inputKeyAction("cmd", "Enter"), { action: "run", prevent: true }, "never logs the pick (#84)");
  assert.equal(inputKeyAction("cmd", "Escape"), null);
  assert.deepEqual(inputKeyAction("feedEvent", "Enter"), { action: "blur", prevent: true }, "blur only (#104)");
  assert.equal(inputKeyAction("yards", "Enter"), null, "Yards Enter is the global logPlay");
  assert.equal(inputKeyAction("nope", "Enter"), null);
  assert.equal(inputKeyAction("strip", "constructor"), null, "only own table entries");
  assert.equal(inputKeyAction("toString", "Enter"), null);
});
