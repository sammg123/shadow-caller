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
    cameraModes: () => [{ id: "wide", label: "Wide" }, { id: "blimp", label: "Blimp" }],
    drawRowsInstant: (rows) => calls.push(["drawRowsInstant", rows.map((r) => r.seq)]),
    refreshLabels: (rows) => calls.push(["refreshLabels", rows.map((r) => r.seq)]),
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

function setup({ look = {}, createFallback = null, createWebgl = null } = {}) {
  const store = createStore(reducer, initialState());
  const engine = fakeEngine();
  const timers = fakeTimers();
  const attrs = {};
  const errors = [];
  const app = { setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; } };
  const conductor = createConductor({ store, getEngine: () => engine, look, now: timers.now, setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout, app, createFallback, createWebgl, onError: (err) => errors.push(err) });
  conductor.start();
  const names = () => engine.calls.map((c) => c[0]);
  return { store, engine, timers, attrs, conductor, names, errors };
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

test("a state from another epoch never puts its call or its situation over a rebuilt game", async () => {
  // A seek made elsewhere rebuilds the game (a new epoch): its timeline can arrive before its state. The call still
  // presented belongs to the old game: drawn over the new one, it would dim the newest play into a LAST plate that
  // never shows (play-drawing.md 4b).
  const drive = loadState("drive_d25");
  const ctx = setup();
  resetTo(ctx, [], drive.timeline?.epoch ?? EPOCH);
  ctx.store.dispatch({ type: "state/loaded", body: drive, origin: "poll", reqSeq: 0, now: 1000 });
  const last = (name) => ctx.engine.calls.filter((c) => c[0] === name).at(-1)?.[1];
  assert.ok(last("showGhosts"), "the call is up");
  resetTo(ctx, TL.rows(1, 15), "rebuilt-elsewhere");
  await settle();
  assert.equal(ctx.store.getState().anim.drawnThrough, 15);
  assert.equal(last("showGhosts"), null, "no call from the old game over the rebuilt one");
  assert.equal(last("showSituation"), null, "nor its lines");
  assert.equal(ctx.attrs["data-phase"], "idle");
  const own = { ...structuredClone(drive), timeline: { ...drive.timeline, epoch: "rebuilt-elsewhere", n: 15 } };
  ctx.store.dispatch({ type: "state/loaded", body: own, origin: "poll", reqSeq: 0, now: 1001 });
  assert.deepEqual(last("showGhosts")?.shapes.map((s) => s.leaf), drive.prediction.top.map((t) => t.key),
    "its own state brings its call");
  assert.equal(last("showSituation")?.poss, "DAL");
});

test("restructure-v2.md 5: after a jump the field snaps to where it landed, without replaying a play", async () => {
  const ctx = setup();
  resetTo(ctx, TL.rows(1, 15));
  ctx.store.dispatch({ type: "anim/jump", epoch: EPOCH, n: 18 });
  appendRows(ctx, TL.rows(16, 18), 15);
  await settle();
  const plays = ctx.engine.calls.filter((c) => c[0] === "playRow");
  assert.deepEqual(plays.map((c) => [c[1], c[2].durationMs]), [[16, 0], [17, 0], [18, 0]], "each drawn at once");
  assert.equal(ctx.store.getState().anim.drawnThrough, 18);
  assert.ok(!ctx.engine.calls.some((c) => c[0] === "markVerdict"), "a jump grades nothing on the field");
});

test("a jump while a play is drawing finishes it now", async () => {
  const ctx = setup();
  resetTo(ctx, stubRows(1, 1));
  appendRows(ctx, TL.rows(2, 2), 1);
  await settle();
  assert.equal(ctx.store.getState().anim.playing?.seq, 2);
  ctx.store.dispatch({ type: "anim/jump", epoch: "e-seek", n: 40 });
  assert.ok(ctx.names().includes("finishNow"), "the engine is hurried");
});

