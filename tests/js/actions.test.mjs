import assert from "node:assert/strict";
import test from "node:test";

import { ACTION_COPY, TOAST_MS, createActions } from "../../static/js/core/actions.js";
import { ApiError } from "../../static/js/core/api.js";
import { initialState, reducer } from "../../static/js/core/reducer.js";
import { createStore } from "../../static/js/core/store.js";
import { browserLike, browserTimers, loadTimeline, stateBody, timelineBody } from "./fixtures.mjs";

const TL = loadTimeline();
const settle = async (turns = 6) => { for (let i = 0; i < turns; i += 1) await new Promise((r) => setImmediate(r)); };

function fakeForm() {
  const f = { yards: "0", td: false, to: false, autoFirst: false, focused: 0 };
  return {
    f,
    readYards: () => f.yards, writeYards: (v) => { f.yards = v; },
    readTD: () => f.td, writeTD: (b) => { f.td = b; }, readTO: () => f.to, writeTO: (b) => { f.to = b; },
    readAutoFirst: () => f.autoFirst, writeAutoFirst: (b) => { f.autoFirst = b; },
    focusYards: () => { f.focused += 1; },
  };
}

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
    replies,
    async post(path, body) {
      posts.push({ path, body });
      const r = replies[path];
      const reply = typeof r === "function" ? await r(body) : r;
      return reply ?? { status: 200, body: stateBody({ message: "OK" }) };
    },
  };
}

/** strict: browser-strict timers and clock (fixtures browserLike); storeErrors: what the store's onError saw. */
function setup({ state = {}, replies = {}, confirm = true, withTeams = true, strict = false, ...opts } = {}) {
  const storeErrors = [];
  const store = createStore(reducer, initialState(), { onError: (err) => storeErrors.push(err) });
  if (withTeams) {
    store.dispatch({ type: "timeline/loaded", resp: timelineBody(TL.body, { rows: TL.rows(1, 15) }), origin: "poll", now: 0 });
    store.dispatch({ type: "anim/rebuilt", token: store.getState().anim.token, now: 0 });
  }
  store.dispatch({ type: "state/loaded", body: stateBody(state), origin: "poll", reqSeq: 0, now: 0 });
  const api = fakeApi(replies);
  const kicks = [];
  const sync = { kick: (o) => kicks.push(o ?? {}) };
  const form = fakeForm();
  const confirms = [];
  const dialogs = { confirmAction: async (text) => { confirms.push(text); return typeof confirm === "function" ? confirm(text) : confirm; } };
  const timers = strict ? browserTimers(fakeTimers()) : fakeTimers();
  const persisted = [];
  const now = strict ? browserLike(() => 42) : () => 42;
  const actions = createActions({ store, api, sync, form, dialogs, now, timers,
    persist: (k, v) => persisted.push([k, v]), ...opts });
  return { store, api, kicks, form, confirms, timers, actions, persisted, storeErrors, view: () => store.getState().view };
}

const DRIVE = { drive_active: true, drive_n: 1 };
const toastOf = (ctx) => ctx.view().toast;

test("logPlay sends the FI 2.4 body, applies the state, toasts and clears the pick (#51)", async () => {
  const ctx = setup({ state: DRIVE, replies: { "/api/play": { status: 200, body: stateBody({ ...DRIVE, version: 2, message: "Logged." }) } } });
  ctx.actions.tap("K");
  ctx.form.f.yards = "3";
  await ctx.actions.logPlay();
  assert.deepEqual(ctx.api.posts, [{ path: "/api/play", body: { yards: 3, td: false, turnover: false, leaf: "run_inside" } }]);
  assert.equal(JSON.stringify(ctx.api.posts[0].body), '{"yards":3,"td":false,"turnover":false,"leaf":"run_inside"}');
  assert.equal(ctx.store.getState().server.version, 2);
  assert.deepEqual(toastOf(ctx), { id: 1, text: "Logged.", err: false });
  assert.equal(ctx.view().pick.k, null);
  assert.equal(ctx.form.f.yards, "0");
  assert.ok(ctx.form.f.focused >= 2, "tap and log both focus Yards");
  assert.deepEqual(ctx.store.getState().req, { seq: 1, lastActionApplied: 1, inflightActions: 0 });
  assert.deepEqual(ctx.kicks, [{ origin: "action" }]);
});

