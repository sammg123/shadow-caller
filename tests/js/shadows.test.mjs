// field/shadows.js: before each Dallas snap, the top 2 most likely plays drawn as dashed, translucent shadow plays in
// the same shape language as real plays, with "1 · Deep shot (20+) · 31%" underneath (play-drawing.md section 4).
import assert from "node:assert/strict";
import test from "node:test";

import { LEAVES } from "../../static/js/core/domain.js";
import { buildGhostSet, ghostInputFromPrediction } from "../../static/js/field/ghosts.js";
import { LABEL_CHAR_YD, LABEL_LINE_YD, labelHalfSpanYd } from "../../static/js/field/grammar.js";
import { buildDrawing, situationFromRow } from "../../static/js/field/paths.js";
import { labelBox, labelFootprint } from "../../static/js/field/play-label.js";
import { shadowInputOf } from "../../static/js/field/play-style.js";
import {
  LEAF_NAMES, SHADOW_COUNT, SHADOW_STACK_LIFT, buildShadowPlays, shadowCandidates, shadowForLeaf,
} from "../../static/js/field/shadows.js";
import { planDrawing } from "../../static/js/field/timing.js";
import { allRows, capture, frozenCopy, numbersIn, rowBySeq } from "./field-rows.mjs";

const C = 26.667;
const EPS = 1e-6;
const near = (a, b, label = "") => assert.ok(Math.abs(a - b) <= EPS, `${label} ${a} != ${b}`);
const nearPt = (p, x, y, label = "") => {
  assert.ok(p, `${label} point missing`);
  near(p.x, x, `${label} x`);
  near(p.y, y, `${label} y`);
};
const firstSnap = () => rowBySeq(2);
const strokeOf = (s) => s.drawing.steps[0];

// /api/state prediction at 1st & 10, DAL 25 (sandbox capture, tests/fixtures/state_tb_dal_drive_d25.json).
const D25_PREDICTION = {
  top: [
    { family: "Dropback pass", key: "dropback_deep", name: "Deep shot (20+)", p: 0.47520687172203646 },
    { family: "Dropback pass", key: "dropback_short", name: "Short (0–9 air yds)", p: 0.24828488454212458 },
    { family: "Dropback pass", key: "dropback_mid", name: "Intermediate (10–19)", p: 0.1390874986076315 },
  ],
  families: [
    { key: "dropback", p: 0.8625792548717925, leaves: [
      { key: "dropback_deep", name: "Deep shot (20+)", p: 0.47520687172203646 },
      { key: "dropback_short", name: "Short (0–9 air yds)", p: 0.24828488454212458 },
      { key: "dropback_mid", name: "Intermediate (10–19)", p: 0.1390874986076315 }] },
    { key: "run", p: 0.07743939016723235, leaves: [
      { key: "run_inside", name: "Inside run (A/B gap)", p: 0.04938049286708704 },
      { key: "run_ot_left", name: "Off-tackle left", p: 0.009361681450096108 }] },
    { key: "screen", p: 0.04632308156745845, leaves: [{ key: "screen", name: "Screen", p: 0.04632308156745845 }] },
  ],
};
const D25 = Object.freeze({ ballX: 25, ltgX: 35, dir: 1, poss: "DAL", kind: "snap", goalToGo: false, down: 1,
  togo: 10 });
const at = (ballX, dir = 1) => ({ ...D25, ballX, dir, ltgX: null });

/** The overlap model the stacking promises: label boxes `text.length * LABEL_CHAR_YD` wide, one line tall. */
function overlaps(a, b) {
  const half = (l) => (l.text.length * LABEL_CHAR_YD) / 2;
  return Math.abs(a.at.x - b.at.x) < half(a) + half(b) - EPS && Math.abs(a.at.y - b.at.y) < LABEL_LINE_YD - EPS;
}

/** The first stroke point (labelFootprint, in the view `metrics`) under a label, or undefined. */
function coveredBy(label, steps, metrics) {
  const box = labelBox(label, metrics);
  const d = metrics?.down ?? { x: 0, y: -1 };
  return labelFootprint(steps, metrics).find((p) => Math.abs(p.x * -d.y + p.y * d.x - box.u) < box.hw
    && Math.abs(p.x * d.x + p.y * d.y - box.v) < box.hh);
}

