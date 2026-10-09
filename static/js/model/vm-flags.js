// Flag panel (FI 1.6, G25): defense and offense columns of coded fouls with their keys and summaries, Offsetting,
// the two Other buttons, and the note, recomputed from the current pick on every render (core/flags.js).
import { FLAG_ORDER, KEY_OF_CODE, flagLabel, flagNote, penaltySummary } from "../core/flags.js";
import { EMPTY_PICK } from "../core/selection.js";
import { FLAGS } from "./copy.js";
import { freezeDeep } from "./format.js";
import { inputMode } from "./vm-feed.js";

const CLOSED = Object.freeze({ hidden: true, buttonOn: false, headings: Object.freeze({ def: "", off: "" }),
  def: Object.freeze([]), off: Object.freeze([]), offset: null, otherD: "", otherO: "", otherSummary: "",
  autoFirst: "", title: FLAGS.title, close: FLAGS.close, hint: FLAGS.hint, note: "" });

function column(penalties, against) {
  return FLAG_ORDER.filter((code) => penalties[code] && penalties[code].against === against).map((code) => ({
    code, key: KEY_OF_CODE[code] || "", label: flagLabel(penalties[code]), summary: penaltySummary(penalties[code]),
  }));
}

/**
 * @param {object} pv  presented view
 * @returns {object} frozen {hidden, buttonOn, headings: {def, off}, def: {code, key, label, summary}[], off: [...],
 *   offset, otherD, otherO, otherSummary, autoFirst, title, close, hint, note}
 */
export function flagsVm(pv) {
  const presented = pv && pv.presented;
  if (!presented || !presented.game) return CLOSED;
  const view = (pv && pv.view) || {};
  const open = Boolean(view.flag && view.flag.open);
  const { offense: off, opponent: opp } = presented.game;
  const penalties = presented.penalties || {};
  return freezeDeep({
    hidden: !open || inputMode(pv) !== "manual",
    buttonOn: open,
    headings: { def: FLAGS.defHeading(opp), off: FLAGS.offHeading(off) },
    def: column(penalties, "def"),
    off: column(penalties, "off"),
    offset: { code: "OFFSET", key: KEY_OF_CODE.OFFSET || "", label: FLAGS.offsetLabel, summary: FLAGS.offsetSummary },
    otherD: FLAGS.otherD(opp),
    otherO: FLAGS.otherO(off),
    otherSummary: FLAGS.otherSummary,
    autoFirst: FLAGS.autoFirst,
    title: FLAGS.title,
    close: FLAGS.close,
    hint: FLAGS.hint,
    note: flagNote(view.pick || EMPTY_PICK, presented.keys, presented.family_names),
  });
}
