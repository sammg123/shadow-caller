/**
 * One timeline row -> plain drawing data (data-contract B5 and B6, directions.md "Shared approximation grammar").
 * Pure: no DOM, no three.js. Field yards in, field yards out; coords.js maps them to world or screen space.
 *
 * A Drawing is a list of steps in time order (ui-architecture.md 2.4):
 *   arc       a ball in flight: pass, punt, kickoff, fg (true length, generic height)
 *   ground    a straight stroke on the turf: snap, hold, yac, return, sack, kneel, march
 *   corridor  a lane with soft edges and no cutbacks: run, scramble
 *   area      the catch area (a small area, never a dot)
 *   band      where an incompletion fell: the whole depth range in the side's third
 *   mark      td, turnover, flag, sack, safety, fg_good, fg_miss, touchback, fair_catch, downed, oob, muffed, blocked
 * Every step carries `ghosted` (the action of a no-play) and every stroke `approx` (an estimate, drawn as one).
 * The ball sits on the center line: ESPN gives no hash. A snap step (the drop or the mesh) is a drawing convention,
 * so a pass thrown from its end is approximate too, even when the air yards are exact (PRODUCT principle 3).
 */
import { deepFreeze } from "../core/domain.js";
import { resultText } from "../model/format.js";
import { FIELD, clampX, clampY, depthSpan, xAtYardline100, yFromLateral } from "./coords.js";
import {
  AIR_FALLBACK_YD, AIR_UNKNOWN_BAND, CATCH_AREA_RADIUS, CROSSBAR_YD, FG_CLEARANCE_YD, FG_HOLD_YD, FULL_WIDTH,
  LANE_HALF_WIDTH, LATERAL_GAP, LATERAL_PASS, LATERAL_RUN_SIDE, MIN_BAND_YD, THIRDS, arcApex, dropDepthYd,
  isFiniteNum, meshDepthYd, ownValue, runLateralOfLeaf,
} from "./grammar.js";

const C = FIELD.CENTER_Y;
const KICKOFF_YL100 = 65;          // kickoffs after a score: the kicking team's own 35
const SAFETY_KICK_YL100 = 80;      // the free kick after a safety: the conceding team's own 20
const LANDING_MARKS = Object.freeze(["touchback", "fair_catch", "downed", "oob", "muffed"]);

const num = (v) => (isFiniteNum(v) ? v : null);
const pt = (x, y = C) => ({ x: clampX(x), y: clampY(y) });
const kdirOf = (k, fallback) => (k.kdir === 1 || k.kdir === -1 ? k.kdir : fallback);

// ---------------------------------------------------------------- step constructors
const ground = (role, from, to, approx, ghosted) => ({ t: "ground", role, from, to, approx, ghosted });
const mark = (role, at, ghosted) => ({ t: "mark", role, at, ghosted });
const area = (at, ghosted) => ({ t: "area", role: "catch", at, r: CATCH_AREA_RADIUS, approx: true, ghosted });
const band = (box, ghosted) => ({ t: "band", role: "incomplete", ...box, approx: true, ghosted });

function arc(role, from, to, { endH = 0, approx, ghosted }) {
  const apex = arcApex(role, Math.hypot(to.x - from.x, to.y - from.y));
  return { t: "arc", role, from, to, apex, endH, approx, ghosted };
}

function corridor(role, x0, x1, yC, ghosted) {
  return { t: "corridor", role, x0: clampX(x0), x1: clampX(x1), yC, halfWidth: LANE_HALF_WIDTH, approx: true, ghosted };
}

// ---------------------------------------------------------------- row facts
function spots(row) {
  const g = row.geo ?? {};
  const x0 = num(g.x0);
  return { dir: g.dir === -1 ? -1 : 1, x0, xEnd: num(g.x_end), xNext: num(g.x_next) };
}

const isTouchdown = (row) => Boolean(row.result?.td) || row.scoring?.type === "TD";
const lostFumble = (row) => Boolean(row.result?.turnover) && row.result?.turnover_kind !== "int";

