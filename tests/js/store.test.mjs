import assert from "node:assert/strict";
import test from "node:test";

import { createStore } from "../../static/js/core/store.js";

const counter = (state, event) => {
  if (event.type === "inc") return { ...state, n: state.n + (event.by ?? 1) };
  if (event.type === "same") return state;
  return state;
};

test("dispatch runs the reducer and notifies with (state, prev, event) only on change", () => {
  const store = createStore(counter, Object.freeze({ n: 0, other: {} }));
  const seen = [];
  store.subscribe((s, prev, ev) => seen.push([s.n, prev.n, ev.type]));
  store.dispatch({ type: "inc" });
  store.dispatch({ type: "same" });
  store.dispatch({ type: "inc", by: 2 });
  assert.deepEqual(seen, [[1, 0, "inc"], [3, 1, "inc"]]);
  assert.equal(store.getState().n, 3);
});

test("unsubscribe stops notifications", () => {
  const store = createStore(counter, { n: 0 });
  let calls = 0;
  const off = store.subscribe(() => { calls += 1; });
  store.dispatch({ type: "inc" });
  off();
  off();
  store.dispatch({ type: "inc" });
  assert.equal(calls, 1);
});

test("a dispatch from inside a listener runs after the current notification, in order", () => {
  const store = createStore(counter, { n: 0 });
  const log = [];
  store.subscribe((s, prev, ev) => {
    log.push(`a:${prev.n}->${s.n}`);
    if (ev.by === undefined && s.n === 1) store.dispatch({ type: "inc", by: 10 });
  });
  store.subscribe((s, prev) => log.push(`b:${prev.n}->${s.n}`));
  store.dispatch({ type: "inc" });
  assert.deepEqual(log, ["a:0->1", "b:0->1", "a:1->11", "b:1->11"]);
  assert.equal(store.getState().n, 11);
});

test("a throwing listener does not starve the others; its error goes to onError, never to the dispatcher", () => {
  const errors = [];
  const store = createStore(counter, { n: 0 }, { onError: (err) => errors.push(err.message) });
  let reached = false;
  store.subscribe(() => { throw new Error("boom"); });
  store.subscribe(() => { reached = true; });
  assert.doesNotThrow(() => store.dispatch({ type: "inc" }), "sync and actions must never see a listener's bug");
  assert.equal(reached, true);
  assert.equal(store.getState().n, 1);
  assert.deepEqual(errors, ["boom"]);
  store.dispatch({ type: "same" });
  assert.deepEqual(errors, ["boom"], "no change, no listener, no new error");
});

test("a throwing reducer leaves the state, reports the error, and later events still run", () => {
  const errors = [];
  const reducer = (s, e) => { if (e.type === "bad") throw new Error("reducer bug"); return counter(s, e); };
  const store = createStore(reducer, { n: 0 }, { onError: (err) => errors.push(err.message) });
  assert.doesNotThrow(() => store.dispatch({ type: "bad" }));
  store.dispatch({ type: "inc" });
  assert.equal(store.getState().n, 1);
  assert.deepEqual(errors, ["reducer bug"]);
});

test("without onError a listener's error is rethrown on a microtask, never into the dispatcher", () => {
  const queued = [];
  const original = globalThis.queueMicrotask;
  globalThis.queueMicrotask = (fn) => queued.push(fn);
  try {
    const store = createStore(counter, { n: 0 });
    store.subscribe(() => { throw new Error("late boom"); });
    assert.doesNotThrow(() => store.dispatch({ type: "inc" }));
  } finally {
    globalThis.queueMicrotask = original;
  }
  assert.equal(queued.length, 1, "reported once, after the dispatch returned");
  assert.throws(queued[0], /late boom/);
});

test("an onError that throws is still contained", () => {
  const store = createStore(counter, { n: 0 }, { onError: () => { throw new Error("reporter broke"); } });
  store.subscribe(() => { throw new Error("boom"); });
  const queued = [];
  const original = globalThis.queueMicrotask;
  globalThis.queueMicrotask = (fn) => queued.push(fn);
  try {
    assert.doesNotThrow(() => store.dispatch({ type: "inc" }));
  } finally {
    globalThis.queueMicrotask = original;
  }
  assert.equal(store.getState().n, 1);
  assert.equal(queued.length, 1, "the reporter's own failure is rethrown later");
  assert.throws(queued[0], /reporter broke/);
});

test("createStore rejects an onError that is not a function", () => {
  assert.throws(() => createStore(counter, { n: 0 }, { onError: "nope" }), TypeError);
});

test("dispatch rejects events without a string type", () => {
  const store = createStore(counter, { n: 0 });
  for (const bad of [null, undefined, "inc", {}, { type: 3 }]) assert.throws(() => store.dispatch(bad), TypeError);
  assert.throws(() => store.subscribe("nope"), TypeError);
  assert.throws(() => createStore("nope", {}), TypeError);
});

test("select reads a slice; observe fires only when the selected value changes by identity", () => {
  const store = createStore((s, e) => (e.type === "touch" ? { ...s } : counter(s, e)), { n: 0, slice: { a: 1 } });
  assert.equal(store.select((s) => s.slice.a), 1);
  const seen = [];
  const off = store.observe((s) => s.slice, (next, prev) => seen.push([next, prev]));
  store.dispatch({ type: "touch" });
  store.dispatch({ type: "inc" });
  assert.deepEqual(seen, []);
  off();
  const nSeen = [];
  store.observe((s) => s.n, (next, prev) => nSeen.push([prev, next]));
  store.dispatch({ type: "inc" });
  assert.deepEqual(nSeen, [[1, 2]]);
});
