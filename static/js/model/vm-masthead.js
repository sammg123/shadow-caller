// Masthead (FI 3.1, #1): title, game label, who is modelled, camera mode (V), booth (B) and scorecard (G) toggles.
import { APP, MASTHEAD } from "./copy.js";
import { capitalize, freezeDeep } from "./format.js";

const str = (v) => (typeof v === "string" ? v : "");

/** The camera's label from the engine's modes when the scheduler passes them (pv.cameraModes), else from its id. */
function cameraLabel(id, modes) {
  if (!id) return "";
  const mode = Array.isArray(modes) ? modes.find((m) => m && m.id === id) : null;
  return mode && typeof mode.label === "string" ? mode.label : capitalize(id);
}

/**
 * @param {object} pv  presented view; optional pv.cameraModes = engine.cameraModes()
 * @returns {object} frozen {title, gameLabel, whoLabel, cameraLabel, cameraMode, boothOpen, scorecardOpen}
 */
export function mastheadVm(pv) {
  const p = pv && pv.presented;
  const profile = (p && p.profile) || null;
  const view = (pv && pv.view) || {};
  const camera = str(view.camera);
  return freezeDeep({
    title: APP.title,
    gameLabel: str(p && p.game && p.game.label),
    whoLabel: profile && profile.caller ? MASTHEAD.whoLabel(profile.caller, profile.team) : "",
    cameraLabel: cameraLabel(camera, pv && pv.cameraModes),
    cameraMode: camera,
    boothOpen: Boolean(view.booth && view.booth.open),
    scorecardOpen: Boolean(view.scorecardOpen),
  });
}
