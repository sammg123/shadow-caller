/**
 * Before each snap of the modeled caller, his most likely plays as shadow plays on the 2D field
 * (docs/design/play-drawing.md sections 4 and 4b, binding; ui-architecture.md 16.3 and 16.5, owner A6).
 * field/shadows.js builds them: the top 2 in the same shapes as real plays (a pass an arc, a run a line on the turf),
 * each starting past the ball in its own lane, the hovered play lit (and drawn when it is outside the top 2). This
 * module turns what the conductor hands the engine into a shadow request and draws the result as 4b asks: each a thin
 * dashed line (plays.shadowPx, short dashes) over a thin dark ring, coloured by rank (#1 the world's amber, #2 warm
 * white, never a team), a small arrowhead on a run and a tick where a pass lands, never a band or a ring; and each
 * one's words on a tagged plate, "NEXT 1 · Inside run (A/B gap) · 27%" (fallback-plates.js), which fallback-words.js
 * places in screen space. Pure.
 */
import { LEAVES } from "../core/domain.js";
import { mixHex } from "../theme/team-colors.js";
import { r2, node, tagSize } from "./fallback-draw.js";
import { plateNode } from "./fallback-plates.js";
import { liftOf, shownHeight, subPath, viewMetrics } from "./fallback-steps.js";
import { isFiniteNum } from "./grammar.js";
import { resolvePlayLook } from "./play-style.js";
import { rankColor, shadowOpacity, shadowScale } from "./shadow-style.js";
import { SHADOW_COUNT, buildShadowPlays, shadowCandidates } from "./shadows.js";

/** The hovered (or focused) play's shadow: lit, still dashed and see-through. */
export const SHADOW_HOVER_OPACITY = 0.95;
/** While a play is hovered, the other shadows and their words step back by this much. */
const HOVER_DIM = 0.6;
const LABEL_DIM = 0.75;
const KEY_DIGITS = 4;
const EDGE_DARK = 0.75;
/** The thin dark ring under each dashed line, px each side, and how dark it is. */
const CASING = Object.freeze({ extraPx: 2.5, opacity: 0.55 });
/** Dash and gap in px: the look's yards at this view's scale, kept readable at any zoom. */
const DASH_PX = Object.freeze({ on: [4, 16], off: [3, 12] });
/** The end mark: a run's arrowhead, a pass's tick, the look's targetYd at this scale, in px. */
const END_PX = Object.freeze({ min: 5, max: 12 });
const WING = Object.freeze({ cos: Math.cos(Math.PI / 5), sin: Math.sin(Math.PI / 5) });

// ---------------------------------------------------------------- the request
/** The snap the shadows start at; its down when known (on 4th down they read "If he goes", shadows.js). */
function snapOf(sit) {
  if (!sit || typeof sit !== "object" || sit.kind === "kickoff" || !isFiniteNum(sit.ballX)) return null;
  if (sit.dir !== 1 && sit.dir !== -1) return null;
  const snap = { ballX: sit.ballX, dir: sit.dir, poss: sit.poss ?? null, kind: "snap" };
  return isFiniteNum(sit.down) ? { ...snap, down: sit.down } : snap;
}
const pairOf = (e) => ({ leaf: e?.leaf, p: e?.p });

/** A GhostSet (field/ghosts.js, what the conductor builds today): its shapes in his order, every play's odds from
 * leafZones; the live situation names the team with the ball, and the down, when it is the same snap. */
function fromGhostSet(set, live) {
  const same = live && live.ballX === set.ballX && live.dir === set.dir;
  return { key: typeof set.key === "string" ? set.key : null,
    source: { leaves: set.shapes.map(pairOf), all: (Array.isArray(set.leafZones) ? set.leafZones : []).map(pairOf) },
    situation: { ballX: set.ballX, dir: set.dir, poss: same ? live.poss ?? null : null, down: same ? live.down : null } };
}

