// Under the Lights: the bowl (DESIGN.md "The bowl"; three-recipe 4.8; owner W1). Tiered stands as dark low-poly
// rounded-rectangle rings: a lower bowl all the way round, behind a padded field wall, and a horseshoe upper deck over
// the far side and both ends (the home side stays one tier, so the broadcast cameras behind it always see over it, as
// a press-box side does). Every opaque part (rows, walls, fascia bodies, parapets with their steel-edge light-catch,
// the home stand's facade: G3-2) goes into one builder, so the stands are one draw call. RINGS also places the LED
// fascia ribbons and the crowd.
import { createBuilder, linearRgb, params, ringPoint } from "./builder.js";

const TAU = Math.PI * 2;

/** The bowl in world yards (y up; x along the field; the home sideline at +z). */
export const RINGS = Object.freeze({
  segments: 192,
  lower: Object.freeze({ a: 78, b: 46, wall: 2.2, rows: 28, homeRows: 10, depth: 0.95, rise: 0.58, parapet: 2.6,
    homeParapet: 1.1 }),
  upper: Object.freeze({ a: 100, b: 68, under: 21, fascia: 3.5, lip: 0.6, rows: 22, depth: 0.95, rise: 0.72,
    rim: 4 }),
  /** The home side's gap in the upper deck: the parameter range around +z (pi / 2) it leaves out. */
  gap: 1.12,
  /** LED fascia ribbons: on the field wall (all round) and on the upper deck's front (the horseshoe). */
  ribbonA: Object.freeze({ y0: 0.72, y1: 1.92, inset: 0.04 }),
  ribbonB: Object.freeze({ y0: 22.05, y1: 23.45, inset: 0.04 }),
});

/** DESIGN.md steel and concrete under the night (vertex colors; the tower spill and the haze do the rest). `rib` and
 * `concourse` are the home stand's facade (G3-2): its steel columns and the lit concourse band behind the seats. */
const TONES = Object.freeze({
  treadA: "#2c3447", treadB: "#30394d", riser: "#1d2331", wall: "#1c2333", fascia: "#20283a",
  parapet: "#3a4560", edge: "#6b7591", back: "#1a2131", cap: "#4a5571", end: "#2a3245",
  rib: "#5b6683", concourse: "#6a6870", gate: "#0e131c",
});
/** By day the same stadium in sunlight: concrete and painted steel, lit by the sun and the sky. */
const DAY_TONES = Object.freeze({
  treadA: "#6f7787", treadB: "#788091", riser: "#4b5262", wall: "#3a4256", fascia: "#4a5266",
  parapet: "#5d6679", edge: "#9aa3b5", back: "#525a6b", cap: "#7d8597", end: "#5a6274",
  rib: "#6a7385", concourse: "#626a7b", gate: "#2e3442",
});

/**
 * G3-2: the home stand's back, where the home-side cameras look over the stand onto it: steel columns proud of the
 * wall every `rib.spacingYd` yards, a lit concourse band across it, dark gates under the band between the columns.
 * Heights and widths in yards.
 */
export const FACADE = Object.freeze({
  rib: Object.freeze({ spacingYd: 7, widthYd: 1.1, proud: 0.32 }),
  band: Object.freeze([3.6, 4.7]),
  bandProud: 0.08,
  gate: Object.freeze({ top: 2.7, widthYd: 3.2, proud: 0.04 }),
});

const lower = RINGS.lower;
const upper = RINGS.upper;

/** Heights the rest of the stadium lines up with. */
export const LEVELS = Object.freeze({
  lowerTop: lower.wall + lower.rows * lower.rise,
  homeTop: lower.wall + lower.homeRows * lower.rise,
  upperFront: upper.under + upper.fascia,
  upperTop: upper.under + upper.fascia + upper.rows * upper.rise,
});

const P = (xz, y) => [xz[0], y, xz[1]];
const UP = Object.freeze({ dir: [0, 1, 0] });
/** Faces the field (toward the stadium's axis at that height) or away from it. */
const inward = (p, y) => ({ point: [0, y, 0] });
const outward = (p, y) => ({ point: [p[0] * 2, y, p[2] * 2] });

/** The parameter ranges each tier covers: the lower bowl all round, the upper deck as a horseshoe. */
export function deckRanges(gap = RINGS.gap) {
  return { lower: [0, TAU], upper: [Math.PI / 2 + gap, Math.PI / 2 + TAU - gap] };
}

function steps(t0, t1) {
  const n = Math.max(8, Math.round((RINGS.segments * (t1 - t0)) / TAU));
  return params(t0, t1, n);
}

/** A vertical band on one ring between heights y0 and y1, facing in or out. */
function band(b, ts, [a, bb], [y0, y1], rgb, face = inward) {
  for (let i = 0; i < ts.length - 1; i += 1) {
    const p = ringPoint(ts[i], a, bb);
    const q = ringPoint(ts[i + 1], a, bb);
    b.quad(P(p, y0), P(q, y0), P(q, y1), P(p, y1), rgb, face(P(p, y0), (y0 + y1) / 2));
  }
}

