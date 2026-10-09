// field/fallback-bowl.js (A6): the stadium around the 2D field, drawn only for looks lit by tower spot lights.
import assert from "node:assert/strict";
import test from "node:test";

import { bowlNodes, mulberry32, superellipse } from "../../static/js/field/fallback-bowl.js";
import { layoutPlane, sceneContext } from "../../static/js/field/fallback-draw.js";
import { resolveLook } from "../../static/js/theme/look-schema.js";
import { NEUTRAL_LOOK } from "../../static/js/theme/neutral-look.js";
import { capture } from "./field-rows.mjs";

const T = capture();
const tower = (id, x, y) => ({ id, kind: "spot", color: "#f4f1e6", intensity: 60, position: [x, y, 34],
  target: [50, 26.667, 0], castShadow: false, angle: 0.6, penumbra: 0.5 });
const NIGHT = resolveLook({
  environment: { background: "#0d1424", fog: { kind: "exp2", color: "#26314c", density: 0.0035 } },
  lights: [tower("a", -40, 86.7), tower("b", 140, 86.7), tower("c", -40, -33.3), tower("d", 140, -33.3)],
});
const ctxFor = (look) => sceneContext({ look, layout: layoutPlane({ width: 1440, height: 900 }), field: T.field,
  teams: T.teams, teamOrder: T.team_order, ids: "b1" });

function walk(nodes, out = []) {
  for (const n of nodes ?? []) {
    out.push(n);
    walk(n.children, out);
  }
  return out;
}
const parts = (nodes, part) => walk(nodes).filter((n) => n.attrs?.["data-part"] === part);

test("a look without tower lights gets no bowl: the neutral field stays plain", () => {
  assert.deepEqual(bowlNodes(ctxFor(NEUTRAL_LOOK)), { under: [], over: [] });
});

test("a night look gets three tiers of stands, a crowd, a tower per spot light and light on the field", () => {
  const { under, over } = bowlNodes(ctxFor(NIGHT));
  assert.equal(parts(under, "stand").length, 3);
  assert.equal(parts(under, "tower").length, 4);
  assert.ok(walk(under).some((n) => n.tag === "pattern" && n.attrs.id === "b1-crowd"), "a seeded crowd pattern");
  assert.equal(parts(over, "light").length, 1);
  assert.ok(walk(over).some((n) => n.tag === "radialGradient"), "the light falls off from the center");
  assert.ok(parts(under, "stand").every((n) => n.attrs["fill-rule"] === "evenodd"), "tiers are rings");
});

test("the bowl is deterministic: same teams, same crowd", () => {
  assert.deepEqual(bowlNodes(ctxFor(NIGHT)), bowlNodes(ctxFor(NIGHT)));
});

test("superellipse points lie on |x/a|^n + |y/b|^n = 1", () => {
  const pts = superellipse(10, 5, 4, 32);
  assert.equal(pts.length, 32);
  for (const { x, y } of pts) {
    const v = Math.abs(x / 10) ** 4 + Math.abs(y / 5) ** 4;
    assert.ok(Math.abs(v - 1) < 1e-9, `on the curve: ${v}`);
  }
});

test("the seeded generator is repeatable and in [0, 1)", () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  const xs = Array.from({ length: 50 }, () => a());
  assert.deepEqual(xs, Array.from({ length: 50 }, () => b()));
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  assert.notDeepEqual(xs, Array.from({ length: 50 }, mulberry32(7)));
});
