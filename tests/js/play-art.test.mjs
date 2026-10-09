// The action layer's building blocks (A5 part 2): play-strip.js (the stroke primitive), play-art.js (a play's parts as
// meshes, revealed by step progress) and play-ball.js (the ball in play), in node with the vendored three.js.
import assert from "node:assert/strict";
import test from "node:test";
import { D25, THREE, actionStage, row, stripsUnder } from "./action-stage.mjs";

const { stripGeometry, stripMaterial, stripMesh, writeStrip, setReveal, ALL } = await import(
  "../../static/js/field/play-strip.js");
const { buildArt, fieldLabel, playEnv, setLabelOpacity } = await import("../../static/js/field/play-art.js");
const { createFlight } = await import("../../static/js/field/play-ball.js");
const { createGlyphs } = await import("../../static/js/field/play-glyphs.js");
const { carriersOf, pathOf, playParts, resolvePlayLook } = await import("../../static/js/field/play-style.js");
const { buildDrawing } = await import("../../static/js/field/paths.js");
const { fitPlan, planDrawing } = await import("../../static/js/field/timing.js");
const { setOpacity } = await import("../../static/js/field/shaders.js");
const { LAYERS } = await import("../../static/js/field/materials.js");

const near = (a, b, eps = 1e-5) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test("stripGeometry: two vertices a point, neighbors for the miter, distance along the path, paths never joined", () => {
  const a = { points: [{ x: 10, y: 26.667, h: 0 }, { x: 20, y: 26.667, h: 0 }, { x: 20, y: 30.667, h: 0 }] };
  const b = { points: [{ x: 50, y: 10, h: 0 }, { x: 53, y: 14, h: 0 }] };
  const g = stripGeometry([a, b, { points: [{ x: 1, y: 1 }] }]);
  assert.equal(g.getAttribute("position").count, (3 + 2) * 2, "the one-point path is skipped");
  assert.deepEqual([...g.getAttribute("side").array.slice(0, 4)], [-1, 1, -1, 1]);
  const dist = g.getAttribute("dist").array;
  assert.deepEqual([...dist.slice(0, 6)], [0, 0, 10, 10, 14, 14]);
  near(dist[8], 5, 1e-5);
  assert.equal(g.index.count, (2 + 1) * 6, "two segments, then one: no triangle bridges the paths");
  const pos = g.getAttribute("position").array;
  assert.deepEqual([...pos.slice(0, 3)], [-40, 0, 0], "coords.toWorld: x - 50, h, 26.667 - y");
  const prev = g.getAttribute("prev").array;
  assert.deepEqual([...prev.slice(0, 3)], [...pos.slice(0, 3)], "the first point is its own previous");
});

test("writeStrip moves a strip in place; stripMaterial and setReveal drive the shader", () => {
  const pts = (x) => Array.from({ length: 4 }, (_, i) => ({ x: x + i, y: 20, h: 1 }));
  const g = stripGeometry([{ points: pts(0) }]);
  writeStrip(g, pts(10), [0, 0.25, 0.5, 1]);
  assert.equal(g.getAttribute("position").array[0], 10 - 50);
  assert.deepEqual([...g.getAttribute("alpha").array.slice(0, 2)], [0, 0]);
  assert.throws(() => writeStrip(g, pts(0).slice(0, 2)), RangeError);
  const m = stripMaterial({ color: "#ff0000", opacity: 0.5, units: "yd", width: 0.9, inner: 0.4, dash: [1, 0.5],
    layer: LAYERS.shadow });
  assert.equal(m.defines.WORLD_UNITS, "");
  assert.ok(m.polygonOffset && m.polygonOffsetUnits === LAYERS.shadow.units);
  assert.equal(m.uniforms.uDash.value.x, 1);
  assert.equal(m.uniforms.uReveal.value, ALL);
  setReveal(m, 3.5);
  assert.equal(m.uniforms.uReveal.value, 3.5);
  setOpacity(m, 0.5);
  near(m.uniforms.uOpacity.value, 0.25, 1e-9);
  const px = stripMaterial({ color: "#00ff00", additive: true });
  assert.equal(px.defines.WORLD_UNITS, undefined);
  assert.equal(px.blending, THREE.AdditiveBlending);
  const mesh = stripMesh(g, m, 7.2);
  assert.equal(mesh.renderOrder, 7.2);
  mesh.onBeforeRender({ getViewport: (v) => v.set(0, 0, 1440, 900) });
  assert.deepEqual([m.uniforms.uResolution.value.x, m.uniforms.uResolution.value.y], [1440, 900]);
});

