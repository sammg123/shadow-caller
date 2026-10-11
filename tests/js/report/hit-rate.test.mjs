// The Model Report's hit rate by down and distance (static/js/report/model/vm-hit-rate.js): 1st down, 2nd and 3rd
// split short (1 to 3 to go), medium (4 to 6) and long (7+), 4th down; his top pick and top 3 against the league's
// top 3, counted on the specific play exactly as the scorecard counts them, so the totals match it.
import assert from "node:assert/strict";
import test from "node:test";
import { BUCKETS, bucketOf, hitRateVm } from "../../../static/js/report/model/vm-hit-rate.js";
import { isDeepFrozen, makePv, patch, state, timeline, tlOf } from "../model-fixtures.mjs";

const finalVm = () => hitRateVm(makePv({ presented: state.final(), tl: tlOf(timeline.final()) }));
const counts = (row) => [row.key, row.calls, row.top1, row.top3, row.league3];

test("buckets: 1st, 2nd and 3rd by yards to go, 4th; goal to go counts its yards", () => {
  assert.deepEqual(BUCKETS.map((b) => b.key), ["1st", "2nd-short", "2nd-medium", "2nd-long", "3rd-short", "3rd-medium",
    "3rd-long", "4th"]);
  assert.equal(bucketOf(1, 10), "1st");
  assert.equal(bucketOf(1, 25), "1st");
  assert.deepEqual([bucketOf(2, 1), bucketOf(2, 3), bucketOf(2, 4), bucketOf(2, 6), bucketOf(2, 7), bucketOf(2, 19)],
    ["2nd-short", "2nd-short", "2nd-medium", "2nd-medium", "2nd-long", "2nd-long"]);
  assert.deepEqual([bucketOf(3, 2), bucketOf(3, 5), bucketOf(3, 10)], ["3rd-short", "3rd-medium", "3rd-long"]);
  assert.equal(bucketOf(4, 1), "4th");
  assert.equal(bucketOf(4, 15), "4th");
  assert.equal(bucketOf(0, 10), null);
  assert.equal(bucketOf(2, null), null);
});

test("the saved game, bucket by bucket (calls, top pick, his top 3, league top 3)", () => {
  const vm = finalVm();
  assert.equal(vm.heading, "Hit rate by down and distance");
  assert.deepEqual(vm.columns, ["Situation", "Calls", "Top pick", "In his top 3", "League top 3"]);
  assert.deepEqual(vm.rows.map(counts), [
    ["1st", 29, 12, 17, 19], ["2nd-short", 4, 2, 4, 3], ["2nd-medium", 5, 3, 5, 5], ["2nd-long", 10, 7, 10, 10],
    ["3rd-short", 6, 5, 6, 6], ["3rd-medium", 1, 1, 1, 1], ["3rd-long", 3, 1, 3, 3], ["4th", 1, 1, 1, 1]]);
  assert.deepEqual(vm.rows.map((r) => [r.label, r.hint]), [["1st down", ""], ["2nd & short", "1 to 3 yds"],
    ["2nd & medium", "4 to 6 yds"], ["2nd & long", "7+ yds"], ["3rd & short", "1 to 3 yds"], ["3rd & medium", "4 to 6 yds"],
    ["3rd & long", "7+ yds"], ["4th down", ""]]);
  assert.ok(isDeepFrozen(vm));
});

test("the totals are the scorecard's own: 59 calls, 32 top picks, 47 in his top 3, 48 in the league's", () => {
  const vm = finalVm();
  const g = state.final().metrics.granular;
  assert.deepEqual([vm.total.calls, vm.total.top1, vm.total.top3, vm.total.league3],
    [g.leaf_n, g.leaf_top1, g.leaf_top3, g.leaf_top3_league]);
  assert.deepEqual([vm.total.label, vm.total.calls], ["All downs", 59]);
});

test("each bucket shows its calls as lit cells: top picks first, then the rest of his top 3, then misses", () => {
  const first = finalVm().rows[0];
  assert.equal(first.cells.length, 29);
  assert.deepEqual([first.cells.filter((c) => c === "top1").length, first.cells.filter((c) => c === "top3").length,
    first.cells.filter((c) => c === "miss").length], [12, 5, 12]);
  assert.deepEqual(first.cells.slice(10, 19), ["top1", "top1", "top3", "top3", "top3", "top3", "top3", "miss", "miss"]);
});

test("the leader of his top 3 against the league's, by bucket (a lamp, like SHADOW v LEAGUE)", () => {
  const leads = Object.fromEntries(finalVm().rows.map((r) => [r.key, r.lead]));
  assert.deepEqual(leads, { "1st": "league", "2nd-short": "shadow", "2nd-medium": "even", "2nd-long": "even",
    "3rd-short": "even", "3rd-medium": "even", "3rd-long": "even", "4th": "even" });
});

test("before his first snap every bucket is there, empty, and the board says why", () => {
  const vm = hitRateVm(makePv({ presented: state.tilt(), tl: tlOf(timeline.final(), 1) }));
  assert.equal(vm.empty, true);
  assert.equal(vm.emptyText, "No calls yet: his first snap hasn't happened.");
  assert.deepEqual(vm.rows.map((r) => [r.calls, r.cells.length, r.lead]), BUCKETS.map(() => [0, 0, null]));
});

test("calls with no specific-play grade at all (a run-or-pass model) say so rather than claim no calls", () => {
  const body = timeline.final();
  const rows = body.rows.map((r) => (r.pred ? { ...r, pred: { ...r.pred, leaf_rank: null, leaf: null } } : r));
  const vm = hitRateVm(makePv({ presented: state.final(), tl: tlOf(patch(body, { rows })) }));
  assert.deepEqual([vm.empty, vm.emptyText], [true, "No call graded on the specific play yet."]);
});

test("a call graded only on the play type (no specific play) stays out, as the scorecard leaves it out", () => {
  const body = timeline.final();
  const rows = body.rows.map((r) => (r.seq === 3 ? { ...r, pred: { ...r.pred, leaf_rank: null, leaf: null } } : r));
  const vm = hitRateVm(makePv({ presented: state.final(), tl: tlOf(patch(body, { rows })) }));
  assert.equal(vm.total.calls, 58);
  assert.equal(vm.rows.find((r) => r.key === "2nd-long").calls, 9);
});
