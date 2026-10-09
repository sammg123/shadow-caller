// field/paths.js: one timeline row -> plain drawing data (data-contract B5, B6; directions grammar).
import assert from "node:assert/strict";
import test from "node:test";

import { buildDrawing, situationAfterRow, situationFromRow } from "../../static/js/field/paths.js";
import { allRows, frozenCopy, manualRow, numbersIn, rowById } from "./field-rows.mjs";

const C = 26.667;
const EPS = 1e-6;
const near = (a, b, label = "") => assert.ok(Math.abs(a - b) <= EPS, `${label} ${a} != ${b}`);
const nearPt = (p, x, y, label = "") => {
  assert.ok(p, `${label} point missing`);
  near(p.x, x, `${label} x`);
  near(p.y, y, `${label} y`);
};
const draw = (id) => buildDrawing(rowById(id));
const shape = (d) => d.steps.map((s) => `${s.t}:${s.role}`);

test("first DAL snap: drop from under center, arc into the short band, ball back at 30", () => {
  const d = draw("40187298068");
  assert.equal(d.seq, 2);
  assert.equal(d.id, "40187298068");
  assert.equal(d.kind, "play");
  assert.equal(d.team, "DAL");
  assert.equal(d.dir, 1);
  assert.equal(d.offenseIsCaller, true);
  assert.equal(d.ghosted, false);
  assert.deepEqual(shape(d), ["ground:snap", "arc:pass", "band:incomplete"]);
  const [snap, arc, band] = d.steps;
  nearPt(snap.from, 30, C, "snap from");
  nearPt(snap.to, 24, C, "under center drop 6");
  assert.equal(snap.approx, true);
  nearPt(arc.from, 24, C, "release");
  nearPt(arc.to, 35, C, "x_catch estimate");
  assert.equal(arc.approx, true);
  assert.equal(arc.endH, 0);
  near(arc.apex, 1.98, "apex");
  assert.equal(band.x0, 31);
  assert.equal(band.x1, 40);
  near(band.y0, C - 8.889, "middle third");
  near(band.y1, C + 8.889, "middle third");
  assert.equal(band.approx, true);
  nearPt(d.ballStart, 30, C, "ball start");
  nearPt(d.ballEnd, 30, C, "ball ends at the line");
  assert.equal(d.resultLabel.text, "INC");
  nearPt(d.resultLabel.at, 35, C, "label");
});

test("the 72-yard TB run: lane through the left tackle gap from 86 to 14", () => {
  const d = draw("4018729802242");
  assert.equal(d.dir, -1);
  assert.equal(d.offenseIsCaller, false);
  assert.deepEqual(shape(d), ["ground:snap", "corridor:run"]);
  const [snap, lane] = d.steps;
  nearPt(snap.to, 90, C, "mesh 4 yd behind the line");
  assert.equal(lane.x0, 86);
  assert.equal(lane.x1, 14);
  near(lane.yC, C - 4, "TB's left is the near side");
  assert.equal(lane.halfWidth, 1.5);
  assert.equal(lane.approx, true);
  nearPt(d.ballEnd, 14, C, "next snap");
  assert.equal(d.resultLabel.text, "+72");
  nearPt(d.resultLabel.at, 14, C - 4, "label at the end of the lane");
});

test("the 39-air-yard completion from 13: arc to 52, catch area, YAC to 61", () => {
  const d = draw("4018729801915");
  assert.deepEqual(shape(d), ["ground:snap", "arc:pass", "area:catch", "ground:yac"]);
  const [snap, arc, area, yac] = d.steps;
  nearPt(snap.from, 13, C);
  nearPt(snap.to, 6, C, "shotgun set point 7 yd deep");
  nearPt(arc.from, 6, C);
  nearPt(arc.to, 52, C);
  assert.equal(arc.approx, true, "thrown from the estimated set point: an estimate, even with exact air yards");
  near(arc.apex, 0.18 * 46, "apex scales with the throw");
  nearPt(area.at, 52, C);
  assert.equal(area.r, 2.5);
  assert.equal(area.approx, true);
  nearPt(yac.from, 52, C);
  nearPt(yac.to, 61, C);
  assert.equal(yac.approx, false);
  nearPt(d.ballEnd, 61, C);
  assert.equal(d.resultLabel.text, "+48");
});

