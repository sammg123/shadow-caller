// field/paths.js: one timeline row -> plain drawing data. Shapes follow docs/design/play-drawing.md (binding,
// 2026-10-09): every scrimmage play starts on the line of scrimmage (no drop, no mesh, no play-action fake), a pass
// is an arc, an incompletion an arc ending in an X, a run one flat line with its yards; kicks are as before.
import assert from "node:assert/strict";
import test from "node:test";

import { LABEL_GAP_YD, labelHalfSpanYd } from "../../static/js/field/grammar.js";
import { buildDrawing, situationAfterRow } from "../../static/js/field/paths.js";
import { labelBox, labelFootprint } from "../../static/js/field/play-label.js";
import { allRows, manualRow, rowBySeq } from "./field-rows.mjs";

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
const SCRIMMAGE = new Set(["play", "kneel", "spike", "other"]);

test("the first DAL snap: an arc from the line of scrimmage to the short estimate, an X, no band (play-drawing 2)", () => {
  const d = draw(2);
  assert.deepEqual([d.seq, d.id, d.kind, d.team, d.dir, d.offenseIsCaller, d.ghosted],
    [2, "40187298068", "play", "DAL", 1, true, false]);
  assert.deepEqual(shape(d), ["arc:pass", "mark:incomplete"]);
  const [arc, x] = d.steps;
  nearPt(arc.from, 30, C, "starts on the line of scrimmage");
  nearPt(arc.to, 35, C, "ESPN's short estimate, middle lane");
  assert.equal(arc.approx, false, "the real play draws solid (play-drawing.md 4): its words carry the estimate");
  assert.equal(arc.endH, 0);
  near(arc.apex, 1.5, "apex");
  nearPt(x.at, 35, C, "the X at the target");
  assert.equal(x.approx, false, "a clear X");
  nearPt(d.ballStart, 30, C);
  nearPt(d.ballEnd, 30, C, "the ball goes back to the line");
  assert.deepEqual([d.resultLabel.text, d.label.text], ["INC", "Short pass middle · incomplete"]);
  nearPt(d.label.at, 35, C - LABEL_GAP_YD, "beside the X, under the arc: an arc rises up the screen");
  assert.equal(d.label.approx, true, "'short' is ESPN's estimate (play-drawing.md 5)");
});

test("a real play draws solid: no stroke or mark of a real pass is an estimate; label.approx says which words are", () => {
  let incompletions = 0;
  for (const row of allRows().filter((r) => r.kind === "play")) {
    const d = buildDrawing(row);
    const pass = d.steps.filter((s) => s.role === "pass" || ["catch", "incomplete", "int"].includes(s.role));
    for (const s of pass) assert.equal(s.approx, false, `${row.seq} ${s.role}`);
    if (row.call?.outcome !== "incomplete" || row.result?.nullified) continue;
    incompletions += 1;
    const guessed = row.geo.x_catch === null || row.geo.approx.includes("x_catch");
    assert.equal(d.label.approx, guessed, `${row.seq}: the target is ${guessed ? "an estimate" : "exact"}`);
  }
  assert.equal(incompletions, 22);
});

test("every label is clear of its own play as the sideline cameras show it (an arc rises up the screen)", () => {
  let checked = 0;
  for (const row of allRows()) {
    const d = buildDrawing(row);
    if (!d.label) continue;
    const box = labelBox(d.label);
    const points = [...labelFootprint(d.steps), d.ballStart, d.ballEnd].filter(Boolean);
    const hit = points.find((p) => Math.abs(p.x - box.u) < box.hw && Math.abs(-p.y - box.v) < box.hh);
    assert.equal(hit, undefined, `${row.seq} "${d.label.text}" at (${d.label.at.x}, ${d.label.at.y}) covers ${JSON.stringify(hit)}`);
    checked += 1;
  }
  assert.ok(checked > 150, `checked ${checked}`);
});

