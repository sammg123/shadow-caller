/**
 * The regulation field as numbers (three-recipe 4.1, 4.2): dimensions, the numeral layout and its atlas quads,
 * pylons, the end-zone wordmarks and the midfield logo. Pure: world yards in, world yards out. World x = field
 * x - 50 (the caller's goal line at -50), world z = 26.667 - field y (the near sideline at +z), y up (DC A5).
 * The shader draws every painted line; these layouts place the glyphs and the props.
 */
import { deepFreeze } from "../core/domain.js";

export const FT = 1 / 3;
export const IN = 1 / 36;

/** NFL rulebook markings (recipe 4.1). The college port changes hashFromSideline and the numeral row. */
export const NFL = deepFreeze({
  goalX: 50, endLineX: 60, halfWidth: 80 / 3, border: 6 * FT,
  lineWidth: 4 * IN, goalLineWidth: 8 * IN, hashLength: 2 * FT, hashFromSideline: 70.75 * FT,
  numberHeight: 6 * FT, digitWidth: 4 * FT, digitGap: 1.5 * FT, numberBottomFromSideline: 12,
  arrow: { side: 36 * IN, base: 18 * IN, fromTop: 15 * IN, fromEdge: 6 * IN },
  patX: 48, patMarkLength: 3 * FT, restrainingGap: (9 * 12 + 4) * IN, coachLineGap: 6 * FT,
  goalpost: { crossbarHeight: 10 * FT, innerWidth: 18.5 * FT, aboveCrossbar: 35 * FT, ribbon: [4 * IN, 42 * IN],
    baseBehindEndLine: 2 },
  pylon: { size: 4 * IN, height: 18 * IN },
});

/** The numeral atlas: digits 0 to 5 in cells 0 to 5, a solid cell for the arrows (white on opaque black). */
export const ATLAS = deepFreeze({ cells: 8, cellW: 256, cellH: 384, width: 8 * 256, height: 512, whiteCell: 6 });

