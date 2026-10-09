// field/fallback-pixels.js (A6): the 1-yard turf grid the pixel style lights, and the 9 by 9 glyphs for marks.
import assert from "node:assert/strict";
import test from "node:test";

import {
  CELL_LIT, GLYPHS, cellKey, cellsInDisc, cellsInRect, cellsInRing, cellsPath, checkerCells, glyphCells,
  glyphPath, outlineCells,
} from "../../static/js/field/fallback-pixels.js";

const keys = (cells) => cells.map(cellKey).sort();

test("a rect lights every cell whose center is inside it, whichever way its x runs", () => {
  const cells = cellsInRect({ x0: 30, x1: 35, y0: 24.667, y1: 28.667 });
  assert.equal(cells.length, 5 * 4);
  assert.ok(cells.every(({ i, j }) => i >= 30 && i <= 34 && j >= 25 && j <= 28), "centers 30.5-34.5 by 25.5-28.5");
  assert.deepEqual(keys(cellsInRect({ x0: 35, x1: 30, y0: 24.667, y1: 28.667 })), keys(cells));
});

test("a rect thinner than a cell still lights the cell under its center", () => {
  const cells = cellsInRect({ x0: 40.2, x1: 40.4, y0: 26.2, y1: 26.4 });
  assert.deepEqual(cells, [{ i: 40, j: 26 }]);
});

test("cells stay on the field: x -10 to 110, y 0 to 53.333", () => {
  const cells = cellsInRect({ x0: 105, x1: 130, y0: -5, y1: 60 });
  assert.ok(cells.every(({ i, j }) => i >= 105 && i <= 109 && j >= 0 && j <= 52));
  assert.equal(cells.length, 5 * 53);
});

test("outline cells are the ones with a 4-neighbor outside the set", () => {
  const box = cellsInRect({ x0: 0, x1: 5, y0: 0, y1: 4 });
  const edge = outlineCells(box);
  assert.equal(edge.length, 5 * 4 - 3 * 2);
  assert.ok(!edge.some(({ i, j }) => i === 2 && j === 1), "an inner cell is not outline");
  assert.deepEqual(outlineCells([{ i: 3, j: 3 }]), [{ i: 3, j: 3 }]);
});

test("checker cells alternate like a checkerboard", () => {
  const box = cellsInRect({ x0: 0, x1: 4, y0: 0, y1: 4 });
  const on = checkerCells(box);
  assert.equal(on.length, 8);
  assert.ok(on.every(({ i, j }) => (i + j) % 2 === 0));
  assert.equal(checkerCells(box, 1).length, 8);
  assert.ok(checkerCells(box, 1).every(({ i, j }) => (i + j) % 2 === 1));
});

test("a disc and a ring around a catch spot", () => {
  const disc = cellsInDisc({ x: 52, y: 26.667 }, 2.5);
  assert.ok(disc.length >= 16 && disc.length <= 24, `disc of r 2.5 has ${disc.length} cells`);
  const ring = cellsInRing({ x: 52, y: 26.667 }, 2.5, 1);
  assert.ok(ring.length > 0 && ring.length < disc.length);
  for (const { i, j } of ring) {
    const d = Math.hypot(i + 0.5 - 52, j + 0.5 - 26.667);
    assert.ok(d >= 1.5 - 1e-9 && d <= 2.5 + 1e-9, `ring cell at distance ${d}`);
  }
});

test("cellsPath draws one lit square per cell, inset by the dark gap", () => {
  const toPx = (x, y) => ({ px: x * 10, py: 100 - y * 10 });
  assert.equal(CELL_LIT, 0.8);
  assert.equal(cellsPath([{ i: 2, j: 3 }], toPx, 10), "M21 61h8v8h-8z");
  assert.equal(cellsPath([], toPx, 10), "");
  const solid = cellsPath([{ i: 2, j: 3 }], toPx, 10, 1);
  assert.equal(solid, "M20 60h10v10h-10z");
});

test("every glyph is a 9 by 9 bitmap with something lit", () => {
  for (const [name, rows] of Object.entries(GLYPHS)) {
    assert.equal(rows.length, 9, name);
    assert.ok(rows.every((r) => r.length === 9 && /^[#.]+$/.test(r)), name);
    assert.ok(rows.join("").includes("#"), name);
  }
  for (const name of ["x", "check", "flag", "burst", "td", "ring", "diamond", "square", "arrow", "bar", "three"]) {
    assert.ok(GLYPHS[name], `glyph ${name}`);
  }
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
  const starts = [...d.matchAll(/M(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.equal(starts.length, glyphCells("square").length);
  assert.ok(starts.every(([x, y]) => x >= 91 && x < 109 && y >= 41 && y < 59), "inside the 18 px box around the spot");
  assert.ok(starts.some(([x, y]) => x === 93 && y === 43), "cell (1, 1) of a 2 px grid starts at 93, 43");
  assert.equal(glyphPath("nope", { px: 0, py: 0 }, 18), "");
});
