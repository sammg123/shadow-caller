// field/grammar.js: the named drawing conventions of the shared approximation grammar.
import assert from "node:assert/strict";
import test from "node:test";

import { FAMILIES } from "../../static/js/core/domain.js";
import {
  ARC_APEX, CROSSBAR_YD, GHOST_DEPTH, GHOST_FAMILY, GHOST_PASS_HALF_SPAN, GHOST_RUN, LATERAL_GAP, LATERAL_PASS,
  THIRDS, arcApex, bucketOfLeaf, dropDepthYd, familyOfLeaf, meshDepthYd, runLateralOfLeaf,
} from "../../static/js/field/grammar.js";

test("lateral offsets are the contract's suggested L values (DC A4)", () => {
  assert.deepEqual({ ...LATERAL_GAP }, {
    "left end": 8, "left tackle": 4, "left guard": 2, "up the middle": 0,
    "right guard": -2, "right tackle": -4, "right end": -8,
  });
  assert.deepEqual({ ...LATERAL_PASS }, { left: 12, middle: 0, right: -12 });
});

test("the side thirds tile the field with a 1 yd sideline inset", () => {
  assert.deepEqual([...THIRDS.right], [-25.667, -8.889]);
  assert.deepEqual([...THIRDS.middle], [-8.889, 8.889]);
  assert.deepEqual([...THIRDS.left], [8.889, 25.667]);
  assert.equal(GHOST_PASS_HALF_SPAN, 25.667);
});

test("ghost run lanes sit on the same gaps as the drawn runs", () => {
  assert.equal(GHOST_RUN.run_ot_left[0], LATERAL_GAP["left tackle"]);
  assert.equal(GHOST_RUN.run_edge_left[0], LATERAL_GAP["left end"]);
  assert.equal(GHOST_RUN.run_ot_right[0], LATERAL_GAP["right tackle"]);
  assert.equal(GHOST_RUN.run_edge_right[0], LATERAL_GAP["right end"]);
  assert.equal(GHOST_RUN.run_inside[0], 0);
  assert.deepEqual([...GHOST_DEPTH.short], [0, 9]);
  assert.deepEqual([...GHOST_DEPTH.mid], [10, 19]);
  assert.deepEqual([...GHOST_DEPTH.deep], [20, 35]);
  assert.deepEqual([...GHOST_DEPTH.screen], [-3, 3]);
  assert.equal(CROSSBAR_YD, 3.333);
});

test("every family has a ghost zone", () => {
  for (const family of FAMILIES) assert.ok(GHOST_FAMILY[family], family);
});

test("constants are frozen all the way down", () => {
  for (const c of [LATERAL_GAP, LATERAL_PASS, THIRDS, THIRDS.left, ARC_APEX, ARC_APEX.pass, GHOST_DEPTH, GHOST_RUN,
    GHOST_RUN.run_inside, GHOST_FAMILY, GHOST_FAMILY.run]) {
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

test("backfield depth comes from the alignment: shotgun deeper, play-action adds the fake", () => {
  assert.equal(dropDepthYd({ align: "S", family: "dropback" }), 7);
  assert.equal(dropDepthYd({ align: "U", family: "dropback" }), 6);
  assert.equal(dropDepthYd({ align: null, family: "dropback" }), 7);
  assert.equal(dropDepthYd({ align: "U", family: "pa" }), 7);
  assert.equal(dropDepthYd(null), 7);
  assert.equal(meshDepthYd("S"), 5);
  assert.equal(meshDepthYd("U"), 4);
  assert.equal(meshDepthYd(null), 4);
});
