/**
 * One timeline row on the 2D field (ui-architecture.md 2.5 and 6.2, owner A6): every step of its field/paths.js
 * Drawing as SVG parts with the geometry to draw them part way, so the engine can animate a play by progress (a
 * stroke grows along its path; a lane grows with the ball; marks, areas and bands pop or fade in). Arcs are seen
 * from above at a slight tilt: the ground track stays on the turf and the flight bows toward the far sideline by its
 * apex (fallback-draw OBLIQUE), so a kick reads as a kick and its length stays true. Pure.
 *
 * Colors (DESIGN.md "The Light Core Rule"): every path has a light core (the team color mixed toward the look's core)
 * and carries the team color on its edge. Approximate steps take the look's approx style (dashed, hatch, soft or
 * pixel); ghosted steps (a no-play) take the stroke's ghostedOpacity and stay dashed: visibly not counted.
 */
import { deepFreeze } from "../core/domain.js";
import { verdictText } from "../model/verdict.js";
import { liftToLuminance, mixHex } from "../theme/team-colors.js";
import { r2, node, paintOf, tagNode, tagSize } from "./fallback-draw.js";
import { stepParts, subPath } from "./fallback-steps.js";
import { ballAt } from "./timing.js";

const CORE_MIX = 0.65;
const WIDTH = Object.freeze({ min: 2, max: 10, edgeMin: 2, edgeK: 0.6, fallback: 4 });
const LABEL_LIFT_YD = 2.6;
const CHIP_DROP_PX = 22;
const MAX_RESIDUE = 240;
const TRAIL_SAMPLES = 8;
const TRAIL_GLOW = 0.08;
const STROKE_OF = Object.freeze({ arc: "arc", ground: "ground", corridor: "corridor", area: "area", band: "band",
  mark: "mark" });
const VERDICT_TONE = Object.freeze({ top1: "good", top3: "warn", miss: "bad" });

const clamp01 = (u) => Math.min(1, Math.max(0, u));

// ---------------------------------------------------------------- styles
function dashFor(approx, w) {
  if (approx === "hatch") return `${r2(w)} ${r2(w)}`;
  if (approx === "pixel") return `${r2(w)} ${r2(w * 0.7)}`;
  if (approx === "soft") return null;
  return `${r2(3 * w)} ${r2(2 * w)}`;
}

function widthOf(ctx, spec) {
  const raw = Number.isFinite(spec.widthPx) ? spec.widthPx : Number.isFinite(spec.widthYd) ? ctx.yd(spec.widthYd) / 2
    : WIDTH.fallback;
  return Math.min(WIDTH.max, Math.max(WIDTH.min, raw));
}

function edgeColor(spec, paint) {
  if (spec.edge === "team") return paint.edge;
  if (spec.edge === "team-alt") return paint.alt;
  return spec.edge;
}

/** Colors, widths, dash and opacity of one step's strokes. */
export function strokeStyle(ctx, kind, team, { approx = false, ghosted = false, role = null } = {}) {
  const spec = ctx.look.strokes[kind];
  const march = role === "march";
  const edge = march ? mixHex(ctx.look.lines.ltg.color, "#000000", 0.45) : edgeColor(spec, paintOf(ctx, team));
  const core = march ? ctx.look.lines.ltg.color : mixHex(edge, spec.core, CORE_MIX);
  const coreW = widthOf(ctx, spec);
  const loose = approx || ghosted || march;
  const dash = loose ? dashFor(march ? "dashed" : spec.approx, coreW) : spec.dash ? spec.dash.join(" ") : null;
  return {
    edge, core, coreW, edgeW: coreW + Math.max(WIDTH.edgeMin, coreW * WIDTH.edgeK), dash, approx: loose,
    approxStyle: spec.approx, soft: loose && spec.approx === "soft", pixel: spec.approx === "pixel" || ctx.pixel,
    opacity: ghosted ? spec.ghostedOpacity : spec.opacity,
  };
}

// ---------------------------------------------------------------- partial geometry
const pt2 = (p) => `${r2(p.px)} ${r2(p.py)}`;

