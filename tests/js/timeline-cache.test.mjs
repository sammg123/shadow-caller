import assert from "node:assert/strict";
import test from "node:test";

import {
  PRED_PATCH_KEYS, checkTimelineBody, emptyTimeline, mergeTimeline, patchPreds, pruneSnapshots, rowBySeq, snapshotAt,
} from "../../static/js/core/timeline-cache.js";
import { deepFreeze, loadTimeline, stubRows, timelineBody } from "./fixtures.mjs";

const TL = loadTimeline();
const BASE = TL.body;
const reset = (rows, over = {}) => timelineBody(BASE, { rows, ...over });
const append = (rows, since, over = {}) => timelineBody(BASE, { rows, since, reset: false, ...over });
const cacheThrough100 = () => deepFreeze(mergeTimeline(emptyTimeline(), reset(stubRows(1, 100))).cache);

test("emptyTimeline has the 2.1 shape", () => {
  assert.deepEqual(emptyTimeline(), { epoch: null, n: 0, source: null, mode: null, field: null, teams: null, teamOrder: [],
    meta: null, wpStart: null, rows: [], needsFull: false, snapshots: [] });
});

test("a since=0 response replaces the cache and carries the per-epoch facts (DC C1)", () => {
  const { cache, added, reset: wasReset, needsFull } = mergeTimeline(deepFreeze(emptyTimeline()), reset(TL.rows(1, 15)));
  assert.equal(wasReset, true);
  assert.equal(needsFull, false);
  assert.deepEqual(added.map((r) => r.seq), Array.from({ length: 15 }, (_, i) => i + 1));
  assert.equal(cache.n, 15);
  assert.equal(cache.epoch, BASE.epoch);
  assert.deepEqual(cache.field, BASE.field);
  assert.deepEqual(cache.teams, BASE.teams);
  assert.deepEqual(cache.teamOrder, BASE.team_order);
  assert.deepEqual(cache.meta, BASE.meta);
  assert.equal(cache.wpStart, BASE.wp_start);
  assert.deepEqual(cache.snapshots.map((s) => s.n), [15]);
  assert.ok(Object.isFrozen(cache.rows) && Object.isFrozen(cache.rows[1].geo), "rows are frozen");
  assert.equal(rowBySeq(cache, 2).id, "40187298068");
});

test("an append adds 101 to 104 and keeps the epoch facts", () => {
  const { cache, added, reset: wasReset } = mergeTimeline(cacheThrough100(), append(TL.rows(101, 104), 100));
  assert.equal(wasReset, false);
  assert.deepEqual(added.map((r) => r.seq), [101, 102, 103, 104]);
  assert.equal(cache.n, 104);
  assert.equal(cache.rows.length, 104);
  assert.ok(Object.isFrozen(cache.rows), "rows stay frozen after an append (2.1)");
  assert.equal(rowBySeq(cache, 104).id, "4018729802466", "the DAL interception");
  assert.deepEqual(cache.teams, BASE.teams);
  assert.deepEqual(cache.snapshots.map((s) => s.n), [100, 104]);
});

test("duplicates are dropped", () => {
  const { added, cache } = mergeTimeline(cacheThrough100(), append([...stubRows(99, 100), ...TL.rows(101, 104)], 98));
  assert.deepEqual(added.map((r) => r.seq), [101, 102, 103, 104]);
  assert.equal(cache.n, 104);
});

test("a gap leaves the rows and asks for a full refetch", () => {
  const before = cacheThrough100();
  for (const body of [append(TL.rows(102, 104), 101), append([TL.row(101), TL.row(103)], 100, { n: 103 }),
    append(TL.rows(101, 103), 100, { n: 104 })]) {
    const { cache, added, needsFull } = mergeTimeline(before, body);
    assert.equal(needsFull, true);
    assert.deepEqual(added, []);
    assert.equal(cache.rows, before.rows, "rows untouched");
    assert.equal(cache.n, 100);
    assert.equal(cache.needsFull, true);
  }
  const healed = mergeTimeline(deepFreeze({ ...before, needsFull: true }), reset(stubRows(1, 104)));
  assert.equal(healed.cache.needsFull, false, "the full refetch clears the flag");
});

