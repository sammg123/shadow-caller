// His graded calls, the rows every Model Report board reads (pure). A call is a timeline row of the caller's offense
// whose prediction the scorecard grades (model/verdict.js): the play log's rows on the field, with the model's chances
// from before the snap (pred.dist, DC B7) still on them. Words come from the timeline's own meta and the app's
// formatters, so the report reads like the rest of the app. Nothing here is specific to a team or a caller.
import { LEAVES, isPlainObject } from "../../core/domain.js";
import { clockText, pct1, qtrText, resultText, situationText } from "../../model/format.js";
import { verdictOf, verdictText } from "../../model/verdict.js";
import { NIGHT } from "./copy.js";

const TOP_N = 3;
const finite = (x) => typeof x === "number" && Number.isFinite(x);
const isCall = (row) => isPlainObject(row) && row.offense_is_caller === true && isPlainObject(row.pred)
  && verdictOf(row.pred).key !== "none";

/**
 * His graded snaps on the presented timeline, in timeline order.
 * @param {object|null} tl  pv.tl (core/present.js presentedTimeline)
 * @returns {object[]} frozen timeline rows
 */
export function callerCalls(tl) {
  const rows = tl && Array.isArray(tl.rows) ? tl.rows : [];
  return Object.freeze(rows.filter(isCall));
}

/** The names and the canonical order of the specific plays: the timeline's meta, else the state's names. */
export function leafTable(pv) {
  const meta = (pv && pv.tl && pv.tl.meta) || {};
  const names = meta.leaf_names || (pv && pv.presented && pv.presented.leaf_names) || {};
  const leaves = Array.isArray(meta.leaves) && meta.leaves.length ? meta.leaves : LEAVES;
  return { names, leaves };
}

const nameOf = (table, leaf) => (Object.hasOwn(table.names, leaf) && table.names[leaf]) || String(leaf);

/** The model's chance that he calls what he called: the specific play, else the play type, else pass or run. */
export function chanceOn(pred) {
  if (finite(pred.leaf_p)) return pred.leaf_p;
  if (finite(pred.fam_p)) return pred.fam_p;
  if (finite(pred.p) && (pred.dropback === 0 || pred.dropback === 1)) return pred.dropback ? pred.p : 1 - pred.p;
  return null;
}

/**
 * The model's top 3 before the snap, with his chances, from the row's whole tree (pred.dist.his_l in the canonical
 * leaf order); a row without the tree (a game file from before it) shows its top pick alone.
 */
function topThree(pred, table) {
  const entry = (leaf, p) => ({ leaf, name: nameOf(table, leaf), pct: finite(p) ? pct1(p) : "",
    called: leaf === pred.leaf });
  const his = pred.dist && Array.isArray(pred.dist.his_l) ? pred.dist.his_l : null;
  if (!his) return typeof pred.top_leaf === "string" ? [entry(pred.top_leaf, pred.top_leaf_p)] : [];
  const chance = (leaf) => his[table.leaves.indexOf(leaf)];
  const ranked = Array.isArray(pred.top3) && pred.top3.length ? pred.top3
    : [...table.leaves].sort((a, b) => (chance(b) ?? 0) - (chance(a) ?? 0));
  return ranked.slice(0, TOP_N).map((leaf) => entry(leaf, chance(leaf)));
}

/** What he called, in the play log's words: the logged name, then ", TD" or ", turnover". */
function calledText(row) {
  const result = row.result || {};
  const name = typeof row.pred.name === "string" ? row.pred.name : "";
  return `${name}${result.td && !result.turnover ? ", TD" : ""}${result.turnover ? ", turnover" : ""}`;
}

function rankText(pred) {
  return Number.isInteger(pred.leaf_rank) && pred.leaf_rank > 0 ? String(pred.leaf_rank) : "";
}

/** "Q2 8:41". */
export function timeText(row) {
  return [qtrText(row.qtr), clockText(row.clock)].filter(Boolean).join(" ");
}

function situationOf(row) {
  const pre = row.pre || {};
  return situationText(pre.down, pre.togo, pre.yardline_100, row.team, row.opp)
    || (typeof pre.text === "string" ? pre.text : "");
}

/**
 * The facts every board shows about one call. A play a flag wiped out keeps its call and grade (it still counts) and
 * leaves its snap number empty, as the play log does (G15).
 * @returns {{seq, drive, qtr, snap, time, situation, called, calledPct, rank, verdict, verdictText, nullified, result,
 *   chance, top3: {leaf, name, pct, called}[]}}
 */
export function callFacts(row, table) {
  const pred = row.pred;
  const nullified = Boolean(row.result && row.result.nullified);
  const chance = chanceOn(pred);
  const verdict = verdictOf(pred).key;
  return {
    seq: row.seq, drive: Number.isInteger(row.drive) ? row.drive : null,
    qtr: Number.isInteger(row.qtr) ? row.qtr : null,
    snap: nullified || !Number.isInteger(pred.snap) ? "" : String(pred.snap),
    time: timeText(row), situation: situationOf(row), called: calledText(row),
    calledPct: chance === null ? "" : pct1(chance), rank: rankText(pred), verdict, verdictText: verdictText(verdict),
    nullified, result: resultText(row), chance, top3: topThree(pred, table),
  };
}

/** The verdict in words, with the rank when he was in the top 3 but not the top pick ("In his top 3, #2"). */
export function verdictWords(facts) {
  return facts.verdict === "top3" && facts.rank ? NIGHT.inTop3(facts.rank) : facts.verdictText;
}
