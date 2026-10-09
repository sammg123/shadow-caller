// ui/scheduler.js (ui-architecture.md 2.6; owner A0): one render per animation frame; a binding runs only when
// one of its deps changed by identity.
import assert from "node:assert/strict";
import test from "node:test";
import { createStore } from "../../static/js/core/store.js";
import { createScheduler } from "../../static/js/ui/scheduler.js";

function setup(extra = {}) {
  const reducer = (state, e) => (e.type === "set" ? { ...state, [e.key]: e.value } : state);
  const store = createStore(reducer, { presented: { n: 1 }, view: { a: 1 }, other: 0 });
  const frames = [];
  const raf = (fn) => { frames.push(fn); return frames.length; };
  const cancelled = [];
  const cancelRaf = (id) => { cancelled.push(id); };
  const runFrame = () => { const fn = frames.shift(); fn?.(16); };
  let clock = 1000;
  const errors = [];
  const sched = (bindings, opts = {}) => createScheduler(store, bindings, {
    raf, cancelRaf, now: () => clock, onError: (err, b) => errors.push([err.message, b?.name]),
    view: (state, now) => ({ presented: state.presented, view: state.view, now }), ...extra, ...opts,
  });
  return { store, frames, runFrame, cancelled, errors, sched, tick: (ms) => { clock += ms; } };
}

function spy(name, deps, select = (pv) => pv) {
  const seen = [];
  return { name, seen, deps, select, component: { update: (vm) => seen.push(vm), destroy() {} } };
}

test("start renders every binding once, at once, with its view model", () => {
  const { sched } = setup();
  const a = spy("a", (s) => [s.presented], (pv) => ({ n: pv.presented.n, now: pv.now }));
  const b = spy("b", (s) => [s.view]);
  sched([a, b]).start();
  assert.deepEqual(a.seen, [{ n: 1, now: 1000 }]);
  assert.equal(b.seen.length, 1);
});

test("several changes before a frame render once; only bindings whose deps changed run", () => {
  const { store, frames, runFrame, sched } = setup();
  const a = spy("a", (s) => [s.presented]);
  const b = spy("b", (s) => [s.view]);
  sched([a, b]).start();
  store.dispatch({ type: "set", key: "presented", value: { n: 2 } });
  store.dispatch({ type: "set", key: "presented", value: { n: 3 } });
  store.dispatch({ type: "set", key: "other", value: 5 });
  assert.equal(frames.length, 1, "one frame requested");
  assert.equal(a.seen.length, 1, "nothing renders before the frame");
  runFrame();
  assert.equal(a.seen.length, 2);
  assert.equal(a.seen[1].presented.n, 3);
  assert.equal(b.seen.length, 1, "b's deps did not change");
});

test("deps compare element by element by identity; a new array with the same items is no change", () => {
  const { store, runFrame, sched } = setup();
  const a = spy("a", (s) => [s.presented, s.view]);
  sched([a]).start();
  store.dispatch({ type: "set", key: "other", value: 1 });
  runFrame();
  assert.equal(a.seen.length, 1);
  store.dispatch({ type: "set", key: "view", value: { a: 1 } });
  runFrame();
  assert.equal(a.seen.length, 2, "an equal but new object is a change");
});

test("a throwing binding is reported and never stops the others; it retries only when its deps change", () => {
  const { store, runFrame, errors, sched } = setup();
  const bad = { name: "bad", deps: (s) => [s.presented], select: () => { throw new Error("vm broke"); },
    component: { update() {}, destroy() {} } };
  const good = spy("good", (s) => [s.presented]);
  sched([bad, good]).start();
  assert.deepEqual(errors, [["vm broke", "bad"]]);
  assert.equal(good.seen.length, 1);
  store.dispatch({ type: "set", key: "other", value: 2 });
  runFrame();
  assert.equal(errors.length, 1, "same deps: no retry");
  store.dispatch({ type: "set", key: "presented", value: { n: 9 } });
  runFrame();
  assert.equal(errors.length, 2);
  assert.equal(good.seen.length, 2);
});

test("an update that throws, or deps that throw, are reported the same way", () => {
  const { errors, sched } = setup();
  const badUpdate = { name: "u", deps: () => [1], select: () => 1, component: { update() { throw new Error("dom broke"); } } };
  const badDeps = { name: "d", deps: () => { throw new Error("deps broke"); }, select: () => 1, component: { update() {} } };
  sched([badUpdate, badDeps]).start();
  assert.deepEqual(errors, [["dom broke", "u"], ["deps broke", "d"]]);
});

test("invalidate renders without a store change (clock-driven text such as a retry countdown)", () => {
  const { runFrame, frames, sched, tick } = setup();
  const a = spy("a", (s, env) => [Math.floor(env.now / 1000)]);
  const s = sched([a]);
  s.start();
  s.invalidate();
  runFrame();
  assert.equal(a.seen.length, 1, "same second: no render");
  tick(1000);
  s.invalidate();
  s.invalidate();
  assert.equal(frames.length, 1);
  runFrame();
  assert.equal(a.seen.length, 2);
});

test("extras reach both deps and the view model", () => {
  let extras = { cameraModes: [{ id: "sideline" }] };
  const { runFrame, sched } = setup();
  const a = spy("a", (s, env) => [env.extras], (pv) => pv.cameraModes);
  const s = sched([a], { extras: () => extras });
  s.start();
  assert.deepEqual(a.seen, [[{ id: "sideline" }]]);
  extras = { cameraModes: [{ id: "wide" }] };
  s.invalidate();
  runFrame();
  assert.deepEqual(a.seen[1], [{ id: "wide" }]);
});

test("add registers a binding later and returns its remover", () => {
  const { store, runFrame, sched } = setup();
  const s = sched([]);
  s.start();
  const late = spy("late", (st) => [st.presented]);
  const remove = s.add(late);
  runFrame();
  assert.equal(late.seen.length, 1, "a new binding renders on the next frame");
  remove();
  store.dispatch({ type: "set", key: "presented", value: { n: 4 } });
  runFrame();
  assert.equal(late.seen.length, 1);
});

test("stop unsubscribes and cancels a pending frame", () => {
  const { store, frames, cancelled, sched } = setup();
  const a = spy("a", (s) => [s.presented]);
  const s = sched([a]);
  s.start();
  store.dispatch({ type: "set", key: "presented", value: { n: 2 } });
  s.stop();
  assert.deepEqual(cancelled, [1]);
  store.dispatch({ type: "set", key: "presented", value: { n: 3 } });
  assert.equal(frames.length, 1, "no new frame after stop");
});

test("createScheduler needs raf and now", () => {
  const { store } = setup();
  assert.throws(() => createScheduler(store, [], { now: () => 0 }), /raf/);
  assert.throws(() => createScheduler(store, [], { raf: () => 0 }), /now/);
});

test("the default view is the presented view of core/present.js", () => {
  const { store, sched } = setup({ view: undefined });
  const seen = [];
  const binding = { name: "pv", deps: () => [1], select: (pv) => pv, component: { update: (vm) => seen.push(vm) } };
  const reducer = (s) => s;
  const real = createStore(reducer, { presented: null, timeline: { rows: [], n: 0, epoch: null, wpStart: null,
    teams: null, field: null, meta: null, source: null, mode: null, snapshots: [] }, anim: { drawnThrough: 0 },
  version: null, view: {}, prefs: {}, conn: {}, boot: {} });
  createScheduler(real, [binding], { raf: () => 0, now: () => 5 }).start();
  assert.equal(seen[0].now, 5);
  assert.deepEqual(seen[0].tl.rows, []);
  assert.ok(store && sched);
});
