import assert from "node:assert/strict";
import test from "node:test";

import { emptyAnim, enqueue } from "../../static/js/core/anim-queue.js";
import { MAX_PRESENT_LAG_MS, advancePresented, isPresentable, presentedTimeline, presentedView } from "../../static/js/core/present.js";
import { emptyTimeline } from "../../static/js/core/timeline-cache.js";
import { deepFreeze, loadContractRows, stateBody, stubRows } from "./fixtures.mjs";

const EPOCH = "k3v9-2";
const S = deepFreeze(stateBody({ version: 411, timeline: { n: 104, epoch: EPOCH, source: "espn", mode: "watch" } }));
const S2 = deepFreeze(stateBody({ version: 412, timeline: { n: 105, epoch: EPOCH, source: "espn", mode: "watch" } }));
const TIMELINE = deepFreeze({ ...emptyTimeline(), epoch: EPOCH, n: 105, rows: stubRows(1, 105) });
const anim = (drawnThrough, over = {}) => deepFreeze({ ...emptyAnim(), drawnThrough, ...over });
const world = (over = {}) => deepFreeze({ server: S2, presented: S, presentedSince: null, timeline: TIMELINE, anim: anim(104), ...over });

test("MAX_PRESENT_LAG_MS is the 4 s safety valve", () => assert.equal(MAX_PRESENT_LAG_MS, 4000));

test("isPresentable waits until the field has drawn every row the state knows about", () => {
  assert.equal(isPresentable(S2, TIMELINE, anim(104)), false);
  assert.equal(isPresentable(S2, TIMELINE, anim(105)), true);
  assert.equal(isPresentable(S2, TIMELINE, anim(183)), true);
  assert.equal(isPresentable(S2, TIMELINE, anim(105, { rebuilding: true })), false);
  assert.equal(isPresentable(S2, { ...TIMELINE, epoch: "old" }, anim(105)), false);
  assert.equal(isPresentable(stateBody(), TIMELINE, anim(0)), true, "an old server without a pointer presents at once");
  assert.equal(isPresentable(null, TIMELINE, anim(0)), false);
});

test("S' with timeline.n 105 waits for drawnThrough 105 (3.4 step 2 to 4)", () => {
  const waiting = advancePresented(world(), 1000);
  assert.equal(waiting.presented, S);
  assert.equal(waiting.presentedSince, 1000);
  const still = advancePresented(deepFreeze(waiting), 3000);
  assert.equal(still, waiting, "nothing new: same object");
  const drawn = advancePresented(deepFreeze({ ...waiting, anim: anim(105) }), 3500);
  assert.equal(drawn.presented, S2);
  assert.equal(drawn.presentedSince, null);
});

test("the 4 s valve presents anyway and flushes the queue", () => {
  const queued = enqueue(anim(104, { playing: { seq: 105, startedAt: 0, durationMs: 9000 } }), [{ seq: 106, kind: "play" }],
    { origin: "poll", hidden: false, reducedMotion: false });
  const lagging = deepFreeze({ ...world(), anim: queued, presentedSince: 1000 });
  assert.equal(advancePresented(lagging, 4999).presented, S);
  const out = advancePresented(lagging, 5000);
  assert.equal(out.presented, S2);
  assert.equal(out.presentedSince, null);
  assert.ok(out.anim.queue.every((q) => q.instant));
  assert.equal(out.anim.playing.hurry, true);
});

test("advancePresented leaves a caught-up state alone", () => {
  const caught = world({ presented: S2 });
  assert.equal(advancePresented(caught, 9), caught);
  assert.equal(advancePresented(world({ server: null, presented: null }), 9).presented, null);
  const stale = world({ presented: S2, presentedSince: 5 });
  assert.equal(advancePresented(stale, 9).presentedSince, null);
});

test("presentedTimeline shows rows and panels only up to the drawn row (3.4)", () => {
  const { body } = loadContractRows();
  const snapshots = [104, 183].map((n) => ({ n, ...body.snapshots[String(n)] }));
  const timeline = deepFreeze({ ...emptyTimeline(), epoch: body.epoch, n: 183, rows: stubRows(1, 183), snapshots,
    teams: body.teams, field: body.field, meta: body.meta, wpStart: body.wp_start });
  const mid = presentedTimeline(deepFreeze({ timeline, anim: anim(120) }));
  assert.equal(mid.rows.length, 120);
  assert.equal(mid.status.last_seq, 104, "the newest snapshot at or below 120");
  assert.equal(mid.status.state, "in");
  assert.equal(mid.drives.length, 12);
  assert.equal(mid.teams, body.teams);
  assert.equal(mid.wpStart, 0.8619);
  const end = presentedTimeline(deepFreeze({ timeline, anim: anim(183) }));
  assert.equal(end.rows, timeline.rows, "fully drawn: the cached array itself");
  assert.equal(end.status.state, "post");
  assert.equal(end.box.DAL.yards, 366);
  const again = presentedTimeline(deepFreeze({ timeline, anim: anim(183) }));
  assert.equal(again, end, "memoized by timeline and drawnThrough");
  const none = presentedTimeline(deepFreeze({ timeline: emptyTimeline(), anim: anim(0) }));
  assert.deepEqual(none.rows, []);
  assert.equal(none.status, null);
  assert.equal(mid.source, null, "source and mode come from the cache");
});

test("presentedView is the pv every view model takes (2.3)", () => {
  const state = deepFreeze({ ...world(), view: { flag: { open: false } }, prefs: { motion: "full" }, conn: { failures: 0 },
    boot: { phase: "ready" }, version: { version: 412 } });
  const pv = presentedView(state, 77);
  assert.equal(pv.presented, S);
  assert.equal(pv.tl.rows.length, 104);
  assert.deepEqual([pv.version, pv.view, pv.prefs, pv.conn, pv.boot, pv.anim, pv.now],
    [state.version, state.view, state.prefs, state.conn, state.boot, state.anim, 77]);
});

// v1.2 (A8, additive): the presented timeline carries ESPN's own box from the matching snapshot.
test("presentedTimeline passes ESPN's own box (boxEspn) from the snapshot at the drawn row, else null", () => {
  const espn = deepFreeze({ DAL: { yards: 366 }, TB: { yards: 419 } });
  const snapshots = deepFreeze([{ n: 104, drives: [], status: null, box: { DAL: {} }, boxEspn: null, unlinked: [] },
    { n: 183, drives: [], status: null, box: { DAL: {} }, boxEspn: espn, unlinked: [] }]);
  const timeline = deepFreeze({ ...emptyTimeline(), epoch: EPOCH, n: 183, rows: stubRows(1, 183), snapshots });
  assert.equal(presentedTimeline(deepFreeze({ timeline, anim: anim(150) })).boxEspn, null);
  assert.equal(presentedTimeline(deepFreeze({ timeline, anim: anim(183) })).boxEspn, espn);
  assert.equal(presentedTimeline(deepFreeze({ timeline: emptyTimeline(), anim: anim(0) })).boxEspn, null);
});
