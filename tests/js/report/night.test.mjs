// The Model Report's night board (static/js/report/model/vm-night.js): his night so far as the old recap said it (top
// picks and top-3 hits out of his calls, from the scorecard's own counts), his last six verdicts, and the call track:
// every call in order, a bar as tall as the model's chance on the play he called, grouped by drive, the quarters
// marked and the five biggest surprises numbered.
import assert from "node:assert/strict";
import test from "node:test";
import { TRACK_CELLS, nightVm, trackCells } from "../../../static/js/report/model/vm-night.js";
import { isDeepFrozen, makePv, state, timeline, tlOf } from "../model-fixtures.mjs";

const finalVm = () => nightVm(makePv({ presented: state.final(), tl: tlOf(timeline.final()) }));

test("the plate names him; the tally is the scorecard's: 32 top picks and 47 in his top 3, of 59 calls", () => {
  const vm = finalVm();
  assert.equal(vm.heading, "Schottenheimer so far");
  assert.deepEqual(vm.tally, [{ id: "top1", label: "Top pick", value: "32", ghost: "88", of: "of 59 calls" },
    { id: "top3", label: "In his top 3", value: "47", ghost: "88", of: "of 59 calls" }]);
  assert.equal(vm.empty, false);
  assert.ok(isDeepFrozen(vm));
});

test("his last six verdicts, oldest first: a check, a rank in his top 3, or an X", () => {
  const { recent } = finalVm();
  assert.equal(recent.label, "Last 6");
  assert.deepEqual(recent.items.map((i) => [i.key, i.mark, i.text]), [["miss", "✗", "Miss"],
    ["top1", "✓", "Top pick"], ["top3", "2", "In his top 3, #2"], ["top1", "✓", "Top pick"], ["top1", "✓", "Top pick"],
    ["top1", "✓", "Top pick"]]);
});

test("the track: one bar per call, its height the model's chance on his call in 5-point cells", () => {
  const { track } = finalVm();
  assert.equal(track.calls.length, 59);
  assert.equal(TRACK_CELLS, 12);
  assert.deepEqual([trackCells(0.005), trackCells(0.14), trackCells(0.4906), trackCells(0.9), trackCells(null)],
    [1, 3, 10, 12, 1]);
  assert.deepEqual(track.calls.slice(0, 5).map((c) => [c.seq, c.verdict, c.cells]),
    [[2, "top3", 3], [3, "top1", 7], [4, "top1", 10], [5, "top1", 5], [6, "top1", 5]]);
  assert.match(track.ariaLabel, /^Every call he made, in order\./);
});

test("drives start a new group, quarters are marked where they begin, surprises carry their number", () => {
  const { track } = finalVm();
  assert.deepEqual(track.calls.filter((c) => c.driveStart).map((c) => c.seq), [2, 38, 50, 70, 81, 99, 126, 150, 168]);
  assert.equal(track.breaks, 8, "a gap between each two of his 9 drives");
  assert.deepEqual(track.calls.filter((c) => c.quarter).map((c) => [c.seq, c.quarter]),
    [[2, "Q1"], [38, "Q2"], [99, "Q3"], [150, "Q4"]]);
  assert.deepEqual(track.calls.filter((c) => c.surprise).map((c) => [c.seq, c.surprise]),
    [[7, 2], [11, 4], [53, 3], [81, 5], [158, 1]]);
});

test("each bar says what it is in words (its tooltip and what a screen reader hears)", () => {
  const { track } = finalVm();
  const at = (seq) => track.calls.find((c) => c.seq === seq);
  assert.equal(at(158).text, "Snap 47, Q4 5:35: Miss. Deep shot (20+), incomplete: 0.5%.");
  assert.equal(at(2).text, "Snap 1, Q1 14:54: In his top 3, #3. Short (0–9 air yds), incomplete: 14%.");
  assert.equal(at(8).text, "Q1 11:56: Miss. Off-tackle left (no play: defensive offside on TB): 6.2%.");
});

test("the legend names every tone in words", () => {
  const { legend, legendNote } = finalVm();
  assert.deepEqual(legend.map((l) => [l.key, l.text]), [["top1", "Top pick"], ["top3", "In his top 3"], ["miss", "Miss"]]);
  assert.equal(legendNote, "Bar height: the model's chance on the play he called. Numbers: his biggest surprises.");
});

test("before his first snap: the plain empty line, no tally, no bars", () => {
  const vm = nightVm(makePv({ presented: state.tilt(), tl: tlOf(timeline.final(), 1) }));
  assert.deepEqual([vm.empty, vm.emptyText, vm.track.calls.length, vm.recent.items.length],
    [true, "No calls yet: his first snap hasn't happened.", 0, 0]);
  assert.deepEqual(vm.tally.map((t) => t.value), []);
  assert.equal(nightVm(makePv()).heading, "His night so far");
});
