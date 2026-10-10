// Under the Lights: the stadium props, built with the vendored three.js in node (owner W1; DESIGN.md "The bowl",
// "Night", "Day"; ui-architecture.md 6.1 budget: props at most 40 draw calls, 300k triangles in all).
import assert from "node:assert/strict";
import test from "node:test";
import { loadThree } from "./three-env.mjs";
import { loadTimeline } from "./fixtures.mjs";

const THREE = await loadThree();
const { resolveLook } = await import("../../static/js/theme/look-schema.js");
const { look: partial } = await import("../../static/js/theme/worlds/under-the-lights/look.js");
const { props, passes, STADIUM } = await import("../../static/js/theme/worlds/under-the-lights/props.js");
const { RINGS, deckRanges, seating, standsGeometry } = await import("../../static/js/theme/worlds/under-the-lights/stadium/bowl.js");
const { crowdArrays } = await import("../../static/js/theme/worlds/under-the-lights/stadium/crowd.js");
const { bowlHaze, hazeDepthGlsl } = await import("../../static/js/theme/worlds/under-the-lights/stadium/haze.js");
const { lensCenter, lensGain } = await import("../../static/js/theme/worlds/under-the-lights/shaders/grade.js");
const { slideTo, sunDirection } = await import("../../static/js/theme/worlds/under-the-lights/stadium/air.js");

const TL = loadTimeline();
const night = resolveLook(partial);
const day = resolveLook(partial.world.day, night);
const ctxOf = (look, light = "night") => ({ THREE, coords: null, field: TL.body.field, teams: TL.body.teams, look, light,
  kickoff: null, paint: () => null, ambient: "dark", requestRender: () => {} });
const drawables = (root) => {
  const out = [];
  root.traverse((o) => { if (o.isMesh || o.isPoints) out.push(o); });
  return out;
};
const triangles = (o) => (o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3)
  * (o.isInstancedMesh ? o.count : 1);

test("the night stadium: stands and tower steel, crowd, LED ribbons, lamp banks and shafts, five draw calls", () => {
  const p = props(ctxOf(night));
  assert.equal(p.object.name, STADIUM);
  const parts = drawables(p.object);
  assert.deepEqual(parts.map((o) => o.name).sort(),
    ["uls-crowd", "uls-ribbons", "uls-shafts", "uls-stands", "uls-tower-lamps"]);
  assert.ok(parts.length <= 40, "ui-architecture 6.1: props at most 40 draw calls");
  const tris = parts.filter((o) => o.isMesh).reduce((s, o) => s + triangles(o), 0);
  assert.ok(tris < 120000, `${tris} triangles`);
  assert.equal(p.object.getObjectByName("uls-tower-lamps").count, 4 * 36, "4 banks of 9 x 4 lamps");
  assert.ok(p.object.getObjectByName("uls-crowd").geometry.attributes.position.count > 25000);
  assert.ok(p.object.getObjectByName("uls-tower-lamps").material.color.r > 1.05, "the lamps bloom");
  assert.equal(typeof p.object.userData.uls.choreo.play, "function");
  assert.equal(p.update(16), false, "nothing moves at rest: 0 frames (6.1)");
  p.dispose();
  assert.equal(p.object.parent, null);
});

test("by day the lamps are dark glass, the shafts are gone and the rim caster draws the stands' shadow line", () => {
  const p = props(ctxOf(day, "day"));
  const names = drawables(p.object).map((o) => o.name);
  assert.ok(!names.includes("uls-shafts"));
  const caster = p.object.getObjectByName("uls-rim-caster");
  assert.equal(caster.castShadow, true);
  assert.equal(caster.material.colorWrite, false, "only its shadow shows");
  assert.ok(p.object.getObjectByName("uls-tower-lamps").material.color.r < 0.5);
  const sun = day.lights.find((l) => l.kind === "directional");
  const d = sunDirection(sun);
  assert.ok(d[1] < 0, "the sun shines down");
  const slid = slideTo([0, 44, -90], d, 9);
  assert.equal(slid[1], 9);
  assert.ok(Math.abs((slid[0] - 0) * d[2] - (slid[2] + 90) * d[0]) < 1e-6, "along the sun's ray");
  p.dispose();
});

