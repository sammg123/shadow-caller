// Drive chart (DC C3): one segment per drive on the 0-100 field scale, in the drive team's direction, with
// ESPN's result. A drive in progress ends at its last drawn row's next spot.
import { DRIVES } from "./copy.js";
import { freezeDeep } from "./format.js";

/** Result codes shown as ESPN sends them (DC C3); anything else falls back to ESPN's own words. */
export const KNOWN_RESULTS = Object.freeze(["TD", "FG", "PUNT", "INT", "FUMBLE", "DOWNS", "END OF HALF",
  "END OF GAME", "MISSED FG", "SAFETY", "TURNOVER"]);
const FIELD_MIN = 0;
const FIELD_MAX = 100;
const finite = (x) => typeof x === "number" && Number.isFinite(x);
const clampX = (x) => (finite(x) ? Math.max(FIELD_MIN, Math.min(FIELD_MAX, x)) : null);

/** "TD", "PUNT", ...; "" while the drive is still going. */
export function driveResultText(drive) {
  if (!drive || !drive.complete) return "";
  if (KNOWN_RESULTS.includes(drive.result)) return drive.result;
  if (typeof drive.result_text === "string" && drive.result_text) return drive.result_text;
  return typeof drive.result === "string" ? drive.result : "";
}

/** "9 plays, 70 yds, 4:09"; parts the server doesn't know yet are left out. */
export function driveSummary(drive) {
  if (!drive) return "";
  return [
    Number.isInteger(drive.plays) ? DRIVES.plays(drive.plays) : "",
    finite(drive.yards) ? DRIVES.yards(drive.yards) : "",
    typeof drive.time === "string" ? drive.time : "",
  ].filter(Boolean).join(", ");
}

function lastNextX(rows, idx) {
  const own = rows.filter((row) => row.drive === idx && row.geo && finite(row.geo.x_next));
  return own.length ? own[own.length - 1].geo.x_next : null;
}

function endX(drive, rows, dir, x0) {
  if (drive.complete) return clampX(drive.end && drive.end.x) ?? x0;
  const next = lastNextX(rows, drive.idx);
  if (next !== null) return clampX(next);
  return finite(drive.yards) && x0 !== null ? clampX(x0 + dir * drive.yards) : x0;
}

/** The covered stretch, low to high; null ends when neither spot is known (Math.min(null, null) would say 0). */
function spanOf(x0, x1) {
  const known = [x0, x1].filter(finite);
  return known.length ? { lo: Math.min(...known), hi: Math.max(...known) } : { lo: null, hi: null };
}

function driveEntry(drive, rows) {
  const caller = Boolean(drive.offense_is_caller);
  const dir = caller ? 1 : -1;                  // DC A3: the caller attacks +x, everyone else -x
  const x0 = clampX(drive.start && drive.start.x);
  const x1 = endX(drive, rows, dir, x0);
  const resultText = driveResultText(drive);
  return {
    idx: drive.idx, team: drive.team, caller, dir, x0, x1,
    span: spanOf(x0, x1),
    result: typeof drive.result === "string" ? drive.result : null,
    resultText, complete: Boolean(drive.complete), current: !drive.complete,
    plays: Number.isInteger(drive.plays) ? drive.plays : null,
    yards: finite(drive.yards) ? drive.yards : null,
    time: typeof drive.time === "string" ? drive.time : null,
    summary: driveSummary(drive),
    label: DRIVES.label(drive.team, resultText),
  };
}

/**
 * @param {object} pv  presented view
 * @returns {object} frozen {heading, drives: {idx, team, caller, dir, x0, x1, span: {lo, hi}, result, resultText,
 *   complete, current, plays, yards, time, summary, label}[]}
 */
export function drivesVm(pv) {
  const tl = pv && pv.tl;
  const drives = (tl && Array.isArray(tl.drives) ? tl.drives : []).filter((d) => d && Number.isInteger(d.idx));
  const rows = (tl && tl.rows) || [];
  return freezeDeep({ heading: DRIVES.heading, drives: drives.map((drive) => driveEntry(drive, rows)) });
}
