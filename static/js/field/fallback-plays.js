/**
 * One timeline row on the 2D field (docs/design/play-drawing.md, binding; ui-architecture.md 2.5, 6.2 and 16.5,
 * owner A6): every step of its field/paths.js Drawing as SVG parts with the geometry to draw them part way, so the
 * engine can animate a play by progress (a stroke grows from the line of scrimmage along its path; marks pop in),
 * plus the play's words (drawing.label: "Deep pass left · +21") at the spot paths.js chose beside the end of the play.
 * Arcs are seen from above: the ground track stays on the turf and the flight bows toward the far sideline, a pass
 * by its whole apex (fallback-steps PASS_LIFT) so even a short throw reads as an arch, a kick by the slight tilt of
 * fallback-draw OBLIQUE; either way its length stays true. Pure.
 *
 * Colors (DESIGN.md "The Light Core Rule"): every path has a light core (the team color mixed toward the look's core)
 * and carries the team color on its edge. The real play draws solid; approximate steps (a kick's estimated landing,
 * a loose ball's runback) take the look's approx style (dashed, hatch, soft or pixel); ghosted steps (a no-play) take
 * the stroke's ghostedOpacity and stay dashed: visibly not counted.
 */
import { deepFreeze } from "../core/domain.js";
import { verdictText } from "../model/verdict.js";
import { liftToLuminance, mixHex } from "../theme/team-colors.js";
import { FIELD } from "./coords.js";
import { r2, node, paintOf, tagNode, tagSize } from "./fallback-draw.js";
import { plateNode } from "./fallback-plates.js";
import { shownHeight, stepParts, subPath, viewMetrics } from "./fallback-steps.js";
import { placePlayLabel } from "./paths.js";
import { resolvePlayLook } from "./play-style.js";
import { LAST_TAG } from "./shadows.js";
import { ballAt } from "./timing.js";

const CORE_MIX = 0.65;
const WIDTH = Object.freeze({ min: 2, max: 10, edgeMin: 2, edgeK: 0.6, fallback: 4 });
const CHIP_DROP_PX = 24;
const MAX_RESIDUE = 240;
const TRAIL_SAMPLES = 8;
const TRAIL_GLOW = 0.08;
const STROKE_OF = Object.freeze({ arc: "arc", ground: "ground", mark: "mark" });
/** Steps after which the other team has the ball: a lost ball, an interception, a kick's flight. */
const FLIP_MARKS = new Set(["turnover", "int"]);
const FLIP_ARCS = new Set(["punt", "kickoff"]);
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

/** Colors, widths, dash and opacity of one step's strokes; `last` (4b: the previous play while his next call is up)
 * draws it in muted steel (look.world.plays.last), never amber or warm white. */
export function strokeStyle(ctx, kind, team, { approx = false, ghosted = false, role = null, last = false } = {}) {
  const spec = ctx.look.strokes[kind];
  const march = role === "march";
  const steel = last ? resolvePlayLook(ctx.look).last : null;
  const own = march ? mixHex(ctx.look.lines.ltg.color, "#000000", 0.45) : edgeColor(spec, paintOf(ctx, team));
  const edge = steel?.edge ?? own;
  const core = steel?.core ?? (march ? ctx.look.lines.ltg.color : mixHex(edge, spec.core, CORE_MIX));
  const coreW = widthOf(ctx, spec);
  const loose = approx || ghosted || march;
  const dash = loose ? dashFor(march ? "dashed" : spec.approx, coreW) : spec.dash ? spec.dash.join(" ") : null;
  return {
    edge, core, coreW, edgeW: coreW + Math.max(WIDTH.edgeMin, coreW * WIDTH.edgeK), dash, approx: loose,
    approxStyle: spec.approx, soft: loose && spec.approx === "soft", pixel: spec.approx === "pixel" || ctx.pixel,
    opacity: ghosted ? spec.ghostedOpacity : spec.opacity, last,
  };
}

// ---------------------------------------------------------------- partial geometry
const pt2 = (p) => `${r2(p.px)} ${r2(p.py)}`;

