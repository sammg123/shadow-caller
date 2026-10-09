/**
 * The prediction on the 2D field (ui-architecture.md 2.5 and 6.2, owner A6): the top three calls from
 * field/ghosts.js as zones and lanes, opacity by rank (look.ghost.opacity), in the look's ghost style, with his
 * percentage beside each. Zones, never routes (directions.md grammar). After the caller's snap only the top call
 * stays, at look.ghost.afterSnapOpacity, under the real play. Hovering a play on the board lights its zone fully and
 * dims the rest; a play outside the top three gets its zone from the full distribution (leafZones). Pure.
 *
 * Styles: zone (filled), outline, hatch (diagonal lines), pixel (lit 1-yard cells: every cell for the top call,
 * the outline cells for the others), marker (a dashed outline and a bar at the zone's far depth).
 */
import { pct1 } from "../model/format.js";
import { r2, boxRect, node, paintOf, tagNode, tagSize } from "./fallback-draw.js";
import { cellsInRect, cellsPath, outlineCells } from "./fallback-pixels.js";
import { isFiniteNum } from "./grammar.js";

const HIGHLIGHT_MIN = 0.75;
const DIM = 0.35;
const LANE_RADIUS_YD = 1;
const HATCH_PX = 7;
const MARK_BAR_YD = 0.6;
const NONE = Object.freeze({ zones: Object.freeze([]), labels: Object.freeze([]), defs: Object.freeze([]) });

/** The zones' color: the caller's team color ("team"), the field paint ("neutral"), or the look's own color. */
export function ghostFill(ctx) {
  const fill = ctx.look.ghost.fill;
  if (fill === "team") return paintOf(ctx, ctx.paints.left).edge;
  if (fill === "neutral") return ctx.look.field.paint;
  return fill;
}

function boxOf(shape) {
  if (shape.kind === "corridor") {
    return { x0: shape.x0, x1: shape.x1, y0: shape.yC - shape.halfWidth, y1: shape.yC + shape.halfWidth };
  }
  return { x0: shape.x0, x1: shape.x1, y0: shape.y0, y1: shape.y1 };
}

function pixelShape(ctx, shape, full, color) {
  const cells = cellsInRect(boxOf(shape));
  const lit = full ? cells : outlineCells(cells);
  const d = cellsPath(lit, (x, y) => ctx.pt(x, y), ctx.layout.px);
  return [node("path", { d, fill: color })];
}

function rectShape(ctx, shape, attrs) {
  const b = boxOf(shape);
  const rx = shape.kind === "corridor" ? r2(ctx.yd(LANE_RADIUS_YD)) : 1;
  return node("rect", { ...boxRect(ctx, b.x0, b.x1, b.y0, b.y1), rx, ...attrs });
}

function markerShape(ctx, shape, color, stroke) {
  const b = boxOf(shape);
  const far = shape.x1;
  const bar = boxRect(ctx, far - MARK_BAR_YD / 2, far + MARK_BAR_YD / 2, b.y0, b.y1);
  return [
    rectShape(ctx, shape, { fill: "none", stroke, "stroke-width": 1.5, "stroke-dasharray": "6 4" }),
    node("rect", { ...bar, fill: color }),
  ];
}

function shapeNodes(ctx, shape, { full, color, style }) {
  const stroke = ctx.look.ghost.stroke;
  if (style === "pixel") return pixelShape(ctx, shape, full, color);
  if (style === "marker" && !full) return markerShape(ctx, shape, color, stroke);
  if (style === "outline" && !full) {
    return [rectShape(ctx, shape, { fill: color, "fill-opacity": 0.18, stroke: color, "stroke-width": 2.5 })];
  }
  if (style === "hatch" && !full) {
    return [rectShape(ctx, shape, { fill: `url(#${ctx.ids}-hatch)`, stroke: color, "stroke-width": 1.5 })];
  }
  return [rectShape(ctx, shape, { fill: color, stroke, "stroke-opacity": 0.85, "stroke-width": 1.5 })];
}

