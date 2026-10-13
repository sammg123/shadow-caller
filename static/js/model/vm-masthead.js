// The top bar's nameplate (restructure-v2.md 2 and 11): the title, who it shadows ("Shadowing Schottenheimer · DAL";
// both callers when both sides are tracked) and the current game ("TB at DAL · Final"), which the game picker's key
// carries. Pure; nothing team-specific.
import { APP, MASTHEAD } from "./copy.js";
import { freezeDeep } from "./format.js";
import { gameOf } from "./vm-transport.js";
import { teamsOf } from "./vm-scoreboard.js";

const str = (v) => (typeof v === "string" ? v : "");
/** Name suffixes that are never the family name ("Frank Smith Jr." is Smith). */
const SUFFIX_RE = /^(jr|sr|ii|iii|iv|v)\.?$/i;
/** A track names at most two sides (game-picker.md 4); its label is the server's matchup, capped like a team name. */
const MAX_SIDES = 2;
const LABEL_MAX = 40;

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

const sideOf = (team, caller) => ({ team, caller: str(caller).trim(), last: lastNameOf(caller) });

/**
 * The tracked play-callers (restructure-v2.md 11): /api/state's `tracked` ([{team, caller, slug}], away then home),
 * each team once and at most two; without a usable one (an older server), the profile's caller and team. The plate's
 * reading of the same list model/sides.js reads for the card.
 * @param {object | null} p  the presented /api/state
 * @returns {{team: string, caller: string, last: string}[]}
 */
function callersOf(p) {
  const list = Array.isArray(p && p.tracked) ? p.tracked : [];
  const teams = new Set();
  const sides = [];
  for (const t of list) {
    const team = t && typeof t === "object" ? str(t.team) : "";
    if (!team || teams.has(team)) continue;
    teams.add(team);
    sides.push(sideOf(team, t.caller));
  }
  if (sides.length) return sides.slice(0, MAX_SIDES);
  const profile = (p && p.profile) || null;
  const caller = profile ? str(profile.caller) : "";
  return caller ? [sideOf(str(profile.team), caller)] : [];
}

/** The plate's line and its tooltip: one caller, both callers, or nothing before the first state. */
function whoOf(sides) {
  if (sides.length === MAX_SIDES) {
    return { label: MASTHEAD.whoBoth(sides[0], sides[1]), title: MASTHEAD.whoBothTitle(sides[0], sides[1]) };
  }
  const one = sides[0];
  if (!one || !one.caller) return { label: "", title: "" };
  return { label: MASTHEAD.whoLabel(one.last, one.team), title: MASTHEAD.whoTitle(one.caller, one.team) };
}

/** "TB at DAL" ("PHI vs JAX" when the game says it is at a neutral site): the timeline's teams, else the game's, else
 * the track's own label (a game the page just opened; the server says vs there too). */
function matchupOf(pv) {
  const [away, home] = teamsOf(pv).order;
  const game = pv && pv.presented && pv.presented.game;
  if (away && home) return MASTHEAD.game(away, home, Boolean(game) && game.neutral === true);
  const track = pv && pv.presented && pv.presented.track;
  return str(track && track.label).trim().slice(0, LABEL_MAX);
}

/** "TB at DAL", and ESPN's status for the game once the watch says it ("TB at DAL · Final"). */
function gameLabelOf(pv) {
  const matchup = matchupOf(pv);
  if (!matchup) return "";
  const game = gameOf(pv);
  const detail = game ? str(game.detail) : "";
  return detail ? MASTHEAD.gameDetail(matchup, detail) : matchup;
}

/**
 * @param {object} pv  presented view
 * @returns {object} frozen {title, whoLabel, plateTitle, sides, gameLabel, gameTitle}: whoLabel is the short line;
 *   plateTitle its tooltip, every word whole; sides how many callers it names (0 to 2); gameTitle the game's whole
 *   label (ESPN's matchup, the broadcast and the date)
 */
export function mastheadVm(pv) {
  const p = pv && pv.presented;
  const sides = callersOf(p);
  const who = whoOf(sides);
  const gameLabel = gameLabelOf(pv);
  return freezeDeep({
    title: APP.title,
    whoLabel: who.label,
    plateTitle: who.title,
    sides: sides.length,
    gameLabel,
    gameTitle: str(p && p.game && p.game.label) || gameLabel,
  });
}
