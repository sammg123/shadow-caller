// Smaller stage parts (package A5): post-processing from the Look and the plain neutral surroundings.
import assert from "node:assert/strict";
import test from "node:test";
import { loadThree, lookWith } from "./three-env.mjs";

const THREE = await loadThree();
const { buildPost } = await import("../../static/js/field/post.js");
const { neutralProps } = await import("../../static/js/field/structures.js");

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

// Part 1's placeholder layers (a ball-only player, flat ghost zones) were replaced by the action layer (A5 part 2,
// v1.4): tests/js/action-layers.test.mjs covers player.js, ghost-layer.js, overlays.js and residue.js.
