// field/shadow-lanes.js: before each Dallas snap his predicted plays never share a lane (play-drawing.md 4b): every
// stroke starts 1.5 yd past the ball, and two that come within 3 yd of each other fan out to lanes at least 4 yd
// apart, passes arcing in the far lanes above the runs on the turf; the previous play's stroke where it lies in their
// way (ahead of the ball, low over the turf) is kept as far off. Checked on all 59 real Dallas pre-snaps.
import assert from "node:assert/strict";
import test from "node:test";

import { FIELD } from "../../static/js/field/coords.js";
import { situationFromRow } from "../../static/js/field/paths.js";
import {
  FAN_GAP_YD, FAN_TRIGGER_YD, SHADOW_START_YD, WAY_AHEAD_YD, WAY_LOW_YD, closestGap, inTheWay, laneKey, laneStrokes,
  naturalStroke, strokeGap, wayGap,
} from "../../static/js/field/shadow-lanes.js";
import { allRows } from "./field-rows.mjs";
import { previousDrawing } from "./presnap-scene.mjs";

const C = 26.667;
const EPS = 1e-6;
const near = (a, b, label = "") => assert.ok(Math.abs(a - b) <= EPS, `${label} ${a} != ${b}`);
const snapAt = (ballX, dir = 1) => ({ ballX, dir });
const ballGap = (stroke, ballX) => Math.hypot(stroke.from.x - ballX, stroke.from.y - C);
const dallasSnaps = () => allRows().filter((r) => r.pred?.dist);

test("every stroke starts 1.5 yd past the ball, never on it; passes still land at their bucket's air yards", () => {
  const short = naturalStroke("dropback_short", 50, 1);
  assert.deepEqual([short.t, short.role], ["arc", "pass"]);
  near(short.from.x, 50 + SHADOW_START_YD, "short from");
  near(short.to.x, 56, "the short bucket's 6 air yards from the line of scrimmage");
  near(short.apex, 1.5, "arc heights stay generic: the minimum");
  near(naturalStroke("dropback_mid", 50, 1).to.x, 64);
  near(naturalStroke("pa_deep", 50, 1).to.x, 75);
  const run = naturalStroke("run_inside", 50, 1);
  assert.deepEqual([run.t, run.role], ["ground", "run"]);
  near(run.from.x, 51.5);
  near(run.to.x, 55.5, "a run is a line 4 yd long from its start");
  near(run.to.y, C, "inside: straight ahead");
  near(naturalStroke("run_ot_left", 50, 1).to.y, C + 4, "off-tackle 4 yd toward the offense's left");
  near(naturalStroke("run_edge_right", 50, -1).to.y, C + 9, "attacking -x, the offense's right is +y");
  const screen = naturalStroke("screen", 50, 1);
  near(Math.hypot(screen.from.x - 50, screen.from.y - C), SHADOW_START_YD, "the screen starts 1.5 yd along its way");
  near(screen.to.x, 49, "1 yd behind the line");
  near(screen.to.y, C - 10, "10 yd toward the near sideline");
});

test("near the goal line the landing stays inside the end zone and the start never goes behind the ball", () => {
  near(naturalStroke("dropback_deep", 97, 1).to.x, 109, "capped 1 yd inside the end line");
  near(naturalStroke("run_inside", 99, 1).from.x, 100.5);
  near(naturalStroke("pa_short", 3, -1).to.x, -3);
  near(naturalStroke("pa_short", 3, -1).from.x, 1.5);
});

test("strokeGap is the least distance on the turf between two strokes (0 when they cross)", () => {
  const a = { from: { x: 0, y: 0 }, to: { x: 10, y: 0 } };
  near(strokeGap(a, { from: { x: 0, y: 4 }, to: { x: 10, y: 4 } }), 4);
  near(strokeGap(a, { from: { x: 12, y: 3 }, to: { x: 20, y: 9 } }), Math.hypot(2, 3));
  assert.equal(strokeGap(a, { from: { x: 5, y: -2 }, to: { x: 5, y: 2 } }), 0);
  assert.equal(closestGap([a]), Infinity);
});

