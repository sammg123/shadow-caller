// The one store (ui-architecture.md decision 1 and 2.2; owner A1). Pure: no DOM, no timers.
// Listeners run only when the reducer returns a new object. A dispatch made while listeners run is queued and
// handled right after, so every listener sees each transition once and in order.
// A reducer or listener that throws never throws into the dispatcher: sync and actions dispatch from I/O code and
// would read it as a dead server or a lost POST. The error goes to `onError` (default: rethrown on a microtask).
import { reportLater, reporterOf } from "./domain.js";

function assertEvent(event) {
  if (!event || typeof event !== "object" || typeof event.type !== "string") {
    throw new TypeError("dispatch needs an event object with a string type");
  }
}

function notify(listeners, next, prev, event, report) {
  for (const listener of [...listeners]) {
    try {
      listener(next, prev, event);
    } catch (err) {
      report(err);
    }
  }
}

/** Reduce one event; returns the new state, or the same one when the reducer throws (the error is reported). */
function applyOne(reducer, state, event, report) {
  try {
    return reducer(state, event);
  } catch (err) {
    report(err);
    return state;
  }
}

/**
 * @param {(state: object, event: object) => object} reducer
 * @param {object} initialState
 * @param {{ onError?: (err: unknown) => void }} [options] where reducer and listener errors go
 */
export function createStore(reducer, initialState, { onError = reportLater } = {}) {
  if (typeof reducer !== "function") throw new TypeError("createStore needs a reducer function");
  const report = reporterOf(onError);
  const box = { state: initialState, draining: false, pending: [], listeners: new Set() };

  function dispatch(event) {
    assertEvent(event);
    box.pending.push(event);
    if (box.draining) return;
    box.draining = true;
    try {
      while (box.pending.length) {
        const ev = box.pending.shift();
        const prev = box.state;
        box.state = applyOne(reducer, prev, ev, report);
        if (box.state !== prev) notify(box.listeners, box.state, prev, ev, report);
      }
    } finally {
      box.draining = false;
    }
  }

  function subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("subscribe needs a function");
    box.listeners.add(listener);
    return () => box.listeners.delete(listener);
  }

  /** Call `onChange(next, prev, state)` whenever `selector(state)` changes by identity. Returns unsubscribe. */
  const observe = (selector, onChange) => subscribe((next, prev) => {
    const a = selector(next);
    const b = selector(prev);
    if (a !== b) onChange(a, b, next);
  });

  return { getState: () => box.state, select: (selector) => selector(box.state), dispatch, subscribe, observe };
}
