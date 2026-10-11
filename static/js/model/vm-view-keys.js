// The top bar's view keys (restructure-v2.md 2 and 4): the camera (V: Wide or Blimp) and the settings menu. Pure.
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
 * @returns {object} frozen {cameraLabel, cameraMode, settingsOpen}
 */
export function viewKeysVm(pv) {
  const view = (pv && pv.view) || {};
  const camera = str(view.camera);
  return freezeDeep({
    cameraLabel: cameraLabel(camera, pv && pv.cameraModes),
    cameraMode: camera,
    settingsOpen: Boolean(view.settingsOpen),
  });
}
