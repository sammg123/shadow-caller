/**
 * The pixel vocabulary of the 2D field (ui-architecture.md 6.2 and 16, owner A6): the bitmap glyphs every mark is
 * drawn with, nine rows tall (TD and INT are lettered, so they run wider). A "pixel" look draws them with a dark gap
 * between lit cells (DESIGN.md's LED boards), any other look solid. Pure: no DOM, no clock.
 *
 * A glyph cell { c, r } is column c and row r of a bitmap, row 0 at the top of the screen. The turf cells the old
 * prediction zones, lanes, catch areas and bands lit are gone with them (docs/design/play-drawing.md).
 */
import { deepFreeze } from "../core/domain.js";
import { ownValue } from "./grammar.js";

export const CELL_LIT = 0.8;
/** Rows in every glyph, and columns in the square ones. */
export const GLYPH_SIZE = 9;
const DIGITS = 100;

/** Bitmaps ("#" lit). Results and kick marks; every one reads at 18 px tall. */
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
  int: ["##.##..##.####", "##.###.##.####", "##.######..##.", "##.##.###..##.", "##.##..##..##.", "##.##..##..##.",
    "##.##..##..##.", "##.##..##..##.", ".............."],
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

/** The lit cells of a glyph; an unknown name has none. */
export function glyphCells(name) {
  const rows = ownValue(GLYPHS, name);
  if (!rows) return [];
  return rows.flatMap((row, r) => [...row].flatMap((ch, c) => (ch === "#" ? [{ c, r }] : [])));
}

/** Columns in a glyph (GLYPH_SIZE for an unknown one), so a plate can fit a lettered glyph. */
export function glyphCols(name) {
  const rows = ownValue(GLYPHS, name);
  return rows ? rows[0].length : GLYPH_SIZE;
}

/** A glyph `size` px tall centered on a screen point, as one path; its cells stay square, so INT runs wider. */
export function glyphPath(name, { px, py }, size, lit = CELL_LIT) {
  const cell = size / GLYPH_SIZE;
  const gap = ((1 - lit) / 2) * cell;
  const w = r2(lit * cell);
  const left = px - (glyphCols(name) * cell) / 2;
  const top = py - size / 2;
  return glyphCells(name).map(({ c, r }) => `M${r2(left + c * cell + gap)} ${r2(top + r * cell + gap)}h${w}v${w}h${-w}z`)
    .join("");
}
