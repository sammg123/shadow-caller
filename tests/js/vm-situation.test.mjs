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
  assert.deepEqual({ ...vm.driveInfo }, { text: "Drive 1 · snap 2", cue: false });
  assert.equal(vm.note,
    "Click any number and type; Enter or Tab saves. Click the team to switch sides of the field. Clock takes 8:41 or 841; G in To go means goal.");
});

test("G5-3: off the field Ball on is blank with the placeholder 25 and the chip on the offense's side", async () => {
  const situationVm = await load();
  const { NEW_DRIVE_YARD, stripValues } = await import("../../static/js/core/strip.js");
  const presented = state.final();
  const vm = situationVm(makePv({ presented, view: { sideAtFifty: "TB" } }));
  assert.equal(presented.drive_active, false);
  assert.deepEqual(vm.values, stripValues(presented.sit, presented.game, "TB", { driveActive: false }));
  assert.equal(vm.values.iYard, "");
  assert.equal(vm.values.placeholders.iYard, String(NEW_DRIVE_YARD));
  assert.equal(vm.values.side.team, "DAL");
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

// v1.5 (G4-1, additive): once ESPN's game is over the strip never asks for the next spot
test("G4-1: at the final whistle the strip says the game is over, never to type the spot", async () => {
  const situationVm = await load();
  const vm = situationVm(makePv({ presented: state.final(), tl: tlOf(timeline.final()) }));
  assert.deepEqual({ ...vm.driveInfo }, { text: "Final. Replay or watch another game from the booth (B).", cue: false });
  const midGame = situationVm(makePv({ presented: state.final(), tl: tlOf(timeline.at104()) }));
  assert.equal(midGame.driveInfo.text, "DAL off the field. Type where they get the ball in Ball on.");
});

test("G5-13: a refused value's words stay beside the strip, with the word Invalid (not colour alone)", async () => {
  const situationVm = await load();
  const vm = situationVm(makePv({ presented: state.final(), view: { stripRejected: { iClock: "zz", iDown: "7" },
    stripErrors: { iClock: "Clock like 8:41 or 841, got 'zz'", iDown: "Down must be 1 to 4" } } }));
  assert.deepEqual({ ...vm.error }, { field: "iClock", tag: "Invalid", text: "Clock like 8:41 or 841, got 'zz'" },
    "the first refused field, in the strip's order");
  const unsent = situationVm(makePv({ presented: state.final(), view: { stripRejected: { iYard: "30" } } }));
  assert.deepEqual({ ...unsent.error }, { field: "iYard", tag: "Invalid", text: "Ball on wasn't saved." });
  assert.equal(situationVm(makePv({ presented: state.final() })).error, null);
});

test("G5-16: during Watch this game the strip is read-only and offers no drive ends (ESPN's plays are applied)", async () => {
  const situationVm = await load();
  const watching = situationVm(makePv({ presented: state.tilt(), version: { watch: { state: "playing" } } }));
  assert.equal(watching.readOnly, true);
  assert.equal(watching.endRowHidden, true, "Punt, FG and Half over don't apply to a watched game");
  const manual = situationVm(makePv({ presented: state.tilt() }));
  assert.deepEqual([manual.readOnly, manual.endRowHidden], [false, false]);
});