test("logPlay sends nothing without a drive or a pick (#58)", async () => {
  const off = setup();
  off.actions.tap("K");
  await off.actions.logPlay();
  const none = setup({ state: DRIVE });
  await none.actions.logPlay();
  assert.deepEqual([off.api.posts.length, none.api.posts.length], [0, 0]);
});

test("G6: a pick made while the log request is in flight survives its response; Enter is ignored meanwhile (#62)", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const ctx = setup({ state: DRIVE, replies: { "/api/play": async () => { await gate; return { status: 200, body: stateBody({ ...DRIVE, message: "Logged." }) }; } } });
  ctx.actions.tap("K");
  const first = ctx.actions.logPlay();
  await settle();
  ctx.actions.tap("P");
  await ctx.actions.logPlay();
  release();
  await first;
  assert.equal(ctx.api.posts.length, 1);
  assert.deepEqual(ctx.view().pick, { k: "P", i: 0, out: null });
});

test("applyFlag sends FI 2.5, closes the panel and clears the pick and the box (#68)", async () => {
  const ctx = setup({ state: DRIVE, replies: { "/api/penalty": { status: 200, body: stateBody({ ...DRIVE, message: "Defensive holding: 5 yards." }) } } });
  ctx.actions.openFlag();
  ctx.form.f.autoFirst = true;
  ctx.form.f.yards = "0";
  await ctx.actions.applyFlag("DH");
  assert.equal(JSON.stringify(ctx.api.posts[0].body), '{"code":"DH","yards":null,"auto_first":true}');
  assert.equal(ctx.view().flag.open, false);
  assert.equal(ctx.form.f.autoFirst, false);
  assert.equal(toastOf(ctx).text, "Defensive holding: 5 yards.");
});

test("G6: a panel reopened during the flag request stays open; an error keeps the panel and the pick (#71)", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const ctx = setup({ state: DRIVE, replies: { "/api/penalty": async () => { await gate; return { status: 200, body: stateBody(DRIVE) }; } } });
  ctx.actions.openFlag();
  const pending = ctx.actions.applyFlag("DH");
  await settle();
  ctx.actions.closeFlag();
  ctx.actions.openFlag();
  release();
  await pending;
  assert.equal(ctx.view().flag.open, true);
  const err = setup({ state: DRIVE, replies: { "/api/penalty": { status: 400, body: stateBody({ ...DRIVE, error: "Type the yards first." }) } } });
  err.actions.tap("P");
  err.actions.openFlag();
  await err.actions.applyFlag("DPI");
  assert.equal(err.view().flag.open, true);
  assert.equal(err.view().pick.k, "P");
  assert.deepEqual(toastOf(err), { id: 1, text: "Type the yards first.", err: true });
});

test("openFlag without a drive toasts the location from ESPN teams and opens nothing (#63, G13)", () => {
  const ctx = setup();
  ctx.actions.openFlag();
  assert.equal(ctx.view().flag.open, false);
  assert.deepEqual(toastOf(ctx), { id: 1, text: "No Dallas drive in progress. Type the ball spot first.", err: true });
  const bare = setup({ withTeams: false });
  bare.actions.openFlag();
  assert.equal(toastOf(bare).text, "No DAL drive in progress. Type the ball spot first.");
});

test("openFlag with a drive opens the panel, focuses Yards and opens the booth when the world keeps flags there", () => {
  const ctx = setup({ state: DRIVE, boothHoldsFlags: () => true });
  ctx.actions.toggleFlag();
  assert.deepEqual(ctx.view().flag, { open: true, gen: 1 });
  assert.deepEqual(ctx.view().booth, { open: true, auto: true });
  assert.equal(ctx.form.f.focused, 1);
  ctx.actions.toggleFlag();
  assert.deepEqual([ctx.view().flag.open, ctx.view().booth.open], [false, false]);
});

