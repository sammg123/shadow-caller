import assert from "node:assert/strict";
import test from "node:test";

import { initialState, reducer } from "../../static/js/core/reducer.js";
import { EMPTY_PICK } from "../../static/js/core/selection.js";
import { deepFreeze, loadTimeline, stateBody, stubRows, timelineBody } from "./fixtures.mjs";

const TL = loadTimeline();
const EPOCH = TL.body.epoch;
const run = (state, ...events) => events.reduce((s, e) => reducer(deepFreeze(s), e), deepFreeze(state));
const pointer = (n, epoch = EPOCH) => ({ n, epoch, source: "espn", mode: "replay" });
const body = (over = {}) => deepFreeze(stateBody(over));
const loaded = (b, over = {}) => ({ type: "state/loaded", body: b, origin: "poll", reqSeq: 0, now: 1000, ...over });
const tlLoaded = (resp, over = {}) => ({ type: "timeline/loaded", resp, origin: "poll", hidden: false, reducedMotion: false, now: 1000, ...over });

/** A booted store: timeline rows 1-15 drawn, presented state at n 15. */
function booted(over = {}) {
  const s = run(initialState(), tlLoaded(timelineBody(TL.body, { rows: TL.rows(1, 15) })));
  const rebuilt = run(s, { type: "anim/rebuilt", token: s.anim.token, now: 1000 });
  return run(rebuilt, loaded(body({ timeline: pointer(15), ...over })));
}

test("initialState has the 2.1 shape and is frozen", () => {
  const s = initialState();
  assert.ok(Object.isFrozen(s) && Object.isFrozen(s.view.pick));
  assert.deepEqual(s.boot, { phase: "loading", attempts: 0, error: null });
  assert.deepEqual(s.conn, { failures: 0, lastOkAt: null, retryAt: null, lastError: null });
  assert.deepEqual(s.prefs, { motion: "full", world: "neutral", ambient: "room", scene: "auto", watchSpeed: 4 });
  assert.deepEqual(s.req, { seq: 0, lastActionApplied: 0, inflightActions: 0 });
  assert.equal(s.view.pick, EMPTY_PICK);
  assert.deepEqual(s.view.flag, { open: false, gen: 0 });
  assert.deepEqual(s.view.booth, { open: false, auto: false });
  assert.deepEqual(s.view.review, { seq: null });
  assert.equal(initialState({ prefs: { motion: "reduced", world: "x" } }).prefs.motion, "reduced");
  assert.equal(initialState({ prefs: { motion: "sideways" } }).prefs.motion, "full", "bad prefs fall back");
});

test("unknown events return the same state, inherited names included", () => {
  const s = deepFreeze(initialState());
  for (const type of ["nope", "toString", "constructor", "__proto__", "hasOwnProperty"]) assert.equal(reducer(s, { type }), s, type);
});

test("boot/attempt and boot/failed track attempts and the retry time (#120)", () => {
  const s = run(initialState(), { type: "boot/attempt", now: 1 });
  assert.deepEqual(s.boot, { phase: "loading", attempts: 1, error: null });
  const f = run(s, { type: "boot/failed", now: 2, error: "network", retryAt: 1002 });
  assert.deepEqual(f.boot, { phase: "failed", attempts: 1, error: "network" });
  assert.equal(f.conn.retryAt, 1002);
  assert.equal(run(f, { type: "boot/attempt", now: 3 }).boot.phase, "failed", "keeps saying retrying");
});

test("state/loaded from an old server presents at once and boots (#116)", () => {
  const b = body();
  const s = run(initialState(), loaded(b));
  assert.equal(s.server, b);
  assert.equal(s.presented, b);
  assert.equal(s.boot.phase, "ready");
  assert.ok(Object.isFrozen(s.server.sit));
});

test("a state without keys shows the restart screen (#119)", () => {
  const { keys, ...old } = stateBody();
  assert.ok(keys);
  assert.equal(run(initialState(), loaded(old)).boot.phase, "restart");
});

