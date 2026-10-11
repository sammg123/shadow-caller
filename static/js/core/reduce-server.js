// Server bodies and request bookkeeping (ui-architecture.md 2.1, 3.2, 3.3; owner A1). Pure.
// `server` is the newest /api/state body; `version` the newest /api/version, refreshed by every state body so its
// feed and watch stay the freshest copies; `req` counts in-flight actions so stale poll bodies can be dropped.
import { deepFreeze, isPlainObject, isStateBody, own } from "./domain.js";
import { patchPreds } from "./timeline-cache.js";

export function initialReq() {
  return { seq: 0, lastActionApplied: 0, inflightActions: 0 };
}

function bootFor(boot, server) {
  const phase = server.keys ? "ready" : "restart";
  return boot.phase === phase && boot.error === null ? boot : { ...boot, phase, error: null };
}

function versionWith(version, server) {
  if (!version) return version;
  const feed = isPlainObject(server.feed) ? { ...version.feed, ...server.feed } : version.feed;
  const watch = isPlainObject(server.watch) ? server.watch : version.watch;
  return deepFreeze({ ...version, feed, watch });
}

function timelineWith(timeline, log) {
  const rows = patchPreds(timeline.rows, log);
  return rows === timeline.rows ? timeline : { ...timeline, rows };
}

function stateLoaded(state, { body, origin, reqSeq }) {
  if (!isStateBody(body)) return state;
  if (origin === "poll" && Number.isFinite(reqSeq) && reqSeq < state.req.lastActionApplied) return state;
  const server = deepFreeze(body);
  return {
    ...state,
    server,
    boot: bootFor(state.boot, server),
    version: versionWith(state.version, server),
    timeline: timelineWith(state.timeline, server.log),
  };
}

function versionLoaded(state, { body }) {
  return isPlainObject(body) ? { ...state, version: deepFreeze(body) } : state;
}

function actionStart(state, { reqSeq }) {
  if (!Number.isFinite(reqSeq)) return state;
  const { req } = state;
  return { ...state, req: { ...req, seq: Math.max(req.seq, reqSeq), inflightActions: req.inflightActions + 1 } };
}

function actionEnd(state, { reqSeq }) {
  const { req } = state;
  const inflightActions = Math.max(0, req.inflightActions - 1);
  const lastActionApplied = Number.isFinite(reqSeq) ? Math.max(req.lastActionApplied, reqSeq) : req.lastActionApplied;
  if (inflightActions === req.inflightActions && lastActionApplied === req.lastActionApplied) return state;
  return { ...state, req: { ...req, inflightActions, lastActionApplied } };
}

const HANDLERS = Object.freeze({
  "state/loaded": stateLoaded, "version/loaded": versionLoaded, "req/action-start": actionStart, "req/action-end": actionEnd,
  tick: (state) => state,   // the root reducer runs the lag valve on every event that carries `now`
});

export const SERVER_EVENTS = Object.freeze(Object.keys(HANDLERS));

export function reduceServer(state, event) {
  const handler = own(HANDLERS, event.type);
  return handler ? handler(state, event) : state;
}
