/**
 * What each camera must keep in view, and a pose that fits it at any aspect. Pure: field yards in, field yards out
 * (coords.toWorld and coords.vecToWorld map a pose to three.js). No DOM, no three.js, no clock.
 *
 *   Frame = { center: {x, y}, spanX, spanY, dir, maxH }: a box on the field that must be visible, the attack
 *           direction (rigs behind the offense look along it) and the highest point above the box (kick arcs).
 *   Pose  = { position: {x, y, h}, target: {x, y, h}, up: {x, y, h}, fov, distance, yaw, pitch }.
 *
 * Camera modes use the look's shape (ui-architecture.md 2.7): { id, label, rig, fov, height, back, yaw?, follow,
 * cut }. height and back set the elevation angle and the nominal distance; the fitted distance never comes closer
 * than 0.6x nominal and, past 3x, the lens widens instead, up to 70 degrees.
 */
import { deepFreeze } from "../core/domain.js";
import { FIELD } from "./coords.js";
import { isFiniteNum, ownValue } from "./grammar.js";

const DEG = Math.PI / 180;
const UP = Object.freeze({ x: 0, y: 0, h: 1 });
const DEFAULT_ASPECT = 16 / 9;
const DEFAULT_MARGINS = Object.freeze({ left: 0.04, right: 0.04, top: 0.06, bottom: 0.06 });
const MIN_DISTANCE_FACTOR = 0.6;
const MAX_DISTANCE_FACTOR = 3;
const MAX_FOV = 70;
const MIN_PITCH = 5;
const RIGHT_ANGLE = 90;
const NEAR_YD = 0.1;
const EPS = 1e-6;
const FOLLOW_RADIUS = 16;          // a following camera keeps 16 yd around the ball
const FOLLOW_LOS_REACH = 28;       // and the line of scrimmage while the ball is within 28 yd of it
const FOLLOW_SPAN_Y = 30;
const LOS_CUSHION = 4;
const DRAWING_MARGIN = 4;
const DRAWING_MIN_SPAN = 24;
const DRIVE_MIN_SPAN = 30;

const dirOr = (d) => (d === -1 ? -1 : 1);

/** back and ahead of the ball, minimum spans and the margin, in yards. */
export const FRAME_PRESETS = deepFreeze({
  standard: { back: 10, ahead: 22, minSpanX: 36, spanY: FIELD.WIDTH, margin: 2 },
  tight: { back: 5, ahead: 10, minSpanX: 20, spanY: 30, margin: 2 },
  wide: { whole: true },
});

/** Rig defaults (degrees, yards). `behind` rigs turn to face the offense's attack direction. */
export const RIGS = deepFreeze({
  sideline: { pitch: 23, yaw: 0, behind: false, fov: 24, distance: 80, spanYMax: null },
  endzone: { pitch: 20, yaw: 90, behind: true, fov: 40, distance: 36, spanYMax: 34 },
  overhead: { pitch: 90, yaw: 0, behind: false, fov: 30, distance: 100, spanYMax: null },
  skycam: { pitch: 35, yaw: 90, behind: true, fov: 45, distance: 45, spanYMax: 40 },
  table: { pitch: 45, yaw: 0, behind: false, fov: 30, distance: 110, spanYMax: null },
  blimp: { pitch: 65, yaw: 0, behind: false, fov: 20, distance: 220, spanYMax: null },
});

/** Camera modes in the look's shape: broadcast and high (sideline), end zone behind the offense, overhead, tight. */
export const CAMERA_PRESETS = deepFreeze([
  { id: "broadcast", label: "Broadcast", rig: "sideline", fov: 24, height: 32, back: 75, follow: "none", cut: false },
  { id: "high", label: "High", rig: "sideline", fov: 30, height: 70, back: 55, follow: "none", cut: false },
  { id: "endzone", label: "End zone", rig: "endzone", fov: 40, height: 14, back: 30, follow: "none", cut: false },
  { id: "overhead", label: "Overhead", rig: "overhead", fov: 30, height: 100, back: 0, follow: "none", cut: true },
  { id: "tight", label: "Tight", rig: "sideline", fov: 20, height: 12, back: 34, follow: "ball", cut: false },
]);

