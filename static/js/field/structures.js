// What stands on the field (three-recipe 4.7; owner A5): single-standard goalposts in the plane of each end line
// (gold, with orange ribbons on the uprights and a pad in the defending team's color), the eight pylons, and,
// when the look asks for one, a plinth under the field with the surround at its foot. Static geometry is merged
// per material (6.1: field paint at most 12 draw calls); goalposts and pylons cast the field's only shadows.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { NFL as NFL_FOR_PROPS, pylonLayout } from "./field-spec.js";

/** NFL fixtures: goalposts are bright gold, pylons and the upright ribbons orange (DESIGN.md tertiary colors). */
export const FIXTURE_COLORS = Object.freeze({ gold: "#ffc425", orange: "#ff6a13", pad: "#2a3340" });

const POST_R = 0.07;        // about 5 in uprights
const NECK_R = 0.12;
const PAD_R = 0.32;
const PAD_H = 2;
const SEGMENTS = 12;

function placed(geometry, position, rotation = null) {
  const m = new THREE.Matrix4();
  if (rotation) m.makeRotationFromEuler(rotation);
  m.setPosition(position);
  return geometry.applyMatrix4(m);
}

/** One goalpost's geometry by material: { gold: [...], pad: [...], ribbon: [...] }. `side` -1 left, 1 right. */
function goalpostParts(L, side) {
  const gp = L.goalpost;
  const xLine = side * L.endLineX;
  const xBase = side * (L.endLineX + gp.baseBehindEndLine);
  const barY = gp.crossbarHeight - POST_R;
  const neck = new THREE.CatmullRomCurve3([
    new THREE.Vector3(xBase, 0, 0), new THREE.Vector3(xBase, barY - 0.9, 0),
    new THREE.Vector3(xBase - side * 0.35, barY - 0.15, 0), new THREE.Vector3(xLine, barY, 0)]);
  const half = gp.innerWidth / 2 + POST_R;
  const gold = [
    new THREE.TubeGeometry(neck, 40, NECK_R, SEGMENTS),
    placed(new THREE.CylinderGeometry(POST_R, POST_R, 2 * half, SEGMENTS), new THREE.Vector3(xLine, barY, 0),
      new THREE.Euler(Math.PI / 2, 0, 0)),
  ];
  const ribbon = [];
  for (const s of [-1, 1]) {
    gold.push(placed(new THREE.CylinderGeometry(POST_R, POST_R, gp.aboveCrossbar, SEGMENTS),
      new THREE.Vector3(xLine, barY + gp.aboveCrossbar / 2, s * half)));
    ribbon.push(placed(new THREE.PlaneGeometry(gp.ribbon[0] * 2.5, gp.ribbon[1]),
      new THREE.Vector3(xLine, barY + gp.aboveCrossbar - gp.ribbon[1] / 2, s * half), new THREE.Euler(0, Math.PI / 2, 0)));
  }
  const pad = [placed(new THREE.CylinderGeometry(PAD_R, PAD_R, PAD_H, 20), new THREE.Vector3(xBase, PAD_H / 2, 0))];
  return { gold, pad, ribbon };
}