test("a new epoch, reset true or since 0 replaces the cache", () => {
  const before = cacheThrough100();
  const other = mergeTimeline(before, timelineBody(BASE, { rows: TL.rows(1, 15), epoch: "other-1" }));
  assert.equal(other.reset, true);
  assert.equal(other.cache.epoch, "other-1");
  assert.equal(other.cache.n, 15);
  assert.equal(mergeTimeline(before, append(TL.rows(1, 15), 0, { reset: true })).cache.n, 15);
  assert.equal(mergeTimeline(before, timelineBody(BASE, { rows: TL.rows(1, 15), since: 0, reset: false })).reset, true);
  assert.deepEqual(mergeTimeline(before, timelineBody(BASE, { rows: [] })).cache.rows, [], "a reset to an empty game");
});

test("a replacement that does not hold rows 1 to n asks for a full refetch instead", () => {
  const before = cacheThrough100();
  const odd = mergeTimeline(before, append(TL.rows(101, 104), 100, { epoch: "other-1" }));
  assert.equal(odd.needsFull, true);
  assert.equal(odd.reset, false);
  assert.equal(odd.cache.rows, before.rows);
  assert.equal(mergeTimeline(before, timelineBody(BASE, { rows: [TL.row(2), TL.row(1)], n: 2 })).needsFull, true, "out of order");
  assert.equal(mergeTimeline(before, timelineBody(BASE, { rows: TL.rows(1, 3), n: 2 })).needsFull, true, "a seq above n");
});

test("a since=0 body with a hole (an applied play ESPN no longer lists) is taken as is, so the client never loops", () => {
  const holed = [TL.row(1), TL.row(2), TL.row(4)];
  const { cache, needsFull, reset } = mergeTimeline(cacheThrough100(), timelineBody(BASE, { rows: holed, n: 4 }));
  assert.deepEqual([needsFull, reset, cache.n, cache.rows.length], [false, true, 4, 3]);
  assert.equal(rowBySeq(cache, 4).id, TL.row(4).id);
  assert.equal(rowBySeq(cache, 3), null);
  const next = mergeTimeline(deepFreeze(cache), append(TL.rows(5, 6), 4));
  assert.deepEqual(next.added.map((r) => r.seq), [5, 6], "appends continue from n");
});

test("a stale response (smaller n, same epoch) changes nothing", () => {
  const before = deepFreeze(mergeTimeline(cacheThrough100(), append(TL.rows(101, 104), 100)).cache);
  const out = mergeTimeline(before, append([], 100, { n: 100 }));
  assert.equal(out.cache, before);
  assert.equal(out.needsFull, false);
  assert.deepEqual(out.added, []);
});

test("an empty append refreshes mode, source and the snapshot for the same n", () => {
  const before = cacheThrough100();
  const { cache, added } = mergeTimeline(before, append([], 100, { n: 100, mode: "live" }));
  assert.deepEqual(added, []);
  assert.equal(cache.mode, "live");
  assert.deepEqual(cache.snapshots.map((s) => s.n), [100]);
});

test("patchPreds copies the retag fields by espn_id and never touches geometry (DC B7, G21)", () => {
  const rows = deepFreeze(TL.rows(1, 15));
  const pred2 = rows[1].pred;
  const log = deepFreeze([{ seq: 1, espn_id: "40187298068", family: "pa", leaf: null, name: "Play-action, incomplete",
    fam_p: 0.22386, fam_p_league: 0.19354, leaf_p: null, leaf_p_league: null, leaf_rank: null, leaf_rank_league: null,
    success: 0, retagged: true, p: 0.99 }]);
  const out = patchPreds(rows, log);
  assert.notEqual(out, rows);
  assert.equal(out[1].pred.family, "pa");
  assert.equal(out[1].pred.name, "Play-action, incomplete");
  assert.equal(out[1].pred.retagged, true);
  assert.equal(out[1].pred.p, pred2.p, "fixed-at-log-time fields stay");
  assert.equal(out[1].geo, rows[1].geo, "geometry is the same object");
  assert.equal(out[0], rows[0], "unchanged rows keep their identity");
  assert.deepEqual([...PRED_PATCH_KEYS], ["family", "leaf", "name", "fam_p", "fam_p_league", "leaf_p", "leaf_p_league",
    "leaf_rank", "leaf_rank_league", "success", "retagged"]);
});

