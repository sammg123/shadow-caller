// field/ghosts.js (deprecated): the conductor's GhostSet. v1.4 (W6): nothing draws these zones, lanes and bands any
// more: docs/design/play-drawing.md 4 (Sam's binding direction) replaced them on the field with his top 2 as shadow
// plays (field/shadows.js, tested in shadows.test.mjs). What the set still carries, and these tests pin: his ranked
// plays and their odds (both engines turn them into shadow plays: play-style.shadowInputOf, fallback-ghosts
// shadowInput) and, through `shapes`, the pre-snap camera's frame (camera-plan.frameSituation).
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGhostSet, ghostInputFromPred, ghostInputFromPrediction,
} from "../../static/js/field/ghosts.js";
import { situationFromRow } from "../../static/js/field/paths.js";
import { META_FAMILIES, META_LEAVES, frozenCopy, rowById } from "./field-rows.mjs";

const C = 26.667;
const near = (a, b, label = "") => assert.ok(Math.abs(a - b) <= 1e-6, `${label} ${a} != ${b}`);

// /api/state prediction at 1st & 10, DAL 25 (sandbox capture, tests/fixtures/state_tb_dal_drive_d25.json).
const D25_PREDICTION = {
  top: [
    { family: "Dropback pass", key: "dropback_deep", name: "Deep shot (20+)", p: 0.47520687172203646 },
    { family: "Dropback pass", key: "dropback_short", name: "Short (0–9 air yds)", p: 0.24828488454212458 },
    { family: "Dropback pass", key: "dropback_mid", name: "Intermediate (10–19)", p: 0.1390874986076315 },
  ],
  families: [
    { key: "dropback", p: 0.8625792548717925, leaves: [
      { key: "dropback_deep", p: 0.47520687172203646 }, { key: "dropback_short", p: 0.24828488454212458 },
      { key: "dropback_mid", p: 0.1390874986076315 }] },
    { key: "run", p: 0.07743939016723235, leaves: [
      { key: "run_inside", p: 0.04938049286708704 }, { key: "run_ot_left", p: 0.009361681450096108 },
      { key: "run_edge_left", p: 0.0072605553247917344 }, { key: "run_ot_right", p: 0.006387512440559388 },
      { key: "run_edge_right", p: 0.0050491480846980965 }] },
    { key: "screen", p: 0.04632308156745845, leaves: [{ key: "screen", p: 0.04632308156745845 }] },
    { key: "rpo", p: 0.006927403639370308, leaves: [
      { key: "rpo_run", p: 0.005020367544999478 }, { key: "rpo_throw", p: 0.00190703609437083 }] },
    { key: "pa", p: 0.0067308697541464966, leaves: [
      { key: "pa_short", p: 0.0028082688956998845 }, { key: "pa_deep", p: 0.0026012796680819723 },
      { key: "pa_mid", p: 0.0013213211903646397 }] },
  ],
};
const D25 = { ballX: 25, ltgX: 35, dir: 1, poss: "DAL", kind: "snap", goalToGo: false, down: 1, togo: 10 };

const firstSnap = () => rowById("40187298068");

test("ghost input from a timeline row's pred: top 3 weighted by his_l, plus the whole tree", () => {
  const input = ghostInputFromPred(firstSnap().pred);
  assert.deepEqual(input.leaves, [
    { leaf: "run_inside", p: 0.27331 }, { leaf: "pa_short", p: 0.15806 }, { leaf: "dropback_short", p: 0.14003 },
  ]);
  assert.equal(input.all.length, 14);
  assert.deepEqual(input.all.map((l) => l.leaf), [...META_LEAVES]);
  assert.deepEqual(input.families.map((f) => f.family), [...META_FAMILIES]);
  assert.equal(input.families[0].p, 0.51834);
});

test("ghost input from /api/state prediction: top 3, every leaf and family in canonical order", () => {
  const input = ghostInputFromPrediction(D25_PREDICTION);
  assert.deepEqual(input.leaves.map((l) => l.leaf), ["dropback_deep", "dropback_short", "dropback_mid"]);
  assert.equal(input.leaves[0].p, 0.47520687172203646);
  assert.deepEqual(input.all.map((l) => l.leaf), [...META_LEAVES]);
  assert.equal(input.all[11].p, 0.04632308156745845);
  assert.deepEqual(input.families.map((f) => f.family), [...META_FAMILIES]);
  assert.equal(input.families[2].p, 0.0067308697541464966);
});

