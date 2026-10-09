/**
 * Before each snap of the modeled caller, his most likely plays as shadow plays on the 2D field
 * (docs/design/play-drawing.md section 4, binding; ui-architecture.md 16.3 and 16.5, owner A6). field/shadows.js
 * builds them: the top 2 in the same shapes as real plays (a pass an arc, a run a line on the turf), from the line
 * of scrimmage, the hovered play lit (and drawn when it is outside the top 2), their text laid out in this view's
 * label metrics. This module turns what the conductor hands the engine into a shadow request and draws the result:
 * every stroke dashed, edge and core alike, at 50% for #1 and 35% for #2, with "1 · Inside run (A/B gap) · 27%" on a
 * dashed plate underneath. The world may tint them (look.ghost.fill) and pick their dash (look.ghost.style); they stay
 * dashed and translucent. Pure.
 */
import { LEAVES } from "../core/domain.js";
import { mixHex } from "../theme/team-colors.js";
import { FIELD } from "./coords.js";
import { OBLIQUE, r2, node, paintOf, tagNode, tagSize } from "./fallback-draw.js";
import { strokeStyle } from "./fallback-plays.js";
import { PASS_LIFT, stepParts } from "./fallback-steps.js";
import { isFiniteNum, ownValue } from "./grammar.js";
import { LABEL_METRICS, labelMetrics } from "./play-label.js";
import { SHADOW_COUNT, buildShadowPlays, shadowCandidates } from "./shadows.js";

/** The hovered (or focused) play's shadow: lit, still dashed and see-through. */
export const SHADOW_HOVER_OPACITY = 0.85;
/** While a play is hovered, the other shadows and their words step back by this much. */
const HOVER_DIM = 0.6;
const LABEL_DIM = 0.75;
const KEY_DIGITS = 4;
const CORE_MIX = 0.65;
const EDGE_DARK = 0.75;
/** As wide as a real play's strokes: a shadow is told apart by its dashes and its opacity, not by being thin. */
const WIDTH = Object.freeze({ core: 1, edgeExtra: 2.5 });
/** Dash and gap per ghost style, in edge widths, square-ended: short dashes read as a dashed line even on a 4-yard
 * run, and every gap shows the turf through. */
const DASH = Object.freeze({ zone: [1.1, 0.8], outline: [1.1, 0.8], marker: [1.1, 0.8], hatch: [0.5, 0.7],
  pixel: [0.8, 0.8] });
const PLATE_DASH = "4 3";

// ---------------------------------------------------------------- the request
const snapOf = (sit) => (sit && typeof sit === "object" && sit.kind !== "kickoff" && isFiniteNum(sit.ballX)
  && (sit.dir === 1 || sit.dir === -1) ? { ballX: sit.ballX, dir: sit.dir, poss: sit.poss ?? null, kind: "snap" } : null);
const pairOf = (e) => ({ leaf: e?.leaf, p: e?.p });

/** A GhostSet (field/ghosts.js, what the conductor builds today): its shapes in his order, every play's odds from
 * leafZones; the live situation names the team with the ball when it is the same snap. */
function fromGhostSet(set, live) {
  const same = live && live.ballX === set.ballX && live.dir === set.dir;
  return { key: typeof set.key === "string" ? set.key : null,
    source: { leaves: set.shapes.map(pairOf), all: (Array.isArray(set.leafZones) ? set.leafZones : []).map(pairOf) },
    situation: { ballX: set.ballX, dir: set.dir, poss: same ? live.poss ?? null : null } };
}

/** ShadowPlays a caller built already (shadows.js): their plays, odds and names, from the snap they start at. */
function fromShadowPlays(list) {
  const from = list.find((s) => s?.drawing?.steps?.[0]?.from)?.drawing;
  if (!from) return null;
  return { source: { leaves: list.map((s) => ({ ...pairOf(s), name: s?.name })) },
    situation: { ballX: from.steps[0].from.x, dir: from.dir, poss: from.team ?? null } };
}

