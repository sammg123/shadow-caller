/**
 * The words on the field before a caller snap, laid out in screen space (docs/design/play-drawing.md 4b, binding):
 * each prediction's plate beside its own stroke ("NEXT 1 · Inside run (A/B gap) · 21%"), the previous play's plate
 * ("LAST · Short pass left · +11", its verdict under it) at its start or along its path, never at its end (where the
 * ball now rests); no plate on the ball, a stroke or another plate. Pure: the engine hands over a projection (field
 * yards to its own pixels, y down) and each plate's measured size; this turns the field into obstacles and anchors and
 * runs label-place.js. Both engines use it: the 3D field projects through the camera it is settling on, the 2D field
 * through its plane.
 *
 * Plates go in priority order: his predictions by rank, the previous play's, then a play the panel hovers outside his
 * top plays. Ids: "next:<leaf>" and "last".
 */
import { deepFreeze } from "../core/domain.js";
import { isFiniteNum } from "./grammar.js";
import { placeLabels } from "./label-place.js";
import { sampleArc } from "./timing.js";

export const LAST_ID = "last";
export const nextId = (leaf) => `next:${leaf}`;

/** Yards: a stroke sampled this often before projection; the ball's footprint (a 2.2x football in its ring). */
const SAMPLE_YD = 0.25;
const BALL = Object.freeze({ halfX: 1.0, halfY: 1.0, top: 1.0 });
/** Pixels: dots densified to this spacing on screen, the margin a dot keeps beyond its stroke's half width, the
 * ball's padding, the room a stroke's end mark (arrowhead or tick) takes. */
const DOT_PX = 4;
const DOT_MARGIN_PX = 3;
const BALL_PAD_PX = 3;
/** The room every plate keeps around the ball's footprint besides (px): the page lays a plate out to the pixel, and
 * the camera settles a pixel or two after the layout is made for where it lands. */
const BALL_ROOM_PX = 4;
const END_MARK_PX = 6;
const MARK_HALF_YD = 1.2;
/** The previous play's plate anchors at these shares of its path, from its start, so it stays away from the end of
 * the play, where the ball now rests; those the view shows come first (a long gain starts off screen). */
const LAST_AT = Object.freeze([0, 0.12, 0.25, 0.4, 0.55]);
/** Further along, for a long play whose first half the view doesn't show (still short of its end). */
const LAST_AT_FAR = Object.freeze([0.7, 0.8]);
/** An anchor counts as shown this far inside the free area (px). */
const SHOWN_PX = 24;

const isPt = (p) => isFiniteNum(p?.x) && isFiniteNum(p?.y);
const lerp = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });

// ---------------------------------------------------------------- strokes as dots
/** A stroke step's points in field yards ({ x, y, h }), sampled every SAMPLE_YD along its ground track. */
function stepPoints(step) {
  if ((step?.t !== "arc" && step?.t !== "ground") || !isPt(step.from) || !isPt(step.to)) return [];
  const len = Math.hypot(step.to.x - step.from.x, step.to.y - step.from.y);
  const n = Math.max(1, Math.ceil(len / SAMPLE_YD));
  const apex = isFiniteNum(step.apex) ? step.apex : 0;
  const endH = isFiniteNum(step.endH) ? step.endH : 0;
  return Array.from({ length: n + 1 }, (_, i) => (step.t === "arc" ? sampleArc(step.from, step.to, apex, endH, i / n)
    : { ...lerp(step.from, step.to, i / n), h: 0 }));
}

/** Projected points of one step, with extra dots between any two more than DOT_PX apart on screen. */
function stepDots(step, project, r) {
  const px = stepPoints(step).map((p) => project(p, step)).filter(isPt);
  return px.flatMap((p, i) => {
    if (!i) return [{ x: p.x, y: p.y, r }];
    const q = px[i - 1];
    const n = Math.max(1, Math.ceil(Math.hypot(p.x - q.x, p.y - q.y) / DOT_PX));
    return Array.from({ length: n }, (_, k) => ({ ...lerp(q, p, (k + 1) / n), r }));
  });
}

/** Where strokes (paths.js steps) show on screen: points at most DOT_PX apart (the #field clarity hooks). */
export function strokeDots(steps, project) {
  return (Array.isArray(steps) ? steps : []).flatMap((st) => stepDots(st, project, 0)).map((d) => [d.x, d.y]);
}

/** A box around projected points, padded. */
function boxOf(points, pad) {
  const ok = points.filter(isPt);
  if (!ok.length) return null;
  const xs = ok.map((p) => p.x);
  const ys = ok.map((p) => p.y);
  return { x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad };
}

/** The resting ball's footprint on screen: its ring on the turf and the ball standing in it. */
export function ballBox(ball, project) {
  if (!isPt(ball)) return null;
  const corners = [-1, 1].flatMap((sx) => [-1, 1].flatMap((sy) => [0, BALL.top].map((h) => ({
    x: ball.x + sx * BALL.halfX, y: ball.y + sy * BALL.halfY, h }))));
  return boxOf(corners.map((p) => project(p, null)), BALL_PAD_PX);
}

