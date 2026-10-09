import assert from "node:assert/strict";
import test from "node:test";

import {
  EMPTY_PICK, canLog, chosenText, flagPayload, pickLeaf, playPayload, selectedLeaf, tap, toggleOutcome,
} from "../../static/js/core/selection.js";
import { FAMILY_NAMES, KEYS, deepFreeze, loadState } from "./fixtures.mjs";

const taps = (keys) => keys.split("").reduce((p, k) => tap(p, k), EMPTY_PICK);
const withOut = (pick, out) => toggleOutcome(pick, out);
const text = (pick) => chosenText(pick, KEYS, FAMILY_NAMES);

test("the test KEYS equal the tap cycles the server serves", () => {
  assert.deepEqual(loadState("final").keys, KEYS);
});

test("tap: R maps to K, the same key cycles, another key restarts, an outcome is cleared (FI 1.3)", () => {
  const p0 = deepFreeze({ k: "P", i: 1, out: "sack" });
  assert.deepEqual(tap(p0, "P"), { k: "P", i: 2, out: null });
  assert.deepEqual(tap(p0, "J"), { k: "J", i: 0, out: null });
  assert.deepEqual(tap(EMPTY_PICK, "R"), { k: "K", i: 0, out: null });
  assert.deepEqual(tap(tap(EMPTY_PICK, "K"), "R"), { k: "K", i: 1, out: null });
  assert.equal(tap(p0, "Q"), p0, "an unknown key leaves the pick");
  assert.deepEqual(p0, { k: "P", i: 1, out: "sack" }, "input untouched");
});

test("PPPP wraps Short, Intermediate, Deep, Short with the tap hint (#38)", () => {
  const seen = ["P", "PP", "PPP", "PPPP"].map((k) => text(taps(k)));
  assert.deepEqual(seen.map((t) => t.text), ["Short (0–9 air yds)", "Intermediate (10–19)", "Deep shot (20+)", "Short (0–9 air yds)"]);
  assert.deepEqual(seen.map((t) => t.hint), ["tap P for Intermediate (10–19)", "tap P for Deep shot (20+)",
    "tap P for Short (0–9 air yds)", "tap P for Intermediate (10–19)"]);
  assert.equal(selectedLeaf(taps("PPPP"), KEYS).leaf, "dropback_short");
});

test("J, L, K, R, A, N and O cycle as FI 1.4 says (#39, #40)", () => {
  const names = (k, n) => Array.from({ length: n }, (_, i) => text(taps(k.repeat(i + 1))).text);
  assert.deepEqual(names("J", 3), ["Off-tackle left", "Outside left (edge)", "Off-tackle left"]);
  assert.deepEqual(names("L", 2), ["Off-tackle right", "Outside right (edge)"]);
  assert.deepEqual(names("A", 3), ["PA short (0–9)", "PA intermediate (10–19)", "PA deep shot (20+)"]);
  assert.deepEqual(names("O", 2), ["RPO, handed off or kept", "RPO, thrown"]);
  assert.equal(text(taps("N")).text, "Screen");
  for (const k of ["K", "R"]) {
    const t = text(taps(k));
    assert.equal(t.text, "Inside run (A/B gap)");
    assert.equal(t.hint, null, "one-entry cycles have no hint");
    assert.equal(taps(k).k, "K", "R lights the K key");
  }
});

test("toggleOutcome: the same outcome twice turns it off; a play key after it clears it (#44)", () => {
  const p = withOut(taps("P"), "incomplete");
  assert.equal(p.out, "incomplete");
  assert.equal(withOut(p, "incomplete").out, null);
  assert.equal(withOut(p, "sack").out, "sack");
  assert.equal(tap(p, "P").out, null);
  assert.equal(toggleOutcome(p, "fumble"), p, "unknown outcomes are ignored");
});

