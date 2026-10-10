/**
 * How a shadow play looks on the 3D field (docs/design/play-drawing.md 4b, binding; it refines section 4). Pure: no
 * DOM, no three.js; play-art.js builds the meshes.
 *
 * A prediction is a thin dashed line: plays.shadowPx wide (about 2.5 px at the 1440x900 wide camera; `scale` follows
 * the view, shadowScale), short dashes with clear gaps (plays.shadowDash, yards), and a small end mark: a run's
 * arrowhead, a pass's tick across the spot it lands. No filled lane, no thick block, no broad arrow, no landing ring
 * or ellipse. It is colour-coded by rank, never by team (plays.ranks): his #1 in the world's amber, #2 and any other
 * in warm white, a little fainter (shadowOpacity). Hovered, it lights (plays.hoverOpacity). With plays.casing a thin
 * dark ring runs under each part so the dashes hold over white paint. The real play draws solid; this never does.
 */
import { deepFreeze } from "../core/domain.js";
import { isFiniteNum } from "./grammar.js";
import { ORDER, pathOf, resolvePlayLook } from "./play-style.js";

/** The view scale of a shadow's width: the canvas height over 900 px (the 1440x900 reference), kept in this range. */
export const SHADOW_SCALE = deepFreeze({ refHeight: 900, min: 0.8, max: 1.4 });
/** A shadow's end mark draws once its stroke is this far out (play-art revealAll). */
const END_LAG = 0.7;
/** A casing draws this much earlier than the part it rings (render order). */
const CASING_UNDER = 0.05;
const MIN_PATH_YD = 0.05;
/** The arrowhead's wings, 36 degrees off the run's way. */
const WING = Object.freeze({ cos: Math.cos(Math.PI / 5), sin: Math.sin(Math.PI / 5) });

/** How much wider a shadow draws on this canvas than at 1440x900 (SHADOW_SCALE). */
export function shadowScale(height) {
  if (!isFiniteNum(height) || height <= 0) return 1;
  return Math.min(SHADOW_SCALE.max, Math.max(SHADOW_SCALE.min, height / SHADOW_SCALE.refHeight));
}

/** A shadow's line opacity from its strength (shadows.js: 0.5 for #1, 0.35 for #2): plays.shadowBase plus
 * plays.shadowGain times it, at most 1. A thin line needs more ink than a broad one to read on the turf. */
export function shadowOpacity(strength, plays) {
  const k = isFiniteNum(strength) ? strength : 0;
  return Math.min(1, Math.max(0, plays.shadowBase + plays.shadowGain * k));
}

/** A shadow's colour by its rank on the world's ramp (plays.ranks): #1 the first, every other the second. */
export function rankColor(rank, plays) {
  const ranks = plays.ranks;
  return rank === 1 ? ranks[0] : ranks[Math.min(1, ranks.length - 1)];
}

function withCum(points) {
  const cum = points.reduce((acc, p, i) => [...acc, i ? acc[i - 1] + Math.hypot(p.x - points[i - 1].x,
    p.y - points[i - 1].y) : 0], []);
  return { points, cum, length: cum.at(-1) };
}

/** The way a stroke goes on the turf at its end, as a unit vector (its ground track's direction). */
function wayOf(step) {
  const len = Math.hypot(step.to.x - step.from.x, step.to.y - step.from.y) || 1;
  return { x: (step.to.x - step.from.x) / len, y: (step.to.y - step.from.y) / len };
}

/** A small arrowhead at the end of a predicted run: two short wings back from its tip. */
function arrowPath(step, size) {
  const d = wayOf(step);
  const wing = (s) => ({ x: step.to.x - size * (d.x * WING.cos - s * d.y * WING.sin),
    y: step.to.y - size * (d.y * WING.cos + s * d.x * WING.sin), h: 0 });
  return withCum([wing(1), { x: step.to.x, y: step.to.y, h: 0 }, wing(-1)]);
}

/** A tick across the spot a predicted pass lands: a short line on the turf, square to its way. */
function tickPath(step, size) {
  const d = wayOf(step);
  const half = size / 2;
  return withCum([{ x: step.to.x - d.y * half, y: step.to.y + d.x * half, h: 0 },
    { x: step.to.x + d.y * half, y: step.to.y - d.x * half, h: 0 }]);
}

/** The thin dark ring under a part (plays.casing): the same path, dashes and growth, drawn just before it. */
function casingPart(part, casing) {
  return { ...part, layer: "casing", color: casing.color, opacity: casing.opacity, width: part.width * casing.width,
    inner: 1 / casing.width, order: part.order - CASING_UNDER };
}

/**
 * A shadow play's parts (shadows.js ShadowPlay): its stroke (thin, dashed, in its rank's colour, at its own opacity or
 * lit while hovered), then its end mark (an arrowhead on a run, a tick on a pass), drawn once the stroke is out.
 * @param {object} shadow  a ShadowPlay
 * @param {object} look  the resolved Look
 * @param {{ plays?: object }} [env]  playEnv (its plays: resolvePlayLook)
 * @param {{ scale?: number }} [opts]  the view's width scale (shadowScale)
 * @returns {ReadonlyArray<object>} frozen parts, casings first
 */
export function shadowParts(shadow, look, env, { scale = 1 } = {}) {
  const step = shadow?.drawing?.steps?.[0];
  const path = pathOf(step);
  if (!path || path.length < MIN_PATH_YD) return deepFreeze([]);
  const plays = env?.plays ?? resolvePlayLook(look);
  const strength = isFiniteNum(step.opacity) ? step.opacity : shadow.drawing.opacity;
  const own = shadowOpacity(strength, plays);
  const width = plays.shadowPx * (isFiniteNum(scale) && scale > 0 ? scale : 1);
  const common = { step: 0, type: "stroke", layer: "core", units: "px", inner: 0, turf: true, width,
    color: rankColor(shadow.rank, plays), opacity: shadow.hovered ? plays.hoverOpacity : own };
  const stroke = { ...common, path, dash: [...plays.shadowDash], lag: 0,
    order: step.t === "arc" ? ORDER.shadowArc : ORDER.shadowGround };
  const endPath = step.t === "arc" ? tickPath(step, plays.targetYd * 2) : arrowPath(step, plays.targetYd);
  const end = { ...common, path: endPath, dash: null, lag: END_LAG, order: ORDER.shadowGround };
  const parts = plays.targetYd > 0 ? [stroke, end] : [stroke];
  const cased = plays.casing?.color ? parts.map((p) => casingPart(p, plays.casing)) : [];
  return deepFreeze([...cased, ...parts]);
}
