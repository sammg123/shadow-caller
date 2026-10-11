// A logged call's own words (FI 3.9's "Actual"), for when the field has not drawn its row: the logged name (or a
// legacy call), then ", TD" and ", turnover". The play log itself moved to the Model Report's calls table
// (restructure-v2.md 6).
import { LOG } from "./copy.js";

/** The logged name (or a legacy call), then ", TD" and ", turnover". */
export function actualText(row) {
  const name = (typeof row.name === "string" && row.name) || LOG.legacyCall[row.call] || "";
  return `${name}${row.td ? ", TD" : ""}${row.turnover ? ", turnover" : ""}`;
}