function laneAt(geom, k) {
  if (geom.kind === "cells") {
    return { visibility: "visible", d: geom.cells.filter((c) => c.t <= k + 1e-9).map((c) => c.d).join("") };
  }
  const cur = geom.ax + (geom.bx - geom.ax) * k;
  return { visibility: "visible", x: r2(Math.min(geom.ax, cur)), width: r2(Math.abs(cur - geom.ax)) };
}

function scaleAbout(cx, cy, s) {
  return `translate(${r2(cx)} ${r2(cy)}) scale(${r2(s)}) translate(${r2(-cx)} ${r2(-cy)})`;
}

/**
 * Attributes of a part at progress u (0 to 1) of its step: hidden before it starts, the full static part at 1.
 * Kinds: path (grows along its geometry), lane (a box growing from its start, or cells lit in travel order),
 * pop (scales up and fades in about its center), fade, end (appears when its step completes).
 */
export function partAt(part, u) {
  const k = clamp01(u);
  const kind = part.anim.kind;
  if (k <= 0 || (kind === "end" && k < 1)) return { visibility: "hidden" };
  if (kind === "path") return { visibility: "visible", d: subPath(part.anim.geom, k) };
  if (kind === "lane") return laneAt(part.anim.geom, k);
  if (kind === "pop") {
    const s = 0.6 + 0.4 * (1 - (1 - k) ** 3);
    const transform = k >= 1 ? null : scaleAbout(part.anim.cx, part.anim.cy, s);
    return { visibility: "visible", opacity: r2(k), transform };
  }
  if (kind === "fade") return { visibility: "visible", opacity: r2(k) };
  return { visibility: "visible" };
}

// ---------------------------------------------------------------- who has the ball
/** The team carrying (or kicking) on each step: possession flips after a turnover mark and after a kick's flight. */
export function carriersOf(row, drawing) {
  const other = (t) => (t === row.team ? row.opp : row.team) ?? t;
  const start = row.kind === "kickoff" ? (row.kick?.by ?? row.opp ?? row.team) : row.team;
  return drawing.steps.reduce((acc, step) => {
    const flips = (step.t === "mark" && step.role === "turnover")
      || (step.t === "arc" && (step.role === "punt" || step.role === "kickoff"));
    return { team: flips ? other(acc.team) : acc.team, out: [...acc.out, acc.team] };
  }, { team: start, out: [] }).out;
}

// ---------------------------------------------------------------- labels
const showsTags = (ctx) => ctx.look.labels.renderer !== "none";

function toneOfResult(text) {
  if (/INT|FUMBLE|TURNOVER|BLOCKED|MISSED|SAFETY/.test(text)) return "bad";
  return text === "FLAG" ? "warn" : "ink";
}

function labelSpec(drawing, ctx) {
  const label = drawing.resultLabel;
  if (!label || !ctx.look.labels.result || !showsTags(ctx)) return null;
  const at = ctx.pt(label.at.x, label.at.y + LABEL_LIFT_YD);
  const tag = tagNode({ at, text: label.text, tone: toneOfResult(label.text), size: tagSize(ctx, "s"),
    part: "result-label", cls: ctx.look.labels.className });
  return { text: label.text, at, node: tag };
}

function verdictSpec(drawing, ctx, verdict) {
  const text = verdictText(verdict);
  if (!text || !drawing.resultLabel || !showsTags(ctx)) return null;
  const base = ctx.pt(drawing.resultLabel.at.x, drawing.resultLabel.at.y + LABEL_LIFT_YD);
  const at = { px: base.px, py: base.py + CHIP_DROP_PX };
  return tagNode({ at, text, tone: VERDICT_TONE[verdict], size: tagSize(ctx, "xs"), part: "verdict",
    cls: `${ctx.look.labels.className} sc-fb-verdict` });
}

// ---------------------------------------------------------------- the play
function stepSpec(step, index, team, ctx) {
  const kind = STROKE_OF[step.t] ?? "mark";
  const style = strokeStyle(ctx, kind, team, { approx: Boolean(step.approx), ghosted: Boolean(step.ghosted),
    role: step.role });
  return { index, t: step.t, role: step.role, ghosted: Boolean(step.ghosted), approx: Boolean(step.approx), team,
    opacity: style.opacity, parts: stepParts(step, ctx, style) };
}

