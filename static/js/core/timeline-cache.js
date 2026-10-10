// The client's copy of GET /api/timeline (ui-architecture.md 2.2, DC B1, B7, C1; owner A1). Pure.
// Within an epoch the timeline is append-only: rows[i].seq === i + 1, frozen. A new epoch replaces everything.
import { deepFreeze, isPlainObject } from "./domain.js";

/** Fields of row.pred that follow a retag or an undo of one (DC B7). Geometry never follows them. */
export const PRED_PATCH_KEYS = Object.freeze(["family", "leaf", "name", "fam_p", "fam_p_league", "leaf_p", "leaf_p_league",
  "leaf_rank", "leaf_rank_league", "success", "retagged"]);

export function emptyTimeline() {
  return { epoch: null, n: 0, source: null, mode: null, field: null, teams: null, teamOrder: [], meta: null, wpStart: null,
    rows: [], needsFull: false, snapshots: [] };
}

const isCount = (v) => Number.isInteger(v) && v >= 0;
const isRow = (r) => isPlainObject(r) && Number.isInteger(r.seq) && r.seq >= 1;

/** Validate a /api/timeline body at the boundary. Returns an error message, or null when it is usable. */
export function checkTimelineBody(body) {
  if (!isPlainObject(body)) return "timeline body is not an object";
  if (typeof body.epoch !== "string" || body.epoch === "") return "timeline epoch missing";
  if (!isCount(body.n) || !isCount(body.since)) return "timeline n or since is not a whole number";
  if (!Array.isArray(body.rows) || !body.rows.every(isRow)) return "timeline rows are malformed";
  if (body.drives != null && !Array.isArray(body.drives)) return "timeline drives are malformed";
  if (body.unlinked != null && !Array.isArray(body.unlinked)) return "timeline unlinked is malformed";
  return null;
}

/** v1.2 (A8): `boxEspn` is ESPN's own box score (box_espn, ui-architecture Appendix B), null when not sent. */
function snapshotOf(resp) {
  return deepFreeze({ n: resp.n, drives: resp.drives ?? [], status: resp.status ?? null, box: resp.box ?? null,
    boxEspn: isPlainObject(resp.box_espn) ? resp.box_espn : null, unlinked: resp.unlinked ?? [] });
}

const consecutiveFrom = (rows, first) => rows.every((r, i) => r.seq === first + i);
/** Ascending and within 1..n. A since=0 body may skip a seq: the server counts an applied play ESPN no longer lists. */
const ascendingWithin = (rows, n) => rows.every((r, i) => r.seq <= n && (i === 0 || r.seq > rows[i - 1].seq));
const wantFull = (cache) => ({
  cache: cache.needsFull ? cache : { ...cache, needsFull: true }, added: [], reset: false, needsFull: true,
});

function replace(resp) {
  if (!ascendingWithin(resp.rows, resp.n)) return null;
  const rows = deepFreeze([...resp.rows]);
  const cache = {
    epoch: resp.epoch, n: resp.n, source: resp.source ?? null, mode: resp.mode ?? null,
    field: deepFreeze(resp.field ?? null), teams: deepFreeze(resp.teams ?? null),
    teamOrder: deepFreeze(resp.team_order ?? []),
    meta: deepFreeze(resp.meta ?? null), wpStart: Number.isFinite(resp.wp_start) ? resp.wp_start : null,
    rows, needsFull: false, snapshots: [snapshotOf(resp)],
    // v1.4 (W1): the game's kickoff and light (timeline `game`, Appendix B), only when the server sends it (DC C1)
    ...(isPlainObject(resp.game) ? { game: deepFreeze({ ...resp.game }) } : {}),
  };
  return { cache, added: rows, reset: true, needsFull: false };
}