test("a poll body older than an applied action is dropped (3.2)", () => {
  const s = run(initialState(), { type: "req/action-start", reqSeq: 5 }, loaded(body({ version: 9 }), { origin: "action", reqSeq: 5 }),
    { type: "req/action-end", reqSeq: 5 });
  assert.equal(s.req.lastActionApplied, 5);
  assert.equal(run(s, loaded(body({ version: 8 }), { reqSeq: 4 })), s);
  assert.equal(run(s, loaded(body({ version: 10 }), { reqSeq: 5 })).server.version, 10);
});

test("bodies that are not a state are ignored", () => {
  const s = deepFreeze(initialState());
  assert.equal(reducer(s, loaded({ error: "Already playing" })), s);
  assert.equal(reducer(s, { type: "version/loaded", body: "x", now: 1 }), s);
});

test("G7: a presented state with no drive closes the flag panel and an auto-opened booth", () => {
  const open = run(booted({ drive_active: true }), { type: "flag/open", autoBooth: true });
  assert.deepEqual([open.view.flag.open, open.view.booth.open, open.view.booth.auto], [true, true, true]);
  const kept = run(open, loaded(body({ timeline: pointer(15), drive_active: true, version: 2 })));
  assert.equal(kept.view.flag.open, true);
  const closed = run(open, loaded(body({ timeline: pointer(15), drive_active: false, version: 3 })));
  assert.equal(closed.view.flag.open, false);
  assert.deepEqual(closed.view.booth, { open: false, auto: false });
});

test("G12: a new message from a poll goes to the background line, never at boot or during an action", () => {
  const s = booted({ message: "Logged." });
  const bg = run(s, loaded(body({ timeline: pointer(15), version: 2, message: "No play: defensive offside on TB." }), { now: 7 }));
  assert.deepEqual(bg.view.bgMessage, { text: "No play: defensive offside on TB.", at: 7 });
  assert.equal(run(s, loaded(body({ timeline: pointer(15), version: 2, message: "Logged." }))).view.bgMessage, null);
  const busy = run(s, { type: "req/action-start", reqSeq: 1 }, loaded(body({ timeline: pointer(15), version: 2, message: "X" }), { reqSeq: 1 }));
  assert.equal(busy.view.bgMessage, null);
  assert.equal(booted().view.bgMessage, null, "the first state is not news");
});

test("G12 under decision 2: a poll's message waits until its play is drawn, then shows once", () => {
  const s = booted({ message: "Logged." });
  const queued = run(s, tlLoaded(timelineBody(TL.body, { rows: stubRows(16, 16), since: 15, reset: false })));
  const turnover = "Turnover. Waiting for the next Dallas drive.";
  const news = run(queued, loaded(body({ timeline: pointer(16), version: 2, message: turnover }), { now: 7 }));
  assert.equal(news.presented.message, "Logged.", "row 16 is not drawn yet");
  assert.equal(news.view.bgMessage, null, "nothing on screen runs ahead of the ball");
  const { token } = news.anim;
  const drawn = run(news, { type: "anim/started", seq: 16, token, durationMs: 400, now: 8 },
    { type: "anim/done", seq: 16, token, now: 9 });
  assert.equal(drawn.presented.message, turnover);
  assert.deepEqual(drawn.view.bgMessage, { text: turnover, at: 9 });
  const again = run(drawn, loaded(body({ timeline: pointer(16), version: 3, message: turnover }), { now: 10 }));
  assert.deepEqual(again.view.bgMessage, { text: turnover, at: 9 }, "the same message is not news twice");
});

test("G12: the lag valve reveals a waiting message with the state it came with", () => {
  const s = booted({ message: "Logged." });
  const queued = run(s, tlLoaded(timelineBody(TL.body, { rows: stubRows(16, 16), since: 15, reset: false })));
  const news = run(queued, loaded(body({ timeline: pointer(16), version: 2, message: "First down." }), { now: 1000 }));
  assert.equal(news.view.bgMessage, null);
  const late = run(news, { type: "tick", now: 5000 });
  assert.equal(late.presented.version, 2);
  assert.deepEqual(late.view.bgMessage, { text: "First down.", at: 5000 });
});

