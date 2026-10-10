// The words on the 3D field before a caller snap, placed in screen space (docs/design/play-drawing.md 4b, binding;
// A5 part 2's ghost layer runs it). presnap-layout.js (pure) decides where each plate goes from this view's projection:
// his predictions' plates ("NEXT 1 · Inside run (A/B gap) · 21%") beside their own strokes, the previous play's
// ("LAST · Short pass left · +11", its verdict under it) at its start or along its path, none on the ball, a stroke,
// the field's legend or another plate. This module measures the plates, projects through the camera the rig is
// settling on (so the words never jump while it eases there: each plate keeps its pixel offset from a point on the
// field), and moves each plate there (labels.js place: the offset and a thin leader line when it had to move).
//   placePresnap(g, shadows, last, { avoid }) -> layout | null
//   clarityOf(g, shadows, layout, last) -> what the #field hooks report
import * as THREE from "three";
import { FIELD, toWorld } from "./coords.js";
import { playEnv } from "./play-art.js";
import { LAST_ID, ballBox, nextId, presnapLayout, strokeDots } from "./presnap-layout.js";
import { rankColor } from "./shadow-style.js";
import { insetsFrom } from "./stage-math.js";

const C = FIELD.CENTER_Y;
const SAFE_VARS = Object.freeze({ top: "--sc-field-safe-top", right: "--sc-field-safe-right",
  bottom: "--sc-field-safe-bottom", left: "--sc-field-safe-left" });
/** The field's own boxes the words keep clear of: the legend and the style key on its edge. */
const EDGE_BOXES = Object.freeze([".sc-field-legend", ".sc-field-key"]);
/** Half widths (px) of the strokes the words keep clear of: a prediction's thin line, the previous play's. */
const WIDTHS = Object.freeze({ shadow: 1.5, last: 5 });
/** A plate the page couldn't measure (hidden, not laid out yet) is sized from its words: px a character, a line. */
const ESTIMATE = Object.freeze({ charPx: 7.2, padPx: 30, linePx: 27, subPx: 20 });

const viewOf = (stage) => stage.rig?.viewSize?.() ?? stage.rig?.size?.() ?? null;

/** Field yards to canvas px (y down) through `camera`, or null behind it. */
export function projector(camera, size) {
  const v = new THREE.Vector3();
  return (p) => {
    const w = toWorld(p.x, p.y, p.h ?? 0);
    v.set(w.x, w.y, w.z).project(camera);
    if (v.z > 1 || v.z < -1) return null;
    return { x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height };
  };
}

/** The free area the HUD leaves on the canvas (its --sc-field-safe-* insets), px. */
function boundsOf(stage, size) {
  let insets = insetsFrom(null);
  try {
    const cs = stage.doc?.defaultView?.getComputedStyle?.(stage.host);
    if (cs) insets = insetsFrom(Object.fromEntries(Object.entries(SAFE_VARS).map(([k, v]) => [k, cs.getPropertyValue(v)])));
  } catch {
    // no page style (node): the whole canvas
  }
  return { x0: insets.left, y0: insets.top, x1: size.width - insets.right, y1: size.height - insets.bottom };
}

/** The legend, the style key and any words already up that this layout doesn't place (a reviewed play's words and
 * its chip), in canvas px (the canvas fills the host). */
function edgeBoxes(stage, mine) {
  const host = stage.host;
  const origin = host?.getBoundingClientRect?.();
  if (!origin || typeof host.querySelectorAll !== "function") return [];
  const words = [...host.querySelectorAll(".sc-field-label > span")].filter((el) => !mine.has(el));
  return [...EDGE_BOXES.map((sel) => host.querySelector(sel)).filter(Boolean), ...words]
    .map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0)
    .map((r) => ({ x0: r.left - origin.left, y0: r.top - origin.top, x1: r.right - origin.left, y1: r.bottom - origin.top }));
}

