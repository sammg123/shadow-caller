// Boot and connection state (ui-architecture.md 2.1, 3.1, 3.9; #119, #120, G11; owner A1). Pure.
import { own } from "./domain.js";

export function initialBoot() {
  return { phase: "loading", attempts: 0, error: null };
}

export function initialConn() {
  return { failures: 0, lastOkAt: null, retryAt: null, lastError: null };
}

const finiteOrNull = (v) => (Number.isFinite(v) ? v : null);
const textOrNull = (v) => (v === undefined || v === null ? null : String(v));

function bootAttempt(state) {
  const { boot } = state;
  return { ...state, boot: { ...boot, phase: boot.phase === "failed" ? "failed" : "loading", attempts: boot.attempts + 1 } };
}

function bootFailed(state, event) {
  const error = textOrNull(event.error);
  return {
    ...state,
    boot: { ...state.boot, phase: "failed", error },
    conn: { ...state.conn, retryAt: finiteOrNull(event.retryAt), lastError: error },
  };
}

function connOk(state, event) {
  return { ...state, conn: { failures: 0, lastOkAt: finiteOrNull(event.now), retryAt: null, lastError: null } };
}

function connFailed(state, event) {
  const { conn } = state;
  return {
    ...state,
    conn: { ...conn, failures: conn.failures + 1, retryAt: finiteOrNull(event.retryAt), lastError: textOrNull(event.error) },
  };
}

const HANDLERS = Object.freeze({
  "boot/attempt": bootAttempt, "boot/failed": bootFailed, "conn/ok": connOk, "conn/failed": connFailed,
});

export const CONN_EVENTS = Object.freeze(Object.keys(HANDLERS));

export function reduceConn(state, event) {
  const handler = own(HANDLERS, event.type);
  return handler ? handler(state, event) : state;
}
