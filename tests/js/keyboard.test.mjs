import assert from "node:assert/strict";
import test from "node:test";

import { attachKeyboard, classifyTarget, runIntent } from "../../static/js/core/keyboard.js";
import { initialState, reducer } from "../../static/js/core/reducer.js";
import { createStore } from "../../static/js/core/store.js";
import { stateBody } from "./fixtures.mjs";

/** A stand-in element: just the properties classifyTarget reads. */
function el(tag, { id = "", type, role, href, editable = false } = {}) {
  const attrs = { ...(type === undefined ? {} : { type }), ...(role ? { role } : {}), ...(href ? { href } : {}) };
  return { tagName: tag.toUpperCase(), id, isContentEditable: editable,
    getAttribute: (n) => attrs[n] ?? null, hasAttribute: (n) => Object.hasOwn(attrs, n) };
}

test("classifyTarget follows the 4.x target classes (G4: checkboxes are activatable)", () => {
  const cases = [
    [el("input", { id: "yards", type: "text" }), "yards"],
    [el("input"), "text"], [el("input", { type: "text" }), "text"], [el("input", { type: "number" }), "text"],
    [el("input", { type: "search" }), "text"], [el("input", { type: "email" }), "text"], [el("input", { type: "range" }), "slider"],
    [el("div", { role: "slider" }), "slider"],                                  // G5-12: the replay scrub's strip
    [el("input", { type: "weird" }), "text"], [el("textarea"), "text"], [el("select"), "text"],
    [el("div", { editable: true }), "text"], [el("div", { role: "textbox" }), "text"], [el("div", { role: "spinbutton" }), "text"],
    [el("input", { type: "checkbox", id: "fTD" }), "activatable"], [el("input", { type: "radio" }), "activatable"],
    [el("input", { type: "submit" }), "activatable"], [el("button", { id: "undoBtn" }), "activatable"],
    [el("a", { href: "/api/export.csv" }), "activatable"], [el("summary"), "activatable"],
    [el("div", { role: "button" }), "activatable"], [el("span", { role: "switch" }), "activatable"],
    [el("a"), "other"], [el("body"), "other"], [el("div", { id: "field" }), "other"], [null, "other"], [{}, "other"],
  ];
  for (const [node, cls] of cases) assert.equal(classifyTarget(node), cls, JSON.stringify(node?.tagName ?? node));
});

function harness(state = {}) {
  const store = createStore(reducer, initialState());
  store.dispatch({ type: "state/loaded", body: stateBody(state), origin: "poll", reqSeq: 0, now: 0 });
  const calls = [];
  const actions = new Proxy({}, { get: (_t, name) => (...args) => { calls.push([name, ...args]); } });
  const handlers = {};
  const doc = { addEventListener: (t, fn) => { handlers[t] = fn; }, removeEventListener: (t) => { delete handlers[t]; } };
  const detach = attachKeyboard(doc, { store, actions });
  const press = (key, target = el("body"), extra = {}) => {
    const e = { key, target, repeat: false, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, isComposing: false,
      prevented: false, preventDefault() { this.prevented = true; }, ...extra };
    handlers.keydown(e);
    return e;
  };
  return { store, calls, press, detach, handlers };
}

test("attachKeyboard resolves keys against the store and runs the intent", () => {
  const h = harness({ drive_active: true });
  const e = h.press("p");
  assert.equal(e.prevented, true);
  h.press("Enter", el("input", { id: "yards" }));
  h.press("x");
  assert.deepEqual(h.calls, [["tap", "P"], ["logPlay"], ["openFlag"]]);
});

test("text fields, modifiers and IME composition never reach the actions (#49, #50)", () => {
  const h = harness();
  const typed = h.press("j", el("input", { id: "iQtr", type: "text" }));
  h.press("p", el("body"), { ctrlKey: true });
  h.press("p", el("body"), { isComposing: true });
  h.press("p", el("body"), { keyCode: 229 });
  assert.equal(typed.prevented, false);
  assert.deepEqual(h.calls, []);
});

test("Enter on a focused button stays native (G5); the checkbox keeps shortcuts alive (G4, #61)", () => {
  const h = harness({ drive_active: true });
  const onButton = h.press("Enter", el("button"));
  h.press("j", el("input", { type: "checkbox", id: "fTD" }));
  assert.equal(onButton.prevented, false);
  assert.deepEqual(h.calls, [["tap", "J"]]);
});

