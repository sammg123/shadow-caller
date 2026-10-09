/**
 * Time for one drawing (paths.js): step timing from a Motion, fitting a plan into a time budget (DC E4), the
 * ball's track and keyframes, and easing. Pure: no DOM, no three.js, no clock (time is always passed in, in ms).
 *
 * A Plan is { totalMs, steps: [{ index, startMs, endMs }] } with one entry per drawing step, in order. Steps run
 * one after another; the row then holds for `holdMs`. A normal row lasts minRowMs to maxRowMs (2 to 4 s at 1x).
 */
import { deepFreeze } from "../core/domain.js";
import { isFiniteNum, requireNum } from "./grammar.js";

/** The default pace: 2 to 4 s per row at 1x. A world's look.motion overrides it field by field. */
export const DEFAULT_MOTION = Object.freeze({
  groundYps: 12, airYps: 22, kickYps: 20, markMs: 220, minStepMs: 160, holdMs: 350, maxRowMs: 4000, minRowMs: 2000,
});

const clamp01 = (u) => Math.min(1, Math.max(0, u));
const MS_PER_S = 1000;
const POSITIVE = new Set(["groundYps", "airYps", "kickYps", "maxRowMs"]);

function requirePlan(plan) {
  if (!plan || !Array.isArray(plan.steps) || !isFiniteNum(plan.totalMs)) {
    throw new TypeError("a plan needs totalMs and steps (planDrawing builds one)");
  }
  return plan;
}

// ---------------------------------------------------------------- easing
const outCubic = (u) => 1 - (1 - u) ** 3;
const inOutCubic = (u) => (u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2);
const inOutQuad = (u) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);

export const EASE = Object.freeze({
  linear: (u) => u,
  inQuad: (u) => u * u,
  outQuad: (u) => 1 - (1 - u) ** 2,
  inOutQuad,
  inCubic: (u) => u ** 3,
  outCubic,
  inOutCubic,
  inOutSine: (u) => -(Math.cos(Math.PI * u) - 1) / 2,
});

const SETTLE_ROLES = new Set(["snap", "hold", "march"]);

/** How a step moves: flights keep their ground speed, carries slow into the tackle, walks ease in and out. */
export function easeFor(step) {
  if (step?.t === "corridor") return EASE.inOutQuad;
  if (step?.t !== "ground") return EASE.linear;
  return SETTLE_ROLES.has(step.role) ? EASE.inOutCubic : EASE.outCubic;
}

// ---------------------------------------------------------------- sampling
/** A point on an arc: x and y move linearly, h = 4 * apex * u * (1 - u) + endH * u. */
export function sampleArc(from, to, apex, endH, u) {
  requireNum(apex, "apex");
  requireNum(endH, "endH");
  const k = clamp01(requireNum(u, "u"));
  return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, h: 4 * apex * k * (1 - k) + endH * k };
}

/** A point on a straight stroke; u is clamped to 0..1. */
export function sampleLine(from, to, u) {
  const k = clamp01(requireNum(u, "u"));
  return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
}

function lengthOf(pts) {
  return pts.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);
}

function sampleTrackPath(pts, u) {
  const total = lengthOf(pts);
  if (total === 0) return { x: pts[0].x, y: pts[0].y };
  const legs = pts.slice(1).map((p, i) => ({ a: pts[i], b: p, len: Math.hypot(p.x - pts[i].x, p.y - pts[i].y) }));
  const target = clamp01(u) * total;
  const found = legs.reduce((acc, leg) => {
    if (acc.hit) return acc;
    if (acc.walked + leg.len >= target) return { hit: leg, walked: acc.walked };
    return { hit: null, walked: acc.walked + leg.len };
  }, { hit: null, walked: 0 });
  const leg = found.hit ?? legs[legs.length - 1];
  return sampleLine(leg.a, leg.b, leg.len === 0 ? 1 : (target - found.walked) / leg.len);
}

function segmentOf(step, index, at) {
  const base = { index, ghosted: Boolean(step.ghosted) };
  if (step.t === "arc") {
    return { seg: { ...base, kind: "arc", moves: true, pts: [step.from, step.to], apex: step.apex, endH: step.endH },
      at: { ...step.to, h: step.endH } };
  }
  if (step.t === "ground") {
    return { seg: { ...base, kind: "line", moves: true, pts: [step.from, step.to] }, at: { ...step.to, h: 0 } };
  }
  if (step.t === "corridor") {
    const lane = [{ x: step.x0, y: step.yC }, { x: step.x1, y: step.yC }];
    const entry = at ?? lane[0];
    const pts = entry.x === lane[0].x && entry.y === lane[0].y ? lane : [entry, ...lane];
    return { seg: { ...base, kind: "path", moves: true, pts }, at: { ...lane[1], h: 0 } };
  }
  return { seg: { ...base, kind: "still", moves: false, pts: at ? [at] : [] }, at };
}

/**
 * The ball's track through a drawing, one segment per step: "arc" (from, to, apex, endH), "line" (from, to),
 * "path" (a lane, entered from wherever the ball was: no route is invented, the lane is the stroke) or "still"
 * (marks, areas and bands: the ball waits where it is).
 */
