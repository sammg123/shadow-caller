import assert from "node:assert/strict";
import test from "node:test";

import {
  BUDGET_SHARE, CALL_RESERVE_MS, CALL_RESERVE_SHARE, MAX_ANIMATED_QUEUE, MIN_ANIM_MS, OWN_ACTION_MAX_MS,
  STALE_WATCH_HOLD_MS, emptyAnim, enqueue, flushAll, markDone, markRebuilt, markStarted, nextJob, rebuild,
} from "../../static/js/core/anim-queue.js";
import { deepFreeze, loadTimeline } from "./fixtures.mjs";

const POLL = Object.freeze({ origin: "poll", hidden: false, reducedMotion: false });
const plays = (from, to) => deepFreeze(Array.from({ length: to - from + 1 }, (_, i) => ({ seq: from + i, kind: "play" })));
const NORMAL_MS = () => 2000;
const job = (anim, opts = {}) => nextJob(anim, { now: 1_000_000, watch: null, normalMs: NORMAL_MS, ...opts });
const playingWatch = (msAhead) => ({ state: "playing", next_at: 1_000_000 + msAhead });

test("the E4 constants", () => {
  assert.equal(MAX_ANIMATED_QUEUE, 3);
  assert.equal(BUDGET_SHARE, 0.8);
  assert.equal(MIN_ANIM_MS, 120);
  assert.equal(OWN_ACTION_MAX_MS, 800);
  assert.deepEqual(emptyAnim(), { token: 0, queue: [], playing: null, drawnThrough: 0, rebuilding: false });
});

test("5 queued: the 2 oldest draw instantly, the newest 3 animate (DC E4)", () => {
  const a = enqueue(deepFreeze(emptyAnim()), plays(1, 5), POLL);
  assert.deepEqual(a.queue.map((q) => [q.seq, q.instant]), [[1, true], [2, true], [3, false], [4, false], [5, false]]);
  assert.ok(a.queue.every((q) => q.origin === "poll"));
  const b = enqueue(deepFreeze(a), plays(6, 6), POLL);
  assert.deepEqual(b.queue.filter((q) => !q.instant).map((q) => q.seq), [4, 5, 6]);
});

test("admin rows are queued instant and never push a play out of the animated three", () => {
  const { rows } = loadTimeline();
  const a = enqueue(deepFreeze({ ...emptyAnim(), drawnThrough: 101 }), rows(102, 106), POLL);
  assert.deepEqual(a.queue.map((q) => [q.seq, q.instant]), [[102, true], [103, false], [104, false], [105, true], [106, false]]);
});

test("a hidden tab or reduced motion draws everything instantly, queued items included", () => {
  const queued = deepFreeze(enqueue(emptyAnim(), plays(1, 2), POLL));
  for (const opts of [{ ...POLL, hidden: true }, { ...POLL, reducedMotion: true }]) {
    const a = enqueue(queued, plays(3, 3), opts);
    assert.ok(a.queue.every((q) => q.instant), JSON.stringify(opts));
  }
});

test("enqueue skips rows already drawn, queued or playing", () => {
  const a = deepFreeze({ ...emptyAnim(), drawnThrough: 3, queue: [{ seq: 5, origin: "poll", instant: false }],
    playing: { seq: 4, startedAt: 0, durationMs: 100 } });
  assert.deepEqual(enqueue(a, plays(2, 6), POLL).queue.map((q) => q.seq), [5, 6]);
  assert.equal(enqueue(a, plays(2, 5), POLL), a, "nothing new: same object");
});

test("nextJob: nothing while empty, playing or rebuilding; instant items cost 0 ms", () => {
  assert.equal(job(emptyAnim()), null);
  const q = enqueue(emptyAnim(), plays(1, 1), POLL);
  assert.equal(job({ ...q, playing: { seq: 9, startedAt: 0, durationMs: 1 } }), null);
  assert.equal(job({ ...q, rebuilding: true }), null);
  const inst = enqueue(emptyAnim(), plays(1, 1), { ...POLL, hidden: true });
  assert.deepEqual(job(inst), { seq: 1, durationMs: 0, instant: true, token: 0 });
});

