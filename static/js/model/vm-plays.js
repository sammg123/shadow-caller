// Play feed (DC B, C1): every drawn row, both teams, newest first and grouped by drive, with the result word, and the
// call and its verdict on caller snaps. Read only (restructure-v2.md 1): the top LED ticker shows the newest play.
import { LABEL_SEP, playLabel } from "../field/play-label.js";
import { PLAYS } from "./copy.js";
import { freezeDeep, qtrText, resultText } from "./format.js";
import { verdictOf, verdictText } from "./verdict.js";
import { driveResultText, driveSummary } from "./vm-drives.js";

// G5-10: the ribbon's face, one page (about 60 characters) in the field's own words: what the play was (the label the
// field draws, play-drawing.md 3, its yards left to the row's result word) and who had the ball, as ESPN names him.
// ESPN's whole text stays in the replay board's rows and the desk's LAST PLAY.
const NAME_RE = /\b[A-Z][A-Za-z]?\.[A-Z][A-Za-z'’-]+/;
const TARGET_RE = /\bto ([A-Z][A-Za-z]?\.[A-Z][A-Za-z'’-]+)/;
const PASS_RE = /\bpass\b/i;

/** The ball carrier, or a pass's target; null when ESPN names nobody (a pass with no target, a kick, a flag). */
function playerOf(text, what) {
  if (typeof text !== "string" || text === "") return null;
  if (PASS_RE.test(what)) return TARGET_RE.exec(text)?.[1] ?? null;
  return NAME_RE.exec(text)?.[0] ?? null;
}

/** The face: a scrimmage play's label without its yards (the row shows its result word) and the player; kicks, flags
 * and wiped-out plays keep the field's whole label. */
export function faceOf(row) {
  const label = playLabel(row);
  if (!label) return "";
  const parts = label.split(LABEL_SEP);
  const scrimmage = row.kind === "play" && !(row.result && row.result.nullified) && parts.length > 1;
  if (!scrimmage) return label;
  const what = parts.slice(0, -1).join(LABEL_SEP);
  const player = playerOf(row.text, what);
  return player ? `${what}${LABEL_SEP}${player}` : what;
}

function playRow(row) {
  const pred = row.pred || null;
  const verdict = verdictOf(pred).key;
  return {
    seq: row.seq,
    id: row.id,
    kind: row.kind,
    team: row.team,
    caller: Boolean(row.offense_is_caller),
    drive: row.drive,
    time: `${qtrText(row.qtr)} ${row.clock || ""}`.trim(),
    situation: row.pre && typeof row.pre.text === "string" ? row.pre.text : "",
    text: typeof row.text === "string" ? row.text : "",
    result: resultText(row),
    call: pred && typeof pred.name === "string" ? pred.name : "",
    verdict,
    verdictText: verdictText(verdict),
    nullified: Boolean(row.result && row.result.nullified),
    retagged: Boolean(pred && pred.retagged),
    scoring: Boolean(row.scoring),
    face: faceOf(row),
  };
}

function groupHead(drive, firstRow) {
  if (!drive) return { team: firstRow.team, caller: Boolean(firstRow.offense_is_caller), resultText: "", summary: "", complete: false };
  return { team: drive.team, caller: Boolean(drive.offense_is_caller), resultText: driveResultText(drive),
    summary: driveSummary(drive), complete: Boolean(drive.complete) };
}

/** Consecutive rows of one drive form a group (rows are newest first, so groups are too). */
function groupsOf(rows, drives) {
  const byIdx = new Map(drives.map((d) => [d.idx, d]));
  const starts = rows.map((row, i) => (i === 0 || rows[i - 1].drive !== row.drive ? i : -1)).filter((i) => i >= 0);
  return starts.map((start, k) => {
    const members = rows.slice(start, k + 1 < starts.length ? starts[k + 1] : rows.length);
    return { idx: members[0].drive, ...groupHead(byIdx.get(members[0].drive), members[0]), rows: members };
  });
}

/**
 * @param {object} pv  presented view
 * @returns {object} frozen {heading, rows: {seq, id, kind, team, caller, drive, time, situation, text, result, call,
 *   verdict, verdictText, nullified, retagged, scoring, face}[] (newest first), groups: {idx, team, caller, resultText,
 *   summary, complete, rows}[], unlinkedNote}
 */
export function playsVm(pv) {
  const tl = pv && pv.tl;
  const source = (tl && Array.isArray(tl.rows) ? tl.rows : []).filter((row) => row && Number.isInteger(row.seq));
  const rows = [...source].sort((a, b) => b.seq - a.seq).map(playRow);
  const unlinked = tl && Array.isArray(tl.unlinked) ? tl.unlinked.length : 0;
  return freezeDeep({
    heading: PLAYS.heading,
    rows,
    groups: groupsOf(rows, (tl && Array.isArray(tl.drives) ? tl.drives : []).filter(Boolean)),
    unlinkedNote: unlinked ? PLAYS.unlinked(unlinked) : "",
  });
}
