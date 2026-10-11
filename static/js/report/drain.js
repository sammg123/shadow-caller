// The Model Report's stand-in for the conductor (core/conductor.js), which it never loads: there is no field here, so
// every timeline row counts as drawn the moment it arrives. It moves the store's own animation queue on with the
// conductor's events (anim/rebuilt, anim/started, anim/done, each carrying `now`), so the app's presentation gating
// (core/present.js) shows each new state at once and the report follows a live game through the app's own sync.
// Store side only: no DOM, no timers; the clock is injected.

/**
 * The next event that moves the queue on without an engine: finish a rebuild, land the row that is playing, start the
 * queue's head; null when nothing waits. Pure.
 * @param {{ token: number, rebuilding: boolean, playing: { seq: number } | null, queue: { seq: number }[] }} anim
 */
export function nextDrainEvent(anim) {
  if (!anim) return null;
  if (anim.rebuilding) return { type: "anim/rebuilt", token: anim.token };
  if (anim.playing) return { type: "anim/done", seq: anim.playing.seq, token: anim.token };
  if (anim.queue.length) return { type: "anim/started", seq: anim.queue[0].seq, token: anim.token, durationMs: 0 };
  return null;
}

/**
 * Drain the queue now and after every store change; each step is one event, so every listener sees each transition in
 * order (the store queues a dispatch made while its listeners run).
 * @param {{ getState: Function, dispatch: Function, subscribe: Function }} store
 * @param {() => number} now  epoch milliseconds
 * @returns {() => void} detach
 */
export function attachDrain(store, now) {
  const step = (state) => {
    const event = nextDrainEvent(state.anim);
    if (event) store.dispatch({ ...event, now: now() });
  };
  const unsubscribe = store.subscribe((next) => step(next));
  step(store.getState());
  return unsubscribe;
}
