// Replay scrub (ui/scrub.js; owner W5; ui-architecture.md v1.4, section 19). Pure.
// The game so far as one strip of slots, one per timeline row in arrival order (seq). During a watch the strip runs to
// the session's total, so the part not yet played stays unlit: that count is already on the transport, and no row past
// the field is ever read (DC E5). Drawn drives are seq ranges in their team's tone; scores, turnovers and the start of
// each quarter are marks; the knob is the reviewed play, or the live edge. Steps and pointer positions resolve to
// plays the field can draw (core/review.js drawableSeqs: admin rows draw nothing) and, past the newest one, to live
// (null). Review only: the scrub moves the client's review cursor (actions.reviewAt) and never the server's game.
import { playLabel } from "../field/play-label.js";
import { SCRUB, WATCH } from "./copy.js";
import { freezeDeep, qtrText } from "./format.js";
import { isWatchSession, watchOf } from "./vm-transport.js";

const FRACTION_DP = 5;
const HALF_SLOT = 0.5;
const SEP = " · ";
const SPOKEN_SEP = ", ";
const MARK_ORDER = Object.freeze({ quarter: 0, score: 1, turnover: 2 });
/** Rows are frozen and kept by identity, so each play's words are worked out once. */
const words = new WeakMap();

const EMPTY_READOUT = Object.freeze({ state: "empty", word: "", title: "", head: "", label: SCRUB.none,
  text: SCRUB.none });
const OFF = freezeDeep({
  available: false, empty: true, session: false, total: 1, lastSeq: 0, liveSeq: null, reviewSeq: null,
  reviewing: false, knobSeq: null, knobAt: 0, headAt: 0, plays: [], drives: [], marks: [],
  readout: EMPTY_READOUT, value: { now: 0, max: 0, text: SCRUB.none }, canEarlier: false, canLive: false,
});

const fraction = (n, total) => Number((n / total).toFixed(FRACTION_DP));
const isRow = (row) => Boolean(row) && typeof row === "object" && Number.isInteger(row.seq);
const isPlay = (row) => isRow(row) && row.kind !== "admin";
const str = (v) => (typeof v === "string" ? v : "");

/** A play's words in two parts: `head` "Q2 8:41 · DAL" (when, whose play) and `label` "Deep pass left · +21" (what it
 * was and how it ended, as the field labels it: field/play-label.js, play-drawing.md 3), and both joined (`text`). */
function partsOf(row) {
  const known = words.get(row);
  if (known) return known;
  const head = SCRUB.play(`${qtrText(row.qtr)} ${str(row.clock)}`.trim(), str(row.team), "");
  const label = playLabel(row);
  const parts = Object.freeze({ head, label, text: SCRUB.play(head, "", label) });
  words.set(row, parts);
  return parts;
}

/**
 * "Q2 8:41 · DAL · Deep pass left · +21": when, whose play, then the play's own words as the field labels it.
 * "" for an admin row or anything that is not a row.
 * @param {object} row  a timeline row (DC B3)
 * @returns {string}
 */
export function describePlay(row) {
  return isPlay(row) ? partsOf(row).text : "";
}

/** The caller's abbreviation: the team marked caller, else the offense of any caller snap. */
function callerOf(tl, rows) {
  const teams = tl && tl.teams && typeof tl.teams === "object" ? Object.values(tl.teams) : [];
  const marked = teams.find((t) => t && t.caller === true && typeof t.abbr === "string");
  if (marked) return marked.abbr;
  const snap = rows.find((row) => row.offense_is_caller === true);
  return snap ? str(snap.team) : "";
}

const driveOf = (row) => (Number.isInteger(row.drive) ? row.drive : null);

