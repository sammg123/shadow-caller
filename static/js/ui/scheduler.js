// Store -> components, one render per animation frame (ui-architecture.md 2.6, 3; owner A0).
// Each binding names its deps (values read from the state, compared by identity element by element) and a select
// that turns the presented view into its view model. A frame runs only the bindings whose deps changed, so a poll
// that only moves the feed clock never rebuilds the play log. A binding that throws is reported with the binding
// and never stops the others; it runs again only when its deps change. Time, frames and errors are injected, and
// called bare (browsers throw "Illegal invocation" when requestAnimationFrame runs as a method of another object).
import { presentedView } from "../core/present.js";

const NO_EXTRAS = Object.freeze({});

function sameDeps(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((v, i) => Object.is(v, b[i]));
}

function defaultOnError(err) {
  queueMicrotask(() => { throw err; });
}

/** Run one binding if its deps changed; returns the pv it built (or was given) so a frame builds it once. */
function runBinding(c, entry, state, env, pv) {
  let deps;
  try {
    deps = entry.binding.deps(state, env);
  } catch (err) {
    c.onError(err, entry.binding);
    return pv;
  }
  if (entry.ran && sameDeps(deps, entry.deps)) return pv;
  entry.ran = true;
  entry.deps = deps;
  const view = pv ?? { ...c.view(state, env.now), ...env.extras };
  try {
    entry.binding.component.update(entry.binding.select(view));
  } catch (err) {
    c.onError(err, entry.binding);
  }
  return view;
}

function flush(c) {
  c.pending = null;
  const state = c.store.getState();
  const env = { now: c.now(), extras: c.extras() ?? NO_EXTRAS };
  let pv = null;
  for (const entry of [...c.entries]) pv = runBinding(c, entry, state, env, pv);
}

function schedule(c) {
  if (c.pending !== null || !c.started || c.stopped) return;
  c.pending = c.raf(() => flush(c));
}

/**
 * @param {{ getState: Function, subscribe: Function }} store
 * @param {{ component: { update(vm): void }, deps: (state, env: { now: number, extras: object }) => unknown[],
 *   select: (pv) => unknown, name?: string }[]} bindings
 * @param {{ raf: (fn) => unknown, now: () => number, cancelRaf?: (id) => void,
 *   onError?: (err: unknown, binding: object) => void, view?: (state, now: number) => object,
 *   extras?: () => object }} opts   view: builds pv (default presentedView); extras are merged into pv (cameraModes)
 * @returns {{ start(): void, flush(): void, invalidate(): void, add(binding): () => void, stop(): void }}
 */
export function createScheduler(store, bindings, { raf, now, cancelRaf = null, onError = defaultOnError,
  view = presentedView, extras = () => NO_EXTRAS } = {}) {
  if (typeof raf !== "function") throw new TypeError("createScheduler needs raf (requestAnimationFrame)");
  if (typeof now !== "function") throw new TypeError("createScheduler needs now()");
  const c = {
    store, raf: (fn) => raf(fn), now: () => now(), onError: (err, b) => onError(err, b),
    view: (state, t) => view(state, t), extras: () => extras(), cancel: cancelRaf ? (id) => cancelRaf(id) : null,
    entries: (bindings ?? []).map((binding) => ({ binding, deps: null, ran: false })),
    pending: null, started: false, stopped: false, unsubscribe: null,
  };
  return {
    start() {
      if (c.started) return;
      c.started = true;
      c.unsubscribe = store.subscribe(() => schedule(c));
      flush(c);
    },
    flush: () => flush(c),
    invalidate: () => schedule(c),
    add(binding) {
      const entry = { binding, deps: null, ran: false };
      c.entries.push(entry);
      schedule(c);
      return () => { c.entries = c.entries.filter((e) => e !== entry); };
    },
    stop() {
      c.stopped = true;
      c.unsubscribe?.();
      c.unsubscribe = null;
      if (c.pending !== null && c.cancel) c.cancel(c.pending);
      c.pending = null;
    },
  };
}
