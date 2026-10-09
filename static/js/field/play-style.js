/**
 * How one play, or one shadow play, looks on the 3D field (A5 part 2; docs/design/play-drawing.md, binding). Pure: no
 * DOM, no three.js. A Drawing (paths.js) or a ShadowPlay (shadows.js) becomes a frozen list of "parts" that the
 * three.js action layer turns into meshes (play-art.js) and merges into residue (residue.js):
 *
 *   stroke  a path (an arc in the air, or a flat line on the turf) in two layers: the team-colored edge, a ring that
 *           stops where the core starts, and the light core (DESIGN.md "The Light Core Rule"); px or yd wide
 *   track   an arc's ground track: a thin dashed line on the turf under its flight (a depth cue, not data)
 *   arrow   a carry's arrowhead (run, scramble, YAC, return, sack, kneel, the penalty walk), edge and core
 *   mark    a glyph: the catch dot, the incompletion X, INT, TD, the flag, a sack burst, the kick marks
 *
 * Every color, width, dash and opacity comes from the Look: strokes.arc, strokes.ground and strokes.mark (geometry,
 * widths, core, edge, opacity, dash, ghostedOpacity, approx), lines.ltg (the flag and the penalty walk), ghost (the
 * shadow tint), ball.trail; the team colors (teamPaint, DC C2); the world's meaning colors (good, bad, warn: the
 * --sc-good|bad|warn tokens the page passes in); and look.world.plays (PLAY_LOOK) for what the schema has no key for.
 * The formulas match materials.js: a core is the edge mixed 65% toward the stroke's core, a no-play is mixed 60%
 * toward gray at ghostedOpacity and dashed, an estimate takes the stroke's approx style.
 */
import { deepFreeze, isPlainObject, safeHex } from "../core/domain.js";
import { mixHex } from "../theme/team-colors.js";
import { CROSSBAR_YD, isFiniteNum, ownValue } from "./grammar.js";
import { resolveLabelMetrics } from "./play-label.js";
import { sampleArc } from "./timing.js";

export const CORE_MIX = 0.65;
export const GHOSTED = deepFreeze({ gray: "#8a8f96", mix: 0.6 });
export const SOFT = 0.55;
/** A screen-width edge is this many times its core (materials.js); a turf-width (yd) edge this many. */
export const EDGE_WIDTH = 2.2;
const EDGE_WIDTH_YD = 1.6;
export const DASH_YD = deepFreeze([1.1, 0.7]);
/** Dashes for an estimate, by the look's approx style ("soft" draws solid at SOFT opacity instead). */
const APPROX_DASH = deepFreeze({ dashed: DASH_YD, hatch: [0.45, 0.45], pixel: [0.8, 0.8] });

/** look.world.plays: what the Look schema has no key for. Each key is optional; a bad value takes its default. */
export const PLAY_LOOK = deepFreeze({
  headGlow: 2.5,          // the tracer head: this many times the arc's light core (HDR, so it blooms when bloom is on)
  headYd: 1.3,            // its sprite, yards across
  trackOpacity: 0.28,     // an arc's ground track
  trackWidthPx: 1.5,
  trackDash: [0.5, 0.9],
  arrowYd: 1.6,           // a carry's arrowhead, yards long (0: none)
  hoverOpacity: 0.9,      // the shadow the prediction panel hovers or focuses
  dimOthers: 0.5,         // the other shadows meanwhile, times their own opacity
  shadowDash: [1.2, 0.8],
  shadowWidth: 1.25,      // a shadow's stroke, times the real core's width
  targetYd: 1.1,          // a predicted pass's target ring (radius) and a predicted run's chevron, yards
  tones: { good: null, bad: null, warn: null },   // else the page's --sc-good|bad|warn, else TONE_FALLBACK
});
export const TONE_FALLBACK = deepFreeze({ good: "#3fae6a", bad: "#e5484d", warn: "#f2b33d" });

/** Render order of each part (materials.js LAYERS: the turf's paint is 5 and 6, the air 8 and up). */
const ORDER = deepFreeze({
  track: 3.2, ground: { edge: 7.1, core: 7.2 }, arrow: { edge: 7.3, core: 7.4 }, mark: { edge: 7.5, core: 7.6 },
  arc: { edge: 8.1, core: 8.2 }, billboard: { edge: 9.1, core: 9.2 }, shadowGround: 7.8, shadowArc: 10,
});