test("the first TB completion: thrown behind the line to the left, then YAC", () => {
  const d = draw("401872980390");
  const arc = d.steps.find((s) => s.t === "arc");
  const yac = d.steps.find((s) => s.role === "yac");
  nearPt(arc.from, 79, C, "under center, 6 yd behind TB's line");
  nearPt(arc.to, 74, C - 12, "left for TB is the near side");
  nearPt(yac.to, 70, C - 12);
});

test("principle 3: every pass arc starts where its approximate snap step ends, so the arc is approximate too", () => {
  let passes = 0;
  for (const row of allRows()) {
    const steps = buildDrawing(row).steps;
    steps.forEach((step, i) => {
      if (step.t !== "arc" || step.role !== "pass") return;
      passes += 1;
      const snap = steps[i - 1];
      assert.equal(`${snap?.t}:${snap?.role}`, "ground:snap", `${row.id}: the drop comes first`);
      assert.equal(snap.approx, true, `${row.id}: the drop is a drawing convention`);
      assert.deepEqual(step.from, snap.to, `${row.id}: thrown from the set point`);
      assert.equal(step.approx, true, `${row.id}: a stroke from an estimated point is an estimate`);
    });
  }
  assert.ok(passes > 0, "the fixture has passes");
});

test("the sack: pushed back from 37 to 48 with a sack mark", () => {
  const d = draw("4018729802713");
  assert.deepEqual(shape(d), ["ground:sack", "mark:sack"]);
  nearPt(d.steps[0].from, 37, C);
  nearPt(d.steps[0].to, 48, C);
  assert.equal(d.steps[0].approx, false);
  nearPt(d.steps[1].at, 48, C);
  assert.equal(d.resultLabel.text, "-11");
  nearPt(d.ballEnd, 48, C);
});

test("the scramble: drop, then a lane around the right end", () => {
  const d = draw("401872980442");
  assert.deepEqual(shape(d), ["ground:snap", "corridor:scramble"]);
  nearPt(d.steps[0].to, 74, C, "shotgun set point behind TB's line");
  assert.equal(d.steps[1].x0, 67);
  assert.equal(d.steps[1].x1, 62);
  near(d.steps[1].yC, C + 8, "TB's right end is the far side");
  assert.equal(d.resultLabel.text, "+5");
});

test("interception: arc to the spot, turnover mark, one-yard return", () => {
  const d = draw("4018729802466");
  assert.deepEqual(shape(d), ["ground:snap", "arc:pass", "mark:turnover", "ground:return"]);
  nearPt(d.steps[1].from, 66, C);
  nearPt(d.steps[1].to, 76, C);
  assert.equal(d.steps[1].approx, true, "thrown from the estimated set point; the turnover mark holds the exact spot");
  nearPt(d.steps[2].at, 76, C);
  nearPt(d.steps[3].to, 75, C);
  assert.equal(d.resultLabel.text, "INT");
  nearPt(d.ballEnd, 75, C);
});

test("a deep incompletion near the goal: band clamped at the end line, in the left third", () => {
  const d = draw("4018729803719");
  const band = d.steps.find((s) => s.t === "band");
  assert.equal(band.x0, 101);
  assert.equal(band.x1, 110);
  near(band.y0, C + 8.889);
  near(band.y1, C + 25.667);
  const arc = d.steps.find((s) => s.t === "arc");
  nearPt(arc.to, 105, C + 12, "lands inside the band");
});

test("opening kickoff: 62-yard arc from 65 to 3, return to 30", () => {
  const d = draw("40187298040");
  assert.deepEqual(shape(d), ["arc:kickoff", "ground:return"]);
  nearPt(d.steps[0].from, 65, C);
  nearPt(d.steps[0].to, 3, C);
  near(d.steps[0].apex, 0.28 * 62, "generic height, true length");
  assert.equal(d.steps[0].approx, false);
  nearPt(d.steps[1].to, 30, C);
  nearPt(d.ballStart, 65, C);
  nearPt(d.ballEnd, 30, C);
  assert.equal(d.resultLabel.text, "KICKOFF 62");
});

