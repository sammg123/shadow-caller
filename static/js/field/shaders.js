// Shader materials for marks on the turf (three-recipe 8.3; DESIGN.md "the turf grid"; owner A5). Each one reads
// the world position, so a pattern stays put on the field however the camera moves, ends with three's tone
// mapping, color space and fog chunks (so it matches the lit scene in either render path), and keeps its strength
// in uniforms: uColor (linear), uOpacity. setOpacity(material, k) is the one way to fade any of them. Marks on the
// field skip the world's fog by default (fog: true opts in).
//   grid    a 1-yard grid of lit squares (0.8 yd) on the turf: the "pixel" style; checker lights every other cell
//   hatch   45-degree stripes at a constant screen pitch (gl_FragCoord): the "hatch" style, never shimmers
//   zone    a fill whose edges feather out (uv): the "zone" style for ghost depth zones
import * as THREE from "three";

const VERTEX = /* glsl */`
varying vec3 vWorld;
varying vec2 vUv;
#include <common>
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const HEAD = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
varying vec3 vWorld;
varying vec2 vUv;
#include <common>
#include <fog_pars_fragment>
`;

const TAIL = /* glsl */`
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
`;

const GRID = /* glsl */`${HEAD}
uniform float uCell;
uniform float uLit;
uniform float uChecker;
float squareAA(vec2 f, float halfSide, vec2 fw) {
  vec2 d = abs(f) - halfSide;
  vec2 a = 1.0 - smoothstep(-fw * 0.5, fw * 0.5, d);
  return a.x * a.y;
}
void main() {
  vec2 p = vWorld.xz / uCell;
  vec2 cell = floor(p);
  vec2 fw = max(fwidth(p), vec2(1e-4));
  float on = squareAA(fract(p) - 0.5, uLit * 0.5, fw);
  float even = 1.0 - mod(cell.x + cell.y, 2.0);
  on *= mix(1.0, even, uChecker);
  // cells under about 3 px turn into their average, so the grid never moires at a distance
  float tiny = smoothstep(0.2, 0.45, max(fw.x, fw.y));
  on = mix(on, uLit * uLit * mix(1.0, 0.5, uChecker), tiny);
  gl_FragColor = vec4(uColor, uOpacity * on);
${TAIL}
}`;

const HATCH = /* glsl */`${HEAD}
uniform float uPitch;
void main() {
  float stripe = smoothstep(0.35, 0.5, abs(fract((gl_FragCoord.x + gl_FragCoord.y) / uPitch) - 0.5));
  float edge = smoothstep(0.0, 0.04, vUv.x) * smoothstep(1.0, 0.96, vUv.x) * smoothstep(0.0, 0.04, vUv.y) * smoothstep(1.0, 0.96, vUv.y);
  gl_FragColor = vec4(mix(uColor, vec3(1.0), stripe * 0.6), uOpacity * edge * (0.45 + 0.55 * stripe));
${TAIL}
}`;

const ZONE = /* glsl */`${HEAD}
uniform float uFeather;
void main() {
  float f = max(uFeather, 1e-3);
  float e = smoothstep(0.0, f, vUv.x) * smoothstep(1.0, 1.0 - f, vUv.x) * smoothstep(0.0, f, vUv.y) * smoothstep(1.0, 1.0 - f, vUv.y);
  gl_FragColor = vec4(uColor, uOpacity * e);
${TAIL}
}`;

const SOURCES = Object.freeze({ grid: GRID, hatch: HATCH, zone: ZONE });

/**
 * A turf-mark ShaderMaterial. `kind` grid | hatch | zone; `color` any THREE.Color input (hex strings are sRGB);
 * `layer` a LAYERS entry ({ order, factor, units }) for polygon offset; `blending` "normal" | "additive".
 */
export function turfMarkMaterial(kind, { color, opacity = 1, layer = null, blending = "normal", cell = 1, lit = 0.8,
  checker = false, pitchPx = 6, feather = 0.08, fog = false } = {}) {
  const fragmentShader = SOURCES[kind];
  if (!fragmentShader) throw new TypeError(`no turf mark called ${String(kind)}`);
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uCell: { value: cell }, uLit: { value: lit },
    uChecker: { value: checker ? 1 : 0 }, uPitch: { value: pitchPx }, uFeather: { value: feather },
  }]);
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERTEX, fragmentShader, transparent: true, depthWrite: false, fog,
    side: THREE.DoubleSide, blending: blending === "additive" ? THREE.AdditiveBlending : THREE.NormalBlending,
    polygonOffset: Boolean(layer), polygonOffsetFactor: layer?.factor ?? 0, polygonOffsetUnits: layer?.units ?? 0,
  });
  material.userData = { ...material.userData, shader: kind, style: kind, opacity, pitchPx };
  return material;
}

/** Fade any kit material to `k` times its base opacity (userData.opacity), standard or shader. */
export function setOpacity(material, k) {
  const base = material?.userData?.opacity ?? 1;
  const value = base * Math.min(1, Math.max(0, k));
  if (material?.uniforms?.uOpacity) material.uniforms.uOpacity.value = value;
  else if (material) material.opacity = value;
  return value;
}

/** Keep hatch stripes at their CSS pixel pitch after a device pixel ratio change. */
export function setHatchDpr(material, dpr) {
  if (material?.uniforms?.uPitch && material.userData?.shader === "hatch") {
    material.uniforms.uPitch.value = (material.userData.pitchPx ?? 6) * dpr;
  }
}
