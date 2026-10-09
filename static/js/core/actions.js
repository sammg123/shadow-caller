// Intents to requests (ui-architecture.md 2.8 and 3.3; FI 2.2; G6, G9, G13, G21; owner A2).
// The only caller of api.post. POSTs go one at a time (FIFO); each response that carries a state is applied with
// origin "action", then a tick is kicked so the rows it made animate (at most 800 ms). Failed requests become red
// toasts and never throw; only a request that got no answer says "Nothing was saved" (#121), so a bug after a
// successful POST surfaces as itself instead. The clock and the timers are called bare (browsers throw "Illegal
// invocation" otherwise). Every action below takes the context `c` that createActions builds.
import { CONFIRMS, TOASTS } from "../model/copy.js";
import { ROUTES } from "./api.js";
import { isPlainObject, isStateBody } from "./domain.js";
import { drawableSeqs, stepReview } from "./review.js";
import { canLog, flagPayload, pickLeaf as findLeaf, playPayload } from "./selection.js";
import { commit, sideSwitch, stripValues } from "./strip.js";

export const TOAST_MS = 2600;
const DRIVE_ENDS = Object.freeze(["punt", "fg", "fg_miss", "half"]);
const WATCH_SPEEDS = Object.freeze([1, 2, 4, 10]);
const WATCH_SESSION = Object.freeze(["playing", "paused"]);
const AMBIENTS = Object.freeze(["room", "dark"]);
const QUIET = Object.freeze({ toastOn: "errors" });

/** Toast and confirm text: model/copy.js (A3) is the source; the two lines it does not carry yet are local. */
export const ACTION_COPY = Object.freeze({
  offline: TOASTS.networkFail,
  serverError: "The app server refused that.",
  noDrive: TOASTS.noDrive,
  undoOff: TOASTS.undoRefused,
  noWatchId: "Enter the ESPN event id to watch.",
  todaysGame: CONFIRMS.todaysGame,
  confirmReset: (feedOn) => (feedOn ? CONFIRMS.resetFeedOn : CONFIRMS.reset),
  confirmReplay: CONFIRMS.replay,
  confirmWatch: CONFIRMS.watchStart,
  confirmStop: CONFIRMS.watchStop,
});

const errorText = (err) => (err && typeof err.message === "string" ? err.message : String(err));
const trimmed = (v) => String(v ?? "").trim();

/** Form access that never throws: a missing or broken component reads as an empty, unticked form. */
function safeForm(getForm) {
  const call = (name, fallback, ...args) => {
    try {
      const fn = getForm()?.[name];
      return typeof fn === "function" ? fn(...args) : fallback;
    } catch {
      return fallback;
    }
  };
  return {
    yards: () => String(call("readYards", "0") ?? "0"), setYards: (v) => call("writeYards", undefined, v),
    td: () => Boolean(call("readTD", false)), setTD: (b) => call("writeTD", undefined, b),
    to: () => Boolean(call("readTO", false)), setTO: (b) => call("writeTO", undefined, b),
    autoFirst: () => Boolean(call("readAutoFirst", false)), setAutoFirst: (b) => call("writeAutoFirst", undefined, b),
    focusYards: () => call("focusYards", undefined),
  };
}

// ---------------------------------------------------------------- toasts, confirms, the POST queue
function makeToaster(dispatch, setTimer) {
  let seq = 0;
  return function toast(message, err = false) {
    if (typeof message !== "string" || message === "") return;
    seq += 1;
    const id = seq;
    dispatch({ type: "toast/show", id, text: message, err });
    setTimer(() => dispatch({ type: "toast/hide", id }), TOAST_MS);
  };
}

function respond(c, { status, body }, reqSeq, toastOn) {
  if (isStateBody(body)) c.dispatch({ type: "state/loaded", body, origin: "action", reqSeq, now: c.now() });
  const error = isPlainObject(body) && typeof body.error === "string" && body.error !== "" ? body.error : null;
  if (status === 200 && !error) {
    if (toastOn === "message") c.toast(body.message);
    return { ok: true, status, body };
  }
  c.toast(error ?? c.text.serverError, true);
  return { ok: false, status, body };
}

const NOT_SENT = Object.freeze({ ok: false, status: null, body: null });

/** The POST itself: the only failure that may say "Nothing was saved" (#121). Resolves the reply, or null. */
async function postOnce(c, path, body) {
  try {
    return await c.api.post(path, body);
  } catch (err) {
    c.toast(c.text.offline, true);
    c.dispatch({ type: "conn/failed", now: c.now(), error: errorText(err), retryAt: null });
    return null;
  }
}