test("the mode comes from the store: feed retags, flag letters apply fouls, watch keys drive the transport", () => {
  const feed = harness({ feed: { on: true, state: "live" } });
  feed.press("a");
  feed.press("u");
  assert.deepEqual(feed.calls, [["retag", "A", { pauseFirst: false }], ["undo"]]);
  const flag = harness({ drive_active: true });
  flag.store.dispatch({ type: "flag/open" });
  flag.press("u");
  flag.press("Escape");
  assert.deepEqual(flag.calls, [["applyFlag", "URD"], ["closeFlag"]]);
  const watch = harness({ watch: { state: "playing" } });
  watch.press(" ");
  watch.press("3");
  watch.press("ArrowRight", el("body"), { repeat: true });
  watch.press("a");
  assert.deepEqual(watch.calls, [["watchToggle"], ["watchSpeed", 4], ["review", 1, { repeat: true }], ["retag", "A", { pauseFirst: true }]]);
});

test("runIntent maps every intent type to its action", () => {
  const calls = [];
  const actions = new Proxy({}, { get: (_t, name) => (...args) => { calls.push([name, ...args]); } });
  const intents = [{ type: "tap", key: "R" }, { type: "outcome", out: "sack" }, { type: "toggleTD" }, { type: "toggleTO" },
    { type: "openFlag" }, { type: "closeFlag" }, { type: "applyFlag", code: "DH" }, { type: "undo" }, { type: "undoRefused" },
    { type: "clearPick" }, { type: "logPlay" }, { type: "retag", key: "O", pauseFirst: true }, { type: "cycleCamera" },
    { type: "toggleBooth" }, { type: "toggleScorecard" }, { type: "closeScorecard" }, { type: "watchToggle" },
    { type: "watchSpeed", speed: 10 }, { type: "review", delta: -1, repeat: false }, { type: "exitReview" },
    { type: "closeBooth" }, { type: "dismissToast" }];
  for (const intent of intents) runIntent(actions, intent);
  assert.deepEqual(calls.map((c) => c[0]), ["tap", "outcome", "toggleTD", "toggleTO", "openFlag", "closeFlag", "applyFlag", "undo",
    "undoRefused", "clearPick", "logPlay", "retag", "cycleCamera", "toggleBooth", "toggleScorecard", "closeScorecard",
    "watchToggle", "watchSpeed", "review", "exitReview", "closeBooth", "dismissToast"]);
  assert.deepEqual(calls[11], ["retag", "O", { pauseFirst: true }]);
  assert.equal(runIntent(actions, { type: "nope" }), false);
  assert.equal(runIntent(actions, { type: "constructor" }), false);
  assert.equal(runIntent(actions, null), false);
});

test("an action that throws is reported, and the listener keeps working", () => {
  const store = createStore(reducer, initialState());
  store.dispatch({ type: "state/loaded", body: stateBody(), origin: "poll", reqSeq: 0, now: 0 });
  const errors = [];
  const handlers = {};
  const doc = { addEventListener: (t, fn) => { handlers[t] = fn; }, removeEventListener: () => {} };
  attachKeyboard(doc, { store, actions: { tap: () => { throw new Error("boom"); }, undo: () => errors.push("undo ran") },
    onError: (err) => errors.push(err.message) });
  const ev = (key) => ({ key, target: null, preventDefault() {} });
  handlers.keydown(ev("p"));
  handlers.keydown(ev("u"));
  assert.deepEqual(errors, ["boom", "undo ran"]);
});

test("detach removes the listener", () => {
  const h = harness();
  h.detach();
  assert.equal(h.handlers.keydown, undefined);
});

test("an async action that rejects is reported through onError, not left unhandled", async () => {
  const store = createStore(reducer, initialState());
  store.dispatch({ type: "state/loaded", body: stateBody(), origin: "poll", reqSeq: 0, now: 0 });
  const errors = [];
  const handlers = {};
  const doc = { addEventListener: (t, fn) => { handlers[t] = fn; }, removeEventListener: () => {} };
  attachKeyboard(doc, { store, actions: { undo: () => Promise.reject(new Error("async boom")) },
    onError: (err) => errors.push(err.message) });
  handlers.keydown({ key: "u", target: null, preventDefault() {} });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(errors, ["async boom"]);
});

test("runIntent reports sync throws and async rejections to the onError it is given", async () => {
  const errors = [];
  const onError = (err) => errors.push(err.message);
  assert.equal(runIntent({ undo: () => { throw new Error("sync"); } }, { type: "undo" }, onError), true);
  assert.equal(runIntent({ undo: async () => { throw new Error("async"); } }, { type: "undo" }, onError), true);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(errors, ["sync", "async"]);
});