export function trackOf(drawing) {
  const steps = drawing?.steps ?? [];
  const start = drawing?.ballStart ? { ...drawing.ballStart, h: 0 } : null;
  const out = steps.reduce((acc, step, index) => {
    const { seg, at } = segmentOf(step, index, acc.at);
    return { at, segs: [...acc.segs, seg] };
  }, { at: start, segs: [] });
  return deepFreeze(out.segs);
}

function positionOn(seg, u) {
  if (seg.kind === "arc") return sampleArc(seg.pts[0], seg.pts[1], seg.apex, seg.endH, u);
  if (seg.kind === "still") return { x: seg.pts[0].x, y: seg.pts[0].y, h: seg.pts[0].h ?? 0 };
  return { ...sampleTrackPath(seg.pts, u), h: 0 };
}

// ---------------------------------------------------------------- plans
/** A Motion with every field checked; a missing or invalid field takes the default. */
export function resolveMotion(motion) {
  const given = motion && typeof motion === "object" ? motion : {};
  return Object.fromEntries(Object.entries(DEFAULT_MOTION).map(([key, fallback]) => {
    const v = given[key];
    const ok = isFiniteNum(v) && (POSITIVE.has(key) ? v > 0 : v >= 0);
    return [key, ok ? v : fallback];
  }));
}

function stepMs(step, seg, m) {
  if (step.t === "arc") {
    const speed = step.role === "pass" ? m.airYps : m.kickYps;
    return Math.max(m.minStepMs, (lengthOf(seg.pts) / speed) * MS_PER_S);
  }
  if (step.t === "ground" || step.t === "corridor") {
    return Math.max(m.minStepMs, (lengthOf(seg.pts) / m.groundYps) * MS_PER_S);
  }
  return m.markMs;
}

function scaled(plan, totalMs) {
  const k = plan.totalMs > 0 ? totalMs / plan.totalMs : 0;
  return deepFreeze({ totalMs: plan.totalMs > 0 ? totalMs : 0,
    steps: plan.steps.map((s) => ({ index: s.index, startMs: s.startMs * k, endMs: s.endMs * k })) });
}

/** Step times for a drawing: length / speed (at least minStepMs), marks take markMs, then holdMs; 2 to 4 s. */
export function planDrawing(drawing, motion = DEFAULT_MOTION) {
  const m = resolveMotion(motion);
  const steps = drawing?.steps ?? [];
  if (!steps.length) return deepFreeze({ totalMs: 0, steps: [] });
  const track = trackOf(drawing);
  const timed = steps.reduce((acc, step, index) => {
    const ms = stepMs(step, track[index], m);
    return { t: acc.t + ms, steps: [...acc.steps, { index, startMs: acc.t, endMs: acc.t + ms }] };
  }, { t: 0, steps: [] });
  const totalMs = timed.t + m.holdMs;
  return scaled({ totalMs, steps: timed.steps }, Math.min(m.maxRowMs, Math.max(m.minRowMs, totalMs)));
}

/** How long a row normally animates (0 for admin rows): the anim queue's normalMs (DC E4). */
export function normalDurationMs(drawing, motion = DEFAULT_MOTION) {
  return planDrawing(drawing, motion).totalMs;
}

/** The same plan squeezed or stretched to `durationMs` (0 = instant: every step starts and ends at 0). */
export function fitPlan(plan, durationMs) {
  if (!isFiniteNum(durationMs) || durationMs < 0) throw new TypeError("durationMs must be a finite number >= 0");
  return scaled(requirePlan(plan), durationMs);
}

/** Every step that has started at `tMs`, in order, with its 0..1 progress (finished steps report 1). */
export function progressAt(plan, tMs) {
  requireNum(tMs, "tMs");
  return requirePlan(plan).steps.filter((s) => s.startMs <= tMs).map((s) => ({
    index: s.index,
    u: s.endMs > s.startMs ? clamp01((tMs - s.startMs) / (s.endMs - s.startMs)) : 1,
  }));
}

function ballOnTrack(drawing, track, plan, tMs) {
  const start = drawing?.ballStart;
  const active = progressAt(plan, tMs);
  if (!track.length || !active.length) {
    return start ? { x: start.x, y: start.y, h: 0, index: -1, ghosted: false } : null;
  }
  const { index, u } = active[active.length - 1];
  const seg = track[index];
  return { ...positionOn(seg, easeFor(drawing.steps[index])(u)), index, ghosted: seg.ghosted };
}

/** The ball at `tMs` into a plan: { x, y, h, index, ghosted } (index -1 before the first step), or null. */
export function ballAt(drawing, plan, tMs) {
  return ballOnTrack(drawing, trackOf(drawing), plan, tMs);
}

/** Keyframes { t, x, y, h, index, ghosted } every `stepMs` from 0 to the plan's end (inclusive). */
export function sampleDrawing(drawing, plan, { stepMs = 40 } = {}) {
  if (!isFiniteNum(stepMs) || stepMs <= 0) throw new TypeError("stepMs must be a positive number");
  if (!drawing?.steps?.length) return [];
  const track = trackOf(drawing);
  const count = Math.ceil(plan.totalMs / stepMs);
  const times = [...Array.from({ length: count }, (_, i) => i * stepMs), plan.totalMs];
  return times.map((t) => ({ t, ...ballOnTrack(drawing, track, plan, t) }));
}
