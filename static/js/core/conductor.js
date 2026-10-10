// Store <-> engine bridge (ui-architecture.md 3.4, 3.5, 6.2; owner A1). DOM side: it writes the #app attribute
// hooks; everything else goes through the Engine interface (2.5). On each store change it compares slices by
// identity and: rebuilds after an epoch change, plays the queue one row at a time (token-checked), hurries the
// engine when the lag valve fires, shows the presented situation and ghosts, replays reviewed rows, relabels rows
// whose pred a retag changed, marks verdicts, and swaps in the 2D fallback when the engine fails. The clock and the
// timers are called bare: browsers throw "Illegal invocation" when setTimeout runs as a method of another object.
// The functions below share one context `c`; `c.rt` holds the conductor's own runtime bookkeeping.
import { buildGhostSet, ghostInputFromPred } from "../field/ghosts.js";
import { buildDrawing, situationFromRow } from "../field/paths.js";
import { normalDurationMs } from "../field/timing.js";
import { verdictOf } from "../model/verdict.js";
import { fieldVm, verdictChipText } from "../model/vm-field.js";
import { nextJob } from "./anim-queue.js";
import { keyContext, modeOf } from "./keymap.js";
import { presentedView } from "./present.js";
import { connState } from "./sync-plan.js";
import { rowBySeq } from "./timeline-cache.js";

/** The #app attributes the conductor owns (2.7). <html> attributes belong to theme/apply.js. */
export const APP_ATTRS = Object.freeze(["data-mode", "data-phase", "data-poss", "data-booth-open", "data-scorecard-open",
  "data-conn", "data-boot", "data-watch-state", "data-source"]);
const DEFAULT_VERDICT_MS = 1500;
/** G2-3: Watch this game at 4x and up holds the verdict's beat to 600 ms (the next play's reserve assumes <= 800). */
const FAST_WATCH_SPEED = 4;
const FAST_WATCH_VERDICT_MS = 600;
/** Past its planned length plus this, a play is hurried (finishNow); after twice this it is counted as drawn. */
const WATCHDOG_GRACE_MS = 1500;
/** What the engine was last shown (showLive): nothing, before the first state. */
const NOTHING_SHOWN = Object.freeze({ sit: JSON.stringify(null),
  ghosts: JSON.stringify({ situation: null, ghostInput: null, beat: false }) });

/** #app attribute values for a state (pure). */
export function appAttrs(state, { phase, poss }) {
  const ctx = keyContext(state);
  return {
    "data-mode": modeOf(ctx), "data-phase": phase, "data-poss": poss ?? "",
    "data-booth-open": String(Boolean(state.view.booth.open)),
    "data-scorecard-open": String(Boolean(state.view.scorecardOpen)),
    "data-conn": connState(state.conn), "data-boot": state.boot.phase, "data-watch-state": ctx.watchState,
    "data-source": state.timeline.source ?? state.presented?.timeline?.source ?? state.server?.timeline?.source ?? "",
  };
}

function defaultOnError(err) {
  if (typeof globalThis.reportError === "function") globalThis.reportError(err);
}

function report(c, err) {
  c.rt.lastError = err;
  c.onError(err);
}

/** Call an engine method; a throw is an engine failure, never a store failure. */
function call(c, name, ...args) {
  const target = c.rt.engine;
  const fn = target?.[name];
  if (typeof fn !== "function") return undefined;
  try {
    return fn.apply(target, args);
  } catch (err) {
    engineFailed(c, err);
    return undefined;
  }
}

function normalMs(c, state, seq) {
  const row = rowBySeq(state.timeline, seq);
  if (!row) return 0;
  if (!c.normalCache.has(row)) {
    try {
      c.normalCache.set(row, normalDurationMs(buildDrawing(row), c.look?.motion));
    } catch (err) {
      report(c, err);
      c.normalCache.set(row, 0);
    }
  }
  return c.normalCache.get(row);
}

// ---------------------------------------------------------------- rebuild and play (3.4, 3.7)
function drawFrame(c, state, throughSeq) {
  const { timeline } = state;
  // v1.4 (W1): the timeline's `game` (kickoff, light) as the 4th argument when the server sent one (day games, 14.6)
  const game = timeline.game ? [timeline.game] : [];
  if (timeline.field && timeline.teams) call(c, "setGameFrame", timeline.field, timeline.teams, timeline.teamOrder, ...game);
  call(c, "drawRowsInstant", timeline.rows.filter((r) => r.seq <= throughSeq));
  if (state.view.camera) call(c, "setCamera", state.view.camera, { instant: true });
  c.rt.shown = null;
}