function scaleAbout(cx, cy, s) {
  return `translate(${r2(cx)} ${r2(cy)}) scale(${r2(s)}) translate(${r2(-cx)} ${r2(-cy)})`;
}

/**
 * Attributes of a part at progress u (0 to 1) of its step: hidden before it starts, the full static part at 1.
 * Kinds: path (grows along its geometry from where the step starts), pop (scales up and fades in about its center),
 * fade, end (appears when its step completes).
 */
export function partAt(part, u) {
  const k = clamp01(u);
  const kind = part.anim.kind;
  if (k <= 0 || (kind === "end" && k < 1)) return { visibility: "hidden" };
  if (kind === "path") return { visibility: "visible", d: subPath(part.anim.geom, k) };
  if (kind === "pop") {
    const s = 0.6 + 0.4 * (1 - (1 - k) ** 3);
    const transform = k >= 1 ? null : scaleAbout(part.anim.cx, part.anim.cy, s);
    return { visibility: "visible", opacity: r2(k), transform };
  }
  if (kind === "fade") return { visibility: "visible", opacity: r2(k) };
  return { visibility: "visible" };
}

// ---------------------------------------------------------------- who has the ball
/** The team carrying (or kicking) on each step: possession flips after a turnover or INT mark and after a kick's
 * flight, so an interception's return and a punt's return take the other team's color. */
export function carriersOf(row, drawing) {
  const other = (t) => (t === row.team ? row.opp : row.team) ?? t;
  const start = row.kind === "kickoff" ? (row.kick?.by ?? row.opp ?? row.team) : row.team;
  return drawing.steps.reduce((acc, step) => {
    const flips = (step.t === "mark" && FLIP_MARKS.has(step.role)) || (step.t === "arc" && FLIP_ARCS.has(step.role));
    return { team: flips ? other(acc.team) : acc.team, out: [...acc.out, acc.team] };
  }, { team: start, out: [] }).out;
}

// ---------------------------------------------------------------- labels
const showsTags = (ctx) => ctx.look.labels.renderer !== "none";
/** The play's words show unless the look turns them off (labels.result: false, or no tags at all). */
const showsWords = (ctx) => showsTags(ctx) && ctx.look.labels.result !== false;
const BAD_WORDS = /intercepted|\u00b7 INT\b|fumble lost|muffed, lost|\u00b7 blocked|no good|\u00b7 safety/;
const WARN_WORDS = /^(No play|Flag)\b/;

/** The words' tone: a turnover, a block, a miss or a safety reads bad; a flag that wiped or replaced the play, warn. */
export function toneOfLabel(text) {
  if (BAD_WORDS.test(text)) return "bad";
  return WARN_WORDS.test(text) ? "warn" : "ink";
}

/**
 * Which way the words sit from the end of the play on screen (paths.js chose the spot beside its anchor): 1 below it,
 * -1 above. Without an anchor, by the center line the next ball rests on.
 */
function wordsSide(label, drawing) {
  const anchor = label?.anchor ?? drawing.resultLabel?.at;
  if (!label) return 1;
  if (anchor && label.at.y !== anchor.y) return label.at.y < anchor.y ? 1 : -1;
  return label.at.y < FIELD.CENTER_Y ? 1 : -1;
}

function labelSpec(label, ctx, side) {
  if (!label?.text || !showsWords(ctx)) return null;
  const at = ctx.pt(label.at.x, label.at.y);
  const tag = tagNode({ at, text: label.text, tone: toneOfLabel(label.text), size: tagSize(ctx, "s"),
    part: "play-label", cls: `${ctx.look.labels.className} sc-fb-play-label` });
  const marked = { ...tag, attrs: { ...tag.attrs, "data-approx": String(Boolean(label.approx)) } };
  return { text: label.text, at, side, node: marked };
}