test("lanes: a pass takes the far lane (an arc rises away from the run), the deeper of two passes too", () => {
  assert.ok(laneKey(naturalStroke("pa_short", 50, 1)) > laneKey(naturalStroke("run_edge_left", 50, 1)));
  assert.ok(laneKey(naturalStroke("dropback_mid", 50, 1)) > laneKey(naturalStroke("dropback_short", 50, 1)));
  assert.ok(laneKey(naturalStroke("screen", 50, 1)) < laneKey(naturalStroke("run_ot_right", 50, 1)));
  const [run, pa] = laneStrokes([{ leaf: "run_inside" }, { leaf: "pa_short" }], snapAt(36));
  assert.deepEqual([run.lane, pa.lane], [-FAN_GAP_YD / 2, FAN_GAP_YD / 2], "the run near, the pass far");
  near(run.stroke.from.y, C - 2);
  near(run.stroke.to.y, C - 2, "an inside run still goes straight ahead, in its lane");
  near(pa.stroke.from.y, C + 2);
  near(strokeGap(run.stroke, pa.stroke), FAN_GAP_YD);
  const [short, mid] = laneStrokes([{ leaf: "dropback_short" }, { leaf: "dropback_mid" }], snapAt(32));
  assert.ok(mid.lane > short.lane, "Intermediate flies the far lane, Short the near one");
});

test("two runs keep their own ways: the one ending toward the far sideline takes the far lane, so they diverge", () => {
  const [inside, right] = laneStrokes([{ leaf: "run_inside" }, { leaf: "run_ot_right" }], snapAt(50));
  assert.ok(right.lane < inside.lane);
  near(right.stroke.to.y, C - 2 - 4);
  assert.ok(strokeGap(inside.stroke, right.stroke) >= FAN_GAP_YD - EPS);
  const [edge, ot] = laneStrokes([{ leaf: "run_edge_left" }, { leaf: "run_ot_left" }], snapAt(50, -1));
  assert.ok(strokeGap(edge.stroke, ot.stroke) >= FAN_GAP_YD - EPS, "attacking -x as well");
});

test("a hovered play outside his top 2 goes outside them on its own side; his top 2 never move", () => {
  const top = [{ leaf: "run_inside" }, { leaf: "pa_short" }];
  const plain = laneStrokes(top, snapAt(40));
  const deep = laneStrokes([...top, { leaf: "dropback_deep", extra: true }], snapAt(40));
  assert.deepEqual(deep.slice(0, 2), plain, "the top 2 stay put");
  assert.equal(deep[2].lane, plain[1].lane + FAN_GAP_YD, "a deep shot sorts past both: beyond the far lane");
  const screen = laneStrokes([...top, { leaf: "screen", extra: true }], snapAt(40));
  assert.equal(screen[2].lane, plain[0].lane - FAN_GAP_YD, "the screen goes under the near lane");
  assert.ok(closestGap(screen.map((s) => s.stroke)) >= FAN_GAP_YD - EPS);
});

test("one play alone is never moved: it keeps the center line", () => {
  const [one] = laneStrokes([{ leaf: "dropback_deep" }], snapAt(25));
  assert.equal(one.lane, 0);
  near(one.stroke.from.y, C);
});

test("all 59 Dallas pre-snaps of TB at DAL: his top 2 start off the ball and stay at least 4 yd apart (and 3)", () => {
  const snaps = dallasSnaps();
  assert.equal(snaps.length, 59);
  for (const row of snaps) {
    const sit = situationFromRow(row);
    const picks = row.pred.top3.slice(0, 2).map((leaf) => ({ leaf }));
    const natural = picks.map((p) => naturalStroke(p.leaf, sit.ballX, sit.dir));
    const shown = laneStrokes(picks, sit);
    const gap = strokeGap(shown[0].stroke, shown[1].stroke);
    assert.ok(gap >= FAN_TRIGGER_YD - EPS, `#${row.seq} ${picks.map((p) => p.leaf)}: ${gap.toFixed(2)} yd apart`);
    if (closestGap(natural) < FAN_TRIGGER_YD) {
      assert.ok(gap >= FAN_GAP_YD - EPS, `#${row.seq}: fanned to ${gap.toFixed(2)} yd`);
    }
    for (const { stroke } of shown) {
      assert.ok(ballGap(stroke, sit.ballX) >= SHADOW_START_YD - EPS, `#${row.seq} ${stroke.role} starts on the ball`);
      assert.ok(sit.dir * (stroke.from.x - sit.ballX) > 0, `#${row.seq} starts past the line of scrimmage`);
    }
  }
});

