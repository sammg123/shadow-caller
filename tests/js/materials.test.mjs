// The material kit (ui-architecture 2.5 materials.js; three-recipe 5.2, 10.3; package A5): the shared, cached materials
// the field draws with (the painted lines, the ball, the soft masks), the team paints, and the turf's render layers.
// v1.4 (G3-9): the kit's stroke, edge, fill, ghost and fade (the zone, corridor and band era) are gone; how a play and a
// shadow play look is play-style.js, and the action layer builds its own materials (play-art.js, play-strip.js).
import assert from "node:assert/strict";
import test from "node:test";
import { loadThree, lookWith } from "./three-env.mjs";
import { loadJson } from "./fixtures.mjs";

const THREE = await loadThree();
const { createKit, LAYERS } = await import("../../static/js/field/materials.js");
const { isShared } = await import("../../static/js/field/dispose.js");
const shaders = await import("../../static/js/field/shaders.js");

const TEAMS = loadJson("timeline_tb_dal.json").teams;
const hexOf = (c) => `#${c.getHexString()}`;

test("one material per key, shared, and the same object on every call", async () => {
  const kit = createKit(await lookWith(), { teams: TEAMS });
  assert.ok(isShared(kit.line("los")));
  assert.equal(kit.line("los"), kit.line("los"));
  assert.notEqual(kit.line("los"), kit.line("ltg"));
  assert.equal(kit.ball(), kit.ball());
  kit.dispose();
});

test("G3-9: the kit has only what the field draws with; the zone-era strokes, ghosts and turf patterns are gone", async () => {
  const kit = createKit(await lookWith(), { teams: TEAMS });
  assert.deepEqual(Object.keys(kit).sort(), ["ball", "dispose", "line", "paint", "setDpr", "setTeams", "texture"]);
  assert.deepEqual(Object.keys(shaders), ["setOpacity"], "shaders.js keeps the one fade every material shares");
  assert.deepEqual(Object.keys(LAYERS), ["turf", "decal", "graphic", "line", "ring", "shadow", "trail", "glow"]);
  assert.doesNotThrow(() => kit.setDpr(2), "the stage still tells the kit about a DPR change");
});

test("team paint: the team's colors for the turf and the night (DC C2), neutral when the team is unknown", async () => {
  const kit = createKit(await lookWith(), { teams: TEAMS });
  assert.equal(kit.paint("TB").fill, "#bd1c36");
  assert.equal(kit.paint("XX").neutral, true, "an unknown team paints neutral");
  kit.setTeams({ ...TEAMS, TB: { ...TEAMS.TB, color: "#123456" } });
  assert.equal(kit.paint("TB").fill, "#123456", "setTeams repaints");
  kit.setTeams(null);
  assert.equal(kit.paint("TB").neutral, true);
});

test("the LOS and LTG are the look's paint: its colors, never above the bloom threshold", async () => {
  const look = await lookWith();
  const kit = createKit(look, { teams: TEAMS });
  assert.equal(hexOf(kit.line("los").color), look.lines.los.color.toLowerCase());
  assert.equal(hexOf(kit.line("ltg").color), look.lines.ltg.color.toLowerCase());
  assert.equal(kit.line("ltg").depthTest, true, "paint mode is occluded by the ball and posts");
  assert.equal(kit.line("los").polygonOffset, true, "coplanar with the turf, drawn over it");
  const floating = createKit(await lookWith({ lines: { ltg: { mode: "float" } } }), { teams: TEAMS });
  assert.equal(floating.line("ltg").depthTest, false);
  assert.throws(() => kit.line("nope"), /los or ltg/);
});

test("setTeams keeps the shared materials; dispose frees everything once", async () => {
  const kit = createKit(await lookWith(), { teams: TEAMS });
  const line = kit.line("los");
  const { body } = kit.ball();
  let freed = 0;
  line.addEventListener("dispose", () => { freed += 1; });
  body.addEventListener("dispose", () => { freed += 1; });
  kit.setTeams({ ...TEAMS, DAL: { ...TEAMS.DAL, color: "#ffffff" } });
  assert.equal(freed, 0);
  assert.equal(kit.line("los"), line);
  kit.dispose();
  assert.equal(freed, 2);
  kit.dispose();
  assert.equal(freed, 2, "twice is harmless");
});

test("render layers keep everything on the turf in a fixed order (recipe 5.2)", () => {
  const orders = ["turf", "decal", "graphic", "line", "ring", "shadow"].map((k) => LAYERS[k].order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
  assert.ok(LAYERS.line.factor < LAYERS.decal.factor);
  assert.ok(LAYERS.trail.order > LAYERS.shadow.order && LAYERS.glow.order > LAYERS.trail.order, "the air over the turf");
  assert.ok(Object.isFrozen(LAYERS) && Object.values(LAYERS).every(Object.isFrozen));
});

test("the ball and the shared textures", async () => {
  const look = await lookWith();
  const kit = createKit(look, { teams: TEAMS });
  const ball = kit.ball();
  assert.equal(hexOf(ball.body.color), look.ball.color.toLowerCase());
  assert.ok(ball.accent && isShared(ball.body));
  const radial = kit.texture("radial");
  assert.equal(kit.texture("radial"), radial);
  assert.ok(radial.isTexture && isShared(radial));
  assert.throws(() => kit.texture("halo"), /texture/, "G3-9: nothing draws the halo mask");
  assert.throws(() => kit.texture("nope"), /texture/);
});

test("setOpacity fades a material to a share of its own opacity, a shader's uniform or a standard material", () => {
  const basic = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.6 });
  basic.userData.opacity = 0.6;
  assert.equal(shaders.setOpacity(basic, 0.5), 0.3);
  assert.equal(basic.opacity, 0.3);
  const shader = { userData: { opacity: 0.8 }, uniforms: { uOpacity: { value: 0.8 } } };
  assert.equal(shaders.setOpacity(shader, 2), 0.8, "clamped to the material's own opacity");
  assert.equal(shader.uniforms.uOpacity.value, 0.8);
  assert.equal(shaders.setOpacity(null, 1), 1);
});
