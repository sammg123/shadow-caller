// field/paths.js, part 2: kicks (as before), flags and no-plays, labels, situations and whole-game sweeps
// (docs/design/play-drawing.md, binding: the same shapes drawn dimmed and dashed for a no-play, a label per play).
import assert from "node:assert/strict";
import test from "node:test";

import { LABEL_GAP_YD, labelHalfSpanYd } from "../../static/js/field/grammar.js";
import { buildDrawing, situationAfterRow, situationFromRow } from "../../static/js/field/paths.js";
import { playLabel } from "../../static/js/field/play-label.js";
import { allRows, frozenCopy, numbersIn, rowBySeq } from "./field-rows.mjs";

const C = 26.667;
const EPS = 1e-6;
const near = (a, b, label = "") => assert.ok(Math.abs(a - b) <= EPS, `${label} ${a} != ${b}`);
const nearPt = (p, x, y, label = "") => {
  assert.ok(p, `${label} point missing`);
  near(p.x, x, `${label} x`);
  near(p.y, y, `${label} y`);
};
const bySeq = rowBySeq;
const draw = (seq) => buildDrawing(bySeq(seq));
const shape = (d) => d.steps.map((s) => `${s.t}:${s.role}`);

test("kicks are as before: true-length arcs, the result mark, the return", () => {
  const ko = draw(1);
  assert.deepEqual(shape(ko), ["arc:kickoff", "ground:return"]);
  nearPt(ko.steps[0].from, 65, C);
  nearPt(ko.steps[0].to, 3, C);
  near(ko.steps[0].apex, 0.28 * 62);
  nearPt(ko.steps[1].to, 30, C);
  nearPt(ko.ballStart, 65, C);
  nearPt(ko.ballEnd, 30, C);
  assert.deepEqual([ko.resultLabel.text, ko.label.text], ["KICKOFF 62", "Kickoff · return to DAL 30"]);
  nearPt(ko.label.at, 30, C - LABEL_GAP_YD, "a kick labels toward the near sideline, under its arc");
  const fumble = draw(113);
  assert.deepEqual(shape(fumble), ["arc:kickoff", "ground:return", "ground:return", "mark:turnover"]);
  nearPt(fumble.steps[2].to, 37, C);
  assert.equal(fumble.steps[2].approx, true);
  assert.equal(fumble.label.approx, true, "the loose ball's runback is an estimate");
  const tb = draw(161);
  assert.deepEqual(shape(tb), ["arc:kickoff", "mark:touchback"]);
  nearPt(tb.ballEnd, 65, C);
  assert.equal(tb.label.text, "Kickoff · touchback");
  const punt = draw(43);
  assert.deepEqual(shape(punt), ["arc:punt", "mark:oob"]);
  near(punt.steps[0].apex, 0.3 * 53);
  assert.equal(punt.label.text, "Punt · 53 yds · out of bounds");
  nearPt(punt.label.at, 97, C - LABEL_GAP_YD);
});

test("field goals: the hold, the arc over the crossbar, the label inside the end zone", () => {
  const dal = draw(87);
  assert.deepEqual(shape(dal), ["ground:hold", "arc:fg", "mark:fg_good"]);
  nearPt(dal.steps[0].to, 69, C);
  nearPt(dal.steps[1].to, 110, C);
  near(dal.steps[1].endH, 3.333 + 2, "clears the crossbar");
  assert.equal(dal.ballEnd, null);
  assert.deepEqual([dal.resultLabel.text, dal.label.text], ["FG 41 GOOD", "FG 41 yds · good"]);
  nearPt(dal.label.at, 110 - labelHalfSpanYd(dal.label.text), C - LABEL_GAP_YD, "inside the end line, under the arc");
  const tb = draw(123);
  nearPt(tb.steps[0].to, 31, C);
  nearPt(tb.steps[1].to, -10, C);
  nearPt(tb.label.at, -10 + labelHalfSpanYd(tb.label.text), C - LABEL_GAP_YD);
  const row = bySeq(87);
  const miss = buildDrawing({ ...row, kind: "fg_miss", kick: { ...row.kick, good: false }, scoring: null });
  assert.deepEqual(shape(miss), ["ground:hold", "arc:fg", "mark:fg_miss"]);
  near(miss.steps[1].endH, 3.333);
  assert.equal(miss.label.text, "FG 41 yds · no good");
});