/** A plate's size: as the page lays it out (labels.js size), else estimated from its words (no page: node). */
function plateSize(handle, words) {
  const laid = handle?.size?.();
  if (laid) return laid;
  const chars = [words?.tag, words?.body].filter(Boolean).join(" ").length;
  return { w: chars * ESTIMATE.charPx + ESTIMATE.padPx, h: ESTIMATE.linePx + (words?.sub ? ESTIMATE.subPx : 0) };
}

/**
 * Lay the pre-snap plates out for the view the camera is settling on and move them there: each shadow's plate (its
 * label in the ghost layer's items), and `last` = { handle, drawing, words }, the previous play's plate, or null;
 * `avoid`: other Drawings whose strokes the plates keep off (the play a review replays).
 * @returns {object | null} the layout (presnap-layout.js), kept for the hooks
 */
export function placePresnap(g, shadows, last, { avoid = [] } = {}) {
  const size = viewOf(g.stage);
  const camera = g.goalCamera?.();
  if (!camera || !(size?.width > 1 && size?.height > 1)) return null;
  const handles = new Map(shadows.map((s) => [nextId(s.leaf), g.st.items.get(s.leaf)?.label ?? null]));
  if (last?.handle) handles.set(LAST_ID, last.handle);
  const plates = Object.fromEntries([...shadows.map((s) => [nextId(s.leaf), plateSize(handles.get(nextId(s.leaf)),
    s.label)]), ...(last?.handle ? [[LAST_ID, plateSize(last.handle, last.words)]] : [])]);
  const mine = new Set([...handles.values()].map((h) => h?.element).filter(Boolean));
  const layout = presnapLayout({ shadows, last: last?.handle ? { drawing: last.drawing } : null,
    ball: { x: g.st.input.situation.ballX, y: C }, project: projector(camera, size), plates,
    bounds: boundsOf(g.stage, size), boxes: edgeBoxes(g.stage, mine), widths: WIDTHS, keep: g.st.keep ?? {}, avoid });
  for (const l of layout.labels) {
    const handle = handles.get(l.id);
    handle?.move?.({ x: l.at.x, y: l.at.y, h: l.at.h ?? 0 });
    handle?.place?.({ dx: l.offset.dx, dy: l.offset.dy, leader: l.leader ? { x: l.leader.x2 - l.anchorPx.x,
      y: l.leader.y2 - l.anchorPx.y } : null });
  }
  if (last?.handle?.object) last.handle.object.visible = layout.labels.some((l) => l.id === LAST_ID);
  g.st.keep = Object.fromEntries(layout.labels.map((l) => [l.id, l.choice]));
  return layout;
}

const round = (v) => Math.round(v * 10) / 10;

/** What the field shows now, through the camera as it is (the #field hooks; the e2e clarity test reads them): the
 * ball's footprint, each prediction's stroke in yards and on screen with its colour, the previous play's strokes on
 * screen and its colour, the plates' choices (canvas px). */
export function clarityOf(g, shadows, layout, last = null) {
  const size = viewOf(g.stage);
  const camera = g.stage.cams?.camera;
  if (!camera || !g.st.input || !(size?.width > 1)) return null;
  const project = projector(camera, size);
  const ball = ballBox({ x: g.st.input.situation.ballX, y: C }, project);
  const plays = playEnv(g.stage).plays;
  return {
    ball: ball && { x0: round(ball.x0), y0: round(ball.y0), x1: round(ball.x1), y1: round(ball.y1) },
    shadows: shadows.map((s) => ({ leaf: s.leaf, rank: s.rank, lane: s.lane, hovered: s.hovered,
      stroke: s.drawing.steps[0], color: rankColor(s.rank, plays), dashed: true,
      px: strokeDots(s.drawing.steps, project).map(([x, y]) => [round(x), round(y)]) })),
    last: last?.drawing ? { seq: last.drawing.seq, color: plays.last.core, dashed: false, tag: last.words?.tag ?? null,
      px: strokeDots(last.drawing.steps, project).map(([x, y]) => [round(x), round(y)]) } : null,
    plates: (layout?.labels ?? []).map((l) => ({ id: l.id, kind: l.kind, clear: l.clear, leader: Boolean(l.leader),
      choice: l.choice })),
  };
}