function rebuild(c, state) {
  c.rt.rebuiltToken = state.anim.token;
  call(c, "finishNow");
  drawFrame(c, state, state.anim.drawnThrough);
  c.dispatch({ type: "anim/rebuilt", token: state.anim.token, now: c.now() });
  if (c.rt.failedOver) void restoreWebgl(c);       // G2-9: a new epoch tries WebGL again; 2D never latches
}

function armWatchdog(c, job) {
  const stillPlaying = () => {
    const { anim } = c.store.getState();
    return anim.token === job.token && anim.playing?.seq === job.seq;
  };
  const forceDone = () => {
    if (stillPlaying()) c.dispatch({ type: "anim/done", seq: job.seq, token: job.token, now: c.now() });
  };
  c.setT(() => {
    if (!stillPlaying()) return;
    call(c, "finishNow");
    c.setT(forceDone, WATCHDOG_GRACE_MS);
  }, job.durationMs + WATCHDOG_GRACE_MS);
}

/** The verdict's beat (G2-3): the look's verdictMs, held to 600 ms while Watch this game plays at 4x or faster. */
function beatMs(c, state) {
  const watch = state.version?.watch;
  const fast = watch?.state === "playing" && Number(watch.speed) >= FAST_WATCH_SPEED;
  return fast ? Math.min(c.verdictMs, FAST_WATCH_VERDICT_MS) : c.verdictMs;
}

/** The beat is over: the next call's shadows go up (unless a review holds the field), and the phase moves on. */
function endBeat(c) {
  c.rt.verdictTimer = null;
  const state = c.store.getState();
  if (state.view.review.seq === null) showLive(c, state);
  writeApp(c, state);
}

/**
 * The caller's play is graded: its verdict, with what was graded (G2-7: "In his top 3 · #2 Intermediate · 39%", in
 * the timeline's own leaf names), gets the field to itself for a beat before the next call's shadows (G2-3).
 */
function markVerdict(c, row) {
  const state = c.store.getState();
  const ms = beatMs(c, state);
  const text = verdictChipText(row.pred, state.timeline.meta?.leaf_names ?? null);
  call(c, "markVerdict", { seq: row.seq, key: verdictOf(row.pred).key, ...(text ? { text } : {}) });
  c.rt.verdictUntil = c.now() + ms;
  if (c.rt.verdictTimer !== null) c.clearT(c.rt.verdictTimer);
  c.rt.verdictTimer = c.setT(() => endBeat(c), ms);
}

function landed(c, job, row) {
  // The beat starts before anim/done presents the next state, so the next call's shadows wait for the verdict.
  const graded = !job.instant && row.offense_is_caller && row.pred && c.store.getState().anim.token === job.token;
  if (graded) markVerdict(c, row);
  c.dispatch({ type: "anim/done", seq: job.seq, token: job.token, now: c.now() });
  if (graded) writeApp(c, c.store.getState());
}

function play(c, state) {
  const watch = state.version?.watch ?? null;
  const job = nextJob(state.anim, { now: c.now(), watch, normalMs: (seq) => normalMs(c, state, seq) });
  if (!job) return;
  const row = rowBySeq(state.timeline, job.seq);
  c.dispatch({ type: "anim/started", seq: job.seq, token: job.token, durationMs: job.durationMs, now: c.now() });
  if (!row) {
    c.dispatch({ type: "anim/done", seq: job.seq, token: job.token, now: c.now() });
    return;
  }
  const done = () => landed(c, job, row);
  Promise.resolve(call(c, "playRow", row, { durationMs: job.durationMs, token: job.token })).then(done, done);
  armWatchdog(c, job);
}

function hurry(c, state) {
  const { playing, token } = state.anim;
  const key = playing?.hurry ? `${token}:${playing.seq}` : "";
  if (key && key !== c.rt.hurried) call(c, "finishNow");
  c.rt.hurried = key;
}

// ---------------------------------------------------------------- situation, ghosts, review (3.5)
/**
 * The presented situation and the next call's shadows, each sent once per change. During the verdict's beat (G2-3)
 * the field holds no shadows: the graded play and its chip have it to themselves, then endBeat brings the call up.
 */
function showLive(c, state) {
  const fv = fieldVm(presentedView(state, c.now()));
  const { situation, ghostInput } = fv;
  const beat = c.now() < c.rt.verdictUntil;
  c.rt.scene = { situation, ghostInput };
  const shown = c.rt.shown ?? { sit: null, ghosts: null };
  const sit = JSON.stringify(situation);
  const ghosts = JSON.stringify({ situation, ghostInput, beat });
  c.rt.shown = { sit, ghosts };
  if (sit !== shown.sit) call(c, "showSituation", situation);
  if (ghosts !== shown.ghosts) {
    call(c, "showGhosts", ghostInput && situation && !beat ? buildGhostSet(ghostInput, situation) : null);
  }
}

