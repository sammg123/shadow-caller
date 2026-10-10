// One play's drawing as meshes (A5 part 2; play-drawing.md 2): the parts play-style.js describes, built once and
// revealed by each step's progress, so the strokes grow exactly to the ball (timing.js plans the steps; a carry eases
// out, a flight does not). Strips for strokes and an arc's ground track (play-strip.js), flat triangles for
// arrowheads, glyph planes on the turf for marks (play-glyphs.js; a billboard at the posts for a field goal). Every
// material belongs to this art (plays dim and fade on their own), and dispose() frees all of it.
//   buildArt(parts, { glyphs })  -> { group, show(plan, tMs, drawing), complete(), revealAll(u), setOpacity(k), dispose() }
import * as THREE from "three";
import { toWorld } from "./coords.js";
import { disposeTree } from "./dispose.js";
import { LAYERS } from "./materials.js";
import { buildDrawing } from "./paths.js";
import { markPop, resolvePlayLook, revealAt } from "./play-style.js";
import { ALL, setReveal, stripGeometry, stripMaterial, stripMesh } from "./play-strip.js";
import { setOpacity } from "./shaders.js";
import { easeFor, progressAt } from "./timing.js";

const ARROW_TIP = 0.55;          // the arrowhead's tip sits this far past the line's end, in arrowhead lengths

const lagged = (part, u) => (part.lag > 0 ? Math.min(1, Math.max(0, (u - part.lag) / (1 - part.lag))) : u);
const layerOf = (part) => (part.type === "track" ? LAYERS.graphic : part.turf ? LAYERS.shadow : null);

function stripOf(part) {
  const material = stripMaterial({ color: part.color, opacity: part.opacity, units: part.units, width: part.width,
    inner: part.inner, dash: part.dash, layer: layerOf(part) });
  const mesh = stripMesh(stripGeometry([part.path]), material, part.order);
  return { mesh, material, reveal: (u) => setReveal(material, u >= 1 ? ALL : revealAt(part.path, u)) };
}

/** A flat triangle on the turf pointing along `dir`, or (inner > 0) its outline ring, in world coordinates. */
export function arrowGeometry(part) {
  const at = toWorld(part.at.x, part.at.y, 0);
  const d = { x: part.dir.x, z: -part.dir.y };
  const n = { x: -d.z, z: d.x };
  const corner = (u, v) => [at.x + d.x * u + n.x * v, 0, at.z + d.z * u + n.z * v];
  const L = part.length;
  const tri = [corner(L * ARROW_TIP, 0), corner(-L * (1 - ARROW_TIP), part.width / 2),
    corner(-L * (1 - ARROW_TIP), -part.width / 2)];
  const c = tri.reduce((s, p) => [s[0] + p[0] / 3, 0, s[2] + p[2] / 3], [0, 0, 0]);
  const inner = tri.map((p) => [c[0] + (p[0] - c[0]) * part.inner, 0, c[2] + (p[2] - c[2]) * part.inner]);
  const geometry = new THREE.BufferGeometry();
  const verts = part.inner > 0 ? [...tri, ...inner] : tri;
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(verts.flat(), 3));
  geometry.setIndex(part.inner > 0 ? [0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4, 2, 0, 3, 2, 3, 5] : [0, 1, 2]);
  return geometry;
}

function basicOf(part, extra = {}) {
  const layer = layerOf(part);
  const material = new THREE.MeshBasicMaterial({ color: part.color, transparent: true, opacity: part.opacity,
    depthWrite: false, side: THREE.DoubleSide, fog: false, polygonOffset: Boolean(layer),
    polygonOffsetFactor: layer?.factor ?? 0, polygonOffsetUnits: layer?.units ?? 0, ...extra });
  material.userData = { ...material.userData, opacity: part.opacity };
  return material;
}

function arrowOf(part) {
  const material = basicOf(part);
  const mesh = new THREE.Mesh(arrowGeometry(part), material);
  mesh.renderOrder = part.order;
  mesh.visible = false;
  return { mesh, material, reveal: (u) => { mesh.visible = u >= 1; } };
}