test("patchPreds returns the same array when nothing changed", () => {
  const rows = deepFreeze(TL.rows(1, 15));
  const p = rows[1].pred;
  const same = deepFreeze([{ seq: 1, espn_id: "40187298068", ...Object.fromEntries(PRED_PATCH_KEYS.map((k) => [k, p[k]])) }]);
  assert.equal(patchPreds(rows, same), rows);
  assert.equal(patchPreds(rows, []), rows);
  assert.equal(patchPreds(rows, undefined), rows);
  assert.equal(patchPreds(rows, [{ seq: 9, espn_id: "nope", family: "pa" }]), rows);
});

test("patchPreds joins hand-entered rows by log seq and reads a missing retagged as false", () => {
  const rows = deepFreeze([{ seq: 3, id: "log-3", src: "log", pred: { family: "run", leaf: "run_inside", retagged: true } }]);
  const out = patchPreds(rows, [{ seq: 3, family: "rpo", leaf: "rpo_run", name: "RPO, handed off or kept" }]);
  assert.deepEqual(out[0].pred, { family: "rpo", leaf: "rpo_run", retagged: false, name: "RPO, handed off or kept" });
});

test("snapshotAt, pruneSnapshots and rowBySeq", () => {
  const snaps = [1, 5, 9].map((n) => ({ n, drives: [], status: { last_seq: n }, box: null, unlinked: [] }));
  const cache = deepFreeze({ ...emptyTimeline(), snapshots: snaps, rows: stubRows(1, 9), n: 9 });
  assert.equal(snapshotAt(cache, 0), null);
  assert.equal(snapshotAt(cache, 4).n, 1);
  assert.equal(snapshotAt(cache, 5).n, 5);
  assert.equal(snapshotAt(cache, 100).n, 9);
  assert.deepEqual(pruneSnapshots(cache, 6).snapshots.map((s) => s.n), [5, 9], "keeps the newest at or below n");
  assert.equal(pruneSnapshots(cache, 0), cache);
  assert.equal(pruneSnapshots(cache, 4), cache, "nothing to drop: same object");
  assert.equal(rowBySeq(cache, 4).id, "stub-4");
  assert.equal(rowBySeq(cache, 10), null);
  assert.equal(rowBySeq(cache, 0), null);
});

test("checkTimelineBody rejects malformed responses at the boundary", () => {
  assert.equal(checkTimelineBody(reset(TL.rows(1, 3))), null);
  assert.equal(checkTimelineBody(BASE), null, "the fixture itself is valid");
  const bad = [null, [], { ...reset([]), epoch: "" }, { ...reset([]), n: -1 }, { ...reset([]), n: 1.5 },
    { ...reset([]), rows: {} }, { ...reset([]), since: "0" }, { ...reset([{ seq: "1" }]) }, { ...reset([null]) },
    { ...reset([]), drives: {} }];
  for (const b of bad) assert.equal(typeof checkTimelineBody(b), "string", JSON.stringify(b)?.slice(0, 80));
});

// v1.2 (A8, additive): ESPN's own box score rides along in each snapshot, so the box score can prefer it.
test("snapshots keep ESPN's own box (box_espn) beside the derived one, null when the server sends none", () => {
  const espnBox = deepFreeze({ DAL: { yards: 366 }, TB: { yards: 419 } });
  const withEspn = { ...reset(TL.rows(1, 15)), box_espn: espnBox, box_source: "espn" };
  const { cache } = mergeTimeline(deepFreeze(emptyTimeline()), deepFreeze(withEspn));
  assert.deepEqual(cache.snapshots[0].boxEspn, espnBox);
  assert.ok(Object.isFrozen(cache.snapshots[0].boxEspn));
  const later = mergeTimeline(deepFreeze(cache), deepFreeze(append(TL.rows(16, 17), 15))).cache;
  assert.equal(later.snapshots[later.snapshots.length - 1].boxEspn, null, "a body without box_espn stores null");
  assert.equal(cacheThrough100().snapshots[0].boxEspn, null);
});