/** A horizontal band between two rings at height y, facing up (or down for an underside). */
function flat(b, ts, [a0, b0], [a1, b1], y, rgb, toward = UP) {
  for (let i = 0; i < ts.length - 1; i += 1) {
    const p0 = ringPoint(ts[i], a0, b0);
    const q0 = ringPoint(ts[i + 1], a0, b0);
    b.quad(P(p0, y), P(q0, y), P(ringPoint(ts[i + 1], a1, b1), y), P(ringPoint(ts[i], a1, b1), y), rgb, toward);
  }
}

/** Rows of seats: per row a riser (facing the field) and a tread (facing up), treads alternating two tones. */
function rows(b, ts, tier, [startA, startB, startY], tones) {
  for (let r = 0; r < tier.rows; r += 1) {
    const a = startA + r * tier.depth;
    const bb = startB + r * tier.depth;
    const y = startY + r * tier.rise;
    band(b, ts, [a, bb], [y, y + tier.rise], tones.riser);
    flat(b, ts, [a, bb], [a + tier.depth, bb + tier.depth], y + tier.rise, r % 2 ? tones.treadA : tones.treadB);
  }
}

/** A wall across one open end of the horseshoe, from the deck's front ring to its back ring. */
function endCap(b, t, front, back, [yLow, yHigh], rgb, sign) {
  const f = ringPoint(t, front[0], front[1]);
  const k = ringPoint(t, back[0], back[1]);
  const side = { dir: [-Math.sin(t) * sign, 0, Math.cos(t) * sign] };
  b.quad(P(f, yLow), P(k, yLow), P(k, yHigh), P(f, yHigh), rgb, side);
}

/** A tier's back: the parapet on its last row, its steel-edge cap, and the outer wall down to the ground. */
function backOf(b, ts, ring, [top, parapet], tones) {
  const cap = [ring[0] + 0.5, ring[1] + 0.5];
  band(b, ts, ring, [top, top + parapet], tones.parapet);
  flat(b, ts, ring, cap, top + parapet, tones.edge);
  band(b, ts, cap, [0, top + parapet], tones.back, outward);
  return cap;
}

/** The home stand's back (its outer wall, facing away from the field, toward the home-side cameras): [a, b], yards. */
export function homeBackRing() {
  const out = 0.3 + lower.homeRows * lower.depth + 0.5;
  return [lower.a + out, lower.b + out];
}

const EPS_T = 1e-4;
/** Yards along the ring per unit of its parameter at t. */
function speedAt(t, [a, bb]) {
  const p = ringPoint(t, a, bb);
  const q = ringPoint(t + EPS_T, a, bb);
  return Math.hypot(q[0] - p[0], q[1] - p[1]) / EPS_T;
}

/** A panel on an outward wall: [t0, t1] along `ring`, `proud` yards out, from y0 to y1, with its two sides. */
function panel(b, [t0, t1], ring, proud, [y0, y1], rgb, sides = true) {
  const face = [ring[0] + proud, ring[1] + proud];
  const ts = params(t0, t1, 1);
  band(b, ts, face, [y0, y1], rgb, outward);
  if (!sides) return;
  const p0 = ringPoint(t0, face[0], face[1]);
  const p1 = ringPoint(t1, face[0], face[1]);
  const along = [p1[0] - p0[0], 0, p1[1] - p0[1]];
  for (const [t, sign] of [[t0, -1], [t1, 1]]) {
    const w = ringPoint(t, ring[0], ring[1]);
    const f = ringPoint(t, face[0], face[1]);
    b.quad(P(w, y0), P(f, y0), P(f, y1), P(w, y1), rgb, { dir: along.map((v) => v * sign) });
  }
}

const FINE = 720;

/**
 * Parameters `spacing` yards apart along the ring from t0 to t1 (the ring's parameter is far from even in length: a
 * segment in the middle of a long side is many times one at a corner). The ring is walked in FINE steps.
 */
export function evenlyAlong([t0, t1], [a, bb], spacing) {
  const ts = params(t0, t1, FINE);
  const out = [];
  let walked = spacing / 2;
  let prev = ringPoint(ts[0], a, bb);
  for (const t of ts.slice(1)) {
    const p = ringPoint(t, a, bb);
    walked += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
    if (walked >= spacing) {
      out.push(t);
      walked = 0;
    }
  }
  return out;
}

/**
 * G3-2: the home stand's facade on its back wall (`ts` along `ring`, the wall `top` yards high): steel columns proud
 * of it every FACADE.rib.spacingYd yards, the lit concourse band across it, dark gates under the band between them.
 */