/** Where the ball carrier went down. A lost fumble's x_end can be the defense's touchdown, so use the gain. */
function carrierEndX(row) {
  const { dir, x0, xEnd } = spots(row);
  const yards = num(row.result?.yards);
  return lostFumble(row) && yards != null ? clampX(x0 + dir * yards) : xEnd ?? x0;
}

/** Lane offset: the gap words, else the run leaf (manual rows), else the side, else straight up the middle. */
function runLateral(row) {
  return ownValue(LATERAL_GAP, row.geo.gap) ?? runLateralOfLeaf(row.call?.leaf)
    ?? ownValue(LATERAL_RUN_SIDE, row.geo.lat) ?? 0;
}

const passY = (row) => clampY(yFromLateral(ownValue(LATERAL_PASS, row.geo.lat) ?? 0, spots(row).dir));

// ---------------------------------------------------------------- what happens after the action
function moveTo(acc, x, approx, ghosted) {
  if (x == null || x === acc.at.x) return acc;
  const to = pt(x, acc.at.y);
  return { at: to, steps: [...acc.steps, ground("return", acc.at, to, approx, ghosted)] };
}

/** A lost fumble: the turnover mark, then the defense's runback (to its touchdown or its next snap). */
function fumbleRunback(row, acc, ghosted) {
  const { xEnd, xNext } = spots(row);
  const marked = { at: acc.at, steps: [...acc.steps, mark("turnover", acc.at, ghosted)] };
  return moveTo(marked, isTouchdown(row) ? xEnd : xNext ?? xEnd, true, ghosted);
}

/** Safety, lost fumble and touchdown marks after a scrimmage action. */
function finishAction(row, steps, end, ghosted, label) {
  const safety = row.result?.safety ? [mark("safety", end, ghosted)] : [];
  const base = { at: end, steps: [...steps, ...safety] };
  const acc = lostFumble(row) ? fumbleRunback(row, base, ghosted) : base;
  const td = isTouchdown(row) ? [mark("td", acc.at, ghosted)] : [];
  return { steps: [...acc.steps, ...td], end: acc.at, label: label ?? acc.at };
}

// ---------------------------------------------------------------- scrimmage actions
function laneAction(row, ghosted, role) {
  const { dir, x0 } = spots(row);
  const back = role === "run" ? meshDepthYd(row.call?.align) : dropDepthYd(row.call);
  const endX = carrierEndX(row);
  const yC = clampY(yFromLateral(runLateral(row), dir));
  const steps = [ground("snap", pt(x0), pt(x0 - dir * back), true, ghosted), corridor(role, x0, endX, yC, ghosted)];
  return finishAction(row, steps, pt(endX, yC), ghosted);
}

function sackAction(row, ghosted) {
  const end = pt(carrierEndX(row));
  return finishAction(row, [ground("sack", pt(spots(row).x0), end, false, ghosted), mark("sack", end, ghosted)],
    end, ghosted);
}

function passStart(row, ghosted) {
  const { dir, x0 } = spots(row);
  const release = pt(x0 - dir * dropDepthYd(row.call));
  return { snap: ground("snap", pt(x0), release, true, ghosted), release };
}

/** The catch (or interception) x: exact from the row, else estimated from the air yards or a fallback. */
function catchX(row, { capAtEnd }) {
  const { dir, x0 } = spots(row);
  const given = num(row.geo.x_catch);
  if (given != null) return given;
  const air = num(row.call?.air) ?? ownValue(AIR_FALLBACK_YD, row.call?.leaf) ?? AIR_FALLBACK_YD.other;
  const endX = carrierEndX(row);
  const x = x0 + dir * air;
  return capAtEnd && (endX - x) * dir < 0 ? endX : x;
}

/** The throw: from the snap step's end (an estimated set point), so always approximate. */
const throwTo = (release, at, ghosted) => arc("pass", release, at, { approx: true, ghosted });

function completeAction(row, ghosted) {
  const { snap, release } = passStart(row, ghosted);
  const at = pt(catchX(row, { capAtEnd: true }), passY(row));
  const end = pt(carrierEndX(row), at.y);
  const yac = end.x === at.x ? [] : [ground("yac", at, end, false, ghosted)];
  return finishAction(row, [snap, throwTo(release, at, ghosted), area(at, ghosted), ...yac], end, ghosted);
}