test("hover highlights a ghost and the camera follows the view", () => {
  const ctx = setup();
  ctx.store.dispatch({ type: "hover/leaf", leaf: "pa_short" });
  ctx.store.dispatch({ type: "hover/leaf", leaf: null });
  ctx.store.dispatch({ type: "camera/set", id: "blimp" });
  const picked = ctx.engine.calls.filter((c) => ["highlightGhost", "setCamera"].includes(c[0]));
  assert.deepEqual(picked, [["highlightGhost", "pa_short"], ["highlightGhost", null], ["setCamera", "blimp"]]);
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
  // G2-7: what was graded (row 2's pred: his #3, dropback_short at 14%), in the timeline meta's leaf names
  assert.deepEqual(ctx.engine.calls.find((c) => c[0] === "markVerdict")[1],
    { seq: 2, key: "top3", text: "In his top 3 · #3 Short · 14%" });
  ctx.timers.advance(900);
  ctx.timers.runDue();
  assert.equal(ctx.attrs["data-phase"], "idle");
});

// ---------------------------------------------------------------- G2-3: the verdict's own beat
const DRIVE = loadState("drive_d25");
const ghostsShown = (ctx) => ctx.engine.calls.filter((c) => c[0] === "showGhosts").map((c) => c[1]);
const leavesOf = (set) => set?.shapes?.map((s) => s.leaf) ?? null;
const driveState = (version, n, prediction = DRIVE.prediction, watch = DRIVE.watch) => ({ ...structuredClone(DRIVE),
  version, prediction, timeline: pointer(n), watch });
const NEXT_CALL = { ...DRIVE.prediction, top: [...DRIVE.prediction.top].reverse() };

/** His first call is up; his first snap (row 2) is drawing, with the next call waiting on it. */
async function callerSnapDrawing(ctx, { watch = null } = {}) {
  const session = watch ? { ...DRIVE.watch, next_at: ctx.timers.now() + 5000, ...watch } : DRIVE.watch;
  resetTo(ctx, stubRows(1, 1));
  ctx.store.dispatch({ type: "state/loaded", body: driveState(1, 1, DRIVE.prediction, session), origin: "poll",
    reqSeq: 0, now: ctx.timers.now() });
  if (watch) {
    ctx.store.dispatch({ type: "version/loaded", body: { version: 2, epoch: EPOCH, timeline_n: 2, watch: session },
      now: ctx.timers.now() });
  }
  appendRows(ctx, TL.rows(2, 2), 1);
  ctx.store.dispatch({ type: "state/loaded", body: driveState(2, 2, NEXT_CALL, session), origin: "poll", reqSeq: 0,
    now: ctx.timers.now() });
  await settle();
}

test("G2-3: the verdict gets its own beat; the next call's shadows wait for it, then come up", async () => {
  const ctx = setup({ look: { motion: { verdictMs: 900 } } });
  await callerSnapDrawing(ctx);
  assert.deepEqual(leavesOf(ghostsShown(ctx).at(-1)), DRIVE.prediction.top.map((t) => t.key), "his first call");
  assert.equal(ctx.attrs["data-phase"], "snap");
  const before = ghostsShown(ctx).length;
  ctx.engine.plays.shift().resolve();
  await settle();
  assert.equal(ctx.store.getState().presented.version, 2, "the HUD has the next call");
  assert.equal(ctx.attrs["data-phase"], "verdict");
  assert.deepEqual(ghostsShown(ctx).slice(before), [null], "no shadows on the field during the verdict");
  assert.deepEqual(ctx.engine.calls.find((c) => c[0] === "markVerdict")[1].key, "top3");
  ctx.timers.advance(899);
  ctx.timers.runDue();
  assert.deepEqual(ghostsShown(ctx).slice(before), [null], "still the verdict's beat");
  ctx.timers.advance(1);
  ctx.timers.runDue();
  assert.deepEqual(leavesOf(ghostsShown(ctx).at(-1)), NEXT_CALL.top.map((t) => t.key), "then the next call");
  assert.equal(ghostsShown(ctx).length, before + 2);
  assert.equal(ctx.attrs["data-phase"], "presnap");
});

