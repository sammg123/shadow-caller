/**
 * The drawing grammar as named constants (docs/design/play-drawing.md, binding since 2026-10-09; data-contract A4).
 * There is no player tracking, so every lateral spot, arc height and predicted depth here is a drawing convention
 * unless a source is given: it only has to read honestly. Every play starts on the line of scrimmage, so there is
 * no backfield depth (no dropback, handoff mesh or play-action fake). Pure: no DOM, no three.js.
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
/** Targets the row does not pin stay this far inside the end line, so an X or a shadow never sits on the posts. */
export const END_LINE_INSET_YD = 1;

// ---------------------------------------------------------------- labels on the field (play-drawing.md 3 and 4)
/** A play's label sits this far beside the end of the play, outward from the center line the ball rests on. */
export const LABEL_GAP_YD = 5;
/** A shadow's label sits this far underneath the end of its shadow (toward the near sideline). */
export const SHADOW_LABEL_GAP_YD = 4;
/** One line of label text across the field: stacked labels sit this far apart. */
export const LABEL_LINE_YD = 3.5;
/** One character of label text along the field, at the field's own scale: the overlap test's width. */
export const LABEL_CHAR_YD = 0.8;
/** Label centers stay this far inside the sidelines. */
export const LABEL_EDGE_YD = 1;
/** How many yards of depth one yard of height reads as on screen from the cameras that show plays by default
 * (measured: Under the Lights wide 2.0, the neutral sideline 2.3 to 2.4, Under the Lights tight, the snap's cut,
 * about 3): an arc rises up the screen, so text must clear its flight over that whole range. */
export const ARC_SCREEN_LIFTS = deepFreeze([2, 2.4, 3.1]);

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

// ---------------------------------------------------------------- air yards the row does not carry
/** Catch depth when a completion has no air yards (manual screens and RPO throws carry no bucket). */
export const AIR_FALLBACK_YD = deepFreeze({ screen: -2, rpo_throw: 3, other: 3 });
/** An incompletion's target by ESPN's depth word when the row has no air yards: the medians of DC B6.2
 * (nflverse 2026 weeks 1-5, attempts excluding sacks). */
export const AIR_DEPTH_YD = deepFreeze({ short: 5, deep: 23 });
/** No depth word either: the short median, since most incompletions are short (1,049 of 1,510). */
export const AIR_UNKNOWN_YD = AIR_DEPTH_YD.short;

// ---------------------------------------------------------------- shadow plays (play-drawing.md 4, shadows.js)
/** Typical air yards of each pass bucket (the leaves' 0-9, 10-19 and 20+ ranges); play-action uses the same. */
export const SHADOW_AIR_YD = deepFreeze({ short: 6, mid: 14, deep: 25 });
/** A predicted run is a straight line this long downfield ... */
export const SHADOW_RUN_YD = 4;
/** ... ending this far toward the offense's left: inside straight ahead, off-tackle 4 yd wide, outside 9. */
export const SHADOW_RUN_LATERAL = deepFreeze({
  run_inside: 0, run_ot_left: 4, run_edge_left: 9, run_ot_right: -4, run_edge_right: -9, rpo_run: 0,
});
/** A screen: a short arc to the flat, 1 yd behind the line and 10 yd wide, toward the near sideline (ESPN gives
 * no hash, so the ball sits mid-field and neither side is wider; the near side faces the default camera). */
export const SHADOW_SCREEN = deepFreeze({ behindYd: 1, wideYd: 10 });
/** Shadow #1, then #2 and any hovered one: dashed and translucent, never solid. */
export const SHADOW_OPACITY = deepFreeze([0.5, 0.35]);

// ---------------------------------------------------------------- prediction ghosts (deprecated: ghosts.js)
export const MIN_BAND_YD = 2;
export const LABEL_STACK_OFFSET = 6;
/** Two ghost labels closer than this along x (and LABEL_STACK_OFFSET across) would overlap, so the later moves. */
export const LABEL_CLEAR_X = 5;
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

/** Half a label's length along the field (the overlap model: LABEL_CHAR_YD a character); 0 for no text. */
export function labelHalfSpanYd(text) {
  return ((typeof text === "string" ? text.length : 0) * LABEL_CHAR_YD) / 2;
}

/** Arc apex for a stroke role over a horizontal length in yards. */
export function arcApex(role, length) {
  const spec = ownValue(ARC_APEX, role);
  if (!spec) throw new TypeError(`no arc apex for role ${String(role)}`);
  if (typeof length !== "number" || !Number.isFinite(length)) throw new TypeError("arc length must be a finite number");
  const [k, min, max] = spec;
  return Math.min(max, Math.max(min, k * Math.abs(length)));
}
