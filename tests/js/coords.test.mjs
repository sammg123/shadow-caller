// field/coords.js: the only module that does field math (data-contract A1 to A5).
import assert from "node:assert/strict";
import test from "node:test";

import {
  FIELD, clampX, clampY, depthSpan, dirOf, fromWorld, goalX, ownGoalX, toPlane, toWorld, vecToWorld, xAtYardline100,
  xFromEspnYardLine, xFromTextSpot, xFromYardline100, yFromLateral, yardline100FromX,
} from "../../static/js/field/coords.js";

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test("FIELD carries the contract's fixed marks (DC A1)", () => {
  assert.equal(FIELD.X_MIN, -10);
  assert.equal(FIELD.X_MAX, 110);
  assert.deepEqual([...FIELD.GOAL_X], [0, 100]);
  assert.deepEqual([...FIELD.POSTS_X], [-10, 110]);
  assert.equal(FIELD.WIDTH, 53.333);
  assert.equal(FIELD.CENTER_Y, 26.667);
  assert.deepEqual([...FIELD.HASH_Y], [23.583, 29.75]);
  assert.ok(Object.isFrozen(FIELD) && Object.isFrozen(FIELD.HASH_Y));
});

test("the caller attacks left to right, the opponent right to left (DC A3)", () => {
  assert.equal(dirOf("DAL", "DAL"), 1);
  assert.equal(dirOf("TB", "DAL"), -1);
  assert.equal(goalX(1), 100);
  assert.equal(goalX(-1), 0);
  assert.equal(ownGoalX(1), 0);
  assert.equal(ownGoalX(-1), 100);
});

test("x from yardline_100: DAL 30 is x 30, the first TB snap at TB 27 is x 73", () => {
  assert.equal(xFromYardline100("DAL", 70, "DAL"), 30);
  assert.equal(xFromYardline100("TB", 73, "DAL"), 73);
  assert.equal(yardline100FromX("TB", 73, "DAL"), 73);
  assert.equal(yardline100FromX("DAL", 30, "DAL"), 70);
  assert.equal(xFromYardline100("DAL", 75, "DAL"), 25);
  assert.equal(yardline100FromX("DAL", 25, "DAL"), 75);
});

test("yardline_100 and x round-trip for both teams on every yard line", () => {
  for (let yl = 1; yl <= 99; yl += 1) {
    for (const team of ["DAL", "TB"]) {
      assert.equal(yardline100FromX(team, xFromYardline100(team, yl, "DAL"), "DAL"), yl);
    }
  }
});

test("x conversions return null for missing data instead of guessing", () => {
  assert.equal(xFromYardline100("DAL", null, "DAL"), null);
  assert.equal(xFromYardline100("DAL", Number.NaN, "DAL"), null);
  assert.equal(yardline100FromX("TB", undefined, "DAL"), null);
  assert.equal(xFromEspnYardLine("30", true), null);
});

test("x from ESPN yardLine is measured from the home goal line (DC A3)", () => {
  assert.equal(xFromEspnYardLine(30, true), 30);
  assert.equal(xFromEspnYardLine(30, false), 70);
  assert.equal(xFromEspnYardLine(0, true), 0);
});

test("x from a text spot: TB 3 is 97 for a DAL caller, 50 is 50, aliases resolve", () => {
  assert.equal(xFromTextSpot("TB 3", "DAL"), 97);
  assert.equal(xFromTextSpot("DAL 30", "DAL"), 30);
  assert.equal(xFromTextSpot("50", "DAL"), 50);
  assert.equal(xFromTextSpot("TB 50", "DAL"), 50);
  assert.equal(xFromTextSpot(" tb 24 ", "DAL"), 76);
  assert.equal(xFromTextSpot("WAS 20", "WSH", { WAS: "WSH" }), 20);
  assert.equal(xFromTextSpot("WAS 20", "DAL", { WAS: "WSH" }), 80);
  assert.equal(xFromTextSpot("TB 3", "DAL", null), 97);
  assert.equal(xFromTextSpot("TOSTRING 3", "DAL", {}), null, "not a 2-4 letter team");
  assert.equal(xFromTextSpot("TB 3", "DAL", { TB: "DAL" }), 3, "an alias can point at the caller");
  for (const bad of ["", "TB", "TB 51", "TB -3", "51", "T 3", "TB 3 4", null, undefined, 3]) {
    assert.equal(xFromTextSpot(bad, "DAL"), null, String(bad));
  }
});

