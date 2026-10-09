// field/grammar.js: the named drawing conventions (docs/design/play-drawing.md, binding; DC A4).
import assert from "node:assert/strict";
import test from "node:test";

import { FAMILIES, LEAVES } from "../../static/js/core/domain.js";
import * as grammar from "../../static/js/field/grammar.js";

const {
  AIR_DEPTH_YD, AIR_UNKNOWN_YD, ARC_APEX, CROSSBAR_YD, END_LINE_INSET_YD, GHOST_DEPTH, GHOST_FAMILY, GHOST_RUN,
  LABEL_CHAR_YD, LABEL_GAP_YD, LABEL_LINE_YD, LATERAL_GAP, LATERAL_PASS, SHADOW_AIR_YD, SHADOW_LABEL_GAP_YD, SHADOW_OPACITY,
  SHADOW_RUN_LATERAL, SHADOW_RUN_YD, SHADOW_SCREEN, arcApex, bucketOfLeaf, familyOfLeaf, labelHalfSpanYd,
  runLateralOfLeaf,
} = grammar;

test("lateral offsets are the contract's suggested L values (DC A4)", () => {
  assert.deepEqual({ ...LATERAL_GAP }, {
    "left end": 8, "left tackle": 4, "left guard": 2, "up the middle": 0,
    "right guard": -2, "right tackle": -4, "right end": -8,
  });
  assert.deepEqual({ ...LATERAL_PASS }, { left: 12, middle: 0, right: -12 });
});

test("play-drawing.md 1: no dropback, handoff mesh or play-action fake shapes any drawing any more", () => {
  for (const gone of ["DROP_YD", "DROP_DEFAULT_YD", "PA_FAKE_YD", "MESH_YD", "MESH_DEFAULT_YD", "dropDepthYd",
    "meshDepthYd", "THIRDS", "FULL_WIDTH", "LANE_HALF_WIDTH", "CATCH_AREA_RADIUS", "AIR_UNKNOWN_BAND"]) {
    assert.equal(gone in grammar, false, `${gone} is gone`);
  }
});

test("incompletions without air yards land at ESPN's depth medians (DC B6.2)", () => {
  assert.deepEqual({ ...AIR_DEPTH_YD }, { short: 5, deep: 23 });
  assert.equal(AIR_UNKNOWN_YD, AIR_DEPTH_YD.short, "most incompletions are short");
  assert.equal(END_LINE_INSET_YD, 1);
});

test("play-drawing.md 4: shadow geometry is the spec's (passes 6/14/25, runs 4 long, 0/4/9 wide, the screen)", () => {
  assert.deepEqual({ ...SHADOW_AIR_YD }, { short: 6, mid: 14, deep: 25 });
  assert.equal(SHADOW_RUN_YD, 4);
  assert.deepEqual({ ...SHADOW_RUN_LATERAL }, {
    run_inside: 0, run_ot_left: 4, run_edge_left: 9, run_ot_right: -4, run_edge_right: -9, rpo_run: 0,
  });
  assert.deepEqual({ ...SHADOW_SCREEN }, { behindYd: 1, wideYd: 10 });
  assert.deepEqual([...SHADOW_OPACITY], [0.5, 0.35]);
  for (const leaf of LEAVES.filter((l) => familyOfLeaf(l) === "run" || l === "rpo_run")) {
    assert.ok(leaf in SHADOW_RUN_LATERAL, `${leaf} has a run lane`);
  }
});

test("labels sit beside the play, shadow labels underneath, one line apart", () => {
  assert.ok(LABEL_GAP_YD >= 4, "clear of the ball on the center line");
  assert.ok(SHADOW_LABEL_GAP_YD >= 3);
  assert.ok(LABEL_LINE_YD >= 3);
  assert.equal(labelHalfSpanYd("FG 41 yds · good"), 16 * LABEL_CHAR_YD / 2);
  assert.equal(labelHalfSpanYd(null), 0);
  assert.equal("LABEL_X_RANGE" in grammar, false, "labels are kept on the field by their own length");
});

