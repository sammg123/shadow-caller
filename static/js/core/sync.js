// Boot fetches and the poll loop (ui-architecture.md 3.1 step 5, 3.2, 3.9; DC E4; G11; owner A1).
// DOM side only through the injected `doc` (hidden, visibilitychange); time and timers are injected so node tests
// drive every tick. Ticks never overlap and each resource has at most one GET in flight.
// Only a request that fails is a connection failure. A bug while applying an answer (a throwing listener) goes to
// `onError`, and the loop always schedules its next tick. Timers and the clock are called bare: browsers throw
// "Illegal invocation" when setTimeout or performance.now run as a method of another object.
// The functions below share one context `c`; `c.rt` holds the loop's own runtime bookkeeping.
import { ApiError } from "./api.js";
import { isStateBody, reportLater, reporterOf } from "./domain.js";
import { nextDelay, planTick, retryDelay } from "./sync-plan.js";
import { checkTimelineBody } from "./timeline-cache.js";

const NOT_FOUND = 404;

const errorText = (err) => (err && typeof err.message === "string" ? err.message : String(err));
const isHidden = (c) => Boolean(c.doc && c.doc.hidden);

function later(c, fn, ms) {
  cancelWait(c);
  c.rt.timer = c.setTimer(() => { c.rt.timer = null; fn(); }, ms);
}

function cancelWait(c) {
  if (c.rt.timer !== null) c.clearTimer(c.rt.timer);
  c.rt.timer = null;
}

// ---------------------------------------------------------------- validated fetches
async function fetchTimeline(c, since, epoch) {
  const body = await c.api.getTimeline(since, epoch);
  const problem = checkTimelineBody(body);
  if (problem) throw new ApiError("bad-json", { status: 200, path: "/api/timeline", detail: problem });
  return body;
}

async function fetchState(c) {
  const body = await c.api.getState();
  if (!isStateBody(body)) throw new ApiError("bad-json", { status: 200, path: "/api/state", detail: "not a state body" });
  return body;
}

function applyTimeline(c, resp, origin) {
  const reducedMotion = c.store.getState().prefs.motion === "reduced";
  c.dispatch({ type: "timeline/loaded", resp, origin, hidden: isHidden(c), reducedMotion, now: c.now() });
}

// ---------------------------------------------------------------- boot (3.1 step 5, #119, #120)
async function timelineAtBoot(c) {
  try {
    return await fetchTimeline(c, 0, null);
  } catch (err) {
    if (err instanceof ApiError && (err.status === NOT_FOUND || err.kind === "bad-json")) return null;   // old server
    throw err;
  }
}

/** The three boot bodies, fetched in parallel; null when a request failed (then the boot screen retries, #120). */
async function fetchBoot(c) {
  try {
    return await Promise.all([fetchState(c), timelineAtBoot(c), c.api.getVersion()]);
  } catch (err) {
    const t = c.now();
    const retryAt = t + retryDelay(c.store.getState().boot.attempts);
    c.dispatch({ type: "boot/failed", now: t, error: errorText(err), retryAt });
    return null;
  }
}

function applyBoot(c, [body, timeline, version]) {
  const reqSeq = c.store.getState().req.seq;
  c.dispatch({ type: "version/loaded", body: version, now: c.now() });
  if (timeline) applyTimeline(c, timeline, "poll");
  c.dispatch({ type: "state/loaded", body, origin: "poll", reqSeq, now: c.now() });
  c.dispatch({ type: "conn/ok", now: c.now() });
}

/** One boot attempt: true once the bodies are in (or the loop stopped meanwhile), false to retry. */
async function bootOnce(c) {
  c.dispatch({ type: "boot/attempt", now: c.now() });
  const bodies = await fetchBoot(c);
  if (!bodies) return false;
  if (!c.rt.stopped) applyBoot(c, bodies);
  return true;
}

/** Applying the boot bodies threw: a bug, not the network. Report it; the poll loop refetches whatever is missing. */
async function bootOrReport(c) {
  try {
    return await bootOnce(c);
  } catch (err) {
    c.onError(err);
    return true;
  }
}

async function bootLoop(c) {
  c.rt.booting = true;
  const ok = await bootOrReport(c);
  c.rt.booting = false;
  if (c.rt.stopped) return;
  if (!ok) {
    later(c, () => bootLoop(c), retryDelay(c.store.getState().boot.attempts));
    return;
  }
  c.rt.booted = true;
  c.rt.resolveStarted();
  schedule(c);
}

// ---------------------------------------------------------------- one tick (3.2)
function localOf(s) {
  return { epoch: s.timeline.epoch, n: s.timeline.n, version: s.server?.version, feedOn: s.server?.feed?.on,
    feedState: s.server?.feed?.state, needsFull: s.timeline.needsFull };
}

async function healGap(c, origin) {
  if (!c.store.getState().timeline.needsFull) return null;
  try {
    applyTimeline(c, await fetchTimeline(c, 0, null), origin);
    return null;
  } catch (err) {
    return err;
  }
}

