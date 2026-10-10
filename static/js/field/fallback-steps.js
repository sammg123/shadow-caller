/**
 * The parts of one Drawing step on the 2D field (docs/design/play-drawing.md, binding; ui-architecture.md 16.1 and
 * 16.5, owner A6), used by fallback-plays.js for real plays and fallback-ghosts.js for shadow plays. Each part is
 * { role, tag, attrs, anim, children? }: attrs are its finished state and anim says how it draws part way
 * (fallback-plays partAt). Pure.
 *
 *   arc     the ground track (the ball's shadow) plus the flight, a quadratic curve lifted by the apex: a pass
 *           bows by its whole height (PASS_LIFT), so even a 5-yard throw reads as an arch beside a run's straight
 *           line; a kick by the field's slight tilt (OBLIQUE), so a punt stays on the field
 *   ground  one straight flat line on the turf (a run, a scramble, the YAC, a return, a sack, the penalty walk),
 *           with an arrowhead where the ball carrier went; a run for no gain is a dot at the line (a round cap)
 *   mark    catch: a small dot; incomplete: an X on the turf in the throw's colors; every other mark a glyph on a
 *           small plate (fallback-pixels GLYPHS), INT and TD lettered and set beside their spot like a badge
 *
 * A style (fallback-plays strokeStyle, fallback-ghosts for shadows) gives the colors, widths and dash; `dashEdge`
 * dashes the edge with the core, so a shadow's gaps are see-through.
 */
import { FIELD } from "./coords.js";
import { OBLIQUE, r2, node, toneColor } from "./fallback-draw.js";
import { CELL_LIT, GLYPH_SIZE, glyphCols, glyphPath } from "./fallback-pixels.js";
import { CROSSBAR_YD, ownValue } from "./grammar.js";
import { LABEL_METRICS, labelMetrics } from "./play-label.js";

/** Ground strokes that end in an arrowhead: where the ball carrier went (every ground role there is). */
const HEADED = new Set(["run", "scramble", "yac", "return", "sack", "kneel", "march"]);
/** Glyph and tone of each plate mark; catch and incomplete are drawn as strokes (MARK_BUILDERS). */
const MARKS = Object.freeze({
  td: ["td", "team"], int: ["int", "bad"], turnover: ["x", "bad"], flag: ["flag", "flag"], sack: ["burst", "bad"],
  safety: ["burst", "warn"], fg_good: ["check", "good"], fg_miss: ["x", "bad"], touchback: ["diamond", "team"],
  fair_catch: ["ring", "team"], downed: ["square", "team"], oob: ["arrow", "team"], muffed: ["x", "warn"],
  blocked: ["bar", "bad"],
});
const MARK = Object.freeze({ yd: 2.4, minPx: 16, maxPx: 30, plate: 3 });
/** Lettered marks sit this far beside their spot, like a badge (`style.badge`: -1 above, 1 below on screen, away from
 * the play's words), so the end of the play under them stays in view. */
const BADGES = new Set(["td", "int"]);
const BADGE_GAP_PX = 2;
const DOT = Object.freeze({ yd: 0.45, minPx: 3.5, maxPx: 6 });
const CROSS = Object.freeze({ yd: 0.9, minPx: 6, maxPx: 11, coreK: 0.3, minCore: 2, maxCore: 4, edgeExtra: 2.5 });
const SHADOW = Object.freeze({ opacity: 0.28, width: 1.5, dash: "2 5" });
const HEAD = Object.freeze({ length: 1.4, back: 0.6, wide: 0.7 });

/** Screen lift per yard of a pass's height, in yards toward the far sideline (kicks keep OBLIQUE). */
export const PASS_LIFT = 1;

/** How far up the screen a yard of this step's height is drawn: a pass's whole height, anything else OBLIQUE. */
export function liftOf(step) {
  return step?.t === "arc" && step.role === "pass" ? PASS_LIFT : OBLIQUE;
}

/** A height on a step as ctx.pt takes it (in OBLIQUE units), so the ball rides the arc as drawn. */
export const shownHeight = (step, h) => (h * liftOf(step)) / OBLIQUE;

