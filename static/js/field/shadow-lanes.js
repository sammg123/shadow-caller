/**
 * His predicted plays never share a lane (docs/design/play-drawing.md 4b, binding; it refines section 4). Pure: no
 * DOM, no three.js. shadows.js draws each shadow from the stroke this module gives it.
 *
 * Each prediction keeps section 4's shape language (a pass an arc to its bucket's air yards, a run a straight line on
 * the turf angled to its gap, the screen a short arc to the near flat), but every stroke starts SHADOW_START_YD past
 * the ball, never on it. When two of them come within FAN_TRIGGER_YD of each other (a short pass and an inside run, an
 * inside and an outside run, two short passes), they fan out to lateral lanes FAN_GAP_YD apart. The lanes are in field
 * y, the default cameras' "up the screen": passes take the far lanes, so an arc rises away from a run on the turf
 * instead of over it; of two passes the deeper (taller) flies the far lane; of two runs, the one that ends farther
 * toward the far sideline. A play the prediction panel hovers outside his top plays goes outside them, on its own side,
 * so hovering never moves his top plays.
 *
 * The previous play is never under them either (4b: "on top of the previous play"): where its stroke lies in their way,
 * on or low over the turf ahead of the ball (a short incomplete pass, a loss, a penalty walked back; not a gain, which
 * ends at the ball, nor a deep ball or a kick high overhead), and comes within FAN_TRIGGER_YD of one of them, they
 * take the lanes nearest the ball that keep FAN_GAP_YD from it as well as from each other, in the same order.
 *
 * A stroke is a paths.js step without its flags: { t: "arc" | "ground", role, from, to, apex?, endH? } in field yards.
 */
import { FIELD, clampY, yFromLateral } from "./coords.js";
import {
  END_LINE_INSET_YD, SHADOW_AIR_YD, SHADOW_RUN_LATERAL, SHADOW_RUN_YD, SHADOW_SCREEN, arcApex, bucketOfLeaf,
  isFiniteNum, ownValue,
} from "./grammar.js";
import { sampleArc } from "./timing.js";

/** Every prediction stroke starts this far past the ball (play-drawing.md 4b: "about 1.5 yards"). */
export const SHADOW_START_YD = 1.5;
/** Two natural strokes closer than this (yards, on the turf) fan out (4b: "within about 3 yards"). */
export const FAN_TRIGGER_YD = 3;
/** Fanned lanes sit this far apart (4b: "at least about 4 yards apart"). */
export const FAN_GAP_YD = 4;

/** A real play's stroke is in their way where it is past this far ahead of the ball (yards; a gain ends at the ball,
 * behind their starts), when it runs on the turf or never rises above WAY_LOW_YD: a short or intermediate throw is
 * in the way all along; a deep ball or a kick flies high over them, and only crosses one of them, steeply, near its
 * ends. */
export const WAY_AHEAD_YD = 0.5;
export const WAY_LOW_YD = 3;

const C = FIELD.CENTER_Y;
/** A pass sorts past every run when lanes are dealt (yards of key; runs end within 11 yards of the center line). */
const PASS_KEY = 100;
const EPS = 1e-9;
/** Gaps are compared this loosely (yards): a lane shift of exactly FAN_GAP_YD holds in floating point. */
const GAP_EPS = 1e-6;
/** A real play's stroke is sampled this often (yards) to find where it is in their way. */
const WAY_STEP_YD = 0.5;
/** The lanes tried to clear the previous play: every LANE_STEP_YD out to MAX_SPREAD_YD either side of the ball. */
const LANE_STEP_YD = 0.5;
/** The rows of hash marks (yards of field y): the 3D field paints each mark 2 ft outward from FIELD.HASH_Y, the 2D
 * field centers it there. A straight run moved to clear the previous play keeps HASH_CLEAR_YD off both, so its dashes
 * never run along the ticks. */
const HASH_TICK_YD = 2 / 3;
const HASH_ROWS = Object.freeze([[FIELD.HASH_Y[0] - HASH_TICK_YD, FIELD.HASH_Y[0] + HASH_TICK_YD / 2],
  [FIELD.HASH_Y[1] - HASH_TICK_YD / 2, FIELD.HASH_Y[1] + HASH_TICK_YD]]);
