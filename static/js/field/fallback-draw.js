/**
 * The 2D field as plain node specs (ui-architecture.md 6.2, owner A6): the layout that fits the field in its host,
 * team paints, the static field (turf, team end zones, paint, numerals, hashes, posts) and the situation (line of
 * scrimmage, line to gain, ball). Top-down through coords.toPlane: the caller's end zone on the left, the near
 * sideline at the bottom, true 120 by 53.3 proportions. Height (kick arcs, goal posts) lifts a point toward the far
 * sideline by OBLIQUE, so a flight reads as an arc and its shadow stays on the turf. Pure: no DOM, no clock.
 *
 * A node spec is { tag, attrs, children?, text? }; fallback-svg.js turns it into SVG. Colors come from the look;
 * HUD-like tags read the world's --sc-* tokens through `style`, so the 2D field reads as the same world.
 */
import { deepFreeze, safeLogoUrl } from "../core/domain.js";
import { downDistance } from "../model/format.js";
import { contrast, mixHex, teamPaint } from "../theme/team-colors.js";
import { FIELD, toPlane } from "./coords.js";
import { isFiniteNum, ownValue } from "./grammar.js";

export const APRON_YD = 4;          // around the field: the 6 ft white border plus the team area
export const BORDER_YD = 2;
export const OBLIQUE = 0.45;        // screen lift per yard of height: a 10 yd apex rises 4.5 yd toward the far side
const DEFAULT_SIZE = Object.freeze({ width: 1200, height: 675 });
const MIN_FREE_SHARE = 0.4;
const BOX_W = FIELD.X_MAX - FIELD.X_MIN + 2 * APRON_YD;
const BOX_H = FIELD.WIDTH + 2 * APRON_YD;
const DIGITS = 100;
const C = FIELD.CENTER_Y;
const W = FIELD.WIDTH;
const ABBR_RE = /^[A-Z]{2,4}$/;
const MAX_NAME = 24;

const PAINT = Object.freeze({ lineYd: 0.12, goalYd: 0.25, minLinePx: 1, minGoalPx: 2, tickYd: 0.667,
  sideTick: [0.111, 0.778], numeralYd: 2.6, numeralY: 8, arrowYd: 0.55 });
const POSTS = Object.freeze({ halfSpan: 3.083, bar: 3.333, top: 11.667, base: 2, minPx: 1.5, yd: 0.2 });
/** NFL fixture colors (DESIGN.md tertiary; the WebGL field uses the same, field/structures.js FIXTURE_COLORS). */
export const FIXTURES = Object.freeze({ gold: "#ffc425", orange: "#ff6a13" });
const PYLON = Object.freeze({ yd: 0.4, minPx: 4 });
const LOGO_YD = 9;
const SMALL_FIELD_PX = 5;
const ZONE_TEXT = Object.freeze({ maxYd: 5.4, lengthYd: 40, charEm: 0.7, trackEm: 0.08 });
const BALL = Object.freeze({ yd: 1.8, minPx: 13, maxPx: 30, ring: 0.9, haloAbove: 0.3 });
/** A tag's plate padding around its text, in px (fallback-svg fitTags sizes the plate). */
export const TAG_PAD = Object.freeze({ padX: 6, padY: 3 });

export const r2 = (v) => Math.round(v * DIGITS) / DIGITS;

/** A node spec. */
export function node(tag, attrs = {}, children = [], text = undefined) {
  const out = { tag, attrs };
  if (children.length) out.children = children;
  if (text !== undefined) out.text = String(text);
  return out;
}

// ---------------------------------------------------------------- layout
function insetsOf(insets, w, h) {
  const v = (k) => (isFiniteNum(insets?.[k]) && insets[k] > 0 ? insets[k] : 0);
  const out = { top: v("top"), right: v("right"), bottom: v("bottom"), left: v("left") };
  const roomy = w - out.left - out.right >= w * MIN_FREE_SHARE && h - out.top - out.bottom >= h * MIN_FREE_SHARE;
  return roomy ? out : { top: 0, right: 0, bottom: 0, left: 0 };
}