/** Two labels' boxes overlap in the view `metrics`. */
function boxesMeet(a, b, metrics) {
  const [p, q] = [labelBox(a, metrics), labelBox(b, metrics)];
  return Math.abs(p.u - q.u) < p.hw + q.hw - EPS && Math.abs(p.v - q.v) < p.hh + q.hh - EPS;
}

/** The play drawn before row index i (admin rows draw nothing), as the field keeps it dimmed before the snap. */
function previousDrawing(rows, i) {
  const prev = rows.slice(0, i).reverse().find((r) => r.kind !== "admin");
  return prev ? buildDrawing(prev) : null;
}

/** The shadows' words as one block in rank order: each line lower on the screen than the one before, never touching
 * (labelBox in the view `metrics`: past the line of scrimmage a line takes more yards). */
function stackedInOrder(shadows, metrics) {
  const boxes = shadows.map((s) => labelBox(s.label, metrics));
  return boxes.every((b, i) => i === 0 || b.v - boxes[i - 1].v >= b.hh + boxes[i - 1].hh - EPS);
}

/** A phone held upright: the Under the Lights wide camera at 390x844 as measured on the page (its pose before the
 * 7th snap, 29 px plate lines): deep lines, deeper still past the line of scrimmage. */
const PHONE = Object.freeze({ charYd: 0.82, lineYd: 8.96, padYd: 1.55, down: { x: 0, y: -1 }, lifts: [2.18],
  grow: 0.0175, atV: -C });

test("the first DAL snap: inside run, then play-action short, from his model's own top 3 (row pred)", () => {
  const shadows = buildShadowPlays(firstSnap().pred, situationFromRow(firstSnap()));
  assert.equal(SHADOW_COUNT, 2);
  assert.equal(shadows.length, 2);
  const [run, pa] = shadows;
  assert.deepEqual([run.rank, run.leaf, run.family, run.p, run.hovered], [1, "run_inside", "run", 0.27331, false]);
  assert.deepEqual([pa.rank, pa.leaf, pa.family, pa.p, pa.hovered], [2, "pa_short", "pa", 0.15806, false]);
  assert.equal(run.label.text, "1 · Inside run (A/B gap) · 27%");
  assert.equal(pa.label.text, "2 · PA short (0–9) · 16%");
  assert.deepEqual(strokeOf(run).t, "ground", "a run is a straight line on the turf");
  nearPt(strokeOf(run).from, 30, C, "from the line of scrimmage");
  nearPt(strokeOf(run).to, 34, C, "inside: 4 yards straight ahead");
  assert.equal(strokeOf(pa).t, "arc", "play-action uses the same arcs");
  nearPt(strokeOf(pa).from, 30, C);
  nearPt(strokeOf(pa).to, 36, C, "the short bucket's 6 air yards, middle lane");
  near(strokeOf(pa).apex, 1.5);
});

test("from /api/state's prediction: the deep shot, then the short pass, named as the panel names them", () => {
  const [deep, short] = buildShadowPlays(D25_PREDICTION, D25);
  assert.equal(deep.label.text, "1 · Deep shot (20+) · 48%");
  assert.equal(short.label.text, "2 · Short (0–9 air yds) · 25%");
  nearPt(strokeOf(deep).to, 50, C, "25 air yards");
  near(strokeOf(deep).apex, 0.18 * 25);
  nearPt(strokeOf(short).to, 31, C);
});

test("the spec's own example text: '1 · Deep shot (20+) · 31%' and '2 · Inside run (A/B gap) · 22%'", () => {
  const prediction = { top: [{ key: "dropback_deep", name: "Deep shot (20+)", p: 0.31 },
    { key: "run_inside", name: "Inside run (A/B gap)", p: 0.22 }, { key: "screen", name: "Screen", p: 0.1 }] };
  assert.deepEqual(buildShadowPlays(prediction, D25).map((s) => s.label.text),
    ["1 · Deep shot (20+) · 31%", "2 · Inside run (A/B gap) · 22%"]);
});