const HASH_CLEAR_YD = 0.7;
/** Two runs angled the same way can close in on each other: their lanes then spread in these steps until FAN_GAP_YD
 * holds everywhere (an outside run beside an off-tackle run needs 5 yd). */
const SPREAD_STEP_YD = 0.5;
const MAX_SPREAD_YD = 3 * FAN_GAP_YD;

const insideX = (x) => Math.min(FIELD.X_MAX - END_LINE_INSET_YD, Math.max(FIELD.X_MIN + END_LINE_INSET_YD, x));
const isPass = (stroke) => stroke.t === "arc" && stroke.role === "pass";

/** `from` moved `yd` toward `to` (the whole way when the stroke is shorter). */
function along(from, to, yd) {
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  const k = len > EPS ? Math.min(1, yd / len) : 0;
  return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
}

/**
 * A play's stroke before any fanning: from SHADOW_START_YD past the ball (along the play's own way for the screen)
 * to its end. A run is a line SHADOW_RUN_YD long angled to its gap; a pass lands at its bucket's typical air yards
 * from the line of scrimmage (kept 1 yd inside the end line); the screen lands 1 yd behind the line and 10 yd toward
 * the near sideline.
 * @returns {{ t: string, role: string, from: object, to: object, apex?: number, endH?: number }}
 */
export function naturalStroke(leaf, ballX, dir) {
  const start = { x: insideX(ballX + dir * SHADOW_START_YD), y: C };
  const lateral = ownValue(SHADOW_RUN_LATERAL, leaf);
  if (lateral !== undefined) {
    const to = { x: insideX(start.x + dir * SHADOW_RUN_YD), y: clampY(yFromLateral(lateral, dir)) };
    return { t: "ground", role: "run", from: start, to };
  }
  const to = leaf === "screen"
    ? { x: insideX(ballX - dir * SHADOW_SCREEN.behindYd), y: clampY(C - SHADOW_SCREEN.wideYd) }
    : { x: insideX(ballX + dir * (ownValue(SHADOW_AIR_YD, bucketOfLeaf(leaf)) ?? SHADOW_AIR_YD.short)), y: C };
  const from = leaf === "screen" ? along({ x: ballX, y: C }, to, SHADOW_START_YD) : start;
  return { t: "arc", role: "pass", from, to, apex: arcApex("pass", Math.hypot(to.x - from.x, to.y - from.y)), endH: 0 };
}

/** Where a stroke belongs across the field, low to high = near to far: passes past runs (the deeper the farther),
 * everything else by where it ends (a run's gap, the screen's near flat). */
export function laneKey(stroke) {
  if (isPass(stroke) && stroke.to.y === C) return PASS_KEY + Math.abs(stroke.to.x - stroke.from.x);
  return stroke.to.y - C;
}

// ---------------------------------------------------------------- distance on the turf
const dot = (a, b) => a.x * b.x + a.y * b.y;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });

/** The distance from point p to segment ab. */
function pointToSegment(p, a, b) {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  const k = len2 > EPS ? Math.min(1, Math.max(0, dot(sub(p, a), ab) / len2)) : 0;
  return Math.hypot(p.x - (a.x + ab.x * k), p.y - (a.y + ab.y * k));
}

const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Two segments cross (strictly, or touch at a point). */
function intersects(a, b, c, d) {
  const [d1, d2, d3, d4] = [cross(c, d, a), cross(c, d, b), cross(a, b, c), cross(a, b, d)];
  return ((d1 > 0) !== (d2 > 0) || Math.abs(d1) < EPS || Math.abs(d2) < EPS)
    && ((d3 > 0) !== (d4 > 0) || Math.abs(d3) < EPS || Math.abs(d4) < EPS);
}

/**
 * The least distance (yards, on the turf) between two strokes: an arc's footprint is its ground track, a straight
 * segment, so this is exact. 0 when they cross.
 */
export function strokeGap(a, b) {
  if (intersects(a.from, a.to, b.from, b.to)) return 0;
  return Math.min(pointToSegment(a.from, b.from, b.to), pointToSegment(a.to, b.from, b.to),
    pointToSegment(b.from, a.from, a.to), pointToSegment(b.to, a.from, a.to));
}

/** The least gap between any two of the strokes (Infinity for fewer than two). */
export function closestGap(strokes) {
  return strokes.reduce((min, s, i) => strokes.slice(i + 1).reduce((m, o) => Math.min(m, strokeGap(s, o)), min),
    Infinity);
}

