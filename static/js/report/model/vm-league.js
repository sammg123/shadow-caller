// SHADOW v LEAGUE on the Model Report (pure; restructure-v2.md section 6): every scorecard metric, the app's own
// scorecardVm always at full size (as the stat board showed it), under a plate naming the play-caller it scores, so
// a second tracked caller (a later phase) is a second board with his own name.
import { SCORECARD } from "../../model/copy.js";
import { freezeDeep } from "../../model/format.js";
import { lastNameOf } from "../../model/vm-masthead.js";
import { scorecardVm } from "../../model/vm-scorecard.js";
import { LEAGUE } from "./copy.js";

/**
 * @param {object} pv  presented view
 * @returns {object} frozen scorecardVm(pv) with expanded true and `plate` (the board's plate)
 */
export function leagueVm(pv) {
  const profile = pv && pv.presented && pv.presented.profile;
  const last = lastNameOf(profile && profile.caller);
  return freezeDeep({ ...scorecardVm(pv), expanded: true, plate: last ? LEAGUE.plate(last) : SCORECARD.heading });
}