function mergedMesh(geometries, material, name) {
  const geometry = mergeGeometries(geometries, false);
  for (const g of geometries) g.dispose();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Both goalposts as three merged meshes (gold, pads, ribbons). `padColors` { left, right } are the defending teams'
 * colors (#rrggbb), neutral when absent.
 */
export function createGoalposts(L, padColors = {}) {
  const left = goalpostParts(L, -1);
  const right = goalpostParts(L, 1);
  const group = new THREE.Group();
  group.name = "goalposts";
  const gold = new THREE.MeshStandardMaterial({ color: FIXTURE_COLORS.gold, roughness: 0.38, metalness: 0.25, fog: false });
  const ribbon = new THREE.MeshStandardMaterial({ color: FIXTURE_COLORS.orange, roughness: 0.7, side: THREE.DoubleSide,
    fog: false });
  group.add(mergedMesh([...left.gold, ...right.gold], gold, "goalposts-gold"));
  group.add(mergedMesh([...left.ribbon, ...right.ribbon], ribbon, "goalposts-ribbons"));
  for (const [parts, color, name] of [[left.pad, padColors.left, "pad-left"], [right.pad, padColors.right, "pad-right"]]) {
    group.add(mergedMesh(parts, new THREE.MeshStandardMaterial({ color: color ?? FIXTURE_COLORS.pad, roughness: 0.8,
      fog: false }), name));
  }
  return group;
}

/** The eight 4 x 4 x 18 in pylons as one instanced mesh. */
export function createPylons(L) {
  const p = L.pylon;
  const geometry = new THREE.BoxGeometry(p.size, p.height, p.size).translate(0, p.height / 2, 0);
  const material = new THREE.MeshStandardMaterial({ color: FIXTURE_COLORS.orange, roughness: 0.6, emissive: "#3a1000",
    fog: false });
  const layout = pylonLayout(L);
  const mesh = new THREE.InstancedMesh(geometry, material, layout.length);
  const m = new THREE.Matrix4();
  layout.forEach(([x, z], i) => mesh.setMatrixAt(i, m.makeTranslation(x, 0, z)));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.name = "pylons";
  mesh.castShadow = true;
  return mesh;
}

/**
 * look.field.plinth { height, color }: the field sits on a block whose top is `top` ([width, depth] yards), with
 * the surround laid out at its foot. Returns null when the look has no plinth (the turf then reaches the horizon).
 */
export function createPlinth(look, [width, depth], outer) {
  const plinth = look.field.plinth;
  if (!plinth) return null;
  const group = new THREE.Group();
  group.name = "plinth";
  const block = new THREE.Mesh(new THREE.BoxGeometry(width, plinth.height, depth).translate(0, -plinth.height / 2 - 0.01, 0),
    new THREE.MeshStandardMaterial({ color: plinth.color, roughness: 0.85 }));
  block.receiveShadow = true;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(outer[0], outer[1]).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: look.field.surround, roughness: 0.95 }));
  ground.position.y = -plinth.height;
  ground.receiveShadow = true;
  group.add(block, ground);
  return group;
}

const BENCHES_PER_SIDE = 6;
const BENCH = Object.freeze({ length: 5.5, height: 0.55, depth: 0.7, span: 34, setback: 4.5 });
const WALL = Object.freeze({ x: 72, z: 44, height: 1.3, thick: 0.6 });

function benches(L, color) {
  const geometry = new THREE.BoxGeometry(BENCH.length, BENCH.height, BENCH.depth).translate(0, BENCH.height / 2, 0);
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: 0.7 }),
    BENCHES_PER_SIDE * 2);
  const m = new THREE.Matrix4();
  const z = L.halfWidth + L.border + L.coachLineGap + BENCH.setback;
  let i = 0;
  for (const side of [1, -1]) {
    for (let k = 0; k < BENCHES_PER_SIDE; k += 1) {
      mesh.setMatrixAt(i, m.makeTranslation(-BENCH.span / 2 + k * (BENCH.span / (BENCHES_PER_SIDE - 1)), 0, side * z));
      i += 1;
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.name = "benches";
  return mesh;
}

function perimeterWall(color) {
  const parts = [];
  for (const s of [1, -1]) {
    parts.push(new THREE.BoxGeometry(2 * WALL.x, WALL.height, WALL.thick).translate(0, WALL.height / 2, s * WALL.z));
    parts.push(new THREE.BoxGeometry(WALL.thick, WALL.height, 2 * WALL.z).translate(s * WALL.x, WALL.height / 2, 0));
  }
  const mesh = mergedMesh(parts, new THREE.MeshStandardMaterial({ color, roughness: 0.85 }), "perimeter-wall");
  mesh.castShadow = false;
  return mesh;
}

/**
 * The plain neutral surroundings (the props hook's default when a world brings none): team benches between the
 * 30s on both sidelines, the feed doesn't say whose is whose, and a low wall around the field. Same contract as a
 * world's props(ctx): { object, dispose() }.
 */
export function neutralProps({ look }) {
  const object = new THREE.Group();
  object.name = "neutral-props";
  object.add(benches(NFL_FOR_PROPS, FIXTURE_COLORS.pad), perimeterWall(look.field.surround));
  return {
    object,
    dispose() {
      object.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose?.();
      });
      object.removeFromParent();
    },
  };
}
