import assert from "node:assert/strict";
import test from "node:test";

import { initialState, reducer } from "../../static/js/core/reducer.js";
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

test("initialState has the 2.1 shape and is frozen; the view holds no user input (restructure-v2.md 1)", () => {
  const s = initialState();
  assert.ok(Object.isFrozen(s) && Object.isFrozen(s.view.playback));
  assert.deepEqual(s.boot, { phase: "loading", attempts: 0, error: null });
  assert.deepEqual(s.conn, { failures: 0, lastOkAt: null, retryAt: null, lastError: null });
  assert.deepEqual(s.prefs, { motion: "full", world: "neutral", ambient: "room", scene: "auto", watchSpeed: 4 });
  assert.deepEqual(s.req, { seq: 0, lastActionApplied: 0, inflightActions: 0 });
  assert.deepEqual(s.view, { camera: null, hoverLeaf: null, toast: null, settingsOpen: false,
    playback: { kind: null, target: null } });
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

test("a poll's new message changes nothing on screen: the page has no background line any more", () => {
  const s = booted({ message: "Logged." });
  const bg = run(s, loaded(body({ timeline: pointer(15), version: 2, message: "No play: defensive offside on TB." }), { now: 7 }));
  assert.equal(bg.view, s.view);
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

test("timeline/loaded with a reset rebuilds without animation", () => {
  const s = booted();
  const out = run(s, tlLoaded(timelineBody(TL.body, { rows: TL.rows(1, 15), epoch: "new-epoch" })));
  assert.equal(out.timeline.epoch, "new-epoch");
  assert.deepEqual([out.anim.token, out.anim.rebuilding, out.anim.drawnThrough], [s.anim.token + 1, true, 15]);
  assert.equal(out.view, s.view);
});

test("restructure-v2.md 5: after a jump the rows up to where it landed draw instantly, later ones animate", () => {
  const s = booted();
  const jumped = run(s, { type: "anim/jump", epoch: EPOCH, n: 17 });
  assert.deepEqual(jumped.anim.jump, { epoch: EPOCH, n: 17 });
  const out = run(jumped, tlLoaded(timelineBody(TL.body, { rows: stubRows(16, 19), since: 15, reset: false })));
  assert.deepEqual(out.anim.queue.map((q) => [q.seq, q.instant]), [[16, true], [17, true], [18, false], [19, false]]);
  const otherGame = run(s, { type: "anim/jump", epoch: "another-epoch", n: 17 },
    tlLoaded(timelineBody(TL.body, { rows: stubRows(16, 16), since: 15, reset: false })));
  assert.equal(otherGame.anim.queue[0].instant, false, "a jump to another game leaves this one's rows alone");
});

test("anim/jump ignores a malformed landing", () => {
  const s = booted();
  for (const bad of [{ epoch: "", n: 3 }, { epoch: EPOCH, n: -1 }, { epoch: EPOCH, n: 1.5 }, { n: 3 }]) {
    assert.equal(run(s, { type: "anim/jump", ...bad }), s, JSON.stringify(bad));
  }
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

test("view: camera, hover, the settings menu and the playback request in flight", () => {
  const s = booted();
  const v = run(s, { type: "camera/set", id: "blimp" }, { type: "hover/leaf", leaf: "pa_short" }, { type: "settings/toggle" },
    { type: "playback/start", kind: "seek", target: 40 });
  assert.equal(v.view.camera, "blimp");
  assert.equal(v.view.hoverLeaf, "pa_short");
  assert.equal(v.view.settingsOpen, true);
  assert.deepEqual(v.view.playback, { kind: "seek", target: 40 });
  const c = run(v, { type: "settings/close" }, { type: "hover/leaf", leaf: null }, { type: "playback/end" });
  assert.deepEqual([c.view.settingsOpen, c.view.hoverLeaf, c.view.playback], [false, null, { kind: null, target: null }]);
  assert.equal(run(c, { type: "settings/close" }), c);
  assert.equal(run(c, { type: "playback/end" }), c);
  assert.equal(run(v, { type: "settings/toggle" }).view.settingsOpen, false);
  for (const bad of [{ kind: "nope" }, { kind: "seek", target: -2 }, { kind: "seek", target: "4" }]) {
    assert.equal(run(c, { type: "playback/start", ...bad }), c, JSON.stringify(bad));
  }
  assert.deepEqual(run(c, { type: "playback/start", kind: "back" }).view.playback, { kind: "back", target: null });
  assert.deepEqual(run(c, { type: "playback/start", kind: "select" }).view.playback, { kind: "select", target: null },
    "restructure-v2.md 11: opening another game from the picker shares the playback lane");
});

test("toast/hide only hides the toast it was scheduled for (FI 4.5)", () => {
  const s = run(booted(), { type: "toast/show", id: 1, text: "Logged.", err: false }, { type: "toast/show", id: 2, text: "Nope", err: true });
  assert.deepEqual(s.view.toast, { id: 2, text: "Nope", err: true });
  assert.equal(run(s, { type: "toast/hide", id: 1 }), s);
  assert.equal(run(s, { type: "toast/hide", id: 2 }).view.toast, null);
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