test("G2-3: the same call again still gets the beat, and the situation is shown once", async () => {
  const ctx = setup({ look: { motion: { verdictMs: 900 } } });
  resetTo(ctx, stubRows(1, 1));
  ctx.store.dispatch({ type: "state/loaded", body: driveState(1, 1), origin: "poll", reqSeq: 0, now: ctx.timers.now() });
  appendRows(ctx, TL.rows(2, 2), 1);
  ctx.store.dispatch({ type: "state/loaded", body: driveState(2, 2), origin: "poll", reqSeq: 0, now: ctx.timers.now() });
  await settle();
  const situations = () => ctx.engine.calls.filter((c) => c[0] === "showSituation").length;
  const sits = situations();
  const before = ghostsShown(ctx).length;
  ctx.engine.plays.shift().resolve();
  await settle();
  ctx.timers.advance(900);
  ctx.timers.runDue();
  assert.deepEqual(ghostsShown(ctx).slice(before).map(leavesOf), [null, DRIVE.prediction.top.map((t) => t.key)]);
  assert.equal(situations(), sits, "the same spot: no new situation call");
});

test("G2-3: Watch at 4x and up keeps the beat to 600 ms; 2x keeps the look's", async () => {
  for (const [speed, beat] of [[4, 600], [10, 600], [2, 1500]]) {
    const ctx = setup({ look: { motion: { verdictMs: 1500 } } });
    await callerSnapDrawing(ctx, { watch: { state: "playing", speed } });
    const before = ghostsShown(ctx).length;
    ctx.engine.plays.shift().resolve();
    await settle();
    ctx.timers.advance(beat - 1);
    ctx.timers.runDue();
    assert.equal(ctx.attrs["data-phase"], "verdict", `${speed}x: still the verdict at ${beat - 1} ms`);
    ctx.timers.advance(1);
    ctx.timers.runDue();
    assert.equal(ctx.attrs["data-phase"], "presnap", `${speed}x: the next call at ${beat} ms`);
    assert.equal(ghostsShown(ctx).length, before + 2, `${speed}x`);
  }
});