test("no play: the same shape ghosted, then the flag and the march to the enforced spot", () => {
  const d = draw(8);
  assert.equal(d.ghosted, true);
  assert.deepEqual(shape(d), ["ground:run", "mark:flag", "ground:march"]);
  assert.deepEqual(d.steps.map((s) => s.ghosted), [true, false, false]);
  nearPt(d.steps[0].from, 92, C);
  nearPt(d.steps[0].to, 93, C + 4, "the wiped-out 1-yard run through the left tackle");
  nearPt(d.steps[1].at, 92, C);
  nearPt(d.steps[2].from, 92, C);
  nearPt(d.steps[2].to, 96, C);
  nearPt(d.ballEnd, 96, C);
  assert.deepEqual([d.resultLabel.text, d.label.text], ["FLAG", "No play · defensive offside on TB"]);
  nearPt(d.label.at, 92, C - LABEL_GAP_YD, "at the flag, clear of the wiped-out run toward the far side");
  const punt = rowBySeq(43);
  const wiped = buildDrawing({ ...punt, result: { ...punt.result, nullified: true,
    penalty: { on: "TB", foul: "Roughing the Kicker", yards: 15, at_x: 44, no_play: true, status: "enforced" } } });
  assert.equal(wiped.steps[0].ghosted, true);
  nearPt(wiped.label.at, 44, C - LABEL_GAP_YD, "a wiped-out punt labels under its ghosted arc too");
  const pass = draw(10);
  assert.deepEqual(shape(pass), ["arc:pass", "mark:incomplete", "mark:flag", "ground:march"]);
  assert.deepEqual(pass.steps.map((s) => s.ghosted), [true, true, false, false]);
});

test("a flag on a play that stands: the play, the flag where it was enforced, the march", () => {
  const d = draw(58);
  assert.equal(d.ghosted, false);
  assert.deepEqual(shape(d), ["ground:run", "mark:flag", "ground:march"]);
  nearPt(d.steps[1].at, 88, C);
  nearPt(d.steps[2].from, 88, C);
  nearPt(d.steps[2].to, 73, C);
  assert.equal(d.label.text, "Inside run (up the middle) · +2 · flag: face mask on DAL");
  nearPt(d.label.at, Math.min(88, 110 - labelHalfSpanYd(d.label.text)), C + LABEL_GAP_YD, "at the end of the run");
});

test("a flag on a return that stands walks from where it was enforced: TB 24, 10 yards, to TB 14", () => {
  const d = draw(94);
  assert.deepEqual(shape(d), ["arc:kickoff", "ground:return", "mark:flag", "ground:march"]);
  nearPt(d.steps[1].to, 74, C, "returned to the TB 26");
  nearPt(d.steps[2].at, 76, C, "the hold, at the TB 24");
  nearPt(d.steps[3].from, 76, C, "the walk starts at the enforcement spot");
  nearPt(d.steps[3].to, 86, C);
  nearPt(d.ballEnd, 86, C);
});

test("a pre-snap flag: the flag at the line and the march, labelled with the foul and its yards", () => {
  const d = draw(65);
  assert.deepEqual(shape(d), ["mark:flag", "ground:march"]);
  assert.deepEqual(d.steps.map((s) => s.ghosted), [false, false]);
  nearPt(d.steps[0].at, 39, C);
  nearPt(d.steps[1].to, 44, C);
  assert.deepEqual([d.resultLabel.text, d.label.text], ["FLAG", "Flag · false start on TB · −5"]);
  nearPt(d.label.at, 39, C + LABEL_GAP_YD);
});

test("blocked kicks: a block mark where the kick died, then the recovery", () => {
  const punt = bySeq(43);
  const blocked = buildDrawing({ ...punt, geo: { ...punt.geo, x_end: 40, x_next: 40 },
    kick: { ...punt.kick, blocked: true, dist: null, land_x: null, oob: false } });
  assert.deepEqual(shape(blocked), ["mark:blocked", "ground:return"]);
  nearPt(blocked.steps[0].at, 44, C);
  nearPt(blocked.steps[1].to, 40, C);
  assert.equal(blocked.label.text, "Punt · blocked");
  const fg = bySeq(87);
  const block = buildDrawing({ ...fg, kind: "fg_miss", geo: { ...fg.geo, x_next: 69 },
    kick: { ...fg.kick, blocked: true, good: false }, scoring: null });
  assert.deepEqual(shape(block), ["ground:hold", "mark:blocked"]);
  nearPt(block.steps[1].at, 69, C);
  assert.equal(block.resultLabel.text, "FG BLOCKED");
});

test("a safety: sacked in the end zone, then the free kick from the 20", () => {
  const sack = bySeq(114);
  const safety = { ...sack, geo: { ...sack.geo, x0: 97, x_end: 102, x_next: null },
    result: { ...sack.result, yards: -5, safety: true }, scoring: { team: "DAL", type: "SF", pts: 2, pat: null } };
  const d = buildDrawing(safety);
  assert.deepEqual(shape(d), ["ground:sack", "mark:sack", "mark:safety"]);
  assert.deepEqual([d.resultLabel.text, d.label.text], ["SAFETY", "Sack · safety"]);
  assert.deepEqual(situationAfterRow(safety), {
    ballX: 80, ltgX: null, dir: -1, poss: "TB", kind: "kickoff", goalToGo: false, down: null, togo: null,
  });
});

test("every row's label is its play-label text, beside the end of the play and never on the ball", () => {
  for (const row of allRows()) {
    const d = buildDrawing(row);
    if (row.kind === "admin") {
      assert.equal(d.label, null, `${row.seq}`);
      continue;
    }
    assert.equal(d.label.text, playLabel(row), `${row.seq}`);
    const { x, y } = d.label.at;
    const half = labelHalfSpanYd(d.label.text);
    assert.ok(x - half >= -10 - EPS && x + half <= 110 + EPS, `${row.seq}: the whole label is on the field (${x})`);
    assert.ok(y >= 1 && y <= 53.333 - 1, `${row.seq} label y ${y}`);
    assert.ok(Math.abs(y - C) >= LABEL_GAP_YD - EPS, `${row.seq}: the label clears the ball's center line (${y})`);
    assert.equal(typeof d.label.approx, "boolean");
  }
});