async function perform(c, path, body, toastOn) {
  c.q.reqSeq = Math.max(c.q.reqSeq, c.st().req.seq) + 1;
  const reqSeq = c.q.reqSeq;
  c.dispatch({ type: "req/action-start", reqSeq });
  try {
    const reply = await postOnce(c, path, body);
    return reply ? respond(c, reply, reqSeq, toastOn) : NOT_SENT;
  } finally {
    c.dispatch({ type: "req/action-end", reqSeq });
    c.sync?.kick({ origin: "action" });
  }
}

/** Queue one POST behind the others. toastOn: "message" (default), or "errors" to keep successes quiet. */
function send(c, path, body, { toastOn = "message", entry = false } = {}) {
  if (entry) c.q.entryBusy += 1;
  const run = c.q.tail.then(() => perform(c, path, body, toastOn));
  c.q.tail = run.catch(() => {});
  return run.finally(() => { if (entry) c.q.entryBusy -= 1; });
}

async function confirm(c, question) {
  try {
    return Boolean(await c.dialogs?.confirmAction(question));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- reads
const keys = (c) => c.st().server?.keys ?? null;
const shown = (c) => c.st().presented ?? c.st().server;
const watchState = (c) => c.st().version?.watch?.state ?? c.st().server?.watch?.state ?? "idle";
const feedOn = (c) => Boolean(c.st().version?.feed?.on ?? c.st().server?.feed?.on);
const feedEventId = (c) => c.st().server?.feed?.event_id ?? null;

function offenseName(c) {
  const s = c.st();
  const offense = s.server?.game?.offense ?? "";
  return s.timeline.teams?.[offense]?.location ?? offense;
}

// ---------------------------------------------------------------- manual entry and flags (FI 1.3 to 1.6, G6)
function clearPick(c) {
  c.dispatch({ type: "pick/clear" });
  c.f.setYards("0");
  c.f.setTD(false);
  c.f.setTO(false);
}

function openFlag(c) {
  if (!c.st().server?.drive_active) {
    c.toast(c.text.noDrive(offenseName(c)), true);
    return;
  }
  c.dispatch({ type: "flag/open", autoBooth: Boolean(c.boothHoldsFlags()) });
  c.f.focusYards();
}

async function logPlay(c) {
  const s = c.st();
  if (c.q.entryBusy > 0 || !canLog(s.view.pick, keys(c), s.server?.drive_active)) return;
  const pickAtSend = s.view.pick;
  const body = playPayload(pickAtSend, keys(c), { yards: c.f.yards(), td: c.f.td(), turnover: c.f.to() });
  const res = await send(c, ROUTES.play, body, { entry: true });
  if (!res.ok || c.st().view.pick !== pickAtSend) return;
  clearPick(c);
  c.f.focusYards();
}

async function applyFlag(c, code) {
  const s = c.st();
  if (c.q.entryBusy > 0 || !keys(c)) return;
  const pickAtSend = s.view.pick;
  const genAtSend = s.view.flag.gen;
  const body = flagPayload(code, pickAtSend, keys(c), { yards: c.f.yards(), autoFirst: c.f.autoFirst() });
  const res = await send(c, ROUTES.penalty, body, { entry: true });
  if (!res.ok) return;
  if (c.st().view.flag.gen === genAtSend) c.dispatch({ type: "flag/close" });
  if (c.st().view.pick === pickAtSend) clearPick(c);
  c.f.setAutoFirst(false);
  c.f.focusYards();
}

// ---------------------------------------------------------------- situation strip (FI 2.3, G1 to G3)
async function saveSituation(c, body) {
  const wasActive = Boolean(c.st().server?.drive_active);
  const res = await send(c, ROUTES.situation, body, QUIET);
  if (res.ok && !wasActive && res.body.drive_active) c.toast(res.body.message);
  return res;
}

const chipTeamOf = (c, p) => stripValues(p.sit, p.game, c.st().view.sideAtFifty).side.team;

async function commitStrip(c, fieldId, raw, edited) {
  const p = shown(c);
  if (!p) return { sent: false, ok: false };
  const { body } = commit(fieldId, raw, { edited, chipTeam: chipTeamOf(c, p) });
  if (!body) {
    c.dispatch({ type: "strip/clear", field: fieldId });
    return { sent: false, ok: false };
  }
  const res = await saveSituation(c, body);
  if (res.ok) c.dispatch({ type: "strip/clear", field: fieldId });
  else c.dispatch({ type: "strip/rejected", field: fieldId, text: String(raw ?? "") });
  return { sent: true, ok: res.ok };
}

async function flipSide(c, yardText) {
  const p = shown(c);
  if (!p) return { ok: false };
  const { body, sideAtFifty } = sideSwitch({ chipTeam: chipTeamOf(c, p), yardText, sit: p.sit, game: p.game });
  if (sideAtFifty) c.dispatch({ type: "side/fifty", team: sideAtFifty });
  return { ok: (await saveSituation(c, body)).ok };
}

// ---------------------------------------------------------------- game controls (FI 2.2, G9, G21)
async function runShorthand(c, raw) {
  const t = trimmed(raw);
  if (!t) return { ok: false };
  return { ok: (await send(c, ROUTES.command, { text: t })).ok };
}

async function reset(c) {
  const wasOn = feedOn(c);
  if (!(await confirm(c, c.text.confirmReset(wasOn)))) return;
  if (wasOn && !(await send(c, ROUTES.feed, { on: false, event_id: null }, QUIET)).ok) return;
  await send(c, ROUTES.reset, {});
}

async function retag(c, key, { pauseFirst = false } = {}) {
  if (pauseFirst && !(await send(c, ROUTES.watchPause, {}, QUIET)).ok) return;
  await send(c, ROUTES.retag, { key });
}

async function replay(c, eventId) {
  const id = trimmed(eventId);
  if (!(await confirm(c, c.text.confirmReplay(id || feedEventId(c) || c.text.todaysGame)))) return;
  await send(c, ROUTES.replay, { event_id: id || null });
}

// ---------------------------------------------------------------- Watch this game (3.8) and review
async function watchStart(c, eventId) {
  const id = trimmed(eventId) || feedEventId(c) || c.st().version?.watch?.event_id || "";
  if (!id) {
    c.toast(c.text.noWatchId, true);
    return;
  }
  if (!(await confirm(c, c.text.confirmWatch(id)))) return;
  if (watchState(c) === "done" && !(await send(c, ROUTES.watchStop, { restore: true }, QUIET)).ok) return;
  await send(c, ROUTES.watchStart, { event_id: String(id), speed: c.st().prefs.watchSpeed, from_seq: 0 }, QUIET);
}

async function watchToggle(c) {
  const ws = watchState(c);
  if (ws === "playing") await send(c, ROUTES.watchPause, {}, QUIET);
  else if (ws === "paused") await send(c, ROUTES.watchResume, {}, QUIET);
}

async function watchSpeed(c, speed) {
  if (!WATCH_SPEEDS.includes(speed)) return;
  c.dispatch({ type: "prefs/set", key: "watchSpeed", value: speed });
  if (WATCH_SESSION.includes(watchState(c))) await send(c, ROUTES.watchSpeed, { speed }, QUIET);
}

async function watchStop(c) {
  if (await confirm(c, c.text.confirmStop)) await send(c, ROUTES.watchStop, { restore: true }, QUIET);
}

async function review(c, delta, { repeat = false } = {}) {
  const s = c.st();
  const { reviewSeq, effect } = stepReview({ reviewSeq: s.view.review.seq, rows: s.timeline.rows,
    drawnThrough: s.anim.drawnThrough, watchState: watchState(c) }, delta);
  if (reviewSeq !== s.view.review.seq) c.dispatch({ type: "review/set", seq: reviewSeq });
  if (repeat || !effect) return;
  if (effect === "pause-then-step" && !(await send(c, ROUTES.watchPause, {}, QUIET)).ok) return;
  await send(c, ROUTES.watchStep, {}, QUIET);
}

/** v1.2 (A8): jump the review cursor to one drawn play (play feed, drive chart); null returns to the live edge.
 * A row that is not drawn yet, or draws nothing (admin), changes nothing. Client only: the server is never stepped. */
function reviewAt(c, seq) {
  if (seq === null) {
    c.dispatch({ type: "review/set", seq: null });
    return;
  }
  const s = c.st();
  if (!Number.isInteger(seq) || !drawableSeqs(s.timeline.rows, s.anim.drawnThrough).includes(seq)) return;
  c.dispatch({ type: "review/set", seq });
}

// ---------------------------------------------------------------- view
function setCamera(c, id) {
  if (typeof id !== "string" || id === "") return;
  c.dispatch({ type: "camera/set", id });
  c.persist("sc:camera", id);
}

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

function entryActions(c) {
  return {
    tap(key) { if (keys(c)) { c.dispatch({ type: "pick/tap", key }); c.f.focusYards(); } },
    outcome(out) {
      c.dispatch({ type: "pick/outcome", out });
      if (c.st().view.pick.out === "incomplete") c.f.setYards("0");
      c.f.focusYards();
    },
    pickLeaf(leaf) { if (findLeaf(keys(c), leaf)) { c.dispatch({ type: "pick/leaf", leaf }); c.f.focusYards(); } },
    clearPick: () => clearPick(c),
    toggleTD: () => c.f.setTD(!c.f.td()),
    toggleTO: () => c.f.setTO(!c.f.to()),
    logPlay: () => logPlay(c),
    openFlag: () => openFlag(c),
    closeFlag: () => c.dispatch({ type: "flag/close" }),
    toggleFlag() { if (c.st().view.flag.open) c.dispatch({ type: "flag/close" }); else openFlag(c); },
    applyFlag: (code) => applyFlag(c, code),
  };
}

function controlActions(c) {
  return {
    commitStrip: (fieldId, raw, edited) => commitStrip(c, fieldId, raw, edited),
    flipSide: (yardText) => flipSide(c, yardText),
    async endDrive(kind) { if (DRIVE_ENDS.includes(kind)) await send(c, ROUTES.drive, { end: kind }); },
    runShorthand: (text) => runShorthand(c, text),
    async undo() { await send(c, ROUTES.undo, {}); },
    undoRefused: () => c.toast(c.text.undoOff, true),
    reset: () => reset(c),
    retag: (key, opts) => retag(c, key, opts),
    async feedToggle(eventId) { await send(c, ROUTES.feed, { on: !feedOn(c), event_id: trimmed(eventId) || null }); },
    replay: (eventId) => replay(c, eventId),
  };
}

function watchAndViewActions(c) {
  return {
    watchStart: (eventId) => watchStart(c, eventId),
    watchToggle: () => watchToggle(c),
    async watchStep() { await send(c, ROUTES.watchStep, {}, QUIET); },
    watchSpeed: (speed) => watchSpeed(c, speed),
    watchStop: () => watchStop(c),
    cycleCamera: () => cycleCamera(c),
    setCamera: (id) => setCamera(c, id),
    toggleBooth: () => c.dispatch({ type: "booth/toggle" }),
    toggleScorecard: () => c.dispatch({ type: "scorecard/toggle" }),
    closeScorecard: () => c.dispatch({ type: "scorecard/close" }),
    review: (delta, opts) => review(c, delta, opts),
    reviewAt: (seq) => reviewAt(c, seq),
    exitReview: () => c.dispatch({ type: "review/set", seq: null }),
    hoverLeaf: (leaf) => c.dispatch({ type: "hover/leaf", leaf: leaf ?? null }),
    retryNow: () => c.sync?.kick(),
    setAmbient: (value) => setAmbient(c, value),
  };
}

/**
 * @param {{ store: object, api: object, sync: { kick: Function } | null, form: object | null, dialogs: object,
 *   now: () => number, timers?: { setTimeout: Function }, copy?: typeof ACTION_COPY,
 *   cameraModes?: () => { id: string }[], defaultCamera?: () => string | null, boothHoldsFlags?: () => boolean,
 *   persist?: (key: string, value: string) => void }} deps   now: epoch milliseconds (Date.now)
 */
export function createActions({ store, api, sync, form, dialogs, now, timers = globalThis, copy = ACTION_COPY,
  cameraModes = () => [], defaultCamera = () => null, boothHoldsFlags = () => false, persist = () => {} }) {
  const setT = timers?.setTimeout;
  if (typeof now !== "function" || typeof setT !== "function") {
    throw new TypeError("createActions needs now() and setTimeout");
  }
  const dispatch = (event) => store.dispatch(event);
  const c = {
    st: () => store.getState(), dispatch, api, sync, dialogs, now: () => now(), text: { ...ACTION_COPY, ...copy },
    f: safeForm(() => form), toast: makeToaster(dispatch, (fn, ms) => setT(fn, ms)),
    cameraModes: () => cameraModes(), defaultCamera: () => defaultCamera(), boothHoldsFlags: () => boothHoldsFlags(),
    persist: (key, value) => persist(key, value),   // injected functions are called bare, like the clock
    q: { tail: Promise.resolve(), reqSeq: 0, entryBusy: 0 },   // the POST queue's own bookkeeping
  };
  return { ...entryActions(c), ...controlActions(c), ...watchAndViewActions(c) };
}