test("version/loaded stores the body; state/loaded refreshes its feed and watch", () => {
  const v = deepFreeze({ version: 1, epoch: EPOCH, timeline_n: 15, feed: { on: false, state: "off", last_poll: "1" }, watch: { state: "playing" } });
  const s = run(booted(), { type: "version/loaded", body: v, now: 5 });
  assert.equal(s.version, v);
  const after = run(s, loaded(body({ timeline: pointer(15), version: 2, watch: { state: "paused" },
    feed: { on: false, state: "off", last_poll: "2", event_id: "401872980" } }), { origin: "action", reqSeq: 1 }));
  assert.equal(after.version.watch.state, "paused");
  assert.equal(after.version.feed.last_poll, "2");
  assert.equal(after.version.timeline_n, 15);
});

test("timeline/loaded with a reset rebuilds without animation and leaves review", () => {
  const s = run(booted(), { type: "review/set", seq: 7 });
  const out = run(s, tlLoaded(timelineBody(TL.body, { rows: TL.rows(1, 15), epoch: "new-epoch" })));
  assert.equal(out.timeline.epoch, "new-epoch");
  assert.deepEqual([out.anim.token, out.anim.rebuilding, out.anim.drawnThrough], [s.anim.token + 1, true, 15]);
  assert.deepEqual(out.view.review, { seq: null });
});

test("timeline/loaded appends queue the new rows; a gap only marks needsFull", () => {
  const s = run(initialState(), tlLoaded(timelineBody(TL.body, { rows: stubRows(1, 100) })));
  const base = run(s, { type: "anim/rebuilt", token: s.anim.token, now: 1 });
  const out = run(base, tlLoaded(timelineBody(TL.body, { rows: TL.rows(101, 104), since: 100, reset: false }), { origin: "action" }));
  assert.deepEqual(out.anim.queue.map((q) => [q.seq, q.origin]), [[101, "action"], [102, "action"], [103, "action"], [104, "action"]]);
  const gap = run(base, tlLoaded(timelineBody(TL.body, { rows: TL.rows(102, 104), since: 101, reset: false })));
  assert.equal(gap.timeline.needsFull, true);
  assert.equal(gap.anim, base.anim);
});

test("pred patching runs on both state/loaded and timeline/loaded (3.6)", () => {
  const retag = [{ seq: 1, espn_id: "40187298068", family: "pa", leaf: null, name: "Play-action, incomplete", retagged: true }];
  const s = booted();
  const patched = run(s, loaded(body({ timeline: pointer(15), version: 2, log: retag })));
  assert.equal(patched.timeline.rows[1].pred.family, "pa");
  assert.equal(patched.timeline.rows[1].geo, s.timeline.rows[1].geo);
  const later = run(initialState(), loaded(body({ log: retag })), tlLoaded(timelineBody(TL.body, { rows: TL.rows(1, 15) })));
  assert.equal(later.timeline.rows[1].pred.name, "Play-action, incomplete");
});

test("conn/ok and conn/failed count failures (G11)", () => {
  const f = run(initialState(), { type: "conn/failed", now: 5, error: "timeout", retryAt: 1005 },
    { type: "conn/failed", now: 6, error: "network", retryAt: 2006 });
  assert.deepEqual(f.conn, { failures: 2, lastOkAt: null, retryAt: 2006, lastError: "network" });
  assert.deepEqual(run(f, { type: "conn/ok", now: 9 }).conn, { failures: 0, lastOkAt: 9, retryAt: null, lastError: null });
});

test("anim events move the queue and present the waiting state when its rows are drawn", () => {
  const s = booted();
  const S2 = body({ timeline: pointer(17), version: 5 });
  const queued = run(s, tlLoaded(timelineBody(TL.body, { rows: stubRows(16, 17), since: 15, reset: false })), loaded(S2, { now: 100 }));
  assert.equal(queued.presented.version, 1, "S' waits for its rows");
  const tok = queued.anim.token;
  const started = run(queued, { type: "anim/started", seq: 16, token: tok, durationMs: 500, now: 110 });
  assert.equal(started.anim.playing.seq, 16);
  assert.equal(run(started, { type: "anim/started", seq: 17, token: tok + 9, durationMs: 1, now: 1 }), started, "stale token");
  const done16 = run(started, { type: "anim/done", seq: 16, token: tok, now: 600 });
  assert.equal(done16.anim.drawnThrough, 16);
  assert.equal(done16.presented.version, 1);
  const done17 = run(done16, { type: "anim/started", seq: 17, token: tok, durationMs: 300, now: 610 },
    { type: "anim/done", seq: 17, token: tok, now: 900 });
  assert.equal(done17.presented, S2, "every row drawn: the HUD catches up");
  assert.equal(done17.presentedSince, null);
});

