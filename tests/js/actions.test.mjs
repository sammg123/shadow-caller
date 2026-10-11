import assert from "node:assert/strict";
import test from "node:test";

import { ACTION_COPY, TOAST_ERROR_MS, TOAST_MS, createActions } from "../../static/js/core/actions.js";
import { ApiError } from "../../static/js/core/api.js";
import { initialState, reducer } from "../../static/js/core/reducer.js";
import { createStore } from "../../static/js/core/store.js";
import { browserLike, browserTimers, loadTimeline, stateBody, timelineBody } from "./fixtures.mjs";

const TL = loadTimeline();
const EPOCH = TL.body.epoch;
const settle = async (turns = 6) => { for (let i = 0; i < turns; i += 1) await new Promise((r) => setImmediate(r)); };

function fakeTimers() {
  const pending = new Map();
  let id = 0;
  return {
    pending,
    setTimeout: (fn, ms) => { id += 1; pending.set(id, { fn, ms }); return id; },
    clearTimeout: (x) => pending.delete(x),
    fire: (ms) => { for (const [k, t] of [...pending]) if (t.ms === ms) { pending.delete(k); t.fn(); } },
  };
}

/** api.post fake: replies[path] is a { status, body } or a function (body) => reply; throws pass through. */
function fakeApi(replies = {}) {
  const posts = [];
  return {
    posts,
    async post(path, body) {
      posts.push({ path, body });
      const r = replies[path];
      const reply = typeof r === "function" ? await r(body) : r;
      return reply ?? { status: 200, body: stateBody({ timeline: pointer(15) }) };
    },
  };
}

const pointer = (n, epoch = EPOCH) => ({ n, epoch, source: "espn", mode: "replay" });
/** A watch session at `idx` of `total` ESPN plays (restructure-v2.md 9's watch object). */
const watch = (state, idx, total = 183, extra = {}) => ({ state, idx, total, speed: 4, event_id: "401872980", ...extra });
const paused = (idx, total) => ({ watch: watch("paused", idx, total) });
const LIVE = { watch: { state: "stopped", idx: 0, total: 0 }, feed: { on: true, state: "live", event_id: "401872980" } };

/** strict: browser-strict timers and clock (fixtures browserLike); storeErrors: what the store's onError saw. */
function setup({ state = {}, replies = {}, strict = false, ...opts } = {}) {
  const storeErrors = [];
  const store = createStore(reducer, initialState(), { onError: (err) => storeErrors.push(err) });
  store.dispatch({ type: "timeline/loaded", resp: timelineBody(TL.body, { rows: TL.rows(1, 15) }), origin: "poll", now: 0 });
  store.dispatch({ type: "anim/rebuilt", token: store.getState().anim.token, now: 0 });
  store.dispatch({ type: "state/loaded", body: stateBody({ timeline: pointer(15), ...state }), origin: "poll", reqSeq: 0,
    now: 0 });
  const api = fakeApi(replies);
  const kicks = [];
  const sync = { kick: (o) => kicks.push(o ?? {}) };
  const timers = strict ? browserTimers(fakeTimers()) : fakeTimers();
  const persisted = [];
  const now = strict ? browserLike(() => 42) : () => 42;
  const actions = createActions({ store, api, sync, now, timers, persist: (k, v) => persisted.push([k, v]), ...opts });
  return { store, api, kicks, timers, actions, persisted, storeErrors, view: () => store.getState().view };
}

const toastOf = (ctx) => ctx.view().toast;
const paths = (ctx) => ctx.api.posts.map((p) => p.path);
const landed = (body) => ({ status: 200, body: stateBody(body) });