test("shadows read as shadows: every stroke dashed and translucent (50% for #1, 35% for #2), never solid", () => {
  const shadows = buildShadowPlays(D25_PREDICTION, D25, { count: 3 });
  assert.deepEqual(shadows.map((s) => s.drawing.opacity), [0.5, 0.35, 0.35]);
  for (const s of shadows) {
    assert.equal(s.drawing.kind, "shadow");
    assert.equal(s.drawing.dashed, true);
    for (const step of s.drawing.steps) {
      assert.equal(step.dashed, true);
      assert.equal(step.opacity, s.drawing.opacity);
      assert.ok(step.opacity < 1);
      assert.equal(step.ghosted, false);
    }
  }
});

test("the geometry of play-drawing.md 4: passes to the middle lane at 6, 14 and 25; runs 4 yards to their gap", () => {
  const expect = {
    run_inside: ["ground", 54, C], rpo_run: ["ground", 54, C],
    run_ot_left: ["ground", 54, C + 4], run_ot_right: ["ground", 54, C - 4],
    run_edge_left: ["ground", 54, C + 9], run_edge_right: ["ground", 54, C - 9],
    dropback_short: ["arc", 56, C], pa_short: ["arc", 56, C], rpo_throw: ["arc", 56, C],
    dropback_mid: ["arc", 64, C], pa_mid: ["arc", 64, C], dropback_deep: ["arc", 75, C], pa_deep: ["arc", 75, C],
    screen: ["arc", 49, C - 10],
  };
  assert.deepEqual(Object.keys(expect).sort(), [...LEAVES].sort());
  for (const [leaf, [t, x, y]] of Object.entries(expect)) {
    const step = strokeOf(shadowForLeaf(leaf, 0.1, at(50), 1));
    assert.equal(step.t, t, leaf);
    nearPt(step.from, 50, C, `${leaf} from`);
    nearPt(step.to, x, y, leaf);
  }
});

test("geometry flips with the attack direction; the screen goes 1 yard back and 10 wide to the near sideline", () => {
  nearPt(strokeOf(shadowForLeaf("run_ot_left", 0.1, at(50, -1), 1)).to, 46, C - 4, "the offense's left");
  nearPt(strokeOf(shadowForLeaf("dropback_deep", 0.1, at(50, -1), 1)).to, 25, C);
  nearPt(strokeOf(shadowForLeaf("screen", 0.1, at(50, -1), 1)).to, 51, C - 10);
});

test("two plays with the same shape stay two shadows: the later arc flies higher (heights are generic)", () => {
  const row = rowBySeq(126);
  assert.deepEqual(row.pred.top3.slice(0, 2), ["dropback_short", "pa_short"]);
  const [db, pa] = buildShadowPlays(row.pred, situationFromRow(row));
  nearPt(strokeOf(db).to, 31, C);
  nearPt(strokeOf(pa).to, 31, C, "the same 6 air yards: the model does not predict a side");
  assert.deepEqual([db.stack, pa.stack], [0, 1]);
  near(strokeOf(pa).apex, strokeOf(db).apex * (1 + SHADOW_STACK_LIFT));
  assert.equal(buildShadowPlays(D25_PREDICTION, D25)[1].stack, 0, "different shapes do not stack");
});

test("predicted passes stay inside the end zone near the goal line", () => {
  nearPt(strokeOf(shadowForLeaf("dropback_deep", 0.1, at(97), 1)).to, 109, C, "capped 1 yd inside the end line");
  nearPt(strokeOf(shadowForLeaf("pa_mid", 0.1, at(97), 1)).to, 109, C);
  nearPt(strokeOf(shadowForLeaf("dropback_short", 0.1, at(97), 1)).to, 103, C);
  nearPt(strokeOf(shadowForLeaf("run_inside", 0.1, at(99), 1)).to, 103, C);
  nearPt(strokeOf(shadowForLeaf("pa_deep", 0.1, at(3, -1), 1)).to, -9, C);
});

test("text sits underneath each shadow, the second stacked below the first, never on the ball", () => {
  const [run, pa] = buildShadowPlays(firstSnap().pred, situationFromRow(firstSnap()));
  nearPt(run.label.at, 32, C - 4, "under the middle of the run line");
  assert.ok(pa.label.at.y < run.label.at.y, "stacked toward the near sideline");
  near(pa.label.at.y, C - 4 - LABEL_LINE_YD);
  assert.equal(overlaps(run.label, pa.label), false);
  assert.equal(run.label.approx, true);
  assert.deepEqual(run.drawing.label, run.label);
});