test("missing or malformed predictions give no ghosts", () => {
  assert.equal(ghostInputFromPrediction(null), null);
  assert.equal(ghostInputFromPrediction({ top: [] }), null);
  assert.equal(ghostInputFromPred(null), null);
  assert.equal(ghostInputFromPred({ top3: ["run_inside"] }), null, "no distribution, no weights");
  const odd = ghostInputFromPrediction({ top: [{ key: "bogus", p: 0.5 }, { key: "screen", p: Number.NaN },
    { key: "run_inside", p: 0.2 }] });
  assert.deepEqual(odd.leaves, [{ leaf: "run_inside", p: 0.2 }]);
});

test("first DAL snap: inside lane 30-35, two identical short bands stacked 0 and 1", () => {
  const sit = situationFromRow(firstSnap());
  const set = buildGhostSet(ghostInputFromPred(firstSnap().pred), sit);
  assert.equal(set.ballX, 30);
  assert.equal(set.dir, 1);
  assert.equal(set.shapes.length, 3);
  const [run, pa, db] = set.shapes;
  assert.deepEqual([run.rank, run.leaf, run.family, run.kind], [1, "run_inside", "run", "corridor"]);
  assert.equal(run.x0, 30);
  assert.equal(run.x1, 35);
  near(run.yC, C);
  assert.equal(run.halfWidth, 2);
  assert.equal(run.p, 0.27331);
  assert.equal(run.stack, 0);
  for (const band of [pa, db]) {
    assert.equal(band.kind, "band");
    assert.equal(band.x0, 30);
    assert.equal(band.x1, 39);
    near(band.y0, C - 25.667);
    near(band.y1, C + 25.667);
    assert.equal(band.clamped, false);
  }
  assert.deepEqual([pa.leaf, pa.family, pa.stack], ["pa_short", "pa", 0]);
  assert.deepEqual([db.leaf, db.family, db.stack], ["dropback_short", "dropback", 1]);
  assert.equal(db.weight, 0.14003 / 0.27331);
});

test("the top 3 keep the model's rank order, and stacks follow it", () => {
  const set = buildGhostSet({ leaves: [{ leaf: "pa_short", p: 0.1 }, { leaf: "dropback_short", p: 0.2 }] }, D25);
  assert.deepEqual(set.shapes.map((s) => [s.leaf, s.rank, s.stack]), [["pa_short", 1, 0], ["dropback_short", 2, 1]]);
  assert.equal(set.shapes[1].weight, 1);
});

test("ghost labels never sit on top of each other and stay on the field", () => {
  const set = buildGhostSet(ghostInputFromPred(firstSnap().pred), situationFromRow(firstSnap()));
  const labels = set.shapes.map((s) => s.label.at);
  for (let i = 0; i < labels.length; i += 1) {
    for (let j = i + 1; j < labels.length; j += 1) {
      const apart = Math.abs(labels[i].x - labels[j].x) >= 5 || Math.abs(labels[i].y - labels[j].y) >= 6 - 1e-9;
      assert.ok(apart, `labels ${i} and ${j} overlap`);
    }
  }
  for (const at of labels) assert.ok(at.y >= 0 && at.y <= 53.333 && at.x >= -10 && at.x <= 110);
  const identical = set.shapes.filter((s) => s.kind === "band");
  assert.ok(identical[1].label.at.y < identical[0].label.at.y, "stacked labels move toward the near sideline");
});

test("a deep band past the end line is moved into the end zone and marked clamped", () => {
  const right = buildGhostSet({ leaves: [{ leaf: "dropback_deep", p: 0.5 }] }, { ...D25, ballX: 95, ltgX: 100 });
  const [band] = right.shapes;
  assert.equal(band.x0, 108);
  assert.equal(band.x1, 110);
  assert.equal(band.clamped, true);
  const left = buildGhostSet({ leaves: [{ leaf: "pa_deep", p: 0.5 }] }, { ...D25, ballX: 5, ltgX: 0, dir: -1 });
  assert.equal(left.shapes[0].x0, -8);
  assert.equal(left.shapes[0].x1, -10);
  const mid = buildGhostSet({ leaves: [{ leaf: "dropback_mid", p: 0.5 }] }, { ...D25, ballX: 95, ltgX: 100 });
  assert.equal(mid.shapes[0].x0, 105);
  assert.equal(mid.shapes[0].x1, 110);
  assert.equal(mid.shapes[0].clamped, true);
});

