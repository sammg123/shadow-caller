import test from "node:test";
import assert from "node:assert/strict";
import { makePv, state, timeline, tlOf, isDeepFrozen } from "./model-fixtures.mjs";

const load = async () => (await import("../../static/js/model/vm-situation.js")).situationVm;

test("strip values are core/strip.js's, for the remembered side at the 50", async () => {
  const situationVm = await load();
  const { stripValues } = await import("../../static/js/core/strip.js");
  const presented = state.tilt();
  const vm = situationVm(makePv({ presented, view: { sideAtFifty: "TB" } }));
  assert.deepEqual(vm.values, stripValues(presented.sit, presented.game, "TB"));
});

test("drive info, estimated clock and the end row during a drive (FI 3.4)", async () => {
  const situationVm = await load();
  const vm = situationVm(makePv({ presented: state.tilt() }));
  assert.deepEqual([vm.offLabel, vm.oppLabel, vm.clockEst, vm.endRowHidden], ["DAL", "TB", true, false]);
  assert.deepEqual({ ...vm.driveInfo }, { text: "Drive 1, snap 2 of the game", cue: false });
  assert.equal(vm.note,
    "Click any number and type; Enter or Tab saves. Click the team to switch sides of the field. Clock takes 8:41 or 841; G in To go means goal.");
});

test("off the field the drive info is the bold cue and the end row hides (#5)", async () => {
  const situationVm = await load();
  const vm = situationVm(makePv({ presented: state.final() }));
  assert.deepEqual({ ...vm.driveInfo }, { text: "DAL off the field. Type where they get the ball in Ball on.", cue: true });
  assert.equal(vm.endRowHidden, true);
  assert.equal(vm.clockEst, false);
});

test("score fields are named by team location when ESPN gives it (G13)", async () => {
  const situationVm = await load();
  const espn = situationVm(makePv({ presented: state.final(), tl: tlOf(timeline.final()) }));
  assert.deepEqual({ ...espn.scoreAria }, { off: "Dallas score", opp: "Tampa Bay score" });
  const manual = situationVm(makePv({ presented: state.final() }));
  assert.deepEqual({ ...manual.scoreAria }, { off: "DAL score", opp: "TB score" });
});

test("rejected strip text is passed through for the invalid style (FI 4.4)", async () => {
  const situationVm = await load();
  const vm = situationVm(makePv({ presented: state.final(), view: { stripRejected: { iClock: "16:00" } } }));
  assert.deepEqual({ ...vm.rejected }, { iClock: "16:00" });
  assert.ok(isDeepFrozen(vm));
  assert.equal(situationVm(makePv()).values, null);
});