/**
 * Where the field sits in a host of `width` by `height` px: inside the free area the HUD leaves (`insets` in px;
 * ignored when they would leave less than 40% of either side), with its apron, centered, at true proportions.
 * `px` is one yard in pixels; `rect` is the coords.toPlane rect of x -10 to 110 and y 0 to 53.333.
 */
export function layoutPlane({ width, height, insets } = {}) {
  const sized = isFiniteNum(width) && isFiniteNum(height) && width > 0 && height > 0;
  const w = sized ? width : DEFAULT_SIZE.width;
  const h = sized ? height : DEFAULT_SIZE.height;
  const ins = insetsOf(insets, w, h);
  const free = { x: ins.left, y: ins.top, w: w - ins.left - ins.right, h: h - ins.top - ins.bottom };
  const px = Math.min(free.w / BOX_W, free.h / BOX_H);
  const rw = (FIELD.X_MAX - FIELD.X_MIN) * px;
  const rh = W * px;
  return deepFreeze({ width: w, height: h, free, px,
    rect: { x: free.x + (free.w - rw) / 2, y: free.y + (free.h - rh) / 2, w: rw, h: rh } });
}

/** Screen point of field (x, y) at height h (yards). */
export function planePoint(layout, x, y, h = 0) {
  return toPlane(x, y + h * OBLIQUE, layout.rect);
}

// ---------------------------------------------------------------- paints
const nameOf = (team, abbr) => (typeof team?.name === "string" && team.name.trim()
  ? team.name.trim().slice(0, MAX_NAME) : abbr);

function sides(field, teams, list, teamOrder) {
  const has = (a) => typeof a === "string" && list.includes(a);
  const left = [field?.left_team, list.find((a) => teams[a]?.caller === true), teamOrder?.[1], list[0]].find(has) ?? null;
  const right = [field?.right_team, ...list].find((a) => has(a) && a !== left) ?? null;
  return { left, right };
}

/** Team paints (theme/team-colors teamPaint against the look's backgrounds), names, logos, which end is whose. */
export function paintsFor(look, field, teams, teamOrder) {
  const { against, minContrast } = look.teamColor;
  const valid = teams && typeof teams === "object" ? teams : {};
  const list = Object.keys(valid).filter((k) => ABBR_RE.test(k));
  return deepFreeze({
    byTeam: Object.fromEntries(list.map((a) => [a, teamPaint(valid[a], against, minContrast)])),
    names: Object.fromEntries(list.map((a) => [a, nameOf(valid[a], a)])),
    logos: Object.fromEntries(list.map((a) => [a, safeLogoUrl(valid[a]?.logo)])),
    home: list.includes(field?.home) ? field.home : null,
    ...sides(field, valid, list, Array.isArray(teamOrder) ? teamOrder : []),
    neutral: teamPaint(null, against, minContrast),
  });
}

/** The scene context every spec builder takes. `ids` prefixes element ids, unique per engine. */
export function sceneContext({ look, layout, field, teams, teamOrder, ids = "scfb" }) {
  return Object.freeze({
    look, layout, ids, paints: paintsFor(look, field, teams, teamOrder),
    pixel: look.ghost.style === "pixel" || look.strokes.mark.approx === "pixel",
    pt: (x, y, h = 0) => planePoint(layout, x, y, h),
    yd: (n) => n * layout.px,
  });
}

/** A team's paint, or the neutral team's. */
export const paintOf = (ctx, team) => ownValue(ctx.paints.byTeam, team) ?? ctx.paints.neutral;

// ---------------------------------------------------------------- shapes in field yards
/** Screen rect of a field box (either corner order). */
export function boxRect(ctx, x0, x1, y0, y1) {
  const a = ctx.pt(Math.min(x0, x1), Math.max(y0, y1));
  const b = ctx.pt(Math.max(x0, x1), Math.min(y0, y1));
  return { x: r2(a.px), y: r2(a.py), width: r2(b.px - a.px), height: r2(b.py - a.py) };
}

/** Path data of a field box. */
export function boxPath(ctx, x0, x1, y0, y1) {
  const { x, y, width, height } = boxRect(ctx, x0, x1, y0, y1);
  return `M${x} ${y}h${width}v${height}h${-width}z`;
}