test("resultLabel keeps the play feed's short words at the end of the action", () => {
  const zero = { ...bySeq(95), result: { ...bySeq(95).result, yards: 0 } };
  assert.equal(buildDrawing(zero).resultLabel.text, "0");
  nearPt(draw(87).resultLabel.at, 110, C, "at the posts");
  nearPt(draw(8).resultLabel.at, 92, C, "a no-play is labelled at its flag");
  nearPt(draw(95).resultLabel.at, 14, C - 4, "the end of the run");
});

test("admin rows draw nothing", () => {
  const d = draw(13);
  assert.deepEqual(d.steps, []);
  assert.deepEqual([d.ballStart, d.ballEnd, d.bounds, d.resultLabel, d.label], [null, null, null, null, null]);
});

test("situation before a snap: LOS, line to gain, goal to go on the goal line", () => {
  assert.deepEqual(situationFromRow(bySeq(2)), {
    ballX: 30, ltgX: 40, dir: 1, poss: "DAL", kind: "snap", goalToGo: false, down: 1, togo: 10,
  });
  assert.deepEqual(situationFromRow(bySeq(15)), {
    ballX: 73, ltgX: 63, dir: -1, poss: "TB", kind: "snap", goalToGo: false, down: 1, togo: 10,
  });
  const goal = situationFromRow(bySeq(8));
  assert.equal(goal.ltgX, 100);
  assert.equal(goal.goalToGo, true);
  assert.deepEqual(situationFromRow(bySeq(1)), {
    ballX: 65, ltgX: null, dir: -1, poss: "TB", kind: "kickoff", goalToGo: false, down: null, togo: null,
  });
  assert.equal(situationFromRow(bySeq(13)), null);
});

test("situation after a row: next snap, possession flips on turnovers, kickoff after a score", () => {
  assert.deepEqual(situationAfterRow(bySeq(2)), {
    ballX: 30, ltgX: 40, dir: 1, poss: "DAL", kind: "snap", goalToGo: false, down: 2, togo: 10,
  });
  assert.deepEqual(situationAfterRow(bySeq(104)), {
    ballX: 75, ltgX: 65, dir: -1, poss: "TB", kind: "snap", goalToGo: false, down: 1, togo: 10,
  });
  const goal = situationAfterRow(bySeq(8));
  assert.equal(goal.ballX, 96);
  assert.equal(goal.ltgX, 100);
  assert.equal(goal.goalToGo, true);
  assert.deepEqual(situationAfterRow(bySeq(12)), {
    ballX: 35, ltgX: null, dir: 1, poss: "DAL", kind: "kickoff", goalToGo: false, down: null, togo: null,
  });
  assert.equal(situationAfterRow(bySeq(123)).ballX, 65);
  assert.equal(situationAfterRow(bySeq(1)).ltgX, 40);
  assert.equal(situationAfterRow(bySeq(13)), null);
});

test("buildDrawing rejects a missing row and never mutates its input", () => {
  assert.throws(() => buildDrawing(null), TypeError);
  for (const seq of [2, 113, 8, 87, 101, 104]) {
    const frozen = frozenCopy(bySeq(seq));
    assert.deepEqual(buildDrawing(frozen), buildDrawing(bySeq(seq)));
  }
  const d = draw(2);
  assert.ok(Object.isFrozen(d.steps[0].from) && Object.isFrozen(d.label.at));
});

test("every row of the game stays on the field, has no NaN, and ghosts only the wiped-out action", () => {
  for (const row of allRows()) {
    const d = buildDrawing(row);
    for (const { path, value } of numbersIn(d)) assert.ok(Number.isFinite(value), `${row.seq} ${path} = ${value}`);
    if (row.kind === "admin") {
      assert.equal(d.steps.length, 0, row.seq);
      continue;
    }
    assert.ok(d.ballStart, `${row.seq} ball start`);
    assert.ok(d.resultLabel?.text, `${row.seq} result label`);
    assert.ok(d.bounds, `${row.seq} bounds`);
    for (const p of d.steps.flatMap((s) => (s.t === "mark" ? [s.at] : [s.from, s.to]))) {
      assert.ok(p.x >= -10 && p.x <= 110, `${row.seq} x ${p.x}`);
      assert.ok(p.y >= 0 && p.y <= 53.333, `${row.seq} y ${p.y}`);
    }
    const ghosts = d.steps.filter((s) => s.ghosted);
    assert.equal(ghosts.length > 0, Boolean(row.result?.nullified) && row.kind !== "penalty", row.seq);
    for (const s of ghosts) assert.ok(!["flag", "march"].includes(s.role), `${row.seq} ${s.role} ghosted`);
  }
});
