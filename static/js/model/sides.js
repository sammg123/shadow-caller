// Who the app shadows: one play-caller, or both sides of the game (restructure-v2.md 11 decision 4; game-picker.md 4;
// play-caller-models.md 7). Pure. /api/state names the tracked callers in `tracked` ([{team, caller, slug}], away then
// home, each with his own `metrics`, `profile` and `memory` from the engine), and with both sides every caller row of
// the log and the prediction carry their `team` and `caller`. A side's slice is the state as it reads with that caller
// alone: his calls (the log's rows of his offense), his scorecard (his tracked entry's `metrics`, else live.py's
// metrics() over his calls), his profile (his entry's, else the state's when it is his, else his name only), his
// in-game memory (his entry's, else the state's) and the prediction when it is his. With one side the state is its
// own slice, so the card and the Model Report read exactly as before. Nothing here names a team or a caller (G13).
import { isPlainObject } from "../core/domain.js";
import { freezeDeep } from "./format.js";
import { lastNameOf } from "./vm-masthead.js";

const PROB_CLIP = 1e-6;                         // features.log_loss clips p to [1e-6, 1 - 1e-6]
const FLOOR = 1e-9;                             // live.py metrics(): log(max(p, 1e-9)) on the play-type layers
const TOP3_RANK = 3;
const HALF = 0.5;
const TILT = "TILT";
const TILT_PASS = "TILT PASS";
const str = (v) => (typeof v === "string" ? v : "");
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

function sideOf(entry) {
  const caller = str(entry.caller);
  return { team: entry.team, caller, last: lastNameOf(caller), slug: str(entry.slug) || null };
}

/** The server's tracked entries that name a team, each team once (the first entry wins). */
function entriesOf(presented) {
  const list = presented && Array.isArray(presented.tracked) ? presented.tracked : [];
  const seen = new Set();
  return list.filter((t) => {
    if (!isPlainObject(t) || typeof t.team !== "string" || !t.team || seen.has(t.team)) return false;
    seen.add(t.team);
    return true;
  });
}

/**
 * The tracked play-callers in the server's order; without `tracked` (an older server), the one side the game names.
 * @param {object | null} presented  the presented /api/state
 * @returns {ReadonlyArray<{team: string, caller: string, last: string, slug: string | null}>}
 */
export function trackedSides(presented) {
  const entries = entriesOf(presented);
  if (entries.length) return freezeDeep(entries.map(sideOf));
  const team = str(presented && presented.game && presented.game.offense);
  const caller = str(presented && presented.profile && presented.profile.caller);
  return freezeDeep(team ? [{ team, caller, last: lastNameOf(caller), slug: null }] : []);
}

/** True when two play-callers are tracked (restructure-v2.md 11 decision 4). */
export function bothSides(presented) {
  return trackedSides(presented).length > 1;
}

// ---------------------------------------------------------------- live.py metrics(), over one caller's calls
const logLoss = (ys, ps) => -mean(ys.map((y, i) => {
  const p = Math.min(Math.max(ps[i], PROB_CLIP), 1 - PROB_CLIP);
  return y * Math.log(p) + (1 - y) * Math.log(1 - p);
}));
const floorLoss = (ps) => -mean(ps.map((p) => Math.log(Math.max(p, FLOOR))));

function granularOf(rows) {
  const fam = rows.filter((r) => r.fam_p !== null && r.fam_p !== undefined);
  const leaf = rows.filter((r) => r.leaf_rank !== null && r.leaf_rank !== undefined);
  const famPart = fam.length ? {
    fam_logloss: floorLoss(fam.map((r) => r.fam_p)),
    fam_logloss_league: floorLoss(fam.map((r) => r.fam_p_league)),
    fam_top_hits: fam.filter((r) => r.fam_top === r.family).length,
  } : {};
  const leafPart = leaf.length ? {
    leaf_top1: leaf.filter((r) => r.leaf_rank === 1).length,
    leaf_top3: leaf.filter((r) => r.leaf_rank <= TOP3_RANK).length,
    leaf_top3_league: leaf.filter((r) => r.leaf_rank_league <= TOP3_RANK).length,
    leaf_logloss: floorLoss(leaf.map((r) => r.leaf_p)),
    leaf_logloss_league: floorLoss(leaf.map((r) => r.leaf_p_league)),
  } : {};
  return { fam_n: fam.length, leaf_n: leaf.length, ...famPart, ...leafPart };
}

/**
 * live.py GameEngine.metrics() over these log rows (the scorecard's numbers for one caller's calls): every row but a
 * flag typed with no play (is_snap). Used when the server sends no scorecard for a side.
 * @param {object[] | null} rows  log rows
 * @returns {object} frozen, {n: 0} without a call
 */
