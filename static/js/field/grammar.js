/**
 * The shared approximation grammar as named constants (directions.md "Shared approximation grammar",
 * data-contract A4). There is no player tracking, so every lateral spot, backfield depth and arc height here is a
 * drawing convention unless a source is given: it only has to read honestly, and the drawing marks it approximate.
 * Pure: no DOM, no three.js.
 *
 * L is a lateral offset in yards toward the offense's left (coords.yFromLateral turns it into y).
 */
import { LEAVES, deepFreeze, familyOf } from "../core/domain.js";

// ---------------------------------------------------------------- helpers shared by the field modules
/** table[key] only for the table's own string keys, so a server string can never reach the prototype. */
export const ownValue = (table, key) => (typeof key === "string" && Object.hasOwn(table, key) ? table[key] : undefined);

export const isFiniteNum = (v) => typeof v === "number" && Number.isFinite(v);

/** The number itself, or a TypeError naming it: a NaN in geometry is a bug in the caller, never data. */
export function requireNum(value, name) {
  if (!isFiniteNum(value)) throw new TypeError(`${name} must be a finite number (got ${String(value)})`);
  return value;
}

// ---------------------------------------------------------------- lateral (DC A4)
export const LATERAL_GAP = deepFreeze({
  "left end": 8, "left tackle": 4, "left guard": 2, "up the middle": 0,
  "right guard": -2, "right tackle": -4, "right end": -8,
});
export const LATERAL_PASS = deepFreeze({ left: 12, middle: 0, right: -12 });
/** A run side with no gap words (manual rows only know the leaf's side): drawn through the tackle. */
export const LATERAL_RUN_SIDE = deepFreeze({ left: 4, middle: 0, right: -4 });
/** The side thirds of the field as L ranges, 1 yd inside each sideline. */
export const THIRDS = deepFreeze({ left: [8.889, 25.667], middle: [-8.889, 8.889], right: [-25.667, -8.889] });
export const FULL_WIDTH = deepFreeze([-25.667, 25.667]);

// ---------------------------------------------------------------- stroke sizes
export const LANE_HALF_WIDTH = 1.5;
export const CATCH_AREA_RADIUS = 2.5;
export const MIN_BAND_YD = 2;
export const LABEL_STACK_OFFSET = 6;
/** Two labels closer than this along x (and LABEL_STACK_OFFSET across) would overlap, so the later one moves. */
export const LABEL_CLEAR_X = 5;

// ---------------------------------------------------------------- arcs: true in length, generic in height
/** [k, min, max]: apex = clamp(k * horizontal length, min, max). */
export const ARC_APEX = deepFreeze({
  pass: [0.18, 1.5, 10], punt: [0.3, 8, 22], kickoff: [0.28, 8, 22], fg: [0.25, 5, 14],
});
export const CROSSBAR_YD = 3.333;
/** A good field goal crosses the posts' plane this far above the crossbar. */
export const FG_CLEARANCE_YD = 2;
/** Holder depth when a field goal row has no kick spot (both TB at DAL kicks: 8 yd, DC B5). */
export const FG_HOLD_YD = 8;

// ---------------------------------------------------------------- backfield (conventions)
/** Where the QB sets to throw, by alignment: S shotgun (5 yd snap plus a short set), U under center or pistol. */
export const DROP_YD = deepFreeze({ S: 7, U: 6 });
/** Unknown alignment: shotgun, the most common snap. */
export const DROP_DEFAULT_YD = 7;
/** Play-action sets one yard deeper after the fake. */
export const PA_FAKE_YD = 1;
/** Handoff mesh point behind the line, by alignment. */
export const MESH_YD = deepFreeze({ S: 5, U: 4 });
export const MESH_DEFAULT_YD = 4;

// ---------------------------------------------------------------- air yards the row does not carry
/** Catch depth when a completion has no air yards (manual screens and RPO throws carry no bucket). */
export const AIR_FALLBACK_YD = deepFreeze({ screen: -2, rpo_throw: 3, other: 3 });
/** An incompletion with no depth word or bucket: the short and deep IQRs together (nflverse 2026 weeks 1-5). */
export const AIR_UNKNOWN_BAND = deepFreeze([1, 32]);

// ---------------------------------------------------------------- prediction ghosts
/** short, mid and deep are the leaves' air-yard buckets; run length, screen band and the deep cap are conventions. */
export const GHOST_DEPTH = deepFreeze({ run: [0, 5], short: [0, 9], mid: [10, 19], deep: [20, 35], screen: [-3, 3] });
/** Pass leaves carry no side, so their bands span the field. */
export const GHOST_PASS_HALF_SPAN = 25.667;
/** [L, halfWidth] of each run lane. */
export const GHOST_RUN = deepFreeze({
  run_inside: [0, 2], run_ot_left: [4, 2], run_edge_left: [8, 3],
  run_ot_right: [-4, 2], run_edge_right: [-8, 3], rpo_run: [0, 3],
});
/** Family zones: the union of their leaves' shapes. */
export const GHOST_FAMILY = deepFreeze({
  run: { kind: "corridor", depth: [0, 5], L: 0, halfWidth: 11 },
  dropback: { kind: "band", depth: [0, 35] },
  pa: { kind: "band", depth: [0, 35] },
  screen: { kind: "band", depth: [-3, 3] },
  rpo: { kind: "band", depth: [0, 9] },
});

// ---------------------------------------------------------------- leaves (canonical orders: core/domain.js)
const LEAF_BUCKET = deepFreeze({ screen: "screen", rpo_run: "run", rpo_throw: "short" });

const isLeaf = (leaf) => typeof leaf === "string" && LEAVES.includes(leaf);

/** Family key of a leaf ("pa_deep" -> "pa"); null for anything that is not one of the 14 leaves, so no ghost is
 * ever drawn for an unknown key. */
export function familyOfLeaf(leaf) {
  return isLeaf(leaf) ? familyOf(leaf) : null;
}

/** Ghost depth bucket of a leaf: "run", "short", "mid", "deep" or "screen"; null for unknown keys. */
export function bucketOfLeaf(leaf) {
  if (!isLeaf(leaf)) return null;
  const fixed = ownValue(LEAF_BUCKET, leaf);
  if (fixed) return fixed;
  return familyOfLeaf(leaf) === "run" ? "run" : leaf.slice(leaf.indexOf("_") + 1);
}

/** L of a run leaf's lane, or null when the leaf is not a run. */
export function runLateralOfLeaf(leaf) {
  const lane = ownValue(GHOST_RUN, leaf);
  return lane ? lane[0] : null;
}

/** Arc apex for a stroke role over a horizontal length in yards. */
export function arcApex(role, length) {
  const spec = ownValue(ARC_APEX, role);
  if (!spec) throw new TypeError(`no arc apex for role ${String(role)}`);
  if (typeof length !== "number" || !Number.isFinite(length)) throw new TypeError("arc length must be a finite number");
  const [k, min, max] = spec;
  return Math.min(max, Math.max(min, k * Math.abs(length)));
}

/** Yards behind the line where the QB throws from, from the row's call (align, family). */
export function dropDepthYd(call) {
  const base = ownValue(DROP_YD, call?.align) ?? DROP_DEFAULT_YD;
  return call?.family === "pa" ? base + PA_FAKE_YD : base;
}

/** Yards behind the line where a run is handed off. */
export function meshDepthYd(align) {
  return ownValue(MESH_YD, align) ?? MESH_DEFAULT_YD;
}