function hatchDefs(ctx, color) {
  if (ctx.look.ghost.style !== "hatch") return [];
  return [node("defs", {}, [node("pattern", { id: `${ctx.ids}-hatch`, width: HATCH_PX, height: HATCH_PX,
    patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, [
    node("rect", { x: 0, y: 0, width: HATCH_PX, height: HATCH_PX, fill: color, "fill-opacity": 0.12 }),
    node("path", { d: `M0 0V${HATCH_PX}`, stroke: color, "stroke-width": 2.5 }),
  ])])];
}

function opacityOf(ctx, shape, { phase, highlight }) {
  const { opacity, afterSnapOpacity } = ctx.look.ghost;
  const base = phase === "aftersnap" ? (shape.rank === 1 ? afterSnapOpacity : 0) : opacity[shape.rank - 1] ?? 0;
  if (!highlight) return base;
  return shape.leaf === highlight ? Math.max(opacity[0], HIGHLIGHT_MIN) : base * DIM;
}

function zoneOf(ctx, shape, key, { opacity, highlighted, color }) {
  const full = highlighted || shape.rank === 1;
  const kids = shapeNodes(ctx, shape, { full, color, style: ctx.look.ghost.style });
  return { key, leaf: shape.leaf, rank: shape.rank, opacity, highlighted,
    node: node("g", { class: "sc-fb-ghost", "data-part": "ghost", "data-leaf": shape.leaf, "data-rank": shape.rank },
      kids) };
}

const EDGE_INSET_YD = 0.6;

/** Where a zone's percentage sits: a band's at its deep edge, inside it (clear of the ball); a lane's at its tip. */
function labelSpot(ctx, shape, dir) {
  if (shape.kind !== "band") return { at: ctx.pt(shape.label.at.x, shape.label.at.y), anchor: "middle" };
  const x = shape.x1 - dir * EDGE_INSET_YD;
  return { at: ctx.pt(x, shape.label.at.y), anchor: dir === 1 ? "end" : "start" };
}

function labelOf(ctx, shape, key, opacity, dir) {
  const { at, anchor } = labelSpot(ctx, shape, dir);
  const size = tagSize(ctx, shape.rank === 1 || key.startsWith("hl:") ? "m" : "s");
  const cls = `${ctx.look.labels.className} sc-ghost-label rank-${shape.rank}`;
  const tag = tagNode({ at, text: pct1(shape.p), anchor, size, part: "ghost-label", cls });
  return { key, leaf: shape.leaf, rank: shape.rank, opacity, node: tag };
}

/** The pattern defs a ghost style needs (hatch), for the field layer: they depend only on the look and teams. */
export const ghostDefs = (ctx) => hatchDefs(ctx, ghostFill(ctx));

const showsLabels = (ctx) => ctx.look.ghost.labels && ctx.look.labels.renderer !== "none";

function hoverShape(set, highlight) {
  if (!highlight || set.shapes.some((s) => s.leaf === highlight)) return null;
  const zone = (set.leafZones ?? []).find((z) => z.leaf === highlight);
  if (!zone) return null;
  const at = zone.kind === "corridor" ? { x: zone.x1, y: zone.yC } : { x: (zone.x0 + zone.x1) / 2, y: zone.y1 - 3 };
  return { ...zone, rank: 0, label: { at } };
}

/**
 * Zones and labels for a ghost set. `phase` is "presnap" or "aftersnap"; `highlight` a hovered leaf. Each zone and
 * label has a stable `key` (its leaf) and a target `opacity`, so fallback-svg.js can fade between states.
 */
export function ghostLayer(set, ctx, { phase = "presnap", highlight = null } = {}) {
  if (!set || !Array.isArray(set.shapes) || !isFiniteNum(set.ballX)) return NONE;
  const color = ghostFill(ctx);
  const opts = { phase, highlight };
  const zones = set.shapes.map((s) => zoneOf(ctx, s, s.leaf, { opacity: opacityOf(ctx, s, opts),
    highlighted: Boolean(highlight) && s.leaf === highlight, color }));
  const hover = phase === "presnap" ? hoverShape(set, highlight) : null;
  const hoverOpacity = Math.max(ctx.look.ghost.opacity[0], HIGHLIGHT_MIN);
  const extra = hover
    ? [zoneOf(ctx, hover, `hl:${hover.leaf}`, { opacity: hoverOpacity, highlighted: true, color })] : [];
  const labelOpacity = (s) => (phase === "aftersnap" ? 0 : highlight && s.leaf !== highlight ? DIM : 1);
  const dir = set.dir === -1 ? -1 : 1;
  const labels = showsLabels(ctx) ? [
    ...set.shapes.map((s) => labelOf(ctx, s, s.leaf, labelOpacity(s), dir)),
    ...(hover ? [labelOf(ctx, hover, `hl:${hover.leaf}`, 1, dir)] : []),
  ] : [];
  return { zones: [...zones, ...extra], labels, defs: hatchDefs(ctx, color) };
}