function markOf(part, glyphs) {
  const mask = glyphs?.mask(part.glyph, part.layer, part.text) ?? null;
  const w = part.size * (glyphs?.aspect(part.glyph) ?? 1);
  const at = toWorld(part.at.x, part.at.y, part.lift);
  let mesh;
  let material;
  if (part.billboard) {
    material = new THREE.SpriteMaterial({ color: part.color, alphaMap: mask, transparent: true, opacity: part.opacity,
      depthWrite: false, fog: false });
    material.userData = { ...material.userData, opacity: part.opacity };
    mesh = new THREE.Sprite(material);
    mesh.userData.size = [w, part.size];
  } else {
    material = basicOf(part, { alphaMap: mask });
    mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, part.size).rotateX(-Math.PI / 2), material);
    mesh.userData.size = [1, 1];
  }
  mesh.position.set(at.x, at.y, at.z);
  mesh.renderOrder = part.order;
  mesh.visible = false;
  const fit = (k) => mesh.scale.set(mesh.userData.size[0] * k, mesh.userData.size[1] * k, 1);
  return { mesh, material, pop: true, reveal: (u) => {
    const p = markPop(u);
    mesh.visible = u > 0;
    if (part.billboard) fit(p.scale);
    else mesh.scale.setScalar(p.scale);
    return p.opacity;
  } };
}

const BUILD = Object.freeze({ stroke: stripOf, track: stripOf, arrow: arrowOf, mark: markOf });

// ---------------------------------------------------------------- what every action layer styles with
const TONE_VARS = Object.freeze({ good: "--sc-good", bad: "--sc-bad", warn: "--sc-warn" });

/** The page's meaning colors (the world's --sc-good|bad|warn tokens on the field host), {} without a page. */
function pageTones(stage) {
  try {
    const cs = stage.doc?.defaultView?.getComputedStyle?.(stage.host);
    if (!cs) return {};
    return Object.fromEntries(Object.entries(TONE_VARS).map(([k, name]) => [k, cs.getPropertyValue(name).trim()]));
  } catch {
    return {};
  }
}

const ENV_MS = 1000;
const envs = new WeakMap();
const clock = () => globalThis.performance?.now?.() ?? Date.now();

/** { paint(team), plays }: the team paints (the kit's teamPaint) and look.world.plays with the page's tones. Kept for
 * a second per look, so a play's start reads the page's style once, not once per part. */
export function playEnv(stage) {
  const now = clock();
  const hit = envs.get(stage);
  if (hit && hit.look === stage.look && now - hit.at < ENV_MS) return hit.env;
  const env = { paint: (team) => stage.kit.paint(team), plays: resolvePlayLook(stage.look, pageTones(stage)) };
  envs.set(stage, { look: stage.look, at: now, env });
  return env;
}

/** A row's drawing, or null with a warning: a malformed row must never take the WebGL field down (a retag's relabel). */
export function drawingOrNull(stage, row) {
  try {
    return buildDrawing(row);
  } catch (err) {
    stage.emit?.("warning", err);
    return null;
  }
}

// ---------------------------------------------------------------- labels on the field (labels.js handles)
/** A label centered on its field spot (the label model's box is centered on `at`), or null (no labels). Text only. */
export function fieldLabel(stage, at, text, cls) {
  if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y) || !text) return null;
  const handle = stage.labels.add({ x: at.x, y: at.y, h: 0 }, text, cls);
  handle?.object?.center?.set?.(0.5, 0.5);
  return handle;
}

/** Fade a label: its text element (css2d) or its canvas material (sprite, decal). */
export function setLabelOpacity(handle, k) {
  const value = Math.min(1, Math.max(0, k));
  if (handle?.element?.style) handle.element.style.opacity = value >= 1 ? "" : String(value);
  else if (handle?.object?.material) {
    handle.object.material.transparent = true;
    handle.object.material.opacity = value;
  }
}

export const setLabelVisible = (handle, on) => {
  if (handle?.object) handle.object.visible = Boolean(on);
};

export const toggleLabelClass = (handle, cls, on) => handle?.element?.classList?.toggle(cls, Boolean(on));

export function removeLabel(stage, handle) {
  if (handle) stage.labels.remove(handle);
  return null;
}

/**
 * The meshes for a play's parts, hidden until revealed (the caller adds `group` under its layer root).
 * @param {ReadonlyArray<object>} parts  play-style.js playParts or shadowParts
 * @param {{ glyphs?: object }} [opts]  the layer's glyph cache (play-glyphs.js)
 */
