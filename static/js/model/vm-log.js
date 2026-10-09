// Play log (FI 3.9): every logged row, newest first, never paginated. Nullified rows leave "#" empty (G15) and
// goal to go reads "Goal" (G16).
import { LOG } from "./copy.js";
import { DASH, freezeDeep, pct, pct1, situationText } from "./format.js";
import { verdictOf } from "./verdict.js";

const TOP3_RANK = 3;

/** The Actual cell: the logged name (or a legacy call), then ", TD" and ", turnover". */
export function actualText(row) {
  const name = (typeof row.name === "string" && row.name) || LOG.legacyCall[row.call] || "";
  return `${name}${row.td ? ", TD" : ""}${row.turnover ? ", turnover" : ""}`;
}

function topPick(row, leafNames) {
  if (row.top_leaf) return `${leafNames[row.top_leaf] || row.top_leaf} ${pct(row.top_leaf_p)}`;
  const p = typeof row.p === "number" ? row.p : null;
  if (p === null) return DASH;
  return `${p >= 0.5 ? LOG.pass : LOG.run} ${pct(Math.max(p, 1 - p))}`;
}

function rankCell(rank) {
  if (!Number.isInteger(rank)) return { text: DASH, tone: "" };
  return { text: String(rank), tone: rank === 1 ? "good" : rank <= TOP3_RANK ? "" : "bad" };
}

/** v1.2 (A8): the timeline id of a log row (its ESPN play id, or "log-<seq>" for a typed snap, DC B7, D). */
const timelineIdOf = (row) => (row.espn_id ? String(row.espn_id) : `log-${row.seq}`);

/** Drawn rows that draw something, by timeline id -> seq (the field can show only these, core/review.js). */
function drawnSeqs(tl) {
  const rows = tl && Array.isArray(tl.rows) ? tl.rows : [];
  return new Map(rows.filter((r) => r && r.kind !== "admin").map((r) => [String(r.id), r.seq]));
}

function logRow(row, ctx) {
  const hasLeaf = row.leaf_p != null;
  const tlSeq = ctx.drawn.get(timelineIdOf(row)) ?? null;
  return {
    seq: row.seq,
    snap: row.nullified || row.snap == null ? "" : String(row.snap),
    time: LOG.time(row.qtr, row.clock),
    situation: situationText(row.down, row.togo, row.yardline_100, ctx.off, ctx.opp),
    topPick: topPick(row, ctx.leafNames),
    actual: actualText(row),
    hisP: pct1(hasLeaf ? row.leaf_p : row.fam_p),
    lgP: pct1(hasLeaf ? row.leaf_p_league : row.fam_p_league),
    rank: rankCell(row.leaf_rank),
    yds: row.nullified ? LOG.flag : row.yards == null ? "" : String(row.yards),
    nullified: Boolean(row.nullified),
    verdict: verdictOf(row).key,                 // v1.2 (A8): top1, top3, miss or none
    tlSeq,                                       // v1.2 (A8): its drawn row on the field, or null
    reviewing: tlSeq !== null && tlSeq === ctx.reviewSeq,
  };
}

/**
 * @param {object} pv  presented view
 * @returns {object} frozen {heading, columns[9], empty, emptyText, rows: {seq, snap, time, situation, topPick, actual,
 *   hisP, lgP, rank: {text, tone}, yds, nullified, verdict, tlSeq, reviewing}[]}
 */
export function logVm(pv) {
  const presented = pv && pv.presented;
  const log = presented && Array.isArray(presented.log) ? presented.log : [];
  const base = { heading: LOG.heading, columns: [...LOG.columns] };
  if (!log.length) return freezeDeep({ ...base, empty: true, emptyText: LOG.empty, rows: [] });
  const game = presented.game || {};
  const review = pv.view && pv.view.review ? pv.view.review.seq : null;
  const ctx = { off: game.offense, opp: game.opponent, leafNames: presented.leaf_names || {}, drawn: drawnSeqs(pv.tl),
    reviewSeq: Number.isInteger(review) ? review : null };
  return freezeDeep({ ...base, empty: false, emptyText: "", rows: log.map((row) => logRow(row, ctx)) });
}