const RANGES = Object.freeze({ headGlow: [0, 10], headYd: [0.01, 10], trackOpacity: [0, 1], trackWidthPx: [0.1, 16],
  arrowYd: [0, 6], hoverOpacity: [0, 1], dimOthers: [0, 1], shadowWidth: [0.25, 4], targetYd: [0, 5] });
const DASHES = Object.freeze(["trackDash", "shadowDash"]);
const TONES = Object.freeze(["good", "bad", "warn"]);
const HEADED = new Set(["run", "scramble", "yac", "return", "sack", "kneel", "march"]);
const MIN_PATH_YD = 0.05;
const ARC_SAMPLE_YD = 0.75;
const ARC_SAMPLES = Object.freeze([12, 120]);
const FLAG_EDGE_MIX = 0.45;
const APPROX_MARK = 0.6;
const POP_FROM = 1.6;
const DEFAULT_WIDTH = Object.freeze({ px: 3, yd: 0.6 });
const DEFAULT_MARK_YD = 2;
const FG_LIFT_YD = CROSSBAR_YD + 1.2;
const RING_POINTS = 28;
const TARGET_DASH = Object.freeze([0.45, 0.35]);
const CHEVRON = Object.freeze({ cos: Math.cos(Math.PI / 5), sin: Math.sin(Math.PI / 5) });
/** A shadow's end cue draws once its stroke is this far out (play-art revealAll). */
const END_LAG = 0.7;

/** Marks: the glyph, its words, its tone and its size against strokes.mark.widthYd. */
const MARKS = deepFreeze({
  catch: { glyph: "dot", tone: "team", scale: 0.55 }, incomplete: { glyph: "x", tone: "team" },
  int: { glyph: "text", text: "INT", tone: "bad", scale: 1.3 }, td: { glyph: "text", text: "TD", tone: "team", scale: 1.3 },
  turnover: { glyph: "x", tone: "bad" }, flag: { glyph: "flag", tone: "flag" }, sack: { glyph: "burst", tone: "bad" },
  safety: { glyph: "burst", tone: "warn" }, fg_good: { glyph: "check", tone: "good", lift: FG_LIFT_YD, billboard: true },
  fg_miss: { glyph: "x", tone: "bad", lift: FG_LIFT_YD, billboard: true }, touchback: { glyph: "diamond", tone: "team" },
  fair_catch: { glyph: "ring", tone: "team" }, downed: { glyph: "square", tone: "team" },
  oob: { glyph: "arrow", tone: "team" }, muffed: { glyph: "x", tone: "warn" }, blocked: { glyph: "bar", tone: "bad" },
});
const DEFAULT_MARK = deepFreeze({ glyph: "square", tone: "team" });

const clamp01 = (u) => Math.min(1, Math.max(0, u));
const hexOf = (v) => (safeHex(v) ? v.toLowerCase() : null);

// ---------------------------------------------------------------- the world's group
const inRange = (v, [lo, hi]) => isFiniteNum(v) && v >= lo && v <= hi;
const dashOf = (v) => (Array.isArray(v) && v.length === 2 && v[0] > 0 && v[0] <= 20 && inRange(v[1], [0, 20])
  ? [v[0], v[1]] : null);

/**
 * PLAY_LOOK with the world's look.world.plays over it (each key checked) and the tones resolved: the world's own,
 * else the page's (`tokens`: --sc-good|bad|warn as #rrggbb), else TONE_FALLBACK.
 */
export function resolvePlayLook(look, tokens = {}) {
  const given = isPlainObject(look?.world?.plays) ? look.world.plays : {};
  const nums = Object.fromEntries(Object.entries(RANGES).map(([k, range]) => [k,
    inRange(given[k], range) ? given[k] : PLAY_LOOK[k]]));
  const dashes = Object.fromEntries(DASHES.map((k) => [k, dashOf(given[k]) ?? [...PLAY_LOOK[k]]]));
  const own = isPlainObject(given.tones) ? given.tones : {};
  const page = isPlainObject(tokens) ? tokens : {};
  const tones = Object.fromEntries(TONES.map((k) => [k, hexOf(own[k]) ?? hexOf(page[k]) ?? TONE_FALLBACK[k]]));
  return deepFreeze({ ...nums, ...dashes, tones });
}