test("y across the field: L toward the offense's left (DC A4)", () => {
  near(yFromLateral(8, 1), 34.667);
  near(yFromLateral(8, -1), 18.667);
  near(yFromLateral(0, -1), 26.667);
  near(yFromLateral(-12, 1), 14.667);
});

test("three.js mapping: world x = x - 50, world z = 26.667 - y, height up (DC A5)", () => {
  assert.deepEqual(toWorld(30, 26.667), { x: -20, y: 0, z: 0 });
  const end = toWorld(110, 0, 3);
  near(end.x, 60);
  near(end.y, 3);
  near(end.z, 26.667);
  const back = fromWorld(-20, 0);
  near(back.x, 30);
  near(back.y, 26.667);
  for (const [x, y] of [[-10, 0], [50, 26.667], [97, 41.2]]) {
    const w = toWorld(x, y, 0);
    const p = fromWorld(w.x, w.z);
    near(p.x, x, 1e-9);
    near(p.y, y, 1e-9);
  }
});

test("directions map to world axes without the origin shift", () => {
  assert.deepEqual(vecToWorld({ x: 1, y: 0, h: 0 }), { x: 1, y: 0, z: 0 });
  assert.deepEqual(vecToWorld({ x: 0, y: 1, h: 0 }), { x: 0, y: 0, z: -1 });
  assert.deepEqual(vecToWorld({ x: 0, y: 0, h: 1 }), { x: 0, y: 1, z: 0 });
});

test("toPlane puts the caller's end zone left and the near sideline at the bottom", () => {
  const rect = { x: 10, y: 20, w: 1200, h: 533.33 };
  const bottomLeft = toPlane(-10, 0, rect);
  near(bottomLeft.px, 10);
  near(bottomLeft.py, 553.33);
  const topRight = toPlane(110, 53.333, rect);
  near(topRight.px, 1210);
  near(topRight.py, 20);
  const middle = toPlane(50, 26.6665, rect);
  near(middle.px, 610);
  near(middle.py, 286.665);
});

test("geometry calls reject non-numbers loudly", () => {
  assert.throws(() => toWorld(Number.NaN, 0), TypeError);
  assert.throws(() => toWorld(0, "1"), TypeError);
  assert.throws(() => toPlane(0, 0, { x: 0, y: 0, w: 0, h: 10 }), TypeError);
  assert.throws(() => yFromLateral(Number.POSITIVE_INFINITY, 1), TypeError);
  assert.throws(() => yFromLateral(2, 0), TypeError);
});

test("xAtYardline100: a spot measured from the goal a team attacks", () => {
  assert.equal(xAtYardline100(65, 1), 35, "DAL kicks off from its own 35");
  assert.equal(xAtYardline100(65, -1), 65, "TB kicks off from its own 35");
  assert.throws(() => xAtYardline100(null, 1), TypeError);
});

test("depthSpan runs from the line in dir, clamps at the end lines, never thinner than asked", () => {
  assert.deepEqual(depthSpan(30, 1, [1, 10]), { x0: 31, x1: 40, clamped: false });
  assert.deepEqual(depthSpan(82, 1, [19, 32], 2), { x0: 101, x1: 110, clamped: true });
  assert.deepEqual(depthSpan(95, 1, [20, 35], 2), { x0: 108, x1: 110, clamped: true });
  assert.deepEqual(depthSpan(5, -1, [20, 35], 2), { x0: -8, x1: -10, clamped: true });
  assert.deepEqual(depthSpan(60, -1, [-3, 3], 2), { x0: 63, x1: 57, clamped: false });
  assert.deepEqual(depthSpan(40, 1, [4, 5], 2), { x0: 44, x1: 46, clamped: false });
  assert.throws(() => depthSpan(40, 1, [4]), TypeError);
});

test("clamps keep x inside the end lines and y inside the sidelines", () => {
  assert.equal(clampX(-20), -10);
  assert.equal(clampX(130), 110);
  assert.equal(clampX(55), 55);
  assert.equal(clampY(-1), 0);
  assert.equal(clampY(60), 53.333);
  assert.equal(clampY(26.667), 26.667);
});