test("labels step around labels already on the field (the previous play's)", () => {
  const sit = situationFromRow(firstSnap());
  const previous = { text: "Short pass middle · +8", at: { x: 32, y: C - 4 } };
  const [run, pa] = buildShadowPlays(firstSnap().pred, sit, { avoid: [previous] });
  for (const s of [run, pa]) assert.equal(overlaps(s.label, previous), false, s.leaf);
  assert.equal(overlaps(run.label, pa.label), false);
});

test("the words stack as one block, #1 on top: a blocker on #1's line moves both, never #2 above #1", () => {
  const plain = buildShadowPlays(D25_PREDICTION, D25);
  assert.ok(stackedInOrder(plain));
  const chip = { text: "Miss", at: { x: 49, y: plain[0].label.at.y } };   // only on #1's line: #2's is free
  const moved = buildShadowPlays(D25_PREDICTION, D25, { avoid: [chip] });
  for (const s of moved) assert.equal(overlaps(s.label, chip), false, s.leaf);
  assert.ok(moved[0].label.at.y > moved[1].label.at.y, `#1 (${moved[0].label.at.y}) above #2 (${moved[1].label.at.y})`);
  assert.ok(stackedInOrder(moved), "on consecutive lines, apart");
  near(moved[0].label.at.y - moved[1].label.at.y, LABEL_LINE_YD, "#2 right under #1");
  const three = buildShadowPlays(D25_PREDICTION, D25, { avoid: [chip], hover: "screen" });
  assert.deepEqual(three.map((s) => s.leaf), ["dropback_deep", "dropback_short", "screen"]);
  assert.ok(stackedInOrder(three), "a hovered third play joins the bottom of the block");
});

test("a phone's deep lines: every Dallas snap stacks #1 over #2 with no overlap, past the line of scrimmage too", () => {
  const rows = allRows();
  let snaps = 0;
  rows.forEach((row, i) => {
    if (!row.pred?.dist) return;
    const prev = previousDrawing(rows, i);
    const shown = buildShadowPlays(row.pred, situationFromRow(row), { avoid: prev ? [prev] : [], metrics: PHONE });
    assert.ok(stackedInOrder(shown, PHONE), `#${row.seq}: ${shown.map((s) => `${s.label.text} @ ${s.label.at.y}`)}`);
    if (prev?.label) {
      for (const s of shown) assert.equal(boxesMeet(s.label, prev.label, PHONE), false, `#${row.seq} ${s.label.text}`);
    }
    snaps += 1;
  });
  assert.equal(snaps, 59);
  const high = buildShadowPlays(firstSnap().pred, situationFromRow(firstSnap()), { metrics: PHONE,
    avoid: [{ text: "x".repeat(60), at: { x: 32, y: 10 } }, { text: "x".repeat(60), at: { x: 32, y: 4 } },
      { text: "x".repeat(60), at: { x: 32, y: 16 } }] });
  assert.ok(high.every((s) => s.label.at.y > C), "no room below: the block goes up past the line of scrimmage");
  assert.ok(stackedInOrder(high, PHONE), "and there a line takes more yards, so the plates still never touch");
});

test("on 4th down he usually kicks: the shadows read 'If he goes' and draw quieter (35%, then 25%)", () => {
  const fourth = { ...D25, down: 4, togo: 6 };
  const shadows = buildShadowPlays(D25_PREDICTION, fourth);
  assert.deepEqual(shadows.map((s) => s.label.text),
    ["If he goes · 1 · Deep shot (20+) · 48%", "If he goes · 2 · Short (0–9 air yds) · 25%"]);
  assert.deepEqual(shadows.map((s) => s.drawing.opacity), [0.35, 0.25]);
  for (const s of shadows) for (const step of s.drawing.steps) assert.equal(step.opacity, s.drawing.opacity);
  assert.ok(stackedInOrder(shadows), "the longer words still stack");
  const hovered = buildShadowPlays(D25_PREDICTION, fourth, { hover: "screen" })[2];
  assert.deepEqual([hovered.label.text, hovered.drawing.opacity], ["If he goes · 5 · Screen · 4.6%", 0.25]);
  const one = shadowForLeaf("screen", 0.05, fourth, 5);
  assert.deepEqual([one.label.text, one.drawing.opacity], ["If he goes · 5 · Screen · 5.0%", 0.25]);
  for (const down of [1, 2, 3, null, undefined]) {
    const plain = buildShadowPlays(D25_PREDICTION, { ...D25, down });
    assert.deepEqual(plain.map((s) => s.drawing.opacity), [0.5, 0.35], `down ${down}`);
    assert.equal(plain[0].label.text, "1 · Deep shot (20+) · 48%");
  }
  assert.notEqual(shadows[0].key, buildShadowPlays(D25_PREDICTION, D25)[0].key, "a new key, so a renderer redraws");
});

