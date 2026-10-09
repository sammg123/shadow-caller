// Lights, sky color, fog and image-based light from the Look (ui-architecture 2.5, 2.7; three-recipe 4.8, 10.6;
// owner A5). Positions and targets are field yards [x, y, height] (coords.toWorld). Lights are three's physical
// lights: an ambient or hemisphere intensity of 1 lights white paint to about 1/pi; a directional light's
// intensity is lux-like; a spot's is candela with distance decay 2, so a tower 100 yd from the field needs about
// 1e4 for the lit turf to read like a key light of 1 (a world tunes this in its look). At most two lights cast
// shadows (look validation); their maps update only when asked (static casters: renderer.js sets needsUpdate).
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { toWorld } from "./coords.js";

/** html[data-ambient="room"] lifts the scene this many stops (a lit meeting room or a projector). */
export const ROOM_EV = 0.5;

const DEFAULT_TARGET = Object.freeze([50, 26.667, 0]);
const SHADOW_BIAS = -0.0004;
const SHADOW_NORMAL_BIAS = 0.02;
const SHADOW_RADIUS = 3;
const SPOT_SHADOW_NEAR = 5;
const SPOT_REACH = 1.25;            // the spot shadow frustum reaches this far past the farthest field corner
const PMREM_SIGMA = 0.04;
/** The box every shadow must cover: the field, its border and the goalposts (world yards). */
const SHADOW_BOX = Object.freeze({ x: 66, y: 16, z: 32 });

const at = (p) => {
  const w = toWorld(p[0], p[1], p[2] ?? 0);
  return new THREE.Vector3(w.x, w.y, w.z);
};

/** The exposure for the room lights setting: the look's, lifted ROOM_EV stops in a lit room. */
export function exposureFor(look, ambient) {
  return look.renderer.exposure * (ambient === "room" ? 2 ** ROOM_EV : 1);
}

function boxCorners() {
  const out = [];
  for (const x of [-SHADOW_BOX.x, SHADOW_BOX.x]) {
    for (const y of [0, SHADOW_BOX.y]) for (const z of [-SHADOW_BOX.z, SHADOW_BOX.z]) out.push(new THREE.Vector3(x, y, z));
  }
  return out;
}

/** Fit a directional light's orthographic shadow camera around the field box, as seen from the light. */
function fitDirectionalShadow(light) {
  const view = new THREE.Matrix4().lookAt(light.position, light.target.position, new THREE.Vector3(0, 1, 0));
  const inv = view.clone().invert();
  const pts = boxCorners().map((c) => c.clone().sub(light.position).applyMatrix4(inv));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const zs = pts.map((p) => -p.z);
  Object.assign(light.shadow.camera, { left: Math.min(...xs), right: Math.max(...xs), bottom: Math.min(...ys),
    top: Math.max(...ys), near: Math.max(0.5, Math.min(...zs) - 5), far: Math.max(...zs) + 5 });
  light.shadow.camera.updateProjectionMatrix();
}

function fitSpotShadow(light) {
  const far = Math.max(...boxCorners().map((c) => c.distanceTo(light.position))) * SPOT_REACH;
  Object.assign(light.shadow.camera, { near: SPOT_SHADOW_NEAR, far });
  light.shadow.camera.updateProjectionMatrix();
}

function makeLight(spec) {
  const color = new THREE.Color(spec.color);
  if (spec.kind === "ambient") return new THREE.AmbientLight(color, spec.intensity);
  if (spec.kind === "hemisphere") {
    return new THREE.HemisphereLight(color, new THREE.Color(spec.groundColor ?? spec.color), spec.intensity);
  }
  if (spec.kind === "directional") return new THREE.DirectionalLight(color, spec.intensity);
  return new THREE.SpotLight(color, spec.intensity, 0, spec.angle ?? Math.PI / 6, spec.penumbra ?? 0.5, 2);
}

function placeLight(light, spec, look) {
  light.name = spec.id;
  if (!light.isDirectionalLight && !light.isSpotLight) return;
  light.position.copy(at(spec.position));
  light.target.position.copy(at(spec.target ?? DEFAULT_TARGET));
  light.target.updateMatrixWorld();
  light.updateMatrixWorld();
  if (!spec.castShadow || look.renderer.shadows === "off") return;
  light.castShadow = true;
  light.shadow.mapSize.set(look.renderer.shadowMapSize, look.renderer.shadowMapSize);
  light.shadow.bias = SHADOW_BIAS;
  light.shadow.normalBias = SHADOW_NORMAL_BIAS;
  light.shadow.radius = SHADOW_RADIUS;
  if (light.isDirectionalLight) fitDirectionalShadow(light);
  else fitSpotShadow(light);
}

/**
 * @param {object} look  a resolved Look
 * @param {{ renderer?: THREE.WebGLRenderer | null }} [opts]  the renderer, needed only for look.environment.ibl
 * @returns {{ group: THREE.Group, named: Record<string, THREE.Light>, casters: THREE.Light[], apply(scene): void,
 *   dispose(): void }}
 */
export function buildLighting(look, { renderer = null } = {}) {
  const group = new THREE.Group();
  group.name = "lighting";
  const named = {};
  const casters = [];
  for (const spec of look.lights) {
    const light = makeLight(spec);
    placeLight(light, spec, look);
    named[spec.id] = light;
    if (light.castShadow) casters.push(light);
    group.add(light);
    if (light.target) group.add(light.target);
  }
  let envTexture = null;
  return {
    group, named, casters,
    apply(scene) {
      const env = look.environment;
      scene.background = env.background ? new THREE.Color(env.background) : null;
      scene.fog = !env.fog ? null : env.fog.kind === "exp2" ? new THREE.FogExp2(env.fog.color, env.fog.density)
        : new THREE.Fog(env.fog.color, env.fog.near, env.fog.far);
      if (env.ibl === "room" && renderer && !envTexture) {
        const pmrem = new THREE.PMREMGenerator(renderer);
        envTexture = pmrem.fromScene(new RoomEnvironment(), PMREM_SIGMA).texture;
        pmrem.dispose();
      }
      scene.environment = env.ibl === "room" ? envTexture : null;
      scene.environmentIntensity = env.iblIntensity;
    },
    dispose() {
      for (const light of Object.values(named)) light.dispose?.();
      envTexture?.dispose();
      envTexture = null;
      group.clear();
    },
  };
}
