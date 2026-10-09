/**
 * Field frame math (data-contract A1 to A5): the only module that converts between spots, the contract's field
 * yards and world or screen space. Pure: no DOM, no three.js, no clock.
 *
 *   x  yards from the caller's own goal line, -10 to 110 (end zones included); the caller attacks toward +x.
 *   y  yards from the near sideline, 0 to 53.333 (the default camera side is y = 0).
 *   h  height above the turf, in yards.
 *
 * Data conversions (x from a yard line or a text spot) return null for missing or malformed input, so a bad server
 * value never becomes a guessed spot. Geometry conversions (world, plane, lateral) throw TypeError on non-numbers,
 * because a NaN there is a bug in the caller.
 */
import { isFiniteNum, requireNum } from "./grammar.js";

const MIDFIELD_X = 50;
const FIELD_YARDS = 100;

export const FIELD = Object.freeze({
  X_MIN: -10,
  X_MAX: 110,
  GOAL_X: Object.freeze([0, 100]),
  POSTS_X: Object.freeze([-10, 110]),
  WIDTH: 53.333,
  CENTER_Y: 26.667,
  HASH_Y: Object.freeze([23.583, 29.75]),
  MIDFIELD_X,
});

const SPOT_RE = /^([A-Z]{2,4})\s*(\d{1,2})$/;
const MIDFIELD_TEXT = "50";
const MAX_SPOT_YARD = 50;

function requireDir(dir) {
  if (dir !== 1 && dir !== -1) throw new TypeError(`dir must be 1 or -1 (got ${String(dir)})`);
  return dir;
}

/** Attack direction of a team: +1 for the caller (left to right), -1 for the opponent (DC A3). */
export function dirOf(team, caller) {
  return team === caller ? 1 : -1;
}

/** The goal line a team attacking in `dir` scores at. */
export function goalX(dir) {
  return requireDir(dir) === 1 ? FIELD.GOAL_X[1] : FIELD.GOAL_X[0];
}

/** The goal line a team attacking in `dir` defends. */
export function ownGoalX(dir) {
  return requireDir(dir) === 1 ? FIELD.GOAL_X[0] : FIELD.GOAL_X[1];
}

/** x of an engine yardline_100 (yards to the goal for `team`): 50 + dir * (50 - yl100). Null when missing. */
export function xFromYardline100(team, yl100, caller) {
  return isFiniteNum(yl100) ? MIDFIELD_X + dirOf(team, caller) * (MIDFIELD_X - yl100) : null;
}

/** yardline_100 of field x for `team`: 50 - dir * (x - 50). Null when missing. */
export function yardline100FromX(team, x, caller) {
  return isFiniteNum(x) ? MIDFIELD_X - dirOf(team, caller) * (x - MIDFIELD_X) : null;
}

/** x of a spot `yl100` yards from the goal line a team attacking in `dir` scores at (no team names needed). */
export function xAtYardline100(yl100, dir) {
  return MIDFIELD_X + requireDir(dir) * (MIDFIELD_X - requireNum(yl100, "yl100"));
}

/**
 * An x span from `fromX + dir * range[0]` to `fromX + dir * range[1]`, clamped to the end lines. A span thinner
 * than `minLen` keeps that length: pulled back from the end line it ran into (marked clamped), else extended
 * along its own direction.
 */
export function depthSpan(fromX, dir, range, minLen = 0) {
  requireDir(dir);
  const near = requireNum(fromX, "fromX") + dir * requireNum(range?.[0], "range[0]");
  const far = fromX + dir * requireNum(range?.[1], "range[1]");
  const sense = Math.sign(far - near) || dir;
  const x0 = clampX(near);
  const x1 = clampX(far);
  const clamped = x0 !== near || x1 !== far;
  if (Math.abs(x1 - x0) >= minLen) return { x0, x1, clamped };
  if (x1 === FIELD.X_MAX || x1 === FIELD.X_MIN) return { x0: x1 - sense * minLen, x1, clamped: true };
  return { x0, x1: clampX(x0 + sense * minLen), clamped };
}

/** x from ESPN's yardLine, which is measured from the home goal line (DC A3). Null when missing. */
export function xFromEspnYardLine(yardLine, callerIsHome) {
  if (!isFiniteNum(yardLine)) return null;
  return callerIsHome ? yardLine : FIELD_YARDS - yardLine;
}

/**
 * x of a text spot such as "TB 3" (97 when DAL is the caller) or "50". `aliases` maps gamebook abbreviations to
 * ESPN ones ({ WAS: "WSH" }). Anything that is not a team and a yard line from 0 to 50 gives null.
 */
export function xFromTextSpot(text, caller, aliases = {}) {
  if (typeof text !== "string") return null;
  const spot = text.trim().toUpperCase();
  if (spot === MIDFIELD_TEXT) return MIDFIELD_X;
  const m = SPOT_RE.exec(spot);
  if (!m) return null;
  const yard = Number(m[2]);
  if (yard > MAX_SPOT_YARD) return null;
  const team = aliases && typeof aliases === "object" && Object.hasOwn(aliases, m[1]) ? aliases[m[1]] : m[1];
  return team === caller ? yard : FIELD_YARDS - yard;
}

/** y of a lateral offset L toward the offense's left: 26.667 + dir * L (DC A4). */
export function yFromLateral(L, dir) {
  return FIELD.CENTER_Y + requireDir(dir) * requireNum(L, "L");
}

/** three.js world position: (x - 50, h, 26.667 - y), 1 unit = 1 yard (DC A5). */
export function toWorld(x, y, h = 0) {
  requireNum(x, "x");
  requireNum(y, "y");
  requireNum(h, "h");
  return { x: x - MIDFIELD_X, y: h, z: FIELD.CENTER_Y - y };
}

/** Field point of a world (x, z) position on the turf. */
export function fromWorld(wx, wz) {
  requireNum(wx, "wx");
  requireNum(wz, "wz");
  return { x: wx + MIDFIELD_X, y: FIELD.CENTER_Y - wz };
}

/** A field-frame direction {x, y, h} as a world direction (no origin shift). */
export function vecToWorld(v) {
  return { x: requireNum(v?.x, "v.x"), y: requireNum(v?.h, "v.h"), z: 0 - requireNum(v?.y, "v.y") };
}

/** 2D fallback: top-down, the caller's end zone on the left, the near sideline at the bottom of `rect`. */
export function toPlane(x, y, rect) {
  requireNum(x, "x");
  requireNum(y, "y");
  const { x: rx, y: ry, w, h } = rect ?? {};
  if (!isFiniteNum(rx) || !isFiniteNum(ry) || !isFiniteNum(w) || !isFiniteNum(h) || w <= 0 || h <= 0) {
    throw new TypeError("rect must have finite x, y and a positive w and h");
  }
  return {
    px: rx + ((x - FIELD.X_MIN) / (FIELD.X_MAX - FIELD.X_MIN)) * w,
    py: ry + h - (y / FIELD.WIDTH) * h,
  };
}

/** x kept between the end lines. */
export function clampX(x) {
  return Math.min(FIELD.X_MAX, Math.max(FIELD.X_MIN, x));
}

/** y kept between the sidelines. */
export function clampY(y) {
  return Math.min(FIELD.WIDTH, Math.max(0, y));
}
