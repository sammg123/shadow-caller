// Past plays (A5 part 2; ui-architecture 14.4 `residue`; DESIGN.md "the drive's earlier plays stay as residue"). Two
// jobs, both about plays that are no longer the one on display:
//   residue   the plays before it, faint (look.residue: "none", "drive" = the current drive's, or "game"), no words,
//             merged into one mesh per material so a whole game costs a few draw calls (6.1: residue at most 1 per
//             material); the player hands each play over when the next one draws (addMany).
//   review    Left/Right: one past play replayed from its line of scrimmage with its words and its verdict, while the
//             live plays and the residue step aside (the facade shows that play's own shadows and situation).
//   createResidue(stage) -> { add(drawing, row), addMany(items, { drive }), relabel(rows), review(item | null),
//     reviewDrawing(), clear(), dispose() }
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { verdictOf } from "../model/verdict.js";
import { toWorld } from "./coords.js";
import { disposeTree, keepPrograms } from "./dispose.js";
import { LAYERS } from "./materials.js";
import { arrowGeometry, buildArt, drawingOrNull, fieldLabel, playEnv, removeLabel } from "./play-art.js";
import { createFlight } from "./play-ball.js";
import { createGlyphs } from "./play-glyphs.js";
import { carriersOf, playParts } from "./play-style.js";
import { stripGeometry, stripMaterial, stripMesh } from "./play-strip.js";
import { planDrawing } from "./timing.js";

const MAX_PLAYS = 240;
const UNDER_THE_LINES = 3;     // residue on the turf sorts under the line of scrimmage and the line to gain (5, 6)
const UNDER_THE_PLAY = 0.2;    // residue in the air sorts just under the play on display
const VERDICTS = new Set(["top1", "top3", "miss"]);

/** A kick's flight stays out of residue: a 60-yard punt at 22 yards up would hang over every later snap. */
const kickFlight = (step) => step?.t === "arc" && step.role !== "pass";
const residueOrder = (order) => order - (order < LAYERS.trail.order ? UNDER_THE_LINES : UNDER_THE_PLAY);
const round = (v) => Math.round(v * 1000) / 1000;

// ---------------------------------------------------------------- merging (one mesh per material)
function groupBy(parts, keyOf) {
  return parts.reduce((m, part) => m.set(keyOf(part), [...(m.get(keyOf(part)) ?? []), part]), new Map());
}

/** Strokes merged by shape: each path keeps its own color and opacity (vertex colors), one draw a shape. */
function strips(parts, k) {
  const keyOf = (p) => [p.units, p.width, p.inner, p.dash?.join(":") ?? "", p.order].join("|");
  return [...groupBy(parts.filter((p) => p.type === "stroke"), keyOf).values()].map((list) => {
    const p = list[0];
    const material = stripMaterial({ color: "#ffffff", opacity: k, units: p.units, width: p.width, inner: p.inner,
      dash: p.dash, layer: LAYERS.shadow, vertexColors: true });
    const paths = list.map((q) => ({ ...q.path, color: q.color, alpha: q.opacity }));
    return stripMesh(stripGeometry(paths), material, residueOrder(p.order));
  });
}

/** One arrowhead piece with its color and opacity in an RGBA color attribute (so many merge into one mesh). */
function tinted(part) {
  const g = arrowGeometry(part);
  const c = new THREE.Color(part.color);
  const n = g.getAttribute("position").count;
  g.setAttribute("color", new THREE.Float32BufferAttribute(Array.from({ length: n }, () => [c.r, c.g, c.b,
    part.opacity]).flat(), 4));
  return g;
}

function arrows(parts, k) {
  return [...groupBy(parts.filter((p) => p.type === "arrow"), (p) => p.order).values()].map((list) => {
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: k,
      depthWrite: false, side: THREE.DoubleSide, fog: false, polygonOffset: true,
      polygonOffsetFactor: LAYERS.shadow.factor, polygonOffsetUnits: LAYERS.shadow.units });
    const pieces = list.map(tinted);
    const mesh = new THREE.Mesh(mergeGeometries(pieces), material);
    for (const g of pieces) g.dispose();
    mesh.renderOrder = residueOrder(list[0].order);
    return mesh;
  });
}

function marks(parts, k, glyphs) {
  const turf = parts.filter((p) => p.type === "mark" && !p.billboard);
  const keyOf = (p) => [p.glyph, p.text ?? "", p.layer, round(p.opacity), p.order].join("|");
  const m = new THREE.Matrix4();
  return [...groupBy(turf, keyOf).values()].map((list) => {
    const p = list[0];
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, alphaMap: glyphs.mask(p.glyph, p.layer, p.text),
      transparent: true, opacity: p.opacity * k, depthWrite: false, side: THREE.DoubleSide, fog: false,
      polygonOffset: true, polygonOffsetFactor: LAYERS.shadow.factor, polygonOffsetUnits: LAYERS.shadow.units });
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), material, list.length);
    const aspect = glyphs.aspect(p.glyph);
    list.forEach((q, i) => {
      const at = toWorld(q.at.x, q.at.y, 0);
      mesh.setMatrixAt(i, m.makeScale(q.size * aspect, 1, q.size).setPosition(at.x, at.y, at.z));
      mesh.setColorAt(i, new THREE.Color(q.color));
    });
    mesh.renderOrder = residueOrder(p.order);
    mesh.frustumCulled = false;
    return mesh;
  });
}

// The functions below share one residue context `r` = { stage, glyphs, group, st: { plays, review } }.
/** The player's glyph masks when it is up (one texture per glyph for the engine, uploaded at boot), else our own. */
const glyphsOf = (r) => r.stage.layers?.player?.glyphs ?? r.glyphs;

