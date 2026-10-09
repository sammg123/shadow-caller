// The stroke primitive of the action layer (A5 part 2): a path drawn as one continuous strip of triangles, either a
// constant width on screen (CSS px, like Line2) or a width on the turf (yards). Line2 draws every segment with its own
// round caps, so a translucent line (a dimmed play, a shadow, residue) shows a bead at every joint of an arc; a strip
// has one miter join per point and covers each pixel once. The shader also gives what the plays need: a reveal
// distance (a stroke grows exactly to the ball), dashes measured in yards along the path, an inner cut (a team-colored
// edge that is a ring around the light core, so edge and core never overlap when faded), per-vertex alpha (the ball's
// trail fades along its length), anti-aliased sides without MSAA, and the scene's tone mapping and color space.
//   stripGeometry(paths)          one geometry for one or more paths ({ points: [{x, y, h}], cum? }), never joined
//   writeStrip(geometry, points)  move a strip's points in place (the trail; same point count)
//   stripMaterial(spec)           { color, opacity, units: "px" | "yd", width, inner, dash, layer, additive,
//                                 vertexColors (each path's own color, from stripGeometry) }
//   stripMesh(geometry, material) the mesh, with the viewport size fed to the shader before each draw
import * as THREE from "three";
import { toWorld } from "./coords.js";

const VERTEX = /* glsl */`
attribute vec3 prev;
attribute vec3 next;
attribute float side;
attribute float dist;
attribute float alpha;
uniform vec2 uResolution;
uniform float uWidth;
varying float vDist;
varying float vSide;
varying float vAlpha;
#ifdef USE_COLOR
varying vec3 vTint;
#endif
#include <common>
vec2 toScreen(vec4 c) { return c.xy / c.w * 0.5 * uResolution; }
void main() {
  vDist = dist;
  vSide = side;
  vAlpha = alpha;
#ifdef USE_COLOR
  vTint = color;
#endif
#ifdef WORLD_UNITS
  vec3 t = next - prev;
  vec2 h = vec2(t.x, t.z);
  float hl = length(h);
  vec2 n = hl > 1e-6 ? vec2(-h.y, h.x) / hl : vec2(0.0, 1.0);
  vec3 p = position + vec3(n.x, 0.0, n.y) * side * 0.5 * uWidth;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
#else
  mat4 mvp = projectionMatrix * modelViewMatrix;
  vec4 clip = mvp * vec4(position, 1.0);
  vec2 s = toScreen(clip);
  vec2 a = s - toScreen(mvp * vec4(prev, 1.0));
  vec2 b = toScreen(mvp * vec4(next, 1.0)) - s;
  if (dot(a, a) < 1e-8) a = b;
  if (dot(b, b) < 1e-8) b = a;
  a = dot(a, a) < 1e-8 ? vec2(1.0, 0.0) : normalize(a);
  b = dot(b, b) < 1e-8 ? a : normalize(b);
  vec2 tng = a + b;
  tng = dot(tng, tng) < 1e-8 ? a : normalize(tng);
  vec2 n = vec2(-tng.y, tng.x);
  float miter = 1.0 / max(dot(n, vec2(-a.y, a.x)), 0.5);
  clip.xy += n * side * 0.5 * uWidth * miter / (0.5 * uResolution) * clip.w;
  gl_Position = clip;
#endif
}`;

const FRAGMENT = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
uniform float uInner;
uniform vec2 uDash;
uniform float uReveal;
varying float vDist;
varying float vSide;
varying float vAlpha;
#ifdef USE_COLOR
varying vec3 vTint;
#endif
#include <common>
void main() {
  if (vDist > uReveal) discard;
  float s = abs(vSide);
  float fs = max(fwidth(vSide), 1e-4);
  float a = uOpacity * vAlpha * (1.0 - smoothstep(1.0 - fs, 1.0, s));
  if (uInner > 0.0) a *= smoothstep(uInner - fs, uInner, s);
  if (uDash.x > 0.0) {
    float ph = mod(vDist, uDash.x + uDash.y);
    float fd = max(fwidth(vDist), 1e-4);
    a *= smoothstep(0.0, fd, ph) * (1.0 - smoothstep(uDash.x - fd, uDash.x, ph));
  }
  if (a < 0.004) discard;
  vec3 c = uColor;
#ifdef USE_COLOR
  c *= vTint;
#endif
  gl_FragColor = vec4(c, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Never reveal past this (a stroke drawn whole). */
export const ALL = 1e9;
const viewport = new THREE.Vector4();

function cumulative(pts) {
  return pts.reduce((acc, p, i) => [...acc, i ? acc[i - 1] + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y,
    p.z - pts[i - 1].z) : 0], []);
}

const worldPoints = (path) => path.points.map((p) => toWorld(p.x, p.y, Number.isFinite(p.h) ? p.h : 0));
const usable = (path) => Array.isArray(path?.points) && path.points.length >= 2;

const linear = new THREE.Color();

/** Write one path's vertices (two per point) at vertex `v0`; returns its triangle indices. A path may carry its own
 * `color` (#rrggbb, into the color attribute when the geometry has one) and `alpha` (times every point's). */
function fill(arrays, path, v0, alphas) {
  const pts = worldPoints(path);
  const tint = arrays.color && path.color ? linear.set(path.color) : null;
  const own = Number.isFinite(path.alpha) ? path.alpha : 1;
  const cum = Array.isArray(path.cum) && path.cum.length === pts.length ? path.cum : cumulative(pts);
  const index = [];
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const c = pts[Math.min(pts.length - 1, i + 1)];
    for (const [k, side] of [[0, -1], [1, 1]]) {
      const v = v0 + i * 2 + k;
      arrays.position.set([p.x, p.y, p.z], v * 3);
      arrays.prev.set([a.x, a.y, a.z], v * 3);
      arrays.next.set([c.x, c.y, c.z], v * 3);
      arrays.side[v] = side;
      arrays.dist[v] = cum[i];
      arrays.alpha[v] = own * (alphas ? alphas[i] : 1);
      if (tint) arrays.color.set([tint.r, tint.g, tint.b], v * 3);
    }
    if (i > 0) {
      const b = v0 + (i - 1) * 2;
      index.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
  });
  return index;
}