// ---------------------------------------------------------------- who has the ball
/** The team on each step: possession flips after an interception or lost ball, and after a kick's flight. */
export function carriersOf(row, drawing) {
  const other = (t) => (t === row.team ? row.opp : row.team) ?? t;
  const start = row.kind === "kickoff" ? (row.kick?.by ?? row.opp ?? row.team) : row.team;
  return (drawing?.steps ?? []).reduce((acc, step) => {
    const flips = (step.t === "mark" && (step.role === "turnover" || step.role === "int"))
      || (step.t === "arc" && (step.role === "punt" || step.role === "kickoff"));
    return { team: flips ? other(acc.team) : acc.team, out: [...acc.out, acc.team] };
  }, { team: start, out: [] }).out;
}

// ---------------------------------------------------------------- paths
/** A step's path in field yards ({ x, y, h } points, cumulative 3D length), or null for a mark. Arcs are sampled
 * evenly in their parameter, so a revealed fraction of the samples is exactly where the ball is. */
export function pathOf(step) {
  if (!step || (step.t !== "arc" && step.t !== "ground")) return null;
  const { from, to } = step;
  if (![from?.x, from?.y, to?.x, to?.y].every(isFiniteNum)) return null;
  const points = step.t === "ground" ? [{ x: from.x, y: from.y, h: 0 }, { x: to.x, y: to.y, h: 0 }] : arcSamples(step);
  const cum = points.reduce((acc, p, i) => [...acc, i ? acc[i - 1] + Math.hypot(p.x - points[i - 1].x,
    p.y - points[i - 1].y, p.h - points[i - 1].h) : 0], []);
  return { points, cum, length: cum.at(-1) };
}

function arcSamples(step) {
  const apex = isFiniteNum(step.apex) ? step.apex : 0;
  const endH = isFiniteNum(step.endH) ? step.endH : 0;
  const span = Math.hypot(step.to.x - step.from.x, step.to.y - step.from.y) + 2 * apex + endH;
  const n = Math.min(ARC_SAMPLES[1], Math.max(ARC_SAMPLES[0], Math.ceil(span / ARC_SAMPLE_YD)));
  return Array.from({ length: n + 1 }, (_, i) => sampleArc(step.from, step.to, apex, endH, i / n));
}

/** The distance along a path at parameter u (0..1): where the ball is, so a stroke grows exactly to it. */
export function revealAt(path, u) {
  const k = clamp01(isFiniteNum(u) ? u : 0) * (path.cum.length - 1);
  const i = Math.min(path.cum.length - 2, Math.floor(k));
  if (i < 0) return 0;
  return path.cum[i] + (path.cum[i + 1] - path.cum[i]) * (k - i);
}

// ---------------------------------------------------------------- colors and widths
function edgeOf(spec, paint) {
  if (spec.edge === "team") return hexOf(paint?.edge) ?? GHOSTED.gray;
  if (spec.edge === "team-alt") return hexOf(paint?.alt) ?? hexOf(paint?.edge) ?? GHOSTED.gray;
  return hexOf(spec.edge) ?? GHOSTED.gray;
}

/** The two colors of a stroke or mark: the tone's, the walk's yellow, else the team's (Light Core Rule). */
function colorsOf(look, spec, { paint, tone, tones }) {
  if (tone === "flag") {
    const ltg = hexOf(look.lines?.ltg?.color) ?? TONE_FALLBACK.warn;
    return { core: ltg, edge: mixHex(ltg, "#000000", FLAG_EDGE_MIX) };
  }
  const toned = tone && tone !== "team" ? hexOf(tones?.[tone]) : null;
  const edge = toned ?? edgeOf(spec, paint);
  return { edge, core: mixHex(edge, hexOf(spec.core) ?? "#ffffff", CORE_MIX) };
}

const ghost = (hex, ghosted) => (ghosted ? mixHex(hex, GHOSTED.gray, GHOSTED.mix) : hex);

function widthOf(spec) {
  const units = spec.geometry === "line2" ? "px" : "yd";
  const raw = units === "px" ? spec.widthPx : spec.widthYd;
  const width = isFiniteNum(raw) && raw > 0 ? raw : DEFAULT_WIDTH[units];
  return { units, width, edge: width * (units === "px" ? EDGE_WIDTH : EDGE_WIDTH_YD) };
}

