import assert from "node:assert/strict";
import test from "node:test";

import {
  CALLER_SNAP_KINDS, FAMILIES, LEAVES, familyOf, isPlainObject, isStateBody, safeHex, safeLogoUrl,
} from "../../static/js/core/domain.js";
import { loadTimeline, stateBody } from "./fixtures.mjs";

test("FAMILIES and LEAVES follow the canonical order the timeline meta sends (DC B2)", () => {
  const { body } = loadTimeline();
  assert.deepEqual([...FAMILIES], body.meta.families);
  assert.deepEqual([...LEAVES], body.meta.leaves);
  assert.ok(Object.isFrozen(FAMILIES) && Object.isFrozen(LEAVES));
});

test("familyOf maps every leaf by prefix and anything else to null", () => {
  const expected = {
    run_inside: "run", run_ot_left: "run", run_edge_left: "run", run_ot_right: "run", run_edge_right: "run",
    dropback_short: "dropback", dropback_mid: "dropback", dropback_deep: "dropback",
    pa_short: "pa", pa_mid: "pa", pa_deep: "pa", screen: "screen", rpo_run: "rpo", rpo_throw: "rpo",
  };
  for (const leaf of LEAVES) assert.equal(familyOf(leaf), expected[leaf], leaf);
  for (const bad of ["", "pass", "runner", "rpo", null, undefined, 7, {}]) assert.equal(familyOf(bad), null, String(bad));
});

test("safeHex accepts #rrggbb only (DC C2 colors)", () => {
  assert.equal(safeHex("#002a5c"), "#002a5c");
  assert.equal(safeHex("#BD1C36"), "#BD1C36");
  for (const bad of ["002a5c", "#00f", "#002a5cz", " #002a5c", "#002a5c ", "red", null, 0x002a5c, undefined]) {
    assert.equal(safeHex(bad), null, String(bad));
  }
});

test("safeLogoUrl accepts the logo proxy paths only (DC C2)", () => {
  for (const ok of ["/api/logo/DAL", "/api/logo/TB?v=dark", "/api/logo/NYJ?v=default", "/api/logo/WSH"]) {
    assert.equal(safeLogoUrl(ok), ok);
  }
  for (const bad of ["/api/logo/dal", "/api/logo/DAL?v=x", "/api/logo/TOOLONG", "/api/logo/../x", "/api/logo/D",
    "https://a.espncdn.com/i/teamlogos/nfl/500/dal.png", "/api/logo/DAL?v=dark&x=1", "javascript:alert(1)", null, 5]) {
    assert.equal(safeLogoUrl(bad), null, String(bad));
  }
});

test("CALLER_SNAP_KINDS lists the scrimmage downs of DC B3", () => {
  assert.deepEqual([...CALLER_SNAP_KINDS], ["play", "penalty", "kneel", "spike", "other", "punt", "fg", "fg_miss"]);
});

test("isPlainObject and isStateBody guard server bodies", () => {
  assert.equal(isPlainObject({}), true);
  for (const bad of [null, [], "x", 3, undefined]) assert.equal(isPlainObject(bad), false);
  assert.equal(isStateBody(stateBody()), true);
  assert.equal(isStateBody({ error: "Already playing" }), false);
  assert.equal(isStateBody({ sit: {}, game: null }), false);
});