test("anim/rebuilt ends the rebuild and anim/flush makes the queue instant", () => {
  const s = run(initialState(), tlLoaded(timelineBody(TL.body, { rows: TL.rows(1, 15) })));
  assert.equal(s.anim.rebuilding, true);
  assert.equal(run(s, { type: "anim/rebuilt", token: s.anim.token + 1, now: 1 }).anim.rebuilding, true, "stale token");
  const r = run(s, { type: "anim/rebuilt", token: s.anim.token, now: 1 });
  assert.equal(r.anim.rebuilding, false);
  const q = run(r, tlLoaded(timelineBody(TL.body, { rows: stubRows(16, 17), since: 15, reset: false })));
  assert.ok(run(q, { type: "anim/flush", now: 2 }).anim.queue.every((x) => x.instant));
});

test("tick is the lag valve (MAX_PRESENT_LAG_MS)", () => {
  const S2 = body({ timeline: pointer(16), version: 5 });
  const s = run(booted(), tlLoaded(timelineBody(TL.body, { rows: stubRows(16, 16), since: 15, reset: false })), loaded(S2, { now: 100 }));
  assert.equal(run(s, { type: "tick", now: 4099 }).presented.version, 1);
  const valve = run(s, { type: "tick", now: 4100 });
  assert.equal(valve.presented, S2);
  assert.ok(valve.anim.queue.every((x) => x.instant));
});

test("snapshots below the drawn row are pruned as rows land", () => {
  const s = booted();
  const two = run(s, tlLoaded(timelineBody(TL.body, { rows: stubRows(16, 16), since: 15, reset: false })),
    tlLoaded(timelineBody(TL.body, { rows: stubRows(17, 17), since: 16, reset: false })));
  assert.deepEqual(two.timeline.snapshots.map((x) => x.n), [15, 16, 17]);
  const tok = two.anim.token;
  const drawn = run(two, { type: "anim/flush", now: 1 }, { type: "anim/started", seq: 16, token: tok, durationMs: 0, now: 1 },
    { type: "anim/done", seq: 16, token: tok, now: 1 }, { type: "anim/started", seq: 17, token: tok, durationMs: 0, now: 1 },
    { type: "anim/done", seq: 17, token: tok, now: 1 });
  assert.deepEqual(drawn.timeline.snapshots.map((x) => x.n), [17]);
});

test("pick events follow selection.js and the served keys", () => {
  const s = booted();
  const p = run(s, { type: "pick/tap", key: "P" }, { type: "pick/tap", key: "P" }, { type: "pick/outcome", out: "incomplete" });
  assert.deepEqual(p.view.pick, { k: "P", i: 1, out: "incomplete" });
  assert.deepEqual(run(s, { type: "pick/leaf", leaf: "run_edge_left" }).view.pick, { k: "J", i: 1, out: null });
  assert.equal(run(s, { type: "pick/leaf", leaf: "nope" }), s);
  assert.equal(run(p, { type: "pick/clear" }).view.pick, EMPTY_PICK);
  assert.equal(run(s, { type: "pick/clear" }), s, "already empty: same state");
});

test("flag/open bumps gen (G6); a manual booth survives flag/close", () => {
  const s = booted({ drive_active: true });
  const o = run(s, { type: "flag/open" }, { type: "flag/close" }, { type: "flag/open" });
  assert.deepEqual(o.view.flag, { open: true, gen: 2 });
  assert.deepEqual(o.view.booth, { open: false, auto: false }, "no booth unless the world asks");
  const manual = run(s, { type: "booth/toggle" }, { type: "flag/open", autoBooth: true }, { type: "flag/close" });
  assert.deepEqual(manual.view.booth, { open: true, auto: false });
  const autoThenB = run(s, { type: "flag/open", autoBooth: true }, { type: "booth/toggle" });
  assert.deepEqual(autoThenB.view.booth, { open: false, auto: false });
});