function append(cache, resp) {
  const fresh = resp.rows.filter((r) => r.seq > cache.n);
  const last = fresh.length ? fresh[fresh.length - 1].seq : cache.n;
  if (!consecutiveFrom(fresh, cache.n + 1) || last !== resp.n) return wantFull(cache);
  const added = deepFreeze([...fresh]);
  const snapshots = [...cache.snapshots.filter((s) => s.n !== resp.n), snapshotOf(resp)];
  return {
    cache: { ...cache, n: resp.n, source: resp.source ?? cache.source, mode: resp.mode ?? cache.mode,
      rows: added.length ? Object.freeze([...cache.rows, ...added]) : cache.rows, needsFull: false, snapshots },
    added, reset: false, needsFull: false,
  };
}

/**
 * Merge one response. Reset (replace everything) on `reset`, since 0 or a new epoch; field, teams, team_order,
 * meta and wp_start arrive only then (DC C1). Otherwise append: rows at or below n are duplicates, the rest must run
 * n + 1 ... resp.n with no gap, else the cache keeps its rows and asks for a since=0 refetch (needsFull). The full
 * body that refetch brings is taken as it is, so a server-side hole can never make the client refetch forever.
 * A same-epoch response with a smaller n is stale and changes nothing.
 */
export function mergeTimeline(cache, resp) {
  const isReset = resp.reset === true || resp.since === 0 || resp.epoch !== cache.epoch;
  if (isReset) return (resp.since === 0 ? replace(resp) : null) ?? wantFull(cache);
  if (resp.n < cache.n) return { cache, added: [], reset: false, needsFull: false };
  return append(cache, resp);
}

function linkKey(row) {
  if (row.src === "log" && typeof row.id === "string") return `log:${row.id.slice("log-".length)}`;
  return `espn:${row.id}`;
}

function logIndex(log) {
  const index = new Map();
  for (const r of log) {
    if (!isPlainObject(r)) continue;
    if (r.espn_id != null) index.set(`espn:${r.espn_id}`, r);
    if (r.seq != null) index.set(`log:${r.seq}`, r);
  }
  return index;
}

function patchedPred(pred, logRow) {
  let next = pred;
  for (const key of PRED_PATCH_KEYS) {
    const value = key === "retagged" ? Boolean(logRow.retagged) : logRow[key];
    if (value !== undefined && pred[key] !== value) next = { ...next, [key]: value };
  }
  return next;
}

/**
 * Copy the retag-mutable fields from /api/state log rows onto cached row.pred (DC B7). ESPN rows join on
 * log.espn_id === row.id, hand-entered rows on row.id === "log-" + log.seq. Returns the same array when nothing
 * changed and new objects only for changed rows; geometry is never touched.
 */
export function patchPreds(rows, log) {
  if (!Array.isArray(log) || log.length === 0 || rows.length === 0) return rows;
  const index = logIndex(log);
  let changed = false;
  const out = rows.map((row) => {
    const logRow = row.pred ? index.get(linkKey(row)) : undefined;
    if (!logRow) return row;
    const pred = patchedPred(row.pred, logRow);
    if (pred === row.pred) return row;
    changed = true;
    return deepFreeze({ ...row, pred });
  });
  return changed ? deepFreeze(out) : rows;
}

/** The newest snapshot with snapshot.n <= n, or null. Snapshots are kept in ascending n. */
export function snapshotAt(cache, n) {
  let found = null;
  for (const s of cache.snapshots) if (s.n <= n) found = s;
  return found;
}

/** Drop snapshots that nothing on screen can need: keep the newest at or below keepFromN and all above it. */
export function pruneSnapshots(cache, keepFromN) {
  const floor = snapshotAt(cache, keepFromN);
  const kept = cache.snapshots.filter((s) => s.n > keepFromN || s === floor);
  return kept.length === cache.snapshots.length ? cache : { ...cache, snapshots: kept };
}

export function rowBySeq(cache, seq) {
  const row = Number.isInteger(seq) && seq >= 1 ? cache.rows[seq - 1] : undefined;
  if (row && row.seq === seq) return row;
  return cache.rows.find((r) => r.seq === seq) ?? null;
}