const NUMERAL_STEP = 10;
const NUMERAL_LAST = 40;
const WORDMARK_WIDTH = 0.92;
const WORDMARK_DEPTH = 0.78;
const MAX_WORDMARK = 24;
const ABBR_RE = /^[A-Z]{2,4}$/;
const NAME_RE = /^[\p{L}\p{N} .'&-]+$/u;

/** z of the inner edge of the hash marks (NFL 3.083: DC hash_y 23.583 and 29.75). */
export function hashInnerZ(L) {
  return L.halfWidth - L.hashFromSideline;
}

function arrowOf(L, x, side, zTop) {
  const goalward = Math.sign(x);
  if (goalward === 0) return null;
  const h = Math.sqrt(L.arrow.side ** 2 - (L.arrow.base / 2) ** 2);
  const baseX = x + goalward * (L.digitGap / 2 + L.digitWidth) + goalward * L.arrow.fromEdge;
  const zBase = side * (zTop - L.arrow.fromTop - L.arrow.base / 2);
  return { tip: [baseX + goalward * h, zBase], a: [baseX, zBase - L.arrow.base / 2], b: [baseX, zBase + L.arrow.base / 2] };
}

/**
 * The 18 numerals, x -40 to 40 every 10 yd: a near row (side 1, tops toward the near sideline, so it reads upside
 * down from the home camera and its tens digit sits at larger x) and a far row (side -1, upright). Arrows point to
 * the nearer goal; the 50 has none.
 */
export function numberLayout(L) {
  const zMid = L.halfWidth - L.numberBottomFromSideline + L.numberHeight / 2;
  const zTop = L.halfWidth - L.numberBottomFromSideline + L.numberHeight;
  const off = L.digitGap / 2 + L.digitWidth / 2;
  const rows = [];
  for (let x = -NUMERAL_LAST; x <= NUMERAL_LAST; x += NUMERAL_STEP) {
    const label = 50 - Math.abs(x);
    for (const side of [1, -1]) {
      const digits = [{ char: String(label / 10), x: x + side * off }, { char: "0", x: x - side * off }];
      rows.push({ x, label, side, z: side * zMid, width: L.digitWidth, height: L.numberHeight, digits,
        arrow: arrowOf(L, x, side, zTop) });
    }
  }
  return deepFreeze(rows);
}

/** Push a triangle so its normal faces +y (counter-clockwise seen from above). */
function upTriangle(positions, a, b, c) {
  const at = (k) => [positions[k * 3], positions[k * 3 + 2]];
  const [pa, pb, pc] = [at(a), at(b), at(c)];
  const ny = (pb[1] - pa[1]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[1] - pa[1]);
  return ny > 0 ? [a, b, c] : [a, c, b];
}

function digitQuad(n, d, out) {
  const vTop = 1;
  const vBot = 1 - ATLAS.cellH / ATLAS.height;
  const zt = n.z + n.side * n.height / 2;
  const zb = n.z - n.side * n.height / 2;
  const u0 = Number(d.char) / ATLAS.cells;
  const u1 = (Number(d.char) + 1) / ATLAS.cells;
  const xAt = (u) => d.x + (u - 0.5) * n.width * -n.side;   // u runs +x on the far row, -x on the near row
  const base = out.positions.length / 3;
  for (const [x, z] of [[xAt(0), zb], [xAt(1), zb], [xAt(1), zt], [xAt(0), zt]]) out.positions.push(x, 0, z);
  out.uvs.push(u0, vBot, u1, vBot, u1, vTop, u0, vTop);
  out.indices.push(...upTriangle(out.positions, base, base + 1, base + 2), ...upTriangle(out.positions, base, base + 2, base + 3));
}

function arrowTri(arrow, out) {
  const base = out.positions.length / 3;
  const u = (ATLAS.whiteCell + 0.5) / ATLAS.cells;
  const v = 1 - ATLAS.cellH / ATLAS.height / 2;
  for (const p of [arrow.a, arrow.b, arrow.tip]) {
    out.positions.push(p[0], 0, p[1]);
    out.uvs.push(u, v);
  }
  out.indices.push(...upTriangle(out.positions, base, base + 1, base + 2));
}

/** One merged mesh's arrays for every numeral and arrow (recipe 4.4): atlas UVs, triangles facing up. */
export function numeralQuads(L) {
  const out = { positions: [], uvs: [], indices: [] };
  for (const n of numberLayout(L)) {
    for (const d of n.digits) digitQuad(n, d, out);
    if (n.arrow) arrowTri(n.arrow, out);
  }
  return out;
}

/** The 8 pylons: both goal lines and both end lines, on each sideline, just outside the field. */
export function pylonLayout(L) {
  const o = L.pylon.size / 2;
  const out = [];
  for (const sx of [1, -1]) {
    for (const x of [L.goalX, L.endLineX]) {
      for (const sz of [1, -1]) out.push([sx * (x + (x === L.goalX ? o : -o)), sz * (L.halfWidth + o)]);
    }
  }
  return deepFreeze(out);
}

/**
 * Where a wordmark lies in an end zone (`side` -1 left, 1 right): its center, size, and the directions its text runs
 * (`right`) and its letters' tops face (`up`, toward the end line), so it reads from the field.
 */
export function wordmarkLayout(L, side) {
  const s = side < 0 ? -1 : 1;
  const depth = L.endLineX - L.goalX;
  return deepFreeze({ center: [s * (L.goalX + depth / 2), 0, 0], width: L.halfWidth * 2 * WORDMARK_WIDTH,
    height: depth * WORDMARK_DEPTH, right: [0, 0, s], up: [s, 0, 0] });
}

/** The end-zone text for a team (look.field.endZoneText): the name in caps, the abbreviation, or nothing. */
export function wordmarkText(team, mode) {
  if (!team || mode === "none") return "";
  const abbr = typeof team.abbr === "string" && ABBR_RE.test(team.abbr) ? team.abbr : "";
  if (mode === "abbr") return abbr;
  const name = typeof team.name === "string" && NAME_RE.test(team.name.trim()) ? team.name.trim().toUpperCase() : "";
  return (name || abbr).slice(0, MAX_WORDMARK);
}

/** The midfield logo: flat at the 50, upright from the home-side camera. */
export function logoLayout(size) {
  return deepFreeze({ center: [0, 0, 0], width: size, height: size, right: [1, 0, 0], up: [0, 0, -1] });
}

/** The team that defends each end zone: the caller on the left (DC A1, A2), from field.left_team / right_team. */
export function endZoneTeams(field, teams) {
  const pick = (abbr) => (typeof abbr === "string" && teams && Object.hasOwn(teams, abbr) ? teams[abbr] : null);
  return { left: pick(field?.left_team), right: pick(field?.right_team) };
}
