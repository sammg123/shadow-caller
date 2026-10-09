// Presentation gating (ui-architecture.md decision 2, 2.2 and 3.4; owner A1). Pure.
// The HUD shows a new /api/state only once the field has drawn every timeline row that state knows about, so the
// order on screen is always call, then snap, then verdict, and nothing runs ahead of the ball. A 4 s valve flushes
// the animation queue so a stalled engine can never freeze the next call.
import { flushAll } from "./anim-queue.js";
import { snapshotAt } from "./timeline-cache.js";

export const MAX_PRESENT_LAG_MS = 4000;

/** True when `server` can be shown: an old server without a timeline pointer, or every row it knows is drawn. */
export function isPresentable(server, timeline, anim) {
  if (!server) return false;
  const pointer = server.timeline;
  if (!pointer || typeof pointer !== "object") return true;
  return pointer.epoch === timeline.epoch && pointer.n <= anim.drawnThrough && !anim.rebuilding;
}

/** Move `presented` up to `server` when presentable, or when it has waited MAX_PRESENT_LAG_MS (then flush the queue). */
export function advancePresented(state, now) {
  const { server, presented, presentedSince } = state;
  if (!server || server === presented) {
    return presentedSince === null ? state : { ...state, presentedSince: null };
  }
  if (isPresentable(server, state.timeline, state.anim)) return { ...state, presented: server, presentedSince: null };
  const since = presentedSince ?? now;
  if (now - since >= MAX_PRESENT_LAG_MS) {
    return { ...state, presented: server, presentedSince: null, anim: flushAll(state.anim) };
  }
  return since === presentedSince ? state : { ...state, presentedSince: since };
}

const memo = new WeakMap();

function buildPresented(timeline, drawnThrough) {
  const rows = drawnThrough >= timeline.n ? timeline.rows : timeline.rows.filter((r) => r.seq <= drawnThrough);
  const snap = snapshotAt(timeline, drawnThrough);
  return Object.freeze({
    rows, drives: snap?.drives ?? [], status: snap?.status ?? null, box: snap?.box ?? null, unlinked: snap?.unlinked ?? [],
    wpStart: timeline.wpStart, teams: timeline.teams, field: timeline.field, meta: timeline.meta,
    source: timeline.source, mode: timeline.mode,
  });
}

/** What timeline-derived panels may show: rows up to the drawn one and the matching drives, status and box. */
export function presentedTimeline(state) {
  const { timeline, anim } = state;
  const hit = memo.get(timeline);
  if (hit && hit.drawnThrough === anim.drawnThrough) return hit.value;
  const value = buildPresented(timeline, anim.drawnThrough);
  memo.set(timeline, { drawnThrough: anim.drawnThrough, value });
  return value;
}

/** The presented view `pv` every view model takes (2.3): what the HUD may show at `now`. */
export function presentedView(state, now) {
  return {
    presented: state.presented, tl: presentedTimeline(state), version: state.version, view: state.view,
    prefs: state.prefs, conn: state.conn, boot: state.boot, anim: state.anim, now,
  };
}
