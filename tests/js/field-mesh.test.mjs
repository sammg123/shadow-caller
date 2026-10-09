// The regulation field's static parts (ui-architecture 2.5 field-mesh.js; three-recipe 4; package A5). Glyphs
// (numerals, wordmarks, logo) need a canvas and are checked in the browser; here: turf, end zones, fixtures.
import assert from "node:assert/strict";
import test from "node:test";
import { loadThree, lookWith } from "./three-env.mjs";
import { loadJson } from "./fixtures.mjs";

const THREE = await loadThree();
const { buildField } = await import("../../static/js/field/field-mesh.js");
const { createGoalposts, createPylons } = await import("../../static/js/field/structures.js");
const { NFL } = await import("../../static/js/field/field-spec.js");

const BODY = loadJson("timeline_tb_dal.json");
const FRAME = { field: BODY.field, teams: BODY.teams };
const hexOf = (c) => `#${c.getHexString()}`;
const meshes = (group) => { const out = []; group.traverse((o) => { if (o.isMesh) out.push(o); }); return out; };

test("end zones in the defending teams' exact ESPN primaries: DAL on the left, TB on the right", async () => {
  const f = buildField(await lookWith(), FRAME);
  assert.equal(hexOf(f.turf.uniforms.uEndL.value), "#002a5c");
  assert.equal(hexOf(f.turf.uniforms.uEndR.value), "#bd1c36");
  await f.ready;
  f.dispose();
});

test("neutral end zones, a bare frame and bad colors all fall back to the turf", async () => {
  const look = await lookWith({ field: { endZones: "neutral" } });
  const turf0 = look.field.turf[0];
  assert.equal(hexOf(buildField(look, FRAME).turf.uniforms.uEndL.value), turf0);
  const plain = await lookWith();
  assert.equal(hexOf(buildField(plain, null).turf.uniforms.uEndR.value), plain.field.turf[0]);
  const bad = { field: BODY.field, teams: { ...BODY.teams, DAL: { ...BODY.teams.DAL, color: "red" } } };
  assert.equal(hexOf(buildField(plain, bad).turf.uniforms.uEndL.value), plain.field.turf[0]);
});

test("the static field stays inside the draw-call budget and casts the goalpost shadows (6.1)", async () => {
  const f = buildField(await lookWith(), FRAME);
  const all = meshes(f.group);
  assert.ok(all.length <= 8, `${all.length} static meshes before glyphs`);
  const turf = all.find((m) => m.name === "turf");
  assert.ok(turf.receiveShadow);
  assert.ok(all.filter((m) => m.castShadow).length >= 4, "posts, pads, ribbons and pylons cast");
  assert.equal(f.group.getObjectByName("plinth"), undefined);
});

test("goalposts: the crossbar 10 ft up, uprights to 45 ft, in the plane of each end line", () => {
  const posts = createGoalposts(NFL, { left: "#002a5c", right: "#bd1c36" });
  const gold = posts.getObjectByName("goalposts-gold");
  gold.geometry.computeBoundingBox();
  const box = gold.geometry.boundingBox;
  assert.ok(Math.abs(box.max.y - (NFL.goalpost.crossbarHeight + NFL.goalpost.aboveCrossbar)) < 0.2, `top ${box.max.y}`);
  assert.ok(box.max.x > NFL.endLineX && box.max.x < NFL.endLineX + 3);
  assert.ok(box.min.x < -NFL.endLineX);
  assert.equal(hexOf(posts.getObjectByName("pad-left").material.color), "#002a5c");
  const pylons = createPylons(NFL);
  assert.equal(pylons.count, 8);
});

test("a plinth raises the field and lays the surround at its foot", async () => {
  const look = await lookWith({ field: { plinth: { height: 3, color: "#333333" } } });
  const f = buildField(look, FRAME);
  const plinth = f.group.getObjectByName("plinth");
  assert.ok(plinth);
  const ground = plinth.children.find((m) => m.geometry.type === "PlaneGeometry");
  assert.equal(ground.position.y, -3);
  f.dispose();
  assert.equal(f.group.parent, null);
});