test("nextJob fits the watch budget, shared across the animated queue (DC E4)", () => {
  const one = enqueue(emptyAnim(), plays(1, 1), POLL);
  const two = enqueue(emptyAnim(), plays(1, 2), POLL);
  assert.deepEqual(job(one), { seq: 1, durationMs: 2000, instant: false, token: 0 }, "no watch: the normal length");
  assert.equal(job(one, { watch: playingWatch(1000) }).durationMs, 800);
  assert.equal(job(two, { watch: playingWatch(1000) }).durationMs, 400);
  assert.equal(job(one, { watch: playingWatch(10000) }).durationMs, 2000, "min(normal, budget)");
  assert.equal(job(one, { watch: { state: "paused", next_at: null } }).durationMs, 2000);
  assert.equal(job(one, { watch: playingWatch(-50) }).durationMs, 2000, "next_at in the past is ignored");
  assert.equal(job(one, { watch: playingWatch(120000) }).durationMs, 2000, "clock-skew guard");
});

test("before a caller snap the play leaves the next call its reserve, at most 70% of the wait (G1-1)", () => {
  assert.deepEqual(CALL_RESERVE_MS, { slow: 4100, demo: 3200, fast: 2400 });
  assert.equal(CALL_RESERVE_SHARE, 0.7);
  const one = enqueue(emptyAnim(), plays(1, 1), POLL);
  const two = enqueue(emptyAnim(), plays(1, 2), POLL);
  const before = (msAhead, speed, nextKind = "caller_snap") => ({ ...playingWatch(msAhead), speed, next_kind: nextKind });
  // 4x: the 4.8 s floor seen 200 ms late. The call keeps 3.2 s (a 0.6 s verdict, the fade-in, 2 s lit); the play 1.4 s.
  assert.equal(job(one, { watch: before(4600, 4) }).durationMs, 1400);
  assert.equal(job(two, { watch: before(4600, 4) }).durationMs, 700, "shared across the queue");
  // Below 4x the verdict's beat is 1.5 s: 4.1 s for the call. 2x: the 6 s floor; 1x: a normal 2 s play keeps its length.
  assert.equal(job(one, { watch: before(5750, 2) }).durationMs, 1725);
  assert.equal(job(one, { watch: before(6750, 1) }).durationMs, 2000);
  assert.equal(job(one, { watch: before(6750, 1), normalMs: () => 4000 }).durationMs, 2650);
  // 10x: the 3.6 s floor. 2.4 s for the call (1 s lit), the play the rest.
  assert.equal(job(one, { watch: before(3500, 10) }).durationMs, 1100);
  // Late, the play gives up its time first; the reserve never takes more than 70% of what is left.
  assert.equal(job(one, { watch: before(2000, 10) }).durationMs, 600);
  // Any other row next: the share as before. No speed: the 4x reserve.
  for (const kind of ["snap", "kick", "admin", "admin_end", null, undefined]) {
    assert.equal(job(one, { watch: { ...playingWatch(1000), speed: 4, next_kind: kind } }).durationMs, 800, String(kind));
  }
  assert.equal(job(one, { watch: { ...playingWatch(4600), next_kind: "caller_snap" } }).durationMs, 1400);
  // A scaled-down test pace (SHADOW_WATCH_SCALE): too little left for a play, so it draws at once, as it did.
  assert.deepEqual(job(one, { watch: before(225, 4) }), { seq: 1, durationMs: 0, instant: true, token: 0 });
});

