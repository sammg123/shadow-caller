/**
 * One timeline row -> plain drawing data (data-contract B5 and B6; docs/design/play-drawing.md, binding since
 * 2026-10-09). Pure: no DOM, no three.js. Field yards in, field yards out; coords.js maps them to world or screen.
 *
 * Every scrimmage play starts on the line of scrimmage, on the center line between the hashes (ESPN gives no hash):
 * no dropback, no handoff mesh, no play-action fake, no ball behind the line. A Drawing is a list of steps in time
 * order (ui-architecture.md 2.4, v1.4):
 *   arc     a ball in the air: pass (line of scrimmage -> catch, target or interception spot), punt, kickoff, fg
 *   ground  a flat straight line on the turf: run, scramble, kneel, sack, yac, return, march, hold
 *   mark    catch (a small dot), incomplete (the X), int, td, turnover, flag, sack, safety, fg_good, fg_miss,
 *           touchback, fair_catch, downed, oob, muffed, blocked
 * Every step carries `ghosted` (the action of a no-play: drawn dimmed and dashed) and `approx` (drawn as an
 * estimate). A real pass is never one: the real play draws solid (play-drawing.md 4) and its label's depth word
 * carries the estimate (section 5; `label.approx`). Kicks with an estimated landing and a loose ball's runback are.
 * Lanes across the field are approximate by nature: a pass ends in its side's lane and a run angles to its gap
 * (grammar.js LATERAL_*).
 * `label` holds the play's words ("Deep pass left · +21", play-label.js) and where they go: beside the end of the
 * play, outward from the center line the ball rests on (a kick's under its arc), on the other side when its own
 * strokes would cross the words as the sideline cameras show them (an arc rises up the screen). `resultLabel` keeps
 * the play feed's short word.
 */
import { deepFreeze } from "../core/domain.js";
import { resultText } from "../model/format.js";
import { FIELD, clampX, clampY, xAtYardline100, yFromLateral } from "./coords.js";
import {
  AIR_DEPTH_YD, AIR_FALLBACK_YD, AIR_UNKNOWN_YD, CROSSBAR_YD, END_LINE_INSET_YD, FG_CLEARANCE_YD, FG_HOLD_YD,
  LABEL_GAP_YD, LABEL_LINE_YD, LATERAL_GAP, LATERAL_PASS, LATERAL_RUN_SIDE, arcApex, isFiniteNum, ownValue,
  runLateralOfLeaf,
} from "./grammar.js";
import { labelFootprint, placeLabelText, playLabel } from "./play-label.js";

const C = FIELD.CENTER_Y;
const EPS = 1e-9;
const KICKOFF_YL100 = 65;          // kickoffs after a score: the kicking team's own 35
const SAFETY_KICK_YL100 = 80;      // the free kick after a safety: the conceding team's own 20
const LANDING_MARKS = Object.freeze(["touchback", "fair_catch", "downed", "oob", "muffed"]);

const num = (v) => (isFiniteNum(v) ? v : null);
const pt = (x, y = C) => ({ x: clampX(x), y: clampY(y) });
const kdirOf = (k, fallback) => (k.kdir === 1 || k.kdir === -1 ? k.kdir : fallback);
/** x kept inside the end lines by END_LINE_INSET_YD: a target the row does not pin never sits on the posts. */
const insideX = (x) => Math.min(FIELD.X_MAX - END_LINE_INSET_YD, Math.max(FIELD.X_MIN + END_LINE_INSET_YD, x));

// ---------------------------------------------------------------- step constructors
const ground = (role, from, to, approx, ghosted) => ({ t: "ground", role, from, to, approx, ghosted });
const mark = (role, at, ghosted, approx = false) => ({ t: "mark", role, at, approx, ghosted });

function arc(role, from, to, { endH = 0, approx, ghosted }) {
  const apex = arcApex(role, Math.hypot(to.x - from.x, to.y - from.y));
  return { t: "arc", role, from, to, apex, endH, approx, ghosted };
}

// ---------------------------------------------------------------- row facts
function spots(row) {
  const g = row.geo ?? {};
  return { dir: g.dir === -1 ? -1 : 1, x0: num(g.x0), xEnd: num(g.x_end), xNext: num(g.x_next) };
}

const isTouchdown = (row) => Boolean(row.result?.td) || row.scoring?.type === "TD";
const lostFumble = (row) => Boolean(row.result?.turnover) && row.result?.turnover_kind !== "int";
const estimated = (row, field) => Array.isArray(row.geo?.approx) && row.geo.approx.includes(field);
const lineOf = (row) => pt(spots(row).x0);

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

