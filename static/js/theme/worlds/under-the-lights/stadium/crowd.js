// Under the Lights: the crowd (DESIGN.md "The bowl": a seeded crowd of points tinted by both teams at 25 to 60%
// brightness; three-recipe 4.8; owner W1). One Points draw call on the seating rows of both tiers, the home team's
// colors the majority, the visitors a block of their own, everyone else in street colors; seeded, so every render of
// the same game is the same crowd. Unlit points (their brightness is set here), so the light dip dims them through
// the material's color.
import { safeHex } from "../../../../core/domain.js";
import { mulberry32 } from "../../../../field/fallback-bowl.js";
import { linearRgb, ringPoint } from "./builder.js";
import { seating } from "./bowl.js";
import { bowlHaze } from "./haze.js";

const TAU = Math.PI * 2;
const DAY_GAIN = 1.45;

export const CROWD = Object.freeze({ count: 56000, size: 1.0, fill: 0.86, headYd: 0.55, seed: 0x5c0b7e,
  shade: Object.freeze([0.4, 0.78]), face: 0.38 });
const STREET = Object.freeze(["#8d96a3", "#2a2e36", "#4a5568", "#33475f", "#6b5a48", "#c9ced6", "#3c3f46", "#5d3a32"]);
/** Each fan is a shirt and a face: a share of skin tone lifts navy shirts and mutes white ones, as a lit crowd reads. */
const SKIN = Object.freeze(["#c68e6a", "#8d5a3c", "#e0b394", "#5c3a28", "#a8714f"]);
const FALLBACK_TEAM = Object.freeze({ color: "#4a5571", alt_color: "#b9ad92" });
/** Shares of the seats: home fans, visiting fans (they sit together, in one end), the rest. */
const SHARE = Object.freeze({ home: 0.56, away: 0.18 });
const AWAY_END = Object.freeze([-0.55, 0.55]);       // visitors fill the right-hand end (x > 0), around t = 0

function teamTones(team) {
  const t = team ?? FALLBACK_TEAM;
  const primary = safeHex(t.color) ?? FALLBACK_TEAM.color;
  return [primary, primary, safeHex(t.alt_color) ?? FALLBACK_TEAM.alt_color, "#e8ebef"];
}

const ARC_SAMPLES = 720;

/** The ring's parameter at evenly spaced arc lengths over [t0, t1], so seats are spread evenly along the bowl. */
function arcTable(tier) {
  const [t0, t1] = tier.range;
  const ts = Array.from({ length: ARC_SAMPLES + 1 }, (_, i) => t0 + ((t1 - t0) * i) / ARC_SAMPLES);
  const pts = ts.map((t) => ringPoint(t, tier.a, tier.b));
  const cum = pts.reduce((acc, p, i) => [...acc, i ? acc[i - 1] + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0],
    []);
  return { ts, cum, length: cum[ARC_SAMPLES] };
}

/** The parameter at a share `u` of the ring's length (linear between samples). */
function tAt(table, u) {
  const target = u * table.length;
  let lo = 0;
  let hi = ARC_SAMPLES;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (table.cum[mid] < target) lo = mid;
    else hi = mid;
  }
  const span = table.cum[hi] - table.cum[lo] || 1;
  return table.ts[lo] + ((table.ts[hi] - table.ts[lo]) * (target - table.cum[lo])) / span;
}

/** Pick a block of rows by its seat count, a row, and a spot along it; visitors only in their end. */
function seatOf(tiers, rnd, away) {
  const total = tiers.reduce((s, t) => s + t.weight, 0);
  let k = rnd() * total;
  const tier = tiers.find((t) => (k -= t.weight) < 0) ?? tiers[0];
  let t = away ? AWAY_END[0] + rnd() * (AWAY_END[1] - AWAY_END[0]) : tAt(tier.table, rnd());
  if (t < tier.range[0]) t += TAU;
  if (t > tier.range[1]) t -= TAU;
  const r = Math.floor(rnd() * tier.rows);
  const off = (r + 0.5 + (rnd() - 0.5) * 0.5) * tier.depth;
  const p = ringPoint(t, tier.a + off, tier.b + off);
  return [p[0], tier.y + (r + 1) * tier.rise + CROWD.headYd * (0.85 + rnd() * 0.3), p[1]];
}

function colorOf(rnd, palettes) {
  const k = rnd();
  const list = k < SHARE.home ? palettes.home : k < SHARE.home + SHARE.away ? palettes.away : palettes.street;
  const shirt = list[Math.floor(rnd() * list.length)];
  const skin = palettes.skin[Math.floor(rnd() * palettes.skin.length)];
  const shade = CROWD.shade[0] + rnd() * (CROWD.shade[1] - CROWD.shade[0]);
  const c = (i) => (shirt[i] + (skin[i] - shirt[i]) * CROWD.face) * shade;
  return [c(0), c(1), c(2), k >= SHARE.home && k < SHARE.home + SHARE.away];
}

/**
 * The crowd's positions and colors (Float32Arrays), seeded by the teams so a game always draws the same crowd.
 * @param {{ home?: object, away?: object }} teams  DC C2 team records (color, alt_color), either may be missing
 */
export function crowdArrays({ home = null, away = null } = {}, { count = CROWD.count, seed = CROWD.seed } = {}) {
  const rnd = mulberry32(seed);
  const tiers = seating().map((t) => {
    const table = arcTable(t);
    return { ...t, table, weight: t.rows * table.length };
  });
  const palettes = { home: teamTones(home).map(linearRgb), away: teamTones(away).map(linearRgb),
    street: STREET.map(linearRgb), skin: SKIN.map(linearRgb) };
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  let n = 0;
  for (let i = 0; i < count; i += 1) {
    if (rnd() > CROWD.fill) continue;
    const [r, g, b, isAway] = colorOf(rnd, palettes);
    pos.set(seatOf(tiers, rnd, isAway), n * 3);
    col.set([r, g, b], n * 3);
    n += 1;
  }
  return { positions: pos.subarray(0, n * 3), colors: col.subarray(0, n * 3), count: n };
}

/** The crowd as one Points object (the bowl's haze, unlit, dimmed through material.color; brighter in the sun). */
export function createCrowd(THREE, teams, { day = false } = {}) {
  const { positions, colors } = crowdArrays(teams);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  g.computeBoundingSphere();
  const material = bowlHaze(new THREE.PointsMaterial({ size: CROWD.size, sizeAttenuation: true, vertexColors: true }));
  material.color.setScalar(day ? DAY_GAIN : 1);
  material.userData.base = day ? DAY_GAIN : 1;
  const points = new THREE.Points(g, material);
  points.name = "uls-crowd";
  return points;
}
