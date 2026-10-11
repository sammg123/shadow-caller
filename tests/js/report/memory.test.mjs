// The Model Report's in-game memory effects (static/js/report/model/vm-memory.js): the snaps whose prediction carries
// a TILT flag or memory_parts, with what his habits and the in-game memory did to his pass chance, and whether a tilt
// came true; the summary is the scorecard's own tilt count.
import assert from "node:assert/strict";
import test from "node:test";
import { firedOn, memoryVm } from "../../../static/js/report/model/vm-memory.js";
import { isDeepFrozen, makePv, patch, state, timeline, tlOf } from "../model-fixtures.mjs";

const finalPv = () => makePv({ presented: state.final(), tl: tlOf(timeline.final()) });

test("which predictions fired: a TILT flag, or memory_parts with any entry", () => {
  assert.equal(firedOn({ flag: "TILT RUN" }), true);
  assert.equal(firedOn({ flag: "TILT PASS" }), true);
  assert.equal(firedOn({ flag: "lean run" }), false);
  assert.equal(firedOn({ flag: "no edge", memory_parts: [{ term: "After a sack", pts: 3 }] }), true);
  assert.equal(firedOn({ flag: "no edge", memory_parts: [] }), false);
  assert.equal(firedOn(null), false);
});

test("the saved game: two tilts toward the run, one came true", () => {
  const vm = memoryVm(finalPv());
  assert.equal(vm.heading, "In-game memory");
  assert.equal(vm.empty, false);
  assert.deepEqual(vm.rows.map((r) => [r.seq, r.snap, r.time, r.situation, r.flagText, r.habits, r.memory, r.called,
    r.calledSide, r.outcome, r.outcomeText]), [
    [82, "24", "Q2 1:23", "1st & 10 at TB 39", "Tilts run", "-0.4", "-19.0", "Short (0–9 air yds)", "pass", "missed",
      "Didn't come true"],
    [102, "31", "Q3 12:07", "1st & 10 at TB 34", "Tilts run", "-0.6", "-19.5", "Inside run (A/B gap)", "run", "true",
      "Came true"]]);
  assert.ok(isDeepFrozen(vm));
});

test("the summary: the scorecard's tilts that came true, and when memory switches on", () => {
  const vm = memoryVm(finalPv());
  assert.deepEqual(vm.summary, [{ id: "tilts", label: "Tilts that came true", value: "1 of 2" },
    { id: "script", label: "", value: "Memory switches on after snap 15." }]);
});

test("memory_parts on a row's prediction are listed with their points", () => {
  const body = timeline.final();
  const parts = [{ term: "Repeat last call (stickiness)", pts: 9.94 }, { term: "After a failed play", pts: -4.9 }];
  const rows = body.rows.map((r) => (r.seq === 85 ? { ...r, pred: { ...r.pred, memory_parts: parts } } : r));
  const vm = memoryVm(makePv({ presented: state.final(), tl: tlOf(patch(body, { rows })) }));
  const row = vm.rows.find((r) => r.seq === 85);
  assert.deepEqual(row.parts, [{ term: "Repeat last call (stickiness)", pts: "+9.9" },
    { term: "After a failed play", pts: "-4.9" }]);
  assert.deepEqual([row.flagText, row.outcome, row.outcomeText], ["", null, ""]);
  assert.deepEqual(vm.rows.map((r) => r.seq), [82, 85, 102]);
});

test("calls but no tilt yet, and no calls at all, each say so plainly", () => {
  const early = memoryVm(makePv({ presented: state.final(), tl: tlOf(timeline.final(), 13) }));
  assert.deepEqual([early.empty, early.rows.length, early.emptyText],
    [true, 0, "No tilts yet: memory hasn't pushed a call away from the league."]);
  const none = memoryVm(makePv({ presented: state.tilt(), tl: tlOf(timeline.final(), 1) }));
  assert.equal(none.emptyText, "No calls yet: his first snap hasn't happened.");
  assert.deepEqual(none.summary.map((s) => s.id), ["script"]);
});