/** Safety, lost fumble and touchdown marks after a scrimmage action; `label` is where the play's words go. */
function finishAction(row, steps, end, ghosted, label) {
  const safety = row.result?.safety ? [mark("safety", end, ghosted)] : [];
  const base = { at: end, steps: [...steps, ...safety] };
  const acc = lostFumble(row) ? fumbleRunback(row, base, ghosted) : base;
  const td = isTouchdown(row) ? [mark("td", acc.at, ghosted)] : [];
  return { steps: [...acc.steps, ...td], end: acc.at, label: label ?? acc.at };
}

// ---------------------------------------------------------------- scrimmage actions (play-drawing.md 2)
/** Run, scramble: one flat line from the line of scrimmage to where the play ended, angled to its gap. */
function lineAction(row, ghosted, role) {
  const end = pt(carrierEndX(row), yFromLateral(runLateral(row), spots(row).dir));
  return finishAction(row, [ground(role, lineOf(row), end, false, ghosted)], end, ghosted);
}

function sackAction(row, ghosted) {
  const end = pt(carrierEndX(row));
  return finishAction(row, [ground("sack", lineOf(row), end, false, ghosted), mark("sack", end, ghosted)],
    end, ghosted);
}

/** The catch (or interception) x: exact from the row, else estimated from the air yards or a fallback; an
 * estimated catch never lands past where the receiver went down. */
function catchX(row, { capAtEnd }) {
  const { dir, x0 } = spots(row);
  const given = num(row.geo.x_catch);
  if (given != null) return given;
  const air = num(row.call?.air) ?? ownValue(AIR_FALLBACK_YD, row.call?.leaf) ?? AIR_FALLBACK_YD.other;
  const endX = carrierEndX(row);
  const x = x0 + dir * air;
  return capAtEnd && (endX - x) * dir < 0 ? endX : x;
}

/** The throw, from the line of scrimmage, drawn solid even to an estimated spot: the label's depth word says so. */
const throwTo = (row, at, ghosted) => arc("pass", lineOf(row), at, { approx: false, ghosted });
/** The row pins no exact spot where the ball came down (an incompletion's target, a typed row's catch). */
const airEstimated = (row) => num(row.geo.x_catch) == null || estimated(row, "x_catch");

function completeAction(row, ghosted) {
  const at = pt(catchX(row, { capAtEnd: true }), passY(row));
  const end = pt(carrierEndX(row), at.y);
  const yac = end.x === at.x ? [] : [ground("yac", at, end, false, ghosted)];
  return finishAction(row, [throwTo(row, at, ghosted), mark("catch", at, ghosted), ...yac], end, ghosted);
}

function interceptionAction(row, ghosted) {
  const at = pt(catchX(row, { capAtEnd: false }), passY(row));
  const steps = [throwTo(row, at, ghosted), mark("int", at, ghosted)];
  const back = moveTo({ at, steps }, spots(row).xEnd, false, ghosted);
  const action = finishAction(row, back.steps, back.at, ghosted);
  return back.at === at ? { ...action, estimate: airEstimated(row) } : action;
}

/** An incompletion's target: its air yards (exact or ESPN's estimate), else the depth word's median. */
function targetX(row) {
  const { dir, x0 } = spots(row);
  const given = num(row.geo.x_catch);
  const air = num(row.call?.air) ?? ownValue(AIR_DEPTH_YD, row.call?.depth) ?? AIR_UNKNOWN_YD;
  return insideX(given ?? x0 + dir * air);
}

function incompleteAction(row, ghosted) {
  const target = pt(targetX(row), passY(row));
  const steps = [throwTo(row, target, ghosted), mark("incomplete", target, ghosted)];
  return { ...finishAction(row, steps, lineOf(row), ghosted, target), estimate: airEstimated(row) };
}