// ---------------------------------------------------------------- restructure-v2.md 5 and 9: playback
test("open: the page asks the server to open the game once; quiet, and the field snaps to where it landed", async () => {
  const ctx = setup({ replies: { "/api/open": landed({ ...paused(0), timeline: pointer(0, "e-open"), message: "Opened." }) } });
  const run = ctx.actions.open();
  assert.deepEqual(ctx.view().playback, { kind: "open", target: null }, "the page knows it is opening");
  await run;
  assert.deepEqual(ctx.api.posts, [{ path: "/api/open", body: {} }]);
  assert.equal(ctx.store.getState().server.watch.state, "paused");
  assert.deepEqual(ctx.store.getState().anim.jump, { epoch: "e-open", n: 0 });
  assert.deepEqual(ctx.view().playback, { kind: null, target: null });
  assert.equal(toastOf(ctx), null, "a success says nothing: the field and the top bar show it");
  assert.deepEqual(ctx.kicks, [{ origin: "action" }]);
});

test("seek, step back, step forward and Go Live post their contract bodies and snap the field", async () => {
  const ctx = setup({ state: paused(40),
    replies: { "/api/watch/back": landed({ ...paused(37), timeline: pointer(37, "e2") }) } });
  await ctx.actions.seek(12);
  await ctx.actions.stepBack();
  await ctx.actions.stepForward();
  await ctx.actions.goLive();
  assert.deepEqual(ctx.api.posts.map((p) => [p.path, p.body]), [["/api/watch/seek", { idx: 12 }],
    ["/api/watch/back", {}], ["/api/watch/forward", {}], ["/api/golive", {}]]);
  const kinds = [];
  const seen = setup({ state: paused(40) });
  seen.store.subscribe((s, prev) => {
    if (s.view.playback !== prev.view.playback && s.view.playback.kind) kinds.push(s.view.playback.kind);
  });
  await seen.actions.stepBack();
  assert.deepEqual(kinds, ["back"]);
});

test("a drive's key (ui/drive-chart.js reviewAt) jumps the game to that drive's first play: its row is the plays applied", async () => {
  const ctx = setup({ state: paused(104) });
  await ctx.actions.reviewAt(14);
  await ctx.actions.reviewAt("14");
  assert.deepEqual(ctx.api.posts, [{ path: "/api/watch/seek", body: { idx: 14 } }]);
});

test("Reset is a seek to kickoff (restructure-v2.md 5); at kickoff it sends nothing", async () => {
  const ctx = setup({ state: paused(40) });
  await ctx.actions.reset();
  assert.deepEqual(ctx.api.posts, [{ path: "/api/watch/seek", body: { idx: 0 } }]);
  const atKickoff = setup({ state: paused(0) });
  await atKickoff.actions.reset();
  assert.deepEqual(atKickoff.api.posts, []);
});

test("the top bar's ends are guarded: no step back at kickoff, no step forward at the end or live, no Go Live twice", async () => {
  const kickoff = setup({ state: paused(0) });
  await kickoff.actions.stepBack();
  const end = setup({ state: { watch: watch("done", 183) } });
  await end.actions.stepForward();
  await end.actions.goLive();
  const live = setup({ state: LIVE });
  await live.actions.stepForward();
  await live.actions.goLive();
  await live.actions.stepBack();
  assert.deepEqual([paths(kickoff), paths(end), paths(live)], [[], [], ["/api/watch/back"]]);
});

test("an error session (the app restarted mid-watch) is never stuck: Reset, Go Live and the steps get sent", async () => {
  const restarted = { watch: watch("error", 0, 0, { error: "Restarted.", game: { status: "post", detail: "Final" } }) };
  for (const [press, path, body] of [["reset", "/api/watch/seek", { idx: 0 }], ["goLive", "/api/golive", {}],
    ["stepBack", "/api/watch/back", {}], ["stepForward", "/api/watch/forward", {}]]) {
    const ctx = setup({ state: restarted });
    await ctx.actions[press]();
    assert.deepEqual(ctx.api.posts, [{ path, body }], press);
  }
  const stopped = setup({ state: { watch: watch("error", 40, 183, { error: "3 plays in a row couldn't be applied." }) } });
  await stopped.actions.seek(40);
  assert.deepEqual(paths(stopped), ["/api/watch/seek"], "a seek to where it stopped still rebuilds it");
  for (const [press, path] of [["goLive", "/api/golive"], ["stepForward", "/api/watch/forward"]]) {
    const end = setup({ state: { watch: watch("error", 183, 183, { error: "x", game: { status: "post" } }) } });
    await end.actions[press]();
    assert.deepEqual(paths(end), [path], `${press} at its end: the server says where the end really is`);
  }
});