/** Consecutive rows of one drive, as a seq range in that drive's team's tone. */
function drivesOf(rows, tl, callerAbbr, total) {
  const info = new Map((Array.isArray(tl.drives) ? tl.drives : []).filter((d) => d && Number.isInteger(d.idx))
    .map((d) => [d.idx, d]));
  const starts = rows.map((row, i) => i).filter((i) => i === 0 || driveOf(rows[i]) !== driveOf(rows[i - 1]));
  const runs = starts.map((i, k) => ({ idx: driveOf(rows[i]), first: rows[i].seq,
    last: rows[(starts[k + 1] ?? rows.length) - 1].seq, row: rows[i] }));
  return runs.map(({ idx, first, last, row }) => {
    const drive = info.get(idx);
    const team = str(drive && drive.team) || str(row.team);
    const caller = drive && typeof drive.offense_is_caller === "boolean" ? drive.offense_is_caller
      : team === callerAbbr;
    return { idx, team, caller, first, last, from: fraction(first - 1, total), to: fraction(last, total) };
  });
}

/** Who lost the ball: a punt's receiver muffs it; everyone else is the team on the row (as vm-wp.js reads it). */
const loserOf = (row) => (row.kind === "punt" ? str(row.opp) : str(row.team));

function marksOf(rows, caller, total) {
  const mark = (kind, row, team, text = "") => ({ key: `${kind}-${row.seq}`, kind, seq: row.seq, team,
    caller: Boolean(team) && team === caller, at: fraction(row.seq - HALF_SLOT, total), text });
  const timed = rows.filter((row) => Number.isInteger(row.qtr));
  const quarters = timed.filter((row, i) => i > 0 && row.qtr !== timed[i - 1].qtr)
    .map((row) => mark("quarter", row, "", qtrText(row.qtr)));
  const scores = rows.filter((row) => row.scoring && typeof row.scoring === "object")
    .map((row) => mark("score", row, str(row.scoring.team)));
  const turnovers = rows.filter((row) => row.result && row.result.turnover === true)
    .map((row) => mark("turnover", row, loserOf(row)));
  return [...quarters, ...scores, ...turnovers].sort((a, b) => a.seq - b.seq || MARK_ORDER[a.kind] - MARK_ORDER[b.kind]);
}

/** The knob: the reviewed play (the play at or before the review cursor), else the live edge. */
function knobOf(pv, plays) {
  const seq = pv && pv.view && pv.view.review ? pv.view.review.seq : null;
  const live = plays.length ? plays[plays.length - 1].seq : null;
  if (!Number.isInteger(seq)) return { reviewing: false, reviewSeq: null, knobSeq: live };
  const before = plays.filter((p) => p.seq <= seq);
  const knobSeq = before.length ? before[before.length - 1].seq : (plays[0] ? plays[0].seq : null);
  return { reviewing: true, reviewSeq: seq, knobSeq };
}

/** What the board says: the knob's play, and during a watch the mode's name (shown when there is nothing else). */
function readoutOf(knob, plays, title) {
  if (!plays.length || knob.knobSeq === null) return { ...EMPTY_READOUT, title };
  const play = plays.find((p) => p.seq === knob.knobSeq);
  const state = knob.reviewing ? "review" : "live";
  return { state, word: state === "review" ? SCRUB.review : SCRUB.live, title, head: play ? play.head : "",
    label: play ? play.label : "", text: play ? play.text : "" };
}

function valueOf(readout, knob, plays) {
  if (readout.state === "empty") return { now: 0, max: 0, text: SCRUB.none };
  const now = plays.findIndex((p) => p.seq === knob.knobSeq) + 1;
  return { now, max: plays.length, text: `${readout.word}: ${readout.text.replaceAll(SEP, SPOKEN_SEP)}` };
}

/**
 * @param {object} pv  presented view (ui-architecture 2.3): tl (rows drawn so far, drives, teams), version and
 *   presented (the watch), view.review
 * @returns {object} frozen {available, empty, session, total, lastSeq, liveSeq, reviewSeq, reviewing, knobSeq,
 *   knobAt, headAt, plays: {seq, drive, head, label, text}[], drives: {idx, team, caller, first, last, from, to}[],
 *   marks: {key, kind: "quarter"|"score"|"turnover", seq, team, caller, at, text}[],
 *   readout: {state: "live"|"review"|"empty", word, title, head, label, text}, value: {now, max, text}, canEarlier,
 *   canLive}
 *   Fractions (from, to, at, knobAt, headAt) are of the strip's width, 0 to 1.
 */
