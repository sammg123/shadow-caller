/**
 * The parts of one Drawing step on the 2D field (ui-architecture.md 2.4 table and 6.2, owner A6), used by
 * fallback-plays.js. Each part is { role, tag, attrs, anim, children? }: attrs are its finished state and anim says
 * how it draws part way (fallback-plays partAt). Pure.
 *
 *   arc       the ground track (the ball's shadow) plus the flight, a quadratic curve lifted by the apex
 *   ground    a straight stroke, with an arrowhead on runbacks, YAC, sacks, kneels and the penalty walk
 *   corridor  the lane (a soft-ended band, or lit cells) with its light core line
 *   area      the catch area: a ring, never a dot
 *   band      where an incompletion fell: the whole depth range of the side's third
 *   mark      a 9 by 9 glyph on a small plate (fallback-pixels GLYPHS)
 */
import { OBLIQUE, r2, boxRect, node, toneColor } from "./fallback-draw.js";
import {
  CELL_LIT, cellsInDisc, cellsInRect, cellsInRing, cellsPath, checkerCells, glyphPath, outlineCells,
} from "./fallback-pixels.js";
import { CROSSBAR_YD, ownValue } from "./grammar.js";

const HEADED = new Set(["yac", "return", "sack", "kneel", "march"]);
const MARKS = Object.freeze({
  td: ["td", "team"], turnover: ["x", "bad"], flag: ["flag", "flag"], sack: ["burst", "bad"], safety: ["burst", "warn"],
  fg_good: ["check", "good"], fg_miss: ["x", "bad"], touchback: ["diamond", "team"], fair_catch: ["ring", "team"],
  downed: ["square", "team"], oob: ["arrow", "team"], muffed: ["x", "warn"], blocked: ["bar", "bad"],
});
const MARK = Object.freeze({ yd: 2.4, minPx: 16, maxPx: 30, plate: 3 });
const SHADOW = Object.freeze({ opacity: 0.28, width: 1.5, dash: "2 5" });
const HEAD = Object.freeze({ length: 1.4, back: 0.6, wide: 0.7 });

const clamp01 = (u) => Math.min(1, Math.max(0, u));
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

const dashed = (style) => (style.dash ? { "stroke-dasharray": style.dash } : {});