test("seek takes a whole play count from 0 to the total; anything else, or where it already is, sends nothing", async () => {
  const ctx = setup({ state: paused(40, 183) });
  for (const bad of [-1, 184, 2.5, "3", null, undefined, Number.NaN, 40]) await ctx.actions.seek(bad);
  assert.deepEqual(ctx.api.posts, []);
  await ctx.actions.seek(183);
  assert.deepEqual(ctx.api.posts, [{ path: "/api/watch/seek", body: { idx: 183 } }]);
  const playing = setup({ state: { watch: watch("playing", 40) } });
  await playing.actions.seek(40);
  assert.deepEqual(paths(playing), ["/api/watch/seek"], "playing, a seek to here still holds it there, paused");
});

test("rapid presses never stack: while one request is in flight the newest press waits and the rest are dropped", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const ctx = setup({ state: paused(40), replies: { "/api/watch/seek": async (body) => {
    if (body.idx === 10) await gate;
    return landed({ ...paused(body.idx), timeline: pointer(body.idx, `e${body.idx}`) });
  } } });
  const first = ctx.actions.seek(10);
  await settle();
  const presses = [ctx.actions.seek(20), ctx.actions.stepForward(), ctx.actions.seek(30)];
  assert.deepEqual(ctx.view().playback, { kind: "seek", target: 30 }, "the bar can show the newest target");
  await settle();
  assert.deepEqual(ctx.api.posts.map((p) => p.body), [{ idx: 10 }], "nothing more while the first is in flight");
  release();
  await Promise.all([first, ...presses]);
  assert.deepEqual(ctx.api.posts.map((p) => p.body), [{ idx: 10 }, { idx: 30 }]);
  assert.deepEqual(ctx.view().playback, { kind: null, target: null });
  assert.deepEqual(ctx.store.getState().anim.jump, { epoch: "e30", n: 30 });
});

test("a refused jump (409, 503) toasts the server's own words in red and moves nothing", async () => {
  const ctx = setup({ state: paused(40), replies: {
    "/api/watch/back": { status: 409, body: { error: "Already at kickoff." } },
    "/api/golive": { status: 503, body: stateBody({ ...paused(40), timeline: pointer(15), error: "ESPN can't be reached." }) },
  } });
  const before = ctx.store.getState().anim;
  await ctx.actions.stepBack();
  assert.deepEqual(toastOf(ctx), { id: 1, text: "Already at kickoff.", err: true });
  await ctx.actions.goLive();
  assert.deepEqual(toastOf(ctx), { id: 2, text: "ESPN can't be reached.", err: true });
  assert.equal(ctx.store.getState().anim.jump, before.jump, "no jump: the field stays where it is");
  assert.equal(ctx.kicks.length, 2, "each still kicks a tick, so the page catches up with the server");
});

test("play and pause follow the watch: Space pauses a playing game and plays a paused one; nothing else", async () => {
  const playing = setup({ state: { watch: watch("playing", 40) },
    replies: { "/api/watch/pause": landed({ watch: watch("paused", 40), timeline: pointer(15) }) } });
  await playing.actions.togglePlay();
  assert.equal(playing.store.getState().server.watch.state, "paused", "the response's watch is the new truth");
  await playing.actions.togglePlay();
  assert.deepEqual(paths(playing), ["/api/watch/pause", "/api/watch/resume"]);
  for (const state of [{ watch: watch("done", 183) }, LIVE, {}]) {
    const ctx = setup({ state });
    await ctx.actions.togglePlay();
    assert.deepEqual(paths(ctx), [], JSON.stringify(state));
  }
});