test("kickoff with the lost fumble: return to 28, loose ball to 37, turnover", () => {
  const d = draw("4018729802667");
  assert.deepEqual(shape(d), ["arc:kickoff", "ground:return", "ground:return", "mark:turnover"]);
  nearPt(d.steps[0].to, 4, C);
  nearPt(d.steps[1].to, 28, C);
  nearPt(d.steps[2].to, 37, C);
  assert.equal(d.steps[2].approx, true);
  nearPt(d.steps[3].at, 37, C);
  assert.equal(d.resultLabel.text, "FUMBLE");
  nearPt(d.ballEnd, 37, C);
});

test("touchback: arc into the end zone, ball out to 65", () => {
  const d = draw("4018729803781");
  assert.deepEqual(shape(d), ["arc:kickoff", "mark:touchback"]);
  nearPt(d.steps[0].from, 35, C);
  nearPt(d.steps[0].to, 100, C);
  nearPt(d.ballEnd, 65, C);
  assert.equal(d.resultLabel.text, "TOUCHBACK");
});

test("DAL punt: 53 yards from 44 out of bounds at 97", () => {
  const d = draw("4018729801082");
  assert.deepEqual(shape(d), ["arc:punt", "mark:oob"]);
  nearPt(d.steps[0].from, 44, C);
  nearPt(d.steps[0].to, 97, C);
  near(d.steps[0].apex, 0.3 * 53);
  assert.equal(d.resultLabel.text, "PUNT 53");
  nearPt(d.ballEnd, 97, C);
});

test("field goals: hold 8 yd back, arc over the crossbar at the posts", () => {
  const dal = draw("4018729802060");
  assert.deepEqual(shape(dal), ["ground:hold", "arc:fg", "mark:fg_good"]);
  nearPt(dal.steps[0].from, 77, C);
  nearPt(dal.steps[0].to, 69, C);
  nearPt(dal.steps[1].to, 110, C);
  near(dal.steps[1].endH, 3.333 + 2, "clears the crossbar");
  assert.equal(dal.ballEnd, null);
  assert.equal(dal.resultLabel.text, "FG 41 GOOD");
  const tb = draw("4018729802919");
  nearPt(tb.steps[0].to, 31, C);
  nearPt(tb.steps[1].to, -10, C);
});

test("a missed field goal ends at the crossbar with a miss mark", () => {
  const row = rowById("4018729802060");
  const miss = buildDrawing({ ...row, kind: "fg_miss", kick: { ...row.kick, good: false }, scoring: null });
  assert.deepEqual(shape(miss), ["ground:hold", "arc:fg", "mark:fg_miss"]);
  near(miss.steps[1].endH, 3.333);
  assert.equal(miss.resultLabel.text, "FG MISSED");
});

test("no play: the run is a ghost, then the flag and the 4-yard march to 96", () => {
  const d = draw("401872980210");
  assert.equal(d.ghosted, true);
  assert.deepEqual(shape(d), ["ground:snap", "corridor:run", "mark:flag", "ground:march"]);
  assert.deepEqual(d.steps.map((s) => s.ghosted), [true, true, false, false]);
  assert.equal(d.steps[1].x1, 93);
  near(d.steps[1].yC, C + 4);
  nearPt(d.steps[2].at, 92, C);
  nearPt(d.steps[3].from, 92, C);
  nearPt(d.steps[3].to, 96, C);
  assert.equal(d.resultLabel.text, "FLAG");
  nearPt(d.ballEnd, 96, C);
});

test("a flag on a play that stands: the run, then the flag and the march to 73", () => {
  const d = draw("4018729801359");
  assert.equal(d.ghosted, false);
  assert.deepEqual(shape(d), ["ground:snap", "corridor:run", "mark:flag", "ground:march"]);
  nearPt(d.steps[2].at, 88, C);
  nearPt(d.steps[3].from, 88, C);
  nearPt(d.steps[3].to, 73, C);
  assert.equal(d.resultLabel.text, "+2");
});