test("both engines hand the builder the snap's down: the 3D ghost layer's request says 4th down too", () => {
  const fourth = { ...D25, down: 4, togo: 6 };
  const set = buildGhostSet(ghostInputFromPrediction(D25_PREDICTION), fourth);
  const input = shadowInputOf(set, { live: fourth, poss: "DAL" });
  assert.deepEqual(buildShadowPlays(input.source, input.situation).map((s) => [s.label.text.slice(0, 15),
    s.drawing.opacity]), [["If he goes · 1 ", 0.35], ["If he goes · 2 ", 0.25]]);
  const other = shadowInputOf(set, { live: { ...fourth, ballX: 60 }, poss: "DAL" });
  assert.equal(buildShadowPlays(other.source, other.situation)[0].drawing.opacity, 0.5, "another snap's down: not his");
  const direct = shadowInputOf({ source: D25_PREDICTION, situation: fourth });
  assert.equal(buildShadowPlays(direct.source, direct.situation)[0].drawing.opacity, 0.35, "a request of its own");
});

test("'If he goes' on every Dallas snap: the longer words still fit on the field, underneath, apart and in order", () => {
  const rows = allRows();
  rows.forEach((row, i) => {
    if (!row.pred?.dist) return;
    const prev = previousDrawing(rows, i);
    for (const metrics of [undefined, PHONE]) {
      const shown = buildShadowPlays(row.pred, { ...situationFromRow(row), down: 4 }, { avoid: prev ? [prev] : [],
        metrics });
      assert.ok(shown.every((s) => s.label.text.startsWith("If he goes · ")), `${row.seq}`);
      assert.ok(stackedInOrder(shown, metrics), `#${row.seq} in order`);
      for (const s of shown) {
        const half = labelHalfSpanYd(s.label.text);
        assert.ok(s.label.at.x - half >= -10 - EPS && s.label.at.x + half <= 110 + EPS, `#${row.seq} whole label`);
      }
    }
  });
  const go = rowBySeq(130);
  assert.equal(situationFromRow(go).down, 4, "Dallas went for it on 4th and 3");
  assert.match(buildShadowPlays(go.pred, situationFromRow(go))[0].label.text, /^If he goes · 1 · /);
});

test("percentages round exactly as the prediction panel shows them: the top line's pct, the list's pct1", () => {
  assert.equal(shadowForLeaf("screen", 0.0494, D25, 5).label.text, "5 · Screen · 4.9%");
  assert.equal(shadowForLeaf("dropback_mid", 0.0951, D25, 2).label.text, "2 · Intermediate (10–19) · 10%");
  assert.equal(shadowForLeaf("dropback_mid", 0.0951, D25, 3).label.text, "3 · Intermediate (10–19) · 10%");
  assert.equal(shadowForLeaf("dropback_mid", 0.0951, D25, 4).label.text, "4 · Intermediate (10–19) · 9.5%");
  assert.equal(shadowForLeaf("pa_deep", 0.02, D25, null).label.text, "PA deep shot (20+) · 2.0%", "no rank: no number");
});

test("one play's shadow (shadowForLeaf): ranked, its text clear of the shadows it is given, words and strokes", () => {
  const shown = buildShadowPlays(D25_PREDICTION, D25);
  const hover = shadowForLeaf("screen", 0.04632308156745845, D25, 5, { avoid: shown });
  assert.deepEqual([hover.rank, hover.leaf, hover.family, hover.hovered], [5, "screen", "screen", true]);
  assert.equal(hover.drawing.opacity, 0.35);
  for (const s of shown) assert.equal(overlaps(hover.label, s.label), false);
  assert.equal(coveredBy(hover.label, shown.flatMap((s) => s.drawing.steps)), undefined, "never on their strokes");
  assert.equal(shadowForLeaf("bogus", 0.1, D25, 1), null);
  assert.equal(shadowForLeaf("screen", Number.NaN, D25, 1), null);
  assert.equal(shadowForLeaf("screen", 0.1, { ...D25, kind: "kickoff" }, 1), null);
});