/** Version, then the planned timeline and state fetches in parallel; timeline applied first. Returns a failure or null. */
async function tick(c, origin) {
  let version;
  try {
    version = await c.api.getVersion();
  } catch (err) {
    return err;
  }
  c.dispatch({ type: "version/loaded", body: version, now: c.now() });
  c.dispatch({ type: "conn/ok", now: c.now() });
  const s = c.store.getState();
  const plan = planTick(localOf(s), version);
  const reqSeq = s.req.seq;   // a state body older than an action applied meanwhile is dropped by the reducer
  const wantState = plan.state && s.req.inflightActions === 0;
  const [tl, st] = await Promise.allSettled([
    plan.timeline ? fetchTimeline(c, plan.timeline.since, plan.timeline.epoch) : null, wantState ? fetchState(c) : null]);
  if (tl.status === "fulfilled" && tl.value) applyTimeline(c, tl.value, origin);
  const failure = (await healGap(c, origin)) ?? (tl.status === "rejected" ? tl.reason : null);
  if (st.status === "fulfilled" && st.value) {
    c.dispatch({ type: "state/loaded", body: st.value, origin: "poll", reqSeq, now: c.now() });
  }
  return st.status === "rejected" ? st.reason : failure;
}

function fail(c, err) {
  const t = c.now();
  const s = c.store.getState();
  const retryAt = t + nextDelay({ watchState: s.version?.watch?.state, hidden: isHidden(c), failures: s.conn.failures + 1 });
  c.dispatch({ type: "conn/failed", now: t, error: errorText(err), retryAt });
}

function schedule(c) {
  if (c.rt.stopped) return;
  const s = c.store.getState();
  later(c, () => run(c), nextDelay({ watchState: s.version?.watch?.state, hidden: isHidden(c), failures: s.conn.failures }));
}

/** One tick, then the next. Failed requests come back from tick() as values; anything thrown is a bug. */
async function run(c) {
  if (c.rt.running || c.rt.stopped) return;
  c.rt.running = true;
  cancelWait(c);
  const origin = c.rt.pendingOrigin;
  c.rt.pendingOrigin = "poll";
  try {
    const failure = await tick(c, origin);
    if (failure && !c.rt.stopped) fail(c, failure);
    if (!c.rt.stopped) c.dispatch({ type: "tick", now: c.now() });
  } catch (err) {
    c.onError(err);
  } finally {
    c.rt.running = false;
    continueLoop(c);
  }
}

function continueLoop(c) {
  if (c.rt.stopped) return;
  if (!c.rt.again) {
    schedule(c);
    return;
  }
  c.rt.again = false;
  run(c);
}

/** Run a tick now (after every action, on becoming visible, from Retry now). origin "action" tags its rows. */
function kick(c, { origin = "poll" } = {}) {
  if (c.rt.stopped) return;
  if (origin === "action") c.rt.pendingOrigin = "action";
  if (!c.rt.booted) {
    if (c.rt.booting) return;
    cancelWait(c);
    bootLoop(c);
    return;
  }
  if (c.rt.running) c.rt.again = true;
  else run(c);
}

/**
 * @param {{ api: object, store: object, now: () => number,
 *           timers?: { setTimeout: Function, clearTimeout: Function }, doc?: { hidden: boolean, addEventListener: Function,
 *           removeEventListener: Function } | null, onError?: (err: unknown) => void }} deps
 *   now: epoch milliseconds (Date.now): DC E4 compares it with watch.next_at, which the server stamps in epoch ms.
 *   onError: where bugs go (a throwing listener while an answer is applied); failed requests never go there.
 */
export function createSync({ api, store, now, timers = globalThis, doc = null, onError = reportLater }) {
  const { setTimeout: setT, clearTimeout: clearT } = timers ?? {};
  if (typeof now !== "function" || typeof setT !== "function" || typeof clearT !== "function") {
    throw new TypeError("createSync needs now(), setTimeout and clearTimeout");
  }
  const c = {
    api, store, doc, onError: reporterOf(onError), dispatch: (event) => store.dispatch(event),
    now: () => now(), setTimer: (fn, ms) => setT(fn, ms), clearTimer: (id) => clearT(id),
    rt: { timer: null, started: null, resolveStarted: () => {}, booted: false, booting: false, running: false, again: false,
      stopped: false, pendingOrigin: "poll" },
  };
  const onVisibility = () => { if (!isHidden(c)) kick(c); };
  return {
    start() {
      if (c.rt.started) return c.rt.started;
      c.rt.started = new Promise((resolve) => { c.rt.resolveStarted = resolve; });
      doc?.addEventListener("visibilitychange", onVisibility);
      bootLoop(c);
      return c.rt.started;
    },
    kick: (opts) => kick(c, opts),
    stop() {
      c.rt.stopped = true;
      cancelWait(c);
      doc?.removeEventListener("visibilitychange", onVisibility);
      c.rt.resolveStarted();
    },
  };
}