test("speed: 1x 2x 4x 10x are kept as the choice and sent to the server in any state; others are ignored", async () => {
  const ctx = setup({ state: { watch: watch("done", 183) } });
  await ctx.actions.setSpeed(10);
  await ctx.actions.setSpeed(3);
  await ctx.actions.setSpeed("4");
  assert.deepEqual(ctx.api.posts, [{ path: "/api/watch/speed", body: { speed: 10 } }]);
  assert.equal(ctx.store.getState().prefs.watchSpeed, 10);
});

test("POSTs go one at a time, in order: a speed sent during a seek waits for it", async () => {
  const order = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const ctx = setup({ state: paused(40), replies: {
    "/api/watch/seek": async () => { order.push("seek:start"); await gate; order.push("seek:end"); return landed(paused(9)); },
    "/api/watch/speed": async () => { order.push("speed"); return landed(paused(9)); } } });
  const a = ctx.actions.seek(9);
  const b = ctx.actions.setSpeed(2);
  await settle();
  assert.deepEqual(order, ["seek:start"]);
  release();
  await Promise.all([a, b]);
  assert.deepEqual(order, ["seek:start", "seek:end", "speed"]);
});

test("a network failure says the server can't be reached and marks the connection", async () => {
  const ctx = setup({ state: paused(40),
    replies: { "/api/watch/seek": () => { throw new ApiError("network", { path: "/api/watch/seek" }); } } });
  await ctx.actions.seek(3);
  assert.deepEqual(toastOf(ctx), { id: 1, text: ACTION_COPY.offline, err: true });
  assert.equal(ctx.store.getState().conn.failures, 1);
  assert.equal(ctx.store.getState().req.inflightActions, 0);
  assert.deepEqual(ctx.view().playback, { kind: null, target: null }, "the lane frees itself");
});

test("a failure after a successful POST surfaces as that error, never as a network failure", async () => {
  const ctx = setup({ state: paused(40), replies: { "/api/watch/seek": landed({ ...paused(3), timeline: pointer(3) }) } });
  const real = ctx.store.dispatch;
  ctx.store.dispatch = (event) => {
    real(event);
    if (event.type === "state/loaded" && event.origin === "action") throw new Error("listener bug");
  };
  await assert.rejects(ctx.actions.seek(3), /listener bug/);
  assert.notEqual(toastOf(ctx)?.text, ACTION_COPY.offline);
  assert.equal(ctx.store.getState().conn.failures, 0);
  assert.equal(ctx.store.getState().req.inflightActions, 0, "the request bookkeeping still closes");
  assert.deepEqual(ctx.view().playback, { kind: null, target: null }, "the lane frees itself");
});

// ---------------------------------------------------------------- view
test("cycleCamera toggles Wide and Blimp (the engine's modes) and remembers the choice", () => {
  const modes = [{ id: "wide", label: "Wide" }, { id: "blimp", label: "Blimp" }];
  const ctx = setup({ cameraModes: () => modes, defaultCamera: () => "wide" });
  const seen = [1, 2, 3].map(() => { ctx.actions.cycleCamera(); return ctx.view().camera; });
  assert.deepEqual(seen, ["blimp", "wide", "blimp"]);
  assert.deepEqual(ctx.persisted.at(-1), ["sc:camera", "blimp"]);
  ctx.actions.setCamera("wide");
  ctx.actions.setCamera("");
  assert.equal(ctx.view().camera, "wide");
  const none = setup();
  none.actions.cycleCamera();
  assert.equal(none.view().camera, null);
});

