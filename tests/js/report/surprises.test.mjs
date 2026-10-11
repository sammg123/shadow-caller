// The Model Report's biggest surprises (static/js/report/model/vm-surprises.js): the calls he made that the model gave
// the lowest chance, read from each row's own prediction (the chance on the specific play he called).
import assert from "node:assert/strict";
import test from "node:test";
import { callerCalls } from "../../../static/js/report/model/calls.js";
import { SURPRISES_SHOWN, surpriseRanks, surprisesVm } from "../../../static/js/report/model/vm-surprises.js";
import { isDeepFrozen, makePv, patch, state, timeline, tlOf } from "../model-fixtures.mjs";

const finalVm = () => surprisesVm(makePv({ presented: state.final(), tl: tlOf(timeline.final()) }));

test("the five lowest chances on the play he called, lowest first", () => {
  const vm = finalVm();
  assert.equal(SURPRISES_SHOWN, 5);
  assert.equal(vm.heading, "His biggest surprises");
  assert.deepEqual(vm.rows.map((r) => [r.rank, r.seq, r.snap, r.calledPct]),
    [[1, 158, "47", "0.5%"], [2, 7, "6", "3.1%"], [3, 53, "17", "3.2%"], [4, 11, "8", "5.0%"], [5, 81, "23", "5.6%"]]);
  assert.ok(isDeepFrozen(vm));
});

test("each surprise: when, the situation, what he called and its rank, the model's own pick and its chance", () => {
  const top = finalVm().rows[0];
  assert.deepEqual(top, {
    rank: 1, key: "surprise:158", seq: 158, snap: "47", time: "Q4 5:35", situation: "1st & 10 at TB 18",
    when: "Snap 47 · Q4 5:35 · 1st & 10 at TB 18",
    called: "Deep shot (20+), incomplete", calledPct: "0.5%", calledRank: "13", rankText: "#13 of 14",
    modelPick: "Short (0–9 air yds)", modelPct: "45%", nullified: false,
  });
});

test("ties keep game order; a play a flag wiped out still counts (it was still his call)", () => {
  const body = timeline.final();
  const rows = body.rows.map((r) => (r.seq === 70 ? { ...r, pred: { ...r.pred, leaf_p: 0.001 } }
    : r.seq === 2 ? { ...r, pred: { ...r.pred, leaf_p: 0.001 } } : r));
  const vm = surprisesVm(makePv({ presented: state.final(), tl: tlOf(patch(body, { rows })) }));
  assert.deepEqual(vm.rows.slice(0, 2).map((r) => [r.seq, r.snap, r.nullified]), [[2, "1", false], [70, "", true]]);
});

test("ranks by seq, for the night board's numbered marks", () => {
  const ranks = surpriseRanks(callerCalls(tlOf(timeline.final())));
  assert.deepEqual([...ranks.entries()], [[158, 1], [7, 2], [53, 3], [11, 4], [81, 5]]);
});

test("fewer calls than five: every call is listed; none at all: the plain empty line", () => {
  const few = surprisesVm(makePv({ presented: state.final(), tl: tlOf(timeline.final(), 4) }));
  assert.deepEqual(few.rows.map((r) => r.seq), [2, 3, 4]);
  const none = surprisesVm(makePv({ presented: state.tilt(), tl: tlOf(timeline.final(), 1) }));
  assert.deepEqual([none.empty, none.rows.length, none.emptyText],
    [true, 0, "No calls yet: his first snap hasn't happened."]);
});

test("calls with no specific-play chance at all say so rather than claim no calls", () => {
  const body = timeline.final();
  const rows = body.rows.map((r) => (r.pred ? { ...r, pred: { ...r.pred, leaf_p: null } } : r));
  const vm = surprisesVm(makePv({ presented: state.final(), tl: tlOf(patch(body, { rows })) }));
  assert.deepEqual([vm.empty, vm.emptyText], [true, "No call graded on the specific play yet."]);
});

test("a call graded only on the play type has no specific-play chance and is never a surprise here", () => {
  const body = timeline.final();
  const rows = body.rows.map((r) => (r.seq === 158 ? { ...r, pred: { ...r.pred, leaf_p: null, leaf_rank: null } } : r));
  const vm = surprisesVm(makePv({ presented: state.final(), tl: tlOf(patch(body, { rows })) }));
  assert.equal(vm.rows[0].seq, 7);
});