const PLAY_ACTIONS = Object.freeze({
  sack: sackAction,
  scramble: (row, ghosted) => lineAction(row, ghosted, "scramble"),
  run: (row, ghosted) => lineAction(row, ghosted, "run"),
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

/** Kneel and other: a line on the turf when the ball moved; a spike draws nothing. */
function kneelAction(row, ghosted) {
  const { x0, xEnd } = spots(row);
  const end = pt(xEnd ?? x0);
  const moved = row.kind !== "spike" && end.x !== x0;
  return finishAction(row, moved ? [ground("kneel", lineOf(row), end, false, ghosted)] : [], end, ghosted);
}

// ---------------------------------------------------------------- kicks (unchanged by play-drawing.md)
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
  penalty: (row) => ({ steps: [], end: lineOf(row), label: lineOf(row) }),
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

/** The flag and the enforcement walk. A no-play walks from the line; a flag on a play that stands, from where it
 * was enforced (else the end of the play). */
function flagTail(row, action) {
  const pen = row.result?.penalty;
  const { x0, xNext } = spots(row);
  const flagAt = pt(num(pen?.at_x) ?? x0);
  if (row.result?.nullified || row.kind === "penalty") {
    return { steps: [mark("flag", flagAt, false), ...march(x0, xNext)], labelAt: flagAt };
  }
  if (!pen) return { steps: [], labelAt: null };
  const enforced = pen.status !== "declined" && pen.status !== "offsetting";
  const walk = enforced ? march(num(pen.at_x) ?? action.end.x, xNext) : [];
  return { steps: [mark("flag", flagAt, false), ...walk], labelAt: null };
}

// ---------------------------------------------------------------- the label (play-drawing.md 3)
/** Kicks fly high over the center line: their words go toward the near sideline first, under the arc. */
const KICKS = new Set(["kickoff", "punt", "fg", "fg_miss"]);
const LABEL_TRIES = 3;

/** Beside the end of the play: on its side (`side` -1 toward the near sideline, 1 the far one), then the other side,
 * then a line further out each way; never within LABEL_GAP_YD of the center line the next ball rests on. */
function labelCandidates(anchor, side) {
  return Array.from({ length: LABEL_TRIES }, (_, k) => LABEL_GAP_YD + k * LABEL_LINE_YD)
    .flatMap((gap) => [side, -side].map((s) => ({ x: anchor.x, y: anchor.y + s * gap })))
    .filter((p) => Math.abs(p.y - C) >= LABEL_GAP_YD - EPS);
}

/**
 * The words and where they go: beside the end of the play, outward from the center line (a kick toward the near
 * sideline), unless its own strokes, as the sideline cameras show them (labelFootprint: an arc rises up the
 * screen), or the ball would sit under them. `approx`: the spot the words describe is an estimate (ESPN's "short"
 * target, a loose ball's runback).
 */
function labelOf(row, action, tail, { steps, balls }) {
  const text = playLabel(row);
  if (!text) return null;
  const anchor = tail.labelAt ?? action.label;
  const side = KICKS.has(row.kind) || anchor.y < C - EPS ? -1 : 1;
  const points = [...labelFootprint(steps), ...balls.filter(Boolean)];
  const at = placeLabelText(text, labelCandidates(anchor, side), { points });
  const strokes = tail.labelAt ? [] : action.steps.filter((s) => s.t === "arc" || s.t === "ground");
  return { text, at, approx: tail.labelAt ? false : action.estimate ?? Boolean(strokes.at(-1)?.approx) };
}

// ---------------------------------------------------------------- bounds
const extentOf = (step) => (step.t === "mark" ? [step.at] : [step.from, step.to]);

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
 * A row as plain drawing data: { seq, id, kind, team, dir, offenseIsCaller, ghosted, steps, ballStart, ballEnd,
 * resultLabel: {at, text} | null, label: {text, at, approx} | null, bounds }. Admin rows (and rows with no spot)
 * have no steps and no labels. Never mutates the row; the result is deep-frozen.
 */
export function buildDrawing(row) {
  if (!row || typeof row !== "object") throw new TypeError("buildDrawing needs a timeline row");
  const head = {
    seq: row.seq, id: row.id, kind: row.kind, team: row.team, dir: spots(row).dir,
    offenseIsCaller: Boolean(row.offense_is_caller), ghosted: Boolean(row.result?.nullified),
  };
  const build = row.kind !== "admin" && spots(row).x0 != null ? ownValue(ACTIONS, row.kind) : undefined;
  if (!build) {
    return deepFreeze({ ...head, steps: [], ballStart: null, ballEnd: null, resultLabel: null, label: null,
      bounds: null });
  }
  const action = build(row, head.ghosted);
  const tail = flagTail(row, action);
  const steps = [...action.steps, ...tail.steps];
  const ballStart = pt(num(row.kick?.from_x) ?? spots(row).x0);
  const ballEnd = spots(row).xNext == null ? null : pt(spots(row).xNext);
  const text = resultText(row);
  const resultLabel = text ? { at: tail.labelAt ?? action.label, text } : null;
  const label = labelOf(row, action, tail, { steps, balls: [ballStart, ballEnd] });
  return deepFreeze({ ...head, steps, ballStart, ballEnd, resultLabel, label,
    bounds: boundsOf(steps, [ballStart, ballEnd]) });
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

/** The situation before the row's snap (or kick): what review and shadow replay draw. Null for admin rows. */
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
