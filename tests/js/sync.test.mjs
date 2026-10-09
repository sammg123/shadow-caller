import assert from "node:assert/strict";
import test from "node:test";

import { ApiError } from "../../static/js/core/api.js";
import { initialState, reducer } from "../../static/js/core/reducer.js";
import { createStore } from "../../static/js/core/store.js";
import { createSync } from "../../static/js/core/sync.js";
import { browserLike, browserTimers, loadTimeline, stateBody, stubRows, timelineBody } from "./fixtures.mjs";

const TL = loadTimeline();
const EPOCH = TL.body.epoch;
const settle = async (turns = 6) => { for (let i = 0; i < turns; i += 1) await new Promise((r) => setImmediate(r)); };

function fakeTimers() {
  let clock = 0;
  let nextId = 1;
  const pending = new Map();
  return {
    now: () => clock,
    setTimeout: (fn, ms) => { const id = nextId++; pending.set(id, { fn, at: clock + ms, ms }); return id; },
    clearTimeout: (id) => { pending.delete(id); },
    delays: () => [...pending.values()].map((t) => t.ms),
    async next() {
      const [id, t] = [...pending.entries()].sort((a, b) => a[1].at - b[1].at)[0] ?? [];
      if (!id) throw new Error("no timer pending");
      pending.delete(id);
      clock = t.at;
      t.fn();
      await settle();
    },
  };
}

/** A server stub: the test edits `srv` between ticks; every call is recorded. */
function fakeServer() {
  const srv = { version: 1, epoch: EPOCH, n: 15, feedOn: false, watch: { state: "idle" }, rows: stubRows(1, 15), fail: new Set(), message: "Hi" };
  const calls = [];
  const maybeFail = (name) => { if (srv.fail.has(name)) throw new ApiError("network", { path: `/api/${name}` }); };
  const api = {
    async getVersion() {
      calls.push("version");
      maybeFail("version");
      return { version: srv.version, epoch: srv.epoch, timeline_n: srv.n, feed: { on: srv.feedOn, state: srv.feedOn ? "live" : "off", last_poll: "1" }, watch: srv.watch };
    },
    async getState() {
      calls.push("state");
      maybeFail("state");
      return stateBody({ version: srv.version, message: srv.message, timeline: { n: srv.n, epoch: srv.epoch, source: "espn", mode: "replay" },
        feed: { on: srv.feedOn, state: srv.feedOn ? "live" : "off" } });
    },
    async getTimeline(since, epoch) {
      calls.push(`timeline:${since}:${epoch}`);
      maybeFail("timeline");
      if (srv.timelineBody) return srv.timelineBody(since, epoch);
      const fresh = since === 0 || epoch !== srv.epoch;
      const rows = srv.rows.filter((r) => r.seq > (fresh ? 0 : since));
      return timelineBody(TL.body, { epoch: srv.epoch, rows, since: fresh ? 0 : since, n: srv.n, reset: fresh });
    },
  };
  return { srv, api, calls };
}

/**
 * strict: browser-strict timers and clock (fixtures browserLike). storeErrors: the store reports listener errors
 * there. wrapStore: replace the store sync sees (to make its dispatch throw). errors: what sync's onError saw.
 */
function setup({ hidden = false, strict = false, wrapStore = (s) => s } = {}) {
  const base = fakeTimers();
  const timers = strict ? browserTimers(base) : base;
  const server = fakeServer();
  const storeErrors = [];
  const store = createStore(reducer, initialState(), { onError: (err) => storeErrors.push(err) });
  const listeners = {};
  const doc = { hidden, addEventListener: (t, fn) => { listeners[t] = fn; }, removeEventListener: (t) => { delete listeners[t]; } };
  const errors = [];
  const sync = createSync({ api: server.api, store: wrapStore(store), now: strict ? browserLike(base.now) : base.now,
    timers, doc, onError: (err) => errors.push(err) });
  return { timers, ...server, store, sync, doc, listeners, errors, storeErrors };
}

/** The store as sync sees it, except that dispatching `type` throws after the event is applied (a listener's bug). */
const throwingOn = (type) => (store) => ({ ...store, dispatch(event) {
  store.dispatch(event);
  if (event.type === type) throw new Error(`listener bug on ${type}`);
} });

