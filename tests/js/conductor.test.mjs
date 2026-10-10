import assert from "node:assert/strict";
import test from "node:test";

import { APP_ATTRS, appAttrs, createConductor } from "../../static/js/core/conductor.js";
import { initialState, reducer } from "../../static/js/core/reducer.js";
import { createStore } from "../../static/js/core/store.js";
import { buildDrawing } from "../../static/js/field/paths.js";
import { normalDurationMs } from "../../static/js/field/timing.js";
import { browserLike, browserTimers, loadState, loadTimeline, stateBody, stubRows, timelineBody } from "./fixtures.mjs";

const TL = loadTimeline();
const EPOCH = TL.body.epoch;
const settle = async (turns = 4) => { for (let i = 0; i < turns; i += 1) await new Promise((r) => setImmediate(r)); };
const pointer = (n) => ({ n, epoch: EPOCH, source: "espn", mode: "replay" });

function fakeEngine(kind = "webgl") {
  const calls = [];
  const handlers = {};
  const plays = [];
  const record = (name) => (...args) => { calls.push([name, ...args]); };
  return {
    kind, calls, plays,
    on(ev, fn) { (handlers[ev] ??= []).push(fn); return () => { handlers[ev] = handlers[ev].filter((f) => f !== fn); }; },
    emit(ev, payload) { for (const fn of handlers[ev] ?? []) fn(payload); },
    listeners: (ev) => (handlers[ev] ?? []).length,
    setGameFrame: record("setGameFrame"), showSituation: record("showSituation"), showGhosts: record("showGhosts"),
    clearGhosts: record("clearGhosts"), highlightGhost: record("highlightGhost"), markVerdict: record("markVerdict"),
    setCamera: record("setCamera"), resize() {}, setVisible() {}, setReducedMotion() {}, debugState: () => ({}), dispose() {},
    cameraModes: () => [{ id: "sideline", label: "Sideline" }],
    drawRowsInstant: (rows) => calls.push(["drawRowsInstant", rows.map((r) => r.seq)]),
    refreshLabels: (rows) => calls.push(["refreshLabels", rows.map((r) => r.seq)]),
    showReview: (row, ghosts) => calls.push(["showReview", row ? row.seq : null, ghosts]),
    finishNow() { calls.push(["finishNow"]); for (const p of plays.splice(0)) p.resolve(); },
    playRow(row, opts) {
      calls.push(["playRow", row.seq, opts]);
      if (opts.durationMs === 0) return Promise.resolve({ seq: row.seq, token: opts.token, completed: true });
      return new Promise((resolve) => plays.push({ row, opts, resolve: () => resolve({ seq: row.seq, token: opts.token, completed: true }) }));
    },
  };
}

function fakeTimers() {
  let clock = 1000;
  const pending = new Map();
  let id = 0;
  return {
    now: () => clock,
    advance(ms) { clock += ms; },
    setTimeout: (fn, ms) => { id += 1; pending.set(id, { fn, at: clock + ms }); return id; },
    clearTimeout: (x) => pending.delete(x),
    runDue() { for (const [k, t] of [...pending]) if (t.at <= clock) { pending.delete(k); t.fn(); } },
  };
}

function setup({ look = {}, createFallback = null } = {}) {
  const store = createStore(reducer, initialState());
  const engine = fakeEngine();
  const timers = fakeTimers();
  const attrs = {};
  const app = { setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; } };
  const conductor = createConductor({ store, getEngine: () => engine, look, now: timers.now, setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout, app, createFallback });
  conductor.start();
  const names = () => engine.calls.map((c) => c[0]);
  return { store, engine, timers, attrs, conductor, names };
}

const resetTo = (ctx, rows, epoch = EPOCH) => ctx.store.dispatch({ type: "timeline/loaded",
  resp: timelineBody(TL.body, { rows, epoch }), origin: "poll", hidden: false, reducedMotion: false, now: ctx.timers.now() });
const appendRows = (ctx, rows, since, extra = {}) => ctx.store.dispatch({ type: "timeline/loaded",
  resp: timelineBody(TL.body, { rows, since, reset: false }), origin: "poll", hidden: false, reducedMotion: false, now: ctx.timers.now(), ...extra });

test("a reset draws every row instantly once, then confirms the rebuild (3.5, 3.7)", () => {
  const ctx = setup();
  resetTo(ctx, TL.rows(1, 15));
  assert.deepEqual(ctx.names().slice(0, 3), ["finishNow", "setGameFrame", "drawRowsInstant"]);
  const frame = ctx.engine.calls.find((c) => c[0] === "setGameFrame");
  assert.deepEqual(frame.slice(1), [TL.body.field, TL.body.teams, TL.body.team_order]);
  assert.deepEqual(ctx.engine.calls.find((c) => c[0] === "drawRowsInstant")[1], Array.from({ length: 15 }, (_, i) => i + 1));
  assert.equal(ctx.store.getState().anim.rebuilding, false);
  assert.equal(ctx.names().filter((n) => n === "setGameFrame").length, 1);
});