function showReviewed(c, state) {
  const row = rowBySeq(state.timeline, state.view.review.seq);
  if (!row) return;
  const sit = situationFromRow(row);
  const meta = state.timeline.meta;
  const input = row.pred ? ghostInputFromPred(row.pred, meta?.leaves, meta?.families) : null;
  call(c, "showReview", row, input && sit ? buildGhostSet(input, sit) : null);
}

function relabel(c, state, prev) {
  const { timeline, anim } = state;
  const sameEpoch = anim.token === prev.anim.token && timeline.epoch === prev.timeline.epoch;
  if (timeline.rows === prev.timeline.rows || !sameEpoch) return;
  const before = prev.timeline.rows;
  const changed = timeline.rows.filter((r, i) => r.seq <= anim.drawnThrough && before[i] && before[i].seq === r.seq
    && before[i] !== r);
  if (changed.length) call(c, "refreshLabels", changed);
}

function viewChanges(c, state, prev) {
  const { view } = state;
  if (view.review !== prev.view.review) {
    if (view.review.seq === null) call(c, "showReview", null, null);
    else showReviewed(c, state);
  }
  if (view.hoverLeaf !== prev.view.hoverLeaf) call(c, "highlightGhost", view.hoverLeaf);
  if (view.camera !== prev.view.camera && view.camera) call(c, "setCamera", view.camera);
}

// ---------------------------------------------------------------- #app hooks
function phaseOf(c, state) {
  const { playing } = state.anim;
  if (playing) return rowBySeq(state.timeline, playing.seq)?.offense_is_caller ? "snap" : "other";
  if (c.now() < c.rt.verdictUntil) return "verdict";
  const { situation, ghostInput } = c.rt.scene;
  if (!situation) return "idle";
  return ghostInput && state.presented?.drive_active ? "presnap" : "other";
}

function writeApp(c, state) {
  if (!c.app) return;
  const attrs = appAttrs(state, { phase: phaseOf(c, state), poss: c.rt.scene.situation?.poss ?? "" });
  for (const [name, value] of Object.entries(attrs)) {
    if (c.rt.written[name] === value) continue;
    c.rt.written[name] = value;
    c.app.setAttribute(name, value);
  }
}

function update(c, state, prev) {
  if (state.anim.rebuilding && state.anim.token !== c.rt.rebuiltToken) {
    rebuild(c, state);
    return;
  }
  hurry(c, state);
  play(c, state);
  relabel(c, state, prev);
  viewChanges(c, state, prev);
  if (state.view.review.seq === null && liveInputsChanged(c, state, prev)) showLive(c, state);
  writeApp(c, state);
}

/** The live scene depends only on these; ticks and connection events leave it alone. */
function liveInputsChanged(c, state, prev) {
  return state === prev || c.rt.shown === null || state.presented !== prev.presented
    || state.timeline !== prev.timeline || state.anim.drawnThrough !== prev.anim.drawnThrough
    || state.view.review !== prev.view.review;
}

// ---------------------------------------------------------------- engine lifecycle (6.1, 6.2; G2-4, G2-9)
const onOf = (engine) => (typeof engine?.on === "function" ? (ev, fn) => engine.on(ev, fn) : () => () => {});

function attach(c, next) {
  for (const off of c.rt.detachEngine) off();
  c.rt.engine = next;
  const on = onOf(next);
  c.rt.detachEngine = [on("error", (err) => engineFailed(c, err)), on("contextlost", () => contextLost(c, next))];
}

/** The 2D field takes over (once per failure: a fallback that can't start is reported once, the store untouched). */
function failOver(c, err, { lost }) {
  if (!c.createFallback || c.rt.failedOver) return;
  c.rt.failedOver = true;
  let fallback;
  try {
    fallback = c.createFallback(err, { lost });
  } catch (fallbackErr) {
    report(c, fallbackErr);
    return;
  }
  swapEngine(c, fallback);
}

/** A runtime error is a bug: reported, then the 2D field holds the game until the next epoch tries WebGL (G2-9). */
function engineFailed(c, err) {
  report(c, err);
  failOver(c, err, { lost: false });
}

/**
 * G2-4: the GPU went away (sleep and wake, an HDMI hot-plug, memory pressure). Not a bug: the 2D field holds the
 * game, and the lost engine is watched for the browser's restore, which brings a fresh WebGL field back (6.1).
 */