/** Path data of a straight field segment, optionally lifted. */
export function segPath(ctx, a, b) {
  const p = ctx.pt(a.x, a.y, a.h ?? 0);
  const q = ctx.pt(b.x, b.y, b.h ?? 0);
  return `M${r2(p.px)} ${r2(p.py)}L${r2(q.px)} ${r2(q.py)}`;
}

// ---------------------------------------------------------------- tags (HUD-styled labels on the field)
/** A tag's size token, one step down to xs on a small field (a phone) so labels don't cover it. */
export const tagSize = (ctx, size) => (ctx.layout.px < SMALL_FIELD_PX ? "xs" : size);

/**
 * A label on the field: a panel rect (sized to the text by fallback-svg.js) and the text, styled with the world's
 * tokens. `anchor` is start, middle or end; `tone` picks the text color.
 */
export function tagNode({ at, text, anchor = "middle", tone = "ink", size = "s", part, cls = "" }) {
  const textStyle = `fill: ${toneColor(tone)}; font-family: var(--sc-font-text); font-size: var(--sc-size-${size});`
    + " font-weight: var(--sc-weight-strong); letter-spacing: var(--sc-tracking-label);"
    + " text-transform: var(--sc-case-label)";
  return node("g", { class: `sc-fb-tag ${cls}`.trim(), "data-part": part, "data-anchor": anchor,
    "data-pad-x": TAG_PAD.padX, "data-pad-y": TAG_PAD.padY }, [
    node("rect", { x: r2(at.px), y: r2(at.py), width: 0, height: 0, rx: 2,
      style: "fill: var(--sc-surface-2); stroke: var(--sc-rule-strong); stroke-width: 1" }),
    node("text", { x: r2(at.px), y: r2(at.py), "text-anchor": anchor, "dominant-baseline": "central",
      style: textStyle }, [], text),
  ]);
}