test("touchdown run ends on the goal line with a TD mark and no next snap", () => {
  const d = draw("401872980322");
  assert.deepEqual(shape(d), ["ground:snap", "corridor:run", "mark:td"]);
  assert.equal(d.steps[1].x1, 100);
  nearPt(d.steps[2].at, 100, C);
  assert.equal(d.ballEnd, null);
  assert.equal(d.resultLabel.text, "TD");
});

test("admin rows draw nothing", () => {
  const d = draw("401872980353");
  assert.deepEqual(d.steps, []);
  assert.equal(d.ballStart, null);
  assert.equal(d.ballEnd, null);
  assert.equal(d.bounds, null);
  assert.equal(d.resultLabel, null);
});

test("manual mode: play-action catch from the bucket estimate, deeper drop for the fake", () => {
  const d = buildDrawing(manualRow());
  assert.deepEqual(shape(d), ["ground:snap", "arc:pass", "area:catch", "ground:yac"]);
  nearPt(d.steps[0].to, 17, C, "unknown alignment 7 yd plus the fake");
  nearPt(d.steps[1].to, 28, C);
  assert.equal(d.steps[1].approx, true);
  nearPt(d.steps[3].to, 33, C);
});

test("manual mode: a screen with no air yards lands behind the line, marked approximate", () => {
  const row = manualRow({
    geo: { dir: 1, x0: 25, x_end: 31, x_next: 31, x_catch: null, lat: null, gap: null, approx: ["lat"] },
    call: { family: "screen", leaf: "screen", outcome: null, depth: null, air: null, air_src: null, air_band: null,
      yac: null, align: null },
    result: { ...manualRow().result, yards: 6 },
  });
  const d = buildDrawing(row);
  const arc = d.steps.find((s) => s.t === "arc");
  nearPt(arc.to, 23, C);
  assert.equal(arc.approx, true);
  nearPt(d.steps.at(-1).to, 31, C);
});

test("manual mode: an incompletion with no depth spans the whole pass range", () => {
  const row = manualRow({
    geo: { dir: 1, x0: 25, x_end: 25, x_next: 25, x_catch: null, lat: null, gap: null, approx: ["lat"] },
    call: { family: "dropback", leaf: null, outcome: "incomplete", depth: null, air: null, air_src: null,
      air_band: null, yac: null, align: null },
    result: { ...manualRow().result, yards: 0 },
  });
  const band = buildDrawing(row).steps.find((s) => s.t === "band");
  assert.equal(band.x0, 26);
  assert.equal(band.x1, 57);
  near(band.y0, C - 25.667);
  near(band.y1, C + 25.667);
});

test("kneel, spike and a pre-snap flag", () => {
  const kneelRow = { ...rowById("4018729802713"), kind: "kneel", call: null,
    geo: { dir: -1, x0: 68, x_end: 69, x_next: 69, x_catch: null, lat: null, gap: null, approx: [] },
    result: { ...rowById("4018729802713").result, yards: -1 } };
  const kneel = buildDrawing(kneelRow);
  assert.deepEqual(shape(kneel), ["ground:kneel"]);
  assert.equal(kneel.resultLabel.text, "-1");
  const spike = buildDrawing({ ...kneelRow, kind: "spike", geo: { ...kneelRow.geo, x_end: 68, x_next: 68 },
    result: { ...kneelRow.result, yards: 0 } });
  assert.deepEqual(spike.steps, []);
  assert.equal(spike.resultLabel.text, "SPIKE");
  const flag = buildDrawing({ seq: 34, id: "401872980865", team: "TB", kind: "penalty", offense_is_caller: false,
    geo: { dir: -1, x0: 10, x_end: 10, x_next: 5, x_catch: null, lat: null, gap: null, approx: [] }, call: null,
    result: { yards: null, td: false, turnover: false, nullified: true,
      penalty: { on: "DAL", foul: "Neutral Zone Infraction", yards: 5, at_x: 10, no_play: true, status: "enforced" } },
    kick: null });
  assert.deepEqual(shape(flag), ["mark:flag", "ground:march"]);
  assert.deepEqual(flag.steps.map((s) => s.ghosted), [false, false]);
  nearPt(flag.steps[1].to, 5, C);
  assert.equal(flag.resultLabel.text, "FLAG");
});