/** A mark's glyph on screen (the X of an incompletion, a flag, TD): a box about its size. */
function markBox(step, project) {
  if (!isPt(step?.at)) return null;
  const corners = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => ({ x: step.at.x + sx * MARK_HALF_YD,
    y: step.at.y + sy * MARK_HALF_YD, h: 0 })));
  return boxOf(corners.map((p) => project(p, step)), 0);
}

// ---------------------------------------------------------------- anchors
const FORWARD = Object.freeze({ right: ["right", "below-right", "above-right"], left: ["left", "below-left",
  "above-left"], below: ["below", "below-right", "below-left"], above: ["above", "above-right", "above-left"] });

/** Which side of `to` lies ahead on screen, going from `from` to `to`. */
function aheadOf(from, to) {
  const d = { x: to.x - from.x, y: to.y - from.y };
  if (Math.abs(d.x) >= Math.abs(d.y)) return d.x >= 0 ? "right" : "left";
  return d.y >= 0 ? "below" : "above";
}

const unique = (list) => list.filter((v, i) => list.indexOf(v) === i);

/** A prediction's anchors: past the end of its stroke (where the play goes), then its middle (an arc's top). */
function shadowAnchors(step, project) {
  const end = { x: step.to.x, y: step.to.y, h: 0 };
  const from = project({ x: step.from.x, y: step.from.y, h: 0 }, step);
  const endPx = project(end, step);
  const mid = step.t === "arc" ? sampleArc(step.from, step.to, step.apex ?? 0, step.endH ?? 0, 0.5)
    : { ...lerp(step.from, step.to, 0.5), h: 0 };
  const midPx = project(mid, step);
  if (!isPt(endPx) || !isPt(from)) return [];
  const ahead = aheadOf(from, endPx);
  return [
    { at: end, px: endPx, sides: unique([...FORWARD[ahead], "below", "above"]) },
    ...(isPt(midPx) ? [{ at: mid, px: midPx, sides: step.t === "arc" ? ["above", "below"] : ["below", "above"] }] : []),
  ];
}

/** Where the previous play went on the turf: each stroke's ground track, end to end. */
function groundPath(drawing) {
  return (drawing?.steps ?? []).filter((s) => (s.t === "arc" || s.t === "ground") && isPt(s.from) && isPt(s.to))
    .map((s) => ({ from: s.from, to: s.to, len: Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y), step: s }));
}

/** The point `share` of the way along a ground path. */
function alongPath(path, share) {
  const total = path.reduce((n, seg) => n + seg.len, 0);
  let left = share * total;
  for (const seg of path) {
    if (left <= seg.len || seg === path.at(-1)) return lerp(seg.from, seg.to, seg.len ? Math.min(1, left / seg.len) : 0);
    left -= seg.len;
  }
  return null;
}

const shownIn = (bounds) => (a) => !bounds || (a.px.x >= bounds.x0 + SHOWN_PX && a.px.x <= bounds.x1 - SHOWN_PX
  && a.px.y >= bounds.y0 + SHOWN_PX && a.px.y <= bounds.y1 - SHOWN_PX);

/** The previous play's anchors: its start, then points along its path short of its end, only those the view shows
 * (none: the view doesn't show the play, and its plate stays off the field). A play that went nowhere (a no-gain run,
 * a flag with no snap) anchors at its first mark or the ball; the plate steps off. */
function lastAnchors(drawing, project, ball, bounds) {
  const near = pathAnchors(drawing, project, ball, LAST_AT);
  const shown = near.filter(shownIn(bounds));
  return shown.length ? shown : pathAnchors(drawing, project, ball, LAST_AT_FAR).filter(shownIn(bounds));
}

function pathAnchors(drawing, project, ball, shares) {
  const path = groundPath(drawing);
  const back = path.length ? aheadOf(project({ ...path.at(-1).to, h: 0 }, null) ?? { x: 0, y: 0 },
    project({ ...path[0].from, h: 0 }, null) ?? { x: 0, y: 0 }) : "left";
  const sides = unique(["below", ...FORWARD[back], "above", "right", "left", "below-right", "above-right"]);
  const total = path.reduce((n, seg) => n + seg.len, 0);
  const firstMark = (drawing?.steps ?? []).find((s) => s.t === "mark" && isPt(s.at))?.at;
  const spots = total > 0 ? shares.map((k) => alongPath(path, k)) : [firstMark ?? ball];
  return spots.filter(isPt).map((p) => ({ at: { x: p.x, y: p.y, h: 0 }, px: project({ x: p.x, y: p.y, h: 0 }, null),
    sides })).filter((a) => isPt(a.px));
}

