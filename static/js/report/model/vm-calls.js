// Every call v the model (pure; restructure-v2.md section 6): a table of each of his snaps, oldest first, under a row
// for each of his drives (its result and summary in the drive chart's own words): number, quarter and clock,
// situation, the model's top 3 with their chances, what he called, its rank and the verdict.
import { DRIVES } from "../../model/copy.js";
import { freezeDeep } from "../../model/format.js";
import { driveResultText, driveSummary } from "../../model/vm-drives.js";
import { callFacts, callerCalls, leafTable } from "./calls.js";
import { CALLS } from "./copy.js";
import { namedPlate } from "./side.js";

/** The row over a drive of his, keyed by its first call (unique even where a drive has no number). */
function driveItem(row, drives) {
  const drive = drives.find((d) => d && d.idx === row.drive) || null;
  const team = (drive && drive.team) || row.team || "";
  const result = driveResultText(drive);
  return {
    kind: "drive", key: `drive-at:${row.seq}`, drive: row.drive,
    text: CALLS.drive(DRIVES.label(team, result), driveSummary(drive)), result: result || null,
  };
}

/** The table's items: a drive row each time his drive changes, then that drive's calls. */
function itemsOf(rows, table, drives) {
  return rows.flatMap((row, i) => [
    ...(i === 0 || row.drive !== rows[i - 1].drive ? [driveItem(row, drives)] : []),
    { kind: "call", key: `call:${row.seq}`, ...callFacts(row, table) },
  ]);
}

/**
 * @param {object} pv  presented view
 * @returns {object} frozen {heading, caption, columns, marks: {called, noPlay}, empty, emptyText, countText, items:
 *   ({kind: "drive", key, drive, text, result} | {kind: "call", key, ...callFacts})[]}
 */
export function callsVm(pv) {
  const rows = callerCalls(pv && pv.tl);
  const base = { heading: namedPlate(pv, CALLS.named, CALLS.heading), caption: CALLS.caption,
    columns: [...CALLS.columns], marks: { called: CALLS.calledMark, noPlay: CALLS.noPlay } };
  if (!rows.length) return freezeDeep({ ...base, empty: true, emptyText: CALLS.empty, countText: "", items: [] });
  const drives = Array.isArray(pv.tl.drives) ? pv.tl.drives : [];
  return freezeDeep({ ...base, empty: false, emptyText: "", countText: CALLS.count(rows.length),
    items: itemsOf(rows, leafTable(pv), drives) });
}