test("commitStrip: untouched sends nothing; Ball on starts a drive with one toast (#9, #24)", async () => {
  const ctx = setup({ replies: { "/api/situation": { status: 200, body: stateBody({ ...DRIVE, message: "Drive 1 started." }) } } });
  assert.deepEqual(await ctx.actions.commitStrip("iYard", "25", false), { sent: false, ok: false });
  assert.equal(ctx.api.posts.length, 0);
  assert.deepEqual(await ctx.actions.commitStrip("iYard", "20", true), { sent: true, ok: true });
  assert.deepEqual(ctx.api.posts[0].body, { spot: "DAL 20" });
  assert.equal(toastOf(ctx).text, "Drive 1 started.");
});

test("commitStrip: a plain save is silent; a rejected value keeps its text and toasts red (#14)", async () => {
  const quiet = setup({ state: DRIVE, replies: { "/api/situation": { status: 200, body: stateBody({ ...DRIVE, message: "Saved." }) } } });
  await quiet.actions.commitStrip("iQtr", "2", true);
  assert.equal(toastOf(quiet), null);
  const bad = setup({ replies: { "/api/situation": { status: 400, body: stateBody({ error: "'16:00' isn't a game clock (max 15:00)" }) } } });
  await bad.actions.commitStrip("iClock", "16:00", true);
  assert.deepEqual(bad.view().stripRejected, { iClock: "16:00" });
  assert.equal(toastOf(bad).err, true);
  await bad.actions.commitStrip("iClock", "", true);
  assert.deepEqual(bad.view().stripRejected, {}, "a restore clears the invalid style");
});

test("flipSide mirrors the spot and remembers the 50 (#18, #19)", async () => {
  const ctx = setup({ state: { sit: { ...stateBody().sit, yardline_100: 50 } } });
  await ctx.actions.flipSide("50");
  assert.deepEqual(ctx.api.posts[0].body, { spot: "TB 50" });
  assert.equal(ctx.view().sideAtFifty, "TB");
});

test("endDrive, runShorthand, undo and undoRefused", async () => {
  const ctx = setup({ state: DRIVE, replies: { "/api/command": (b) => (b.text === "KK 3"
    ? { status: 400, body: stateBody({ error: "Didn't understand 'KK 3'" }) } : { status: 200, body: stateBody({ message: "Done: JJ 6" }) }) } });
  await ctx.actions.endDrive("punt");
  await ctx.actions.endDrive("onside");
  assert.deepEqual(await ctx.actions.runShorthand("  "), { ok: false });
  assert.deepEqual(await ctx.actions.runShorthand(" JJ 6 "), { ok: true });
  assert.deepEqual(await ctx.actions.runShorthand("KK 3"), { ok: false });
  await ctx.actions.undo();
  assert.deepEqual(ctx.api.posts.map((p) => [p.path, p.body]), [["/api/drive", { end: "punt" }], ["/api/command", { text: "JJ 6" }],
    ["/api/command", { text: "KK 3" }], ["/api/undo", {}]]);
  ctx.actions.undoRefused();
  assert.deepEqual(toastOf(ctx), { id: 5, text: ACTION_COPY.undoOff, err: true });
});

test("reset asks first; with the feed on it turns the feed off before resetting (#89, #105)", async () => {
  const declined = setup({ confirm: false });
  await declined.actions.reset();
  assert.deepEqual([declined.confirms, declined.api.posts], [["Clear every snap logged for this game?"], []]);
  const live = setup({ state: { feed: { on: true, state: "live", event_id: "401872980" } } });
  await live.actions.reset();
  assert.match(live.confirms[0], /^Clear every snap logged for this game\? .*feed/);
  assert.deepEqual(live.api.posts.map((p) => [p.path, p.body]), [["/api/feed", { on: false, event_id: null }], ["/api/reset", {}]]);
});

