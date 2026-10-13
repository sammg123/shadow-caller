// Where a cite or a drive button takes the reader on the Model Report (pure; docs/design/analyst-ui.md 3, 5 and 8;
// restructure-v2.md 11 decision 4). A play that is a tracked caller's call: its row in the calls table, after
// switching to his sections when both callers are tracked and the other one is shown. Any other play (an opponent's
// with one caller tracked, a kick, a flag with no snap): the drive it belongs to, on the drive chart, so a cite never
// goes nowhere while its play is in the game. A play the page hasn't drawn yet: nowhere.
import { sideToShow } from "./side.js";

/**
 * @param {object} pv  presented view, with sideChoice
 * @param {number} seq  the timeline's seq (a cite's, or a drive's first call)
 * @returns {{ seq: number, side: string | null, drive: number | null }} side: the caller to switch to first (null: no
 *   switch); drive: the drive chart's drive for the play when it has no row in the calls table
 */
export function citeTarget(pv, seq) {
  const rows = pv && pv.tl && Array.isArray(pv.tl.rows) ? pv.tl.rows : [];
  const row = Number.isInteger(seq) ? rows.find((r) => r && r.seq === seq) : null;
  return Object.freeze({
    seq,
    side: row ? sideToShow(pv, seq) : null,
    drive: row && Number.isInteger(row.drive) ? row.drive : null,
  });
}