test("candidates: every leaf in rank order, the model's top first; names from the source, else the engine's", () => {
  const all = shadowCandidates(firstSnap().pred);
  assert.equal(all.length, 14);
  assert.deepEqual(all.slice(0, 3).map((c) => c.leaf), firstSnap().pred.top3);
  assert.deepEqual(all.map((c) => c.rank), Array.from({ length: 14 }, (_, i) => i + 1));
  for (let i = 4; i < all.length; i += 1) assert.ok(all[i - 1].p >= all[i].p, `rank ${i} is in order`);
  assert.equal(all[0].name, "Inside run (A/B gap)");
  const state = shadowCandidates(D25_PREDICTION);
  assert.deepEqual(state.map((c) => c.leaf), ["dropback_deep", "dropback_short", "dropback_mid", "run_inside",
    "screen", "run_ot_left"]);
  const renamed = { top: [{ key: "screen", name: "Bubble screen", p: 0.4 }] };
  assert.equal(shadowCandidates(renamed)[0].name, "Bubble screen");
  const named = shadowCandidates(firstSnap().pred, { leafNames: { run_inside: "Dive" } });
  assert.equal(named[0].name, "Dive");
  const ghostInput = { leaves: [{ leaf: "pa_short", p: 0.2 }, { leaf: "run_inside", p: 0.3 }] };
  assert.deepEqual(shadowCandidates(ghostInput).map((c) => c.leaf), ["pa_short", "run_inside"],
    "a field view model's ghost input keeps its own order");
});

test("LEAF_NAMES are the engine's names, exactly as the server sends them (timeline meta)", () => {
  assert.deepEqual({ ...LEAF_NAMES }, capture().meta.leaf_names);
  assert.ok(Object.isFrozen(LEAF_NAMES));
});

test("no shadows without a snap situation or a usable prediction", () => {
  const pred = firstSnap().pred;
  assert.deepEqual(buildShadowPlays(pred, null), []);
  assert.deepEqual(buildShadowPlays(null, D25), []);
  assert.deepEqual(buildShadowPlays({ top: [] }, D25), []);
  assert.deepEqual(buildShadowPlays({ top3: ["run_inside"] }, D25), [], "no distribution, no odds");
  assert.deepEqual(buildShadowPlays(pred, { ...D25, kind: "kickoff" }), []);
  assert.deepEqual(buildShadowPlays(pred, { ...D25, ballX: Number.NaN }), []);
  assert.deepEqual(buildShadowPlays(pred, { ...D25, dir: 0 }), []);
  const odd = { top: [{ key: "bogus", p: 0.5 }, { key: "screen", p: Number.NaN }, { key: "run_inside", p: 0.2 },
    { key: "__proto__", p: 0.1 }] };
  assert.deepEqual(buildShadowPlays(odd, D25).map((s) => s.leaf), ["run_inside"]);
  assert.deepEqual(buildShadowPlays(pred, D25, { count: 0 }), []);
  assert.equal(buildShadowPlays(pred, D25, { count: 99 }).length, 14);
});

test("frozen, keyed, never mutating, and drawable by the same timing code as a real play", () => {
  const pred = frozenCopy(firstSnap().pred);
  const sit = frozenCopy(situationFromRow(firstSnap()));
  const a = buildShadowPlays(pred, sit);
  assert.deepEqual(a, buildShadowPlays(firstSnap().pred, situationFromRow(firstSnap())));
  assert.ok(Object.isFrozen(a) && Object.isFrozen(a[0].drawing.steps[0].to) && Object.isFrozen(a[0].label.at));
  assert.notEqual(a[0].key, buildShadowPlays(pred, { ...sit, ballX: 31 })[0].key);
  const plan = planDrawing(a[1].drawing);
  assert.ok(plan.totalMs > 0 && plan.steps.length === 1);
  assert.equal(a[0].drawing.ballStart, null, "the real ball rests on the line: a shadow carries none of its own");
  assert.ok(a[1].drawing.bounds.h > 0, "the arc's height is in the bounds");
});

