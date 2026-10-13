// Intents to requests (ui-architecture.md 2.8 and 3.3; restructure-v2.md 2, 5 and 9; G13; owner A2).
// The only caller of api.post. POSTs go one at a time (FIFO); each response that carries a state is applied with
// origin "action", then a tick is kicked. Failed requests become red toasts and never throw; a bug after a successful
// POST surfaces as itself. The clock and the timers are called bare (browsers throw "Illegal invocation" otherwise).
// The page never sends user input into the game (restructure-v2.md 1): it opens the game, plays, pauses, seeks, steps
// and goes live. Those that move the game (open, seek, back, forward, Go Live) are jumps: the field snaps to the row
// the server landed on (anim/jump). They and play/pause share one lane, so a burst of presses never stacks requests:
// while one is in flight the newest press waits for it and any press already waiting is dropped. Every action below
// takes the context `c` that createActions builds.
// restructure-v2.md 11: the game picker's choice (another game, or the same game with other sides) is one more jump in
// the lane: POST /api/game/select answers the new track's state, and the field, the timeline and the HUD follow it.
import { TOASTS } from "../model/copy.js";
import { placeOf } from "../model/vm-transport.js";
import { ROUTES } from "./api.js";
import { isPlainObject, isStateBody } from "./domain.js";

export const TOAST_MS = 2600;
/** G5-13: an error stays up until it has been read: 8 s, held while the pointer or focus is on it, or until Dismiss
 * (or Esc). An info toast is gone in 2.6 s (FI 4.5). */
export const TOAST_ERROR_MS = 8000;
const WATCH_SPEEDS = Object.freeze([1, 2, 4, 10]);
const SESSION = Object.freeze(["playing", "paused", "done", "error"]);
const HELD = Object.freeze(["paused", "done"]);
const AMBIENTS = Object.freeze(["room", "dark"]);
const QUIET = Object.freeze({ toastOn: "errors" });
const JUMP = Object.freeze({ toastOn: "errors", jump: true });
/** game-picker.md 4: an ESPN event id is digits; a side is a team abbreviation; one side, or both. */
const EVENT_ID_RE = /^[0-9]{1,12}$/;
const SIDE_RE = /^[A-Z]{2,4}$/;
const MAX_SIDES = 2;
const SELECTION_KEYS = Object.freeze(["event_id", "sides"]);

/** Toast text: model/copy.js is the source. */
export const ACTION_COPY = Object.freeze({
  offline: TOASTS.networkFail,
  serverError: TOASTS.serverError,
});

const errorText = (err) => (err && typeof err.message === "string" ? err.message : String(err));

// ---------------------------------------------------------------- toasts and the POST queue
/** The toast's clock: show(message, err) and, for the toast now up (by id), hold, release and dismiss. A replaced
 * toast's timer may still fire: toast/hide carries the id, so it never hides a newer toast. */
function makeToaster(dispatch, setTimer, clearTimer) {
  let seq = 0;
  let live = null;   // the toast now up: { id, ms, timer } (timer null while held)
  const arm = (id, ms) => ({ id, ms, timer: setTimer(() => dispatch({ type: "toast/hide", id }), ms) });
  const show = (message, err = false) => {
    if (typeof message !== "string" || message === "") return;
    seq += 1;
    dispatch({ type: "toast/show", id: seq, text: message, err });
    live = arm(seq, err ? TOAST_ERROR_MS : TOAST_MS);
  };
  const isLive = (id) => live !== null && (id === undefined || id === live.id);
  return Object.assign(show, {
    hold(id) {
      if (!isLive(id) || live.timer === null) return;
      clearTimer(live.timer);
      live = { ...live, timer: null };
    },
    release(id) {
      if (isLive(id) && live.timer === null) live = arm(live.id, live.ms);
    },
    dismiss(id) {
      if (!isLive(id)) return;
      if (live.timer !== null) clearTimer(live.timer);
      dispatch({ type: "toast/hide", id: live.id });
      live = null;
    },
  });
}

/** The row a jump landed on (the state's timeline pointer), or null when the body doesn't say. */
function landingOf(body) {
  const p = isPlainObject(body) ? body.timeline : null;
  return isPlainObject(p) && typeof p.epoch === "string" && Number.isInteger(p.n) ? { epoch: p.epoch, n: p.n } : null;
}

function respond(c, { status, body }, reqSeq, opts) {
  const error = isPlainObject(body) && typeof body.error === "string" && body.error !== "" ? body.error : null;
  const ok = status === 200 && !error;
  const landing = ok && opts.jump ? landingOf(body) : null;
  if (landing) c.dispatch({ type: "anim/jump", ...landing });
  if (isStateBody(body)) c.dispatch({ type: "state/loaded", body, origin: "action", reqSeq, now: c.now() });
  if (ok) {
    if (opts.toastOn === "message") c.toast(body.message);
    return { ok: true, status, body };
  }
  c.toast(error ?? c.text.serverError, true);
  return { ok: false, status, body };
}

const NOT_SENT = Object.freeze({ ok: false, status: null, body: null });