test("the bowl: a full lower bowl, a horseshoe upper deck that leaves the home side to the cameras", () => {
  const { upper } = deckRanges();
  assert.ok(upper[0] > Math.PI / 2 && upper[1] < Math.PI / 2 + Math.PI * 2, "the gap is around +z, the home side");
  const g = standsGeometry(THREE);
  g.computeBoundingBox();
  assert.ok(g.boundingBox.max.y > 40 && g.boundingBox.min.y >= 0);
  assert.ok(g.attributes.color && g.attributes.normal, "vertex colors and flat normals");
  const tiers = seating();
  assert.equal(tiers.length, 3);
  assert.equal(tiers[0].rows, RINGS.lower.homeRows);
  assert.ok(RINGS.lower.a > 60 && RINGS.lower.b > 26.667, "the first row stands back from the field");
});

// ---------------------------------------------------------------- G3-2: what the cameras see below the near sideline
const { createBuilder, linearRgb } = await import("../../static/js/theme/worlds/under-the-lights/stadium/builder.js");
const { GROUND, addGround } = await import("../../static/js/theme/worlds/under-the-lights/stadium/ground.js");
const { FACADE, homeBackRing } = await import("../../static/js/theme/worlds/under-the-lights/stadium/bowl.js");

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
function vertices(geometry) {
  const p = geometry.attributes.position.array;
  const c = geometry.attributes.color.array;
  return Array.from({ length: p.length / 3 }, (_, i) => ({ x: p[i * 3], y: p[i * 3 + 1], z: p[i * 3 + 2],
    l: lum(c[i * 3], c[i * 3 + 1], c[i * 3 + 2]) }));
}

test("G3-2: a hazed plaza rings the stadium: bowl-haze concrete, lit by the concourse near the stands, to the horizon", () => {
  const vs = vertices(addGround(createBuilder()).build(THREE));
  const [a, b] = homeBackRing();
  assert.ok(vs.every((v) => v.y > 0.05 && v.y < 0.5), "a hair over the turf (no z-fighting), never a wall");
  assert.ok(Math.min(...vs.map((v) => (v.x / a) ** 4 + (v.z / b) ** 4)) >= 0.99, "it starts at the home stand's back");
  assert.ok(Math.max(...vs.map((v) => v.z)) > b + GROUND.reach - 1, `it reaches ${GROUND.reach} yd out`);
  assert.ok(GROUND.reach >= 150, "past where any camera's frame meets the ground (the wide camera's is 109 yd out)");
  const ground = vs.filter((v) => Math.abs(v.y - GROUND.y) < 1e-6);
  const near = ground.filter((v) => v.z > b && v.z < b + 6 && Math.abs(v.x) < 30).map((v) => v.l);
  const far = ground.filter((v) => v.z > b + 90).map((v) => v.l);
  assert.ok(Math.min(...near) > Math.max(...far), "brighter at the concourse than out in the lots");
  const haze = lum(...linearRgb("#26314c"));
  assert.ok(far.every((l) => Math.abs(l - haze) < haze * 0.6), "bowl-haze out there");
  const tones = new Set(vs.filter((v) => v.z > b + 20 && v.z < b + 60).map((v) => v.l.toFixed(4)));
  assert.ok(tones.size >= 3, "seams and lamp pools: never one flat color");
  const mean = (list) => list.reduce((s, v) => s + v.l, 0) / list.length;
  const daylit = vertices(addGround(createBuilder(), { day: true }).build(THREE));
  assert.ok(daylit.length < vs.length, "the same plaza by day, its lamp pools off");
  assert.ok(mean(daylit) > mean(vs) * 2, "concrete in the sun, not the night's haze");
});

