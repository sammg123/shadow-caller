// The top bar's playback (restructure-v2.md 2, 5 and 9): the game's state, what each key may do, the speed, where the
// game is (ESPN plays applied, of the total) and the progress bar's ticks (watch.marks). Pure.
// The freshest watch is /api/version's; the ticks come only with /api/state's watch (the 250 ms brief leaves them out).
import { WATCH } from "./copy.js";
import { freezeDeep } from "./format.js";
import { teamsOf } from "./vm-scoreboard.js";

export const SPEEDS = Object.freeze([1, 2, 4, 10]);
/** The digit key that sets each speed (core/keymap.js: 1 to 4). */
const SPEED_KEYS = Object.freeze({ 1: "1", 2: "2", 4: "3", 10: "4" });
const SESSION_STATES = Object.freeze(["playing", "paused", "done", "error"]);
const MARK_KINDS = Object.freeze(["drive", "quarter", "score"]);
const FRACTION_DP = 5;

/** The freshest watch object: /api/version's, else /api/state's, else null (an old server without watch). */
export function watchOf(pv) {
  const fromVersion = pv && pv.version && pv.version.watch;
  const fromState = pv && pv.presented && pv.presented.watch;
  const watch = fromVersion || fromState;
  return watch && typeof watch === "object" ? watch : null;
}

/** The game's ESPN status from the freshest watch that names it ({ status: "pre"|"in"|"post", detail }), or null. */
export function gameOf(pv) {
  const game = (pv && pv.version && pv.version.watch && pv.version.watch.game)
    || (pv && pv.presented && pv.presented.watch && pv.presented.watch.game);
  return game && typeof game === "object" ? game : null;
}

/** playing, paused, done or error: a watched game is on screen (the page's watch mode). */
export function isWatchSession(state) {
  return SESSION_STATES.includes(state);
}

const count = (v) => (Number.isInteger(v) && v >= 0 ? v : null);
const str = (v) => (typeof v === "string" ? v : "");
const fraction = (n, total) => (total > 0 ? Number(Math.min(1, n / total).toFixed(FRACTION_DP)) : 0);

/** A session's place: ESPN plays applied, of the total ({ idx, total }, each null when unknown). An error session
 * with nothing loaded (0 of 0: a server restart, or a first rebuild that failed) doesn't know where the game is. */
export function placeOf(watch) {
  const total = count(watch?.total);
  return watch?.state === "error" && total === 0 ? { idx: null, total: null } : { idx: count(watch?.idx), total };
}

function feedOn(pv) {
  const feed = (pv && pv.version && pv.version.feed) || (pv && pv.presented && pv.presented.feed) || null;
  return Boolean(feed && feed.on);
}

/** loading (the page is opening the game), a watch session's own state, live (following the feed), else idle. */
function stateOf(pv, watch) {
  if (pv && pv.view && pv.view.playback && pv.view.playback.kind === "open") return "loading";
  if (watch && isWatchSession(watch.state)) return watch.state;
  return feedOn(pv) ? "live" : "idle";
}

function speedList(watch, prefs, session) {
  const current = session ? watch.speed : (prefs && prefs.watchSpeed) || null;
  return SPEEDS.map((value) => ({ value, label: WATCH.speed(value), key: SPEED_KEYS[value], pressed: current === value }));
}

/** No spoilers (DC E5): the server marks the whole game, so a score shows only once play has passed it (its idx is
 * the count of plays applied once the scoring play is in); drive and quarter ticks span the game. */
const shown = (m, idx) => m.kind !== "score" || (idx !== null && m.idx <= idx);

/** watch.marks as ticks on the bar: valid entries only, each at its fraction, the caller's own marked. */
function marksOf(pv, idx, total) {
  const marks = pv && pv.presented && pv.presented.watch && pv.presented.watch.marks;
  if (!Array.isArray(marks) || !(total > 0)) return [];
  const caller = teamsOf(pv).caller;
  return marks.filter((m) => m && MARK_KINDS.includes(m.kind) && count(m.idx) !== null && m.idx <= total
    && shown(m, idx))
    .map((m, i) => ({ key: `${m.kind}-${m.idx}-${i}`, kind: m.kind, idx: m.idx, at: fraction(m.idx, total),
      team: str(m.team), caller: Boolean(caller) && str(m.team) === caller, label: str(m.label) }));
}

function valueTextOf(state, idx, total) {
  if (state === "live") return WATCH.live;
  if (idx === null || total === null) return "";
  if (idx === 0) return WATCH.kickoff;
  return idx >= total && state === "done" ? WATCH.final : WATCH.position(idx, total);
}

/** An error session (a restart, a rebuild that failed) is never taken to be at either end: Reset and Go Live rebuild
 * from it, and a step the server can't take is its 409 (core/actions.js sends them). */
function abilities(state, idx, total, live) {
  const session = isWatchSession(state);
  const known = session && idx !== null && total !== null;
  const error = state === "error";
  return {
    canBack: (known && (idx > 0 || error)) || state === "live",
    canPlay: state === "playing" || (state === "paused" && known && idx < total),
    canForward: known && (idx < total || error),
    canReset: (known && idx > 0) || state === "live" || error,
    canGoLive: (session || state === "live" || state === "idle") && !live,
    canSeek: known && total > 0,
  };
}

/** Go Live has nothing to do: the feed is followed, or a finished game shows its final state. */
function isLive(state, game, idx, total) {
  if (state === "live") return true;
  const atEnd = isWatchSession(state) && state !== "error" && idx !== null && total !== null && idx >= total;
  return atEnd && !(game && game.status === "in");
}

/**
 * @param {object} pv  presented view (ui-architecture 2.3)
 * @returns {object} frozen {state: "loading"|"playing"|"paused"|"done"|"error"|"live"|"idle", busy, idx, total,
 *   target, at, count, valueText, playing, playLabel, live, speeds: {value, label, key, pressed}[],
 *   marks: {key, kind, idx, at, team, caller, label}[], driveStarts, canBack, canPlay, canForward, canReset,
 *   canGoLive, canSeek, error}   at: where the knob sits (a seek's target while it runs), 0 to 1 of the bar
 */
export function transportVm(pv) {
  const watch = watchOf(pv);
  const state = stateOf(pv, watch);
  const session = isWatchSession(state);
  const { idx, total } = session ? placeOf(watch) : { idx: null, total: null };
  const playback = (pv && pv.view && pv.view.playback) || {};
  const target = playback.kind === "seek" && count(playback.target) !== null ? playback.target : null;
  const live = isLive(state, gameOf(pv), idx, total);
  const marks = marksOf(pv, idx, total);
  return freezeDeep({
    state, busy: Boolean(playback.kind), idx, total, target,
    at: total ? fraction(target ?? idx ?? 0, total) : live ? 1 : 0,
    count: idx !== null && total !== null ? WATCH.count(idx, total) : "",
    valueText: valueTextOf(state, idx, total),
    playing: state === "playing", playLabel: state === "playing" ? WATCH.pause : WATCH.play, live,
    speeds: speedList(watch, pv && pv.prefs, session),
    marks, driveStarts: marks.filter((m) => m.kind === "drive").map((m) => m.idx),
    ...abilities(state, idx, total, live),
    error: state === "error" ? str(watch && watch.error) : "",
  });
}
