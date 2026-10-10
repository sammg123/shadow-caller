/**
 * Words on the field placed in screen space, after projection (docs/design/play-drawing.md 4b rule 4, binding). Pure:
 * no DOM, no three.js; both engines hand it pixels (y down).
 *
 * Each label tries spots around its anchors, nearest first (a ring at a time: right beside the anchor on each of its
 * sides, then a step further out, ...), and takes the first whose box stays inside the free area and clear of every
 * label placed before it, every box obstacle (the ball, the field's legend) and every stroke dot (a stroke sampled
 * every few pixels, each dot with the stroke's half width and a margin). A label that sits away from its anchor gets
 * a thin leader line back to it, and that line must not cross another label or the ball either. Labels go in priority
 * order; one with no clear spot takes the spot that covers least, text over text last of all. `keep` (the choice the
 * last layout made for that label) is tried first, so a camera move or a relayout never makes the words jump while
 * their old spot is still clear.
 *
 * A box is { x0, y0, x1, y1 }; a dot { x, y, r }; a label { id, w, h, anchors: [{ x, y, sides }], keep? }, where
 * `sides` lists SIDES in order of preference.
 */
import { deepFreeze } from "../core/domain.js";
import { isFiniteNum } from "./grammar.js";

/** Pixels: the gap between an anchor and its label, each ring's step out, how many rings, the farthest a label sits
 * before it needs a leader, the gap kept between two labels, and between a label and the free area's edge. */
export const PLACE = deepFreeze({ gapPx: 12, stepPx: 14, rings: 7, leaderPx: 16, labelGapPx: 4, edgePx: 4,
  // the last resort before a spot that covers something: anywhere on a grid this far around the first anchor
  roamX: 320, roamY: 220, roamStepX: 16, roamStepY: 8 });

const DIAG = Math.SQRT1_2;
/** Where a label's box goes around an anchor at distance d: its center, from the anchor (x right, y down). */
export const SIDES = deepFreeze({
  right: (w, h, d) => ({ x: d + w / 2, y: 0 }),
  left: (w, h, d) => ({ x: -d - w / 2, y: 0 }),
  below: (w, h, d) => ({ x: 0, y: d + h / 2 }),
  above: (w, h, d) => ({ x: 0, y: -d - h / 2 }),
  "below-right": (w, h, d) => ({ x: d * DIAG + w / 2, y: d * DIAG + h / 2 }),
  "below-left": (w, h, d) => ({ x: -d * DIAG - w / 2, y: d * DIAG + h / 2 }),
  "above-right": (w, h, d) => ({ x: d * DIAG + w / 2, y: -d * DIAG - h / 2 }),
  "above-left": (w, h, d) => ({ x: -d * DIAG - w / 2, y: -d * DIAG - h / 2 }),
});
const ALL_SIDES = Object.freeze(Object.keys(SIDES));
/** A choice off the sides: its own offset from the anchor (roamChoices). */
const FREE = "free";

/** What a spot costs when it can't be clear: text on text worst, then the ball, the edge, a leader across, strokes. */
const COST = Object.freeze({ label: 1e6, box: 1e4, out: 1e3, leader: 500, dot: 10, ring: 1 });

const isPt = (p) => isFiniteNum(p?.x) && isFiniteNum(p?.y);
const boxAt = (c, w, h) => ({ x0: c.x - w / 2, y0: c.y - h / 2, x1: c.x + w / 2, y1: c.y + h / 2 });
const grow = (b, k) => ({ x0: b.x0 - k, y0: b.y0 - k, x1: b.x1 + k, y1: b.y1 + k });
const meets = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const holds = (b, p) => p.x > b.x0 && p.x < b.x1 && p.y > b.y0 && p.y < b.y1;
const inside = (b, frame) => b.x0 >= frame.x0 && b.y0 >= frame.y0 && b.x1 <= frame.x1 && b.y1 <= frame.y1;

/** The point of box `b` nearest `p` (p itself when inside). */
function nearestOn(b, p) {
  return { x: Math.min(b.x1, Math.max(b.x0, p.x)), y: Math.min(b.y1, Math.max(b.y0, p.y)) };
}

