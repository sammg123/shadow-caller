// Smaller stage parts (package A5): post-processing from the Look, the plain neutral surroundings, and part 1's
// placeholder layers (a ball-only player and flat ghost zones) running on a WebGL-free stage.
import assert from "node:assert/strict";
import test from "node:test";
import { loadThree, lookWith } from "./three-env.mjs";
import { loadJson } from "./fixtures.mjs";

const THREE = await loadThree();
const { buildPost } = await import("../../static/js/field/post.js");
const { neutralProps } = await import("../../static/js/field/structures.js");
const { createLayers, LAYER_FACTORIES } = await import("../../static/js/field/layers.js");
const { createKit } = await import("../../static/js/field/materials.js");
const { createLines } = await import("../../static/js/field/lines.js");
const { ROOTS } = await import("../../static/js/field/stage.js");
const { buildDrawing } = await import("../../static/js/field/paths.js");
const { planDrawing, fitPlan } = await import("../../static/js/field/timing.js");
const { buildGhostSet } = await import("../../static/js/field/ghosts.js");

const TL = loadJson("timeline_tb_dal.json");
const row = (seq) => TL.rows.find((r) => r.seq === seq);

function fakeRenderer() {
  const calls = [];
  return { calls, setEffects: (list) => calls.push(list === null ? null : list.length), render: () => calls.push("render") };
}

test("post: none for a look without bloom or passes; bloom from the look; world passes by name", async () => {
  const r = fakeRenderer();
  assert.equal(buildPost(r, await lookWith()), null);
  assert.deepEqual(r.calls, [null]);
  const look = await lookWith({ post: { bloom: { strength: 0.5, radius: 0.5, threshold: 1.05 }, extra: ["ledgrid", "nope"] } });
  const made = [];
  const passes = { ledgrid: (ctx) => { made.push(Object.keys(ctx).sort().join()); return { render() {}, dispose() { made.push("disposed"); } }; } };
  const post = buildPost(r, look, { passes });
  assert.equal(post.bloom.strength, 0.5);
  assert.equal(post.bloom.threshold, 1.05);
  assert.equal(post.effects.length, 2);
  assert.deepEqual(post.missing, ["nope"]);
  assert.deepEqual(made, ["THREE,camera,look,renderer,scene"]);
  assert.equal(r.calls.at(-1), 2);
  post.setEnabled(false);
  assert.ok(post.effects.every((p) => p.enabled === false));
  post.render();
  post.dispose();
  assert.equal(r.calls.at(-1), null);
  assert.ok(made.includes("disposed"));
  assert.equal(buildPost(fakeRenderer(), look, { bloom: false, passes: {} }), null, "the low tier drops bloom");
});

test("neutral surroundings: benches on both sidelines and a low wall, one draw call each", async () => {
  const props = neutralProps({ look: await lookWith() });
  const benches = props.object.getObjectByName("benches");
  assert.equal(benches.count, 12);
  const m = new THREE.Matrix4();
  const zs = [...Array(benches.count).keys()].map((i) => { benches.getMatrixAt(i, m); return Math.sign(m.elements[14]); });
  assert.deepEqual([...new Set(zs)].sort(), [-1, 1]);
  assert.ok(props.object.getObjectByName("perimeter-wall").isMesh);
  const scene = new THREE.Scene();
  scene.add(props.object);
  props.dispose();
  assert.equal(props.object.parent, null);
});

async function fakeStage() {
  const look = await lookWith();
  const kit = createKit(look);
  const labels = { added: [], add(pt, text, cls) { const h = { pt, text, cls }; this.added.push(h); return h; },
    remove(h) { this.added = this.added.filter((x) => x !== h); } };
  const renders = { n: 0 };
  const stage = { look, kit, labels, lines: createLines(look, kit), requestRender: () => { renders.n += 1; },
    roots: Object.fromEntries(ROOTS.map((n) => [n, new THREE.Group()])) };
  return { stage, renders };
}

test("placeholder player: the ball flies the drawing's track, hides the resting ball, and leaves nothing behind", async () => {
  const { stage } = await fakeStage();
  const layers = createLayers(stage, LAYER_FACTORIES);
  const drawing = buildDrawing(row(81));
  const plan = fitPlan(planDrawing(drawing, stage.look.motion), 2000);
  const job = layers.player.start(drawing, plan, row(81));
  assert.equal(stage.lines.state().ball.visible, false);
  assert.equal(stage.roots.plays.children.length, 1);
  assert.equal(job.update(1000), true);
  const mid = job.ball();
  assert.ok(mid.h > 0, "in the air mid-pass");
  assert.equal(job.update(2000), false);
  assert.equal(job.ball().x, drawing.ballEnd.x);
  assert.equal(stage.roots.plays.children.length, 0, "the resting ball takes over at the end spot");
  layers.player.start(drawing, plan, row(81));
  layers.player.start(drawing, plan, row(81));
  assert.equal(stage.roots.plays.children.length, 1, "one ball at a time");
  layers.player.placeAll([{ row: row(2), drawing: buildDrawing(row(2)) }]);
  assert.equal(stage.roots.plays.children.length, 0);
});

test("placeholder ghosts: one zone per shape, percentages as labels, highlight and fade through the kit", async () => {
  const { stage, renders } = await fakeStage();
  const layers = createLayers(stage, LAYER_FACTORIES);
  const sit = { ballX: 25, ltgX: 35, dir: 1, poss: "DAL", kind: "snap", goalToGo: false, down: 1, togo: 10 };
  const set = buildGhostSet({ leaves: [{ leaf: "run_inside", p: 0.273 }, { leaf: "pa_short", p: 0.158 },
    { leaf: "dropback_short", p: 0.14 }] }, sit);
  layers.ghosts.show(set);
  assert.equal(stage.roots.ghosts.children.length, 3);
  assert.deepEqual(stage.labels.added.map((h) => h.text), ["27%", "16%", "14%"]);
  const [run, pa] = stage.roots.ghosts.children;
  const base = (m) => m.userData.material.userData.opacity;
  layers.ghosts.highlight("pa_short");
  assert.ok(run.userData.material.uniforms.uOpacity.value < base(run));
  assert.equal(pa.userData.material.uniforms.uOpacity.value, base(pa));
  layers.ghosts.highlight(null);
  layers.ghosts.fade(0.15);
  assert.ok(Math.abs(run.userData.material.uniforms.uOpacity.value - base(run) * 0.15) < 1e-9);
  layers.ghosts.clear();
  assert.equal(stage.roots.ghosts.children.length, 0);
  assert.equal(stage.labels.added.length, 0);
  assert.equal(run.userData.material.uniforms.uOpacity.value, base(run), "shared materials are restored");
  assert.ok(renders.n >= 3);
  for (const name of ["residue", "overlays"]) {
    assert.equal(typeof layers[name].clear, "function");
    layers[name].situation?.(sit);
    layers[name].dispose();
  }
});