test("replay names the box id, else the feed's event id, else (today's) (#106, G21)", async () => {
  const ctx = setup({ state: { feed: { on: false, state: "off", event_id: "401872980" } } });
  await ctx.actions.replay(" 401999999 ");
  await ctx.actions.replay("");
  const none = setup({ state: { feed: { on: false, state: "off", event_id: null } }, confirm: false });
  await none.actions.replay("");
  assert.deepEqual([...ctx.confirms, ...none.confirms], [
    "Rebuild the game log from ESPN game 401999999? The current log is backed up first.",
    "Rebuild the game log from ESPN game 401872980? The current log is backed up first.",
    "Rebuild the game log from ESPN game (today's)? The current log is backed up first."]);
  assert.deepEqual(ctx.api.posts.map((p) => p.body), [{ event_id: "401999999" }, { event_id: null }]);
});

test("feedToggle and retag send FI 2.2 bodies; a retag during a playing watch pauses first (#92, #97)", async () => {
  const ctx = setup();
  await ctx.actions.feedToggle(" 401872980 ");
  await ctx.actions.retag("A");
  await ctx.actions.retag("R", { pauseFirst: true });
  assert.deepEqual(ctx.api.posts.map((p) => [p.path, p.body]), [["/api/feed", { on: true, event_id: "401872980" }],
    ["/api/retag", { key: "A" }], ["/api/watch/pause", {}], ["/api/retag", { key: "R" }]]);
});

test("watchStart confirms, stops a finished session first and starts at the chosen speed (3.8)", async () => {
  const done = setup({ state: { watch: { state: "done" }, feed: { on: false, state: "off", event_id: "401872980" } } });
  await done.actions.watchSpeed(10);
  await done.actions.watchStart("");
  assert.equal(done.confirms[0], "Watch ESPN game 401872980 from the start? Your game is backed up first and comes back when you stop.");
  assert.deepEqual(done.api.posts.map((p) => [p.path, p.body]), [["/api/watch/stop", { restore: true }],
    ["/api/watch/start", { event_id: "401872980", speed: 10, from_seq: 0 }]]);
  const noId = setup({ state: { feed: { on: false, state: "off", event_id: null } } });
  await noId.actions.watchStart("");
  assert.deepEqual([noId.api.posts.length, toastOf(noId).err], [0, true]);
});

test("watch transport: Space toggles, speeds post only in a session, stop restores (3.8)", async () => {
  const playing = setup({ state: { watch: { state: "playing" } },
    replies: { "/api/watch/pause": { status: 200, body: stateBody({ watch: { state: "paused" } }) } } });
  await playing.actions.watchToggle();
  assert.equal(playing.store.getState().server.watch.state, "paused", "the response's watch is the new truth");
  await playing.actions.watchSpeed(4);
  await playing.actions.watchSpeed(3);
  await playing.actions.watchStop();
  assert.deepEqual(playing.api.posts.map((p) => [p.path, p.body]), [["/api/watch/pause", {}], ["/api/watch/speed", { speed: 4 }],
    ["/api/watch/stop", { restore: true }]]);
  assert.deepEqual(playing.confirms, ["Stop watching and put your game back?"]);
  const paused = setup({ state: { watch: { state: "paused" } } });
  await paused.actions.watchToggle();
  await paused.actions.watchStep();
  const idle = setup();
  await idle.actions.watchToggle();
  await idle.actions.watchSpeed(2);
  assert.deepEqual(paused.api.posts.map((p) => p.path), ["/api/watch/resume", "/api/watch/step"]);
  assert.deepEqual([idle.api.posts.length, idle.store.getState().prefs.watchSpeed], [0, 2]);
});

test("a network failure toasts 'Nothing was saved' and marks the connection (#121)", async () => {
  const ctx = setup({ state: DRIVE, replies: { "/api/undo": () => { throw new ApiError("network", { path: "/api/undo" }); } } });
  await ctx.actions.undo();
  assert.deepEqual(toastOf(ctx), { id: 1, text: "Can't reach the app server. Nothing was saved.", err: true });
  assert.equal(ctx.store.getState().conn.failures, 1);
  assert.equal(ctx.store.getState().req.inflightActions, 0);
});

test("a 409 without a state toasts the server's error and kicks a tick (3.8)", async () => {
  const ctx = setup({ replies: { "/api/watch/step": { status: 409, body: { error: "Pause the game first." } } } });
  const before = ctx.store.getState().server;
  await ctx.actions.watchStep();
  assert.equal(ctx.store.getState().server, before);
  assert.deepEqual(toastOf(ctx), { id: 1, text: "Pause the game first.", err: true });
  assert.equal(ctx.kicks.length, 1);
});