test("a lost fumble: the lane ends at the fumble, then the defense's runback to its next snap", () => {
  const run = rowById("4018729802242");
  const fumble = { ...run, geo: { ...run.geo, x_end: 76, x_next: 84 },
    result: { ...run.result, yards: 10, turnover: true, turnover_kind: "fumble", first_down: false } };
  const d = buildDrawing(fumble);
  assert.deepEqual(shape(d), ["ground:snap", "corridor:run", "mark:turnover", "ground:return"]);
  assert.equal(d.steps[1].x1, 76);
  nearPt(d.steps[2].at, 76, C - 4);
  nearPt(d.steps[3].to, 84, C - 4);
  assert.equal(d.steps[3].approx, true);
  assert.equal(d.resultLabel.text, "FUMBLE");
  const scoop = { ...fumble, geo: { ...fumble.geo, x_end: 100, x_next: null },
    scoring: { team: "DAL", type: "TD", pts: 7, pat: "kick_good" } };
  const s = buildDrawing(scoop);
  assert.deepEqual(shape(s), ["ground:snap", "corridor:run", "mark:turnover", "ground:return", "mark:td"]);
  nearPt(s.steps[4].at, 100, C - 4);
  assert.equal(s.resultLabel.text, "FUMBLE TD");
  assert.deepEqual(situationAfterRow(scoop), {
    ballX: 35, ltgX: null, dir: 1, poss: "DAL", kind: "kickoff", goalToGo: false, down: null, togo: null,
  });
});

test("blocked kicks: a block mark where the kick died, then the recovery", () => {
  const punt = rowById("4018729801082");
  const blocked = buildDrawing({ ...punt, geo: { ...punt.geo, x_end: 40, x_next: 40 },
    kick: { ...punt.kick, blocked: true, dist: null, land_x: null, oob: false } });
  assert.deepEqual(shape(blocked), ["mark:blocked", "ground:return"]);
  nearPt(blocked.steps[0].at, 44, C);
  nearPt(blocked.steps[1].to, 40, C);
  const fg = rowById("4018729802060");
  const block = buildDrawing({ ...fg, kind: "fg_miss", geo: { ...fg.geo, x_next: 69 },
    kick: { ...fg.kick, blocked: true, good: false }, scoring: null });
  assert.deepEqual(shape(block), ["ground:hold", "mark:blocked"]);
  nearPt(block.steps[1].at, 69, C);
  assert.equal(block.resultLabel.text, "FG BLOCKED");
});

test("a safety: sacked in the end zone, then the free kick from the 20", () => {
  const sack = rowById("4018729802713");
  const safety = { ...sack, geo: { ...sack.geo, x0: 97, x_end: 102, x_next: null },
    result: { ...sack.result, yards: -5, safety: true }, scoring: { team: "DAL", type: "SF", pts: 2, pat: null } };
  const d = buildDrawing(safety);
  assert.deepEqual(shape(d), ["ground:sack", "mark:sack", "mark:safety"]);
  assert.equal(d.resultLabel.text, "SAFETY");
  assert.deepEqual(situationAfterRow(safety), {
    ballX: 80, ltgX: null, dir: -1, poss: "TB", kind: "kickoff", goalToGo: false, down: null, togo: null,
  });
});

test("labels use the play feed's result words, at the end of the action", () => {
  const zero = { ...rowById("4018729802242"), result: { ...rowById("4018729802242").result, yards: 0 } };
  assert.equal(buildDrawing(zero).resultLabel.text, "0");
  assert.equal(draw("4018729802060").resultLabel.text, "FG 41 GOOD");
  nearPt(draw("4018729802060").resultLabel.at, 110, C, "at the posts");
  nearPt(draw("401872980210").resultLabel.at, 92, C, "a no-play is labelled at its flag");
});

