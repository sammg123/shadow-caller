// Under the Lights: what hangs in the air between the stands and the field (owner W1).
//   createShafts  the towers' light shafts in the haze (DESIGN.md "Night": faint additive shafts, at most 6%),
//                 four open cones merged into one mesh, one draw call; dimmed with the towers.
//   createRimCaster  the day's shadow line (DESIGN.md "Day": "the stadium rim casting its shadow line across part of
//                 the field (a rim mesh in the shadow map)"). The engine fits the sun's shadow camera to the field
//                 (lighting.js), so the real rim, 40 yd up and far out, falls outside it; the same rim slid down
//                 the sun's rays to a height inside that box casts exactly the same line on the turf. It writes
//                 nothing to the screen (colorWrite off) and only its shadow shows.
import { toWorld } from "../../../../field/coords.js";
import { ringPoint } from "./builder.js";
import { LEVELS, RINGS, deckRanges } from "./bowl.js";
import { shaftMaterial } from "../shaders/shaft.js";

export const SHAFT = Object.freeze({ segments: 28, reach: 0.9, spread: 0.72, opacity: 0.06, startR: 2.2 });
export const CASTER = Object.freeze({ height: 9, outward: 70, segments: 96 });

const unit = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** One open cone's vertices: narrow at the lamp head (uv.y 1), wide toward the field (uv.y 0). */
function cone(out, head, aim, angle) {
  const axis = unit([aim[0] - head[0], aim[1] - head[1], aim[2] - head[2]]);
  const length = Math.hypot(aim[0] - head[0], aim[1] - head[1], aim[2] - head[2]) * SHAFT.reach;
  const r1 = SHAFT.startR + length * Math.tan(angle * SHAFT.spread);
  const side = unit(cross(axis, Math.abs(axis[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0]));
  const up = cross(side, axis);
  const base = out.pos.length / 3;
  for (let i = 0; i <= SHAFT.segments; i += 1) {
    const a = (i / SHAFT.segments) * Math.PI * 2;
    const dir = [side[0] * Math.cos(a) + up[0] * Math.sin(a), side[1] * Math.cos(a) + up[1] * Math.sin(a),
      side[2] * Math.cos(a) + up[2] * Math.sin(a)];
    for (const [r, along, v] of [[SHAFT.startR, 0, 1], [r1, length, 0]]) {
      out.pos.push(head[0] + axis[0] * along + dir[0] * r, head[1] + axis[1] * along + dir[1] * r,
        head[2] + axis[2] * along + dir[2] * r);
      out.nrm.push(...dir);
      out.uv.push(i / SHAFT.segments, v);
    }
  }
  for (let i = 0; i < SHAFT.segments; i += 1) {
    const k = base + i * 2;
    out.idx.push(k, k + 1, k + 3, k, k + 3, k + 2);
  }
}

/**
 * The four towers' shafts as one mesh (night only).
 * @param {object} THREE
 * @param {object[]} towers  spot lights from the look (position, target, angle; field yards)
 */
export function createShafts(THREE, towers, { color }) {
  const out = { pos: [], nrm: [], uv: [], idx: [] };
  for (const t of towers) {
    const h = toWorld(...t.position);
    const a = toWorld(...(t.target ?? [50, 26.667, 0]));
    cone(out, [h.x, h.y, h.z], [a.x, a.y, a.z], t.angle ?? 0.6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(out.pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(out.nrm, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(out.uv, 2));
  g.setIndex(out.idx);
  g.computeBoundingSphere();
  const material = shaftMaterial(THREE, { color, opacity: SHAFT.opacity });
  const mesh = new THREE.Mesh(g, material);
  mesh.name = "uls-shafts";
  mesh.renderOrder = 20;
  return { mesh, setLevel(k) { material.uniforms.uLevel.value = k; },
    dispose() { g.dispose(); material.dispose(); } };
}

/** The sun's direction of travel (unit, world) from a directional light in field yards. */
export function sunDirection(sun) {
  const p = toWorld(...sun.position);
  const t = toWorld(...(sun.target ?? [50, 26.667, 0]));
  return unit([t.x - p.x, t.y - p.y, t.z - p.z]);
}

/** A rim point slid along the sun's rays down to `height` (it shades the same spot on the turf). */
export function slideTo(point, dir, height) {
  const s = (point[1] - height) / -dir[1];
  return [point[0] + dir[0] * s, height, point[2] + dir[2] * s];
}

/**
 * The day's rim caster: the stands' top edge slid down the sun's rays into the shadow box, extended outward (toward
 * the sun) so everything beyond the line is shaded. Null when the look has no shadow-casting directional light.
 */
export function createRimCaster(THREE, look) {
  const sun = look.lights.find((l) => l.kind === "directional" && l.castShadow && Array.isArray(l.position));
  if (!sun) return null;
  const d = sunDirection(sun);
  if (!(d[1] < -0.05)) return null;
  const top = LEVELS.upperTop + RINGS.upper.rim;
  const back = RINGS.upper.a + RINGS.upper.lip + RINGS.upper.rows * RINGS.upper.depth;
  const backB = RINGS.upper.b + RINGS.upper.lip + RINGS.upper.rows * RINGS.upper.depth;
  const [t0, t1] = deckRanges().upper;
  const pos = [];
  const idx = [];
  const out = [-d[0], 0, -d[2]];
  const ol = Math.hypot(out[0], out[2]) || 1;
  for (let i = 0; i <= CASTER.segments; i += 1) {
    const p = ringPoint(t0 + ((t1 - t0) * i) / CASTER.segments, back, backB);
    const edge = slideTo([p[0], top, p[1]], d, CASTER.height);
    pos.push(...edge, edge[0] + (out[0] / ol) * CASTER.outward, CASTER.height, edge[2] + (out[2] / ol) * CASTER.outward);
    if (i) idx.push((i - 1) * 2, i * 2, i * 2 + 1, (i - 1) * 2, i * 2 + 1, (i - 1) * 2 + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const material = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
  material.shadowSide = THREE.DoubleSide;
  const mesh = new THREE.Mesh(g, material);
  mesh.name = "uls-rim-caster";
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  return { mesh, dispose() { g.dispose(); material.dispose(); } };
}