// ---------------------------------------------------------------- the previous play in their way
const isPt = (p) => isFiniteNum(p?.x) && isFiniteNum(p?.y);

/** A stroke step's points ({ x, y, h }, yards) every WAY_STEP_YD along it; [] for a mark or a bad step. */
function stepPoints(step) {
  if ((step?.t !== "arc" && step?.t !== "ground") || !isPt(step.from) || !isPt(step.to)) return [];
  const n = Math.max(1, Math.ceil(Math.hypot(step.to.x - step.from.x, step.to.y - step.from.y) / WAY_STEP_YD));
  const apex = isFiniteNum(step.apex) ? step.apex : 0;
  const endH = isFiniteNum(step.endH) ? step.endH : 0;
  return Array.from({ length: n + 1 }, (_, i) => (step.t === "arc" ? sampleArc(step.from, step.to, apex, endH, i / n)
    : { x: step.from.x + ((step.to.x - step.from.x) * i) / n, y: step.from.y + ((step.to.y - step.from.y) * i) / n,
      h: 0 }));
}

/** A stroke that stays low enough to lie in their way: on the turf, or an arc no higher than WAY_LOW_YD anywhere. */
const isLow = (step) => step?.t === "ground" || (step?.t === "arc"
  && (isFiniteNum(step.apex) ? step.apex : 0) + Math.max(0, isFiniteNum(step.endH) ? step.endH : 0) <= WAY_LOW_YD + EPS);

/**
 * Where real plays' strokes (paths.js steps: the previous play's) lie in his predictions' way: the points of those
 * that stay low (isLow), past WAY_AHEAD_YD ahead of the ball.
 * @returns {Array<{ x: number, y: number, h: number }>} field yards
 */
export function inTheWay(steps, snap) {
  return (Array.isArray(steps) ? steps : []).filter(isLow).flatMap(stepPoints)
    .filter((p) => snap.dir * (p.x - snap.ballX) >= WAY_AHEAD_YD - EPS);
}

/** The least distance (yards, on the turf) from a stroke to any of `points` (Infinity for none). */
export function wayGap(stroke, points) {
  return points.reduce((min, p) => Math.min(min, pointToSegment(p, stroke.from, stroke.to)), Infinity);
}

// ---------------------------------------------------------------- lanes
const shift = (stroke, lane) => ({ ...stroke, from: { x: stroke.from.x, y: clampY(stroke.from.y + lane) },
  to: { x: stroke.to.x, y: clampY(stroke.to.y + lane) } });

/** His top plays' lanes: centered on the ball, `spread` apart, nearest first by key (ties keep rank order). */
function topLanes(keys, top, spread) {
  const order = [...top].sort((i, j) => keys[i] - keys[j] || i - j);
  const mid = (order.length - 1) / 2;
  return new Map(order.map((i, k) => [i, (k - mid) * spread]));
}

/** A hovered extra outside them: past the far lane when it sorts past all of them, else under the near one. */
function extraLane(key, keys, top, lanes, spread) {
  const own = top.map((i) => lanes.get(i));
  const high = top.every((i) => key >= keys[i]);
  return high ? Math.max(...own) + spread : Math.min(...own) - spread;
}

const topOf = (picks) => picks.map((p, i) => (p.extra ? -1 : i)).filter((i) => i >= 0);

/** Every stroke in its lane: his top plays' from `lanes`, a hovered extra outside them (`spread` on). */
function laid(natural, keys, top, lanes, spread) {
  return natural.map((stroke, i) => {
    const lane = lanes.get(i) ?? extraLane(keys[i], keys, top, lanes, spread);
    return { stroke: isFiniteNum(lane) && lane !== 0 ? shift(stroke, lane) : stroke, lane: lane || 0 };
  });
}

/** Every stroke moved to its lane, the lanes `spread` apart. */
function fanned(natural, picks, keys, spread) {
  const top = topOf(picks);
  return laid(natural, keys, top, topLanes(keys, top.length ? top : [0], spread), spread);
}

/** The default fan: lanes FAN_GAP_YD apart, or as much more as keeps two angled runs so everywhere. */
function spreadLanes(natural, picks, keys) {
  let out = fanned(natural, picks, keys, FAN_GAP_YD);
  for (let spread = FAN_GAP_YD + SPREAD_STEP_YD; spread <= MAX_SPREAD_YD; spread += SPREAD_STEP_YD) {
    if (closestGap(out.map((s) => s.stroke)) >= FAN_GAP_YD - GAP_EPS) break;
    out = fanned(natural, picks, keys, spread);
  }
  return out;
}