function interceptionAction(row, ghosted) {
  const { snap, release } = passStart(row, ghosted);
  const at = pt(catchX(row, { capAtEnd: false }), passY(row));
  const steps = [snap, throwTo(release, at, ghosted), mark("turnover", at, ghosted)];
  const back = moveTo({ at, steps }, spots(row).xEnd, false, ghosted);
  return finishAction(row, back.steps, back.at, ghosted);
}

function incompletionBox(row) {
  const { dir, x0 } = spots(row);
  const given = row.call?.air_band;
  const range = Array.isArray(given) && num(given[0]) != null && num(given[1]) != null ? given : AIR_UNKNOWN_BAND;
  const { x0: bx0, x1: bx1 } = depthSpan(x0, dir, range, MIN_BAND_YD);
  const [l0, l1] = ownValue(THIRDS, row.geo.lat) ?? FULL_WIDTH;
  const ys = [yFromLateral(l0, dir), yFromLateral(l1, dir)];
  return { x0: bx0, x1: bx1, y0: clampY(Math.min(...ys)), y1: clampY(Math.max(...ys)) };
}

function incompleteAction(row, ghosted) {
  const { snap, release } = passStart(row, ghosted);
  const box = incompletionBox(row);
  const est = num(row.geo.x_catch);
  const lo = Math.min(box.x0, box.x1);
  const hi = Math.max(box.x0, box.x1);
  const target = pt(est == null ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, est)), passY(row));
  const steps = [snap, throwTo(release, target, ghosted), band(box, ghosted)];
  return finishAction(row, steps, pt(spots(row).x0), ghosted, target);
}

const PLAY_ACTIONS = Object.freeze({
  sack: sackAction,
  scramble: (row, ghosted) => laneAction(row, ghosted, "scramble"),
  run: (row, ghosted) => laneAction(row, ghosted, "run"),
  int: interceptionAction,
  incomplete: incompleteAction,
  complete: completeAction,
});

function playShape(row) {
  const call = row.call ?? {};
  if (call.outcome === "sack" || call.outcome === "scramble") return call.outcome;
  if (call.family === "run" || call.leaf === "rpo_run" || !call.family) return "run";
  if (row.result?.turnover_kind === "int") return "int";
  return call.outcome === "incomplete" ? "incomplete" : "complete";
}

function kneelAction(row, ghosted) {
  const { x0, xEnd } = spots(row);
  const end = pt(xEnd ?? x0);
  return finishAction(row, end.x === x0 ? [] : [ground("kneel", pt(x0), end, false, ghosted)], end, ghosted);
}

// ---------------------------------------------------------------- kicks
function blockedFrom(row, steps, at, ghosted) {
  const { xEnd, xNext } = spots(row);
  const moved = moveTo({ at, steps: [...steps, mark("blocked", at, ghosted)] }, xEnd ?? xNext, true, ghosted);
  const td = isTouchdown(row) ? [mark("td", moved.at, ghosted)] : [];
  return { steps: [...moved.steps, ...td], end: moved.at, label: moved.at };
}

/** After the landing: the return, a fumble recovery (turnover mark when the receivers lost it), the dead ball. */
function kickRunback(row, k, land, ghosted) {
  const recX = num(k.fumble_rec?.x);
  const legs = [
    { x: num(k.ret_end_x), approx: false, then: null },
    { x: recX, approx: true, then: row.result?.turnover && recX != null ? "turnover" : null },
    { x: spots(row).xEnd, approx: true, then: null },
  ];
  const walked = legs.reduce((acc, leg) => {
    const moved = moveTo(acc, leg.x, leg.approx, ghosted);
    return leg.then ? { ...moved, steps: [...moved.steps, mark(leg.then, moved.at, ghosted)] } : moved;
  }, { at: land, steps: [] });
  const td = isTouchdown(row) ? [mark("td", walked.at, ghosted)] : [];
  return { steps: [...walked.steps, ...td], end: walked.at, label: walked.at };
}