function rebuild(r) {
  for (const child of [...r.group.children]) {
    if (child.isInstancedMesh) child.dispose();       // its instance buffers; disposeTree frees the rest
    disposeTree(child);
  }
  const parts = r.st.plays.flatMap((play) => play.parts);
  const k = r.stage.look.residue.opacity;
  if (!parts.length || !(k > 0)) return;
  for (const mesh of [...strips(parts, k), ...arrows(parts, k), ...marks(parts, k, glyphsOf(r))]) r.group.add(mesh);
  keepPrograms(r.stage, r.group);       // G7-1: the merged meshes' kinds stay compiled between rebuilds
  r.stage.requestRender();
}

/** Plays handed over, kept per look.residue relative to the drive now in force (`drive`, the newest play's). */
function addMany(r, items, { drive = null } = {}) {
  const keep = r.stage.look.residue.keep;
  if (keep === "none") {
    r.st.plays = [];
    rebuild(r);
    return;
  }
  const env = playEnv(r.stage);
  const sameDrive = (d) => keep !== "drive" || d === drive;
  const fresh = (Array.isArray(items) ? items : []).filter((it) => it?.drawing?.steps?.length && sameDrive(it.row?.drive
    ?? null)).map((it) => ({ seq: it.row?.seq ?? null, drive: it.row?.drive ?? null,
    parts: playParts(it.drawing, it.row, r.stage.look, env).filter((p) => p.type !== "track"
      && !kickFlight(it.drawing.steps[p.step])) }));
  r.st.plays = [...r.st.plays.filter((play) => sameDrive(play.drive)), ...fresh].slice(-MAX_PLAYS);
  rebuild(r);
}

// ---------------------------------------------------------------- review (Left / Right)
/** The reviewed play goes; the resting ball, hidden for the replay, comes back (a new review hides it again). */
function endReview(r) {
  const v = r.st.review;
  if (!v) return;
  r.st.review = null;
  v.label = removeLabel(r.stage, v.label);
  v.art.dispose();
  v.flight?.dispose();
  r.stage.layers?.overlays?.clearVerdict?.("review");
  r.stage.lines.setBallVisible(true);
}

function land(r, v) {
  v.done = true;
  v.art.complete();
  if (!v.flight) r.stage.lines.setBallVisible(true);
  const label = v.item.drawing.label;
  if (!label || !r.stage.look.labels.result) return;
  v.label = fieldLabel(r.stage, label.at, label.text, `sc-play-label${label.approx ? " is-approx" : ""}`);
  const key = verdictOf(v.item.row?.pred).key;
  if (VERDICTS.has(key)) r.stage.layers?.overlays?.verdict?.({ seq: v.item.row.seq, key, label }, { slot: "review" });
}

function review(r, item) {
  endReview(r);
  const on = Boolean(item?.drawing);
  r.group.visible = !on;
  r.stage.lines.setBallVisible(!on);
  if (!on) return;
  const env = playEnv(r.stage);
  const { drawing, row } = item;
  const art = buildArt(playParts(drawing, row, r.stage.look, env), { glyphs: glyphsOf(r) });
  r.stage.roots.plays.add(art.group);
  keepPrograms(r.stage, art.group);
  const plan = planDrawing(drawing, r.stage.look.motion);
  const v = { item, art, plan, t: 0, label: null, flight: null, done: false };
  r.st.review = v;
  if (r.stage.reducedMotion() || !r.stage.visible() || !(plan.totalMs > 0)) {
    land(r, v);
    return;
  }
  v.flight = createFlight(r.stage);
  v.flight.start(drawing, plan, { teams: carriersOf(row ?? {}, drawing), env });
  art.show(plan, 0, drawing);
}

function tick(r, dtMs) {
  const v = r.st.review;
  if (!v || v.done) return false;
  v.t += Math.max(0, dtMs);
  v.art.show(v.plan, Math.min(v.t, v.plan.totalMs), v.item.drawing);
  v.flight?.update(v.t);
  if (v.t < v.plan.totalMs) return true;
  land(r, v);
  return false;
}

function relabel(r, rows) {
  const v = r.st.review;
  const row = v && (Array.isArray(rows) ? rows : []).find((x) => x?.seq === v.item.row?.seq);
  const drawing = row ? drawingOrNull(r.stage, row) : null;
  if (!drawing) return;
  v.item = { row, drawing };
  if (!v.done) return;
  v.label = removeLabel(r.stage, v.label);
  r.stage.layers?.overlays?.clearVerdict?.("review");
  land(r, v);
}

/** The residue layer (scene.js LAYER_FACTORIES). */
export function createResidue(stage) {
  const group = new THREE.Group();
  group.name = "residue";
  stage.roots.residue.add(group);
  const maxAnisotropy = stage.renderer?.capabilities?.getMaxAnisotropy?.() ?? 4;
  const r = { stage, group, glyphs: createGlyphs({ doc: stage.doc ?? null, maxAnisotropy }),
    st: { plays: [], review: null } };
  const stopTick = stage.keepAlive((dt) => tick(r, dt));
  const clear = () => {
    endReview(r);
    r.st.plays = [];
    rebuild(r);
    group.visible = true;
  };
  return {
    add: (drawing, row) => addMany(r, [{ drawing, row }], { drive: row?.drive ?? null }),
    addMany: (items, opts) => addMany(r, items, opts),
    relabel: (rows) => relabel(r, rows),
    review(item) {
      review(r, item);
      stage.requestRender();
    },
    reviewDrawing: () => r.st.review?.item.drawing ?? null,
    count: () => r.st.plays.length,
    clear,
    dispose() {
      clear();
      stopTick?.();
      disposeTree(group);
      r.glyphs.dispose();
    },
  };
}