test("buildArt: a completion's parts hidden, then revealed step by step, dimmed, and freed", async () => {
  const { stage } = await actionStage();
  const drawing = buildDrawing(row(3));
  const env = playEnv(stage);
  const parts = playParts(drawing, row(3), stage.look, env);
  const art = buildArt(parts, { glyphs: createGlyphs() });
  assert.equal(art.group.children.length, parts.length);
  assert.ok(art.group.children.every((m) => m.visible === false), "nothing shows before the snap");
  const plan = fitPlan(planDrawing(drawing, stage.look.motion), 3000);
  const arc = plan.steps[0];
  art.show(plan, (arc.startMs + arc.endMs) / 2, drawing);
  const [edge, core] = art.items.filter((it) => it.part.step === 0 && it.part.type === "stroke").map((it) => it.mesh);
  const length = pathOf(drawing.steps[0]).length;
  const half = core.material.uniforms.uReveal.value;
  assert.ok(half > 0 && half < length, "the arc has grown part way");
  assert.equal(edge.material.uniforms.uReveal.value, half);
  const dot = art.items.find((it) => it.part.type === "mark");
  assert.equal(dot.mesh.visible, false, "the catch dot waits for the ball");
  art.show(plan, plan.steps[1].endMs + 1, drawing);
  assert.equal(dot.mesh.visible, true);
  assert.equal(core.material.uniforms.uReveal.value, ALL);
  const arrow = art.items.find((it) => it.part.type === "arrow");
  assert.equal(arrow.mesh.visible, false, "the arrowhead lands with the end of its line");
  art.complete();
  assert.equal(arrow.mesh.visible, true);
  art.setOpacity(0.5);
  near(core.material.uniforms.uOpacity.value, parts.find((p) => p.layer === "core").opacity * 0.5, 1e-9);
  near(dot.material.opacity, dot.part.opacity * 0.5, 1e-9);
  const scene = new THREE.Scene();
  scene.add(art.group);
  art.dispose();
  assert.equal(art.group.parent, null);
});

test("a field goal's check is a billboard at the crossbar; a mark pops in", async () => {
  const { stage } = await actionStage();
  const drawing = buildDrawing(row(87));
  const art = buildArt(playParts(drawing, row(87), stage.look, playEnv(stage)), { glyphs: createGlyphs() });
  const check = art.items.filter((it) => it.part.type === "mark");
  assert.ok(check.every((it) => it.mesh.isSprite));
  assert.ok(check[0].mesh.position.y > 3.333);
  art.revealAll(0.5);
  assert.ok(check[0].mesh.scale.x > check[0].part.size, "popping from larger");
  art.revealAll(1);
  near(check[0].mesh.scale.y, check[0].part.size);
  art.dispose();
});

test("fieldLabel centers a label on its spot; text only; setLabelOpacity on css2d and canvas labels", async () => {
  const { stage } = await actionStage();
  const h = fieldLabel(stage, { x: 30, y: 20 }, "Deep pass left · +21", "sc-play-label");
  assert.deepEqual([h.object.center.x, h.object.center.y], [0.5, 0.5]);
  assert.deepEqual(h.pt, { x: 30, y: 20, h: 0 });
  setLabelOpacity(h, 0.4);
  assert.equal(h.element.style.opacity, "0.4");
  setLabelOpacity(h, 1);
  assert.equal(h.element.style.opacity, "");
  assert.equal(fieldLabel(stage, null, "x", ""), null);
  assert.equal(fieldLabel(stage, { x: 1, y: 2 }, "", ""), null);
  const { stage: canvas } = await actionStage({ labels: "sprite" });
  const s = fieldLabel(canvas, { x: 1, y: 2 }, "TD", "");
  setLabelOpacity(s, 0.25);
  assert.equal(s.object.material.opacity, 0.25);
});

