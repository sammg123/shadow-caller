/**
 * The pixel vocabulary of the 2D field (ui-architecture.md 6.2, owner A6): the 1-yard turf grid a "pixel" look
 * lights (DESIGN.md "The turf grid": a 0.8 yd lit square with a 0.2 yd dark gap), and the 9 by 9 glyphs every mark
 * is drawn with (a pixel look draws them with the gap, any other look solid). The coarse grid is the honesty: a
 * lit cell says "somewhere in here", never a route. Pure: no DOM, no clock.
 *
 * A cell { i, j } covers field x [i, i + 1) and y [j, j + 1) (DC A: x from the caller's goal line, y from the near
 * sideline); it is lit when its center (i + 0.5, j + 0.5) falls inside the shape. A glyph cell { c, r } is column c
 * and row r of a 9 by 9 bitmap, row 0 at the top of the screen.
 */
import { deepFreeze } from "../core/domain.js";
import { FIELD } from "./coords.js";
import { isFiniteNum, ownValue } from "./grammar.js";

export const CELL_LIT = 0.8;
export const GLYPH_SIZE = 9;
const HALF = 0.5;
const EPS = 1e-9;
const ROWS = Math.floor(FIELD.WIDTH);              // 53 whole cells across: centers 0.5 to 52.5
const DIGITS = 100;

/** 9 by 9 bitmaps ("#" lit). Results, verdicts and kick marks; every one reads at 18 px. */
export const GLYPHS = deepFreeze({
  x: ["##.....##", "###...###", ".###.###.", "..#####..", "...###...", "..#####..", ".###.###.", "###...###",
    "##.....##"],
  check: ["........#", ".......##", "......###", "##...###.", "###.###..", ".#####...", "..###....", "...#.....",
    "........."],
  flag: ["##.......", "########.", "#########", "#########", "########.", "##.......", "##.......", "##.......",
    "##......."],
  burst: ["#...#...#", ".#..#..#.", "..#.#.#..", "...###...", "#########", "...###...", "..#.#.#..", ".#..#..#.",
    "#...#...#"],
  td: ["####.###.", "####.####", ".##..##.#", ".##..##.#", ".##..##.#", ".##..##.#", ".##..####", ".##..###.",
    "........."],
  ring: ["..#####..", ".##...##.", "##.....##", "#.......#", "#.......#", "#.......#", "##.....##", ".##...##.",
    "..#####.."],
  diamond: ["....#....", "...###...", "..#####..", ".#######.", "#########", ".#######.", "..#####..", "...###...",
    "....#...."],
  square: [".........", ".#######.", ".#######.", ".#######.", ".#######.", ".#######.", ".#######.", ".#######.",
    "........."],
  arrow: ["...###...", "...###...", "...###...", "...###...", "#########", ".#######.", "..#####..", "...###...",
    "....#...."],
  bar: [".........", ".........", ".........", "#########", "#########", "#########", ".........", ".........",
    "........."],
  three: [".#######.", "########.", "......##.", "..#####..", "..######.", "......##.", "......##.", "########.",
    ".######.."],
});

const r2 = (v) => Math.round(v * DIGITS) / DIGITS;

export const cellKey = ({ i, j }) => `${i},${j}`;

function span(a, b, lo, hi) {
  const from = Math.max(lo, Math.ceil(Math.min(a, b) - HALF - EPS));
  const to = Math.min(hi, Math.floor(Math.max(a, b) - HALF + EPS));
  return { from, to };
}

function cellAt(x, y) {
  const i = Math.min(FIELD.X_MAX - 1, Math.max(FIELD.X_MIN, Math.floor(x)));
  const j = Math.min(ROWS - 1, Math.max(0, Math.floor(y)));
  return { i, j };
}

/** Cells whose centers fall inside the box (x and y may run either way); never empty for a box on the field. */
export function cellsInRect({ x0, x1, y0, y1 }) {
  if (![x0, x1, y0, y1].every(isFiniteNum)) return [];
  const xs = span(x0, x1, FIELD.X_MIN, FIELD.X_MAX - 1);
  const ys = span(y0, y1, 0, ROWS - 1);
  const out = [];
  for (let j = ys.from; j <= ys.to; j += 1) {
    for (let i = xs.from; i <= xs.to; i += 1) out.push({ i, j });
  }
  return out.length ? out : [cellAt((x0 + x1) / 2, (y0 + y1) / 2)];
}

/** Cells whose centers lie within distance `inner` to `outer` of `at` (on the field only). */
function cellsByDistance(at, inner, outer) {
  if (!isFiniteNum(at?.x) || !isFiniteNum(at?.y) || !isFiniteNum(outer)) return [];
  const box = cellsInRect({ x0: at.x - outer, x1: at.x + outer, y0: at.y - outer, y1: at.y + outer });
  return box.filter(({ i, j }) => {
    const d = Math.hypot(i + HALF - at.x, j + HALF - at.y);
    return d <= outer + EPS && d >= inner - EPS;
  });
}

export const cellsInDisc = (at, r) => cellsByDistance(at, 0, r);

/** A ring `width` yards thick just inside radius r. */
export const cellsInRing = (at, r, width = 1) => cellsByDistance(at, Math.max(0, r - width), r);

/** Cells of the set with at least one 4-neighbor outside it. */
export function outlineCells(cells) {
  const set = new Set(cells.map(cellKey));
  const inside = (i, j) => set.has(`${i},${j}`);
  return cells.filter(({ i, j }) => !inside(i + 1, j) || !inside(i - 1, j) || !inside(i, j + 1) || !inside(i, j - 1));
}

/** Every other cell, like a checkerboard; `parity` 1 gives the other half. */
export function checkerCells(cells, parity = 0) {
  return cells.filter(({ i, j }) => (((i + j) % 2) + 2) % 2 === parity);
}

/**
 * One path for many cells: each a lit square `lit` of the cell, centered in it. `toPx(x, y)` maps field yards to
 * screen pixels (y up on the field is up on screen), `cellPx` is one yard in pixels.
 */
export function cellsPath(cells, toPx, cellPx, lit = CELL_LIT) {
  const gap = (1 - lit) / 2;
  const w = r2(lit * cellPx);
  return cells.map(({ i, j }) => {
    const { px, py } = toPx(i + gap, j + 1 - gap);
    return `M${r2(px)} ${r2(py)}h${w}v${w}h${-w}z`;
  }).join("");
}

/** The lit cells of a glyph; an unknown name has none. */
export function glyphCells(name) {
  const rows = ownValue(GLYPHS, name);
  if (!rows) return [];
  return rows.flatMap((row, r) => [...row].flatMap((ch, c) => (ch === "#" ? [{ c, r }] : [])));
}

/** A glyph `size` px square centered on a screen point, as one path. */
export function glyphPath(name, { px, py }, size, lit = CELL_LIT) {
  const cell = size / GLYPH_SIZE;
  const gap = ((1 - lit) / 2) * cell;
  const w = r2(lit * cell);
  const left = px - size / 2;
  const top = py - size / 2;
  return glyphCells(name).map(({ c, r }) => `M${r2(left + c * cell + gap)} ${r2(top + r * cell + gap)}h${w}v${w}h${-w}z`)
    .join("");
}