test("chosenText reproduces every FI 1.5 cell", () => {
  const cells = [
    ["P", "Short (0–9 air yds), incomplete", "Dropback pass, sack", "Dropback pass, scramble"],
    ["PP", "Intermediate (10–19), incomplete", "Dropback pass, sack", "Dropback pass, scramble"],
    ["PPP", "Deep shot (20+), incomplete", "Dropback pass, sack", "Dropback pass, scramble"],
    ["A", "PA short (0–9), incomplete", "Play-action, sack", "Play-action, scramble"],
    ["AA", "PA intermediate (10–19), incomplete", "Play-action, sack", "Play-action, scramble"],
    ["AAA", "PA deep shot (20+), incomplete", "Play-action, sack", "Play-action, scramble"],
    ["N", "Screen, incomplete", "Dropback pass, sack", "Dropback pass, scramble"],
    ["O", "RPO, thrown, incomplete", "Dropback pass, sack", "Dropback pass, scramble"],
    ["OO", "RPO, thrown, incomplete", "RPO, sack", "RPO, scramble"],
    ["J", "Dropback pass, incomplete", "Dropback pass, sack", "Dropback pass, scramble"],
    ["K", "Dropback pass, incomplete", "Dropback pass, sack", "Dropback pass, scramble"],
    ["L", "Dropback pass, incomplete", "Dropback pass, sack", "Dropback pass, scramble"],
    ["", "Dropback pass, incomplete", "Dropback pass, sack", "Dropback pass, scramble"],
  ];
  for (const [keys, inc, sack, scr] of cells) {
    const base = taps(keys);
    assert.equal(text(withOut(base, "incomplete")).text, inc, `${keys || "nothing"} + I`);
    assert.equal(text(withOut(base, "sack")).text, sack, `${keys || "nothing"} + S`);
    assert.equal(text(withOut(base, "scramble")).text, scr, `${keys || "nothing"} + C`);
    assert.equal(text(withOut(base, "sack")).hint, null, "no hint once an outcome is set");
  }
});

test("chosenText shows the placeholder when nothing is picked (#47)", () => {
  assert.deepEqual(text(EMPTY_PICK), { text: "Pick the play", placeholder: true, hint: null });
  assert.equal(chosenText(taps("P"), null, FAMILY_NAMES).placeholder, true, "no keys yet: placeholder");
});

test("pickLeaf finds the key and tap count for a prediction row (#37)", () => {
  assert.deepEqual(pickLeaf(KEYS, "run_edge_left"), { k: "J", i: 1, out: null });
  assert.deepEqual(pickLeaf(KEYS, "rpo_throw"), { k: "O", i: 1, out: null });
  assert.deepEqual(pickLeaf(KEYS, "run_inside"), { k: "K", i: 0, out: null });
  assert.deepEqual(pickLeaf(KEYS, "pa_deep"), { k: "A", i: 2, out: null });
  assert.equal(pickLeaf(KEYS, "nope"), null);
  assert.equal(pickLeaf(null, "screen"), null);
});

test("canLog needs a drive and a leaf or an outcome (#45, #58, #59)", () => {
  assert.equal(canLog(EMPTY_PICK, KEYS, true), false);
  assert.equal(canLog(taps("K"), KEYS, false), false);
  assert.equal(canLog(taps("K"), KEYS, true), true);
  assert.equal(canLog(withOut(EMPTY_PICK, "incomplete"), KEYS, true), true);
});

test("playPayload matches FI 2.4 byte for byte (#51, #52)", () => {
  const form = (yards, td = false, turnover = false) => ({ yards, td, turnover });
  assert.equal(JSON.stringify(playPayload(taps("K"), KEYS, form("3"))), '{"yards":3,"td":false,"turnover":false,"leaf":"run_inside"}');
  assert.deepEqual(playPayload(withOut(taps("P"), "sack"), KEYS, form("7")),
    { yards: 7, td: false, turnover: false, leaf: "dropback_short", outcome: "sack" });
  assert.deepEqual(playPayload(withOut(EMPTY_PICK, "incomplete"), KEYS, form("0")),
    { yards: 0, td: false, turnover: false, family: "dropback", outcome: "incomplete" });
  assert.deepEqual(playPayload(taps("LL"), KEYS, form("5", false, true)),
    { yards: 5, td: false, turnover: true, leaf: "run_edge_right" });
  assert.equal(playPayload(taps("K"), KEYS, form("")).yards, 0);
  assert.equal(playPayload(taps("K"), KEYS, form("abc")).yards, 0);
  assert.equal(playPayload(taps("K"), KEYS, form("-3")).yards, -3);
  assert.equal(playPayload(taps("K"), KEYS, form("15-")).yards, 15);
  assert.equal(playPayload(EMPTY_PICK, KEYS, form("3")), null);
});

test("flagPayload matches FI 2.5 (#68)", () => {
  const form = (yards, autoFirst = false) => ({ yards, autoFirst });
  assert.equal(JSON.stringify(flagPayload("DH", EMPTY_PICK, KEYS, form("0"))), '{"code":"DH","yards":null,"auto_first":false}');
  assert.deepEqual(flagPayload("DPI", taps("PPP"), KEYS, form("28")),
    { code: "DPI", yards: 28, auto_first: false, play: { leaf: "dropback_deep", family: null, outcome: null } });
  assert.deepEqual(flagPayload("OTHER_D", withOut(EMPTY_PICK, "sack"), KEYS, form("15", true)),
    { code: "OTHER_D", yards: 15, auto_first: true, play: { leaf: null, family: "dropback", outcome: "sack" } });
  assert.equal(flagPayload("FS", taps("J"), KEYS, form("")).yards, null);
});
