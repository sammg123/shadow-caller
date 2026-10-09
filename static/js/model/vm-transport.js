// Watch this game transport (DC E1): state, speeds, what each button may do, progress.
import { WATCH } from "./copy.js";
import { freezeDeep } from "./format.js";

export const SPEEDS = Object.freeze([1, 2, 4, 10]);
const SESSION_STATES = Object.freeze(["playing", "paused", "done", "error"]);

/** The freshest watch object: /api/version's, else /api/state's, else null (an old server without watch). */
export function watchOf(pv) {
  const fromVersion = pv && pv.version && pv.version.watch;
  const fromState = pv && pv.presented && pv.presented.watch;
  const watch = fromVersion || fromState;
  return watch && typeof watch === "object" ? watch : null;
}

/** playing, paused, done or error: a watched game owns the screen (keymap's watch mode). */
export function isWatchSession(state) {
  return SESSION_STATES.includes(state);
}

function speedList(watch, prefs) {
  const active = watch && isWatchSession(watch.state);
  const current = active ? watch.speed : (prefs && prefs.watchSpeed) || null;
  return SPEEDS.map((value) => ({ value, label: WATCH.speed(value), pressed: current === value }));
}

function progressOf(watch) {
  if (!watch || !Number.isInteger(watch.idx) || !Number.isInteger(watch.total) || watch.total <= 0) return "";
  return WATCH.progress(watch.idx, watch.total);
}

function abilities(state, available) {
  const session = isWatchSession(state);
  return {
    canStart: available && !["playing", "paused"].includes(state),
    canPlay: state === "paused",
    canPause: state === "playing",
    canStep: state === "paused",
    canStop: session,
    canBack: state === "done",
    canAgain: state === "done",
  };
}

/**
 * @param {object} pv  presented view (ui-architecture 2.3)
 * @returns {object} frozen {available, active, state, speeds, canStart, canPlay, canPause, canStep, canStop,
 *   canBack, canAgain, progress, error}
 */
export function transportVm(pv) {
  const watch = watchOf(pv);
  const state = (watch && typeof watch.state === "string" && watch.state) || "idle";
  const available = watch !== null;
  return freezeDeep({
    available,
    active: isWatchSession(state),
    state,
    speeds: speedList(watch, pv && pv.prefs),
    ...abilities(state, available),
    progress: progressOf(watch),
    error: (watch && typeof watch.error === "string" && watch.error) || "",
  });
}