// ---------------------------------------------------------------- the previous play in their way
const run = (fromX, toX, y = C) => ({ t: "ground", role: "run", from: { x: fromX, y }, to: { x: toX, y } });
const pass = (fromX, toX, apex, y = C) => ({ t: "arc", role: "pass", from: { x: fromX, y }, to: { x: toX, y }, apex,
  endH: 0 });

test("a real play's stroke is in their way only where it runs on or low over the turf ahead of the ball", () => {
  const lost = inTheWay([run(52, 50)], snapAt(50));
  assert.ok(lost.length > 0, "a run for -2 lies just ahead of the ball");
  assert.ok(lost.every((p) => p.x >= 50 + WAY_AHEAD_YD - EPS && p.h === 0));
  assert.deepEqual(inTheWay([run(40, 50)], snapAt(50)), [], "a gain ends at the ball, behind their starts");
  const short = inTheWay([pass(50, 56, 1.5)], snapAt(50));
  assert.ok(short.length >= 10 && short.every((p) => p.h <= 1.5 + EPS && p.x >= 50.5 - EPS), "a short throw, all along");
  assert.ok(WAY_LOW_YD >= 1.5 && WAY_LOW_YD < 8);
  assert.deepEqual(inTheWay([pass(50, 80, 8)], snapAt(50)), [], "a deep ball flies high over them, end to end");
  assert.deepEqual(inTheWay([{ t: "arc", role: "punt", from: { x: 90, y: C }, to: { x: 50, y: C }, apex: 12, endH: 0 }],
    snapAt(50)), [], "so does a punt, down to the catch at the ball");
  assert.deepEqual(inTheWay([{ t: "mark", role: "inc", at: { x: 55, y: C } }], snapAt(50)), [], "marks: no stroke");
  const back = inTheWay([run(47, 50)], snapAt(50, -1));
  assert.ok(back.length > 0 && back.every((p) => p.x <= 50 - WAY_AHEAD_YD + EPS), "attacking -x, ahead is -x");
  assert.deepEqual(inTheWay(null, snapAt(50)), []);
});

test("the previous play in their way: his top 2 fan clear of it, 4 yd from it and from each other, passes far", () => {
  const incomplete = [pass(30, 36, 1.5), { t: "mark", role: "inc", at: { x: 36, y: C } }];
  const picks = [{ leaf: "dropback_short" }, { leaf: "run_inside" }];
  const shown = laneStrokes(picks, snapAt(30), { avoid: incomplete });
  const way = inTheWay(incomplete, snapAt(30));
  for (const { stroke } of shown) {
    assert.ok(wayGap(stroke, way) >= FAN_GAP_YD - EPS, `${stroke.role} ${wayGap(stroke, way)} yd from it`);
    assert.ok(ballGap(stroke, 30) >= SHADOW_START_YD - EPS);
  }
  assert.ok(strokeGap(shown[0].stroke, shown[1].stroke) >= FAN_GAP_YD - EPS);
  assert.deepEqual(shown.map((s) => s.lane), [FAN_GAP_YD, -FAN_GAP_YD - 0.5], "the nearest lanes that clear it: the "
    + "pass far of it, the run near, half a yard more so its dashes don't run along the hash marks");
  const nearHash = Math.min(...FIELD.HASH_Y.map((h) => Math.abs(shown[1].stroke.from.y - h)));
  assert.ok(nearHash >= 1.4, `the straight run ${nearHash.toFixed(2)} yd from a row of hash marks`);
  const lost = laneStrokes([{ leaf: "dropback_short" }, { leaf: "dropback_mid" }], snapAt(60, -1),
    { avoid: [run(58, 60)] });
  assert.ok(lost.every(({ stroke }) => wayGap(stroke, inTheWay([run(58, 60)], snapAt(60, -1))) >= FAN_GAP_YD - EPS));
  assert.ok(lost[1].lane > lost[0].lane, "the deeper pass still flies the far lane");
});

