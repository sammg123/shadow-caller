// Masthead (FI 3.1, #1): title, game label, who is modelled, camera mode (V), booth (B) and scorecard (G) toggles.
import { APP, MASTHEAD } from "./copy.js";
import { capitalize, freezeDeep } from "./format.js";

const str = (v) => (typeof v === "string" ? v : "");
/** Name suffixes that are never the family name ("Frank Smith Jr." is Smith). */
const SUFFIX_RE = /^(jr|sr|ii|iii|iv|v)\.?$/i;
const TITLE_SEP = " · ";

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

/** The camera's label from the engine's modes when the scheduler passes them (pv.cameraModes), else from its id. */
function cameraLabel(id, modes) {
  if (!id) return "";
  const mode = Array.isArray(modes) ? modes.find((m) => m && m.id === id) : null;
  return mode && typeof mode.label === "string" ? mode.label : capitalize(id);
}

/**
 * @param {object} pv  presented view; optional pv.cameraModes = engine.cameraModes()
 * @returns {object} frozen {title, gameLabel, whoLabel, plateTitle, cameraLabel, cameraMode, boothOpen, scorecardOpen}
 *   whoLabel is the short line ("Shadowing Schottenheimer · DAL"); plateTitle the plate's tooltip, every word whole
 */
export function mastheadVm(pv) {
  const p = pv && pv.presented;
  const profile = (p && p.profile) || null;
  const view = (pv && pv.view) || {};
  const camera = str(view.camera);
  const caller = profile ? str(profile.caller) : "";
  const team = profile ? str(profile.team) : "";
  const gameLabel = str(p && p.game && p.game.label);
  const whoTitle = caller ? MASTHEAD.whoTitle(caller, team) : "";
  return freezeDeep({
    title: APP.title,
    gameLabel,
    whoLabel: caller ? MASTHEAD.whoLabel(lastNameOf(caller), team) : "",
    plateTitle: [gameLabel, whoTitle].filter(Boolean).join(TITLE_SEP),
    cameraLabel: cameraLabel(camera, pv && pv.cameraModes),
    cameraMode: camera,
    boothOpen: Boolean(view.booth && view.booth.open),
    scorecardOpen: Boolean(view.scorecardOpen),
  });
}