function contextLost(c, lost) {
  if (c.rt.engine !== lost) return;
  c.rt.restoreWatch?.();
  const off = onOf(lost)("contextrestored", () => {
    off();
    if (c.rt.restoreWatch === off) c.rt.restoreWatch = null;
    void restoreWebgl(c);
  });
  c.rt.restoreWatch = off;
  failOver(c, new Error("WebGL context lost"), { lost: true });
}

/**
 * A fresh WebGL field in place of the fallback (createWebgl, main.js's loader.start), redrawn from the store. It may
 * come back 2D (WebGL still can't start): that one is swapped in too, and the next epoch tries again.
 */
async function restoreWebgl(c) {
  if (!c.createWebgl || !c.rt.failedOver || c.rt.restoring) return;
  c.rt.restoring = true;
  let next = null;
  try {
    next = await c.createWebgl();
  } catch (err) {
    report(c, err);
  } finally {
    c.rt.restoring = false;
  }
  if (!next || !c.rt.unsubscribe) return;
  c.rt.failedOver = next.kind === "2d";       // before the swap: a failure while it redraws fails over again
  if (!c.rt.failedOver) {
    c.rt.restoreWatch?.();
    c.rt.restoreWatch = null;
  }
  swapEngine(c, next);
}

/** Replace the engine (the fallback, or a restored WebGL one) and redraw it from the store. */
function swapEngine(c, next) {
  attach(c, next);
  const state = c.store.getState();
  const { playing, token, drawnThrough } = state.anim;
  drawFrame(c, state, Math.max(drawnThrough, playing?.seq ?? 0));
  if (playing) c.dispatch({ type: "anim/done", seq: playing.seq, token, now: c.now() });
  const after = c.store.getState();
  if (after.view.review.seq !== null) showReviewed(c, after);
  else showLive(c, after);
  if (after.view.hoverLeaf) call(c, "highlightGhost", after.view.hoverLeaf);
}

function stop(c) {
  c.rt.unsubscribe?.();
  c.rt.unsubscribe = null;
  for (const off of c.rt.detachEngine) off();
  c.rt.detachEngine = [];
  c.rt.restoreWatch?.();
  c.rt.restoreWatch = null;
  if (c.rt.verdictTimer !== null) c.clearT(c.rt.verdictTimer);
  c.rt.verdictTimer = null;
}

const browserSetTimeout = (fn, ms) => globalThis.setTimeout(fn, ms);
const browserClearTimeout = (id) => globalThis.clearTimeout(id);

/**
 * @param {{ store: object, getEngine: () => object, look?: object, now: () => number, setTimeout?: Function,
 *   clearTimeout?: Function, app?: { setAttribute: Function } | null,
 *   createFallback?: ((err: unknown, opts: { lost: boolean }) => object) | null,
 *   createWebgl?: (() => Promise<object | null>) | null, onError?: (err: unknown) => void }} deps
 *   now: epoch milliseconds (Date.now), the clock DC E4 needs. createFallback: the 2D field, now (lost: the WebGL
 *   context went away, not a bug). createWebgl: a fresh WebGL field (or a 2D one when WebGL still can't start).
 */
export function createConductor({ store, getEngine, look = {}, now, setTimeout: setT = browserSetTimeout,
  clearTimeout: clearT = browserClearTimeout, app = null, createFallback = null, createWebgl = null,
  onError = defaultOnError }) {
  if (typeof now !== "function" || typeof setT !== "function" || typeof clearT !== "function") {
    throw new TypeError("createConductor needs now(), setTimeout and clearTimeout");
  }
  const c = {
    store, dispatch: (event) => store.dispatch(event), look, app,
    createFallback: typeof createFallback === "function" ? (err, opts) => createFallback(err, opts) : null,
    createWebgl: typeof createWebgl === "function" ? () => createWebgl() : null,
    onError: (err) => onError(err), now: () => now(), setT: (fn, ms) => setT(fn, ms), clearT: (id) => clearT(id),
    verdictMs: Number.isFinite(look?.motion?.verdictMs) ? look.motion.verdictMs : DEFAULT_VERDICT_MS,
    normalCache: new WeakMap(),
    rt: { engine: null, unsubscribe: null, detachEngine: [], shown: NOTHING_SHOWN,
      scene: { situation: null, ghostInput: null }, rebuiltToken: -1, hurried: "", verdictUntil: 0, verdictTimer: null,
      failedOver: false, restoring: false, restoreWatch: null, lastError: null, written: {} },
  };
  function start() {
    if (c.rt.unsubscribe) return;
    attach(c, getEngine());
    c.rt.unsubscribe = store.subscribe((state, prev) => update(c, state, prev));
    const state = store.getState();
    update(c, state, state);
  }
  return { start, stop: () => stop(c), swapEngine: (next) => swapEngine(c, next), lastError: () => c.rt.lastError };
}