function strokeLook(look, step, ctx) {
  const spec = look.strokes[step.t === "arc" ? "arc" : "ground"];
  const tone = step.role === "march" ? "flag" : step.role === "sack" ? "bad" : "team";
  const colors = colorsOf(look, spec, { ...ctx, tone });
  const ghosted = Boolean(step.ghosted);
  const approx = Boolean(step.approx);
  const base = ghosted ? spec.ghostedOpacity : spec.opacity;
  const dash = spec.dash ? [...spec.dash] : ghosted || step.role === "march" ? [...DASH_YD]
    : approx ? (ownValue(APPROX_DASH, spec.approx) ?? null) : null;
  return { ...widthOf(spec), edgeColor: ghost(colors.edge, ghosted), coreColor: ghost(colors.core, ghosted),
    opacity: approx && spec.approx === "soft" ? base * SOFT : base, dash: dash ? [...dash] : null };
}

// ---------------------------------------------------------------- parts
function strokeParts(step, index, look, ctx) {
  const path = pathOf(step);
  if (!path || path.length < MIN_PATH_YD) return [];
  const s = strokeLook(look, step, ctx);
  const order = step.t === "arc" ? ORDER.arc : ORDER.ground;
  const common = { step: index, type: "stroke", path, units: s.units, opacity: s.opacity, dash: s.dash, turf: true };
  const out = [
    { ...common, layer: "edge", width: s.edge, inner: s.width / s.edge, color: s.edgeColor, order: order.edge },
    { ...common, layer: "core", width: s.width, inner: 0, color: s.coreColor, order: order.core },
  ];
  return [...out, ...(step.t === "arc" ? [trackPart(step, index, path, ctx.plays, s.opacity)] : []),
    ...(HEADED.has(step.role) && step.t === "ground" ? arrowParts(step, index, s, ctx.plays) : [])];
}

function trackPart(step, index, path, plays, opacity) {
  const ground = pathOf({ t: "ground", from: step.from, to: step.to });
  return { step: index, type: "track", layer: "core", path: ground ?? path, units: "px", width: plays.trackWidthPx,
    inner: 0, color: "#000000", opacity: plays.trackOpacity * opacity, dash: [...plays.trackDash], order: ORDER.track,
    turf: true };
}

function arrowParts(step, index, s, plays) {
  if (!(plays.arrowYd > 0)) return [];
  const len = Math.hypot(step.to.x - step.from.x, step.to.y - step.from.y);
  const dir = { x: (step.to.x - step.from.x) / len, y: (step.to.y - step.from.y) / len };
  const common = { step: index, type: "arrow", at: { x: step.to.x, y: step.to.y, h: 0 }, dir, length: plays.arrowYd,
    width: plays.arrowYd * 0.9, opacity: s.opacity, dash: null, turf: true };
  return [{ ...common, layer: "edge", inner: 0.62, color: s.edgeColor, order: ORDER.arrow.edge },
    { ...common, layer: "core", inner: 0, color: s.coreColor, order: ORDER.arrow.core }];
}

function markParts(step, index, look, ctx) {
  if (!isFiniteNum(step.at?.x) || !isFiniteNum(step.at?.y)) return [];
  const m = ownValue(MARKS, step.role) ?? DEFAULT_MARK;
  const spec = look.strokes.mark;
  const colors = colorsOf(look, spec, { ...ctx, tone: m.tone });
  const ghosted = Boolean(step.ghosted);
  const base = ghosted ? spec.ghostedOpacity : spec.opacity;
  const opacity = step.approx ? base * (spec.approx === "soft" ? SOFT : APPROX_MARK) : base;
  const size = (isFiniteNum(spec.widthYd) && spec.widthYd > 0 ? spec.widthYd : DEFAULT_MARK_YD) * (m.scale ?? 1);
  const order = m.billboard ? ORDER.billboard : ORDER.mark;
  const common = { step: index, type: "mark", glyph: m.glyph, text: m.text ?? null, at: { x: step.at.x, y: step.at.y,
    h: 0 }, lift: m.lift ?? 0, size, opacity, dash: null, billboard: Boolean(m.billboard), turf: !m.billboard };
  return [{ ...common, layer: "edge", color: ghost(colors.edge, ghosted), order: order.edge },
    { ...common, layer: "core", color: ghost(colors.core, ghosted), order: order.core }];
}

/**
 * Every part of a real play: its strokes (edge and core), an arc's ground track, a carry's arrowhead, its marks, in
 * step order, each tagged with its step index (the renderer reveals parts by their step's progress). The team on each
 * step follows carriersOf. `env` = { paint(team) -> teamPaint, plays: resolvePlayLook(look, tokens) }.
 */