export function metricsOf(rows) {
  const log = (Array.isArray(rows) ? rows : []).filter((r) => isPlainObject(r) && r.kind !== "penalty");
  if (!log.length) return freezeDeep({ n: 0 });
  const y = log.map((r) => Number(r.dropback));
  const p = log.map((r) => r.p);
  const p0 = log.map((r) => r.p_league);
  const flagged = log.filter((r) => str(r.flag).startsWith(TILT));
  const right = (ps) => mean(ps.map((x, i) => Number((x >= HALF) === Boolean(y[i]))));
  return freezeDeep({
    n: log.length,
    logloss_model: logLoss(y, p), logloss_league: logLoss(y, p0),
    brier_model: mean(p.map((x, i) => (x - y[i]) ** 2)), brier_league: mean(p0.map((x, i) => (x - y[i]) ** 2)),
    acc_model: right(p), acc_league: right(p0),
    dropback_rate: mean(y),
    tilt_n: flagged.length,
    tilt_hits: flagged.filter((r) => (r.flag === TILT_PASS) === Boolean(r.dropback)).length,
    granular: granularOf(log),
  });
}

// ---------------------------------------------------------------- a side's slice of the state
const slices = new WeakMap();

function profileFor(presented, side, entry) {
  if (isPlainObject(entry.profile)) return entry.profile;
  const own = presented.profile;
  if (isPlainObject(own) && str(own.caller) === side.caller) return own;
  return { caller: side.caller, team: side.team };   // his name only: the plates still name him
}

/** His in-game memory (the engine keeps one per team): his entry's, with the opening script's length (one number for
 * every caller) from the state's when his has none; else the state's. */
function memoryFor(presented, entry) {
  const shared = isPlainObject(presented.memory) ? presented.memory : null;
  if (!isPlainObject(entry.memory)) return shared;
  const script = shared && Number.isInteger(shared.script_plays) ? shared.script_plays : null;
  return Number.isInteger(entry.memory.script_plays) || script === null ? entry.memory
    : { ...entry.memory, script_plays: script };
}

function buildSlice(presented, side, entry) {
  const log = (Array.isArray(presented.log) ? presented.log : []).filter((r) => r && r.team === side.team);
  const prediction = presented.prediction && presented.prediction.team === side.team ? presented.prediction : null;
  return freezeDeep({
    ...presented,
    log,
    prediction,
    metrics: isPlainObject(entry.metrics) ? entry.metrics : metricsOf(log),
    profile: profileFor(presented, side, entry),
    memory: memoryFor(presented, entry),
  });
}

/**
 * The state as it reads with one tracked caller alone. One side, or a side nobody tracks: the state itself.
 * @param {object} presented  the presented /api/state
 * @param {string} team
 * @returns {object} frozen; the same object for the same state and side
 */
export function sideSlice(presented, team) {
  if (!bothSides(presented)) return presented;
  const entry = entriesOf(presented).find((t) => t.team === team);
  if (!entry) return presented;
  const memo = slices.get(presented) ?? new Map();
  if (!memo.has(team)) {
    memo.set(team, buildSlice(presented, sideOf(entry), entry));
    slices.set(presented, memo);
  }
  return memo.get(team);
}

// ---------------------------------------------------------------- whose card it is
/** Where the game stands: the ESPN plays on screen (/api/state's timeline pointer), else the watch's count, else 0. */
function playsIn(presented) {
  const n = presented.timeline && presented.timeline.n;
  if (Number.isInteger(n) && n >= 0) return n;
  const idx = presented.watch && presented.watch.idx;
  return Number.isInteger(idx) && idx >= 0 ? idx : 0;
}

/** The team the next drive belongs to: the progress bar's first drive mark (watch.marks) from where the game stands.
 * Before anyone has had the ball it is the team that receives the kickoff. Null without one (live before kickoff, a
 * game typed in). */
function nextDriveTeam(presented) {
  const marks = presented.watch && Array.isArray(presented.watch.marks) ? presented.watch.marks : [];
  const at = playsIn(presented);
  const next = marks.find((m) => isPlainObject(m) && m.kind === "drive" && Number.isInteger(m.idx) && m.idx >= at);
  return next ? next.team : null;
}

/**
 * The side the video board follows (restructure-v2.md 11 decision 4): with both sides, the offense with the ball; his
 * prediction first (his call is up), then ESPN's possession (the kicking team during a kickoff, so a scoring drive's
 * last play stays his previous play), then, when nobody has the ball, the last caller to call a play; before anyone
 * has called one (kickoff), the team that will have the ball (the receiving team: the next drive), then the first
 * side. One side: null (the card reads the state as it is).
 * @param {object} pv  presented view
 * @returns {{team: string, caller: string, last: string, slug: string | null} | null}
 */
export function ballSide(pv) {
  const presented = pv && pv.presented;
  const sides = trackedSides(presented);
  if (sides.length < 2) return null;
  const find = (team) => (typeof team === "string" ? sides.find((s) => s.team === team) ?? null : null);
  const status = (pv.tl && pv.tl.status) || {};
  const newest = Array.isArray(presented.log) ? presented.log.find((r) => r && r.team) : null;
  return find(presented.prediction && presented.prediction.team) ?? find(status.poss)
    ?? find(newest && newest.team) ?? find(nextDriveTeam(presented)) ?? sides[0];
}