test("G3-2: the home stand's back is a facade (ribs proud of the wall, a lit concourse band), all one draw call", () => {
  const vs = vertices(standsGeometry(THREE));
  const [a, b] = homeBackRing();
  const onHome = (v) => v.z > b - 2 && Math.abs(v.x) < 40 && v.y > 0.5;
  const out = (v) => (v.x / a) ** 4 + (v.z / b) ** 4;          // 1 on the wall, more out from it
  const ribs = vs.filter((v) => onHome(v) && out(v) > (1 + (FACADE.rib.proud * 0.5) / a) ** 4);
  assert.ok(ribs.length >= 8 * 4, `ribs stand proud of the wall (${ribs.length} vertices)`);
  const back = lum(...linearRgb("#1a2131"));
  assert.ok(ribs.every((v) => v.l > back * 1.5), "lighter steel than the wall");
  const band = vs.filter((v) => onHome(v) && v.y >= FACADE.band[0] - 1e-6 && v.y <= FACADE.band[1] + 1e-6
    && v.l > back * 2);
  assert.ok(band.length >= 16, "a lit concourse band across it");
  const p = props(ctxOf(night));
  assert.equal(drawables(p.object).length, 5, "still five draw calls for the whole stadium");
  const tris = drawables(p.object).filter((o) => o.isMesh).reduce((s, o) => s + triangles(o), 0);
  assert.ok(tris < 120000, `${tris} triangles`);
  p.dispose();
});

test("G3-2: the lens falls off toward the top and the corners, never the bottom edge (the plaza keeps its light)", () => {
  const center = { x: 0.34, y: 0.55 };
  const at = (x, y) => lensGain({ x, y }, { center, aspect: 1.6 });
  assert.ok(at(0.34, 0) > 0.98, `the bottom edge under the free area's middle: ${at(0.34, 0)}`);
  assert.ok(at(0.34, 1) < 0.95, `the top edge falls off: ${at(0.34, 1)}`);
  assert.ok(at(0, 0) < at(0.34, 0) && at(0, 1) < at(0.34, 1), "the corners fall off");
  assert.ok(at(0.34, 1) < at(0.34, 0), "the top more than the bottom");
  assert.equal(at(center.x, center.y), 1, "nothing at the optical center");
});

test("the crowd is seeded (the same game draws the same crowd) and wears both teams' colors", () => {
  const teams = { home: TL.body.teams.DAL, away: TL.body.teams.TB };
  const a = crowdArrays(teams, { count: 2000 });
  const b = crowdArrays(teams, { count: 2000 });
  assert.deepEqual(Array.from(a.positions.slice(0, 30)), Array.from(b.positions.slice(0, 30)));
  assert.ok(a.count > 1500 && a.count < 2000, "about 86% of seats are taken");
  for (let i = 0; i < a.count; i += 1) {
    const [x, y, z] = [a.positions[i * 3], a.positions[i * 3 + 1], a.positions[i * 3 + 2]];
    const ring = (x / RINGS.lower.a) ** 4 + (z / RINGS.lower.b) ** 4;
    assert.ok(ring >= 0.97, `in the stands, never on the field (${x.toFixed(1)}, ${z.toFixed(1)})`);
    assert.ok(y > 2, "in the seats");
  }
});

test("the bowl's haze is measured from the field's middle, so the blimp never loses the stadium", () => {
  assert.match(hazeDepthGlsl(), /vFogDepth = length\(worldPos\.xz\)/);
  const m = bowlHaze(new THREE.MeshStandardMaterial());
  const shader = { vertexShader: "#include <begin_vertex>\n#include <fog_vertex>\n", fragmentShader: "" };
  m.onBeforeCompile(shader);
  assert.ok(!shader.vertexShader.includes("#include <fog_vertex>"));
  assert.match(shader.vertexShader, /instanceMatrix/);
  assert.match(m.customProgramCacheKey(), /uls-haze/);
});

test("the lens centers on the free area: the camera's safe-area view offset", () => {
  assert.deepEqual(lensCenter(null), { x: 0.5, y: 0.5 });
  const c = lensCenter({ enabled: true, fullWidth: 1896, fullHeight: 988, offsetX: 456, offsetY: 88, width: 1440, height: 900 });
  assert.ok(Math.abs(c.x - 492 / 1440) < 1e-9, "x: the middle of the 984 px left of the board");
  assert.ok(Math.abs(c.y - (1 - 406 / 900)) < 1e-9);
  const pass = passes["uls-lens"]({ THREE, camera: null });
  assert.equal(typeof pass.render, "function");
  pass.dispose();
});