test("a completion: arc from the line to the catch in the side's lane, a catch dot, YAC flat on the turf", () => {
  const d = draw(101);
  assert.deepEqual(shape(d), ["arc:pass", "mark:catch", "ground:yac"]);
  const [arc, dot, yac] = d.steps;
  nearPt(arc.from, 39, C);
  nearPt(arc.to, 47, C + 12, "8 air yards, left lane");
  assert.equal(arc.approx, false, "exact air yards from the line: no estimate left");
  near(arc.apex, 0.18 * Math.hypot(8, 12), "apex scales with the throw");
  nearPt(dot.at, 47, C + 12);
  assert.equal(dot.approx, false);
  nearPt(yac.from, 47, C + 12);
  nearPt(yac.to, 66, C + 12, "to where he went down");
  assert.equal(yac.approx, false);
  nearPt(d.ballEnd, 66, C);
  assert.equal(d.label.text, "Short pass left · +27");
  nearPt(d.label.at, 66, C + 12 + LABEL_GAP_YD, "outward from the lane, away from the ball");
  assert.equal(d.label.approx, false);
});

test("the 39-air-yard completion from 13: one long arc to 52, then 9 yards after the catch", () => {
  const d = draw(81);
  assert.deepEqual(shape(d), ["arc:pass", "mark:catch", "ground:yac"]);
  nearPt(d.steps[0].from, 13, C);
  nearPt(d.steps[0].to, 52, C);
  near(d.steps[0].apex, 0.18 * 39);
  nearPt(d.steps[2].to, 61, C);
  assert.equal(d.label.text, "Deep pass middle · +48");
});

test("TB's first completion, caught behind the line on its left (the near side), then YAC", () => {
  const d = draw(15);
  nearPt(d.steps[0].from, 73, C);
  nearPt(d.steps[0].to, 74, C - 12, "one yard behind TB's line");
  nearPt(d.steps[2].to, 70, C - 12);
  nearPt(d.label.at, 70, C - 12 - LABEL_GAP_YD, "near-side lane: the label goes nearer the sideline");
});

test("no snap step anywhere: every scrimmage play starts on the line of scrimmage, on the center line", () => {
  let checked = 0;
  for (const row of allRows()) {
    const d = buildDrawing(row);
    for (const s of d.steps) {
      assert.ok(["arc", "ground", "mark"].includes(s.t), `${row.seq}: ${s.t} is not in the vocabulary`);
      assert.notEqual(s.role, "snap", `${row.seq}: no snap step`);
    }
    if (!SCRIMMAGE.has(row.kind) || !d.steps.length || d.steps[0].t === "mark") continue;
    nearPt(d.steps[0].from, row.geo.x0, C, `row ${row.seq} starts at the line of scrimmage`);
    checked += 1;
  }
  assert.ok(checked > 100, `checked ${checked} snaps`);
});

test("a run is one flat line from the line of scrimmage to the end spot, angled to its gap (the 72-yard TB run)", () => {
  const d = draw(95);
  assert.equal(d.dir, -1);
  assert.equal(d.offenseIsCaller, false);
  assert.deepEqual(shape(d), ["ground:run"]);
  const [line] = d.steps;
  nearPt(line.from, 86, C);
  nearPt(line.to, 14, C - 4, "TB's left tackle is the near side");
  assert.equal(line.approx, false, "the yards are exact; lanes are approximate by nature");
  nearPt(d.ballEnd, 14, C);
  assert.deepEqual([d.resultLabel.text, d.label.text], ["+72", "Off-tackle left · +72"]);
  nearPt(d.label.at, 14, C - 4 - LABEL_GAP_YD);
});

test("runs for a loss angle backward; no gain up the middle is a line of no length on the line", () => {
  const loss = draw(41);
  nearPt(loss.steps[0].from, 46, C);
  nearPt(loss.steps[0].to, 44, C + 2, "DAL's left guard is the far side");
  assert.equal(loss.label.text, "Inside run (left guard) · −2");
  const stuffed = draw(9);
  assert.deepEqual(shape(stuffed), ["ground:run"]);
  nearPt(stuffed.steps[0].from, 96, C);
  nearPt(stuffed.steps[0].to, 96, C);
  assert.equal(stuffed.label.text, "Inside run (up the middle) · no gain");
  nearPt(stuffed.label.at, 110 - labelHalfSpanYd(stuffed.label.text), C + LABEL_GAP_YD,
    "at the 4: the long label slides back so it ends at the end line");
});