export function buildArt(parts, { glyphs = null } = {}) {
  const group = new THREE.Group();
  group.name = "play-art";
  const items = (Array.isArray(parts) ? parts : []).map((part) => {
    const built = BUILD[part.type]?.(part, glyphs);
    if (!built) return null;
    group.add(built.mesh);
    return { part, ...built, u: 0, popK: 1 };
  }).filter(Boolean);
  const st = { k: 1 };
  const applyOpacity = (it) => setOpacity(it.material, st.k * it.popK);

  function reveal(it, u) {
    it.u = u;
    const out = it.reveal(u);
    if (it.pop) it.popK = out;
    if (it.part.type === "stroke" || it.part.type === "track") it.mesh.visible = u > 0;
    applyOpacity(it);
  }

  for (const it of items) reveal(it, 0);
  return {
    group,
    items,
    /** Each step's progress at `tMs` into `plan` (eased as the ball moves), applied to its parts. */
    show(plan, tMs, drawing) {
      const active = new Map(progressAt(plan, tMs).map((p) => [p.index, p.u]));
      for (const it of items) {
        const u = active.get(it.part.step) ?? 0;
        const step = drawing?.steps?.[it.part.step];
        reveal(it, it.pop || it.part.type === "arrow" ? u : easeFor(step)(u));
      }
    },
    /** Every step drawn whole. */
    complete() { for (const it of items) reveal(it, 1); },
    /** Every part to `u` (a shadow growing from the line of scrimmage); a part with a `lag` starts once u passes it. */
    revealAll(u) { for (const it of items) reveal(it, lagged(it.part, u)); },
    /** Dim or fade the whole play to `k` of each part's own opacity. */
    setOpacity(k) {
      st.k = Math.min(1, Math.max(0, k));
      for (const it of items) applyOpacity(it);
    },
    opacity: () => st.k,
    dispose: () => disposeTree(group),
  };
}

// ---------------------------------------------------------------- shader programs, compiled at boot
/**
 * One tiny mesh for each kind of shader program the action layer draws with (dispose.js programKind: the plays, the
 * shadows, the residue and the ball in play; play-art.test pins the list against all of them), under the turf: drawn
 * in the first frames, never seen. The engine compiles them before its first frame (renderer warmUp) and the program
 * keeper (dispose.keepPrograms) holds them for the engine's life, so no play, shadow or review ever compiles or links
 * a program mid-game (G7-1). The player hides the group after its first frames and frees it with the layer.
 */
export function warmUpPrograms() {
  const group = new THREE.Group();
  group.name = "play-warm-up";
  group.position.y = -50;
  const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  tex.needsUpdate = true;
  const path = { points: [{ x: 50, y: 26, h: 0 }, { x: 51, y: 26, h: 0 }] };
  const tip = { at: { x: 50, y: 26 }, dir: { x: 1, y: 0 }, length: 0.1, width: 0.1, inner: 0 };
  const plane = () => new THREE.PlaneGeometry(0.1, 0.1).rotateX(-Math.PI / 2);
  const basic = (extra) => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide,
    fog: false, ...extra });
  const tinted = arrowGeometry(tip);
  tinted.setAttribute("color", new THREE.Float32BufferAttribute(new Array(12).fill(1), 4));
  const instanced = new THREE.InstancedMesh(plane(), basic({ alphaMap: tex }), 1);
  instanced.setMatrixAt(0, new THREE.Matrix4());
  instanced.setColorAt(0, new THREE.Color("#ffffff"));
  const sprite = (extra) => new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false,
    fog: false, ...extra }));
  group.add(
    ...["px", "yd"].flatMap((units) => [                 // strokes, shadows, the trail; residue's (per-path colors)
      stripMesh(stripGeometry([path]), stripMaterial({ color: "#ffffff", units })),
      stripMesh(stripGeometry([{ ...path, color: "#ffffff" }]), stripMaterial({ color: "#ffffff", units,
        vertexColors: true }))]),
    new THREE.Mesh(arrowGeometry(tip), basic({})),       // an arrowhead
    new THREE.Mesh(tinted, basic({ vertexColors: true })), // residue's arrowheads (RGBA per piece)
    new THREE.Mesh(plane(), basic({})),                  // a mark with no mask
    new THREE.Mesh(plane(), basic({ alphaMap: tex })),   // a mark
    new THREE.Mesh(plane(), basic({ alphaMap: tex, side: THREE.FrontSide })),   // the ball's contact shadow
    instanced,                                           // residue's marks
    sprite({ alphaMap: tex }), sprite({ map: tex, blending: THREE.AdditiveBlending }),   // a kick's mark; the head
  );
  return {
    group,
    dispose() {
      instanced.dispose();
      disposeTree(group);
      tex.dispose();
    },
  };
}