/**
 * The 2D field as label metrics (play-label.labelMetrics), for every word laid out on it (a play's, the shadows'):
 * seen from straight above, the near sideline down the screen, a height drawn as a lift (OBLIQUE yards for a kick,
 * PASS_LIFT for a pass: the range a label must clear); `labelPx` the tags' measured { charPx, linePx, padPx }.
 */
export function viewMetrics(ctx, ballX = FIELD.MIDFIELD_X, labelPx = null) {
  const project = (p) => {
    const q = ctx.pt(p.x, p.y, p.h ?? 0);
    return { x: q.px, y: q.py };
  };
  const m = labelMetrics(project, { x: ballX, y: FIELD.CENTER_Y }, labelPx ?? {});
  return m === LABEL_METRICS ? m : Object.freeze({ ...m, lifts: [OBLIQUE, PASS_LIFT] });
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const part = (role, tag, attrs, anim, children = []) => (children.length
  ? { role, tag, attrs, anim, children } : { role, tag, attrs, anim });
const lerp = (a, b, k) => ({ px: a.px + (b.px - a.px) * k, py: a.py + (b.py - a.py) * k });
const pt2 = (p) => `${r2(p.px)} ${r2(p.py)}`;

/** Path data of a line or quadratic geometry from its start to progress k (de Casteljau split for the curve). */
export function subPath(geom, k) {
  if (geom.kind === "line") return `M${pt2(geom.a)}L${pt2(lerp(geom.a, geom.b, k))}`;
  const c1 = lerp(geom.a, geom.c, k);
  const end = lerp(c1, lerp(geom.c, geom.b, k), k);
  return `M${pt2(geom.a)}Q${pt2(c1)} ${pt2(end)}`;
}

const dashOf = (style) => (style.dash ? { "stroke-dasharray": style.dash } : {});
const capOf = (style) => (style.pixel ? "butt" : "round");

function strokeParts(geom, style) {
  const d = subPath(geom, 1);
  const common = { d, fill: "none", "stroke-linecap": capOf(style), "stroke-linejoin": "round" };
  const anim = { kind: "path", geom };
  const edgeFade = style.pixel && style.approx && !style.dashEdge ? { "stroke-opacity": 0.6 } : {};
  const edgeDash = style.dashEdge ? dashOf(style) : {};
  const edge = style.soft ? [] : [part("edge", "path", { ...common, stroke: style.edge, "stroke-width": r2(style.edgeW),
    ...edgeFade, ...edgeDash }, anim)];
  const core = part("core", "path", { ...common, stroke: style.core, "stroke-width": r2(style.coreW), ...dashOf(style) },
    anim);
  return [...edge, core];
}

function headParts(geom, style) {
  const { a, b } = geom;
  const len = Math.hypot(b.px - a.px, b.py - a.py);
  if (len < 1) return [];
  const [ux, uy] = [(b.px - a.px) / len, (b.py - a.py) / len];
  const s = style.edgeW * HEAD.length;
  const back = { px: b.px - ux * s * HEAD.back, py: b.py - uy * s * HEAD.back };
  const tip = { px: b.px + ux * s * HEAD.back, py: b.py + uy * s * HEAD.back };
  const side = (k) => ({ px: back.px - uy * s * HEAD.wide * k, py: back.py + ux * s * HEAD.wide * k });
  return [part("head", "path", { d: `M${pt2(tip)}L${pt2(side(1))}L${pt2(side(-1))}z`, fill: style.core,
    stroke: style.edge, "stroke-width": 1, "stroke-linejoin": "round" }, { kind: "end" })];
}

function arcParts(step, ctx, style) {
  const a = ctx.pt(step.from.x, step.from.y);
  const b = ctx.pt(step.to.x, step.to.y, shownHeight(step, step.endH));
  const ground = { kind: "line", a, b: ctx.pt(step.to.x, step.to.y) };
  const lift = 2 * step.apex * liftOf(step) * ctx.layout.px;
  const geom = { kind: "quad", a, c: { px: (a.px + b.px) / 2, py: (a.py + b.py) / 2 - lift }, b };
  const shadow = part("shadow", "path", { d: subPath(ground, 1), fill: "none", stroke: "#000000",
    "stroke-opacity": SHADOW.opacity, "stroke-width": SHADOW.width, "stroke-dasharray": SHADOW.dash,
    "stroke-linecap": "round" }, { kind: "path", geom: ground });
  return [shadow, ...strokeParts(geom, style)];
}

function groundParts(step, ctx, style) {
  const geom = { kind: "line", a: ctx.pt(step.from.x, step.from.y), b: ctx.pt(step.to.x, step.to.y) };
  return [...strokeParts(geom, style), ...(HEADED.has(step.role) ? headParts(geom, style) : [])];
}

// ---------------------------------------------------------------- marks
/** The catch: a small dot in the pass's colors (no catch-area circle). */
function dotParts(step, ctx, style) {
  const c = ctx.pt(step.at.x, step.at.y);
  const [cx, cy] = [r2(c.px), r2(c.py)];
  const r = r2(clamp(ctx.yd(DOT.yd), DOT.minPx, DOT.maxPx));
  return [part("mark", "circle", { cx, cy, r, fill: style.core, stroke: style.edge, "stroke-width": r2(Math.max(1.5,
    r * 0.45)), "data-mark": step.role }, { kind: "pop", cx, cy })];
}

/** An incompletion: a clear X on the turf where the ball came down, a light core inside the throw's edge color. */
function crossParts(step, ctx, style) {
  const c = ctx.pt(step.at.x, step.at.y);
  const s = clamp(ctx.yd(CROSS.yd), CROSS.minPx, CROSS.maxPx);
  const corner = (dx, dy) => `${r2(c.px + dx * s)} ${r2(c.py + dy * s)}`;
  const d = `M${corner(-1, -1)}L${corner(1, 1)}M${corner(1, -1)}L${corner(-1, 1)}`;
  const coreW = r2(clamp(s * CROSS.coreK, CROSS.minCore, CROSS.maxCore));
  const cap = style.pixel ? "square" : "round";
  const stroke = (color, width) => node("path", { d, fill: "none", stroke: color, "stroke-width": width,
    "stroke-linecap": cap, ...(style.dashEdge ? dashOf(style) : {}) });
  return [part("mark", "g", { "data-mark": step.role }, { kind: "pop", cx: c.px, cy: c.py },
    [stroke(style.edge, r2(coreW + CROSS.edgeExtra)), stroke(style.core, coreW)])];
}

const MARK_BUILDERS = Object.freeze({ catch: dotParts, incomplete: crossParts });

function glyphMark(step, ctx, style) {
  const [glyph, tone] = ownValue(MARKS, step.role) ?? ["square", "team"];
  const lift = step.role === "fg_good" || step.role === "fg_miss" ? CROSSBAR_YD : 0;
  const size = Math.min(MARK.maxPx, Math.max(MARK.minPx, ctx.yd(MARK.yd)));
  const [halfW, halfH] = [(size * glyphCols(glyph)) / GLYPH_SIZE / 2 + MARK.plate, size / 2 + MARK.plate];
  const spot = ctx.pt(step.at.x, step.at.y, lift);
  const away = style.badge === 1 ? 1 : -1;
  const c = BADGES.has(step.role) ? { px: spot.px, py: spot.py + away * (halfH + BADGE_GAP_PX) } : spot;
  const paint = tone === "team" || style.last ? { fill: style.core } : tone === "flag" ? { fill: ctx.look.lines.ltg.color }
    : { style: `fill: ${toneColor(tone)}` };
  const plate = node("rect", { x: r2(c.px - halfW), y: r2(c.py - halfH), width: r2(2 * halfW), height: r2(2 * halfH),
    rx: 2, style: "fill: var(--sc-surface-2); fill-opacity: 0.85" });
  const shape = node("path", { d: glyphPath(glyph, c, size, style.pixel ? CELL_LIT : 1), ...paint });
  return [part("mark", "g", { "data-mark": step.role }, { kind: "pop", cx: c.px, cy: c.py }, [plate, shape])];
}

function markParts(step, ctx, style) {
  const build = ownValue(MARK_BUILDERS, step.role) ?? glyphMark;
  return build(step, ctx, style);
}

const BUILDERS = Object.freeze({ arc: arcParts, ground: groundParts, mark: markParts });

/** The parts of one step in the given stroke style; a step kind the grammar no longer has draws nothing. */
export function stepParts(step, ctx, style) {
  const build = ownValue(BUILDERS, step.t);
  return build ? build(step, ctx, style) : [];
}