export function playParts(drawing, row, look, env) {
  const teams = carriersOf(row ?? {}, drawing);
  const plays = env?.plays ?? resolvePlayLook(look);
  const list = (drawing?.steps ?? []).flatMap((step, i) => {
    const ctx = { paint: env?.paint?.(teams[i]) ?? null, tones: plays.tones, plays };
    return step.t === "mark" ? markParts(step, i, look, ctx) : strokeParts(step, i, look, ctx);
  });
  return deepFreeze(list);
}

/** The shadow's tint: look.ghost.fill "team" (the team's light core toward ghost.stroke), "neutral" (ghost.stroke), a
 * color of its own. */
function tintOf(look, paint) {
  const g = look.ghost;
  const stroke = hexOf(g.stroke) ?? "#ffffff";
  if (g.fill === "team") return mixHex(hexOf(paint?.edge) ?? GHOSTED.gray, stroke, CORE_MIX);
  return g.fill === "neutral" ? stroke : hexOf(g.fill) ?? stroke;
}

/** A closed ring of points on the turf (the target a predicted pass is aimed at). */
function ringPath(at, radius) {
  const points = Array.from({ length: RING_POINTS + 1 }, (_, i) => {
    const a = (2 * Math.PI * i) / RING_POINTS;
    return { x: at.x + radius * Math.cos(a), y: at.y + radius * Math.sin(a), h: 0 };
  });
  return withCum(points);
}

/** A chevron at the end of a predicted run, pointing the way it goes. */
function chevronPath(step, size) {
  const len = Math.hypot(step.to.x - step.from.x, step.to.y - step.from.y);
  const d = { x: (step.to.x - step.from.x) / len, y: (step.to.y - step.from.y) / len };
  const wing = (s) => ({ x: step.to.x - size * (d.x * CHEVRON.cos - s * d.y * CHEVRON.sin),
    y: step.to.y - size * (d.y * CHEVRON.cos + s * d.x * CHEVRON.sin), h: 0 });
  return withCum([wing(1), { x: step.to.x, y: step.to.y, h: 0 }, wing(-1)]);
}

function withCum(points) {
  const cum = points.reduce((acc, p, i) => [...acc, i ? acc[i - 1] + Math.hypot(p.x - points[i - 1].x,
    p.y - points[i - 1].y) : 0], []);
  return { points, cum, length: cum.at(-1) };
}

/**
 * A shadow play (shadows.js): its one stroke dashed and translucent in the ghost tint, never solid, at the shadow's own
 * opacity (50% for #1, 35% after) or lit while hovered, the same widths as a real play's core; then, in the same shape
 * language, where it ends: a dashed ring where a pass is aimed, a chevron on a run (drawn once the stroke is out,
 * `lag`). The real play draws solid; this never does.
 */
export function shadowParts(shadow, look, env) {
  const step = shadow?.drawing?.steps?.[0];
  const path = pathOf(step);
  if (!path || path.length < MIN_PATH_YD) return deepFreeze([]);
  const plays = env?.plays ?? resolvePlayLook(look);
  const { units, width } = widthOf(look.strokes[step.t === "arc" ? "arc" : "ground"]);
  const own = isFiniteNum(step.opacity) ? step.opacity : shadow.drawing.opacity;
  const common = { step: 0, type: "stroke", layer: "core", units, inner: 0, turf: true,
    color: tintOf(look, env?.paint?.(shadow.drawing.team) ?? null), opacity: shadow.hovered ? plays.hoverOpacity : own };
  const stroke = { ...common, path, width: width * plays.shadowWidth, dash: [...plays.shadowDash], lag: 0,
    order: step.t === "arc" ? ORDER.shadowArc : ORDER.shadowGround };
  const end = step.t === "arc"
    ? { ...common, path: ringPath(step.to, plays.targetYd), width, dash: [...TARGET_DASH] }
    : { ...common, path: chevronPath(step, plays.targetYd), width: width * plays.shadowWidth, dash: null };
  return deepFreeze([stroke, { ...end, lag: END_LAG, order: ORDER.shadowGround }]);
}

// ---------------------------------------------------------------- small helpers the renderers share
/** A mark popping in over its step: from 1.6x, fading in; whole at 1. */
export function markPop(u) {
  const k = clamp01(isFiniteNum(u) ? u : 1);
  return { scale: POP_FROM - (POP_FROM - 1) * (1 - (1 - k) ** 3), opacity: k };
}

