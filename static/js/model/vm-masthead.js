// The top bar's nameplate (restructure-v2.md 2): the title, who it shadows ("Shadowing Schottenheimer · DAL") and
// the current game ("TB at DAL · Final"), where phase 2 puts the game picker. Nothing team-specific.
import { APP, MASTHEAD } from "./copy.js";
import { freezeDeep } from "./format.js";
import { gameOf } from "./vm-transport.js";
import { teamsOf } from "./vm-scoreboard.js";

const str = (v) => (typeof v === "string" ? v : "");
/** Name suffixes that are never the family name ("Frank Smith Jr." is Smith). */
const SUFFIX_RE = /^(jr|sr|ii|iii|iv|v)\.?$/i;

/**
 * v1.5 (G4-2): the play-caller's last name from the profile's full name ("Brian Schottenheimer" gives
 * "Schottenheimer"), so the plate and the board name the caller this app shadows. Nothing team-specific.
 * @param {unknown} caller
 * @returns {string} "" when there is no name
 */
export function lastNameOf(caller) {
  const words = str(caller).trim().split(/\s+/).filter(Boolean);
  const named = words.filter((w, i) => i === 0 || !SUFFIX_RE.test(w));
  return named.length ? named[named.length - 1] : "";
}

/** "TB at DAL", and ESPN's status for the game once the watch says it ("TB at DAL · Final"). */
function gameLabelOf(pv) {
  const [away, home] = teamsOf(pv).order;
  if (!away || !home) return "";
  const game = gameOf(pv);
  const detail = game ? str(game.detail) : "";
  return detail ? MASTHEAD.gameDetail(MASTHEAD.game(away, home), detail) : MASTHEAD.game(away, home);
}

/**
 * @param {object} pv  presented view
 * @returns {object} frozen {title, whoLabel, plateTitle, gameLabel, gameTitle}: whoLabel is the short line; plateTitle
 *   its tooltip, every word whole; gameTitle the game's whole label (ESPN's matchup, the broadcast and the date)
 */
export function mastheadVm(pv) {
  const p = pv && pv.presented;
  const profile = (p && p.profile) || null;
  const caller = profile ? str(profile.caller) : "";
  const team = profile ? str(profile.team) : "";
  const gameLabel = gameLabelOf(pv);
  return freezeDeep({
    title: APP.title,
    whoLabel: caller ? MASTHEAD.whoLabel(lastNameOf(caller), team) : "",
    plateTitle: caller ? MASTHEAD.whoTitle(caller, team) : "",
    gameLabel,
    gameTitle: str(p && p.game && p.game.label) || gameLabel,
  });
}