// ---------------------------------------------------------------- the layout
function obstaclesOf({ shadows, last, avoid, ball, project, widths }) {
  const shadowR = (widths.shadow ?? 1.5) + DOT_MARGIN_PX;
  const lastR = (widths.last ?? 4) + DOT_MARGIN_PX;
  const shadowSteps = shadows.map((s) => s.drawing.steps[0]).filter(Boolean);
  const lastSteps = [...(last?.drawing?.steps ?? []), ...avoid.flatMap((d) => d?.steps ?? [])];
  const dots = [...shadowSteps.flatMap((st) => stepDots(st, project, shadowR)),
    ...shadowSteps.map((st) => project({ x: st.to.x, y: st.to.y, h: 0 }, st)).filter(isPt)
      .map((p) => ({ x: p.x, y: p.y, r: END_MARK_PX + DOT_MARGIN_PX })),
    ...lastSteps.flatMap((st) => stepDots(st, project, lastR))];
  const marks = lastSteps.filter((st) => st.t === "mark").map((st) => markBox(st, project)).filter(Boolean);
  return { dots, marks, ball: ballBox(ball, project) };
}

function requestsOf({ shadows, last, ball, project, plates, keep, bounds }) {
  const sized = (id) => plates?.[id] && isFiniteNum(plates[id].w) && isFiniteNum(plates[id].h) ? plates[id] : null;
  const shadowReq = (s) => {
    const id = nextId(s.leaf);
    const anchors = shadowAnchors(s.drawing.steps[0], project);
    return sized(id) && anchors.length ? { id, kind: "next", leaf: s.leaf, rank: s.rank, anchors, ...sized(id) } : null;
  };
  const top = shadows.filter((s) => !(s.hovered && (s.rank === null || s.rank > 2))).map(shadowReq);
  const extras = shadows.filter((s) => s.hovered && (s.rank === null || s.rank > 2)).map(shadowReq);
  const lastReq = last && sized(LAST_ID)
    ? { id: LAST_ID, kind: "last", anchors: lastAnchors(last.drawing, project, ball, bounds), ...sized(LAST_ID) } : null;
  return [...top, lastReq, ...extras].filter((r) => r && r.anchors.length)
    .map((r) => ({ ...r, keep: keep?.[r.id] ?? null }));
}

/**
 * The pre-snap plates' spots.
 * @param {{ shadows: ReadonlyArray<object>, last?: { drawing: object } | null, ball: { x: number, y: number },
 *   project: (p: { x: number, y: number, h: number }, step: object | null) => ({ x: number, y: number } | null),
 *   plates: Record<string, { w: number, h: number }>, bounds?: object, boxes?: object[],
 *   widths?: { shadow?: number, last?: number }, keep?: Record<string, object>, avoid?: object[] }} scene
 *   ShadowPlays (shadows.js); the previous play's Drawing; the resting ball (field yards); the projection; each
 *   plate's size in px; the free area and any other box to keep clear (the field's legend, words already up); the
 *   strokes' half widths in px; the last choices; other Drawings whose strokes the plates keep off (a review's play);
 *   `hold`: keep the last choices as they are (the view is moving)
 * @returns {{ labels: ReadonlyArray<object>, ball: object | null, dots: ReadonlyArray<object> }} each label: { id,
 *   kind, leaf?, rank?, at (its anchor, field yards), anchorPx, center, box, offset: { dx, dy }, leader, choice, clear }
 */
export function presnapLayout({ shadows = [], last = null, ball, project, plates = {}, bounds = null, boxes = [],
  widths = {}, keep = {}, avoid = [], hold = false } = {}) {
  const list = (Array.isArray(shadows) ? shadows : []).filter((s) => s?.drawing?.steps?.[0]);
  if (typeof project !== "function") return deepFreeze({ labels: [], ball: null, dots: [] });
  const ob = obstaclesOf({ shadows: list, last, avoid: Array.isArray(avoid) ? avoid : [], ball, project, widths });
  const requests = requestsOf({ shadows: list, last, ball, project, plates, keep, bounds });
  const room = ob.ball && { x0: ob.ball.x0 - BALL_ROOM_PX, y0: ob.ball.y0 - BALL_ROOM_PX,
    x1: ob.ball.x1 + BALL_ROOM_PX, y1: ob.ball.y1 + BALL_ROOM_PX };
  const solved = placeLabels(requests.map((r) => ({ id: r.id, w: r.w, h: r.h, keep: r.keep,
    anchors: r.anchors.map((a) => ({ x: a.px.x, y: a.px.y, sides: a.sides })) })),
  { boxes: [...(room ? [room] : []), ...ob.marks, ...boxes], dots: ob.dots, bounds }, { hold });
  const labels = solved.map((p) => {
    const r = requests.find((q) => q.id === p.id);
    const a = r.anchors[p.choice.anchor];
    return { id: r.id, kind: r.kind, ...(r.leaf ? { leaf: r.leaf, rank: r.rank } : {}), at: a.at, anchorPx: a.px,
      center: p.center, box: p.box, offset: { dx: p.center.x - a.px.x, dy: p.center.y - a.px.y }, leader: p.leader,
      choice: p.choice, clear: p.clear };
  });
  return deepFreeze({ labels, ball: ob.ball, dots: ob.dots });
}