/** Booted and the conductor's rebuild confirmed, so states can present. */
async function booted(opts) {
  const ctx = setup(opts);
  await ctx.sync.start();
  const { anim } = ctx.store.getState();
  ctx.store.dispatch({ type: "anim/rebuilt", token: anim.token, now: 0 });
  ctx.calls.length = 0;
  return ctx;
}

test("start: boot fetches state, timeline and version in parallel, then polls every second", async () => {
  const { sync, store, calls, timers } = setup();
  await sync.start();
  assert.deepEqual([...calls].sort(), ["state", "timeline:0:null", "version"]);
  const s = store.getState();
  assert.equal(s.boot.phase, "ready");
  assert.equal(s.timeline.n, 15);
  assert.equal(s.version.version, 1);
  assert.equal(s.server.version, 1);
  assert.deepEqual(timers.delays(), [1000]);
});

test("a failed boot retries with backoff until it loads; Retry now runs at once (#120, G11)", async () => {
  const { sync, store, srv, timers, calls } = setup();
  srv.fail.add("state");
  const started = sync.start();
  await settle();
  assert.equal(store.getState().boot.phase, "failed");
  assert.equal(store.getState().conn.retryAt, 1000);
  assert.deepEqual(timers.delays(), [1000]);
  await timers.next();
  assert.equal(store.getState().boot.attempts, 2);
  assert.deepEqual(timers.delays(), [2000], "the second wait doubles");
  calls.length = 0;
  srv.fail.clear();
  sync.kick();
  await started;
  assert.equal(store.getState().boot.phase, "ready");
  assert.ok(calls.includes("state"));
  assert.deepEqual(timers.delays(), [1000], "the boot retry timer was replaced by the poll");
});

test("an old server without /api/timeline still boots", async () => {
  const { sync, store, srv } = setup();
  srv.timelineBody = () => { throw new ApiError("http", { status: 404, path: "/api/timeline" }); };
  await sync.start();
  assert.equal(store.getState().boot.phase, "ready");
  assert.equal(store.getState().timeline.epoch, null);
});

test("a tick with nothing new fetches only the version (#3)", async () => {
  const { timers, calls } = await booted();
  await timers.next();
  assert.deepEqual(calls, ["version"]);
});

test("a version change refetches the state; a bigger timeline_n appends since n (DC E4)", async () => {
  const { timers, calls, srv, store } = await booted();
  srv.version = 2;
  srv.n = 17;
  srv.rows = stubRows(1, 17);
  await timers.next();
  assert.deepEqual([...calls].sort(), ["state", `timeline:15:${EPOCH}`, "version"]);
  assert.equal(store.getState().timeline.n, 17);
  assert.deepEqual(store.getState().anim.queue.map((q) => q.seq), [16, 17]);
  assert.equal(store.getState().server.version, 2);
  assert.equal(store.getState().presented.version, 1, "the HUD waits for rows 16 and 17 to be drawn");
});

test("a new epoch refetches since 0 and rebuilds", async () => {
  const { timers, calls, srv, store } = await booted();
  srv.epoch = "fresh-epoch";
  srv.version = 1;
  srv.n = 3;
  srv.rows = stubRows(1, 3);
  await timers.next();
  assert.ok(calls.includes("timeline:0:null"));
  assert.equal(store.getState().timeline.epoch, "fresh-epoch");
  assert.equal(store.getState().anim.rebuilding, true);
});

test("a gap in an append is healed by an immediate since=0 refetch in the same tick", async () => {
  const { timers, calls, srv, store } = await booted();
  srv.n = 18;
  srv.rows = stubRows(1, 18);
  let first = true;
  srv.timelineBody = (since, epoch) => {
    if (first && since !== 0) { first = false; return timelineBody(TL.body, { rows: stubRows(17, 18), since: 16, reset: false, n: 18 }); }
    return timelineBody(TL.body, { epoch: srv.epoch, rows: stubRows(1, 18), n: 18 });
  };
  await timers.next();
  assert.deepEqual(calls.filter((c) => c.startsWith("timeline")), [`timeline:15:${EPOCH}`, "timeline:0:null"]);
  assert.equal(store.getState().timeline.n, 18);
  assert.equal(store.getState().timeline.needsFull, false);
});