/** ShadowPlays a caller built already (shadows.js): their plays, odds and names, from the snap they start at. */
function fromShadowPlays(list) {
  const from = list.find((s) => s?.drawing?.steps?.[0]?.from)?.drawing;
  if (!from) return null;
  return { source: { leaves: list.map((s) => ({ ...pairOf(s), name: s?.name })) },
    situation: { ballX: isFiniteNum(from.snapX) ? from.snapX : from.steps[0].from.x, dir: from.dir,
      poss: from.team ?? null } };
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
/** The 2D view as label metrics (fallback-steps.viewMetrics), here too for the shadows' callers. */
export { viewMetrics };

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
const plays = (ctx) => resolvePlayLook(ctx.look);
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

/** A shadow's colours (4b): its rank's on the world's ramp (#1 amber, #2 warm white; never a team's), and a darker
 * ring so the thin dashes hold on white paint. */
export function shadowPaint(ctx, rank = 1) {
  const core = rankColor(rank, plays(ctx));
  return { core, edge: mixHex(core, "#000000", EDGE_DARK) };
}

/** A stroke's geometry as the 2D field draws it (fallback-steps): a pass bows up the screen by its height. */
function geomOf(step, ctx) {
  if (step.t !== "arc") return { kind: "line", a: ctx.pt(step.from.x, step.from.y), b: ctx.pt(step.to.x, step.to.y) };
  const a = ctx.pt(step.from.x, step.from.y);
  const b = ctx.pt(step.to.x, step.to.y, shownHeight(step, step.endH ?? 0));
  const lift = 2 * step.apex * liftOf(step) * ctx.layout.px;
  return { kind: "quad", a, c: { px: (a.px + b.px) / 2, py: (a.py + b.py) / 2 - lift }, b };
}

/** The end mark's path: a small arrowhead at a run's tip, a tick across the spot a pass lands (screen px). */
function endPath(step, ctx, size) {
  const [a, b] = [ctx.pt(step.from.x, step.from.y), ctx.pt(step.to.x, step.to.y)];
  const len = Math.hypot(b.px - a.px, b.py - a.py) || 1;
  const d = { x: (b.px - a.px) / len, y: (b.py - a.py) / len };
  const pt = (p) => `${r2(p.x)} ${r2(p.y)}`;
  if (step.t === "arc") {
    const half = size / 2;
    const [p, q] = [{ x: b.px - d.y * half, y: b.py + d.x * half }, { x: b.px + d.y * half, y: b.py - d.x * half }];
    return `M${pt(p)}L${pt(q)}`;
  }
  const wing = (k) => ({ x: b.px - size * (d.x * WING.cos - k * d.y * WING.sin),
    y: b.py - size * (d.y * WING.cos + k * d.x * WING.sin) });
  return `M${pt(wing(1))}L${pt({ x: b.px, y: b.py })}L${pt(wing(-1))}`;
}

/** The thin line's style in this view: plays.shadowPx (scaled with the view), its dashes in px, its end mark size. */
function lineStyle(ctx) {
  const p = plays(ctx);
  const coreW = r2(p.shadowPx * shadowScale(ctx.layout.height));
  const dash = `${r2(clamp(p.shadowDash[0] * ctx.layout.px, DASH_PX.on))} ${r2(clamp(p.shadowDash[1] * ctx.layout.px,
    DASH_PX.off))}`;
  return { coreW, dash, end: clamp(p.targetYd * ctx.layout.px, [END_PX.min, END_PX.max]) };
}

function strokeNodes(d, paint, st, role) {
  const common = { d, fill: "none", "stroke-linecap": "butt", "stroke-linejoin": "round" };
  return [
    node("path", { ...common, stroke: paint.edge, "stroke-width": r2(st.coreW + CASING.extraPx),
      "stroke-opacity": CASING.opacity, ...(role === "line" ? { "stroke-dasharray": st.dash } : {}),
      "data-stroke": "edge", "data-role": role }),
    node("path", { ...common, stroke: paint.core, "stroke-width": st.coreW,
      ...(role === "line" ? { "stroke-dasharray": st.dash } : {}), "data-stroke": "core", "data-role": role }),
  ];
}

function opacityOf(shadow, anyHovered, ctx) {
  const p = plays(ctx);
  if (shadow.hovered) return p.hoverOpacity;
  const own = r2(shadowOpacity(shadow.drawing.opacity, p));
  return anyHovered ? r2(own * HOVER_DIM) : own;
}

function zoneOf(shadow, ctx, anyHovered) {
  const step = shadow.drawing.steps[0];
  const paint = shadowPaint(ctx, shadow.rank);
  const st = lineStyle(ctx);
  const kids = [...strokeNodes(subPath(geomOf(step, ctx), 1), paint, st, "line"),
    ...strokeNodes(endPath(step, ctx, st.end), paint, st, "end")];
  return { key: shadow.leaf, leaf: shadow.leaf, rank: shadow.rank, dir: shadow.drawing.dir, hovered: shadow.hovered,
    opacity: opacityOf(shadow, anyHovered, ctx), origin: ctx.pt(step.from.x, step.from.y),
    node: node("g", { class: "sc-fb-shadow", "data-part": "shadow", "data-leaf": shadow.leaf,
      "data-rank": shadow.rank ?? "", "data-hovered": String(shadow.hovered) }, kids) };
}

const showsLabels = (ctx) => ctx.look.ghost.labels && ctx.look.labels.renderer !== "none";

/** A shadow's words on a tagged plate (4b): "NEXT 1" on a tab in its colour, then its words; fallback-words places
 * it. Text stays fully legible. */
function labelOf(shadow, ctx, anyHovered) {
  const cls = `${ctx.look.labels.className} sc-ghost-label rank-${shadow.rank ?? 0} sc-fb-shadow-label`
    + ` family-${shadow.family}`;
  const plate = plateNode({ tag: shadow.label.tag ?? "", body: shadow.label.body ?? shadow.label.text,
    tab: shadowPaint(ctx, shadow.rank).core, size: tagSize(ctx, "s"), part: "shadow-label", cls,
    role: `next-${shadow.rank ?? 0}` });
  const opacity = anyHovered && !shadow.hovered ? LABEL_DIM : 1;
  return { key: shadow.leaf, leaf: shadow.leaf, rank: shadow.rank, opacity,
    node: { ...plate, attrs: { ...plate.attrs, "data-leaf": shadow.leaf, "data-hovered": String(shadow.hovered) } } };
}

/**
 * The shadows as keyed SVG specs: `zones` (one group per play, its thin dashed line and end mark, `opacity` its
 * target: #1 louder than #2, the hovered one lit and the rest stepped back; `origin` where it starts on screen, where
 * it grows from) and `labels` (their tagged plates). Keys are the plays, so a shadow that stays keeps its element and
 * fades between opacities.
 */
export function shadowLayer(shadows, ctx) {
  const list = Array.isArray(shadows) ? shadows : [];
  const anyHovered = list.some((s) => s.hovered);
  return {
    zones: list.map((s) => zoneOf(s, ctx, anyHovered)),
    labels: showsLabels(ctx) ? list.map((s) => labelOf(s, ctx, anyHovered)) : [],
  };
}