test("the ball in play: on the line of scrimmage at the snap, in the air mid-pass, sliding to the next spot", async () => {
  const { stage } = await actionStage();
  const flight = createFlight(stage);
  const drawing = buildDrawing(row(3));
  const plan = fitPlan(planDrawing(drawing, stage.look.motion), 3000);
  flight.start(drawing, plan, { teams: carriersOf(row(3), drawing), env: playEnv(stage) });
  const at0 = flight.update(0);
  assert.deepEqual([at0.x, at0.y, at0.h], [30, 26.667, 0], "every play starts on the line of scrimmage");
  const arc = plan.steps[0];
  const mid = flight.update((arc.startMs + arc.endMs) / 2);
  assert.ok(mid.h > 0.5, "a pass is in the air");
  const end = flight.update(plan.totalMs);
  assert.deepEqual([end.x, end.y], [drawing.ballEnd.x, drawing.ballEnd.y], "the next snap's spot");
  assert.equal(flight.current(), end);
  const root = stage.roots.plays.children.find((c) => c.name === "flight");
  const trail = stripsUnder(root);
  assert.equal(trail.length, 1, "a ribbon trail (NEUTRAL_LOOK ball.trail)");
  assert.equal(trail[0].material.blending, THREE.AdditiveBlending);
  flight.hide();
  assert.equal(flight.current(), null);
  assert.ok(root.children.every((o) => !o.visible));
  flight.dispose();
  assert.equal(root.parent, null);
});

test("no trail for look.ball.trail none; a dot ball; a run's ball stays on the turf", async () => {
  const { stage } = await actionStage({ look: { ball: { kind: "dot", trail: { kind: "none" } } } });
  const flight = createFlight(stage);
  const drawing = buildDrawing(row(95));
  const plan = fitPlan(planDrawing(drawing, stage.look.motion), 2500);
  flight.start(drawing, plan, { teams: ["TB"], env: playEnv(stage) });
  const mid = flight.update(plan.steps[0].endMs / 2);
  assert.equal(mid.h, 0);
  assert.ok(mid.x < 86 && mid.x > 14, "TB runs toward x 14");
  assert.equal(stripsUnder(stage.roots.plays).length, 0);
  flight.dispose();
  assert.equal(resolvePlayLook(stage.look).headGlow, 2.5);
  assert.ok(D25.ballX === 25);
});

test("the page's meaning colors reach the marks (the world's --sc-good|bad|warn), kept for a second", async () => {
  const { stage } = await actionStage();
  stage.doc = { defaultView: { getComputedStyle: () => ({ getPropertyValue: (name) => ({ "--sc-bad": " #FF4D3D ",
    "--sc-good": "#7DDB6A", "--sc-warn": "nope" })[name] ?? "" }) } };
  stage.host = {};
  const env = playEnv({ ...stage, look: stage.look });
  assert.equal(env.plays.tones.bad, "#ff4d3d");
  assert.equal(playEnv(stage).plays.tones.good, "#7ddb6a");
  assert.equal(playEnv(stage), playEnv(stage), "cached");
  const broken = { ...stage, doc: { defaultView: { getComputedStyle: () => { throw new Error("no style"); } } } };
  assert.equal(playEnv(broken).plays.tones.bad, "#e5484d", "the fallback when the page can't say");
});

test("the trail hides before the ball has a track; a flight with no play answers nothing", async () => {
  const { stage } = await actionStage();
  const flight = createFlight(stage);
  assert.equal(flight.update(100), null);
  const drawing = buildDrawing(row(1));
  const plan = fitPlan(planDrawing(drawing, stage.look.motion), 3000);
  flight.start({ ...drawing, ballStart: null }, plan, { teams: ["TB", "DAL"], env: playEnv(stage) });
  flight.update(0);
  const root = stage.roots.plays.children.find((c) => c.name === "flight");
  assert.equal(stripsUnder(root)[0].visible, false);
  flight.update(plan.totalMs / 2);
  flight.dispose();
});