/** Whether segment pq passes through box b (Liang-Barsky clip). */
export function segmentHitsBox(p, q, b) {
  let [t0, t1] = [0, 1];
  const d = { x: q.x - p.x, y: q.y - p.y };
  const edges = [[-d.x, p.x - b.x0], [d.x, b.x1 - p.x], [-d.y, p.y - b.y0], [d.y, b.y1 - p.y]];
  for (const [pk, qk] of edges) {
    if (Math.abs(pk) < 1e-12) {
      if (qk < 0) return false;
      continue;
    }
    const r = qk / pk;
    if (pk < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return false;
  }
  return t1 - t0 > 1e-6;
}

/** Keep the anchor this far inside a slid box's span, so the label still points at it. */
const SLIDE_KEEP_PX = 8;

/** How far to slide `v` (a box from lo to hi along one axis) into [min, max], keeping `at` inside [lo, hi]. */
function slide(lo, hi, min, max, at) {
  const want = lo < min ? min - lo : hi > max ? max - hi : 0;
  const limit = want > 0 ? at - SLIDE_KEEP_PX - lo : at + SLIDE_KEEP_PX - hi;
  return want > 0 ? Math.max(0, Math.min(want, limit)) : Math.min(0, Math.max(want, limit));
}

/** A box across its side's axis slid inside the free area: a label above or below moves along x, one beside along y,
 * as far as it can while it still spans its anchor. */
function slid(center, label, side, a, frame) {
  if (!frame) return center;
  const box = boxAt(center, label.w, label.h);
  const alongX = side === "above" || side === "below";
  if (alongX) return { x: center.x + slide(box.x0, box.x1, frame.x0, frame.x1, a.x), y: center.y };
  if (side !== "left" && side !== "right") return center;
  return { x: center.x, y: center.y + slide(box.y0, box.y1, frame.y0, frame.y1, a.y) };
}

/** A label's spot `choice` = { anchor, side, ring } (or side "free" with its own dx, dy from the anchor): its box,
 * center and leader (null when it sits by its anchor). */
function spotOf(label, choice, o, frame) {
  const a = label.anchors[choice.anchor];
  const off = choice.side === FREE ? { x: choice.dx, y: choice.dy }
    : SIDES[choice.side](label.w, label.h, o.gapPx + choice.ring * o.stepPx);
  const center = choice.side === FREE ? { x: a.x + off.x, y: a.y + off.y }
    : slid({ x: a.x + off.x, y: a.y + off.y }, label, choice.side, a, frame);
  const box = boxAt(center, label.w, label.h);
  const end = nearestOn(box, a);
  const leader = Math.hypot(end.x - a.x, end.y - a.y) > o.leaderPx ? { x1: a.x, y1: a.y, x2: end.x, y2: end.y } : null;
  return { center, box, leader, anchor: { x: a.x, y: a.y } };
}

const touches = (b, p) => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;

/** How many boxes a spot's leader crosses; a box its anchor sits in doesn't count (the line has to start there). */
function leaderHits(spot, boxes) {
  const [p, q] = [{ x: spot.leader.x1, y: spot.leader.y1 }, { x: spot.leader.x2, y: spot.leader.y2 }];
  return boxes.filter((b) => !touches(b, p) && segmentHitsBox(p, q, b)).length;
}

/** Everything a spot runs into, as a cost: 0 is clear. */
function costOf(spot, world, placed, choice, o) {
  const pad = grow(spot.box, o.labelGapPx);
  const labels = placed.filter((p) => meets(pad, p.box)).length;
  const boxes = world.boxes.filter((b) => meets(spot.box, b)).length;
  const dots = world.dots.filter((d) => holds(grow(spot.box, d.r), d)).length;
  const out = world.bounds && !inside(spot.box, world.frame) ? 1 : 0;
  const leader = spot.leader ? leaderHits(spot, [...placed.map((p) => p.box), ...world.boxes]) : 0;
  const hard = labels * COST.label + boxes * COST.box + out * COST.out + leader * COST.leader + dots * COST.dot;
  return hard ? hard + choice.ring * COST.ring : 0;
}

/** Every choice for a label, nearest first: ring by ring, each anchor's sides in its own order. */
function choicesOf(label, o) {
  const out = [];
  for (let ring = 0; ring < o.rings; ring += 1) {
    label.anchors.forEach((a, anchor) => {
      for (const side of a.sides) out.push({ anchor, side, ring });
    });
  }
  return out;
}

/** The last resort: centers on a grid around the first anchor, nearest the anchor first (a crowded goal line). */
function roamChoices(label, o) {
  const xs = Array.from({ length: Math.floor((2 * o.roamX) / o.roamStepX) + 1 }, (_, i) => -o.roamX + i * o.roamStepX);
  const ys = Array.from({ length: Math.floor((2 * o.roamY) / o.roamStepY) + 1 }, (_, i) => -o.roamY + i * o.roamStepY);
  const reach = (dx, dy) => Math.hypot(Math.max(0, Math.abs(dx) - label.w / 2), Math.max(0, Math.abs(dy) - label.h / 2));
  return xs.flatMap((dx) => ys.map((dy) => ({ dx, dy, d: reach(dx, dy) }))).sort((a, b) => a.d - b.d)
    .map(({ dx, dy, d }) => ({ anchor: 0, side: FREE, ring: o.rings + Math.round(d / o.stepPx), dx, dy }));
}

const validKeep = (label, keep) => keep && Number.isInteger(keep.anchor) && keep.anchor >= 0
  && keep.anchor < label.anchors.length && Number.isInteger(keep.ring) && keep.ring >= 0
  && (Object.hasOwn(SIDES, keep.side) || (keep.side === FREE && isFiniteNum(keep.dx) && isFiniteNum(keep.dy)));

/** The first clear spot of `tries`, else the cheapest of them (with its cost). */
function firstClear(label, tries, world, placed, o) {
  let best = null;
  for (const choice of tries) {
    const spot = spotOf(label, choice, o, world.frame);
    const cost = costOf(spot, world, placed, choice, o);
    if (cost === 0) return { ...spot, choice, clear: true, cost };
    if (!best || cost < best.cost) best = { ...spot, choice, clear: false, cost };
  }
  return best;
}

/** One label: the first clear choice around its anchors, else anywhere clear near its first anchor, else the
 * cheapest; its kept choice instead while that is still clear and no farther out (no jitter, never stuck far). */
function placeOne(label, world, placed, o) {
  if (o.hold && validKeep(label, label.keep)) {
    const { cost: _held, ...held } = firstClear(label, [label.keep], world, placed, o);
    return held;
  }
  const near = firstClear(label, choicesOf(label, o), world, placed, o);
  const found = near.clear ? near : firstClear(label, roamChoices(label, o), world, placed, o);
  const best = found.clear || found.cost < near.cost ? found : near;
  const kept = validKeep(label, label.keep) ? firstClear(label, [label.keep], world, placed, o) : null;
  const { cost: _cost, ...rest } = kept?.clear && (!best.clear || kept.choice.ring <= best.choice.ring) ? kept : best;
  return rest;
}

function cleanLabel(l) {
  const anchors = (Array.isArray(l?.anchors) ? l.anchors : []).filter(isPt).map((a) => ({ x: a.x, y: a.y,
    sides: (Array.isArray(a.sides) ? a.sides : ALL_SIDES).filter((s) => Object.hasOwn(SIDES, s)) }))
    .filter((a) => a.sides.length);
  const ok = anchors.length && isFiniteNum(l.w) && l.w > 0 && isFiniteNum(l.h) && l.h > 0;
  return ok ? { id: l.id, w: l.w, h: l.h, anchors, keep: l.keep ?? null } : null;
}

const isBox = (b) => [b?.x0, b?.y0, b?.x1, b?.y1].every(isFiniteNum) && b.x1 > b.x0 && b.y1 > b.y0;

/**
 * Place labels in priority order (pixels, y down).
 * @param {ReadonlyArray<object>} labels  { id, w, h, anchors: [{ x, y, sides?: string[] }], keep? }
 * @param {{ boxes?: object[], dots?: object[], bounds?: object }} world  obstacle boxes, stroke dots { x, y, r } and
 *   the free area ({ x0, y0, x1, y1 }) the labels stay inside
 * @param {object} [opts]  PLACE overrides; `hold: true` keeps every label's kept choice as it is (a view in motion: the
 *   words ride with their anchors and are laid out again once it lands)
 * @returns {ReadonlyArray<{ id, center, box, anchor, leader, choice, clear }>} one per usable label, in their order
 */
export function placeLabels(labels, { boxes = [], dots = [], bounds = null } = {}, opts = {}) {
  const o = { ...PLACE, ...opts };
  const frame = isBox(bounds) ? grow(bounds, -o.edgePx) : null;
  const world = { boxes: boxes.filter(isBox), dots: dots.filter((d) => isPt(d) && isFiniteNum(d.r)),
    bounds: isBox(frame) ? bounds : null, frame };
  const placed = [];
  for (const raw of Array.isArray(labels) ? labels : []) {
    const label = cleanLabel(raw);
    if (!label) continue;
    placed.push({ id: label.id, ...placeOne(label, world, placed, o) });
  }
  return deepFreeze(placed);
}

/** Two placed labels' boxes overlap (with `gap` px between them required). */
export const boxesOverlap = (a, b, gap = 0) => meets(grow(a, gap / 2), grow(b, gap / 2));