// ---------------------------------------------------------------- frames
function fitSpan(lo, hi, minSpan, min, max) {
  const width = Math.min(max - min, Math.max(hi - lo, minSpan));
  const start = Math.min(max - width, Math.max(min, (lo + hi) / 2 - width / 2));
  return [start, start + width];
}

function boxFrame({ xs, ys = [], dir, minSpanX = 0, spanY = 0, margin = 0, maxH = 0 }) {
  const [x0, x1] = fitSpan(Math.min(...xs) - margin, Math.max(...xs) + margin, minSpanX, FIELD.X_MIN, FIELD.X_MAX);
  const mid = FIELD.WIDTH / 2;
  const yLo = Math.min(mid - spanY / 2, ...ys.map((y) => y - margin));
  const yHi = Math.max(mid + spanY / 2, ...ys.map((y) => y + margin));
  const [y0, y1] = fitSpan(yLo, yHi, 0, 0, FIELD.WIDTH);
  return { center: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, spanX: x1 - x0, spanY: y1 - y0, dir, maxH };
}

const wholeField = (dir) => ({ center: { x: FIELD.MIDFIELD_X, y: FIELD.WIDTH / 2 }, spanX: FIELD.X_MAX - FIELD.X_MIN,
  spanY: FIELD.WIDTH, dir: dirOr(dir), maxH: 0 });

function shapeExtents(shapes) {
  const list = Array.isArray(shapes) ? shapes : [];
  return {
    xs: list.flatMap((s) => [s.x0, s.x1]).filter(isFiniteNum),
    ys: list.flatMap((s) => (s.kind === "band" ? [s.y0, s.y1] : [s.yC - s.halfWidth, s.yC + s.halfWidth]))
      .filter(isFiniteNum),
  };
}

/**
 * The pre-snap frame: the line of scrimmage, the line to gain, room behind the ball for the drop and ahead of it
 * for the play, and every ghost shape when `ghosts` (a GhostSet) is given. No situation frames the whole field.
 */
export function frameSituation(sit, { preset = "standard", ghosts = null, minSpan } = {}) {
  const spec = ownValue(FRAME_PRESETS, preset) ?? FRAME_PRESETS.standard;
  if (!sit || !isFiniteNum(sit.ballX) || spec.whole) return wholeField(sit?.dir);
  const dir = dirOr(sit.dir);
  const g = shapeExtents(ghosts?.shapes);
  const ltg = isFiniteNum(sit.ltgX) ? [sit.ltgX] : [];
  const xs = [sit.ballX, sit.ballX - dir * spec.back, sit.ballX + dir * spec.ahead, ...ltg, ...g.xs];
  return boxFrame({ xs, ys: g.ys, dir, minSpanX: isFiniteNum(minSpan) ? minSpan : spec.minSpanX, spanY: spec.spanY,
    margin: spec.margin });
}

/** The frame for one drawing (paths.js): its bounds plus a margin, and its highest arc. */
export function frameDrawing(drawing, { margin = DRAWING_MARGIN, minSpan = DRAWING_MIN_SPAN } = {}) {
  const b = drawing?.bounds;
  if (!b) return wholeField(drawing?.dir);
  return boxFrame({ xs: [b.x0, b.x1], ys: [b.y0, b.y1], dir: dirOr(drawing.dir), minSpanX: minSpan, margin,
    maxH: isFiniteNum(b.h) ? b.h : 0 });
}

const rowXs = (r) => [r.geo.x0, r.geo.x_end, r.geo.x_next, r.kick?.land_x, r.kick?.ret_end_x, r.kick?.x_kick,
  r.kick?.post_x].filter(isFiniteNum);