/** A request of its own: { source (/api/state prediction, a row's pred, a ghost input), situation?, leafNames?,
 * leafOrder? }. */
const fromRequest = (req, live) => ({ source: req.source, situation: req.situation ?? live, leafNames: req.leafNames,
  leafOrder: req.leafOrder });

function rawOf(set, live) {
  if (Array.isArray(set)) return fromShadowPlays(set);
  if (Array.isArray(set.shapes)) return fromGhostSet(set, live);
  return set.source && typeof set.source === "object" ? fromRequest(set, live) : null;
}

/**
 * What showGhosts or showReview receives, as a shadow request { key, source, situation, leafNames, leafOrder }: a
 * GhostSet, ShadowPlays, or { source, situation? }. `situation` is the snap on the field (it names the team with the
 * ball). Null when no shadow could be drawn: no snap (no ball, a kickoff) or no usable odds.
 */
export function shadowInput(set, situation = null) {
  if (!set || typeof set !== "object") return null;
  const raw = rawOf(set, situation);
  const sit = snapOf(raw?.situation);
  if (!sit) return null;
  const opts = { leafNames: raw.leafNames ?? null, leafOrder: Array.isArray(raw.leafOrder) ? raw.leafOrder : LEAVES };
  const picks = shadowCandidates(raw.source, { leafNames: opts.leafNames ?? undefined, leafOrder: opts.leafOrder });
  if (!picks.length) return null;
  const key = raw.key ?? [sit.ballX, sit.dir, picks.map((c) => `${c.leaf}:${c.p.toFixed(KEY_DIGITS)}`).join(",")]
    .join("|");
  return Object.freeze({ key, source: raw.source, situation: Object.freeze(sit), ...opts });
}

/** The plays a request draws (the hovered one aside), in rank order: the #field data-ghosts hook. */
export function shownLeaves(input) {
  if (!input) return [];
  const opts = { leafNames: input.leafNames ?? undefined, leafOrder: input.leafOrder };
  return shadowCandidates(input.source, opts).slice(0, SHADOW_COUNT).map((c) => c.leaf);
}

// ---------------------------------------------------------------- layout in this view
/**
 * The 2D field as label metrics (play-label.labelMetrics): seen from straight above, the near sideline down the
 * screen, a height drawn as a lift (OBLIQUE yards for a kick, PASS_LIFT for a pass: the range a label must clear);
 * `labelPx` the tags' measured { charPx, linePx, padPx }.
 */
export function viewMetrics(ctx, ballX, labelPx = null) {
  const project = (p) => {
    const q = ctx.pt(p.x, p.y, p.h ?? 0);
    return { x: q.px, y: q.py };
  };
  const m = labelMetrics(project, { x: ballX, y: FIELD.CENTER_Y }, labelPx ?? {});
  return m === LABEL_METRICS ? m : Object.freeze({ ...m, lifts: [OBLIQUE, PASS_LIFT] });
}

/**
 * The ShadowPlays for a request in this view: `hover` the play the prediction panel hovers or focuses, `avoid` what
 * is already on the field (the previous play's Drawing), `labelPx` the tags' measured size. [] without a request.
 */
export function shadowPlaysFor(input, ctx, { hover = null, avoid = [], labelPx = null } = {}) {
  if (!input) return [];
  return buildShadowPlays(input.source, input.situation, { leafNames: input.leafNames ?? undefined,
    leafOrder: input.leafOrder, avoid, hover, metrics: viewMetrics(ctx, input.situation.ballX, labelPx) });
}

// ---------------------------------------------------------------- drawing
/** The shadows' colors: the caller's team ("team"), the field's paint ("neutral") or the look's own, with a darker
 * edge so a dashed line still reads on the turf. */