test("a scramble is a straight line like a run, around the right end", () => {
  const d = draw(17);
  assert.deepEqual(shape(d), ["ground:scramble"]);
  nearPt(d.steps[0].from, 67, C);
  nearPt(d.steps[0].to, 62, C + 8, "TB's right end is the far side");
  assert.equal(d.label.text, "QB scramble right · +5");
});

test("a sack: straight back from the line to the sack spot, with a sack mark", () => {
  const d = draw(114);
  assert.deepEqual(shape(d), ["ground:sack", "mark:sack"]);
  nearPt(d.steps[0].from, 37, C);
  nearPt(d.steps[0].to, 48, C);
  assert.equal(d.steps[0].approx, false);
  nearPt(d.steps[1].at, 48, C);
  assert.deepEqual([d.resultLabel.text, d.label.text], ["-11", "Sack · −11"]);
  nearPt(d.ballEnd, 48, C);
});

test("an interception: arc to the spot, an INT mark, the return flat on the turf", () => {
  const d = draw(104);
  assert.deepEqual(shape(d), ["arc:pass", "mark:int", "ground:return"]);
  nearPt(d.steps[0].from, 73, C);
  nearPt(d.steps[0].to, 76, C);
  assert.equal(d.steps[0].approx, false, "the interception spot is in the text");
  nearPt(d.steps[1].at, 76, C);
  nearPt(d.steps[2].to, 75, C);
  assert.equal(d.label.text, "Pass intercepted · short middle");
  nearPt(d.label.at, 75, C - LABEL_GAP_YD, "under its arc");
  nearPt(d.ballEnd, 75, C);
  assert.deepEqual(shape(draw(176)), ["arc:pass", "mark:int"], "tackled where he caught it: no return line");
});

test("deep incompletions: the X in the side's lane, kept inside the end line", () => {
  const d = draw(158);
  assert.deepEqual(shape(d), ["arc:pass", "mark:incomplete"]);
  nearPt(d.steps[0].to, 105, C + 12, "23 yards from the 82, in the end zone");
  nearPt(d.steps[1].at, 105, C + 12);
  const row = bySeq(158);
  const deeper = buildDrawing({ ...row, geo: { ...row.geo, x0: 95, x_end: 95, x_next: 95, x_catch: null } });
  nearPt(deeper.steps[1].at, 109, C + 12, "capped 1 yd inside the end line");
  const back = buildDrawing({ ...row, geo: { ...row.geo, dir: -1, x0: 5, x_end: 5, x_next: 5, x_catch: null } });
  nearPt(back.steps[1].at, -9, C - 12);
});

test("touchdowns end in the end zone with a TD mark and no next snap", () => {
  const run = draw(12);
  assert.deepEqual(shape(run), ["ground:run", "mark:td"]);
  nearPt(run.steps[0].to, 100, C);
  nearPt(run.steps[1].at, 100, C);
  assert.equal(run.ballEnd, null);
  assert.equal(run.label.text, "Inside run (up the middle) · TD");
  const pass = draw(159);
  assert.deepEqual(shape(pass), ["arc:pass", "mark:catch", "mark:td"]);
  nearPt(pass.steps[0].from, 82, C);
  nearPt(pass.steps[0].to, 100, C + 12);
  assert.equal(pass.label.text, "Deep pass left · TD");
  nearPt(pass.label.at, 100, C + 12 - LABEL_GAP_YD, "the far side is where the arc comes down: the inside instead");
});

test("manual mode: the play-action catch at the bucket estimate, thrown from the line", () => {
  const d = buildDrawing(manualRow());
  assert.deepEqual(shape(d), ["arc:pass", "mark:catch", "ground:yac"]);
  nearPt(d.steps[0].from, 25, C, "no deeper drop for the fake");
  nearPt(d.steps[0].to, 28, C);
  assert.equal(d.steps[0].approx, false, "the bucket median is an estimate, drawn solid: 'short' says so");
  assert.equal(d.steps[1].approx, false);
  nearPt(d.steps[2].to, 33, C);
  assert.equal(d.steps[2].approx, false);
  assert.equal(d.label.text, "Play-action short pass · +8");
  assert.equal(d.label.approx, false, "the end spot is exact");
});