test("a watch object older than the head row is not budgeted on: the play waits for the next poll (G1-1)", () => {
  assert.equal(STALE_WATCH_HOLD_MS, 600);
  const q = enqueue({ ...emptyAnim(), drawnThrough: 6 }, plays(7, 7), POLL);
  // idx 6: the watch still waits on row 7 itself (next_at is its landing, just past). Budgeting on it gave the play its
  // full length and took the next call's time.
  const stale = { state: "playing", idx: 6, next_at: 1_000_000 - 50, next_kind: "caller_snap", speed: 10 };
  assert.equal(job(q, { watch: stale }), null);
  assert.equal(job(q, { watch: stale, now: 1_000_000 + 549 }), null);
  assert.equal(job(q, { watch: stale, now: 1_000_000 + 550 }).durationMs, 2000, "never held past 600 ms");
  const fresh = { state: "playing", idx: 7, next_at: 1_000_000 + 3500, next_kind: "caller_snap", speed: 10 };
  assert.equal(job(q, { watch: fresh }).durationMs, 1100);
  const hidden = enqueue({ ...emptyAnim(), drawnThrough: 6 }, plays(7, 7), { ...POLL, hidden: true });
  assert.deepEqual(job(hidden, { watch: stale }), { seq: 7, durationMs: 0, instant: true, token: 0 }, "instant: now");
  assert.equal(job(q, { watch: { ...stale, state: "paused" } }).durationMs, 2000, "only a playing watch");
  assert.equal(job(q, { watch: { ...stale, idx: undefined } }).durationMs, 2000, "no idx: as before");
  const ahead = { ...stale, next_at: 1_000_000 + 5000, next_kind: "snap" };
  assert.equal(job(q, { watch: ahead }).durationMs, 2000, "a landing still ahead is not this row's: no hold");
});

test("nextJob caps the operator's own rows and turns tiny lengths into instant draws", () => {
  const own = enqueue(emptyAnim(), plays(1, 1), { ...POLL, origin: "action" });
  assert.equal(job(own).durationMs, OWN_ACTION_MAX_MS);
  const tiny = job(enqueue(emptyAnim(), plays(1, 1), POLL), { watch: playingWatch(100) });
  assert.deepEqual(tiny, { seq: 1, durationMs: 0, instant: true, token: 0 }, "0.8 * 100 ms is under MIN_ANIM_MS");
  for (const bad of [() => 0, () => Number.NaN, () => -5, () => Infinity]) {
    assert.equal(job(enqueue(emptyAnim(), plays(1, 1), POLL), { normalMs: bad }).instant, true);
  }
});

test("markStarted and markDone move the head through playing into drawnThrough", () => {
  const q = deepFreeze(enqueue(emptyAnim(), plays(1, 2), POLL));
  const j = job(q);
  const s = deepFreeze(markStarted(q, j, 5000));
  assert.deepEqual(s.playing, { seq: 1, startedAt: 5000, durationMs: 2000 });
  assert.deepEqual(s.queue.map((x) => x.seq), [2]);
  const d = markDone(s, 1, 0);
  assert.equal(d.playing, null);
  assert.equal(d.drawnThrough, 1);
  assert.equal(markDone(s, 1, 7), s, "a stale token is ignored");
  assert.equal(markDone(s, 2, 0), s, "only the playing seq can finish");
  assert.equal(markStarted(s, { seq: 2, durationMs: 1 }, 1), s, "one play at a time");
  assert.equal(markStarted(q, { seq: 9, durationMs: 1 }, 1), q, "only the head can start");
});

test("rebuild bumps the token and draws through n without animation", () => {
  const q = deepFreeze({ ...enqueue(emptyAnim(), plays(1, 3), POLL), playing: { seq: 9, startedAt: 0, durationMs: 1 } });
  assert.deepEqual(rebuild(q, 183), { token: 1, queue: [], playing: null, drawnThrough: 183, rebuilding: true });
  const r = deepFreeze(rebuild(q, 183));
  assert.equal(markRebuilt(r, 0), r, "stale token");
  assert.equal(markRebuilt(r, 1).rebuilding, false);
});

test("flushAll makes every queued item instant and hurries the running play", () => {
  const q = deepFreeze({ ...enqueue(emptyAnim(), plays(2, 4), POLL), playing: { seq: 1, startedAt: 0, durationMs: 2000 } });
  const f = flushAll(q);
  assert.ok(f.queue.every((x) => x.instant));
  assert.equal(f.playing.hurry, true);
  assert.equal(flushAll(deepFreeze(f)), f, "nothing left to flush: same object");
  assert.equal(flushAll(deepFreeze(emptyAnim())).playing, null);
});