test("G2-7: the verdict's words use the timeline's own leaf names", async () => {
  const ctx = setup();
  const meta = { ...TL.body.meta, leaf_names: { ...TL.body.meta.leaf_names, dropback_short: "Quick game (0–9)" } };
  ctx.store.dispatch({ type: "timeline/loaded", resp: { ...timelineBody(TL.body, { rows: stubRows(1, 1), epoch: EPOCH }),
    meta }, origin: "poll", hidden: false, reducedMotion: false, now: ctx.timers.now() });
  appendRows(ctx, TL.rows(2, 2), 1);
  await settle();
  ctx.engine.plays.shift().resolve();
  await settle();
  assert.equal(ctx.engine.calls.find((c) => c[0] === "markVerdict")[1].text, "In his top 3 · #3 Quick game · 14%");
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

// ---------------------------------------------------------------- G2-4, G2-9: the engine's life after a failure
/** Engines main.js would hand over: the 2D field (createFallback) and fresh WebGL fields (createWebgl). */
function engineShop({ webglFails = false } = {}) {
  const shop = { fallbacks: [], webgls: [], fallbackCalls: [], webglTries: 0 };
  shop.createFallback = (err, opts) => {
    shop.fallbackCalls.push([err?.message, opts]);
    const fb = fakeEngine("2d");
    shop.fallbacks.push(fb);
    return fb;
  };
  shop.createWebgl = async () => {
    shop.webglTries += 1;
    if (webglFails) throw new Error("no GPU yet");
    const next = fakeEngine("webgl");
    shop.webgls.push(next);
    return next;
  };
  return shop;
}
const drewFrame = (engine) => engine.calls.some((c) => c[0] === "setGameFrame") && engine.calls.some((c) => c[0] === "drawRowsInstant");

test("G2-4: a lost WebGL context is not a bug: the 2D field holds the game, and the restore brings WebGL back", async () => {
  const shop = engineShop();
  const ctx = setup({ createFallback: shop.createFallback, createWebgl: shop.createWebgl });
  resetTo(ctx, TL.rows(1, 15));
  ctx.engine.emit("contextlost");
  await settle();
  assert.deepEqual(ctx.errors, [], "no bug report for a lost context");
  assert.deepEqual(shop.fallbackCalls, [["WebGL context lost", { lost: true }]]);
  assert.ok(drewFrame(shop.fallbacks[0]), "the 2D field is drawn from the store");
  assert.equal(shop.webgls.length, 0, "WebGL waits for the browser's restore");
  ctx.engine.emit("contextrestored");
  await settle();
  assert.equal(shop.webgls.length, 1, "a fresh WebGL field");
  const next = shop.webgls[0];
  assert.ok(drewFrame(next), "redrawn from the store");
  assert.deepEqual(next.calls.find((c) => c[0] === "drawRowsInstant")[1], Array.from({ length: 15 }, (_, i) => i + 1));
  assert.equal(shop.fallbacks[0].listeners("error"), 0, "the 2D field is detached");
  ctx.engine.emit("contextrestored");
  await settle();
  assert.equal(shop.webgls.length, 1, "one restore per loss");
  next.emit("contextlost");
  await settle();
  assert.equal(shop.fallbacks.length, 2, "the restored field can pause and come back again");
  assert.deepEqual(ctx.errors, []);
});

test("G2-9: an engine error is reported and fails over; the next epoch tries WebGL again instead of latching 2D", async () => {
  const shop = engineShop();
  const ctx = setup({ createFallback: shop.createFallback, createWebgl: shop.createWebgl });
  resetTo(ctx, TL.rows(1, 15));
  ctx.engine.emit("error", new Error("layer tick broke"));
  await settle();
  assert.deepEqual(ctx.errors.map((e) => e.message), ["layer tick broke"]);
  assert.deepEqual(shop.fallbackCalls, [["layer tick broke", { lost: false }]]);
  assert.equal(shop.webgls.length, 0, "no retry until the next epoch");
  resetTo(ctx, TL.rows(1, 20), "another-epoch");
  await settle();
  assert.equal(shop.webgls.length, 1, "the new epoch tries WebGL again");
  assert.deepEqual(shop.webgls[0].calls.find((c) => c[0] === "drawRowsInstant")[1].at(-1), 20, "the new epoch's rows");
  resetTo(ctx, TL.rows(1, 21), "third-epoch");
  await settle();
  assert.equal(shop.webgls.length, 1, "back on WebGL: nothing to retry");
});

test("G2-9: a WebGL field that can't start again leaves the 2D field on, quietly retried at the next epoch", async () => {
  const shop = engineShop({ webglFails: true });
  const ctx = setup({ createFallback: shop.createFallback, createWebgl: shop.createWebgl });
  resetTo(ctx, TL.rows(1, 15));
  ctx.engine.emit("contextlost");
  ctx.engine.emit("contextrestored");
  await settle();
  assert.deepEqual(ctx.errors.map((e) => e.message), ["no GPU yet"], "a factory that throws is reported");
  const fb = shop.fallbacks[0];
  assert.equal(fb.listeners("error"), 1, "still on the 2D field");
  appendRows(ctx, TL.rows(16, 16), 15);
  await settle();
  assert.ok(fb.calls.some((c) => c[0] === "playRow" && c[1] === 16), "plays keep drawing on it");
  assert.equal(shop.webglTries, 1);
  resetTo(ctx, TL.rows(1, 20), "another-epoch");
  await settle();
  assert.equal(shop.webglTries, 2, "the next epoch tries again");
  assert.equal(fb.listeners("error"), 1, "and the 2D field stays while WebGL can't start");
});

test("G2-9: createFallback throwing is reported once and leaves the store alone", async () => {
  const ctx = setup({ createFallback: () => { throw new Error("no 2D module"); } });
  resetTo(ctx, TL.rows(1, 15));
  const before = ctx.store.getState();
  ctx.engine.emit("error", new Error("GPU fault"));
  ctx.engine.emit("error", new Error("GPU fault again"));
  await settle();
  assert.deepEqual(ctx.errors.map((e) => e.message), ["GPU fault", "no 2D module", "GPU fault again"]);
  assert.equal(ctx.store.getState(), before, "no dispatch: the store is untouched");
});

test("G2-9: a play whose normal length can't be planned is drawn at once, and the problem reported", async () => {
  const motion = new Proxy({}, { get(_, key) {
    if (key === "verdictMs") return 900;
    throw new Error(`bad motion: ${String(key)}`);
  } });
  const ctx = setup({ look: { motion } });
  resetTo(ctx, stubRows(1, 101));
  appendRows(ctx, TL.rows(102, 102), 101);
  await settle();
  const played = ctx.engine.calls.find((c) => c[0] === "playRow" && c[1] === 102);
  assert.equal(played[2].durationMs, 0, "instant");
  assert.equal(ctx.store.getState().anim.drawnThrough, 102);
  assert.equal(ctx.errors.length, 1);
  assert.match(ctx.errors[0].message, /bad motion/);
});

test("G2-9: a queued row the timeline no longer holds is counted as drawn, never played", async () => {
  const real = createStore(reducer, initialState());
  let hidden = null;
  const filtered = (s) => (hidden === null ? s
    : { ...s, timeline: { ...s.timeline, rows: s.timeline.rows.filter((r) => r.seq !== hidden) } });
  const store = { getState: () => filtered(real.getState()), dispatch: (e) => real.dispatch(e),
    subscribe: (fn) => real.subscribe((state, prev) => fn(filtered(state), filtered(prev))) };
  const engine = fakeEngine();
  const timers = fakeTimers();
  createConductor({ store, getEngine: () => engine, now: timers.now, setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout }).start();
  real.dispatch({ type: "timeline/loaded", resp: timelineBody(TL.body, { rows: stubRows(1, 101), epoch: EPOCH }),
    origin: "poll", hidden: false, reducedMotion: false, now: timers.now() });
  hidden = 102;
  real.dispatch({ type: "timeline/loaded", resp: timelineBody(TL.body, { rows: TL.rows(102, 102), since: 101, reset: false }),
    origin: "poll", hidden: false, reducedMotion: false, now: timers.now() });
  await settle();
  assert.equal(real.getState().anim.drawnThrough, 102);
  assert.equal(engine.calls.filter((c) => c[0] === "playRow").length, 0);
});

test("with no onError the conductor reports through the page's reportError", () => {
  const seen = [];
  const saved = globalThis.reportError;
  globalThis.reportError = (err) => seen.push(err.message);
  try {
    const store = createStore(reducer, initialState());
    const engine = fakeEngine();
    const timers = fakeTimers();
    createConductor({ store, getEngine: () => engine, now: timers.now, setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout }).start();
    engine.emit("error", new Error("no listener of its own"));
    assert.deepEqual(seen, ["no listener of its own"]);
  } finally {
    globalThis.reportError = saved;
  }
  assert.throws(() => createConductor({ store: {}, getEngine: () => null, now: null }), TypeError);
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
  store.dispatch({ type: "settings/toggle" });
  const a = appAttrs(store.getState(), { phase: "other", poss: "TB" });
  assert.deepEqual(a, { "data-mode": "feed", "data-phase": "other", "data-poss": "TB", "data-settings-open": "true",
    "data-conn": "online", "data-boot": "ready", "data-watch-state": "idle", "data-source": "espn", "data-playback": "" });
  assert.deepEqual(Object.keys(a), [...APP_ATTRS]);
});

test("the page counts as booted once the game is open: data-boot says opening while /api/open runs", () => {
  const store = createStore(reducer, initialState());
  store.dispatch({ type: "state/loaded", body: stateBody({ timeline: pointer(0) }), origin: "poll", reqSeq: 0, now: 0 });
  store.dispatch({ type: "playback/start", kind: "open" });
  const opening = appAttrs(store.getState(), { phase: "idle", poss: "" });
  assert.deepEqual([opening["data-boot"], opening["data-playback"]], ["opening", "open"]);
  store.dispatch({ type: "playback/end" });
  store.dispatch({ type: "playback/start", kind: "seek", target: 9 });
  const seeking = appAttrs(store.getState(), { phase: "idle", poss: "" });
  assert.deepEqual([seeking["data-boot"], seeking["data-playback"]], ["ready", "seek"]);
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
