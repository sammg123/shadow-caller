import test from "node:test";
import assert from "node:assert/strict";
import { makePv, state, timeline, tlOf, patch, isDeepFrozen } from "./model-fixtures.mjs";

const load = async () => (await import("../../static/js/model/vm-field.js")).fieldVm;
const withSit = (sit) => patch(state.drive(), { sit: { ...state.drive().sit, ...sit } });

test("a caller drive at DAL 25: LOS 75, LTG 65, ghosts from the prediction (#27)", async () => {
  const fieldVm = await load();
  const { ghostInputFromPrediction } = await import("../../static/js/field/ghosts.js");
  const presented = state.drive();
  const vm = fieldVm(makePv({ presented, tl: tlOf(timeline.final()) }));
  assert.deepEqual({ ...vm.situation }, { ballX: 25, ltgX: 35, dir: 1, poss: "DAL", kind: "snap", goalToGo: false,
    down: 1, togo: 10 });
  assert.deepEqual({ ...vm.facts }, { driveActive: true, los: 75, ltg: 65, poss: "DAL", ballX: 25, ltgX: 35 });
  assert.equal(vm.ariaLabel, "Ball on DAL 25. 1st & 10. Line to gain DAL 35.");
  assert.deepEqual(vm.ghostInput, ghostInputFromPrediction(presented.prediction));
  assert.equal(vm.legend, "Ball shown mid-field; ESPN gives no hash.");
});

test("1st & Goal at TB 8 puts the line to gain on the goal line (#28)", async () => {
  const fieldVm = await load();
  const vm = fieldVm(makePv({ presented: withSit({ down: 1, togo: 8, yardline_100: 8 }) }));
  assert.deepEqual([vm.situation.ballX, vm.situation.ltgX, vm.situation.goalToGo], [92, 100, true]);
  assert.deepEqual([vm.facts.los, vm.facts.ltg], [8, 0]);
  assert.equal(vm.ariaLabel, "Ball on TB 8. 1st & Goal. Line to gain the goal line.");
});

test("the opponent's possession from the ESPN status, no ghosts (DC C5)", async () => {
  const fieldVm = await load();
  const vm = fieldVm(makePv({ presented: state.final(), tl: tlOf(timeline.at104()) }));
  assert.deepEqual({ ...vm.situation }, { ballX: 75, ltgX: 65, dir: -1, poss: "TB", kind: "snap", goalToGo: false,
    down: 1, togo: 10 });
  assert.deepEqual({ ...vm.facts }, { driveActive: false, los: 75, ltg: 65, poss: "TB", ballX: 75, ltgX: 65 });
  assert.equal(vm.ariaLabel, "Ball on TB 25. 1st & 10. Line to gain TB 35.");
  assert.equal(vm.ghostInput, null);
});

test("after a score the ball waits at the kicking team's 35 with no line to gain", async () => {
  const fieldVm = await load();
  const body = timeline.final();
  const tl = tlOf(patch(body, { status: { ...body.status, state: "in", poss: "DAL", ball_x: 35, ball_kind: "kickoff",
    down_text: null, last_seq: 12 } }), 12);
  const vm = fieldVm(makePv({ presented: state.final(), tl }));
  assert.deepEqual([vm.situation.ballX, vm.situation.ltgX, vm.situation.kind, vm.facts.ltg], [35, null, "kickoff", null]);
  assert.equal(vm.ariaLabel, "Kickoff, DAL from DAL 35.");
});

test("no drive and no live ESPN ball: a bare field (FI 3.3)", async () => {
  const fieldVm = await load();
  const vm = fieldVm(makePv({ presented: state.final(), tl: tlOf(timeline.final()) }));
  assert.equal(vm.situation, null);
  assert.deepEqual({ ...vm.facts }, { driveActive: false, los: null, ltg: null, poss: null, ballX: null, ltgX: null });
  assert.equal(vm.ariaLabel, "DAL off the field.");
  assert.ok(isDeepFrozen(vm));
  assert.equal(fieldVm(makePv()).ariaLabel, "");
});
