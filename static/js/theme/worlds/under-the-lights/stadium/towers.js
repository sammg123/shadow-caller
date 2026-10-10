// Under the Lights: the four light towers (DESIGN.md "The bowl", "Night", Bloom; owner W1). Each is a tapered steel
// mast under a lamp bank aimed at its spot light's target: the steel goes into the stands' builder (one draw call for
// the whole stadium), the lamps are one instanced mesh of warm-white discs pushed far above the bloom threshold, the
// brightest objects in the scene and the only towers' parts that glow (The Fixture Rule). By day the lamps are off:
// dark glass. The light dip dims the lamps with the spot lights (setLevel).
import { toWorld } from "../../../../field/coords.js";
import { linearRgb } from "./builder.js";
import { bowlHaze } from "./haze.js";

export const TOWER_SHAPE = Object.freeze({ baseHalf: 1.15, topHalf: 0.7, headW: 15, headH: 8, headD: 1.4, cols: 9, rows: 4,
  lampR: 0.68, lampGlow: 9, gap: 0.12 });
const STEEL = Object.freeze({ mast: "#2a3246", head: "#232a3b", face: "#0f1218", brace: "#343d55" });
const DAY_GLASS = "#3d4556";

const v3 = (p) => [p.x, p.y, p.z];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * A tower's frame in world yards from its spot light (look.lights: position and target in field yards): the head's
 * center, the direction it faces (toward the target), and its right and up axes.
 */
export function towerFrame(light) {
  const head = v3(toWorld(...light.position));
  const aim = v3(toWorld(...(light.target ?? [50, 26.667, 0])));
  const facing = norm([aim[0] - head[0], aim[1] - head[1], aim[2] - head[2]]);
  const right = norm(cross(facing, [0, 1, 0]));
  const up = norm(cross(right, facing));
  return { id: light.id, head, facing, right, up };
}

/** The spot lights the world treats as towers (ids beginning with "tower"), in look order. */
export const towerLights = (look) => look.lights.filter((l) => l.kind === "spot" && l.id.startsWith("tower")
  && Array.isArray(l.position));

/** A box's six faces from its center and three half-axes (world yards), into the builder. */
function box(b, c, axes, rgb) {
  for (let i = 0; i < 3; i += 1) {
    for (const sign of [1, -1]) {
      const n = scale(axes[i], sign);
      const [u, w] = axes.filter((_, k) => k !== i);
      const p = (su, sw) => add(add(add(c, n), scale(u, su)), scale(w, sw));
      b.quad(p(-1, -1), p(1, -1), p(1, 1), p(-1, 1), rgb, { dir: n });
    }
  }
}

/** A tapered square mast from the ground to just under the head. */
function mast(b, f, rgb) {
  const top = f.head[1] - TOWER_SHAPE.headH * 0.42;
  const at = (half, y) => [[f.head[0] - half, y, f.head[2] - half], [f.head[0] + half, y, f.head[2] - half],
    [f.head[0] + half, y, f.head[2] + half], [f.head[0] - half, y, f.head[2] + half]];
  const lo = at(TOWER_SHAPE.baseHalf, 0);
  const hi = at(TOWER_SHAPE.topHalf, top);
  const mid = [f.head[0], top / 2, f.head[2]];
  for (let i = 0; i < 4; i += 1) {
    const j = (i + 1) % 4;
    const out = [(lo[i][0] + lo[j][0]) / 2 - mid[0], 0, (lo[i][2] + lo[j][2]) / 2 - mid[2]];
    b.quad(lo[i], lo[j], hi[j], hi[i], rgb, { dir: out });
  }
}

/**
 * Masts and lamp-bank heads into the stadium builder (steel; one draw call with the stands).
 * @param {ReturnType<import("./builder.js").createBuilder>} b
 * @param {ReturnType<typeof towerFrame>[]} frames
 */
export function addTowerSteel(b, frames) {
  const c = Object.fromEntries(Object.entries(STEEL).map(([k, hex]) => [k, linearRgb(hex)]));
  for (const f of frames) {
    mast(b, f, c.mast);
    const back = add(f.head, scale(f.facing, -TOWER_SHAPE.headD / 2));
    box(b, back, [scale(f.right, TOWER_SHAPE.headW / 2 + 0.3), scale(f.up, TOWER_SHAPE.headH / 2 + 0.3),
      scale(f.facing, TOWER_SHAPE.headD / 2)], c.head);
    const face = add(f.head, scale(f.facing, 0.02));
    b.quad(add(add(face, scale(f.right, -TOWER_SHAPE.headW / 2)), scale(f.up, -TOWER_SHAPE.headH / 2)),
      add(add(face, scale(f.right, TOWER_SHAPE.headW / 2)), scale(f.up, -TOWER_SHAPE.headH / 2)),
      add(add(face, scale(f.right, TOWER_SHAPE.headW / 2)), scale(f.up, TOWER_SHAPE.headH / 2)),
      add(add(face, scale(f.right, -TOWER_SHAPE.headW / 2)), scale(f.up, TOWER_SHAPE.headH / 2)), c.face, { dir: f.facing });
  }
}

/** Every lamp's center and facing: a cols x rows grid on each head's face. */
export function lampLayout(frames) {
  const { headW, headH, cols, rows } = TOWER_SHAPE;
  const dx = headW / cols;
  const dy = headH / rows;
  return frames.flatMap((f) => Array.from({ length: cols * rows }, (_, k) => {
    const u = (k % cols) - (cols - 1) / 2;
    const w = Math.floor(k / cols) - (rows - 1) / 2;
    const at = add(add(add(f.head, scale(f.facing, 0.08)), scale(f.right, u * dx)), scale(f.up, w * dy));
    return { at, facing: f.facing, up: f.up };
  }));
}

/**
 * The lamps: one InstancedMesh of discs, warm white at TOWER_SHAPE.lampGlow (HDR: they bloom), or dark glass by day.
 * @returns {{ mesh: THREE.InstancedMesh, setLevel(k: number): void, dispose(): void }}
 */
export function createLamps(THREE, frames, { color, day = false }) {
  const layout = lampLayout(frames);
  const geometry = new THREE.CircleGeometry(TOWER_SHAPE.lampR, 16);
  const base = day ? new THREE.Color(DAY_GLASS) : new THREE.Color(color).multiplyScalar(TOWER_SHAPE.lampGlow);
  const material = bowlHaze(new THREE.MeshBasicMaterial({ color: base.clone(), side: THREE.FrontSide }));
  const mesh = new THREE.InstancedMesh(geometry, material, layout.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const z = new THREE.Vector3(0, 0, 1);
  layout.forEach((lamp, i) => {
    q.setFromUnitVectors(z, new THREE.Vector3(...lamp.facing));
    m.compose(new THREE.Vector3(...lamp.at), q, new THREE.Vector3(1, 1, 1));
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.name = "uls-tower-lamps";
  return {
    mesh,
    setLevel(k) {
      if (!day) material.color.copy(base).multiplyScalar(k);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