test("every Dallas snap of the game: two shadows from the line, on the field, labels underneath and apart", () => {
  let snaps = 0;
  for (const row of allRows().filter((r) => r.pred?.dist)) {
    const sit = situationFromRow(row);
    const shadows = buildShadowPlays(row.pred, sit);
    snaps += 1;
    assert.deepEqual(shadows.map((s) => s.leaf), row.pred.top3.slice(0, 2), `${row.seq}`);
    for (const { path, value } of numbersIn(shadows)) assert.ok(Number.isFinite(value), `${row.seq} ${path}`);
    for (const s of shadows) {
      const pts = s.drawing.steps.flatMap((st) => [st.from, st.to]);
      nearPt(pts[0], sit.ballX, C, `${row.seq} ${s.leaf} starts at the line`);
      for (const p of [...pts, s.label.at]) {
        assert.ok(p.x >= -10 && p.x <= 110 && p.y >= 0 && p.y <= 53.333, `${row.seq} ${s.leaf} on the field`);
      }
      const half = labelHalfSpanYd(s.label.text);
      assert.ok(s.label.at.x - half >= -10 - EPS && s.label.at.x + half <= 110 + EPS, `${row.seq} whole label`);
      assert.ok(s.label.at.y < Math.min(...pts.map((p) => p.y)) - 1, `${row.seq} ${s.leaf}: text underneath`);
    }
    assert.equal(overlaps(shadows[0].label, shadows[1].label), false, `${row.seq} labels apart`);
  }
  assert.equal(snaps, 59);
});

test("hovering a play outside the top 2 adds its shadow; the top 2's text steps clear of the hovered stroke", () => {
  const sit = situationFromRow(firstSnap());
  const plain = buildShadowPlays(firstSnap().pred, sit);
  const lit = buildShadowPlays(firstSnap().pred, sit, { hover: "screen" });
  assert.deepEqual(lit.map((s) => [s.leaf, s.rank, s.hovered]),
    [["run_inside", 1, false], ["pa_short", 2, false], ["screen", 10, true]]);
  assert.equal(lit[2].drawing.opacity, 0.35);
  assert.equal(lit[2].label.text, "10 · Screen · 2.8%");
  assert.deepEqual(lit.slice(0, 2).map((s) => s.drawing.steps), plain.map((s) => s.drawing.steps), "same shapes");
  const steps = lit.flatMap((s) => s.drawing.steps);
  for (const s of lit) assert.equal(coveredBy(s.label, steps), undefined, `${s.leaf}'s text is on a stroke`);
  for (const [i, a] of lit.entries()) for (const b of lit.slice(i + 1)) assert.equal(overlaps(a.label, b.label), false);
  const top = buildShadowPlays(firstSnap().pred, sit, { hover: "pa_short" });
  assert.deepEqual(top.map((s) => [s.leaf, s.hovered]), [["run_inside", false], ["pa_short", true]], "lit, not added");
  assert.deepEqual(top.map((s) => s.label), plain.map((s) => s.label));
  assert.deepEqual(buildShadowPlays(firstSnap().pred, sit, { hover: "bogus" }), plain);
  assert.deepEqual(buildShadowPlays(firstSnap().pred, sit, { hover: "screen", count: 0 }), []);
});

test("avoid takes the previous play's drawing: its words and X stay clear; its dimmed stroke only when it must", () => {
  const sit = { ...D25, ltgX: null };
  const thrown = { t: "arc", role: "pass", from: { x: 15, y: C }, to: { x: 25, y: C - 12 }, apex: 2.8, endH: 0,
    approx: false, ghosted: false };
  const previous = { steps: [thrown, { t: "mark", role: "incomplete", at: thrown.to }],
    label: { text: "Short pass right · incomplete", at: { x: 25, y: C - 17 } } };
  const shadows = buildShadowPlays(D25_PREDICTION, sit, { avoid: [previous] });
  for (const s of shadows) {
    assert.equal(coveredBy(s.label, previous.steps.slice(1)), undefined, `${s.leaf} covers the previous X`);
    assert.equal(overlaps(s.label, previous.label), false);
    assert.ok(linesDown(s) <= 2 + 1e-6, `${s.leaf} stays under its shadow`);
  }
  const far = { ...previous, steps: [{ ...thrown, from: { x: 60, y: C }, to: { x: 70, y: C - 12 } }] };
  for (const s of buildShadowPlays(D25_PREDICTION, sit, { avoid: [far] })) {
    assert.equal(coveredBy(s.label, far.steps), undefined, "a throw with room around it is never covered");
  }
});