/** 4b: the previous play's words on the LAST plate, its verdict on a second line in the same muted plate. */
function lastSpec(label, ctx, verdict, words) {
  if (!label?.text || !showsWords(ctx)) return null;
  const sub = typeof words === "string" && words.trim() ? words : verdictText(verdict) || "";
  const plate = plateNode({ tag: LAST_TAG, body: label.text, sub, tab: resolvePlayLook(ctx.look).last.core,
    tone: "muted", size: tagSize(ctx, "s"), part: "play-label", role: "last",
    cls: `${ctx.look.labels.className} sc-fb-play-label is-last` });
  return { text: label.text, at: ctx.pt(label.at.x, label.at.y), side: 1, node: plate };
}

function verdictSpec(label, ctx, verdict) {
  const text = verdictText(verdict);
  if (!text || !label) return null;
  const at = { px: label.at.px, py: label.at.py + label.side * CHIP_DROP_PX };
  return tagNode({ at, text, tone: VERDICT_TONE[verdict], size: tagSize(ctx, "xs"), part: "verdict",
    cls: `${ctx.look.labels.className} sc-fb-verdict` });
}

// ---------------------------------------------------------------- the play
/** `badge` is the screen direction a lettered mark (TD, INT) sits from its spot: away from the play's words. */
function stepSpec(step, index, team, ctx, badge, last) {
  const kind = STROKE_OF[step.t] ?? "mark";
  const style = strokeStyle(ctx, kind, team, { approx: Boolean(step.approx), ghosted: Boolean(step.ghosted),
    role: step.role, last });
  return { index, t: step.t, role: step.role, ghosted: Boolean(step.ghosted), approx: Boolean(step.approx), team,
    opacity: style.opacity, parts: stepParts(step, ctx, { ...style, badge }) };
}

/**
 * The 2D drawing of a row: { seq, drive, team, steps: [{ index, t, role, ghosted, approx, team, opacity, parts }],
 * label: { text, at, side, node } | null (drawing.label laid out in this view, paths.placePlayLabel: on a phone's
 * small field its words are deep, so they step further off the ball; `side` 1 when it sits below the end of the play
 * on screen, -1 above), verdictNode (on the far side of the words from the play), words (that label in field yards,
 * what the shadows' words keep clear of). A part is { role, tag, attrs (its finished state), anim }. `labelPx` is the
 * tags' measured size (the label model's when null). `last` (4b, while his next call is up): the play in muted steel
 * and its words on the LAST plate with the verdict (`verdictWords`, else the verdict's plain words) under them.
 * Never mutates the row or the drawing.
 */
export function playSpec(drawing, row, ctx, { verdict = null, labelPx = null, last = false,
  verdictWords = null } = {}) {
  const carriers = carriersOf(row, drawing);
  const words = placePlayLabel(drawing, viewMetrics(ctx, drawing.ballStart?.x, labelPx));
  const side = wordsSide(words, drawing);
  const label = last ? lastSpec(words, ctx, verdict, verdictWords) : labelSpec(words, ctx, side);
  return {
    seq: drawing.seq, drive: row.drive ?? null, team: drawing.team,
    steps: drawing.steps.map((step, i) => stepSpec(step, i, carriers[i], ctx, -side, last)),
    label,
    verdictNode: last ? null : verdictSpec(label, ctx, verdict),
    words,
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

/** The ball at tMs as the 2D field draws it: its height scaled to the arc it rides (fallback-steps shownHeight). */
export function shownBall(drawing, plan, tMs) {
  const b = ballAt(drawing, plan, tMs);
  const step = b && b.index >= 0 ? drawing.steps[b.index] : null;
  return b && step ? { ...b, h: shownHeight(step, b.h) } : b;
}

/** The ball's trail behind it at tMs (look.ball.trail), as one stroke. */
export function trailNodes(drawing, plan, tMs, ctx, team) {
  const trail = ctx.look.ball.trail;
  if (trail.kind === "none" || !(trail.fadeMs > 0) || !(trail.widthPx > 0)) return [];
  const back = (k) => trail.fadeMs * (1 - k / (TRAIL_SAMPLES - 1));
  const times = Array.from({ length: TRAIL_SAMPLES }, (_, k) => Math.max(0, tMs - back(k)));
  const pts = times.map((t) => shownBall(drawing, plan, t)).filter(Boolean).map((b) => ctx.pt(b.x, b.y, b.h));
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
