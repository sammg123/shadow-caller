// Under the Lights: the ground around the stadium (G3-2; DESIGN.md "A full-bleed 3D bowl under every pixel", "Night":
// the bowl-haze FogExp2; owner W1). The home-side cameras look over the home stand's back onto whatever lies behind it,
// and the blimp sees all the way round, so the turf plane's bare apron would read as a flat dark slab along the bottom
// of the frame. This lays a plaza from the home stand's back out to the haze: concrete in bowl-haze, lit by the
// concourse near the stands and darker out in the lots (a gradient across each band), paving joints (radial and along
// the rings, a shade lighter than the concrete around them) and a ring of lamp pools, so no row of it is ever one flat
// color, and none of it is a graphic: the joints only catch a little more of the light. Flat-shaded quads in the stands' builder: no draw call of its
// own. Everything lies a hair over the turf plane (GROUND.y), each layer a little higher, so nothing z-fights.
import { linearRgb, mixRgb, params, ringPoint } from "./builder.js";
import { evenlyAlong, homeBackRing } from "./bowl.js";

const TAU = Math.PI * 2;

export const GROUND = Object.freeze({
  segments: 192,
  /** Ring offsets (yards out from the home stand's back): the concourse, the plaza, then the lots out into the haze. */
  rings: Object.freeze([0, 7, 16, 28, 44, 64, 90, 124, 170]),
  /** How far out the plaza reaches: past the foot of every camera's frame (the wide camera's is about 109 yd out). */
  reach: 170,
  /** Heights over the turf plane: the ground, the lamp pools, the ring seams, the radial seams. */
  y: 0.1,
  poolY: 0.18,
  ringSeamY: 0.26,
  spokeY: 0.34,
  /** Radial seams this many yards apart along the concourse's outer edge. */
  spokeYd: 9,
  seamYd: 0.35,
  /** A joint is the concrete around it times this (linear light): a shade lighter, never a line drawn on it (less by
   * day, when the concrete is bright already). */
  seamLift: Object.freeze({ night: 1.22, day: 1.1 }),
  pools: Object.freeze({ offset: 10, every: 13, radius: 4.6, segments: 12 }),
});

/** Tones at each ring offset (the concourse lit, out to the lots in bowl-haze), and the lamp pools' warm middle. */
const TONES = Object.freeze({
  night: Object.freeze({ bands: ["#4b5673", "#47526e", "#434e69", "#3f4a64", "#3b455f", "#36405a", "#323b54",
    "#2e374f", "#2b344b"], pool: "#7d786e" }),
  day: Object.freeze({ bands: ["#7b8291", "#767d8c", "#717887", "#6c7382", "#686f7e", "#646b79", "#606775",
    "#5d6471", "#5a616e"] }),
});

const P = (xz, y) => [xz[0], y, xz[1]];
const UP = Object.freeze({ dir: [0, 1, 0] });
const ring = (o) => {
  const [a, b] = homeBackRing();
  return [a + o, b + o];
};

/** The plaza's bands: one quad per segment and band, lighter toward the stands (each corner its band's tone). */
function addBands(b, ts, colors) {
  const { rings } = GROUND;
  for (let k = 0; k + 1 < rings.length; k += 1) {
    const [inner, outer] = [ring(rings[k]), ring(rings[k + 1])];
    const [ci, co] = [colors.bands[k], colors.bands[k + 1]];
    for (let i = 0; i + 1 < ts.length; i += 1) {
      const p0 = ringPoint(ts[i], ...inner);
      const p1 = ringPoint(ts[i + 1], ...inner);
      const q1 = ringPoint(ts[i + 1], ...outer);
      const q0 = ringPoint(ts[i], ...outer);
      b.quad(P(p0, GROUND.y), P(p1, GROUND.y), P(q1, GROUND.y), P(q0, GROUND.y), [ci, ci, co, co], UP);
    }
  }
}

/** A strip `w` yards wide on the ground from a to c (field-plane points), at height y; `rgb` one color or per corner
 * ([a, c, c, a]). */
function strip(b, a, c, w, y, rgb) {
  const len = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
  const n = [(-(c[1] - a[1]) / len) * (w / 2), ((c[0] - a[0]) / len) * (w / 2)];
  b.quad([a[0] - n[0], y, a[1] - n[1]], [c[0] - n[0], y, c[1] - n[1]], [c[0] + n[0], y, c[1] + n[1]],
    [a[0] + n[0], y, a[1] + n[1]], rgb, UP);
}


/** The joints: radial ones from the concourse's edge out (a piece per band, each a shade over its concrete), and one
 * along each ring past the concourse. */
function addSeams(b, ts, colors) {
  const { rings, spokeYd, seamYd } = GROUND;
  const seams = colors.bands.map((rgb) => rgb.map((c) => c * colors.lift));
  for (const t of evenlyAlong([0, TAU], ring(rings[1]), spokeYd)) {
    for (let k = 1; k + 1 < rings.length; k += 1) {
      const [a, c] = [ringPoint(t, ...ring(rings[k])), ringPoint(t, ...ring(rings[k + 1]))];
      strip(b, a, c, seamYd, GROUND.spokeY, [seams[k], seams[k + 1], seams[k + 1], seams[k]]);
    }
  }
  rings.slice(1, -1).forEach((o, i) => {
    const r = ring(o);
    for (let j = 0; j + 1 < ts.length; j += 1) {
      strip(b, ringPoint(ts[j], ...r), ringPoint(ts[j + 1], ...r), seamYd, GROUND.ringSeamY, seams[i + 1]);
    }
  });
}

/** The concourse's lamp posts' pools of light: a fan, warm in the middle, the ground's own tone at the rim. */
function addPools(b, colors) {
  const { offset, every, radius, segments } = GROUND.pools;
  const r = ring(offset);
  const fine = params(0, TAU, 720);
  const pts = fine.map((t) => ringPoint(t, ...r));
  const rim = mixRgb(colors.bands[1], colors.bands[2], (offset - GROUND.rings[1]) / (GROUND.rings[2] - GROUND.rings[1]));
  let walked = every / 2;
  for (let i = 1; i < pts.length; i += 1) {
    walked += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (walked < every) continue;
    walked = 0;
    const c = pts[i];
    const fan = params(0, TAU, segments).map((a) => [c[0] + radius * Math.cos(a), c[1] + radius * Math.sin(a)]);
    for (let k = 0; k < segments; k += 1) {
      b.tri(P(c, GROUND.poolY), P(fan[k], GROUND.poolY), P(fan[k + 1], GROUND.poolY), [colors.pool, rim, rim], UP);
    }
  }
}

/**
 * The plaza into a builder (the stands' one draw call).
 * @param {ReturnType<import("./builder.js").createBuilder>} b
 * @param {{ day?: boolean }} [opts]
 */
export function addGround(b, { day = false } = {}) {
  const t = TONES[day ? "day" : "night"];
  const colors = { bands: t.bands.map(linearRgb), pool: t.pool ? linearRgb(t.pool) : null,
    lift: GROUND.seamLift[day ? "day" : "night"] };
  const ts = params(0, TAU, GROUND.segments);
  addBands(b, ts, colors);
  addSeams(b, ts, colors);
  if (!day) addPools(b, colors);                       // by day the concourse's lamps are off, as the towers' are
  return b;
}