test("opponent-side lanes flip with the attack direction; screens sit across the line", () => {
  const set = buildGhostSet({ leaves: [{ leaf: "run_edge_left", p: 0.4 }, { leaf: "screen", p: 0.3 },
    { leaf: "rpo_run", p: 0.1 }] }, { ...D25, ballX: 60, ltgX: 50, dir: -1 });
  const [edge, screen, rpo] = set.shapes;
  assert.equal(edge.x0, 60);
  assert.equal(edge.x1, 55);
  near(edge.yC, C - 8);
  assert.equal(edge.halfWidth, 3);
  assert.equal(screen.x0, 63);
  assert.equal(screen.x1, 57);
  assert.equal(rpo.halfWidth, 3);
  assert.equal(rpo.family, "rpo");
});

test("every leaf and every family gets a weighted zone from the full distribution", () => {
  const set = buildGhostSet(ghostInputFromPrediction(D25_PREDICTION), D25);
  assert.equal(set.leafZones.length, 14);
  assert.equal(set.familyZones.length, 5);
  const top = set.leafZones.find((z) => z.leaf === "dropback_deep");
  assert.equal(top.weight, 1);
  assert.equal(top.rank, 1);
  const shortBands = set.leafZones.filter((z) => z.kind === "band" && z.x0 === 25 && z.x1 === 34);
  assert.deepEqual(shortBands.map((z) => z.leaf).sort(), ["dropback_short", "pa_short", "rpo_throw"]);
  assert.deepEqual(shortBands.map((z) => z.stack).sort(), [0, 1, 2]);
  for (const z of set.leafZones) assert.ok(z.weight >= 0 && z.weight <= 1, z.leaf);
  const fam = Object.fromEntries(set.familyZones.map((z) => [z.family, z]));
  assert.equal(fam.dropback.weight, 1);
  assert.equal(fam.run.kind, "corridor");
  assert.equal(fam.run.halfWidth, 11);
  assert.deepEqual([fam.dropback.x0, fam.dropback.x1], [25, 60]);
  assert.deepEqual([fam.pa.stack, fam.dropback.stack], [1, 0]);
  assert.deepEqual([fam.screen.x0, fam.screen.x1], [22, 28]);
  assert.deepEqual([fam.rpo.x0, fam.rpo.x1], [25, 34]);
});

test("no situation, a kickoff, or no input gives no ghost set", () => {
  const input = ghostInputFromPred(firstSnap().pred);
  assert.equal(buildGhostSet(input, null), null);
  assert.equal(buildGhostSet(null, D25), null);
  assert.equal(buildGhostSet(input, { ...D25, ballX: null }), null);
  assert.equal(buildGhostSet(input, { ...D25, kind: "kickoff" }), null);
  assert.equal(buildGhostSet(input, { ...D25, dir: 0 }), null);
});

test("the key is stable for the same call and changes with the ball or the odds", () => {
  const input = ghostInputFromPred(firstSnap().pred);
  const a = buildGhostSet(input, D25);
  const b = buildGhostSet(frozenCopy(input), frozenCopy(D25));
  assert.equal(a.key, b.key);
  assert.notEqual(a.key, buildGhostSet(input, { ...D25, ballX: 26 }).key);
  const moved = { ...input, leaves: [{ ...input.leaves[0], p: 0.3 }, ...input.leaves.slice(1)] };
  assert.notEqual(a.key, buildGhostSet(moved, D25).key);
  assert.ok(Object.isFrozen(a) && Object.isFrozen(a.shapes[0]) && Object.isFrozen(a.shapes[0].label.at));
});

test("ghost geometry stays on the field for every caller snap of the game", () => {
  for (let ballX = 1; ballX <= 99; ballX += 1) {
    for (const dir of [1, -1]) {
      const set = buildGhostSet(ghostInputFromPrediction(D25_PREDICTION), { ...D25, ballX, dir, ltgX: null });
      for (const z of [...set.shapes, ...set.leafZones, ...set.familyZones]) {
        for (const x of [z.x0, z.x1]) assert.ok(x >= -10 && x <= 110, `${z.leaf ?? z.family} x ${x}`);
        assert.ok(Math.abs(z.x1 - z.x0) >= 2 - 1e-9, `${z.leaf ?? z.family} at ${ballX} too thin`);
        const ys = z.kind === "band" ? [z.y0, z.y1] : [z.yC - z.halfWidth, z.yC + z.halfWidth];
        for (const y of ys) assert.ok(y >= 0 && y <= 53.333, `${z.leaf ?? z.family} y ${y}`);
      }
    }
  }
});
