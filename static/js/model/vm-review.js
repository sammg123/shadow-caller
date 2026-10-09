// Review banner (Left/Right, ui-architecture 2.2): which past play the field is showing, and the way back.
import { REVIEW } from "./copy.js";
import { freezeDeep, qtrText } from "./format.js";

const OFF = Object.freeze({ active: false, seq: null, text: "" });

function describe(row) {
  const pre = row.pre && typeof row.pre.text === "string" ? row.pre.text : "";
  const what = pre || (row.kind === "kickoff" ? REVIEW.kickoff : row.kind);
  return REVIEW.text(row.team, `${qtrText(row.qtr)} ${row.clock}`, what);
}

/**
 * @param {object} pv  presented view
 * @returns {object} frozen {active, seq, text}
 */
export function reviewVm(pv) {
  const seq = pv && pv.view && pv.view.review ? pv.view.review.seq : null;
  if (!Number.isInteger(seq)) return OFF;
  const rows = (pv.tl && pv.tl.rows) || [];
  const row = rows.find((r) => r.seq === seq);
  return freezeDeep({ active: true, seq, text: row ? describe(row) : REVIEW.unknown(seq) });
}