/** The POST itself: the only failure that says the server can't be reached. Resolves the reply, or null. */
async function postOnce(c, path, body) {
  try {
    return await c.api.post(path, body);
  } catch (err) {
    c.toast(c.text.offline, true);
    c.dispatch({ type: "conn/failed", now: c.now(), error: errorText(err), retryAt: null });
    return null;
  }
}

async function perform(c, path, body, opts) {
  c.q.reqSeq = Math.max(c.q.reqSeq, c.st().req.seq) + 1;
  const reqSeq = c.q.reqSeq;
  c.dispatch({ type: "req/action-start", reqSeq });
  try {
    const reply = await postOnce(c, path, body);
    return reply ? respond(c, reply, reqSeq, opts) : NOT_SENT;
  } finally {
    c.dispatch({ type: "req/action-end", reqSeq });
    c.sync?.kick({ origin: "action" });
  }
}

/** Queue one POST behind the others. opts: toastOn "message" or "errors" (successes stay quiet); jump: true for a
 * request that moves the game (the field snaps to where it landed). */
function send(c, path, body, opts = QUIET) {
  const run = c.q.tail.then(() => perform(c, path, body, opts));
  c.q.tail = run.catch(() => {});
  return run;
}

// ---------------------------------------------------------------- reads (the freshest watch and feed)
const watchOf = (c) => c.st().version?.watch ?? c.st().server?.watch ?? null;
const gameOf = (c) => c.st().version?.watch?.game ?? c.st().server?.watch?.game ?? null;
const feedOn = (c) => Boolean(c.st().version?.feed?.on ?? c.st().server?.feed?.on);
const NOWHERE = Object.freeze({ idx: null, total: null });

/** Where the game is: a watched game's state and its place (ESPN plays applied of the total), or the live feed. */
function position(c) {
  const w = watchOf(c);
  const session = SESSION.includes(w?.state);
  return { state: session ? w.state : null, live: !session && feedOn(c), ...(session ? placeOf(w) : NOWHERE),
    final: gameOf(c)?.status !== "in" };
}

/** An error session (the app restarted mid-watch, a rebuild that failed) is never taken to be at either end: Reset,
 * Go Live and the steps rebuild from it, and the server answers where it really is (a 409 at an end). */
const settled = (p) => p.state !== null && p.state !== "error";
const atKickoff = (p) => settled(p) && p.idx === 0;
const atEnd = (p) => settled(p) && p.idx !== null && p.total !== null && p.idx >= p.total;
/** Go Live has nothing to do: the feed is already followed, or a finished game already shows its final state. */
const isLive = (p) => p.live || (atEnd(p) && p.final);

// ---------------------------------------------------------------- the playback lane
/** Run `job` now, or (one already in flight) make it the next one, dropping any press that was waiting. */
function enter(c, kind, run, target = null) {
  const job = { kind, run, target };
  c.dispatch({ type: "playback/start", kind, target });
  if (c.lane.running) {
    c.lane.next = job;
    return c.lane.running;
  }
  c.lane.running = drain(c, job);
  return c.lane.running;
}

async function drain(c, first) {
  try {
    for (let job = first; job; job = c.lane.next) {
      c.lane.next = null;
      c.dispatch({ type: "playback/start", kind: job.kind, target: job.target });
      await job.run();
    }
  } finally {
    c.lane.next = null;
    c.lane.running = null;
    c.dispatch({ type: "playback/end" });
  }
}

/** A jump's request, sent when its turn in the lane comes, if `allowed` still holds then. */
const jumpRun = (c, path, body, allowed) => () => (allowed(position(c)) ? send(c, path, body, JUMP) : null);

/** A seek to where a paused or done game already is changes nothing (watch.seek's own no-op); from playing it still
 * holds the game there, and from an error it rebuilds it. */
function seek(c, idx) {
  const fits = (p) => Number.isInteger(idx) && idx >= 0 && (p.total === null || idx <= p.total)
    && !(idx === p.idx && HELD.includes(p.state));
  if (!fits(position(c))) return Promise.resolve();
  return enter(c, "seek", jumpRun(c, ROUTES.seek, { idx }, fits), idx);
}

/**
 * The picker's selection as POST /api/game/select takes it (game-picker.md 4): exactly {event_id, sides}, the sides
 * one or two different team abbreviations (away then home when both); null for anything else, which is never sent.
 * @param {unknown} selection
 * @returns {{ event_id: string, sides: string[] } | null}
 */
export function selectionBody(selection) {
  if (!isPlainObject(selection)) return null;
  const keys = Object.keys(selection);
  const { event_id: eventId, sides } = selection;
  if (keys.length !== SELECTION_KEYS.length || !SELECTION_KEYS.every((k) => keys.includes(k))) return null;
  if (typeof eventId !== "string" || !EVENT_ID_RE.test(eventId) || !Array.isArray(sides)) return null;
  const valid = sides.length >= 1 && sides.length <= MAX_SIDES && new Set(sides).size === sides.length
    && sides.every((side) => typeof side === "string" && SIDE_RE.test(side));
  return valid ? { event_id: eventId, sides: [...sides] } : null;
}

