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
    [el("input"), "text"], [el("input", { type: "text" }), "text"], [el("input", { type: "number" }), "text"],
    [el("input", { type: "search" }), "text"], [el("input", { type: "email" }), "text"], [el("input", { type: "range" }), "slider"],
    [el("div", { role: "slider" }), "slider"],                                  // the top bar's progress bar
    [el("input", { type: "weird" }), "text"], [el("textarea"), "text"], [el("select"), "text"],
    [el("div", { editable: true }), "text"], [el("div", { role: "textbox" }), "text"], [el("div", { role: "spinbutton" }), "text"],
    [el("input", { type: "checkbox", id: "ulsRoomLights" }), "activatable"], [el("input", { type: "radio" }), "activatable"],
    [el("input", { type: "submit" }), "activatable"], [el("button"), "activatable"],
    [el("a", { href: "/report" }), "activatable"], [el("summary"), "activatable"],
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
  const h = harness({ watch: { state: "paused" } });
  const e = h.press(" ");
  assert.equal(e.prevented, true);
  h.press("ArrowLeft");
  h.press("ArrowRight", el("body"), { repeat: true });
  h.press("4");
  h.press("v");
  h.press("Escape");
  assert.deepEqual(h.calls, [["togglePlay"], ["stepBack"], ["stepForward"], ["setSpeed", 10], ["cycleCamera"], ["goLive"]]);
});

test("text fields, modifiers and IME composition never reach the actions", () => {
  const h = harness({ watch: { state: "paused" } });
  const typed = h.press(" ", el("input", { type: "text" }));
  h.press("ArrowLeft", el("textarea"));
  h.press("v", el("body"), { ctrlKey: true });
  h.press("v", el("body"), { isComposing: true });
  h.press("v", el("body"), { keyCode: 229 });
  assert.equal(typed.prevented, false);
  assert.deepEqual(h.calls, []);
});

test("Space on a focused button stays native; a focused switch keeps the other shortcuts alive", () => {
  const h = harness({ watch: { state: "paused" } });
  const onButton = h.press(" ", el("button"));
  h.press("v", el("input", { type: "checkbox" }));
  assert.equal(onButton.prevented, false);
  assert.deepEqual(h.calls, [["cycleCamera"]]);
});

test("Escape closes the open settings menu before it goes live", () => {
  const h = harness({ watch: { state: "paused" } });
  h.store.dispatch({ type: "settings/toggle" });
  h.press("Escape");
  h.store.dispatch({ type: "settings/close" });
  h.press("Escape");
  assert.deepEqual(h.calls, [["closeSettings"], ["goLive"]]);
});

test("a key a component already handled (defaultPrevented) is not the page's", () => {
  const h = harness({ watch: { state: "paused" } });
  const e = h.press("Escape", el("button"), { defaultPrevented: true });
  h.press("ArrowLeft", el("div", { role: "slider" }), { defaultPrevented: true });
  assert.equal(e.prevented, false);
  assert.deepEqual(h.calls, []);
});

test("runIntent maps every intent type to its action", () => {
  const calls = [];
  const actions = new Proxy({}, { get: (_t, name) => (...args) => { calls.push([name, ...args]); } });
  const intents = [{ type: "togglePlay" }, { type: "stepBack" }, { type: "stepForward" }, { type: "setSpeed", speed: 2 },
    { type: "cycleCamera" }, { type: "goLive" }, { type: "closeSettings" }, { type: "dismissToast" }];
  for (const intent of intents) runIntent(actions, intent);
  assert.deepEqual(calls, [["togglePlay"], ["stepBack"], ["stepForward"], ["setSpeed", 2], ["cycleCamera"], ["goLive"],
    ["closeSettings"], ["dismissToast"]]);
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
  attachKeyboard(doc, { store, actions: { stepBack: () => { throw new Error("boom"); },
    cycleCamera: () => errors.push("camera ran") }, onError: (err) => errors.push(err.message) });
  const ev = (key) => ({ key, target: null, preventDefault() {} });
  handlers.keydown(ev("ArrowLeft"));
  handlers.keydown(ev("v"));
  assert.deepEqual(errors, ["boom", "camera ran"]);
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
  attachKeyboard(doc, { store, actions: { goLive: () => Promise.reject(new Error("async boom")) },
    onError: (err) => errors.push(err.message) });
  handlers.keydown({ key: "Escape", target: null, preventDefault() {} });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(errors, ["async boom"]);
});

test("runIntent reports sync throws and async rejections to the onError it is given", async () => {
  const errors = [];
  const onError = (err) => errors.push(err.message);
  assert.equal(runIntent({ goLive: () => { throw new Error("sync"); } }, { type: "goLive" }, onError), true);
  assert.equal(runIntent({ goLive: async () => { throw new Error("async"); } }, { type: "goLive" }, onError), true);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(errors, ["sync", "async"]);
});
