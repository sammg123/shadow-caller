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

// ---------------------------------------------------------------- G2-7: what the field's verdict chip says was graded
const chipText = async () => (await import("../../static/js/model/vm-field.js")).verdictChipText;
const { loadJson } = await import("./fixtures.mjs");
const PRED = Object.fromEntries(loadJson("timeline_tb_dal.json").rows.filter((r) => r.pred).map((r) => [r.seq, r.pred]));

test("the verdict chip names the graded play's rank, name and odds (G2-7)", async () => {
  const text = await chipText();
  assert.equal(text(PRED[159]), "In his top 3 · #2 Intermediate · 39%", "the Dallas TD: his #2, dropback_mid");
  assert.equal(text(PRED[7]), "Miss · #11 Deep shot · 3%");
  assert.equal(text(PRED[101]), "Top pick · 54%", "his top pick needs no name: the play's own words are above it");
  assert.equal(text(PRED[2]), "In his top 3 · #3 Short · 14%");
  assert.equal(text(PRED[5]), "Top pick · 24%");
});

test("the chip uses the server's leaf names, short (no parenthesis), else the engine's (G2-7)", async () => {
  const text = await chipText();
  assert.equal(text(PRED[159], { dropback_mid: "Medium shot (10–19)" }), "In his top 3 · #2 Medium shot · 39%");
  assert.equal(text(PRED[159], { run_inside: "x" }), "In his top 3 · #2 Intermediate · 39%", "missing: the engine's");
  assert.equal(text({ ...PRED[7], leaf: "rpo_run" }), "Miss · #11 RPO, handed off or kept · 3%");
});

test("a grade without a specific play keeps its plain words; no pred, no words (G2-7)", async () => {
  const text = await chipText();
  assert.equal(text({ family: "pa", fam_top: "run" }), "Miss");
  assert.equal(text({ family: "run", fam_top: "run" }), "Top pick");
  assert.equal(text({ p: 0.7, dropback: 1 }), "Top pick");
  assert.equal(text(null), "");
  assert.equal(text({ ...PRED[7], leaf_p: Number.NaN }), "Miss · #11 Deep shot");
  assert.equal(text({ ...PRED[7], leaf: "not_a_leaf" }), "Miss · #11 · 3%");
});

test("4b: the LAST plate's verdict for a play drawn at once: a graded caller snap's chip words, else none", async () => {
  const { rowVerdictText } = await import("../../static/js/model/vm-field.js");
  const rows = loadJson("timeline_tb_dal.json").rows;
  const bySeq = (seq) => rows.find((r) => r.seq === seq);
  assert.equal(rowVerdictText(bySeq(126)), "Top pick · 19%");
  assert.equal(rowVerdictText(bySeq(151), { dropback_mid: "Medium shot (10–19)" }), "Miss · #4 Medium shot · 10%");
  assert.equal(rowVerdictText(bySeq(43)), "", "his punt: no call to grade");
  assert.equal(rowVerdictText(bySeq(15)), "", "a TB play");
  assert.equal(rowVerdictText(null), "");
});
