// What each poll tick fetches and when the next one runs (ui-architecture.md 2.2 and 3.2, DC E4, G11; owner A1). Pure.

export const POLL_MS = Object.freeze({ playing: 250, normal: 1000, hidden: 5000 });
export const BACKOFF = Object.freeze({ baseMs: 1000, factor: 2, maxMs: 15000, offlineAfter: 3 });

function timelinePlan(local, v) {
  if (typeof v.epoch !== "string" || !Number.isInteger(v.timeline_n)) return null;   // old server: no timeline
  if (v.epoch !== local.epoch || v.timeline_n < local.n || local.needsFull) return { since: 0, epoch: null };
  if (v.timeline_n > local.n) return { since: local.n, epoch: local.epoch };
  return null;
}

function feedChanged(local, feed) {
  if (!feed || typeof feed !== "object") return false;
  return feed.on !== local.feedOn || feed.state !== local.feedState;
}

/**
 * Decide one tick from a fresh /api/version body. Track n from the timeline response, never from /api/version.
 * The state is refetched when version, feed.on or feed.state change; versions are compared with !==, never >
 * (undo and reset can lower them, G8). A new feed.last_poll alone does not refetch it (Appendix A, #95).
 * @param {{ epoch: string | null, n: number, version?: number, feedOn?: boolean, feedState?: string,
 *           needsFull?: boolean }} local
 */
export function planTick(local, v) {
  return {
    timeline: timelinePlan(local, v),
    state: v.version !== local.version || feedChanged(local, v.feed),
  };
}

/** Backoff after `failures` consecutive failures: 1, 2, 4, 8, then 15 s; 0 when there were none. */
export function retryDelay(failures) {
  if (!(failures > 0)) return 0;
  return Math.min(BACKOFF.maxMs, BACKOFF.baseMs * BACKOFF.factor ** (failures - 1));
}

/** Delay before the next tick: backoff on failures, 5 s in a hidden tab, 250 ms while a watch plays, else 1 s. */
export function nextDelay({ watchState, hidden, failures }) {
  if (failures > 0) return hidden ? Math.max(retryDelay(failures), POLL_MS.hidden) : retryDelay(failures);
  if (hidden) return POLL_MS.hidden;
  return watchState === "playing" ? POLL_MS.playing : POLL_MS.normal;
}

/** Connection banner state (G11): one or two failures retry quietly, three or more are offline. */
export function connState({ failures }) {
  if (!(failures > 0)) return "online";
  return failures >= BACKOFF.offlineAfter ? "offline" : "retrying";
}