test("view flags: scorecard, camera, review, hover", () => {
  const s = booted();
  const v = run(s, { type: "scorecard/toggle" }, { type: "camera/set", id: "endzone" }, { type: "review/set", seq: 9 },
    { type: "hover/leaf", leaf: "pa_short" });
  assert.equal(v.view.scorecardOpen, true);
  assert.equal(v.view.camera, "endzone");
  assert.deepEqual(v.view.review, { seq: 9 });
  assert.equal(v.view.hoverLeaf, "pa_short");
  const c = run(v, { type: "scorecard/close" }, { type: "review/set", seq: null }, { type: "hover/leaf", leaf: null });
  assert.deepEqual([c.view.scorecardOpen, c.view.review.seq, c.view.hoverLeaf], [false, null, null]);
  assert.equal(run(c, { type: "scorecard/close" }), c);
  assert.equal(run(c, { type: "review/set", seq: "9" }), c, "a bad seq is ignored");
});

test("strip memory: the 50 side and rejected text (FI 4.4, 5.5)", () => {
  const s = run(booted(), { type: "side/fifty", team: "TB" }, { type: "strip/rejected", field: "iClock", text: "16:00" });
  assert.equal(s.view.sideAtFifty, "TB");
  assert.deepEqual(s.view.stripRejected, { iClock: "16:00" });
  const c = run(s, { type: "strip/clear", field: "iClock" });
  assert.deepEqual(c.view.stripRejected, {});
  assert.equal(run(c, { type: "strip/clear", field: "iClock" }), c);
  assert.equal(run(c, { type: "strip/rejected", field: "__proto__", text: "x" }), c, "only the seven strip fields");
});

test("toast/hide only hides the toast it was scheduled for (FI 4.5)", () => {
  const s = run(booted(), { type: "toast/show", id: 1, text: "Logged.", err: false }, { type: "toast/show", id: 2, text: "Nope", err: true });
  assert.deepEqual(s.view.toast, { id: 2, text: "Nope", err: true });
  assert.equal(run(s, { type: "toast/hide", id: 1 }), s);
  assert.equal(run(s, { type: "toast/hide", id: 2 }).view.toast, null);
  assert.deepEqual(run(s, { type: "bg/message", text: "Drive 3 started (ESPN).", now: 4 }).view.bgMessage,
    { text: "Drive 3 started (ESPN).", at: 4 });
});

test("req events count in-flight actions and remember the newest applied", () => {
  const s = run(initialState(), { type: "req/action-start", reqSeq: 1 }, { type: "req/action-start", reqSeq: 2 });
  assert.deepEqual(s.req, { seq: 2, lastActionApplied: 0, inflightActions: 2 });
  const e = run(s, { type: "req/action-end", reqSeq: 2 }, { type: "req/action-end", reqSeq: 1 });
  assert.deepEqual(e.req, { seq: 2, lastActionApplied: 2, inflightActions: 0 });
  assert.equal(run(e, { type: "req/action-end", reqSeq: 1 }).req.inflightActions, 0, "never below zero");
});

test("prefs/set accepts known keys and valid values only", () => {
  const s = run(initialState(), { type: "prefs/set", key: "watchSpeed", value: 10 }, { type: "prefs/set", key: "ambient", value: "dark" });
  assert.equal(s.prefs.watchSpeed, 10);
  assert.equal(s.prefs.ambient, "dark");
  for (const [key, value] of [["watchSpeed", 3], ["ambient", "dim"], ["motion", 1], ["nope", 1], ["scene", "3d"]]) {
    assert.equal(run(s, { type: "prefs/set", key, value }), s, `${key}=${value}`);
  }
  assert.equal(run(s, { type: "prefs/set", key: "world", value: "booth-sheet" }).prefs.world, "booth-sheet");
});

test("hidden or reduced-motion timeline loads queue instant draws", () => {
  const s = booted();
  const out = run(s, tlLoaded(timelineBody(TL.body, { rows: stubRows(16, 18), since: 15, reset: false }), { hidden: true }));
  assert.ok(out.anim.queue.every((q) => q.instant));
});