export function shadowPaint(ctx, team = null) {
  const { fill, stroke } = ctx.look.ghost;
  if (fill === "team") {
    const edge = paintOf(ctx, team ?? ctx.paints.left).edge;
    return { edge, core: mixHex(edge, stroke, CORE_MIX) };
  }
  const core = fill === "neutral" ? ctx.look.field.paint : fill;
  return { core, edge: mixHex(core, "#000000", EDGE_DARK) };
}

function shadowStyle(ctx, step, paint) {
  const base = strokeStyle(ctx, ownValue({ arc: "arc", ground: "ground" }, step.t) ?? "mark", null);
  const coreW = base.coreW * WIDTH.core;
  const edgeW = coreW + WIDTH.edgeExtra;
  const style = ctx.look.ghost.style;
  const [on, off] = ownValue(DASH, style) ?? DASH.zone;
  return { ...base, ...paint, coreW, edgeW, dash: `${r2(on * edgeW)} ${r2(off * edgeW)}`, dashEdge: true,
    approx: true, soft: false, pixel: true };
}

const partNode = (p) => ({ tag: p.tag, attrs: { ...p.attrs, "data-stroke": p.role },
  ...(p.children ? { children: p.children } : {}) });

function opacityOf(shadow, anyHovered) {
  if (shadow.hovered) return SHADOW_HOVER_OPACITY;
  return anyHovered ? r2(shadow.drawing.opacity * HOVER_DIM) : shadow.drawing.opacity;
}

function zoneOf(shadow, ctx, anyHovered) {
  const paint = shadowPaint(ctx, shadow.drawing.team);
  const steps = shadow.drawing.steps;
  const kids = steps.flatMap((step) => stepParts(step, ctx, shadowStyle(ctx, step, paint)).map(partNode));
  return { key: shadow.leaf, leaf: shadow.leaf, rank: shadow.rank, dir: shadow.drawing.dir, hovered: shadow.hovered,
    opacity: opacityOf(shadow, anyHovered), origin: ctx.pt(steps[0].from.x, steps[0].from.y),
    node: node("g", { class: "sc-fb-shadow", "data-part": "shadow", "data-leaf": shadow.leaf,
      "data-rank": shadow.rank ?? "", "data-hovered": String(shadow.hovered) }, kids) };
}

const showsLabels = (ctx) => ctx.look.ghost.labels && ctx.look.labels.renderer !== "none";

/** A shadow's words on a dashed plate: what the model thinks, not what happened. Text stays fully legible. */
function labelOf(shadow, ctx, anyHovered) {
  const at = ctx.pt(shadow.label.at.x, shadow.label.at.y);
  const tag = tagNode({ at, text: shadow.label.text, size: tagSize(ctx, "s"), part: "shadow-label",
    cls: `${ctx.look.labels.className} sc-ghost-label rank-${shadow.rank ?? 0} sc-fb-shadow-label` });
  const [plate, text] = tag.children;
  const dashed = { ...plate, attrs: { ...plate.attrs, style: `${plate.attrs.style}; stroke-dasharray: ${PLATE_DASH}` } };
  return { key: shadow.leaf, leaf: shadow.leaf, rank: shadow.rank, opacity: anyHovered && !shadow.hovered ? LABEL_DIM : 1,
    node: { ...tag, attrs: { ...tag.attrs, "data-leaf": shadow.leaf, "data-hovered": String(shadow.hovered) },
      children: [dashed, text] } };
}

/**
 * The shadows as keyed SVG specs: `zones` (one group of dashed strokes per play, `opacity` its target: 50% and 35%,
 * the hovered one lit and the rest stepped back; `origin` the line of scrimmage on screen, where it grows from) and
 * `labels` (their words). Keys are the plays, so a shadow that stays keeps its element and fades between opacities.
 */
export function shadowLayer(shadows, ctx) {
  const list = Array.isArray(shadows) ? shadows : [];
  const anyHovered = list.some((s) => s.hovered);
  return {
    zones: list.map((s) => zoneOf(s, ctx, anyHovered)),
    labels: showsLabels(ctx) ? list.map((s) => labelOf(s, ctx, anyHovered)) : [],
  };
}
