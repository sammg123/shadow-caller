// field/timing.js: step timing, sampling and easing for one drawing.
import assert from "node:assert/strict";
import test from "node:test";

import { buildDrawing } from "../../static/js/field/paths.js";
import {
  DEFAULT_MOTION, EASE, ballAt, easeFor, fitPlan, normalDurationMs, planDrawing, progressAt, sampleArc,
  sampleDrawing, sampleLine, trackOf,
} from "../../static/js/field/timing.js";
import { allRows, numbersIn, rowById } from "./field-rows.mjs";

const C = 26.667;
const near = (a, b, eps = 1e-6, label = "") => assert.ok(Math.abs(a - b) <= eps, `${label} ${a} != ${b}`);
const MOTION = Object.freeze({ groundYps: 10, airYps: 20, kickYps: 20, markMs: 200, minStepMs: 100, holdMs: 300,
  maxRowMs: 10000, minRowMs: 0 });
const P = (x, y = C) => ({ x, y });
const ground = (from, to, role = "yac") => ({ t: "ground", role, from, to, approx: false, ghosted: false });
const drawingOf = (steps) => ({ seq: 1, id: "t", kind: "play", steps, ballStart: steps[0]?.from ?? null });

test("sampleArc: starts on the ground, ends at endH, peaks at the apex mid-flight", () => {
  const a = P(10, 20);
  const b = P(50, 30);
  assert.deepEqual(sampleArc(a, b, 8, 0, 0), { x: 10, y: 20, h: 0 });
  const end = sampleArc(a, b, 8, 5.333, 1);
  assert.deepEqual([end.x, end.y], [50, 30]);
  near(end.h, 5.333);
  const mid = sampleArc(a, b, 8, 0, 0.5);
  assert.deepEqual([mid.x, mid.y, mid.h], [30, 25, 8]);
  assert.throws(() => sampleArc(a, b, Number.NaN, 0, 0.5), TypeError);
});

test("sampleLine interpolates and clamps u", () => {
  assert.deepEqual(sampleLine(P(0, 0), P(10, 20), 0.25), { x: 2.5, y: 5 });
  assert.deepEqual(sampleLine(P(0, 0), P(10, 20), 2), { x: 10, y: 20 });
  assert.deepEqual(sampleLine(P(0, 0), P(10, 20), -1), { x: 0, y: 0 });
});

test("easing functions run 0 to 1 and never step backward", () => {
  for (const [name, fn] of Object.entries(EASE)) {
    near(fn(0), 0, 1e-12, name);
    near(fn(1), 1, 1e-12, name);
    let last = -Infinity;
    for (let i = 0; i <= 100; i += 1) {
      const v = fn(i / 100);
      assert.ok(v >= last - 1e-12, `${name} decreases at ${i}`);
      last = v;
    }
  }
  near(EASE.outCubic(0.5), 0.875);
  near(EASE.inOutCubic(0.5), 0.5);
  near(EASE.linear(0.3), 0.3);
  assert.equal(easeFor({ t: "arc" }), EASE.linear, "a thrown ball keeps its ground speed");
  assert.equal(easeFor({ t: "ground", role: "march" }), EASE.inOutCubic);
  assert.equal(easeFor({ t: "ground", role: "yac" }), EASE.outCubic);
});

test("planDrawing: length over speed, marks take markMs, then the hold", () => {
  const d = drawingOf([ground(P(0), P(20)), { t: "mark", role: "td", at: P(20), ghosted: false },
    { t: "arc", role: "pass", from: P(20), to: P(60), apex: 5, endH: 0, approx: false, ghosted: false }]);
  const plan = planDrawing(d, MOTION);
  assert.deepEqual(plan.steps, [
    { index: 0, startMs: 0, endMs: 2000 }, { index: 1, startMs: 2000, endMs: 2200 },
    { index: 2, startMs: 2200, endMs: 4200 },
  ]);
  assert.equal(plan.totalMs, 4500);
});

test("planDrawing: short steps get minStepMs; long rows scale down to maxRowMs, short rows up to minRowMs", () => {
  const tiny = planDrawing(drawingOf([ground(P(0), P(0.1))]), MOTION);
  assert.equal(tiny.steps[0].endMs, 100);
  const long = planDrawing(drawingOf([ground(P(0), P(100))]), { ...MOTION, maxRowMs: 4000 });
  assert.equal(long.totalMs, 4000);
  near(long.steps[0].endMs, 4000 * (10000 / 10300));
  const short = planDrawing(drawingOf([ground(P(0), P(5))]), { ...MOTION, minRowMs: 2000 });
  assert.equal(short.totalMs, 2000);
});

test("normalDurationMs: 0 for admin rows, 2 to 4 s for every real play at the default motion", () => {
  assert.equal(normalDurationMs(buildDrawing(rowById("401872980353")), DEFAULT_MOTION), 0);
  for (const row of allRows()) {
    if (row.kind === "admin") continue;
    const ms = normalDurationMs(buildDrawing(row), DEFAULT_MOTION);
    assert.ok(ms >= 2000 && ms <= 4000, `${row.id} ${row.kind} ${ms}`);
  }
});

test("a motion with bad fields falls back to the defaults field by field", () => {
  const d = buildDrawing(rowById("4018729801915"));
  const fallback = planDrawing(d, { groundYps: -1, airYps: "fast", holdMs: Number.NaN });
  assert.deepEqual(fallback, planDrawing(d, DEFAULT_MOTION));
  assert.deepEqual(planDrawing(d), planDrawing(d, DEFAULT_MOTION));
});