test("manual mode: a screen lands behind the line; an incompletion with no depth lands at the short median", () => {
  const screen = buildDrawing(manualRow({
    geo: { dir: 1, x0: 25, x_end: 31, x_next: 31, x_catch: null, lat: null, gap: null, approx: ["lat"] },
    call: { family: "screen", leaf: "screen", outcome: null, depth: null, air: null, air_src: null, air_band: null,
      yac: null, align: null },
    result: { ...manualRow().result, yards: 6 },
  }));
  nearPt(screen.steps[0].from, 25, C);
  nearPt(screen.steps[0].to, 23, C);
  assert.equal(screen.steps[0].approx, false);
  nearPt(screen.steps.at(-1).to, 31, C);
  assert.equal(screen.label.text, "Screen · +6");
  const inc = buildDrawing(manualRow({
    geo: { dir: 1, x0: 25, x_end: 25, x_next: 25, x_catch: null, lat: null, gap: null, approx: ["lat"] },
    call: { family: "dropback", leaf: null, outcome: "incomplete", depth: null, air: null, air_src: null,
      air_band: null, yac: null, align: null },
    result: { ...manualRow().result, yards: 0 },
  }));
  assert.deepEqual(shape(inc), ["arc:pass", "mark:incomplete"]);
  nearPt(inc.steps[1].at, 30, C);
  assert.equal(inc.label.text, "Pass · incomplete");
});

test("manual mode: a run knows only its leaf, so it angles to the leaf's gap", () => {
  const base = manualRow();
  const d = buildDrawing({ ...base, geo: { ...base.geo, x_catch: null, lat: "left", gap: null, approx: [] },
    call: { ...base.call, family: "run", leaf: "run_edge_left", depth: null, air: null, air_src: null, air_band: null },
    result: { ...base.result, yards: 8 } });
  assert.deepEqual(shape(d), ["ground:run"]);
  nearPt(d.steps[0].to, 33, C + 8);
  assert.equal(d.label.text, "Outside run left · +8");
});

test("kneels and spikes", () => {
  const kneel = draw(181);
  assert.deepEqual(shape(kneel), ["ground:kneel"]);
  nearPt(kneel.steps[0].from, 68, C);
  nearPt(kneel.steps[0].to, 69, C);
  assert.equal(kneel.label.text, "Kneel · −1");
  const row = bySeq(181);
  const spike = buildDrawing({ ...row, kind: "spike", geo: { ...row.geo, x_end: 68, x_next: 68 },
    result: { ...row.result, yards: 0 } });
  assert.deepEqual(spike.steps, []);
  assert.equal(spike.resultLabel.text, "SPIKE");
  assert.equal(spike.label.text, "Spike · clock stopped");
  nearPt(spike.label.at, 68, C + LABEL_GAP_YD);
});

test("a lost fumble: the line ends at the fumble, then the defense's runback (to its touchdown)", () => {
  const run = bySeq(95);
  const fumble = { ...run, geo: { ...run.geo, x_end: 76, x_next: 84 },
    result: { ...run.result, yards: 10, turnover: true, turnover_kind: "fumble", first_down: false } };
  const d = buildDrawing(fumble);
  assert.deepEqual(shape(d), ["ground:run", "mark:turnover", "ground:return"]);
  nearPt(d.steps[0].to, 76, C - 4);
  nearPt(d.steps[1].at, 76, C - 4);
  nearPt(d.steps[2].to, 84, C - 4);
  assert.equal(d.steps[2].approx, true);
  assert.deepEqual([d.resultLabel.text, d.label.text], ["FUMBLE", "Off-tackle left · fumble lost"]);
  assert.equal(d.label.approx, true);
  const scoop = { ...fumble, geo: { ...fumble.geo, x_end: 100, x_next: null },
    scoring: { team: "DAL", type: "TD", pts: 7, pat: "kick_good" } };
  const s = buildDrawing(scoop);
  assert.deepEqual(shape(s), ["ground:run", "mark:turnover", "ground:return", "mark:td"]);
  nearPt(s.steps[3].at, 100, C - 4);
  assert.equal(s.resultLabel.text, "FUMBLE TD");
  assert.deepEqual(situationAfterRow(scoop), {
    ballX: 35, ltgX: null, dir: 1, poss: "DAL", kind: "kickoff", goalToGo: false, down: null, togo: null,
  });
});
