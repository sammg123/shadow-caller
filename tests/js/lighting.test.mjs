// Lights, fog, background and the room-lights exposure (ui-architecture 2.5 lighting.js, 2.7 Look; package A5).
import assert from "node:assert/strict";
import test from "node:test";
import { loadThree, lookWith } from "./three-env.mjs";

const THREE = await loadThree();
const { buildLighting, exposureFor, ROOM_EV } = await import("../../static/js/field/lighting.js");

const NIGHT = {
  environment: { background: "#0d1424", fog: { kind: "exp2", color: "#26314c", density: 0.0035 }, ibl: null, iblIntensity: 0 },
  lights: [
    { id: "sky", kind: "hemisphere", color: "#bfd4ff", groundColor: "#1d3a22", intensity: 0.3 },
    { id: "tower-ne", kind: "spot", color: "#f4f1e6", intensity: 9000, position: [140, -33.3, 34], target: [60, 26.667, 0],
      castShadow: true, angle: 0.5, penumbra: 0.6 },
    { id: "tower-nw", kind: "spot", color: "#f4f1e6", intensity: 9000, position: [-40, -33.3, 34], target: [40, 26.667, 0],
      castShadow: true, angle: 0.5, penumbra: 0.6 },
    { id: "moon", kind: "directional", color: "#9fb4ff", intensity: 0.2, position: [50, 100, 120] },
  ],
  renderer: { shadows: "pcf", shadowMapSize: 2048 },
};

test("the neutral look: ambient, hemisphere and a key light placed in field yards (DC A5)", async () => {
  const L = buildLighting(await lookWith());
  assert.deepEqual(Object.keys(L.named), ["ambient", "sky", "key"]);
  assert.ok(L.named.ambient.isAmbientLight);
  assert.ok(L.named.sky.isHemisphereLight);
  const key = L.named.key;
  assert.ok(key.isDirectionalLight);
  assert.deepEqual(key.position.toArray().map((v) => Math.round(v * 1000) / 1000), [-20, 80, 66.667]);
  assert.deepEqual(key.target.position.toArray(), [0, 0, 0], "the default target is the field's center");
  assert.equal(key.castShadow, false);
  assert.equal(L.group.children.includes(key.target), true, "targets live in the scene so they update");
  L.dispose();
});

test("a night rig: spots with their cones, two shadow casters at the look's map size", async () => {
  const L = buildLighting(await lookWith(NIGHT));
  const ne = L.named["tower-ne"];
  assert.ok(ne.isSpotLight);
  assert.equal(ne.angle, 0.5);
  assert.equal(ne.penumbra, 0.6);
  assert.equal(ne.intensity, 9000);
  assert.equal(ne.castShadow, true);
  assert.equal(ne.shadow.mapSize.x, 2048);
  assert.deepEqual(ne.target.position.toArray().map((v) => Math.round(v * 1000) / 1000), [10, 0, 0]);
  assert.equal(L.casters.length, 2);
  assert.ok(ne.shadow.camera.far > 150, "the shadow frustum reaches the far corner");
  assert.equal(L.named.moon.castShadow, false);
  L.dispose();
});

test("a directional caster's shadow box is fitted around the field as the light sees it", async () => {
  const look = await lookWith({ renderer: { shadows: "pcf" }, lights: [
    { id: "key", kind: "directional", color: "#ffffff", intensity: 1.5, position: [20, 70, 60], castShadow: true }] });
  const cam = buildLighting(look).named.key.shadow.camera;
  assert.ok(cam.right - cam.left > 100, `width ${cam.right - cam.left}`);
  assert.ok(cam.top - cam.bottom > 30, `height ${cam.top - cam.bottom}`);
  assert.ok(cam.near > 0 && cam.far > cam.near);
  const off = await lookWith({ renderer: { shadows: "off" }, lights: [
    { id: "key", kind: "directional", color: "#ffffff", intensity: 1.5, position: [20, 70, 60], castShadow: true }] });
  assert.equal(buildLighting(off).casters.length, 0, "shadows off in the look wins");
});

test("background, fog and environment go on the scene; null clears them", async () => {
  const scene = new THREE.Scene();
  buildLighting(await lookWith(NIGHT)).apply(scene);
  assert.equal(`#${scene.background.getHexString()}`, "#0d1424");
  assert.ok(scene.fog.isFogExp2);
  assert.equal(scene.fog.density, 0.0035);
  buildLighting(await lookWith({ environment: { fog: { kind: "linear", color: "#ffffff", near: 100, far: 500 } } })).apply(scene);
  assert.ok(scene.fog.isFog && scene.fog.far === 500);
  buildLighting(await lookWith({ environment: { background: null, fog: null } })).apply(scene);
  assert.equal(scene.background, null);
  assert.equal(scene.fog, null);
});

test("room lights lift the exposure by about half a stop (DESIGN.md room lights)", async () => {
  const look = await lookWith({ renderer: { exposure: 1.2 } });
  assert.equal(exposureFor(look, "dark"), 1.2);
  assert.ok(Math.abs(exposureFor(look, "room") - 1.2 * 2 ** ROOM_EV) < 1e-9);
  assert.equal(exposureFor(look, undefined), 1.2);
  assert.equal(ROOM_EV, 0.5);
});

test("dispose frees the shadow maps and empties the group", async () => {
  const L = buildLighting(await lookWith(NIGHT));
  let freed = 0;
  for (const light of L.casters) {
    light.shadow.map = { dispose: () => { freed += 1; } };
  }
  L.dispose();
  assert.equal(freed, 2);
  assert.equal(L.group.children.length, 0);
});