test("situation before a snap: LOS, line to gain, goal to go on the goal line", () => {
  assert.deepEqual(situationFromRow(rowById("40187298068")), {
    ballX: 30, ltgX: 40, dir: 1, poss: "DAL", kind: "snap", goalToGo: false, down: 1, togo: 10,
  });
  assert.deepEqual(situationFromRow(rowById("401872980390")), {
    ballX: 73, ltgX: 63, dir: -1, poss: "TB", kind: "snap", goalToGo: false, down: 1, togo: 10,
  });
  const goal = situationFromRow(rowById("401872980210"));
  assert.equal(goal.ltgX, 100);
  assert.equal(goal.goalToGo, true);
  assert.deepEqual(situationFromRow(rowById("40187298040")), {
    ballX: 65, ltgX: null, dir: -1, poss: "TB", kind: "kickoff", goalToGo: false, down: null, togo: null,
  });
  assert.equal(situationFromRow(rowById("401872980353")), null);
});

test("situation after a row: next snap, possession flips on turnovers, kickoff after a score", () => {
  assert.deepEqual(situationAfterRow(rowById("40187298068")), {
    ballX: 30, ltgX: 40, dir: 1, poss: "DAL", kind: "snap", goalToGo: false, down: 2, togo: 10,
  });
  assert.deepEqual(situationAfterRow(rowById("4018729802466")), {
    ballX: 75, ltgX: 65, dir: -1, poss: "TB", kind: "snap", goalToGo: false, down: 1, togo: 10,
  });
  const goal = situationAfterRow(rowById("401872980210"));
  assert.equal(goal.ballX, 96);
  assert.equal(goal.ltgX, 100);
  assert.equal(goal.goalToGo, true);
  assert.deepEqual(situationAfterRow(rowById("401872980322")), {
    ballX: 35, ltgX: null, dir: 1, poss: "DAL", kind: "kickoff", goalToGo: false, down: null, togo: null,
  });
  assert.equal(situationAfterRow(rowById("4018729802919")).ballX, 65);
  assert.equal(situationAfterRow(rowById("40187298040")).ltgX, 40);
  assert.equal(situationAfterRow(rowById("401872980353")), null);
});

test("buildDrawing rejects a missing row and never mutates its input", () => {
  assert.throws(() => buildDrawing(null), TypeError);
  for (const id of ["40187298068", "4018729802667", "401872980210", "4018729802060"]) {
    const frozen = frozenCopy(rowById(id));
    assert.deepEqual(buildDrawing(frozen), buildDrawing(rowById(id)));
  }
  assert.ok(Object.isFrozen(draw("40187298068").steps[0].from));
});

test("every row of the game stays on the field, has no NaN, and ghosts only the wiped-out action", () => {
  for (const row of allRows()) {
    const d = buildDrawing(row);
    for (const { path, value } of numbersIn(d)) assert.ok(Number.isFinite(value), `${row.id} ${path} = ${value}`);
    if (row.kind === "admin") {
      assert.equal(d.steps.length, 0, row.id);
      continue;
    }
    assert.ok(d.ballStart, `${row.id} ball start`);
    assert.ok(d.resultLabel?.text, `${row.id} label`);
    assert.ok(d.bounds, `${row.id} bounds`);
    for (const p of pointsOf(d)) {
      assert.ok(p.x >= -10 && p.x <= 110, `${row.id} x ${p.x}`);
      assert.ok(p.y >= 0 && p.y <= 53.333, `${row.id} y ${p.y}`);
    }
    const ghosts = d.steps.filter((s) => s.ghosted);
    assert.equal(ghosts.length > 0, Boolean(row.result?.nullified) && row.kind !== "penalty", row.id);
    for (const s of ghosts) assert.ok(!["flag", "march"].includes(s.role), `${row.id} ${s.role} ghosted`);
  }
});

function pointsOf(d) {
  return d.steps.flatMap((s) => {
    if (s.t === "arc" || s.t === "ground") return [s.from, s.to];
    if (s.t === "corridor") return [{ x: s.x0, y: s.yC - s.halfWidth }, { x: s.x1, y: s.yC + s.halfWidth }];
    if (s.t === "band") return [{ x: s.x0, y: s.y0 }, { x: s.x1, y: s.y1 }];
    return [s.at];
  });
}