test("a previous play out of their way moves nothing: behind the ball, high overhead, or far enough already", () => {
  const picks = [{ leaf: "run_inside" }, { leaf: "pa_short" }];
  const plain = laneStrokes(picks, snapAt(30));
  assert.deepEqual(laneStrokes(picks, snapAt(30), { avoid: [run(20, 30)] }), plain, "a gain that ends at the ball");
  assert.deepEqual(laneStrokes(picks, snapAt(30), { avoid: [run(30, 34, C + 12)] }), plain, "12 yd off to the side");
  assert.deepEqual(laneStrokes(picks, snapAt(30), { avoid: [] }), plain);
  assert.deepEqual(laneStrokes([{ leaf: "dropback_deep" }], snapAt(25), { avoid: [run(45, 60, C + 10)] }),
    laneStrokes([{ leaf: "dropback_deep" }], snapAt(25)), "one play alone, nothing in its way");
});

test("only a hovered play, nothing of his top plays: it is never moved off for the previous play", () => {
  const [one] = laneStrokes([{ leaf: "dropback_short", extra: true }], snapAt(30), { avoid: [pass(30, 36, 1.5)] });
  assert.ok(Number.isFinite(one.lane), `lane ${one.lane}`);
});

test("a hovered play outside his top 2 still goes outside them when the previous play moved them", () => {
  const avoid = [pass(30, 36, 1.5)];
  const top = [{ leaf: "run_inside" }, { leaf: "pa_short" }];
  const plain = laneStrokes(top, snapAt(30), { avoid });
  const deep = laneStrokes([...top, { leaf: "dropback_deep", extra: true }], snapAt(30), { avoid });
  assert.deepEqual(deep.slice(0, 2), plain, "the top 2 stay put");
  assert.equal(deep[2].lane, plain[1].lane + FAN_GAP_YD, "beyond the far lane");
});

test("all 59 Dallas pre-snaps after their real previous plays: clear of it (4 yd) wherever it was in the way", () => {
  const rows = allRows();
  let moved = 0;
  rows.forEach((row, i) => {
    if (!row.pred?.dist) return;
    const sit = situationFromRow(row);
    const steps = previousDrawing(rows, i)?.steps ?? [];
    const picks = row.pred.top3.slice(0, 2).map((leaf) => ({ leaf }));
    const shown = laneStrokes(picks, sit, { avoid: steps });
    const way = inTheWay(steps, sit);
    const before = laneStrokes(picks, sit);
    if (before.some(({ stroke }) => wayGap(stroke, way) < FAN_TRIGGER_YD)) moved += 1;
    else assert.deepEqual(shown, before, `#${row.seq}: nothing in the way, nothing moves`);
    for (const { stroke, lane } of shown) {
      const gap = wayGap(stroke, way);
      assert.ok(gap >= FAN_TRIGGER_YD - EPS, `#${row.seq} ${stroke.role} lane ${lane}: ${gap.toFixed(2)} yd from it`);
      assert.ok(ballGap(stroke, sit.ballX) >= SHADOW_START_YD - EPS, `#${row.seq} starts on the ball`);
      assert.ok(Math.abs(lane) <= 3 * FAN_GAP_YD, `#${row.seq}: lane ${lane}`);
    }
    assert.ok(strokeGap(shown[0].stroke, shown[1].stroke) >= FAN_GAP_YD - EPS, `#${row.seq}: top 2 apart`);
  });
  assert.ok(moved >= 4, `the previous play was in their way before ${moved} snaps (incomplete passes, losses)`);
});

test("pure: the same picks give the same strokes, and nothing given is changed", () => {
  const picks = Object.freeze([Object.freeze({ leaf: "run_inside" }), Object.freeze({ leaf: "pa_short" })]);
  const snap = Object.freeze({ ballX: 30, dir: 1 });
  assert.deepEqual(laneStrokes(picks, snap), laneStrokes(picks, snap));
});