/**
 * One strip geometry for every usable path (at least two points); paths are never joined to each other. When any path
 * carries a `color`, the geometry gets a color attribute (white where a path has none): pair it with
 * stripMaterial({ vertexColors: true }) and many colors draw in one call (residue).
 * @param {Array<{ points: Array<{x: number, y: number, h?: number}>, cum?: number[], color?: string,
 *   alpha?: number }>} paths  field yards
 * @param {{ alphas?: number[] }} [opts]  per-point alpha for a single path (the trail)
 */
export function stripGeometry(paths, { alphas = null } = {}) {
  const list = (Array.isArray(paths) ? paths : []).filter(usable);
  const count = list.reduce((n, p) => n + p.points.length * 2, 0);
  const arrays = { position: new Float32Array(count * 3), prev: new Float32Array(count * 3),
    next: new Float32Array(count * 3), side: new Float32Array(count), dist: new Float32Array(count),
    alpha: new Float32Array(count),
    color: list.some((p) => p.color) ? new Float32Array(count * 3).fill(1) : null };
  const index = [];
  let v0 = 0;
  for (const path of list) {
    index.push(...fill(arrays, path, v0, list.length === 1 ? alphas : null));
    v0 += path.points.length * 2;
  }
  const geometry = new THREE.BufferGeometry();
  for (const [name, size] of [["position", 3], ["prev", 3], ["next", 3], ["side", 1], ["dist", 1], ["alpha", 1],
    ["color", 3]]) {
    if (arrays[name]) geometry.setAttribute(name, new THREE.BufferAttribute(arrays[name], size));
  }
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  return geometry;
}

/** Move a single-path strip's points in place (and their alphas): the same number of points as it was built with. */
export function writeStrip(geometry, points, alphas = null) {
  const arrays = Object.fromEntries(["position", "prev", "next", "side", "dist", "alpha"]
    .map((name) => [name, geometry.getAttribute(name).array]));
  arrays.color = null;
  if (points.length * 2 !== arrays.side.length) throw new RangeError("writeStrip needs the strip's own point count");
  fill(arrays, { points }, 0, alphas);
  for (const name of ["position", "prev", "next", "dist", "alpha"]) geometry.getAttribute(name).needsUpdate = true;
}

/**
 * The strip's shader material. `opacity` is kept as userData.opacity, so shaders.js setOpacity (and kit.fade) fades
 * it to a fraction of itself; `layer` (materials.js LAYERS) is its polygon offset on the turf.
 */
export function stripMaterial({ color, opacity = 1, units = "px", width = 3, inner = 0, dash = null, layer = null,
  additive = false, vertexColors = false } = {}) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uWidth: { value: width },
      uInner: { value: inner }, uDash: { value: new THREE.Vector2(dash?.[0] ?? 0, dash?.[1] ?? 0) },
      uReveal: { value: ALL }, uResolution: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader: VERTEX, fragmentShader: FRAGMENT, defines: units === "yd" ? { WORLD_UNITS: "" } : {},
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, vertexColors,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    polygonOffset: Boolean(layer), polygonOffsetFactor: layer?.factor ?? 0, polygonOffsetUnits: layer?.units ?? 0,
  });
  material.userData = { ...material.userData, opacity, style: dash ? "dashed" : "solid" };
  return material;
}

/** Reveal a strip up to `distance` yards along its path (ALL: whole). */
export function setReveal(material, distance) {
  material.uniforms.uReveal.value = distance;
}

/** A strip mesh: the shader learns the viewport size (CSS px) before each draw, as Line2 does. */
export function stripMesh(geometry, material, order = 0) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = order;
  mesh.frustumCulled = false;
  mesh.onBeforeRender = (renderer) => {
    renderer.getViewport(viewport);
    material.uniforms.uResolution.value.set(Math.max(1, viewport.z), Math.max(1, viewport.w));
  };
  return mesh;
}
