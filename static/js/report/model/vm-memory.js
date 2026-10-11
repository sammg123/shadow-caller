// The in-game memory effects that fired (pure; restructure-v2.md section 6): the snaps whose prediction carries a TILT
// flag (his pass chance 15 points or more from the league's, live.py) or memory_parts. Each shows what his habits
// (p_habits - p_league) and the in-game memory (p - p_habits) did to his pass chance, in points, the parts when the
// row has them, and whether a tilt came true; the summary is the scorecard's own count of tilts that came true.
import { freezeDeep, signed1 } from "../../model/format.js";
import { callFacts, callerCalls, leafTable } from "./calls.js";
import { MEMORY, REPORT } from "./copy.js";

const TILT_RE = /^TILT (PASS|RUN)$/;
const PTS = 100;
const finite = (x) => typeof x === "number" && Number.isFinite(x);
const partsOf = (pred) => (pred && Array.isArray(pred.memory_parts) ? pred.memory_parts.filter(Boolean) : []);

/** True when a prediction tilted (a TILT flag) or carries memory_parts. */
export function firedOn(pred) {
  if (!pred) return false;
  return TILT_RE.test(String(pred.flag || "")) || partsOf(pred).length > 0;
}

const points = (a, b) => (finite(a) && finite(b) ? signed1((a - b) * PTS) : "");
const ptsText = (x) => (x ? MEMORY.pts(x) : "");
const partOf = (part) => ({ term: String(part.term ?? ""), pts: finite(part.pts) ? signed1(part.pts) : "" });

function tiltOf(pred) {
  const m = TILT_RE.exec(String(pred.flag || ""));
  return m ? m[1].toLowerCase() : null;
}

function outcomeOf(tilt, side) {
  if (!tilt || !side) return null;
  return tilt === side ? "true" : "missed";
}

function memoryRow(row, table) {
  const pred = row.pred;
  const facts = callFacts(row, table);
  const tilt = tiltOf(pred);
  const side = pred.dropback === 1 ? "pass" : pred.dropback === 0 ? "run" : null;
  const outcome = outcomeOf(tilt, side);
  const habits = points(pred.p_habits, pred.p_league);
  const memory = points(pred.p, pred.p_habits);
  return {
    key: `memory:${row.seq}`, seq: row.seq, snap: facts.snap, time: facts.time, situation: facts.situation,
    when: REPORT.when(facts.snap, facts.time, facts.situation),
    flag: String(pred.flag || ""), flagText: tilt ? MEMORY.tilt[tilt] : "", tilt,
    habits, memory, habitsText: ptsText(habits), memoryText: ptsText(memory),
    parts: partsOf(pred).map(partOf),
    called: facts.called, calledSide: side, calledSideText: side ? MEMORY.side[side] : "", outcome,
    outcomeText: outcome ? MEMORY.outcome[outcome] : "",
  };
}

/** The scorecard's own count of tilts that came true, and the snap memory switches on after. */
function summaryOf(presented) {
  const m = presented && presented.metrics;
  const script = presented && presented.memory && presented.memory.script_plays;
  return [
    ...(m && m.tilt_n > 0 ? [{ id: "tilts", label: MEMORY.tilts, value: MEMORY.of(m.tilt_hits, m.tilt_n) }] : []),
    ...(Number.isInteger(script) ? [{ id: "script", label: "", value: MEMORY.script(script) }] : []),
  ];
}

/**
 * @param {object} pv  presented view
 * @returns {object} frozen {heading, sub, labels: {habits, memory, called}, empty, emptyText, summary: {id, label,
 *   value}[], rows: {key, seq, snap, time, situation, when, flag, flagText, tilt, habits, memory, habitsText,
 *   memoryText, parts: {term, pts}[], called, calledSide, calledSideText, outcome, outcomeText}[]}
 */
export function memoryVm(pv) {
  const calls = callerCalls(pv && pv.tl);
  const table = leafTable(pv);
  const rows = calls.filter((row) => firedOn(row.pred)).map((row) => memoryRow(row, table));
  const emptyText = rows.length ? "" : calls.length ? MEMORY.noTilts : MEMORY.empty;
  return freezeDeep({ heading: MEMORY.heading, sub: MEMORY.sub,
    labels: { habits: MEMORY.habits, memory: MEMORY.memory, called: MEMORY.called },
    empty: rows.length === 0, emptyText, summary: summaryOf(pv && pv.presented), rows });
}