test("fitPlan rescales uniformly; 0 means instant", () => {
  const plan = planDrawing(buildDrawing(rowById("4018729801915")), DEFAULT_MOTION);
  const fit = fitPlan(plan, 800);
  assert.equal(fit.totalMs, 800);
  const k = 800 / plan.totalMs;
  fit.steps.forEach((s, i) => {
    near(s.startMs, plan.steps[i].startMs * k);
    near(s.endMs, plan.steps[i].endMs * k);
  });
  const instant = fitPlan(plan, 0);
  assert.equal(instant.totalMs, 0);
  assert.ok(instant.steps.every((s) => s.startMs === 0 && s.endMs === 0));
  assert.deepEqual(fitPlan({ totalMs: 0, steps: [] }, 500), { totalMs: 0, steps: [] });
  assert.throws(() => fitPlan(plan, -5), TypeError);
  assert.throws(() => fitPlan(null, 100), TypeError);
  assert.throws(() => progressAt({ totalMs: 5 }, 0), TypeError);
});

test("progressAt reports every started step, finished ones at u 1", () => {
  const d = drawingOf([ground(P(0), P(20)), ground(P(20), P(40))]);
  const plan = planDrawing(d, MOTION);
  assert.deepEqual(progressAt(plan, -1), []);
  assert.deepEqual(progressAt(plan, 0), [{ index: 0, u: 0 }]);
  assert.deepEqual(progressAt(plan, 1000), [{ index: 0, u: 0.5 }]);
  assert.deepEqual(progressAt(plan, 3000), [{ index: 0, u: 1 }, { index: 1, u: 0.5 }]);
  assert.deepEqual(progressAt(plan, 99999), [{ index: 0, u: 1 }, { index: 1, u: 1 }]);
  const instant = fitPlan(plan, 0);
  assert.deepEqual(progressAt(instant, 0), [{ index: 0, u: 1 }, { index: 1, u: 1 }]);
});

test("ballAt follows the first DAL snap: back to the drop, up the arc, down at the target", () => {
  const d = buildDrawing(rowById("40187298068"));
  const plan = planDrawing(d, DEFAULT_MOTION);
  const start = ballAt(d, plan, 0);
  near(start.x, 30);
  near(start.y, C);
  assert.equal(start.h, 0);
  const arc = plan.steps[1];
  const mid = ballAt(d, plan, (arc.startMs + arc.endMs) / 2);
  assert.ok(mid.h > 0, "in the air mid-flight");
  assert.equal(mid.index, 1);
  const end = ballAt(d, plan, plan.totalMs);
  near(end.x, 35);
  near(end.h, 0);
  assert.equal(ballAt(buildDrawing(rowById("401872980353")), { totalMs: 0, steps: [] }, 0), null);
});

test("ballAt marks the ghost ball of a wiped-out play and walks the real one off", () => {
  const d = buildDrawing(rowById("401872980210"));
  const plan = planDrawing(d, DEFAULT_MOTION);
  const lane = plan.steps[1];
  assert.equal(ballAt(d, plan, (lane.startMs + lane.endMs) / 2).ghosted, true);
  const end = ballAt(d, plan, plan.totalMs);
  assert.equal(end.ghosted, false);
  near(end.x, 96);
});

test("sampleDrawing: keyframes from 0 to the end, finite, on the field", () => {
  for (const row of allRows()) {
    const d = buildDrawing(row);
    const plan = planDrawing(d, DEFAULT_MOTION);
    const keys = sampleDrawing(d, plan, { stepMs: 50 });
    if (row.kind === "admin") {
      assert.deepEqual(keys, []);
      continue;
    }
    assert.equal(keys[0].t, 0);
    assert.equal(keys.at(-1).t, plan.totalMs);
    for (let i = 1; i < keys.length; i += 1) assert.ok(keys[i].t > keys[i - 1].t, `${row.id} time order`);
    for (const { path, value } of numbersIn(keys)) assert.ok(Number.isFinite(value), `${row.id} ${path}`);
    for (const k of keys) {
      assert.ok(k.x >= -10 && k.x <= 110 && k.y >= 0 && k.y <= 53.333 && k.h >= 0, `${row.id} t ${k.t}`);
    }
  }
  assert.throws(() => sampleDrawing(buildDrawing(rowById("40187298068")), { totalMs: 10, steps: [] },
    { stepMs: 0 }), TypeError);
});

test("trackOf chains the ball through every step; a lane starts where the ball is", () => {
  const run = trackOf(buildDrawing(rowById("4018729802242")));
  assert.equal(run.length, 2);
  assert.equal(run[0].moves, true);
  assert.deepEqual(run[1].pts.map((p) => [p.x, Math.round(p.y * 1000) / 1000]),
    [[90, C], [86, C - 4], [14, C - 4]], "from the mesh, into the gap at the line, straight up the lane");
  const pass = trackOf(buildDrawing(rowById("4018729801915")));
  assert.deepEqual(pass.map((s) => s.kind), ["line", "arc", "still", "line"]);
  assert.deepEqual([pass[2].pts[0].x, pass[2].pts[0].y], [52, C], "the ball waits at the catch");
  assert.deepEqual(trackOf({ steps: [] }), []);
});

test("the kickoff peaks high above the field and the good field goal clears the crossbar", () => {
  const ko = buildDrawing(rowById("40187298040"));
  const koKeys = sampleDrawing(ko, planDrawing(ko, DEFAULT_MOTION), { stepMs: 20 });
  assert.ok(Math.max(...koKeys.map((k) => k.h)) > 15);
  const fg = buildDrawing(rowById("4018729802060"));
  const fgPlan = planDrawing(fg, DEFAULT_MOTION);
  const atPosts = ballAt(fg, fgPlan, fgPlan.steps[1].endMs);
  near(atPosts.x, 110);
  assert.ok(atPosts.h > 3.333);
});