/**
 * The 2D drawing of a row: { seq, drive, team, steps: [{ index, t, role, ghosted, approx, team, opacity, parts }],
 * label: { text, at, node } | null, verdictNode }. A part is { role, tag, attrs (its finished state), anim }.
 * Never mutates the row or the drawing.
 */
export function playSpec(drawing, row, ctx, { verdict = null } = {}) {
  const carriers = carriersOf(row, drawing);
  return {
    seq: drawing.seq, drive: row.drive ?? null, team: drawing.team,
    steps: drawing.steps.map((step, i) => stepSpec(step, i, carriers[i], ctx)),
    label: labelSpec(drawing, ctx),
    verdictNode: verdictSpec(drawing, ctx, verdict),
  };
}

const partNode = (p) => (p.children
  ? { tag: p.tag, attrs: p.attrs, children: p.children } : { tag: p.tag, attrs: p.attrs });

/** A finished play as one node: every step at its opacity, every part complete; `opacity` dims the whole play. */
export function playNode(spec, opacity = 1) {
  return node("g", { class: "sc-fb-play", "data-seq": spec.seq ?? "", opacity }, spec.steps.map((step) =>
    node("g", { opacity: step.opacity, "data-step": step.t, "data-role": step.role }, step.parts.map(partNode))));
}

/** Where the ball rests after the play: the next snap's spot, else where the last step left it. */
export function restingBall(drawing, plan) {
  if (drawing.ballEnd) return { ...drawing.ballEnd, h: 0 };
  const end = plan ? ballAt(drawing, plan, plan.totalMs) : null;
  return end ? { x: end.x, y: end.y, h: 0 } : null;
}

/** The ball's trail behind it at tMs (look.ball.trail), as one stroke. */
export function trailNodes(drawing, plan, tMs, ctx, team) {
  const trail = ctx.look.ball.trail;
  if (trail.kind === "none" || !(trail.fadeMs > 0) || !(trail.widthPx > 0)) return [];
  const back = (k) => trail.fadeMs * (1 - k / (TRAIL_SAMPLES - 1));
  const times = Array.from({ length: TRAIL_SAMPLES }, (_, k) => Math.max(0, tMs - back(k)));
  const pts = times.map((t) => ballAt(drawing, plan, t)).filter(Boolean).map((b) => ctx.pt(b.x, b.y, b.h));
  if (pts.length < 2) return [];
  const color = trail.color === "team" ? liftToLuminance(paintOf(ctx, team).edge, TRAIL_GLOW) : trail.color;
  const d = pts.map((p, i) => `${i ? "L" : "M"}${pt2(p)}`).join("");
  const spark = trail.kind === "spark" ? { "stroke-dasharray": `1 ${r2(trail.widthPx * 2)}` } : {};
  return [node("path", { d, fill: "none", stroke: color, "stroke-width": trail.kind === "comet" ? trail.widthPx * 1.5
    : trail.widthPx, "stroke-opacity": 0.55, "stroke-linecap": "round", "stroke-linejoin": "round",
  "data-part": "trail", ...spark })];
}

// ---------------------------------------------------------------- what stays drawn
/** The next play becomes the last play; the old last play moves to residue per look.residue.keep. */
export function foldPlays(plays, entry, look) {
  if (!entry || !entry.drawing?.steps?.length) return plays;
  const last = plays.last;
  if (!last) return { last: entry, residue: plays.residue };
  const keep = look.residue.keep;
  const fresh = keep === "none" || (keep === "drive" && last.drive !== entry.drive);
  return { last: entry, residue: fresh ? [] : [...plays.residue, last].slice(-MAX_RESIDUE) };
}

/** The last play steps down to residue (look.lastPlay "until-presnap"). */
export function retireLast(plays, look) {
  if (!plays.last) return plays;
  const residue = look.residue.keep === "none" ? [] : [...plays.residue, plays.last].slice(-MAX_RESIDUE);
  return { last: null, residue };
}

export const PLAYS_EMPTY = deepFreeze({ last: null, residue: [] });
