// Play feed (DC B, C1): every drawn row, both teams, newest first and grouped by drive, with the result word, the
// call and its verdict on caller snaps, and the retag keys on the row a retag would edit (G19).
import { PLAYS } from "./copy.js";
import { freezeDeep, qtrText, resultText } from "./format.js";
import { verdictOf, verdictText } from "./verdict.js";
import { driveResultText, driveSummary } from "./vm-drives.js";
import { retagButtons, retagTarget } from "./vm-last-play.js";

/** The timeline id of a log row: its ESPN play id, or "log-<seq>" for a typed snap (DC B7, D). */
function timelineIdOf(logRow) {
  if (!logRow) return null;
  return logRow.espn_id ? String(logRow.espn_id) : `log-${logRow.seq}`;
}

function playRow(row, retagId) {
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
    retag: pred && retagId !== null && row.id === retagId ? retagButtons(pred) : null,
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
 *   verdict, verdictText, nullified, retagged, scoring, retag}[] (newest first), groups: {idx, team, caller,
 *   resultText, summary, complete, rows}[], retagSeq, unlinkedNote}
 */
export function playsVm(pv) {
  const tl = pv && pv.tl;
  const source = (tl && Array.isArray(tl.rows) ? tl.rows : []).filter((row) => row && Number.isInteger(row.seq));
  const retagId = timelineIdOf(retagTarget(pv && pv.presented && pv.presented.log));
  const rows = [...source].sort((a, b) => b.seq - a.seq).map((row) => playRow(row, retagId));
  const retagRow = rows.find((row) => row.retag);
  const unlinked = tl && Array.isArray(tl.unlinked) ? tl.unlinked.length : 0;
  return freezeDeep({
    heading: PLAYS.heading,
    rows,
    groups: groupsOf(rows, (tl && Array.isArray(tl.drives) ? tl.drives : []).filter(Boolean)),
    retagSeq: retagRow ? retagRow.seq : null,
    unlinkedNote: unlinked ? PLAYS.unlinked(unlinked) : "",
  });
}
