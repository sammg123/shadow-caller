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
import { fieldVm } from "../model/vm-field.js";
import { nextJob } from "./anim-queue.js";
import { keyContext, modeOf } from "./keymap.js";
import { presentedView } from "./present.js";
import { connState } from "./sync-plan.js";
import { rowBySeq } from "./timeline-cache.js";

/** The #app attributes the conductor owns (2.7). <html> attributes belong to theme/apply.js. */
export const APP_ATTRS = Object.freeze(["data-mode", "data-phase", "data-poss", "data-booth-open", "data-scorecard-open",
  "data-conn", "data-boot", "data-watch-state", "data-source"]);
const DEFAULT_VERDICT_MS = 1500;
/** Past its planned length plus this, a play is hurried (finishNow); after twice this it is counted as drawn. */
const WATCHDOG_GRACE_MS = 1500;
const NO_SCENE = JSON.stringify({ situation: null, ghostInput: null });

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
  if (timeline.field && timeline.teams) call(c, "setGameFrame", timeline.field, timeline.teams, timeline.teamOrder);
  call(c, "drawRowsInstant", timeline.rows.filter((r) => r.seq <= throughSeq));
  if (state.view.camera) call(c, "setCamera", state.view.camera, { instant: true });
  c.rt.sceneKey = null;
}

function rebuild(c, state) {
  c.rt.rebuiltToken = state.anim.token;
  call(c, "finishNow");
  drawFrame(c, state, state.anim.drawnThrough);
  c.dispatch({ type: "anim/rebuilt", token: state.anim.token, now: c.now() });
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

function markVerdict(c, row) {
  call(c, "markVerdict", { seq: row.seq, key: verdictOf(row.pred).key });
  c.rt.verdictUntil = c.now() + c.verdictMs;
  if (c.rt.verdictTimer !== null) c.clearT(c.rt.verdictTimer);
  c.rt.verdictTimer = c.setT(() => { c.rt.verdictTimer = null; writeApp(c, c.store.getState()); }, c.verdictMs);
}

function landed(c, job, row) {
  c.dispatch({ type: "anim/done", seq: job.seq, token: job.token, now: c.now() });
  if (job.instant || !row.offense_is_caller || !row.pred || c.store.getState().anim.token !== job.token) return;
  markVerdict(c, row);
  writeApp(c, c.store.getState());
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
function showLive(c, state) {
  const fv = fieldVm(presentedView(state, c.now()));
  c.rt.scene = { situation: fv.situation, ghostInput: fv.ghostInput };
  const key = JSON.stringify(c.rt.scene);
  if (key === c.rt.sceneKey) return;
  c.rt.sceneKey = key;
  const { situation, ghostInput } = c.rt.scene;
  call(c, "showSituation", situation);
  call(c, "showGhosts", ghostInput && situation ? buildGhostSet(ghostInput, situation) : null);
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
  return state === prev || c.rt.sceneKey === null || state.presented !== prev.presented
    || state.timeline !== prev.timeline || state.anim.drawnThrough !== prev.anim.drawnThrough
    || state.view.review !== prev.view.review;
}

// ---------------------------------------------------------------- engine lifecycle (6.2)
function attach(c, next) {
  for (const off of c.rt.detachEngine) off();
  c.rt.engine = next;
  const on = typeof next?.on === "function" ? (ev, fn) => next.on(ev, fn) : () => () => {};
  c.rt.detachEngine = [on("error", (err) => engineFailed(c, err)),
    on("contextlost", () => engineFailed(c, new Error("WebGL context lost")))];
}

function engineFailed(c, err) {
  report(c, err);
  if (!c.createFallback || c.rt.failedOver) return;
  c.rt.failedOver = true;
  let fallback;
  try {
    fallback = c.createFallback(err);
  } catch (fallbackErr) {
    report(c, fallbackErr);
    return;
  }
  swapEngine(c, fallback);
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
  if (c.rt.verdictTimer !== null) c.clearT(c.rt.verdictTimer);
  c.rt.verdictTimer = null;
}

const browserSetTimeout = (fn, ms) => globalThis.setTimeout(fn, ms);
const browserClearTimeout = (id) => globalThis.clearTimeout(id);

/**
 * @param {{ store: object, getEngine: () => object, look?: object, now: () => number, setTimeout?: Function,
 *   clearTimeout?: Function, app?: { setAttribute: Function } | null, createFallback?: ((err: unknown) => object) | null,
 *   onError?: (err: unknown) => void }} deps   now: epoch milliseconds (Date.now), the clock DC E4 needs
 */
export function createConductor({ store, getEngine, look = {}, now, setTimeout: setT = browserSetTimeout,
  clearTimeout: clearT = browserClearTimeout, app = null, createFallback = null, onError = defaultOnError }) {
  if (typeof now !== "function" || typeof setT !== "function" || typeof clearT !== "function") {
    throw new TypeError("createConductor needs now(), setTimeout and clearTimeout");
  }
  const c = {
    store, dispatch: (event) => store.dispatch(event), look, app,
    createFallback: typeof createFallback === "function" ? (err) => createFallback(err) : null,
    onError: (err) => onError(err), now: () => now(), setT: (fn, ms) => setT(fn, ms), clearT: (id) => clearT(id),
    verdictMs: Number.isFinite(look?.motion?.verdictMs) ? look.motion.verdictMs : DEFAULT_VERDICT_MS,
    normalCache: new WeakMap(),
    rt: { engine: null, unsubscribe: null, detachEngine: [], sceneKey: NO_SCENE,
      scene: { situation: null, ghostInput: null }, rebuiltToken: -1, hurried: "", verdictUntil: 0, verdictTimer: null,
      failedOver: false, lastError: null, written: {} },
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