/** Where a verdict chip sits: one line down the screen from the play's words (the view's label metrics). */
export function chipSpot(label, metrics) {
  const m = resolveLabelMetrics(metrics);
  return { x: label.at.x + m.down.x * m.lineYd, y: label.at.y + m.down.y * m.lineYd };
}

/** The ball's trail (look.ball.trail): "team" is the carrier's light core (DESIGN.md: the tracer follows The Light
 * Core Rule). */
export function trailStyle(look, paint) {
  const t = look.ball.trail;
  const color = t.color === "team" ? mixHex(edgeOf(look.strokes.arc, paint), hexOf(look.strokes.arc.core) ?? "#ffffff",
    CORE_MIX) : hexOf(t.color) ?? "#ffffff";
  return { kind: t.kind, color, widthPx: t.widthPx, fadeMs: t.fadeMs };
}

const snapOf = (sit) => (isPlainObject(sit) && sit.kind !== "kickoff" && isFiniteNum(sit.ballX)
  && (sit.dir === 1 || sit.dir === -1) ? { ballX: sit.ballX, dir: sit.dir, kind: "snap", poss: sit.poss ?? null } : null);
const pairOf = (e) => ({ leaf: e?.leaf, p: e?.p });
const keyOf = (sit, leaves) => [sit.ballX, sit.dir, leaves.map((e) => `${e.leaf}:${Number(e.p).toFixed(4)}`).join(",")]
  .join("|");

/** A GhostSet (ghosts.js, what the conductor sends): its shapes in his order and every play's odds; the live snap
 * names the team when it is the same snap, else `poss` (the caller). */
function fromGhostSet(set, live, poss) {
  if (!set.shapes.length) return null;
  const same = live && live.ballX === set.ballX && live.dir === set.dir && typeof live.poss === "string";
  return { key: String(set.key ?? ""), source: { leaves: set.shapes.map(pairOf),
    all: (Array.isArray(set.leafZones) ? set.leafZones : []).map(pairOf) },
  situation: snapOf({ ballX: set.ballX, dir: set.dir, poss: same ? live.poss : poss }) };
}

/** ShadowPlays built already (shadows.js): their plays, odds and names, from the snap they start at. */
function fromShadowPlays(list) {
  const drawing = list.find((sp) => isFiniteNum(sp?.drawing?.steps?.[0]?.from?.x))?.drawing;
  if (!drawing) return null;
  const leaves = list.map((sp) => ({ ...pairOf(sp), name: sp?.name }));
  const situation = snapOf({ ballX: drawing.steps[0].from.x, dir: drawing.dir, poss: drawing.team ?? null });
  return situation ? { key: keyOf(situation, leaves), source: { leaves }, situation } : null;
}

/** A request of its own: { source (/api/state prediction, a row's pred, a ghost input), situation?, leafNames?,
 * leafOrder?, key? }; with no situation it is for the live snap. */
function fromRequest(req, live) {
  const situation = snapOf(req.situation ?? live);
  if (!situation || !isPlainObject(req.source)) return null;
  const leaves = Array.isArray(req.source.leaves) ? req.source.leaves : Array.isArray(req.source.top)
    ? req.source.top.map((t) => ({ leaf: t?.key, p: t?.p })) : [];
  return { key: typeof req.key === "string" ? req.key : keyOf(situation, leaves), source: req.source, situation,
    ...(req.leafNames ? { leafNames: req.leafNames } : {}), ...(Array.isArray(req.leafOrder)
      ? { leafOrder: req.leafOrder } : {}) };
}

/**
 * What the ghost layer draws for a call: buildShadowPlays' source and situation (and leafNames, leafOrder) from what
 * showGhosts or showReview receives, as the 2D field takes it (fallback-ghosts shadowInput): the conductor's GhostSet,
 * ShadowPlays, or { source, situation? }. `live` is the snap on the field; `poss` names the team when nothing else
 * does (a GhostSet carries none: the caller). Null when there is nothing to draw.
 */
export function shadowInputOf(set, { live = null, poss = null } = {}) {
  if (!set || typeof set !== "object") return null;
  if (Array.isArray(set)) return fromShadowPlays(set);
  if (Array.isArray(set.shapes)) {
    const out = fromGhostSet(set, live, poss);
    return out?.situation ? out : null;
  }
  return isPlainObject(set.source) ? fromRequest(set, live) : null;
}
