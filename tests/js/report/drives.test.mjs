// The Model Report's drive chart (static/js/report/model/drives.js): the app's drive chart (model/vm-drives.js), where
// a drive of his points at its first call in the table below and an opponent's drive points nowhere.
import assert from "node:assert/strict";
import test from "node:test";
import { REPORT_DRIVES_COPY, reportDrivesVm } from "../../../static/js/report/model/drives.js";
import { isDeepFrozen, makePv, state, timeline, tlOf } from "../model-fixtures.mjs";

test("every drive stays; his point at their first call, the opponent's (and his with no call) at nothing", () => {
  const vm = reportDrivesVm(makePv({ presented: state.final(), tl: tlOf(timeline.final()) }));
  assert.equal(vm.drives.length, 21);
  assert.deepEqual(vm.drives.filter((d) => d.caller).map((d) => [d.idx, d.firstSeq]),
    [[1, 2], [3, 38], [5, 50], [7, 70], [9, 81], [12, 99], [14, null], [16, 126], [18, 150], [20, 168]],
    "drive 14 is a kickoff he fumbled away: no call to show");
  assert.ok(vm.drives.filter((d) => !d.caller).every((d) => d.firstSeq === null));
  assert.ok(!("reviewSeq" in vm) && vm.drives.every((d) => !("reviewing" in d)), "there is no review mode");
  assert.ok(isDeepFrozen(vm));
});

test("the chart's words say where a drive's button goes on this page", () => {
  assert.equal(REPORT_DRIVES_COPY.DRIVES.review, "His drives open their calls in the table below");
  assert.equal(REPORT_DRIVES_COPY.DRIVES.heading, "Drives");
  assert.equal(REPORT_DRIVES_COPY.BOX.heading, "Team stats", "the rest of the app's copy rides along unchanged");
});