test("the settings menu, hover, room lights and Retry now", () => {
  const ctx = setup();
  ctx.actions.toggleSettings();
  ctx.actions.hoverLeaf("pa_short");
  ctx.actions.setAmbient("dark");
  ctx.actions.setAmbient("purple");
  ctx.actions.retryNow();
  assert.deepEqual([ctx.view().settingsOpen, ctx.view().hoverLeaf], [true, "pa_short"]);
  assert.equal(ctx.store.getState().prefs.ambient, "dark");
  assert.deepEqual(ctx.persisted, [["sc:ambient", "dark"]]);
  ctx.actions.closeSettings();
  ctx.actions.hoverLeaf(undefined);
  assert.deepEqual([ctx.view().settingsOpen, ctx.view().hoverLeaf], [false, null]);
  assert.deepEqual(ctx.kicks, [{}]);
});

test("a toast hides after its time (2.6 s, an error 8 s) unless a newer one replaced it (FI 4.5, G5-13)", async () => {
  const ctx = setup({ state: paused(40), replies: { "/api/watch/seek": { status: 409, body: { error: "Not now." } } } });
  await ctx.actions.seek(1);
  await ctx.actions.seek(2);
  assert.equal(TOAST_MS, 2600);
  assert.equal(toastOf(ctx).id, 2);
  const [first] = [...ctx.timers.pending.values()];
  first.fn();
  assert.equal(toastOf(ctx).id, 2, "the older timer leaves the newer toast");
  ctx.timers.fire(TOAST_MS);
  assert.equal(toastOf(ctx)?.id, 2, "an error outlasts an info toast");
  ctx.timers.fire(TOAST_ERROR_MS);
  assert.equal(toastOf(ctx), null);
});

test("G5-13: an error toast holds 8 s; the pointer or focus on it holds it, leaving restarts it, Dismiss ends it", async () => {
  const ctx = setup({ state: paused(40), replies: { "/api/watch/seek": { status: 409, body: { error: "Not now." } } } });
  assert.equal(TOAST_ERROR_MS, 8000);
  await ctx.actions.seek(1);
  const { id } = toastOf(ctx);
  ctx.actions.holdToast(id);
  assert.equal(ctx.timers.pending.size, 0, "held: no timer");
  ctx.actions.releaseToast(id);
  ctx.actions.releaseToast(id);
  assert.equal(ctx.timers.pending.size, 1, "released once: one fresh 8 s");
  ctx.timers.fire(TOAST_ERROR_MS);
  assert.equal(toastOf(ctx), null);
  await ctx.actions.seek(2);
  ctx.actions.dismissToast();
  assert.equal(toastOf(ctx), null, "Dismiss (or Esc) ends it at once");
  for (const fn of ["dismissToast", "holdToast", "releaseToast"]) ctx.actions[fn](99);
  assert.equal(toastOf(ctx), null, "an old id changes nothing");
});

test("toasts and request stamps call the timers and the clock bare (Chromium throws 'Illegal invocation' otherwise)", async () => {
  const ctx = setup({ strict: true, state: paused(40),
    replies: { "/api/watch/seek": { status: 409, body: { error: "Not now." } } } });
  await ctx.actions.seek(5);
  assert.deepEqual(toastOf(ctx), { id: 1, text: "Not now.", err: true });
  assert.equal(ctx.timers.pending.size, 1, "the hide timer is set");
  ctx.timers.fire(TOAST_ERROR_MS);
  assert.equal(toastOf(ctx), null);
});

test("createActions validates its injected clock and timers", () => {
  const store = createStore(reducer, initialState());
  assert.throws(() => createActions({ store, api: fakeApi(), sync: null, now: 3 }), TypeError);
  assert.throws(() => createActions({ store, api: fakeApi(), sync: null, now: () => 1, timers: {} }), TypeError);
});

test("the page never sends user input into the game: no entry, flag, retag, undo or reset intents exist", () => {
  const { actions } = setup();
  for (const gone of ["tap", "logPlay", "applyFlag", "openFlag", "retag", "undo", "commitStrip", "runShorthand",
    "feedToggle", "replay", "watchStart", "watchStop", "review", "exitReview", "toggleBooth", "toggleScorecard"]) {
    assert.equal(actions[gone], undefined, gone);
  }
});