test("POSTs go one at a time, in order", async () => {
  const order = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const ctx = setup({ replies: { "/api/undo": async () => { order.push("undo:start"); await gate; order.push("undo:end"); return { status: 200, body: stateBody() }; },
    "/api/retag": async () => { order.push("retag"); return { status: 200, body: stateBody() }; } } });
  const a = ctx.actions.undo();
  const b = ctx.actions.retag("A");
  await settle();
  assert.deepEqual(order, ["undo:start"]);
  release();
  await Promise.all([a, b]);
  assert.deepEqual(order, ["undo:start", "undo:end", "retag"]);
});

test("review: Left shows the newest drawn play; Right at the edge steps a paused watch, never on repeat", async () => {
  const ctx = setup({ state: { watch: { state: "paused" } } });
  ctx.actions.review(-1);
  assert.deepEqual(ctx.view().review, { seq: 15 });
  ctx.actions.review(1);
  assert.deepEqual(ctx.view().review, { seq: null });
  await ctx.actions.review(1, { repeat: true });
  assert.equal(ctx.api.posts.length, 0);
  await ctx.actions.review(1);
  assert.deepEqual(ctx.api.posts.map((p) => p.path), ["/api/watch/step"]);
  const playing = setup({ state: { watch: { state: "playing" } } });
  await playing.actions.review(1);
  assert.deepEqual(playing.api.posts.map((p) => p.path), ["/api/watch/pause", "/api/watch/step"]);
  ctx.actions.review(-1);
  ctx.actions.exitReview();
  assert.deepEqual(ctx.view().review, { seq: null });
});

test("cycleCamera wraps through the engine's modes and persists the choice", () => {
  const modes = [{ id: "sideline", label: "Sideline" }, { id: "endzone", label: "End zone" }, { id: "overhead", label: "Overhead" }];
  const ctx = setup({ cameraModes: () => modes, defaultCamera: () => "sideline" });
  const seen = [1, 2, 3].map(() => { ctx.actions.cycleCamera(); return ctx.view().camera; });
  assert.deepEqual(seen, ["endzone", "overhead", "sideline"]);
  assert.deepEqual(ctx.persisted.at(-1), ["sc:camera", "sideline"]);
  const none = setup();
  none.actions.cycleCamera();
  assert.equal(none.view().camera, null);
});

test("a toast hides after 2.6 s unless a newer one replaced it (FI 4.5)", () => {
  const ctx = setup();
  ctx.actions.undoRefused();
  ctx.actions.undoRefused();
  assert.equal(TOAST_MS, 2600);
  assert.equal(toastOf(ctx).id, 2);
  const [first] = [...ctx.timers.pending.values()];
  first.fn();
  assert.equal(toastOf(ctx).id, 2, "the older timer leaves the newer toast");
  ctx.timers.fire(TOAST_MS);
  assert.equal(toastOf(ctx), null);
});

test("pick and box helpers drive the store and the form (FI 1.3)", () => {
  const ctx = setup({ state: DRIVE });
  ctx.actions.tap("P");
  ctx.actions.outcome("incomplete");
  assert.deepEqual([ctx.view().pick.out, ctx.form.f.yards], ["incomplete", "0"]);
  ctx.actions.toggleTD();
  ctx.actions.toggleTO();
  assert.deepEqual([ctx.form.f.td, ctx.form.f.to], [true, true]);
  ctx.actions.pickLeaf("run_edge_left");
  assert.deepEqual(ctx.view().pick, { k: "J", i: 1, out: null });
  ctx.form.f.yards = "7";
  ctx.actions.clearPick();
  assert.deepEqual([ctx.view().pick.k, ctx.form.f.yards, ctx.form.f.td, ctx.form.f.to], [null, "0", false, false]);
});