/** Every spot of one drive's rows (timeline `drive` index), or null when the drive has none. */
export function frameDrive(rows, driveIdx) {
  const mine = (Array.isArray(rows) ? rows : []).filter((r) => r?.drive === driveIdx && r.kind !== "admin" && r.geo);
  const xs = mine.flatMap(rowXs);
  if (!xs.length) return null;
  return boxFrame({ xs, dir: dirOr(mine[0].geo.dir), minSpanX: DRIVE_MIN_SPAN, spanY: FIELD.WIDTH,
    margin: DRAWING_MARGIN });
}

/** A following frame: the ball and 16 yd around it, plus the line of scrimmage while the ball is near it. */
export function frameBall(ball, sit, { radius = FOLLOW_RADIUS } = {}) {
  if (!ball || !isFiniteNum(ball.x) || !isFiniteNum(ball.y)) return frameSituation(sit);
  const dir = dirOr(sit?.dir);
  const nearLos = isFiniteNum(sit?.ballX) && Math.abs(ball.x - sit.ballX) <= FOLLOW_LOS_REACH;
  const los = nearLos ? [sit.ballX - dir * LOS_CUSHION] : [];
  return boxFrame({ xs: [ball.x - radius, ball.x + radius, ...los], ys: [ball.y], dir, minSpanX: 2 * radius,
    spanY: FOLLOW_SPAN_Y, margin: 2, maxH: isFiniteNum(ball.h) ? Math.max(0, ball.h) : 0 });
}

/** The frame preset a camera mode wants: ball-following modes frame tight, the blimp frames the whole field. */
export function framePresetFor(mode) {
  if (mode?.follow === "ball") return "tight";
  return mode?.rig === "blimp" ? "wide" : "standard";
}

/** V: the next camera mode id, wrapping; an unknown or missing current id starts at the first. */
export function nextMode(modeIds, current) {
  if (!Array.isArray(modeIds) || !modeIds.length) return current ?? "";
  return modeIds[(modeIds.indexOf(current) + 1) % modeIds.length];
}

// ---------------------------------------------------------------- vectors (field frame: x, y, h)
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, h: (a.h ?? 0) - (b.h ?? 0) });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.h * b.h;
const cross = (a, b) => ({ x: a.y * b.h - a.h * b.y, y: a.h * b.x - a.x * b.h, h: a.x * b.y - a.y * b.x });
const len = (a) => Math.hypot(a.x, a.y, a.h);
const norm = (a) => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l, h: a.h / l };
};

/** yaw 0 looks from the near sideline toward the far one; 90 looks toward +x. pitch looks down. */
function forwardOf(yawDeg, pitchDeg) {
  const yaw = yawDeg * DEG;
  const pitch = pitchDeg * DEG;
  return { x: Math.sin(yaw) * Math.cos(pitch), y: Math.cos(yaw) * Math.cos(pitch), h: -Math.sin(pitch) };
}

/** Camera axes for a forward direction; straight down, `yawDeg` decides which way is up on screen. */
function basisOf(forward, yawDeg = 0) {
  const f = norm(forward);
  const side = cross(f, UP);
  const right = len(side) > EPS ? norm(side) : { x: Math.cos(yawDeg * DEG), y: -Math.sin(yawDeg * DEG), h: 0 };
  return { f, right, up: cross(right, f) };
}

/** The closest distance from `target` along -forward at which every point sits inside the margins. */
export function fitDistance(points, target, forward, { vFovDeg, aspect, margins = {}, yawDeg = 0 } = {}) {
  if (!isFiniteNum(vFovDeg) || vFovDeg <= 0 || vFovDeg >= 180) throw new TypeError("vFovDeg must be between 0 and 180");
  if (!isFiniteNum(aspect) || aspect <= 0) throw new TypeError("aspect must be a positive number");
  const { f, right, up } = basisOf(forward, yawDeg);
  const tanV = Math.tan((vFovDeg * DEG) / 2);
  const tanH = tanV * aspect;
  const m = { ...DEFAULT_MARGINS, ...margins };
  return points.reduce((d, p) => {
    const v = sub(p, target);
    const ax = dot(v, right);
    const ay = dot(v, up);
    const af = dot(v, f);
    const kx = (ax >= 0 ? 1 - 2 * m.right : 1 - 2 * m.left) * tanH;
    const ky = (ay >= 0 ? 1 - 2 * m.top : 1 - 2 * m.bottom) * tanV;
    return Math.max(d, Math.abs(ax) / kx - af, Math.abs(ay) / ky - af, NEAR_YD - af);
  }, NEAR_YD);
}