test("a malformed timeline body counts as a failure and is not merged", async () => {
  const { timers, srv, store } = await booted();
  srv.n = 16;
  srv.timelineBody = () => ({ epoch: EPOCH, n: "x", rows: [] });
  await timers.next();
  assert.equal(store.getState().timeline.n, 15);
  assert.equal(store.getState().conn.failures, 1);
});

test("no state fetch while an action is in flight (3.2)", async () => {
  const { timers, calls, srv, store } = await booted();
  store.dispatch({ type: "req/action-start", reqSeq: 1 });
  srv.version = 5;
  await timers.next();
  assert.deepEqual(calls, ["version"], "the action's response is about to replace the state");
});

test("a poll body older than an action applied meanwhile is dropped (3.2)", async () => {
  const { timers, api, srv, store } = await booted();
  let release;
  const gate = new Promise((r) => { release = r; });
  srv.version = 6;
  api.getState = async () => { await gate; return stateBody({ version: 6, timeline: { n: 15, epoch: EPOCH, source: "espn", mode: "replay" } }); };
  const tick = timers.next();
  await settle();
  store.dispatch({ type: "req/action-start", reqSeq: 2 });
  store.dispatch({ type: "state/loaded", body: stateBody({ version: 7, timeline: { n: 15, epoch: EPOCH, source: "espn", mode: "replay" } }),
    origin: "action", reqSeq: 2, now: 1 });
  store.dispatch({ type: "req/action-end", reqSeq: 2 });
  release();
  await tick;
  await settle();
  assert.equal(store.getState().server.version, 7, "the older poll body was dropped");
});

test("failures back off 1, 2, 4 s and mark the connection offline after 3, then recover (G11)", async () => {
  const { timers, srv, store } = await booted();
  srv.fail.add("version");
  await timers.next();
  assert.equal(store.getState().conn.failures, 1);
  assert.deepEqual(timers.delays(), [1000]);
  await timers.next();
  assert.deepEqual(timers.delays(), [2000]);
  await timers.next();
  assert.deepEqual(timers.delays(), [4000]);
  assert.equal(store.getState().conn.failures, 3);
  srv.fail.clear();
  await timers.next();
  assert.equal(store.getState().conn.failures, 0);
  assert.deepEqual(timers.delays(), [1000]);
});

test("a watch that plays polls every 250 ms; a hidden tab every 5 s and wakes on visibility (DC E4)", async () => {
  const { timers, srv, doc, listeners, calls } = await booted();
  srv.watch = { state: "playing", next_at: 999999 };
  await timers.next();
  assert.deepEqual(timers.delays(), [250]);
  doc.hidden = true;
  await timers.next();
  assert.deepEqual(timers.delays(), [5000]);
  doc.hidden = false;
  calls.length = 0;
  listeners.visibilitychange();
  await settle();
  assert.deepEqual(calls, ["version"], "becoming visible ticks at once");
  assert.deepEqual(timers.delays(), [250]);
});

test("kick runs a tick now and tags the rows it brings with the action origin", async () => {
  const { sync, srv, store, timers } = await booted();
  srv.n = 16;
  srv.rows = stubRows(1, 16);
  sync.kick({ origin: "action" });
  await settle();
  assert.deepEqual(store.getState().anim.queue.map((q) => [q.seq, q.origin]), [[16, "action"]]);
  assert.deepEqual(timers.delays(), [1000], "exactly one timer pending");
});

test("kicks during a running tick add exactly one more tick right after it", async () => {
  const { sync, api, timers, calls } = await booted();
  let release;
  const gate = new Promise((r) => { release = r; });
  const plain = api.getVersion;
  api.getVersion = async () => { await gate; return plain(); };
  const tick = timers.next();
  await settle();
  sync.kick();
  sync.kick();
  api.getVersion = plain;
  release();
  await tick;
  await settle();
  assert.equal(calls.filter((c) => c === "version").length, 2);
  assert.deepEqual(timers.delays(), [1000], "then back to one timer");
});

test("hidden or reduced-motion loads queue instant rows", async () => {
  const { sync, srv, store, doc } = await booted();
  doc.hidden = true;
  srv.n = 16;
  srv.rows = stubRows(1, 16);
  sync.kick();
  await settle();
  assert.deepEqual(store.getState().anim.queue.map((q) => q.instant), [true]);
});