test("an arc's height reads as depth up the screen from the default cameras (wide, sideline, the snap's tight cut)", () => {
  assert.deepEqual([...grammar.ARC_SCREEN_LIFTS], [2, 2.4, 3.1]);
  assert.ok(Object.isFrozen(grammar.ARC_SCREEN_LIFTS));
});

test("ghost run lanes (deprecated ghosts.js) still sit on the drawn gaps", () => {
  assert.equal(GHOST_RUN.run_ot_left[0], LATERAL_GAP["left tackle"]);
  assert.equal(GHOST_RUN.run_edge_left[0], LATERAL_GAP["left end"]);
  assert.equal(GHOST_RUN.run_ot_right[0], LATERAL_GAP["right tackle"]);
  assert.equal(GHOST_RUN.run_edge_right[0], LATERAL_GAP["right end"]);
  assert.equal(GHOST_RUN.run_inside[0], 0);
  assert.deepEqual([...GHOST_DEPTH.short], [0, 9]);
  assert.deepEqual([...GHOST_DEPTH.deep], [20, 35]);
  assert.equal(CROSSBAR_YD, 3.333);
  for (const family of FAMILIES) assert.ok(GHOST_FAMILY[family], family);
});

test("constants are frozen all the way down", () => {
  for (const c of [LATERAL_GAP, LATERAL_PASS, ARC_APEX, ARC_APEX.pass, AIR_DEPTH_YD, SHADOW_AIR_YD, SHADOW_RUN_LATERAL,
    SHADOW_SCREEN, SHADOW_OPACITY, GHOST_DEPTH, GHOST_RUN, GHOST_RUN.run_inside, GHOST_FAMILY, GHOST_FAMILY.run]) {
    assert.ok(Object.isFrozen(c));
  }
});

test("familyOfLeaf and bucketOfLeaf read the leaf key", () => {
  const families = { run_inside: "run", run_edge_right: "run", dropback_mid: "dropback", pa_deep: "pa",
    screen: "screen", rpo_run: "rpo", rpo_throw: "rpo" };
  for (const [leaf, fam] of Object.entries(families)) assert.equal(familyOfLeaf(leaf), fam, leaf);
  const buckets = { run_inside: "run", rpo_run: "run", dropback_short: "short", pa_mid: "mid", pa_deep: "deep",
    rpo_throw: "short", screen: "screen" };
  for (const [leaf, b] of Object.entries(buckets)) assert.equal(bucketOfLeaf(leaf), b, leaf);
  for (const bad of ["", "pass", "rpo", "run_draw", "pa_screen", null, undefined, 7]) {
    assert.equal(familyOfLeaf(bad), null, String(bad));
    assert.equal(bucketOfLeaf(bad), null, String(bad));
  }
});

test("run lateral by leaf mirrors the gap table", () => {
  assert.equal(runLateralOfLeaf("run_edge_left"), 8);
  assert.equal(runLateralOfLeaf("run_ot_right"), -4);
  assert.equal(runLateralOfLeaf("rpo_run"), 0);
  assert.equal(runLateralOfLeaf("dropback_short"), null);
});

test("arc apex scales with length inside its limits", () => {
  assert.equal(arcApex("pass", 5), 1.5);
  assert.ok(Math.abs(arcApex("pass", 40) - 7.2) < 1e-9);
  assert.equal(arcApex("pass", 100), 10);
  assert.ok(Math.abs(arcApex("punt", 53) - 15.9) < 1e-9);
  assert.ok(Math.abs(arcApex("kickoff", 62) - 17.36) < 1e-9);
  assert.equal(arcApex("fg", 41), 10.25);
  assert.throws(() => arcApex("bogus", 10), TypeError);
  assert.throws(() => arcApex("pass", Number.NaN), TypeError);
});