function kickAction(row, ghosted, role) {
  const k = row.kick ?? {};
  const { dir, x0 } = spots(row);
  const kdir = kdirOf(k, role === "kickoff" ? -dir : dir);
  const fromX = num(k.from_x) ?? x0;
  const from = pt(fromX);
  if (k.blocked) return blockedFrom(row, [], from, ghosted);
  const dist = num(k.dist);
  const landX = num(k.land_x) ?? (dist == null ? null : clampX(fromX + kdir * dist));
  if (landX == null) return kickRunback(row, k, from, ghosted);
  const land = pt(landX);
  const flight = arc(role, from, land, { approx: num(k.land_x) == null, ghosted });
  const marks = LANDING_MARKS.filter((key) => k[key] === true).map((key) => mark(key, land, ghosted));
  const run = kickRunback(row, k, land, ghosted);
  return { ...run, steps: [flight, ...marks, ...run.steps] };
}

function fgAction(row, ghosted) {
  const k = row.kick ?? {};
  const { dir, x0 } = spots(row);
  const kdir = kdirOf(k, dir);
  const postX = num(k.post_x) ?? (kdir === 1 ? FIELD.POSTS_X[1] : FIELD.POSTS_X[0]);
  const dist = num(k.dist);
  const kickX = num(k.x_kick) ?? (dist == null ? x0 - kdir * FG_HOLD_YD : postX - kdir * dist);
  const hold = pt(kickX);
  const snap = ground("hold", pt(x0), hold, num(k.x_kick) == null && dist == null, ghosted);
  if (k.blocked) return blockedFrom(row, [snap], hold, ghosted);
  const good = typeof k.good === "boolean" ? k.good : row.kind === "fg";
  const posts = pt(postX);
  const endH = good ? CROSSBAR_YD + FG_CLEARANCE_YD : CROSSBAR_YD;
  const kick = arc("fg", hold, posts, { endH, approx: !good, ghosted });
  return { steps: [snap, kick, mark(good ? "fg_good" : "fg_miss", posts, ghosted)], end: hold, label: posts };
}

const ACTIONS = Object.freeze({
  play: (row, ghosted) => PLAY_ACTIONS[playShape(row)](row, ghosted),
  penalty: (row) => ({ steps: [], end: pt(spots(row).x0), label: pt(spots(row).x0) }),
  kneel: kneelAction,
  spike: kneelAction,
  other: kneelAction,
  punt: (row, ghosted) => kickAction(row, ghosted, "punt"),
  kickoff: (row, ghosted) => kickAction(row, ghosted, "kickoff"),
  fg: fgAction,
  fg_miss: fgAction,
});

// ---------------------------------------------------------------- flags
const march = (fromX, toX) => (toX == null || toX === fromX ? [] : [ground("march", pt(fromX), pt(toX), false, false)]);

/** The flag and the enforcement walk. A no-play walks from the line; a flag on a play that stands, from x_end. */
function flagTail(row, action) {
  const pen = row.result?.penalty;
  const { x0, xNext } = spots(row);
  const flagAt = pt(num(pen?.at_x) ?? x0);
  if (row.result?.nullified || row.kind === "penalty") {
    return { steps: [mark("flag", flagAt, false), ...march(x0, xNext)], labelAt: flagAt };
  }
  if (!pen) return { steps: [], labelAt: null };
  const enforced = pen.status !== "declined" && pen.status !== "offsetting";
  return { steps: [mark("flag", flagAt, false), ...(enforced ? march(action.end.x, xNext) : [])], labelAt: null };
}

// ---------------------------------------------------------------- bounds
function extentOf(step) {
  if (step.t === "arc" || step.t === "ground") return [step.from, step.to];
  if (step.t === "corridor") {
    return [{ x: step.x0, y: step.yC - step.halfWidth }, { x: step.x1, y: step.yC + step.halfWidth }];
  }
  if (step.t === "area") {
    return [{ x: step.at.x - step.r, y: step.at.y - step.r }, { x: step.at.x + step.r, y: step.at.y + step.r }];
  }
  if (step.t === "band") return [{ x: step.x0, y: step.y0 }, { x: step.x1, y: step.y1 }];
  return [step.at];
}