/** Text colors for tags: the world's meaning tokens, or a literal look color. */
export function toneColor(tone) {
  const tokens = { ink: "var(--sc-ink)", muted: "var(--sc-ink-muted)", good: "var(--sc-good)", bad: "var(--sc-bad)",
    warn: "var(--sc-warn)", gain: "var(--sc-gain)" };
  return ownValue(tokens, tone) ?? (/^#[0-9a-fA-F]{6}$/.test(tone) ? tone : tokens.ink);
}

// ---------------------------------------------------------------- the static field
function ground(ctx) {
  const { width, height } = ctx.layout;
  const fill = ctx.look.environment.background ?? ctx.look.renderer.clear;
  return node("rect", { x: 0, y: 0, width, height, fill, "data-part": "ground" });
}

function surround(ctx) {
  const f = ctx.look.field;
  const a = APRON_YD;
  const b = BORDER_YD;
  return [
    node("rect", { ...boxRect(ctx, FIELD.X_MIN - a, FIELD.X_MAX + a, -a, W + a), fill: f.surround,
      "data-part": "surround" }),
    node("rect", { ...boxRect(ctx, FIELD.X_MIN - b, FIELD.X_MAX + b, -b, W + b), fill: f.paint,
      "fill-opacity": f.paintOpacity, "data-part": "border" }),
  ];
}

function stripes(ctx) {
  const { turf, stripeYd } = ctx.look.field;
  const count = (FIELD.GOAL_X[1] - FIELD.GOAL_X[0]) / stripeYd;
  const paths = ["", ""];
  for (let k = 0; k < count; k += 1) paths[k % 2] += boxPath(ctx, k * stripeYd, (k + 1) * stripeYd, 0, W);
  return paths.map((d, k) => node("path", { d, fill: turf[k], "data-part": "stripes" }));
}

function endZone(ctx, side) {
  const team = ctx.paints[side];
  const [x0, x1] = side === "left" ? [FIELD.X_MIN, FIELD.GOAL_X[0]] : [FIELD.GOAL_X[1], FIELD.X_MAX];
  const fill = ctx.look.field.endZones === "team" ? paintOf(ctx, team).fill : ctx.look.field.turf[0];
  return node("rect", { ...boxRect(ctx, x0, x1, 0, W), fill, "data-part": "end-zone", "data-team": team ?? "" });
}

function zoneInk(ctx, team) {
  if (ctx.look.field.endZones !== "team") {
    return { fill: ctx.look.field.paint, stroke: mixHex(ctx.look.field.turf[0], "#000000", 0.4) };
  }
  const p = paintOf(ctx, team);
  const outlined = contrast(p.alt, p.ink) >= 1.5;
  return { fill: p.ink, stroke: outlined ? p.alt : mixHex(p.fill, "#000000", 0.45) };
}

function endZoneName(ctx, side) {
  const team = ctx.paints[side];
  const mode = ctx.look.field.endZoneText;
  if (!team || mode === "none") return [];
  const word = mode === "abbr" ? team : ctx.paints.names[team].toUpperCase();
  const at = ctx.pt(side === "left" ? -5 : 105, C);
  const fitYd = ZONE_TEXT.lengthYd / Math.max(1, word.length * (ZONE_TEXT.charEm + ZONE_TEXT.trackEm));
  const size = r2(ctx.yd(Math.min(ZONE_TEXT.maxYd, fitYd)));
  const ink = zoneInk(ctx, team);
  return [node("text", {
    x: r2(at.px), y: r2(at.py), transform: `rotate(${side === "left" ? -90 : 90} ${r2(at.px)} ${r2(at.py)})`,
    "text-anchor": "middle", "dominant-baseline": "central", "font-size": size, fill: ink.fill, stroke: ink.stroke,
    "stroke-width": r2(Math.max(1, size * 0.06)), "paint-order": "stroke", "stroke-linejoin": "round",
    style: "font-family: var(--sc-font-display); font-weight: var(--sc-weight-display);"
      + ` letter-spacing: ${ZONE_TEXT.trackEm}em`,
    "data-part": "end-zone-name", "data-team": team,
  }, [], word)];
}

function paintLines(ctx, xs, widthYd, minPx, part) {
  const f = ctx.look.field;
  const d = xs.map((x) => segPath(ctx, { x, y: 0 }, { x, y: W })).join("");
  return node("path", { d, stroke: f.paint, "stroke-opacity": f.paintOpacity, fill: "none",
    "stroke-width": r2(Math.max(minPx, ctx.yd(widthYd))), "data-part": part });
}

function hashes(ctx) {
  if (!ctx.look.field.hashes) return [];
  const f = ctx.look.field;
  const half = PAINT.tickYd / 2;
  const rows = [PAINT.sideTick, [FIELD.HASH_Y[0] - half, FIELD.HASH_Y[0] + half],
    [FIELD.HASH_Y[1] - half, FIELD.HASH_Y[1] + half], [W - PAINT.sideTick[1], W - PAINT.sideTick[0]]];
  const ticks = [];
  for (let x = 1; x < FIELD.GOAL_X[1]; x += 1) {
    if (x % 5 !== 0) for (const [y0, y1] of rows) ticks.push(segPath(ctx, { x, y: y0 }, { x, y: y1 }));
  }
  const tries = [2, 98].map((x) => segPath(ctx, { x, y: C - 0.5 }, { x, y: C + 0.5 }));
  return [node("path", { d: [...ticks, ...tries].join(""), stroke: f.paint, "stroke-opacity": f.paintOpacity,
    "stroke-width": r2(Math.max(PAINT.minLinePx, ctx.yd(PAINT.lineYd))), fill: "none", "data-part": "hashes" })];
}

function numeral(ctx, x, value, far) {
  const at = ctx.pt(x, far ? W - PAINT.numeralY : PAINT.numeralY);
  const size = r2(Math.max(9, ctx.yd(PAINT.numeralYd)));
  const gap = r2(size * 0.35);
  return node("text", {
    x: r2(at.px), y: r2(at.py), dx: r2(gap / 2), "text-anchor": "middle", "dominant-baseline": "central",
    "font-size": size, "letter-spacing": gap, fill: ctx.look.field.paint, "fill-opacity": ctx.look.field.paintOpacity,
    ...(far ? { transform: `rotate(180 ${r2(at.px)} ${r2(at.py)})` } : {}),
    style: "font-family: var(--sc-font-display); font-weight: var(--sc-weight-display)", "data-part": "numeral",
  }, [], String(value));
}

function arrow(ctx, x, far) {
  const toward = x < 50 ? -1 : 1;
  const y = far ? W - PAINT.numeralY - 0.9 : PAINT.numeralY + 0.9;
  const tip = ctx.pt(x + toward * 3.1, y);
  const base = ctx.pt(x + toward * (3.1 - PAINT.arrowYd * 1.6), y);
  const half = ctx.yd(PAINT.arrowYd / 2);
  return `M${r2(tip.px)} ${r2(tip.py)}L${r2(base.px)} ${r2(base.py - half)}L${r2(base.px)} ${r2(base.py + half)}z`;
}

function numerals(ctx) {
  if (!ctx.look.field.numerals) return [];
  const marks = [10, 20, 30, 40, 50, 60, 70, 80, 90];
  const value = (x) => (x <= 50 ? x : 100 - x);
  const arrows = [false, true].flatMap((far) => marks.filter((x) => x !== 50).map((x) => arrow(ctx, x, far)));
  return [
    ...[false, true].flatMap((far) => marks.map((x) => numeral(ctx, x, value(x), far))),
    node("path", { d: arrows.join(""), fill: ctx.look.field.paint, "fill-opacity": ctx.look.field.paintOpacity,
      "data-part": "numeral-arrows" }),
  ];
}

function post(ctx, endX, behind) {
  const pts = (list) => list.map(([x, y, h]) => ctx.pt(x, y, h)).map((p, i) => `${i ? "L" : "M"}${r2(p.px)} ${r2(p.py)}`)
    .join("");
  const baseX = endX + behind * POSTS.base;
  const lo = C - POSTS.halfSpan;
  const hi = C + POSTS.halfSpan;
  const d = pts([[baseX, C, 0], [baseX, C, POSTS.bar], [endX, C, POSTS.bar]])
    + pts([[endX, lo, POSTS.top], [endX, lo, POSTS.bar], [endX, hi, POSTS.bar], [endX, hi, POSTS.top]]);
  return node("path", { d, fill: "none", stroke: FIXTURES.gold, "stroke-linecap": "round",
    "stroke-linejoin": "round", "stroke-width": r2(Math.max(POSTS.minPx, ctx.yd(POSTS.yd))), "data-part": "post" });
}

function pylons(ctx) {
  const size = Math.max(PYLON.minPx, ctx.yd(PYLON.yd));
  const corners = [FIELD.X_MIN, FIELD.GOAL_X[0], FIELD.GOAL_X[1], FIELD.X_MAX].flatMap((x) => [[x, 0], [x, W]]);
  const d = corners.map(([x, y]) => ctx.pt(x, y))
    .map((p) => `M${r2(p.px - size / 2)} ${r2(p.py - size / 2)}h${r2(size)}v${r2(size)}h${r2(-size)}z`).join("");
  return node("path", { d, fill: FIXTURES.orange, "data-part": "pylons" });
}

/** The home team's logo at midfield, through the app's own logo proxy (DC C2) only. */
function midfieldLogo(ctx) {
  const href = ctx.paints.home ? ctx.paints.logos[ctx.paints.home] : null;
  if (!href || ctx.look.field.endZones !== "team") return [];
  const size = ctx.yd(LOGO_YD);
  const c = ctx.pt(FIELD.MIDFIELD_X, C);
  return [node("image", { href, x: r2(c.px - size / 2), y: r2(c.py - size / 2), width: r2(size), height: r2(size),
    preserveAspectRatio: "xMidYMid meet", opacity: 0.9, "data-part": "logo" })];
}

/**
 * The static field, back to front: ground, `under` (set dressing), apron and border, turf stripes, team end zones
 * and their names, yard and goal lines, hashes, numerals with their arrows, posts, then `over` (light).
 */
export function fieldNodes(ctx, { under = [], over = [] } = {}) {
  const fives = Array.from({ length: 19 }, (_, k) => 5 * (k + 1));
  return [
    ground(ctx), ...under, ...surround(ctx), ...stripes(ctx),
    endZone(ctx, "left"), endZone(ctx, "right"), ...endZoneName(ctx, "left"), ...endZoneName(ctx, "right"),
    paintLines(ctx, fives, PAINT.lineYd, PAINT.minLinePx, "yard-lines"),
    paintLines(ctx, [...FIELD.GOAL_X], PAINT.goalYd, PAINT.minGoalPx, "goal-lines"),
    ...midfieldLogo(ctx), ...hashes(ctx), ...numerals(ctx), pylons(ctx), post(ctx, FIELD.X_MIN, -1),
    post(ctx, FIELD.X_MAX, 1), ...over,
  ];
}

// ---------------------------------------------------------------- the situation
function lineNode(ctx, x, spec, part) {
  const width = Math.max(2, ctx.yd(spec.widthYd));
  const top = ctx.pt(x, W);
  return node("rect", { x: r2(top.px - width / 2), y: r2(top.py), width: r2(width), height: r2(ctx.layout.rect.h),
    fill: spec.color, "fill-opacity": spec.opacity, "data-part": part });
}

function downTag(ctx, sit) {
  const text = downDistance(sit.down, sit.togo, sit.goalToGo ? sit.togo : null);
  if (!text) return [];
  const at = ctx.pt(sit.ballX - sit.dir * 0.8, W - 2.6);
  return [tagNode({ at, text, anchor: sit.dir === 1 ? "end" : "start", size: tagSize(ctx, "xs"), part: "down-tag" })];
}

/** The ball, by look kind, lifted by its height, with a shadow on the turf while it flies. */
export function ballNodes(at, ctx) {
  if (!isFiniteNum(at?.x) || !isFiniteNum(at?.y)) return [];
  const { ball } = ctx.look;
  const h = isFiniteNum(at.h) ? Math.max(0, at.h) : 0;
  const p = ctx.pt(at.x, at.y, h);
  const size = Math.min(BALL.maxPx, Math.max(BALL.minPx, ctx.yd(BALL.yd) * (0.7 + 0.3 * ball.scale)));
  const [cx, cy] = [r2(p.px), r2(p.py)];
  const ring = node("circle", { cx, cy, r: r2(size * BALL.ring), fill: "none", stroke: ball.accent, "stroke-width": 1.5,
    "stroke-opacity": 0.9 });
  const body = ball.kind === "football"
    ? [node("ellipse", { cx, cy, rx: r2(size * 0.55), ry: r2(size * 0.34), fill: ball.color, stroke: ball.accent,
      "stroke-width": 0.75 }), node("path", { d: `M${r2(cx - size * 0.22)} ${cy}h${r2(size * 0.44)}`, stroke: ball.accent,
      "stroke-width": 1.2, "stroke-linecap": "round" })]
    : [node("circle", { cx, cy, r: r2(size * (ball.kind === "puck" ? 0.45 : 0.4)), fill: ball.color,
      stroke: ball.accent, "stroke-width": ball.kind === "puck" ? 2 : 1 })];
  const g = ctx.pt(at.x, at.y);
  const shadow = h > 0.05 ? [node("ellipse", { cx: r2(g.px), cy: r2(g.py), rx: r2(size * 0.5), ry: r2(size * 0.25),
    fill: "#000000", "fill-opacity": r2(0.12 + 0.3 * Math.max(0, 1 - h / 15)), "data-part": "ball-shadow" })] : [];
  const halo = h > BALL.haloAbove ? [node("circle", { cx, cy, r: r2(size * 1.25), fill: ball.accent, "fill-opacity": 0.28,
    "data-part": "ball-halo" })] : [];
  return [...shadow, ...halo, node("g", { "data-part": "ball" }, [ring, ...body])];
}

/**
 * Line of scrimmage, line to gain (hidden on goal to go: the goal line is the line), the down and distance, and
 * the ball (or `ball`, where the last play left it). Null: a bare field (FI 3.3).
 */
export function situationNodes(sit, ctx, { ball = null } = {}) {
  const live = Boolean(sit) && isFiniteNum(sit.ballX);
  const lines = live ? [
    lineNode(ctx, sit.ballX, ctx.look.lines.los, "los"),
    ...(isFiniteNum(sit.ltgX) && !sit.goalToGo && sit.kind !== "kickoff"
      ? [lineNode(ctx, sit.ltgX, ctx.look.lines.ltg, "ltg")] : []),
    ...(sit.kind === "kickoff" ? [] : downTag(ctx, sit)),
  ] : [];
  const at = ball ?? (live ? { x: sit.ballX, y: C } : null);
  return [...lines, ...(at ? ballNodes(at, ctx) : [])];
}