test("rows play one at a time in seq order; instant rows first, then the animated three (DC E4)", async () => {
  const ctx = setup();
  resetTo(ctx, stubRows(1, 99));
  appendRows(ctx, TL.rows(100, 104), 99);
  await settle();
  const played = () => ctx.engine.calls.filter((c) => c[0] === "playRow").map((c) => [c[1], c[2].durationMs > 0]);
  assert.deepEqual(played(), [[100, false], [101, false], [102, true]]);
  assert.equal(ctx.store.getState().anim.playing.seq, 102);
  const expected = normalDurationMs(buildDrawing(TL.row(102)));
  assert.equal(ctx.engine.calls.find((c) => c[0] === "playRow" && c[1] === 102)[2].durationMs, Math.round(expected));
  for (const seq of [102, 103, 104]) {
    assert.equal(ctx.engine.plays.length, 1, `one play at a time (${seq})`);
    ctx.engine.plays.shift().resolve();
    await settle();
  }
  assert.equal(ctx.store.getState().anim.drawnThrough, 104);
  assert.deepEqual(played().map((p) => p[0]), [100, 101, 102, 103, 104]);
});

test("a playing watch squeezes the animation into 0.8 of the time to the next play (DC E4)", async () => {
  const ctx = setup();
  resetTo(ctx, stubRows(1, 101));
  ctx.store.dispatch({ type: "version/loaded", body: { version: 1, epoch: EPOCH, timeline_n: 102,
    watch: { state: "playing", next_at: ctx.timers.now() + 1000 } }, now: ctx.timers.now() });
  appendRows(ctx, TL.rows(102, 102), 101);
  await settle();
  assert.equal(ctx.engine.calls.find((c) => c[0] === "playRow")[2].durationMs, 800);
});

test("the HUD waits for the play to be drawn, then shows the new state (3.4)", async () => {
  const ctx = setup();
  resetTo(ctx, stubRows(1, 101));
  ctx.store.dispatch({ type: "state/loaded", body: stateBody({ version: 1, timeline: pointer(101) }), origin: "poll", reqSeq: 0, now: 1000 });
  appendRows(ctx, TL.rows(102, 102), 101);
  ctx.store.dispatch({ type: "state/loaded", body: stateBody({ version: 2, timeline: pointer(102) }), origin: "poll", reqSeq: 0, now: 1000 });
  await settle();
  assert.equal(ctx.store.getState().presented.version, 1);
  ctx.engine.plays.shift().resolve();
  await settle();
  assert.equal(ctx.store.getState().presented.version, 2);
});

test("the 4 s valve hurries the engine and the queue drains instantly (3.4)", async () => {
  const ctx = setup();
  resetTo(ctx, stubRows(1, 101));
  appendRows(ctx, TL.rows(102, 104), 101);
  ctx.store.dispatch({ type: "state/loaded", body: stateBody({ version: 2, timeline: pointer(104) }), origin: "poll", reqSeq: 0, now: 1000 });
  await settle();
  ctx.store.dispatch({ type: "tick", now: 5000 });
  await settle();
  assert.ok(ctx.names().includes("finishNow"));
  assert.equal(ctx.store.getState().anim.drawnThrough, 104);
  assert.equal(ctx.store.getState().presented.version, 2);
});

test("a play that finishes after a rebuild is ignored (token)", async () => {
  const ctx = setup();
  resetTo(ctx, stubRows(1, 101));
  appendRows(ctx, TL.rows(102, 102), 101);
  await settle();
  const stale = ctx.engine.plays.shift();
  resetTo(ctx, TL.rows(1, 15), "another-epoch");
  stale.resolve();
  await settle();
  const { anim, timeline } = ctx.store.getState();
  assert.equal(timeline.epoch, "another-epoch");
  assert.deepEqual([anim.drawnThrough, anim.playing, anim.rebuilding], [15, null, false]);
});