function boundsOf(steps, extras) {
  const pts = [...steps.flatMap(extentOf), ...extras.filter(Boolean)];
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const h = Math.max(0, ...steps.filter((s) => s.t === "arc").map((s) => s.apex + s.endH));
  return { x0: clampX(Math.min(...xs)), x1: clampX(Math.max(...xs)), y0: clampY(Math.min(...ys)),
    y1: clampY(Math.max(...ys)), h };
}

// ---------------------------------------------------------------- public API
/**
 * A row as plain drawing data. Admin rows (and rows with no spot) have no steps. The result label's text is the
 * play feed's own word (model/format.js resultText), placed at the end of the action, or at the flag of a no-play.
 * Never mutates the row.
 */
export function buildDrawing(row) {
  if (!row || typeof row !== "object") throw new TypeError("buildDrawing needs a timeline row");
  const head = {
    seq: row.seq, id: row.id, kind: row.kind, team: row.team, dir: spots(row).dir,
    offenseIsCaller: Boolean(row.offense_is_caller), ghosted: Boolean(row.result?.nullified),
  };
  const build = row.kind !== "admin" && spots(row).x0 != null ? ownValue(ACTIONS, row.kind) : undefined;
  if (!build) {
    return deepFreeze({ ...head, steps: [], ballStart: null, ballEnd: null, resultLabel: null, bounds: null });
  }
  const action = build(row, head.ghosted);
  const tail = flagTail(row, action);
  const steps = [...action.steps, ...tail.steps];
  const ballStart = pt(num(row.kick?.from_x) ?? spots(row).x0);
  const ballEnd = spots(row).xNext == null ? null : pt(spots(row).xNext);
  const text = resultText(row);
  const resultLabel = text ? { at: tail.labelAt ?? action.label, text } : null;
  return deepFreeze({ ...head, steps, ballStart, ballEnd, resultLabel, bounds: boundsOf(steps, [ballStart, ballEnd]) });
}

function snapSituation(ballX, dir, poss, s) {
  const down = num(s?.down);
  const togo = num(s?.togo);
  const yl = num(s?.yardline_100);
  const goalToGo = typeof s?.goal_to_go === "boolean" ? s.goal_to_go : togo != null && yl != null && togo >= yl;
  const ahead = togo == null ? null : Math.min(FIELD.GOAL_X[1], Math.max(FIELD.GOAL_X[0], ballX + dir * togo));
  const ltgX = goalToGo ? (dir === 1 ? FIELD.GOAL_X[1] : FIELD.GOAL_X[0]) : ahead;
  return { ballX, ltgX, dir, poss: poss ?? null, kind: "snap", goalToGo, down, togo };
}

const kickoffSituation = (ballX, dir, poss) => ({ ballX, ltgX: null, dir, poss: poss ?? null, kind: "kickoff",
  goalToGo: false, down: null, togo: null });

/** The situation before the row's snap (or kick): what review and ghost replay draw. Null for admin rows. */
export function situationFromRow(row) {
  if (!row || row.kind === "admin" || !row.geo) return null;
  const { dir, x0 } = spots(row);
  if (x0 == null) return null;
  if (row.kind !== "kickoff") return snapSituation(x0, dir, row.team, row.pre);
  const k = row.kick ?? {};
  return kickoffSituation(num(k.from_x) ?? x0, kdirOf(k, -dir), k.by);
}

/** The situation after the row: the next snap, or the kickoff after a score. Null when nothing follows. */
export function situationAfterRow(row) {
  if (!row || row.kind === "admin" || !row.geo) return null;
  const { dir, xNext } = spots(row);
  if (xNext != null) {
    const poss = row.post?.poss ?? row.team;
    return snapSituation(xNext, poss === row.team ? dir : -dir, poss, row.post);
  }
  if (!row.scoring) return null;
  const safety = row.scoring.type === "SF";
  const kickerIsTeam = safety ? row.scoring.team !== row.team : row.scoring.team === row.team;
  const kdir = kickerIsTeam ? dir : -dir;
  const ballX = xAtYardline100(safety ? SAFETY_KICK_YL100 : KICKOFF_YL100, kdir);
  return kickoffSituation(ballX, kdir, kickerIsTeam ? row.team : row.opp);
}
