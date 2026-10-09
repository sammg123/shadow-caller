// Field dimensions and layouts for the 3D stage (three-recipe 4.1, 4.2; package A5). Pure: world yards in, world
// yards out (world x = field x - 50, world z = 26.667 - field y, y up; DC A5).
import assert from "node:assert/strict";
import test from "node:test";
import {
  NFL, hashInnerZ, numberLayout, numeralQuads, pylonLayout, wordmarkLayout, wordmarkText, logoLayout, endZoneTeams,
  ATLAS,
} from "../../static/js/field/field-spec.js";
import { loadJson } from "./fixtures.mjs";

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("NFL hashes: 70 ft 9 in from each sideline, inner edges 18 ft 6 in apart (DC A1 hash_y)", () => {
  close(2 * hashInnerZ(NFL) * 3, 18.5);
  close(26.667 - hashInnerZ(NFL), 23.583, 1e-3);
  close(NFL.goalpost.crossbarHeight, 10 / 3);
  close(NFL.halfWidth * 2, 53.333, 1e-3);
});

test("numerals: 18 of them, bottom edge 12 yd in, arrows point to the nearer goal, no arrow at the 50", () => {
  const rows = numberLayout(NFL);
  assert.equal(rows.length, 18);
  for (const n of rows) {
    close(NFL.halfWidth - (Math.abs(n.z) - n.height / 2), 12);
    if (n.x === 0) assert.equal(n.arrow, null);
    else assert.equal(Math.sign(n.arrow.tip[0] - n.arrow.a[0]), Math.sign(n.x));
  }
  assert.deepEqual([...new Set(rows.map((n) => n.label))].sort((a, b) => a - b), [10, 20, 30, 40, 50]);
});

test("near-row numerals are turned (tops face the near sideline), so their digit order flips in x", () => {
  const rows = numberLayout(NFL);
  const near40 = rows.find((n) => n.x === -10 && n.side === 1);
  const far40 = rows.find((n) => n.x === -10 && n.side === -1);
  assert.equal(near40.digits[0].char, "4");
  assert.ok(near40.digits[0].x > near40.digits[1].x, "near row: the tens digit sits at larger x");
  assert.ok(far40.digits[0].x < far40.digits[1].x, "far row: reads upright from the home camera");
  assert.ok(near40.z > 0 && far40.z < 0);
});

test("numeral quads: two quads per numeral, one triangle per arrow, every triangle faces up", () => {
  const { positions, uvs, indices } = numeralQuads(NFL);
  const arrows = numberLayout(NFL).filter((n) => n.arrow).length;
  assert.equal(arrows, 16);
  assert.equal(indices.length, 18 * 2 * 6 + arrows * 3);
  assert.equal(positions.length / 3, uvs.length / 2);
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]].map((k) => [positions[k * 3], positions[k * 3 + 2]]);
    const ux = b[0] - a[0];
    const uz = b[1] - a[1];
    const vx = c[0] - a[0];
    const vz = c[1] - a[1];
    // normal.y of (b - a) x (c - a) on the x-z plane: uz * vx - ux * vz; up-facing is > 0
    assert.ok(uz * vx - ux * vz > 0, `triangle ${i / 3} faces down`);
  }
  for (const v of uvs) assert.ok(v >= 0 && v <= 1);
  for (let i = 1; i < positions.length; i += 3) assert.equal(positions[i], 0);
});

test("the atlas has a cell per digit 0 to 5 and a solid cell for the arrows", () => {
  assert.equal(ATLAS.cells, 8);
  assert.ok(ATLAS.whiteCell > 5 && ATLAS.whiteCell < ATLAS.cells);
  assert.equal(ATLAS.width, ATLAS.cells * ATLAS.cellW);
});

test("pylons: the 8 corners of both end zones, just outside the field", () => {
  const p = pylonLayout(NFL);
  assert.equal(p.length, 8);
  const xs = [...new Set(p.map(([x]) => Math.round(Math.abs(x))))].sort((a, b) => a - b);
  assert.deepEqual(xs, [50, 60]);
  for (const [, z] of p) assert.ok(Math.abs(z) > NFL.halfWidth && Math.abs(z) < NFL.halfWidth + 0.2);
});

test("wordmarks: centered in each end zone, tops toward the end line, reading left to right from the field", () => {
  const left = wordmarkLayout(NFL, -1);
  const right = wordmarkLayout(NFL, 1);
  assert.deepEqual(left.center, [-55, 0, 0]);
  assert.deepEqual(right.center, [55, 0, 0]);
  assert.deepEqual(left.up, [-1, 0, 0]);
  assert.deepEqual(right.up, [1, 0, 0]);
  assert.deepEqual(left.right, [0, 0, -1]);
  assert.deepEqual(right.right, [0, 0, 1]);
  assert.ok(left.width < NFL.halfWidth * 2 && left.height < NFL.endLineX - NFL.goalX);
});

test("wordmark text follows look.field.endZoneText and never trusts the server string", () => {
  const dal = { abbr: "DAL", name: "Cowboys" };
  assert.equal(wordmarkText(dal, "name"), "COWBOYS");
  assert.equal(wordmarkText(dal, "abbr"), "DAL");
  assert.equal(wordmarkText(dal, "none"), "");
  assert.equal(wordmarkText({ abbr: "TB", name: 42 }, "name"), "TB", "a bad name falls back to the abbreviation");
  assert.equal(wordmarkText({ abbr: "<b>", name: null }, "name"), "");
  assert.equal(wordmarkText(null, "name"), "");
  assert.equal(wordmarkText({ abbr: "X", name: "A".repeat(40) }, "name").length, 24);
});

test("the midfield logo lies flat at the 50, upright from the home-side camera", () => {
  const logo = logoLayout(10);
  assert.deepEqual(logo.center, [0, 0, 0]);
  assert.deepEqual(logo.right, [1, 0, 0]);
  assert.deepEqual(logo.up, [0, 0, -1]);
  assert.equal(logo.width, 10);
});

test("end zones belong to the team that defends them: the caller on the left (DC A1, A2)", () => {
  const body = loadJson("timeline_tb_dal.json");
  const ez = endZoneTeams(body.field, body.teams);
  assert.equal(ez.left.abbr, "DAL");
  assert.equal(ez.right.abbr, "TB");
  assert.deepEqual(endZoneTeams(null, body.teams), { left: null, right: null });
  assert.deepEqual(endZoneTeams({ left_team: "XX", right_team: "TB" }, body.teams).left, null);
});
