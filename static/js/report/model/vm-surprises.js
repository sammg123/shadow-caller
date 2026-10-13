// His biggest surprises (pure; restructure-v2.md section 6): the calls he made that the model gave the lowest chance,
// read from each row's own prediction (leaf_p, the chance on the specific play he called), lowest first. A play a flag
// wiped out still counts: it was still his call. A call graded only on the play type has no such chance and is left
// out, so every surprise is measured on the same scale.
import { freezeDeep, pct1 } from "../../model/format.js";
import { callFacts, callerCalls, leafTable } from "./calls.js";
import { REPORT, SURPRISES } from "./copy.js";
import { namedPlate } from "./side.js";

export const SURPRISES_SHOWN = 5;

const finite = (x) => typeof x === "number" && Number.isFinite(x);

/** His calls with a specific-play chance, lowest chance first; ties keep game order. */
function lowestFirst(calls) {
  return calls.filter((row) => finite(row.pred.leaf_p))
    .sort((a, b) => a.pred.leaf_p - b.pred.leaf_p || a.seq - b.seq)
    .slice(0, SURPRISES_SHOWN);
}

/** seq -> rank (1 is the biggest surprise), for the night board's numbered marks. */
export function surpriseRanks(calls) {
  return new Map(lowestFirst(calls).map((row, i) => [row.seq, i + 1]));
}

function surpriseRow(row, rank, table) {
  const facts = callFacts(row, table);
  const pick = typeof row.pred.top_leaf === "string" ? row.pred.top_leaf : null;
  const names = table.names;
  return {
    rank, key: `surprise:${row.seq}`, seq: row.seq, snap: facts.snap, time: facts.time, situation: facts.situation,
    when: REPORT.when(facts.snap, facts.time, facts.situation),
    called: facts.called, calledPct: facts.calledPct, calledRank: facts.rank,
    rankText: facts.rank ? SURPRISES.rankOf(facts.rank, table.leaves.length) : "",
    modelPick: pick ? (Object.hasOwn(names, pick) && names[pick]) || pick : "",
    modelPct: finite(row.pred.top_leaf_p) ? pct1(row.pred.top_leaf_p) : "", nullified: facts.nullified,
  };
}

/**
 * @param {object} pv  presented view
 * @returns {object} frozen {heading, sub, labels: {called, modelPick}, empty, emptyText, rows: {rank, key, seq, snap,
 *   time, situation, when, called, calledPct, calledRank, rankText, modelPick, modelPct, nullified}[]}
 */
export function surprisesVm(pv) {
  const table = leafTable(pv);
  const calls = callerCalls(pv && pv.tl);
  const rows = lowestFirst(calls).map((row, i) => surpriseRow(row, i + 1, table));
  const emptyText = rows.length ? "" : calls.length ? SURPRISES.noPlayGrades : SURPRISES.empty;
  return freezeDeep({ heading: namedPlate(pv, SURPRISES.named, SURPRISES.heading), sub: SURPRISES.sub,
    labels: { called: SURPRISES.called, modelPick: SURPRISES.modelPick },
    empty: rows.length === 0, emptyText, rows });
}
