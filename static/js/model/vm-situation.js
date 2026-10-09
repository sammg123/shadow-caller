// Situation strip (FI 2.3, 3.4): the field values (core/strip.js decides what each shows), labels, the est. flag,
// drive info, the end-of-drive row, the strip note and any rejected text kept for its invalid style (FI 4.4).
import { stripValues } from "../core/strip.js";
import { STRIP } from "./copy.js";
import { freezeDeep } from "./format.js";
import { teamsOf } from "./vm-scoreboard.js";

const EMPTY = Object.freeze({ values: null, offLabel: "", oppLabel: "", clockEst: false,
  driveInfo: Object.freeze({ text: "", cue: false }), endRowHidden: true, note: STRIP.note,
  rejected: Object.freeze({}), scoreAria: Object.freeze({ off: "", opp: "" }) });

function driveInfo(presented) {
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
 *   scoreAria: {off, opp}}
 */
export function situationVm(pv) {
  const presented = pv && pv.presented;
  if (!presented || !presented.sit || !presented.game) return EMPTY;
  const view = (pv && pv.view) || {};
  return freezeDeep({
    values: stripValues(presented.sit, presented.game, view.sideAtFifty ?? null),
    offLabel: presented.game.offense,
    oppLabel: presented.game.opponent,
    clockEst: Boolean(presented.sit.clock_estimated),
    driveInfo: driveInfo(presented),
    endRowHidden: !presented.drive_active,
    note: STRIP.note,
    rejected: { ...(view.stripRejected || {}) },
    scoreAria: scoreAria(pv, presented.game),
  });
}
