// field/fallback-pixels.js (A6): the 9-row glyphs every mark on the 2D field is drawn with.
import assert from "node:assert/strict";
import test from "node:test";

import * as pixels from "../../static/js/field/fallback-pixels.js";

const { CELL_LIT, GLYPHS, GLYPH_SIZE, glyphCells, glyphCols, glyphPath } = pixels;

const starts = (d) => [...d.matchAll(/M(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);

test("every glyph is a bitmap 9 rows tall, its rows one width, with something lit", () => {
  assert.equal(GLYPH_SIZE, 9);
  for (const [name, rows] of Object.entries(GLYPHS)) {
    assert.equal(rows.length, 9, name);
    assert.ok(rows.every((r) => r.length === rows[0].length && /^[#.]+$/.test(r)), name);
    assert.ok(rows.join("").includes("#"), name);
  }
  for (const name of ["x", "check", "flag", "burst", "td", "int", "ring", "diamond", "square", "arrow", "bar"]) {
    assert.ok(GLYPHS[name], `glyph ${name}`);
  }
});

test("INT is lettered like TD, wider than the square glyphs", () => {
  assert.equal(glyphCols("int"), 14);
  assert.equal(glyphCols("td"), 9);
  assert.equal(glyphCols("nope"), GLYPH_SIZE, "an unknown glyph is the square size");
  const cells = glyphCells("int");
  assert.ok(cells.some(({ c }) => c === 13), "the T reaches the last column");
  assert.ok(cells.every(({ r }) => r < 8), "the bottom row stays dark, like TD's");
});

test("glyph cells: the x is symmetric, unknown glyphs are empty", () => {
  const cells = glyphCells("x");
  const set = new Set(cells.map(({ c, r }) => `${c},${r}`));
  for (const { c, r } of cells) assert.ok(set.has(`${8 - c},${r}`) && set.has(`${c},${8 - r}`));
  assert.deepEqual(glyphCells("nope"), []);
  assert.deepEqual(glyphCells("__proto__"), []);
});

test("glyphPath centers the glyph on its spot at the given size", () => {
  const d = glyphPath("square", { px: 100, py: 50 }, 18, 1);
  const square = starts(d);
  assert.equal(square.length, glyphCells("square").length);
  assert.ok(square.every(([x, y]) => x >= 91 && x < 109 && y >= 41 && y < 59), "inside the 18 px box around the spot");
  assert.ok(square.some(([x, y]) => x === 93 && y === 43), "cell (1, 1) of a 2 px grid starts at 93, 43");
  assert.equal(glyphPath("nope", { px: 0, py: 0 }, 18), "");
});

test("a wide glyph keeps its cells square and centers on its spot across its whole width", () => {
  const cells = starts(glyphPath("int", { px: 100, py: 50 }, 18, 1));
  const xs = cells.map(([x]) => x);
  assert.equal(Math.min(...xs), 100 - 14, "14 columns of 2 px, centered: the I starts 14 px left of the spot");
  assert.equal(Math.max(...xs), 100 + 14 - 2, "the T's last column ends 14 px right of it");
  assert.ok(cells.every(([, y]) => y >= 41 && y < 59), "9 rows of 2 px tall");
});

test("a pixel look leaves the dark gap between lit cells", () => {
  assert.equal(CELL_LIT, 0.8);
  const lit = glyphPath("square", { px: 100, py: 50 }, 18);
  assert.match(lit, /h1\.6v1\.6h-1\.6z/, "a lit 1.6 px square in each 2 px cell");
});

test("only the glyph vocabulary is left: the turf-cell helpers went with the zones, lanes and bands", () => {
  for (const gone of ["cellsInRect", "cellsInDisc", "cellsInRing", "outlineCells", "checkerCells", "cellsPath"]) {
    assert.equal(pixels[gone], undefined, gone);
  }
});
