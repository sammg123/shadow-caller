// His night so far (pure; restructure-v2.md sections 3 and 6): the old recap's tally (top picks and top-3 hits out of
// his calls, the scorecard's own counts), his last six verdicts (a check, his rank in the top 3, or an X), and the call
// track: every call in order, a bar as tall as the model's chance on the play he called (whole LED cells of 5 points),
// lit by its verdict, a new group for each of his drives, the quarters marked where they begin, and the biggest
// surprises numbered as the surprises board lists them.
import { lastNameOf } from "../../model/vm-masthead.js";
import { freezeDeep, qtrText } from "../../model/format.js";
import { callFacts, callerCalls, leafTable, verdictWords } from "./calls.js";
import { NIGHT } from "./copy.js";
import { surpriseRanks } from "./vm-surprises.js";

export const TRACK_CELLS = 12;
/** The chance a full bar stands for: 60%, so a cell is 5 points (his top picks run from about 20% to 60%). */
export const TRACK_FULL = 0.6;
const RECENT_CALLS = 6;
const TALLY_GHOST = "88";

const finite = (x) => typeof x === "number" && Number.isFinite(x);

/** Whole cells for a chance: at least one (a call is always a lit bar), at most a full bar. */
export function trackCells(chance) {
  if (!finite(chance)) return 1;
  return Math.max(1, Math.min(TRACK_CELLS, Math.round((chance / TRACK_FULL) * TRACK_CELLS)));
}

function headingOf(presented) {
  const last = lastNameOf(presented && presented.profile && presented.profile.caller);
  return last ? NIGHT.heading(last) : NIGHT.headingPlain;
}

/** Top picks and top-3 hits out of his calls, from the scorecard's own counts (as the card's recap says them). */
function tallyOf(metrics) {
  const g = (metrics && metrics.granular) || {};
  if (!(g.leaf_n > 0)) return [];
  const item = (id, label, value) => ({ id, label, value: String(value), ghost: TALLY_GHOST, of: NIGHT.of(g.leaf_n) });
  return [item("top1", NIGHT.top1, g.leaf_top1), item("top3", NIGHT.top3, g.leaf_top3)];
}

function markOf(facts) {
  if (facts.verdict === "top3") return facts.rank || "3";
  return NIGHT.marks[facts.verdict] || "";
}

function recentOf(facts) {
  const items = facts.slice(-RECENT_CALLS).map((f) => ({ key: f.verdict, mark: markOf(f), text: verdictWords(f) }));
  return { label: NIGHT.recent, items };
}

function trackCall(f, i, all, ranks) {
  const prev = all[i - 1];
  const quarter = !prev || prev.qtr !== f.qtr ? qtrText(f.qtr) : "";
  return {
    key: `bar:${f.seq}`, seq: f.seq, verdict: f.verdict, cells: trackCells(f.chance),
    driveStart: !prev || prev.drive !== f.drive, quarter: quarter || null, surprise: ranks.get(f.seq) ?? null,
    text: NIGHT.bar(f.snap, f.time, verdictWords(f), f.called, f.calledPct),
  };
}

function trackOf(facts, ranks) {
  const calls = facts.map((f, i, all) => trackCall(f, i, all, ranks));
  return { title: NIGHT.trackTitle, ariaLabel: NIGHT.trackAria, calls,
    breaks: calls.filter((c, i) => i > 0 && c.driveStart).length };
}

const LEGEND = Object.freeze(["top1", "top3", "miss"].map((key) => Object.freeze({ key, text: NIGHT.verdict[key] })));

/**
 * @param {object} pv  presented view
 * @returns {object} frozen {heading, empty, emptyText, tally: {id, label, value, ghost, of}[], recent: {label, items:
 *   {key, mark, text}[]}, track: {title, ariaLabel, breaks (drive changes), calls: {key, seq, verdict, cells,
 *   driveStart, quarter, surprise, text}[]}, legend: {key, text}[], legendNote}
 */
export function nightVm(pv) {
  const presented = pv && pv.presented;
  const calls = callerCalls(pv && pv.tl);
  const table = leafTable(pv);
  const facts = calls.map((row) => callFacts(row, table));
  const ranks = surpriseRanks(calls);
  return freezeDeep({
    heading: headingOf(presented),
    empty: facts.length === 0,
    emptyText: facts.length ? "" : NIGHT.empty,
    tally: facts.length ? tallyOf(presented && presented.metrics) : [],
    recent: recentOf(facts),
    track: trackOf(facts, ranks),
    legend: LEGEND,
    legendNote: NIGHT.legendNote,
  });
}
