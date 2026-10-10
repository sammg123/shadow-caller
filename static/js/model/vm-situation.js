// Situation strip (FI 2.3, 3.4): the field values (core/strip.js decides what each shows), labels, the est. flag,
// drive info, the end-of-drive row, the strip note and any rejected text kept for its invalid style (FI 4.4).
import { STRIP_FIELDS, stripValues } from "../core/strip.js";
import { STRIP } from "./copy.js";
import { freezeDeep } from "./format.js";
import { inputMode } from "./vm-feed.js";
import { isFinal, teamsOf } from "./vm-scoreboard.js";

const EMPTY = Object.freeze({ values: null, offLabel: "", oppLabel: "", clockEst: false,
  driveInfo: Object.freeze({ text: "", cue: false }), endRowHidden: true, note: STRIP.note,
  rejected: Object.freeze({}), scoreAria: Object.freeze({ off: "", opp: "" }), error: null, readOnly: false });
/** G5-13: the line beside the strip names a refused value with a word, not by its red frame alone. */
const STRIP_ERROR = Object.freeze({ tag: "Invalid", unsent: (label) => `${label} wasn't saved.` });

/** The first refused field in the strip's order, with the server's words for it (or that it wasn't saved). */
function errorOf(view, game) {
  const rejected = view.stripRejected || {};
  const field = STRIP_FIELDS.find((id) => Object.hasOwn(rejected, id));
  if (!field) return null;
  const said = (view.stripErrors || {})[field];
  if (typeof said === "string" && said !== "") return { field, tag: STRIP_ERROR.tag, text: said };
  const labels = { iQtr: STRIP.qtr, iClock: STRIP.clock, iOff: STRIP.scoreAria(game.offense),
    iOpp: STRIP.scoreAria(game.opponent), iDown: STRIP.down, iTogo: STRIP.togo, iYard: STRIP.ballOn };
  return { field, tag: STRIP_ERROR.tag, text: STRIP_ERROR.unsent(labels[field]) };
}

function driveInfo(pv, presented) {
  // v1.5 (G4-1): once ESPN's game is over there is no next spot to type
  if (!presented.drive_active && isFinal(pv)) return { text: STRIP.final, cue: false };
  if (!presented.drive_active) return { text: STRIP.offField(presented.game.offense), cue: true };
  const snapN = presented.memory && Number.isInteger(presented.memory.snap_n) ? presented.memory.snap_n : 0;
  return { text: STRIP.driveInfo(presented.drive_n, snapN + 1), cue: false };
}

/** Score fields are named by team location when ESPN gives it, else by abbreviation (G13). */
function scoreAria(pv, game) {
  const known = teamsOf(pv).byAbbr;
  const name = (abbr) => (known[abbr] && known[abbr].location) || abbr;
  return { off: STRIP.scoreAria(name(game.offense)), opp: STRIP.scoreAria(name(game.opponent)) };
}

/**
 * @param {object} pv  presented view
 * @returns {object} frozen {values, offLabel, oppLabel, clockEst, driveInfo: {text, cue}, endRowHidden, note, rejected,
 *   scoreAria: {off, opp}, error: {field, tag, text} | null, readOnly}
 */
export function situationVm(pv) {
  const presented = pv && pv.presented;
  if (!presented || !presented.sit || !presented.game) return EMPTY;
  const view = (pv && pv.view) || {};
  const readOnly = inputMode(pv) === "watch";   // G5-16: a watched game's situation is ESPN's, not typed
  return freezeDeep({
    values: stripValues(presented.sit, presented.game, view.sideAtFifty ?? null,
      { driveActive: Boolean(presented.drive_active) }),
    offLabel: presented.game.offense,
    oppLabel: presented.game.opponent,
    clockEst: Boolean(presented.sit.clock_estimated),
    driveInfo: driveInfo(pv, presented),
    endRowHidden: readOnly || !presented.drive_active,
    note: STRIP.note,
    rejected: { ...(view.stripRejected || {}) },
    scoreAria: scoreAria(pv, presented.game),
    error: errorOf(view, presented.game),
    readOnly,
  });
}