const LANES = Object.freeze(Array.from({ length: (2 * MAX_SPREAD_YD) / LANE_STEP_YD + 1 },
  (_, i) => -MAX_SPREAD_YD + i * LANE_STEP_YD));

/** The best lanes for `order` (his top plays, nearest lane first) from each one's `options` ({ lane, stroke } clear
 * of the way): rising lanes, FAN_GAP_YD apart on the turf, least sum of squares (nearest the ball). Null for none. */
function bestLanes(options, k = 0, chosen = [], best = null) {
  if (k === options.length) {
    const cost = chosen.reduce((sum, o) => sum + o.lane * o.lane, 0);
    return !best || cost < best.cost ? { cost, chosen } : best;
  }
  let out = best;
  for (const o of options[k]) {
    const ok = chosen.every((c) => o.lane > c.lane && strokeGap(o.stroke, c.stroke) >= FAN_GAP_YD - GAP_EPS);
    if (ok) out = bestLanes(options, k + 1, [...chosen, o], out);
  }
  return out;
}

/** A straight run along a row of hash marks (within HASH_CLEAR_YD of its ticks). */
const alongHash = (stroke) => stroke.t === "ground" && Math.abs(stroke.from.y - stroke.to.y) < GAP_EPS
  && HASH_ROWS.some(([lo, hi]) => stroke.from.y > lo - HASH_CLEAR_YD + GAP_EPS
    && stroke.from.y < hi + HASH_CLEAR_YD - GAP_EPS);

/** His top plays' lanes clear of `way` (the previous play's points in it) and of each other, in lane order (passes
 * far), a straight run off the hash marks where it can be; a hovered extra goes outside them. Null when none do. */
function clearOfWay(natural, picks, keys, way) {
  const top = topOf(picks);
  if (!top.length) return null;
  const order = [...top].sort((i, j) => keys[i] - keys[j] || i - j);
  const options = (offHash) => order.map((i) => LANES.map((lane) => ({ lane, stroke: shift(natural[i], lane) }))
    .filter((o) => wayGap(o.stroke, way) >= FAN_GAP_YD - GAP_EPS && !(offHash && alongHash(o.stroke))));
  const best = bestLanes(options(true)) ?? bestLanes(options(false));
  if (!best) return null;
  return laid(natural, keys, top, new Map(order.map((i, k) => [i, best.chosen[k].lane])), FAN_GAP_YD);
}

/**
 * The strokes for the plays shown before a snap, in the order given: each natural (naturalStroke), unless two come
 * within FAN_TRIGGER_YD of each other; then every one moves to its lane (`lane`: yards of field y, 0 for none), the
 * lanes FAN_GAP_YD apart or, where two angled runs would close in on each other, as much more as keeps them so. When
 * `avoid` (the previous play's strokes) lies in the way of one of them (inTheWay, within FAN_TRIGGER_YD), his top plays
 * take the lanes nearest the ball that keep FAN_GAP_YD from it too.
 * @param {ReadonlyArray<{ leaf: string, extra?: boolean }>} picks  his top plays, then any hovered play outside them
 * @param {{ ballX: number, dir: 1 | -1 }} snap
 * @param {{ avoid?: ReadonlyArray<object> }} [opts]  paths.js steps of real plays on the field
 * @returns {Array<{ stroke: object, lane: number }>}
 */
export function laneStrokes(picks, snap, { avoid = [] } = {}) {
  const natural = picks.map((p) => naturalStroke(p.leaf, snap.ballX, snap.dir));
  const way = inTheWay(avoid, snap);
  const blocked = (out) => out.some(({ stroke }) => wayGap(stroke, way) < FAN_TRIGGER_YD - GAP_EPS);
  const plain = natural.map((stroke) => ({ stroke, lane: 0 }));
  const clash = closestGap(natural) < FAN_TRIGGER_YD;
  if (!clash && !blocked(plain)) return plain;
  const keys = natural.map(laneKey);
  const fan = clash ? spreadLanes(natural, picks, keys) : plain;
  return blocked(fan) ? (clearOfWay(natural, picks, keys, way) ?? fan) : fan;
}
