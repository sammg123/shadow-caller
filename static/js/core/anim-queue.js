// Animation queue policy (ui-architecture.md 2.2 and 3.4, DC E4; owner A1). Pure: time comes in as `now`.
// Rows are drawn in seq order. Animation length is min(normal, 0.8 * (watch.next_at - now)) shared across the animated
// queue; with more than 3 animated rows queued the older ones draw instantly; a hidden tab or reduced motion draws
// everything instantly; the operator's own rows animate at most 800 ms.
// v1.4 (G1-1): when the row the watch waits on is the caller's snap (watch.next_kind "caller_snap"), the queue also
// leaves the next call and its shadow plays their reserve (callReserveMs), at most CALL_RESERVE_SHARE of the wait, so
// they are on the field long enough to read before the snap (play-drawing.md 4). watch.py's floors make room for it.

// restructure-v2.md 5: a jump (the page opening the game, a seek, a step back or forward, Go Live) moves the game on the
// server; the field snaps to where it lands: what is queued draws instantly, a play drawing now finishes now, and rows
// of that game up to the server's row n draw instantly when they arrive (`jump`), so no applied play is replayed.

/** @typedef {{ seq: number, origin: "poll" | "action", instant: boolean }} QueueItem */
/** @typedef {{ token: number, queue: QueueItem[], playing: null | { seq: number, startedAt: number, durationMs: number,
 *   hurry?: boolean }, drawnThrough: number, rebuilding: boolean, jump: null | { epoch: string, n: number } }} AnimState */

export const MAX_ANIMATED_QUEUE = 3;
export const BUDGET_SHARE = 0.8;
export const MIN_ANIM_MS = 120;
export const OWN_ACTION_MAX_MS = 800;
/** next_at further than this from now is ignored (clock-skew guard; server and browser share a clock on localhost). */
export const NEXT_AT_WINDOW_MS = 60000;
/**
 * Before the caller's snap, the time kept for the next call: the verdict's beat that comes first (conductor.js: 1.5 s
 * below 4x, 0.6 s from 4x), the call's 400 ms fade-in, the time it stays fully lit (2 s up to 4x, 1 s above) and some
 * to spare (200 ms; 400 above 4x, where a late poll costs the most). Never more than CALL_RESERVE_SHARE of the wait:
 * the play before it gets the rest.
 */
export const CALL_RESERVE_MS = Object.freeze({ slow: 4100, demo: 3200, fast: 2400 });
export const CALL_RESERVE_SHARE = 0.7;
/** The demo speed: below it the slow reserve, above it the fast one; a watch with no speed counts as it. */
export const DEMO_SPEED = 4;
/**
 * A watch object from before the head row landed (watch.idx < head.seq) still points at that row's own landing, so
 * its next_at is already past: the play waits for the next /api/version (every 250 ms while playing) rather than
 * budget on it, and never longer than this past that landing.
 */
export const STALE_WATCH_HOLD_MS = 600;
/** How early a landing may look to the browser and still count as past (the server stamps next_at from its clock). */
const STALE_SKEW_MS = 250;

export function emptyAnim() {
  return { token: 0, queue: [], playing: null, drawnThrough: 0, rebuilding: false, jump: null };
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

/**
 * Queue newly merged rows (from timeline/loaded). Rows already drawn, queued or playing are skipped. Rows through
 * `instantThrough` (the jumped-to row of this game, reduce-timeline.js) draw instantly.
 */
export function enqueue(anim, rows, { origin, hidden, reducedMotion, instantThrough = 0 }) {
  const known = new Set(anim.queue.map((q) => q.seq));
  if (anim.playing) known.add(anim.playing.seq);
  const fresh = rows.filter((r) => r.seq > anim.drawnThrough && !known.has(r.seq));
  const allInstant = Boolean(hidden || reducedMotion);
  const added = fresh.map((r) => ({ seq: r.seq, origin,
    instant: allInstant || r.kind === "admin" || r.seq <= instantThrough }));
  const merged = [...anim.queue, ...added];
  const queue = allInstant ? merged.map((q) => (q.instant ? q : { ...q, instant: true })) : capAnimated(merged);
  return sameItems(queue, anim.queue) ? anim : { ...anim, queue };
}

/** Rebuild after an epoch change: no animation, everything through n counts as drawn once the engine confirms. A jump
 * to the new game stays, so its rows that arrive after the rebuild still snap. */
export function rebuild(anim, n) {
  return { token: anim.token + 1, queue: [], playing: null, drawnThrough: n, rebuilding: true, jump: anim.jump ?? null };
}

export function markRebuilt(anim, token) {
  return token === anim.token && anim.rebuilding ? { ...anim, rebuilding: false } : anim;
}

function watchBudget(watch, now, animatedCount) {
  if (!watch || watch.state !== "playing" || !Number.isFinite(watch.next_at)) return Infinity;
  const ahead = watch.next_at - now;
  if (!(ahead > 0 && ahead < NEXT_AT_WINDOW_MS)) return Infinity;
  const rows = Math.max(1, animatedCount);
  const share = (BUDGET_SHARE * ahead) / rows;
  if (watch.next_kind !== "caller_snap") return share;
  const reserve = Math.min(callReserveMs(watch.speed), CALL_RESERVE_SHARE * ahead);
  return Math.min(share, (ahead - reserve) / rows);
}

/** The next call's reserve at a watch speed (CALL_RESERVE_MS). */
export function callReserveMs(speed) {
  if (!Number.isFinite(speed) || speed === DEMO_SPEED) return CALL_RESERVE_MS.demo;
  return speed < DEMO_SPEED ? CALL_RESERVE_MS.slow : CALL_RESERVE_MS.fast;
}

/** The watch object predates the head row: it waits on a row no later than the head, and that landing is past. */
function staleWatch(watch, seq, now) {
  return Boolean(watch) && watch.state === "playing" && Number.isInteger(watch.idx) && seq > watch.idx
    && Number.isFinite(watch.next_at) && now > watch.next_at - STALE_SKEW_MS
    && now < watch.next_at + STALE_WATCH_HOLD_MS;
}

/** The next row to draw, or null while one plays, during a rebuild, with nothing queued, or while the watch object is
 * older than the row (staleWatch). */
export function nextJob(anim, { now, watch, normalMs }) {
  if (anim.playing || anim.rebuilding || anim.queue.length === 0) return null;
  const head = anim.queue[0];
  const instant = { seq: head.seq, durationMs: 0, instant: true, token: anim.token };
  if (head.instant) return instant;
  if (staleWatch(watch, head.seq, now)) return null;
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

/** A jump landed on row `n` of the game `epoch` (restructure-v2.md 5): flush what is queued and drawing, and remember
 * the row, so the rest of that game up to it draws instantly when it arrives. */
export function markJump(anim, epoch, n) {
  const flushed = flushAll(anim);
  const same = flushed.jump && flushed.jump.epoch === epoch && flushed.jump.n === n;
  return same ? flushed : { ...flushed, jump: { epoch, n } };
}