function strokeParts(geom, style) {
  const d = subPath(geom, 1);
  const common = { d, fill: "none", "stroke-linecap": style.pixel ? "butt" : "round", "stroke-linejoin": "round" };
  const anim = { kind: "path", geom };
  const edgeFade = style.pixel && style.approx ? { "stroke-opacity": 0.6 } : {};
  const edge = style.soft ? [] : [part("edge", "path", { ...common, stroke: style.edge, "stroke-width": r2(style.edgeW),
    ...edgeFade }, anim)];
  const core = part("core", "path", { ...common, stroke: style.core, "stroke-width": r2(style.coreW), ...dashed(style) },
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
  const b = ctx.pt(step.to.x, step.to.y, step.endH);
  const ground = { kind: "line", a, b: ctx.pt(step.to.x, step.to.y) };
  const lift = 2 * step.apex * OBLIQUE * ctx.layout.px;
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

// ---------------------------------------------------------------- cells
const toPxOf = (ctx) => (x, y) => ctx.pt(x, y);

function cellsPart(role, cells, ctx, fill, progress, extra = {}) {
  const toPx = toPxOf(ctx);
  const list = cells.map((c) => ({ t: progress(c), d: cellsPath([c], toPx, ctx.layout.px) })).sort((p, q) => p.t - q.t);
  return part(role, "path", { d: list.map((c) => c.d).join(""), fill, ...extra },
    { kind: "lane", geom: { kind: "cells", cells: list } });
}

function pixelLane(step, ctx, style) {
  const cells = cellsInRect({ x0: step.x0, x1: step.x1, y0: step.yC - step.halfWidth, y1: step.yC + step.halfWidth });
  const span = step.x1 - step.x0;
  const progress = (c) => (span === 0 ? 1 : clamp01((c.i + 0.5 - step.x0) / span));
  const mid = Math.min(...cells.map((c) => Math.abs(c.j + 0.5 - step.yC)));
  const isCore = (c) => Math.abs(c.j + 0.5 - step.yC) === mid;
  return [
    cellsPart("lane", cells.filter((c) => !isCore(c)), ctx, style.edge, progress),
    cellsPart("lane", cells.filter(isCore), ctx, style.core, progress),
  ];
}

function corridorParts(step, ctx, style) {
  if (style.pixel) return pixelLane(step, ctx, style);
  const box = boxRect(ctx, step.x0, step.x1, step.yC - step.halfWidth, step.yC + step.halfWidth);
  const line = { kind: "line", a: ctx.pt(step.x0, step.yC), b: ctx.pt(step.x1, step.yC) };
  const lane = part("lane", "rect", { ...box, rx: r2((box.height / 2) * (style.soft ? 1 : 0.6)), fill: style.edge },
    { kind: "lane", geom: { kind: "box", ax: line.a.px, bx: line.b.px } });
  const core = part("core", "path", { d: subPath(line, 1), fill: "none", stroke: style.core,
    "stroke-width": r2(Math.max(2, box.height * 0.28)), "stroke-linecap": "round", ...dashed(style) },
  { kind: "path", geom: line });
  return [lane, core, ...headParts(line, style)];
}

function areaParts(step, ctx, style) {
  const c = ctx.pt(step.at.x, step.at.y);
  const anim = { kind: "pop", cx: c.px, cy: c.py };
  if (style.pixel) {
    const toPx = toPxOf(ctx);
    return [
      part("fill", "path", { d: cellsPath(cellsInDisc(step.at, step.r - 1), toPx, ctx.layout.px), fill: style.edge,
        "fill-opacity": 0.45 }, anim),
      part("core", "path", { d: cellsPath(cellsInRing(step.at, step.r, 1), toPx, ctx.layout.px), fill: style.core },
        anim),
    ];
  }
  const r = r2(ctx.yd(step.r));
  const at = { cx: r2(c.px), cy: r2(c.py) };
  return [
    part("fill", "circle", { ...at, r, fill: style.core, "fill-opacity": 0.22 }, anim),
    part("edge", "circle", { ...at, r, fill: "none", stroke: style.edge, "stroke-width": r2(style.edgeW * 0.6) }, anim),
    part("core", "circle", { ...at, r: r2(Math.max(1, r - 1)), fill: "none", stroke: style.core, "stroke-width": 1.5,
      ...dashed(style) }, anim),
  ];
}

function bandParts(step, ctx, style) {
  const anim = { kind: "fade" };
  if (style.pixel) {
    const cells = cellsInRect(step);
    const toPx = toPxOf(ctx);
    return [
      part("cells", "path", { d: cellsPath(checkerCells(cells), toPx, ctx.layout.px), fill: style.core }, anim),
      part("edge", "path", { d: cellsPath(checkerCells(outlineCells(cells), 1), toPx, ctx.layout.px), fill: style.edge,
        "fill-opacity": 0.6 }, anim),
    ];
  }
  const box = boxRect(ctx, step.x0, step.x1, step.y0, step.y1);
  return [
    part("fill", "rect", { ...box, fill: style.edge, "fill-opacity": 0.6 }, anim),
    part("core", "rect", { ...box, fill: "none", stroke: style.core, "stroke-width": 1.5,
      "stroke-dasharray": style.dash ?? "6 4" }, anim),
  ];
}

function markParts(step, ctx, style) {
  const [glyph, tone] = ownValue(MARKS, step.role) ?? ["square", "team"];
  const lift = step.role === "fg_good" || step.role === "fg_miss" ? CROSSBAR_YD : 0;
  const c = ctx.pt(step.at.x, step.at.y, lift);
  const size = Math.min(MARK.maxPx, Math.max(MARK.minPx, ctx.yd(MARK.yd)));
  const paint = tone === "team" ? { fill: style.core } : tone === "flag" ? { fill: ctx.look.lines.ltg.color }
    : { style: `fill: ${toneColor(tone)}` };
  const half = size / 2 + MARK.plate;
  const plate = node("rect", { x: r2(c.px - half), y: r2(c.py - half), width: r2(2 * half), height: r2(2 * half), rx: 2,
    style: "fill: var(--sc-surface-2); fill-opacity: 0.85" });
  const shape = node("path", { d: glyphPath(glyph, c, size, style.pixel ? CELL_LIT : 1), ...paint });
  return [part("mark", "g", { "data-mark": step.role }, { kind: "pop", cx: c.px, cy: c.py }, [plate, shape])];
}

const BUILDERS = Object.freeze({ arc: arcParts, ground: groundParts, corridor: corridorParts, area: areaParts,
  band: bandParts, mark: markParts });

/** The parts of one step in the given stroke style (fallback-plays strokeStyle). */
export function stepParts(step, ctx, style) {
  const build = ownValue(BUILDERS, step.t);
  return build ? build(step, ctx, style) : [];
}
