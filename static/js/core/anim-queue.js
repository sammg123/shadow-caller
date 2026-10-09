// Animation queue policy (ui-architecture.md 2.2 and 3.4, DC E4; owner A1). Pure: time comes in as `now`.
// Rows are drawn in seq order. Animation length is min(normal, 0.8 * (watch.next_at - now)) shared across the animated
// queue; with more than 3 animated rows queued the older ones draw instantly; a hidden tab or reduced motion draws
// everything instantly; the operator's own rows animate at most 800 ms.

/** @typedef {{ seq: number, origin: "poll" | "action", instant: boolean }} QueueItem */
/** @typedef {{ token: number, queue: QueueItem[], playing: null | { seq: number, startedAt: number, durationMs: number,
 *   hurry?: boolean }, drawnThrough: number, rebuilding: boolean }} AnimState */

export const MAX_ANIMATED_QUEUE = 3;
export const BUDGET_SHARE = 0.8;
export const MIN_ANIM_MS = 120;
export const OWN_ACTION_MAX_MS = 800;
/** next_at further than this from now is ignored (clock-skew guard; server and browser share a clock on localhost). */
export const NEXT_AT_WINDOW_MS = 60000;

export function emptyAnim() {
  return { token: 0, queue: [], playing: null, drawnThrough: 0, rebuilding: false };
}

/** Keep only the newest MAX_ANIMATED_QUEUE animated items animated; older ones become instant. */
function capAnimated(queue) {
  let animated = 0;
  const keep = new Set();
  for (let i = queue.length - 1; i >= 0; i -= 1) {
    if (!queue[i].instant && animated < MAX_ANIMATED_QUEUE) {
      keep.add(i);
      animated += 1;
    }
  }
  return queue.map((q, i) => (q.instant || keep.has(i) ? q : { ...q, instant: true }));
}

const sameItems = (a, b) => a.length === b.length && a.every((q, i) => q === b[i]);

/** Queue newly merged rows (from timeline/loaded). Rows already drawn, queued or playing are skipped. */
export function enqueue(anim, rows, { origin, hidden, reducedMotion }) {
  const known = new Set(anim.queue.map((q) => q.seq));
  if (anim.playing) known.add(anim.playing.seq);
  const fresh = rows.filter((r) => r.seq > anim.drawnThrough && !known.has(r.seq));
  const allInstant = Boolean(hidden || reducedMotion);
  const added = fresh.map((r) => ({ seq: r.seq, origin, instant: allInstant || r.kind === "admin" }));
  const merged = [...anim.queue, ...added];
  const queue = allInstant ? merged.map((q) => (q.instant ? q : { ...q, instant: true })) : capAnimated(merged);
  return sameItems(queue, anim.queue) ? anim : { ...anim, queue };
}

/** Rebuild after an epoch change: no animation, everything through n counts as drawn once the engine confirms. */
export function rebuild(anim, n) {
  return { token: anim.token + 1, queue: [], playing: null, drawnThrough: n, rebuilding: true };
}

export function markRebuilt(anim, token) {
  return token === anim.token && anim.rebuilding ? { ...anim, rebuilding: false } : anim;
}

function watchBudget(watch, now, animatedCount) {
  if (!watch || watch.state !== "playing" || !Number.isFinite(watch.next_at)) return Infinity;
  const ahead = watch.next_at - now;
  if (!(ahead > 0 && ahead < NEXT_AT_WINDOW_MS)) return Infinity;
  return (BUDGET_SHARE * ahead) / Math.max(1, animatedCount);
}

/** The next row to draw, or null while one plays, during a rebuild, or with nothing queued. */
export function nextJob(anim, { now, watch, normalMs }) {
  if (anim.playing || anim.rebuilding || anim.queue.length === 0) return null;
  const head = anim.queue[0];
  const instant = { seq: head.seq, durationMs: 0, instant: true, token: anim.token };
  if (head.instant) return instant;
  const normal = normalMs(head.seq);
  if (!Number.isFinite(normal) || normal <= 0) return instant;
  const animated = anim.queue.filter((q) => !q.instant).length;
  const capped = head.origin === "action" ? OWN_ACTION_MAX_MS : Infinity;
  const ms = Math.round(Math.min(normal, watchBudget(watch, now, animated), capped));
  return ms < MIN_ANIM_MS ? instant : { seq: head.seq, durationMs: ms, instant: false, token: anim.token };
}

/** The conductor started the head job. Only the head can start, and only one row plays at a time. */
export function markStarted(anim, job, now) {
  if (anim.playing || anim.queue.length === 0 || anim.queue[0].seq !== job.seq) return anim;
  return { ...anim, queue: anim.queue.slice(1), playing: { seq: job.seq, startedAt: now, durationMs: job.durationMs } };
}

/** The engine finished drawing `seq`. Callbacks carrying an old token (from before a rebuild) are ignored. */
export function markDone(anim, seq, token) {
  if (token !== anim.token || !anim.playing || anim.playing.seq !== seq) return anim;
  return { ...anim, playing: null, drawnThrough: Math.max(anim.drawnThrough, seq) };
}

/** Safety valve: every queued row becomes instant and the running animation is asked to finish now. */
export function flushAll(anim) {
  const queue = anim.queue.map((q) => (q.instant ? q : { ...q, instant: true }));
  const hurry = anim.playing && !anim.playing.hurry;
  if (sameItems(queue, anim.queue) && !hurry) return anim;
  return { ...anim, queue, playing: hurry ? { ...anim.playing, hurry: true } : anim.playing };
}