test("view toggles, hover, ambient and Retry now", () => {
  const ctx = setup();
  ctx.actions.toggleBooth();
  ctx.actions.toggleScorecard();
  ctx.actions.hoverLeaf("pa_short");
  ctx.actions.setAmbient("dark");
  ctx.actions.setAmbient("purple");
  ctx.actions.retryNow();
  const v = ctx.view();
  assert.deepEqual([v.booth.open, v.scorecardOpen, v.hoverLeaf], [true, true, "pa_short"]);
  assert.equal(ctx.store.getState().prefs.ambient, "dark");
  assert.deepEqual(ctx.persisted, [["sc:ambient", "dark"]]);
  ctx.actions.closeScorecard();
  assert.equal(ctx.view().scorecardOpen, false);
  assert.deepEqual(ctx.kicks, [{}]);
});

test("a broken form or dialog never makes an action throw", async () => {
  const store = createStore(reducer, initialState());
  store.dispatch({ type: "state/loaded", body: stateBody(DRIVE), origin: "poll", reqSeq: 0, now: 0 });
  const actions = createActions({ store, api: fakeApi(), sync: null, form: null, now: () => 1,
    dialogs: { confirmAction: () => { throw new Error("no dialog"); } } });
  actions.tap("K");
  actions.clearPick();
  await actions.logPlay();
  await actions.reset();
  assert.equal(store.getState().view.pick.k, null);
});

test("toasts and request stamps call the timers and the clock bare (Chromium throws 'Illegal invocation' otherwise)", async () => {
  const ctx = setup({ strict: true, state: DRIVE,
    replies: { "/api/play": { status: 200, body: stateBody({ ...DRIVE, version: 2, message: "Logged." }) } } });
  ctx.actions.tap("K");
  await ctx.actions.logPlay();
  assert.deepEqual(toastOf(ctx), { id: 1, text: "Logged.", err: false });
  assert.equal(ctx.view().pick.k, null, "the pick clears");
  assert.equal(ctx.timers.pending.size, 1, "the hide timer is set");
  ctx.timers.fire(TOAST_MS);
  assert.equal(toastOf(ctx), null);
});

test("a listener's bug while a saved play is applied is never 'Nothing was saved'; the pick clears (no double log)", async () => {
  const ctx = setup({ state: DRIVE, replies: { "/api/play": { status: 200, body: stateBody({ ...DRIVE, version: 2, message: "Logged." }) } } });
  ctx.store.subscribe((s, prev) => { if (s.server !== prev.server) throw new Error("component bug"); });
  ctx.actions.tap("K");
  await ctx.actions.logPlay();
  assert.deepEqual(toastOf(ctx), { id: 1, text: "Logged.", err: false });
  assert.equal(ctx.view().pick.k, null);
  assert.equal(ctx.store.getState().conn.failures, 0);
  assert.deepEqual(ctx.storeErrors.map((e) => e.message), ["component bug"]);
  await ctx.actions.logPlay();
  assert.equal(ctx.api.posts.length, 1, "Enter again sends nothing: the pick is gone");
});

test("a failure after a successful POST surfaces as that error, never as a network failure", async () => {
  const ctx = setup({ state: DRIVE, replies: { "/api/undo": { status: 200, body: stateBody({ ...DRIVE, version: 2, message: "Undone." }) } } });
  const real = ctx.store.dispatch;
  ctx.store.dispatch = (event) => {
    real(event);
    if (event.type === "state/loaded" && event.origin === "action") throw new Error("listener bug");
  };
  await assert.rejects(ctx.actions.undo(), /listener bug/);
  assert.notEqual(toastOf(ctx)?.text, ACTION_COPY.offline);
  assert.equal(ctx.store.getState().conn.failures, 0);
  assert.equal(ctx.store.getState().req.inflightActions, 0, "the request bookkeeping still closes");
  assert.deepEqual(ctx.kicks, [{ origin: "action" }]);
});

test("createActions validates its injected clock and timers", () => {
  const store = createStore(reducer, initialState());
  assert.throws(() => createActions({ store, api: fakeApi(), sync: null, form: null, dialogs: {}, now: 3 }), TypeError);
  assert.throws(() => createActions({ store, api: fakeApi(), sync: null, form: null, dialogs: {}, now: () => 1, timers: {} }),
    TypeError);
});