/** The points a mode must see: the frame's corners on the turf (the end-zone rigs only to the numbers) and its top. */
export function framePoints(frame, mode = {}) {
  const rig = ownValue(RIGS, mode?.rig) ?? RIGS.sideline;
  const spanY = rig.spanYMax ? Math.min(frame.spanY, rig.spanYMax) : frame.spanY;
  const xs = [frame.center.x - frame.spanX / 2, frame.center.x + frame.spanX / 2];
  const ys = [frame.center.y - spanY / 2, frame.center.y + spanY / 2];
  const turf = xs.flatMap((x) => ys.map((y) => ({ x, y, h: 0 })));
  const top = frame.maxH > 0 ? xs.map((x) => ({ x, y: frame.center.y, h: frame.maxH })) : [];
  return [...turf, ...top];
}

function anglesOf(mode, rig, dir) {
  const { height, back } = mode ?? {};
  const shaped = isFiniteNum(height) && isFiniteNum(back) && height >= 0 && back >= 0 && height + back > 0;
  const pitch = shaped ? Math.atan2(height, back) / DEG : rig.pitch;
  const yaw = (rig.behind ? rig.yaw * dir : rig.yaw) + (isFiniteNum(mode?.yaw) ? mode.yaw : 0);
  return { pitch: Math.min(RIGHT_ANGLE, Math.max(MIN_PITCH, pitch)), yaw,
    nominal: shaped ? Math.hypot(height, back) : rig.distance };
}

/**
 * A pose for `mode` (look camera mode: rig, fov, height, back, yaw) that keeps `frame` in view at `aspect`. Too
 * far away (past 3x the nominal distance, e.g. a phone held upright), it widens the lens instead.
 */
export function poseFor(frame, mode = {}, { aspect = DEFAULT_ASPECT, margins } = {}) {
  const f = frame?.center ? frame : wholeField(1);
  const rig = ownValue(RIGS, mode?.rig) ?? RIGS.sideline;
  const ratio = isFiniteNum(aspect) && aspect > 0 ? aspect : DEFAULT_ASPECT;
  const { pitch, yaw, nominal } = anglesOf(mode, rig, dirOr(f.dir));
  const forward = forwardOf(yaw, pitch);
  const target = { x: f.center.x, y: f.center.y, h: 0 };
  const pts = framePoints(f, mode);
  const fit = (fov) => Math.max(nominal * MIN_DISTANCE_FACTOR,
    fitDistance(pts, target, forward, { vFovDeg: fov, aspect: ratio, margins, yawDeg: yaw }));
  const baseFov = isFiniteNum(mode?.fov) && mode.fov > 0 && mode.fov < MAX_FOV ? mode.fov : rig.fov;
  const lenses = Array.from({ length: Math.floor(MAX_FOV - baseFov) + 1 }, (_, i) => baseFov + i);
  const fov = lenses.find((v) => fit(v) <= nominal * MAX_DISTANCE_FACTOR) ?? lenses[lenses.length - 1];
  const distance = fit(fov);
  const { f: dirF, up } = basisOf(forward, yaw);
  const position = { x: target.x - dirF.x * distance, y: target.y - dirF.y * distance,
    h: target.h - dirF.h * distance };
  return deepFreeze({ position, target, up, fov, distance, yaw, pitch });
}

/** Where a field point lands on screen for a pose: x and y in -1..1 when visible, depth > 0 in front. */
export function projectToNdc(point, pose, aspect) {
  const f = norm(sub(pose.target, pose.position));
  const right = cross(f, pose.up);
  const v = sub(point, pose.position);
  const depth = dot(v, f);
  const tanV = Math.tan((pose.fov * DEG) / 2);
  return { x: dot(v, right) / (depth * tanV * aspect), y: dot(v, pose.up) / (depth * tanV), depth };
}