test("stop cancels the loop and detaches the visibility listener", async () => {
  const { sync, timers, listeners, calls } = await booted();
  sync.stop();
  assert.deepEqual(timers.delays(), []);
  assert.equal(listeners.visibilitychange, undefined);
  sync.kick();
  await settle();
  assert.deepEqual(calls, []);
});

test("each tick ends with a tick event so the lag valve can fire", async () => {
  const { timers, srv, store } = await booted();
  srv.version = 2;
  srv.n = 16;
  srv.rows = stubRows(1, 16);
  await timers.next();
  assert.equal(store.getState().presented.version, 1);
  srv.n = 16;
  for (let i = 0; i < 5; i += 1) await timers.next();
  assert.equal(store.getState().presented.version, 2, "4 s later the valve shows the state anyway");
});

test("boot, poll and stop call the timers and the clock bare (Chromium throws 'Illegal invocation' otherwise)", { timeout: 5000 }, async () => {
  const { sync, store, timers, calls } = setup({ strict: true });
  sync.start();
  await settle();
  assert.equal(store.getState().boot.phase, "ready");
  assert.deepEqual(timers.delays(), [1000]);
  calls.length = 0;
  await timers.next();
  assert.deepEqual(calls, ["version"]);
  assert.deepEqual(timers.delays(), [1000], "still polling");
  sync.stop();
  assert.deepEqual(timers.delays(), [], "stop cleared the timer");
});

test("a store listener's bug at boot is reported, never 'Can't reach the app server' (#120)", { timeout: 5000 }, async () => {
  const { sync, store, calls, timers, storeErrors } = setup();
  store.subscribe((s, prev) => { if (s.server !== prev.server) throw new Error("component bug"); });
  sync.start();
  await settle();
  assert.equal(store.getState().boot.phase, "ready");
  assert.equal(store.getState().conn.failures, 0);
  assert.deepEqual([...calls].sort(), ["state", "timeline:0:null", "version"], "one boot round, no retries");
  assert.deepEqual(storeErrors.map((e) => e.message), ["component bug"]);
  assert.deepEqual(timers.delays(), [1000]);
});

test("a dispatch that throws while applying the boot data is reported, and polling starts anyway", { timeout: 5000 }, async () => {
  const { sync, timers, errors } = setup({ wrapStore: throwingOn("state/loaded") });
  sync.start();
  await settle();
  assert.deepEqual(errors.map((e) => e.message), ["listener bug on state/loaded"]);
  assert.deepEqual(timers.delays(), [1000], "the poll loop runs and refetches what is missing");
});

test("a dispatch that throws while reporting a failure never stops the poll loop", { timeout: 5000 }, async () => {
  const ctx = setup({ wrapStore: throwingOn("conn/failed") });
  ctx.sync.start();
  await settle();
  ctx.srv.fail.add("version");
  await ctx.timers.next();
  assert.equal(ctx.store.getState().conn.failures, 1);
  assert.deepEqual(ctx.errors.map((e) => e.message), ["listener bug on conn/failed"]);
  assert.deepEqual(ctx.timers.delays(), [1000], "the next tick is scheduled");
  ctx.srv.fail.clear();
  ctx.calls.length = 0;
  await ctx.timers.next();
  assert.deepEqual(ctx.calls, ["version"]);
  assert.equal(ctx.store.getState().conn.failures, 0, "and recovers");
});

test("a bug inside a tick is reported as a bug, not as a connection failure", { timeout: 5000 }, async () => {
  const ctx = setup({ wrapStore: throwingOn("version/loaded") });
  ctx.sync.start();
  await settle();
  assert.deepEqual(ctx.errors.map((e) => e.message), ["listener bug on version/loaded"], "boot reported it");
  assert.deepEqual(ctx.timers.delays(), [1000], "and polls anyway");
  ctx.errors.length = 0;
  await ctx.timers.next();
  assert.equal(ctx.store.getState().conn.failures, 0);
  assert.deepEqual(ctx.errors.map((e) => e.message), ["listener bug on version/loaded"]);
  assert.deepEqual(ctx.timers.delays(), [1000]);
});

test("createSync validates its injected functions", () => {
  const store = createStore(reducer, initialState());
  const api = fakeServer().api;
  assert.throws(() => createSync({ api, store, now: 5, timers: fakeTimers() }), TypeError);
  assert.throws(() => createSync({ api, store, now: () => 0, timers: {} }), TypeError);
});