/** Open the game the picker chose: a jump like opening the page, so the field snaps to where the new track is. */
function selectGame(c, selection) {
  const body = selectionBody(selection);
  return body ? enter(c, "select", () => send(c, ROUTES.select, body, JUMP)) : Promise.resolve();
}

function togglePlay(c) {
  return enter(c, "toggle", () => {
    const { state } = position(c);
    if (state === "playing") return send(c, ROUTES.pause, {}, QUIET);
    return state === "paused" ? send(c, ROUTES.resume, {}, QUIET) : null;
  });
}

function playbackActions(c) {
  return {
    open: () => enter(c, "open", jumpRun(c, ROUTES.open, {}, () => true)),
    togglePlay: () => togglePlay(c),
    stepBack: () => enter(c, "back", jumpRun(c, ROUTES.back, {}, (p) => !atKickoff(p))),
    stepForward: () => enter(c, "forward", jumpRun(c, ROUTES.forward, {}, (p) => !p.live && !atEnd(p))),
    seek: (idx) => seek(c, idx),
    reset: () => seek(c, 0),
    // the drive chart's drive keys (ui/drive-chart.js): a timeline row's seq counts the ESPN plays applied up to it,
    // which is the watch's idx, so the game jumps to just after that play
    reviewAt: (seq) => seek(c, seq),
    goLive: () => enter(c, "golive", jumpRun(c, ROUTES.golive, {}, (p) => !isLive(p))),
    selectGame: (selection) => selectGame(c, selection),
    async setSpeed(speed) {
      if (!WATCH_SPEEDS.includes(speed)) return;
      c.dispatch({ type: "prefs/set", key: "watchSpeed", value: speed });
      await send(c, ROUTES.speed, { speed }, QUIET);
    },
  };
}

// ---------------------------------------------------------------- view
function setCamera(c, id) {
  if (typeof id !== "string" || id === "") return;
  c.dispatch({ type: "camera/set", id });
  c.persist("sc:camera", id);
}

/** V: the next of the engine's camera modes (Wide and Blimp, restructure-v2.md 4). */
function cycleCamera(c) {
  const ids = (c.cameraModes() ?? []).map((m) => m?.id).filter((id) => typeof id === "string" && id !== "");
  if (ids.length === 0) return;
  const current = c.st().view.camera ?? c.defaultCamera() ?? ids[0];
  setCamera(c, ids[(ids.indexOf(current) + 1) % ids.length]);
}

function setAmbient(c, value) {
  if (!AMBIENTS.includes(value)) return;
  c.dispatch({ type: "prefs/set", key: "ambient", value });
  c.persist("sc:ambient", value);
}

function viewActions(c) {
  return {
    cycleCamera: () => cycleCamera(c),
    setCamera: (id) => setCamera(c, id),
    toggleSettings: () => c.dispatch({ type: "settings/toggle" }),
    closeSettings: () => c.dispatch({ type: "settings/close" }),
    setAmbient: (value) => setAmbient(c, value),
    hoverLeaf: (leaf) => c.dispatch({ type: "hover/leaf", leaf: leaf ?? null }),
    retryNow: () => c.sync?.kick(),
    holdToast: (id) => c.toast.hold(id),
    releaseToast: (id) => c.toast.release(id),
    dismissToast: (id) => c.toast.dismiss(id),
  };
}

/**
 * @param {{ store: object, api: object, sync: { kick: Function } | null, now: () => number,
 *   timers?: { setTimeout: Function, clearTimeout?: Function }, copy?: typeof ACTION_COPY,
 *   cameraModes?: () => { id: string }[], defaultCamera?: () => string | null,
 *   persist?: (key: string, value: string) => void }} deps   now: epoch milliseconds (Date.now)
 */
export function createActions({ store, api, sync, now, timers = globalThis, copy = ACTION_COPY,
  cameraModes = () => [], defaultCamera = () => null, persist = () => {} }) {
  const setT = timers?.setTimeout;
  const clearT = typeof timers?.clearTimeout === "function" ? timers.clearTimeout : () => {};
  if (typeof now !== "function" || typeof setT !== "function") {
    throw new TypeError("createActions needs now() and setTimeout");
  }
  const dispatch = (event) => store.dispatch(event);
  const c = {
    st: () => store.getState(), dispatch, api, sync, now: () => now(), text: { ...ACTION_COPY, ...copy },
    toast: makeToaster(dispatch, (fn, ms) => setT(fn, ms), (id) => clearT(id)),
    cameraModes: () => cameraModes(), defaultCamera: () => defaultCamera(),
    persist: (key, value) => persist(key, value),   // injected functions are called bare, like the clock
    q: { tail: Promise.resolve(), reqSeq: 0 },      // the POST queue's own bookkeeping
    lane: { running: null, next: null },            // the playback lane: the request in flight, the press waiting
  };
  return { ...playbackActions(c), ...viewActions(c) };
}