function addFacade(b, ts, ring, top, tones) {
  const { rib, band: [y0, y1], bandProud, gate } = FACADE;
  for (let i = 0; i + 1 < ts.length; i += 1) {
    panel(b, [ts[i], ts[i + 1]], ring, bandProud, [y0, y1], tones.concourse, false);
  }
  const cols = evenlyAlong([ts[0], ts.at(-1)], ring, rib.spacingYd);
  for (const t of cols) {
    const half = rib.widthYd / 2 / speedAt(t, ring);
    panel(b, [t - half, t + half], ring, rib.proud, [0, top + 0.2], tones.rib);
  }
  for (let i = 0; i + 1 < cols.length; i += 1) {
    const mid = (cols[i] + cols[i + 1]) / 2;
    const half = gate.widthYd / 2 / speedAt(mid, ring);
    panel(b, [mid - half, mid + half], ring, gate.proud, [0, gate.top], tones.gate, false);
  }
}

/**
 * The lower bowl: the field wall and the first homeRows rows all the way round; on the far side and the ends the rows
 * carry on up to `rows` (the home side stops lower, under the broadcast cameras' sightlines).
 */
function addLower(b, tones) {
  const all = steps(0, TAU);
  const [t0, t1] = deckRanges().upper;
  const far = steps(t0, t1);
  const home = steps(t1 - TAU, t0);
  const start = [lower.a + 0.3, lower.b + 0.3];
  const at = (r) => [start[0] + r * lower.depth, start[1] + r * lower.depth];
  band(b, all, [lower.a, lower.b], [0, lower.wall], tones.wall);
  flat(b, all, [lower.a, lower.b], start, lower.wall, tones.edge);
  rows(b, all, { ...lower, rows: lower.homeRows }, [start[0], start[1], lower.wall], tones);
  const mid = at(lower.homeRows);
  rows(b, far, { ...lower, rows: lower.rows - lower.homeRows }, [mid[0], mid[1], LEVELS.homeTop], tones);
  const homeBack = backOf(b, home, mid, [LEVELS.homeTop, lower.homeParapet], tones);
  addFacade(b, home, homeBack, LEVELS.homeTop + lower.homeParapet, tones);
  backOf(b, far, at(lower.rows), [LEVELS.lowerTop, lower.parapet], tones);
  const outer = [at(lower.rows)[0] + 0.5, at(lower.rows)[1] + 0.5];
  endCap(b, t0, mid, outer, [LEVELS.homeTop, LEVELS.lowerTop + lower.parapet], tones.end, -1);
  endCap(b, t1, mid, outer, [LEVELS.homeTop, LEVELS.lowerTop + lower.parapet], tones.end, 1);
}

function addUpper(b, tones) {
  const [t0, t1] = deckRanges().upper;
  const ts = steps(t0, t1);
  const front = LEVELS.upperFront;
  const top = LEVELS.upperTop;
  const row0 = [upper.a + upper.lip, upper.b + upper.lip];
  const back = [row0[0] + upper.rows * upper.depth, row0[1] + upper.rows * upper.depth];
  const outer = [back[0] + 0.6, back[1] + 0.6];
  band(b, ts, [upper.a, upper.b], [upper.under, front], tones.fascia);
  flat(b, ts, [upper.a, upper.b], row0, front, tones.edge);
  rows(b, ts, upper, [row0[0], row0[1], front], tones);
  band(b, ts, back, [top, top + upper.rim], tones.parapet);
  flat(b, ts, back, outer, top + upper.rim, tones.cap);
  flat(b, ts, [upper.a, upper.b], outer, upper.under, tones.back, { dir: [0, -1, 0] });
  band(b, ts, outer, [upper.under, top + upper.rim], tones.back, outward);
  endCap(b, t0, [upper.a, upper.b], outer, [upper.under, top + upper.rim], tones.end, -1);
  endCap(b, t1, [upper.a, upper.b], outer, [upper.under, top + upper.rim], tones.end, 1);
}

/** The stands into a builder (rows, walls, fascia bodies, parapets, the horseshoe's end walls). */
export function addStands(b, { day = false } = {}) {
  const tones = Object.fromEntries(Object.entries(day ? DAY_TONES : TONES).map(([k, hex]) => [k, linearRgb(hex)]));
  addLower(b, tones);
  addUpper(b, tones);
  return b;
}

/**
 * The stands alone as one geometry.
 * @param {object} THREE  the three.js namespace (props ctx)
 * @returns {THREE.BufferGeometry}
 */
export const standsGeometry = (THREE) => addStands(createBuilder()).build(THREE);

/** Where the crowd sits: one entry per block of rows, with its first ring, rows, depth, rise and parameter range. */
export function seating() {
  const ranges = deckRanges();
  const start = [lower.a + 0.3, lower.b + 0.3];
  const mid = lower.homeRows * lower.depth;
  return [
    { a: start[0], b: start[1], y: lower.wall, rows: lower.homeRows, depth: lower.depth, rise: lower.rise,
      range: ranges.lower },
    { a: start[0] + mid, b: start[1] + mid, y: LEVELS.homeTop, rows: lower.rows - lower.homeRows, depth: lower.depth,
      rise: lower.rise, range: ranges.upper },
    { a: upper.a + upper.lip, b: upper.b + upper.lip, y: LEVELS.upperFront, rows: upper.rows, depth: upper.depth,
      rise: upper.rise, range: ranges.upper },
  ];
}
