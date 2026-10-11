// The card's history (restructure-v2.md section 3): PREVIOUS PLAY, his most recent call (the field's words for what
// he called and how it ended, the verdict with his rank and odds, and what the board predicted when that was not
// it), and LAST 6, his last six calls graded with his night so far. Folded in from the last-play panel (FI 3.6) and
// the board's recap face (v1.5, G4-1); both stay up all game, whoever has the ball, and are absent before his first
// snap. Nothing here is specific to one team or caller (G13).
import { familyOf, own } from "../core/domain.js";
import { playLabel } from "../field/play-label.js";
import { PREDICTION, SCORECARD } from "./copy.js";
import { pct } from "./format.js";
import { verdictOf, verdictText } from "./verdict.js";
import { verdictChipText } from "./vm-field.js";
import { actualText } from "./vm-log.js";

const RECENT_SNAPS = 6;                         // LAST 6
const SPOKEN_PAUSE = ", ";                      // the field's " · " is read as a pause, never as "dot"
const logOf = (p) => (Array.isArray(p && p.log) ? p.log.filter(Boolean) : []);
const spokenWords = (text) => text.split(" · ").join(SPOKEN_PAUSE).replace(/(\d)%/g, "$1 percent");

/** The drawn timeline row of a log row (its ESPN play id, or "log-<seq>" for a typed snap; DC B7), else null. */
function timelineRowOf(tl, logRow) {
  const rows = tl && Array.isArray(tl.rows) ? tl.rows : [];
  const id = logRow.espn_id ? String(logRow.espn_id) : `log-${logRow.seq}`;
  for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i] && rows[i].id === id) return rows[i];
  return null;
}

/** A touchdown or a turnover leads the play with the referee's signal (its words are in the label too). */
function leadOf(logRow, row) {
  const result = (row && row.result) || {};
  if (logRow.turnover || result.turnover) {
    const kind = result.turnover_kind === "int" ? "int" : result.turnover_kind === "fumble" ? "fumble" : "turnover";
    return { kind, text: PREDICTION.lead[kind] };
  }
  const td = Boolean(logRow.td) || Boolean(result.td) || Boolean(row && row.scoring && row.scoring.type === "TD");
  return td ? { kind: "td", text: PREDICTION.lead.td } : null;
}

/** What the board predicted for that snap when his call was something else (a top pick's verdict says it all). */
function predictedOf(logRow, leafNames, verdict) {
  const leaf = typeof logRow.top_leaf === "string" ? logRow.top_leaf : null;
  if (!leaf || verdict.key === "top1") return null;
  return { label: PREDICTION.predicted, leaf, name: own(leafNames, leaf) || leaf, pct: pct(logRow.top_leaf_p),
    family: familyOf(leaf) };
}

/** His snap number; a call a flag wiped out has none (the play log leaves its "#" empty too, G15). */
function snapOf(row) {
  const n = !row.nullified && Number.isInteger(row.snap) ? row.snap : null;
  return { n, text: n === null ? "" : PREDICTION.snap(n) };
}

/**
 * PREVIOUS PLAY: the tracked offense's last snap (a call a flag wiped out still counts as his call).
 * @param {object} pv  presented view
 * @returns {object | null} {plate, snap: {n, text}, seq, label, lead, verdict: {key, rank, text}, predicted, espn};
 *   null before his first snap (no placeholder)
 */
export function previousOf(pv) {
  const p = pv && pv.presented;
  const last = logOf(p)[0];
  if (!last) return null;
  const row = timelineRowOf(pv.tl, last);
  const v = verdictOf(last);
  return {
    plate: PREDICTION.previousPlate,
    snap: snapOf(last),
    seq: Number.isInteger(last.seq) ? last.seq : null,
    label: (row && playLabel(row)) || actualText(last),
    lead: leadOf(last, row),
    verdict: { key: v.key, rank: v.rank, text: verdictChipText(last, p.leaf_names) },
    predicted: predictedOf(last, p.leaf_names, v),
    espn: typeof last.feed_text === "string" ? last.feed_text : "",
  };
}

/** The previous play in words for the board's live region: "Previous play, snap 34: Short pass left, +11. Top pick,
 * 19 percent." Empty without one. */
export function previousSpoken(previous) {
  if (!previous) return "";
  const said = [`${PREDICTION.spokenPrevious(previous.snap.n)} ${spokenWords(previous.label)}.`];
  if (previous.verdict.text) said.push(`${spokenWords(previous.verdict.text)}.`);
  const guess = previous.predicted;
  if (guess) said.push(`${PREDICTION.spokenPredicted(guess.name, spokenWords(guess.pct))}.`);
  return said.join(" ");
}

/** One glyph's words: "Top pick", "In his top 3 (#2)", "Miss". */
const recentText = (v) => (v.key === "top3" && Number.isInteger(v.rank) ? PREDICTION.recentTop3(v.rank)
  : verdictText(v.key));

/** Top pick and in-his-top-3 counts, from the scorecard's own numbers (no league count exists, so none is shown). */
function tallyOf(metrics) {
  const g = (metrics && metrics.granular) || {};
  if (!(g.leaf_n > 0)) return [];
  return [{ id: "top1", label: PREDICTION.tallyTop1, value: SCORECARD.of(g.leaf_top1, g.leaf_n) },
    { id: "top3", label: PREDICTION.tallyTop3, value: SCORECARD.of(g.leaf_top3, g.leaf_n) }];
}

/** Why "Snap 55" sits beside "of 59": a call a flag wiped out is graded but gets no snap number, so once there is one
 * the tally says how its calls split ("59 calls: 55 snaps and 4 wiped out by flags"); "" while they agree. */
function callsNoteOf(p) {
  const g = (p && p.metrics && p.metrics.granular) || {};
  const wiped = logOf(p).filter((r) => r.nullified && Number.isInteger(r.leaf_rank)).length;
  return g.leaf_n > 0 && wiped > 0 ? PREDICTION.callsNote(g.leaf_n, g.leaf_n - wiped, wiped) : "";
}

/**
 * LAST 6: his last six graded calls, oldest first so the newest sits at the right end like the ribbon's newest
 * message (a check, his rank in his top 3, or an X), and his night so far as the recap said it.
 * @param {object} p  the presented state
 * @param {string} plate  the section's plate ("Schottenheimer so far")
 * @returns {object | null} {plate, label, items: {key, rank, text}[], aria, tally: {id, label, value}[], note}; null
 *   before his first graded snap
 */
export function recentOf(p, plate) {
  const items = logOf(p).map(verdictOf).filter((v) => v.key !== "none").slice(0, RECENT_SNAPS)
    .map((v) => ({ key: v.key, rank: v.rank, text: recentText(v) })).reverse();
  const tally = tallyOf(p && p.metrics);
  if (!items.length && !tally.length) return null;
  const label = PREDICTION.recentLabel;
  return { plate, label, items, aria: items.length ? `${label}: ${items.map((i) => i.text).join(", ")}` : "", tally,
    note: callsNoteOf(p) };
}