/** How many lines below its base (a gap under its stroke) a shadow's text sits, in the default metrics. */
const linesDown = (s) => (Math.min(s.drawing.steps[0].from.y, s.drawing.steps[0].to.y) - 4 - s.label.at.y) / LABEL_LINE_YD;

test("every Dallas snap, every hovered play, the previous play kept dimmed: no text on a shadow, a mark or text", () => {
  const rows = allRows();
  let [cases, overDimmed] = [0, 0];
  rows.forEach((row, i) => {
    if (!row.pred?.dist) return;
    const sit = situationFromRow(row);
    const prev = previousDrawing(rows, i);
    for (const c of shadowCandidates(row.pred)) {
      const shown = buildShadowPlays(row.pred, sit, { avoid: prev ? [prev] : [], hover: c.leaf });
      const hard = [...shown.flatMap((s) => s.drawing.steps), ...(prev?.steps ?? []).filter((st) => st.t === "mark")];
      const dimmed = (prev?.steps ?? []).filter((st) => st.t !== "mark");
      const labels = [...shown.map((s) => s.label), ...(prev?.label ? [prev.label] : [])];
      overDimmed += shown.some((s) => coveredBy(s.label, dimmed) !== undefined) ? 1 : 0;
      for (const s of shown) {
        const hit = coveredBy(s.label, hard);
        assert.equal(hit, undefined, `#${row.seq} hover ${c.leaf}: "${s.label.text}" covers ${JSON.stringify(hit)}`);
        for (const other of labels.filter((l) => l !== s.label)) {
          assert.equal(overlaps(s.label, other), false, `#${row.seq} hover ${c.leaf}: ${s.label.text} / ${other.text}`);
        }
        if (coveredBy(s.label, dimmed) === undefined) continue;
        assert.ok(linesDown(s) <= 2 + 1e-6, `#${row.seq} ${s.leaf}: over the dimmed play only to stay under its shadow`);
      }
      cases += 1;
    }
  });
  assert.equal(cases, 59 * 14);
  assert.ok(overDimmed <= cases / 5, `text over the dimmed previous play in ${overDimmed} of ${cases} layouts`);
});

test("#85 after #84: the text stays under its shadows, over the dimmed throw rather than near the sideline", () => {
  const rows = allRows();
  const i = rows.findIndex((r) => r.seq === 85);
  const prev = previousDrawing(rows, i);
  assert.equal(prev.seq, 84);
  const shown = buildShadowPlays(rows[i].pred, situationFromRow(rows[i]), { avoid: [prev] });
  for (const s of shown) {
    assert.ok(linesDown(s) <= 2 + 1e-6, `${s.label.text} is ${linesDown(s)} lines under its base`);
    assert.equal(coveredBy(s.label, prev.steps.filter((st) => st.t === "mark")), undefined, "never on the X");
    assert.equal(overlaps(s.label, prev.label), false, "never on its words");
  }
  assert.equal(overlaps(shown[0].label, shown[1].label), false);
});

test("with a view's metrics the text lays out as that view shows it: the end zone stacks it behind the line", () => {
  const endZone = { charYd: 0.26, lineYd: 1.83, padYd: 0.44, down: { x: -1, y: 0 }, lifts: [2.05] };
  const [run, pa] = buildShadowPlays(firstSnap().pred, situationFromRow(firstSnap()), { metrics: endZone });
  nearPt(run.label.at, 30 - 1.83 * (4 / 3.5), C, "a line and a bit behind the line of scrimmage, centered on the run");
  nearPt(pa.label.at, 30 - 1.83 * (4 / 3.5) - 1.83, C, "the next line back, toward the camera");
  assert.equal(boxesMeet(run.label, pa.label, endZone), false);
  const phone = { charYd: 0.8, lineYd: 6.1, padYd: 1.3, down: { x: 0, y: -1 }, lifts: [2.3] };
  const [a, b] = buildShadowPlays(firstSnap().pred, situationFromRow(firstSnap()), { metrics: phone });
  assert.ok(a.label.at.y - b.label.at.y >= 6.1 - EPS, "a phone's lines are deeper");
  assert.equal(boxesMeet(a.label, b.label, phone), false);
});