test("an engine that throws or never answers cannot stall the queue", async () => {
  const ctx = setup();
  ctx.engine.playRow = () => { throw new Error("GPU gone"); };
  resetTo(ctx, stubRows(1, 101));
  appendRows(ctx, TL.rows(102, 102), 101);
  await settle();
  assert.equal(ctx.store.getState().anim.drawnThrough, 102, "a throwing playRow counts as drawn");
  const quiet = setup();
  quiet.engine.playRow = () => new Promise(() => {});
  quiet.engine.finishNow = () => {};
  resetTo(quiet, stubRows(1, 101));
  appendRows(quiet, TL.rows(102, 102), 101);
  await settle();
  for (let i = 0; i < 4; i += 1) { quiet.timers.advance(5000); quiet.timers.runDue(); await settle(); }
  assert.equal(quiet.store.getState().anim.drawnThrough, 102, "the watchdog finishes it");
});

test("the presented drive shows the situation and the ghosts of the next call, once per change", async () => {
  const drive = loadState("drive_d25");
  const ctx = setup();
  if (drive.timeline) resetTo(ctx, [], drive.timeline.epoch);
  ctx.store.dispatch({ type: "state/loaded", body: drive, origin: "poll", reqSeq: 0, now: 1000 });
  const shown = (name) => ctx.engine.calls.filter((c) => c[0] === name);
  const sit = shown("showSituation").at(-1)[1];
  assert.deepEqual([sit.ballX, sit.ltgX, sit.dir, sit.poss], [25, 35, 1, "DAL"]);
  const ghosts = shown("showGhosts").at(-1)[1];
  assert.deepEqual(ghosts.shapes.map((s) => s.leaf), drive.prediction.top.map((t) => t.key));
  const before = shown("showSituation").length;
  ctx.store.dispatch({ type: "state/loaded", body: structuredClone(drive), origin: "poll", reqSeq: 0, now: 1001 });
  assert.equal(shown("showSituation").length, before, "the same facts again: no new call");
  assert.equal(ctx.attrs["data-phase"], "presnap");
  assert.equal(ctx.attrs["data-poss"], "DAL");
});

test("review shows a past row with its own ghosts; the live edge comes back after", () => {
  const ctx = setup();
  resetTo(ctx, TL.rows(1, 15));
  ctx.store.dispatch({ type: "review/set", seq: 2 });
  const shown = ctx.engine.calls.find((c) => c[0] === "showReview");
  assert.equal(shown[1], 2);
  assert.deepEqual(shown[2].shapes.map((s) => s.leaf), ["run_inside", "pa_short", "dropback_short"], "DC B2 top 3");
  ctx.store.dispatch({ type: "review/set", seq: null });
  assert.deepEqual(ctx.engine.calls.at(-1).slice(0, 3), ["showReview", null, null]);
  assert.equal(ctx.attrs["data-phase"], "idle");
});

test("hover highlights a ghost and the camera follows the view", () => {
  const ctx = setup();
  ctx.store.dispatch({ type: "hover/leaf", leaf: "pa_short" });
  ctx.store.dispatch({ type: "hover/leaf", leaf: null });
  ctx.store.dispatch({ type: "camera/set", id: "endzone" });
  const picked = ctx.engine.calls.filter((c) => ["highlightGhost", "setCamera"].includes(c[0]));
  assert.deepEqual(picked, [["highlightGhost", "pa_short"], ["highlightGhost", null], ["setCamera", "endzone"]]);
});

test("a retag relabels the drawn rows it changed, never re-draws them (DC B7)", () => {
  const ctx = setup();
  resetTo(ctx, TL.rows(1, 15));
  const log = [{ seq: 1, espn_id: "40187298068", family: "pa", leaf: null, name: "Play-action, incomplete", retagged: true }];
  ctx.store.dispatch({ type: "state/loaded", body: stateBody({ log }), origin: "poll", reqSeq: 0, now: 1 });
  assert.deepEqual(ctx.engine.calls.filter((c) => c[0] === "refreshLabels"), [["refreshLabels", [2]]]);
  assert.equal(ctx.names().filter((n) => n === "drawRowsInstant").length, 1);
});

test("a caller snap goes snap, then verdict for verdictMs, with the engine's verdict moment", async () => {
  const ctx = setup({ look: { motion: { verdictMs: 900 } } });
  resetTo(ctx, stubRows(1, 1));
  appendRows(ctx, TL.rows(2, 2), 1);
  await settle();
  assert.equal(ctx.attrs["data-phase"], "snap");
  ctx.engine.plays.shift().resolve();
  await settle();
  assert.equal(ctx.attrs["data-phase"], "verdict");
  assert.deepEqual(ctx.engine.calls.find((c) => c[0] === "markVerdict")[1], { seq: 2, key: "top3" });
  ctx.timers.advance(900);
  ctx.timers.runDue();
  assert.equal(ctx.attrs["data-phase"], "idle");
});