export function scrubVm(pv) {
  const tl = pv && pv.tl && typeof pv.tl === "object" ? pv.tl : null;
  const rows = (tl && Array.isArray(tl.rows) ? tl.rows : []).filter(isRow);
  const watch = watchOf(pv);
  const session = Boolean(watch) && isWatchSession(watch.state);
  if (!tl || (!rows.length && !session)) return OFF;
  const lastSeq = rows.reduce((m, row) => Math.max(m, row.seq), 0);
  const total = Math.max(1, lastSeq, session && Number.isInteger(watch.total) ? watch.total : 0);
  const caller = callerOf(tl, rows);
  const plays = rows.filter(isPlay).map((row) => ({ seq: row.seq, drive: driveOf(row), ...partsOf(row) }));
  const knob = knobOf(pv, plays);
  const headAt = fraction(lastSeq, total);
  const readout = readoutOf(knob, plays, session ? WATCH.start : "");
  return freezeDeep({
    available: true, empty: plays.length === 0, session, total, lastSeq,
    liveSeq: plays.length ? plays[plays.length - 1].seq : null, ...knob,
    knobAt: knob.reviewing && knob.knobSeq !== null ? fraction(knob.knobSeq - HALF_SLOT, total) : headAt, headAt,
    plays, drives: drivesOf(rows, tl, caller, total), marks: marksOf(rows, caller, total),
    readout, value: valueOf(readout, knob, plays),
    canEarlier: plays.length > 0 && (!knob.reviewing || knob.knobSeq > plays[0].seq),
    canLive: knob.reviewing,
  });
}

// ---------------------------------------------------------------- moving the knob (pure; ui/scrub.js calls these)
/** The play nearest a slot: the one at or before it wins a tie. */
function nearestPlay(plays, slot) {
  let before = null;
  for (const p of plays) {
    if (p.seq === slot) return p.seq;
    if (p.seq > slot) return before !== null && slot - before <= p.seq - slot ? before : p.seq;
    before = p.seq;
  }
  return before;
}

/**
 * The play under a point of the strip, `f` of its width from the left: the nearest drawable play to that slot.
 * Past the newest drawn row (the part of a watched game not played yet) it is live: null. Also null with no plays.
 * @returns {number | null}
 */
export function seqAtFraction(vm, f) {
  const plays = (vm && vm.plays) || [];
  if (!plays.length || !Number.isFinite(f)) return null;
  const slot = Math.min(vm.total, Math.max(1, Math.ceil(f * vm.total)));
  return slot > vm.lastSeq ? null : nearestPlay(plays, slot);
}

/** The first play of each drive, in order (a play whose drive differs from the play before it). */
function driveStarts(plays) {
  return plays.filter((p, i) => i === 0 || p.drive !== plays[i - 1].drive).map((p) => p.seq);
}

function driveStep(vm, plays, delta) {
  const starts = driveStarts(plays);
  if (!vm.reviewing) return delta < 0 ? starts[starts.length - 1] : null;
  const k = vm.knobSeq;
  if (delta > 0) return starts.find((s) => s > k) ?? null;
  const upTo = starts.filter((s) => s <= k);
  const own = upTo[upTo.length - 1] ?? starts[0];
  return own < k || upTo.length < 2 ? own : upTo[upTo.length - 2];
}

/**
 * Where one press takes the knob: -1 an earlier play (from live, the newest play, like Left), +1 a later one (past
 * the newest, live: null; from live it stays live, so the scrub never steps the server), -Infinity the first play,
 * +Infinity live. `byDrive`: the start of this drive or the one before (-1), the next drive's start or live (+1).
 * @returns {number | null}  the play to review, or null for live
 */
export function stepFrom(vm, delta, { byDrive = false } = {}) {
  const plays = (vm && vm.plays) || [];
  if (!plays.length || delta === Infinity) return null;
  if (delta === -Infinity) return plays[0].seq;
  if (!delta) return vm.reviewing ? vm.knobSeq : null;
  if (byDrive) return driveStep(vm, plays, delta);
  if (!vm.reviewing) return delta < 0 ? vm.liveSeq : null;
  const i = plays.findIndex((p) => p.seq === vm.knobSeq);
  if (delta < 0) return plays[Math.max(0, i - 1)].seq;
  return i + 1 < plays.length ? plays[i + 1].seq : null;
}
