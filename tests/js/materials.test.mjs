// The material kit (ui-architecture 2.5 materials.js; three-recipe 5.2, 10.3; package A5): one cached, shared
// material per key, team colors through teamPaint and the Light Core Rule, the look's strokes and ghost styles.
import assert from "node:assert/strict";
import test from "node:test";
import { loadThree, lookWith } from "./three-env.mjs";
import { loadJson } from "./fixtures.mjs";

const THREE = await loadThree();
const { createKit, LAYERS } = await import("../../static/js/field/materials.js");
const { isShared } = await import("../../static/js/field/dispose.js");
const { mixHex, teamPaint } = await import("../../static/js/theme/team-colors.js");

const TEAMS = loadJson("timeline_tb_dal.json").teams;
const hexOf = (c) => `#${c.getHexString()}`;

test("one material per key, shared, and the same object on every call", async () => {
  const kit = createKit(await lookWith(), { teams: TEAMS });
  const a = kit.stroke("ground", "DAL");
  assert.equal(kit.stroke("ground", "DAL"), a);
  assert.notEqual(kit.stroke("ground", "TB"), a);
  assert.notEqual(kit.stroke("ground", "DAL", { ghosted: true }), a);
  assert.ok(isShared(a));
  assert.ok(isShared(kit.line("los")));
  assert.equal(kit.line("los"), kit.line("los"));
  kit.dispose();
});

test("the Light Core Rule: a stroke's core is the team color mixed 65% toward the look's core", async () => {
  const look = await lookWith();
  const kit = createKit(look, { teams: TEAMS });
  const paint = teamPaint(TEAMS.TB, look.teamColor.against, look.teamColor.minContrast);
  const expected = new THREE.Color(mixHex(paint.edge, look.strokes.ground.core, 0.65));
  assert.equal(hexOf(kit.stroke("ground", "TB").color), hexOf(expected));
  assert.equal(hexOf(kit.edge("ground", "TB").color), hexOf(new THREE.Color(paint.edge)));
  assert.equal(kit.paint("TB").fill, "#bd1c36");
  assert.equal(kit.paint("XX").neutral, true, "an unknown team paints neutral");
});

test("stroke geometry picks the material: line2 is a LineMaterial in pixels, decals lie on the turf", async () => {
  const kit = createKit(await lookWith(), { teams: TEAMS });
  const arc = kit.stroke("arc", "DAL");
  assert.equal(arc.type, "LineMaterial");
  assert.equal(arc.linewidth, 4);
  assert.equal(arc.worldUnits, false);
  const area = kit.stroke("area", "DAL");
  assert.equal(area.polygonOffset, true);
  assert.equal(area.depthWrite, false);
  assert.equal(area.transparent, true);
});

test("ghosted and approximate variants follow the look (directions grammar)", async () => {
  const look = await lookWith({ strokes: { arc: { approx: "dashed" }, corridor: { approx: "pixel" },
    band: { approx: "hatch" }, mark: { approx: "soft" } } });
  const kit = createKit(look, { teams: TEAMS });
  assert.equal(kit.stroke("arc", "DAL", { approx: true }).dashed, true);
  assert.equal(kit.stroke("arc", "DAL").dashed, false);
  assert.equal(kit.stroke("corridor", "DAL", { approx: true }).userData.style, "pixel");
  assert.equal(kit.stroke("band", "DAL", { approx: true }).userData.style, "hatch");
  const soft = kit.stroke("mark", "DAL", { approx: true });
  assert.ok(soft.opacity < kit.stroke("mark", "DAL").opacity);
  const ghosted = kit.stroke("ground", "DAL", { ghosted: true });
  assert.equal(ghosted.opacity, look.strokes.ground.ghostedOpacity);
});

test("ghost materials: opacity by rank, the look's fill, every style available", async () => {
  for (const style of ["zone", "outline", "hatch", "pixel", "marker"]) {
    const look = await lookWith({ ghost: { style, fill: "#fff3d1" } });
    const kit = createKit(look, { teams: TEAMS });
    const g1 = kit.ghost(1, "run");
    const g3 = kit.ghost(3, "dropback");
    assert.ok(g1.fill && g1.stroke, style);
    const fillOf = (rank) => (style === "outline" ? 0 : look.ghost.opacity[rank - 1]);
    assert.equal(g1.fill.userData.opacity, fillOf(1), style);
    assert.equal(g3.fill.userData.opacity, fillOf(3), style);
    assert.equal(g3.stroke.userData.opacity, look.ghost.opacity[2], `${style}: the outline carries the rank`);
    assert.equal(kit.ghost(1, "run"), g1, "cached");
    kit.dispose();
  }
});

test("the LOS and LTG are the look's paint: its colors, never above the bloom threshold", async () => {
  const look = await lookWith();
  const kit = createKit(look, { teams: TEAMS });
  assert.equal(hexOf(kit.line("los").color), look.lines.los.color.toLowerCase());
  assert.equal(hexOf(kit.line("ltg").color), look.lines.ltg.color.toLowerCase());
  assert.equal(kit.line("ltg").depthTest, true, "paint mode is occluded by the ball and posts");
  const floating = createKit(await lookWith({ lines: { ltg: { mode: "float" } } }), { teams: TEAMS });
  assert.equal(floating.line("ltg").depthTest, false);
  assert.throws(() => kit.line("nope"), /los or ltg/);
});

test("setTeams drops team materials, keeps the rest; dispose frees everything once", async () => {
  const kit = createKit(await lookWith(), { teams: TEAMS });
  const line = kit.line("los");
  const dal = kit.stroke("ground", "DAL");
  let freed = 0;
  dal.addEventListener("dispose", () => { freed += 1; });
  kit.setTeams({ ...TEAMS, DAL: { ...TEAMS.DAL, color: "#ffffff" } });
  assert.equal(freed, 1);
  assert.equal(kit.line("los"), line);
  assert.notEqual(kit.stroke("ground", "DAL"), dal);
  kit.dispose();
  kit.dispose();
});

test("render layers keep everything on the turf in a fixed order (recipe 5.2)", () => {
  const orders = ["decal", "ghostZone", "graphic", "line", "ring", "shadow"].map((k) => LAYERS[k].order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
  assert.ok(LAYERS.line.factor < LAYERS.decal.factor);
  assert.ok(Object.isFrozen(LAYERS));
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
  assert.throws(() => kit.texture("nope"), /texture/);
});