test("an engine error swaps in the fallback and redraws it from the store (6.2)", async () => {
  const fallback = fakeEngine("2d");
  const ctx = setup({ createFallback: () => fallback });
  resetTo(ctx, stubRows(1, 101));
  appendRows(ctx, TL.rows(102, 102), 101);
  await settle();
  ctx.store.dispatch({ type: "camera/set", id: "endzone" });
  ctx.engine.emit("error", new Error("lost"));
  await settle();
  const fb = fallback.calls.map((c) => c[0]);
  assert.ok(fb.includes("setGameFrame"));
  assert.deepEqual(fallback.calls.find((c) => c[0] === "drawRowsInstant")[1].at(-1), 102, "the playing row is drawn too");
  assert.equal(ctx.store.getState().anim.drawnThrough, 102);
  assert.equal(ctx.engine.listeners("error"), 0, "the old engine is detached");
  assert.equal(ctx.attrs["data-scene"], undefined, "the field host owns data-scene");
});

test("stop detaches from the store and the engine", () => {
  const ctx = setup();
  ctx.conductor.stop();
  resetTo(ctx, TL.rows(1, 15));
  assert.deepEqual(ctx.engine.calls, []);
});

test("appAttrs mirrors the store onto #app (2.7 attribute hooks)", () => {
  const store = createStore(reducer, initialState());
  store.dispatch({ type: "state/loaded", body: stateBody({ feed: { on: true, state: "live" }, timeline: pointer(0) }),
    origin: "poll", reqSeq: 0, now: 0 });
  store.dispatch({ type: "booth/toggle" });
  const a = appAttrs(store.getState(), { phase: "other", poss: "TB" });
  assert.deepEqual(a, { "data-mode": "feed", "data-phase": "other", "data-poss": "TB", "data-booth-open": "true",
    "data-scorecard-open": "false", "data-conn": "online", "data-boot": "ready", "data-watch-state": "idle", "data-source": "espn" });
  assert.deepEqual(Object.keys(a), [...APP_ATTRS]);
});

/** A conductor whose clock and timers follow the browser's WebIDL rule; `injected: false` leaves the defaults. */
function strictSetup({ injected = true } = {}) {
  const errors = [];
  const store = createStore(reducer, initialState(), { onError: (err) => errors.push(err) });
  const engine = fakeEngine();
  const timers = browserTimers(fakeTimers());
  const deps = injected ? { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout } : {};
  const conductor = createConductor({ store, getEngine: () => engine, now: browserLike(timers.now), app: null,
    onError: (err) => errors.push(err), ...deps });
  conductor.start();
  return { store, engine, timers, errors };
}

async function playFirstDalSnap(ctx) {
  resetTo(ctx, stubRows(1, 1));
  appendRows(ctx, TL.rows(2, 2), 1);
  await settle();
  ctx.engine.plays.shift().resolve();
  await settle();
}

test("injected timers and clock are called bare (Chromium throws 'Illegal invocation' otherwise)", async () => {
  const ctx = strictSetup();
  await playFirstDalSnap(ctx);
  assert.deepEqual(ctx.errors, []);
  assert.equal(ctx.store.getState().anim.drawnThrough, 2);
  assert.ok(ctx.engine.calls.some((c) => c[0] === "markVerdict"), "the verdict timer was set");
});

test("the default timers are the browser's, called bare", async () => {
  const delays = [];
  const saved = { set: globalThis.setTimeout, clear: globalThis.clearTimeout };
  globalThis.setTimeout = browserLike((fn, ms) => { delays.push(ms); return delays.length; });
  globalThis.clearTimeout = browserLike(() => {});
  try {
    const ctx = strictSetup({ injected: false });
    await playFirstDalSnap(ctx);
    assert.deepEqual(ctx.errors, []);
    assert.ok(delays.length >= 2, "the watchdog and the verdict timer");
  } finally {
    globalThis.setTimeout = saved.set;
    globalThis.clearTimeout = saved.clear;
  }
});

test("v1.4 (W1): the timeline's game reaches setGameFrame as its 4th argument, so day kickoffs light by day", () => {
  const ctx = setup();
  const game = { kickoff: "2026-10-09T17:05:00Z", light: "day" };
  ctx.store.dispatch({ type: "timeline/loaded", resp: { ...timelineBody(TL.body, { rows: TL.rows(1, 3), epoch: EPOCH }), game },
    origin: "poll", hidden: false, reducedMotion: false, now: ctx.timers.now() });
  const frame = ctx.engine.calls.find((c) => c[0] === "setGameFrame");
  assert.deepEqual(frame.slice(1), [TL.body.field, TL.body.teams, TL.body.team_order, game]);
});
