// The engine's dynamic layers (ui-architecture 2.5 and the v1.2 A5 note; owner A5). scene.js owns timing, tokens,
// deferral, events and hooks; a layer only draws. Part 1 ships placeholders so the Engine works end to end: a
// player that moves a ball along the drawing's track (no strokes), flat ghost zones in the kit's ghost materials,
// and empty overlays and residue. Part 2 replaces them by editing LAYER_FACTORIES only:
//   player:   createPlayer(stage)     -> { start(drawing, plan, row) -> job, placeAll(items), review(item | null),
//                                          relabel(rows), verdict(v), clear(), dispose() }
//             job = { update(tMs) -> boolean (true while it still draws), ball() -> field point | null,
//                     finish(), dispose() }
//   ghosts:   createGhostLayer(stage) -> { show(set), highlight(leaf), fade(k, ms), clear(), dispose() }
//   overlays: createOverlays(stage)   -> { situation(sit), clear(), dispose() }
//   residue:  createResidue(stage)    -> { add(drawing, row), relabel(rows), clear(), dispose() }
// Every method but start/show/situation/clear/dispose is optional. Layers add their objects under
// stage.roots.<name> and dispose what they own (dispose.js disposeTree; the kit's materials are shared).
import * as THREE from "three";
import { toWorld } from "./coords.js";
import { disposeTree } from "./dispose.js";
import { LAYERS } from "./materials.js";
import { ballAt } from "./timing.js";

const BALL_LONG = 0.66;
const BALL_WIDE = 0.42;
const DIM = 0.3;

/** Placeholder player: the ball flies the drawing's track (arcs at their generic height); nothing is drawn. */
function createBallPlayer(stage) {
  const root = stage.roots.plays;
  function makeBall() {
    const s = stage.look.ball.scale;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 12).scale(BALL_WIDE * s, BALL_WIDE * s, BALL_LONG * s)
      .rotateY(Math.PI / 2), stage.kit.ball().body);
    mesh.castShadow = true;
    root.add(mesh);
    return mesh;
  }
  const clear = () => { for (const o of [...root.children]) disposeTree(o); };
  return {
    start(drawing, plan) {
      clear();
      const mesh = makeBall();
      const rest = (BALL_WIDE / 2) * stage.look.ball.scale;
      let last = null;
      const update = (tMs) => {
        const b = ballAt(drawing, plan, Math.min(Math.max(0, tMs), plan.totalMs));
        if (b) {
          const w = toWorld(b.x, b.y, b.h + rest);
          mesh.position.set(w.x, w.y, w.z);
          last = { x: b.x, y: b.y, h: b.h };
        }
        if (tMs < plan.totalMs) return true;
        disposeTree(mesh);                 // the resting ball takes over at the play's end spot
        return false;
      };
      stage.lines.setBallVisible(false);
      update(0);
      return { update, ball: () => last, finish: () => update(plan.totalMs), dispose: () => disposeTree(mesh) };
    },
    placeAll: clear,
    clear,
    dispose: clear,
  };
}

function zoneMesh(stage, shape) {
  const y0 = shape.kind === "band" ? shape.y0 : shape.yC - shape.halfWidth;
  const y1 = shape.kind === "band" ? shape.y1 : shape.yC + shape.halfWidth;
  const a = toWorld(Math.min(shape.x0, shape.x1), y1);
  const b = toWorld(Math.max(shape.x0, shape.x1), y0);
  const { fill } = stage.kit.ghost(shape.rank, shape.family);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(0.5, b.x - a.x), Math.max(0.5, b.z - a.z))
    .rotateX(-Math.PI / 2), fill);
  mesh.position.set((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
  mesh.renderOrder = LAYERS.ghostZone.order + shape.stack * 0.01;
  mesh.userData = { leaf: shape.leaf, rank: shape.rank, material: fill };
  return mesh;
}

/** Placeholder ghosts: each top-3 shape as a flat zone in the kit's ghost material; labels show the percentage. */
function createZoneGhosts(stage) {
  const root = stage.roots.ghosts;
  let shown = [];
  let marks = [];
  const clear = () => {
    for (const m of shown) {
      stage.kit.fade(m.userData.material, 1);
      disposeTree(m);
    }
    for (const h of marks) stage.labels.remove(h);
    shown = [];
    marks = [];
  };
  return {
    show(set) {
      clear();
      for (const shape of set?.shapes ?? []) {
        const mesh = zoneMesh(stage, shape);
        root.add(mesh);
        shown.push(mesh);
        if (stage.look.ghost.labels && shape.label?.at) {
          const h = stage.labels.add({ ...shape.label.at, h: 0 }, `${Math.round(shape.p * 100)}%`, `sc-ghost-label rank-${shape.rank}`);
          if (h) marks.push(h);
        }
      }
      stage.requestRender();
    },
    highlight(leaf) {
      for (const m of shown) stage.kit.fade(m.userData.material, !leaf || m.userData.leaf === leaf ? 1 : DIM);
      stage.requestRender();
    },
    fade(k) {
      for (const m of shown) stage.kit.fade(m.userData.material, k);
      stage.requestRender();
    },
    clear,
    dispose: clear,
  };
}

const NOTHING = Object.freeze({ situation() {}, add() {}, clear() {}, dispose() {} });

/** The layer factories scene.js instantiates (part 2 points these at player.js, ghost-layer.js, ...). */
export const LAYER_FACTORIES = Object.freeze({
  residue: () => NOTHING,
  overlays: () => NOTHING,
  ghosts: createZoneGhosts,
  player: createBallPlayer,
});

/** Instantiate every layer for a stage, residue first (the player may hand finished plays to it). */
export function createLayers(stage, factories = LAYER_FACTORIES) {
  const out = {};
  for (const name of ["residue", "overlays", "ghosts", "player"]) out[name] = factories[name](stage);
  return out;
}
