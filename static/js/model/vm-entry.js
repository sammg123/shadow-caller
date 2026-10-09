// Entry pad (FI 3.6): mode, what is picked (core/selection.js resolves the chosen line, FI 1.5), lit keys,
// Log play, the hint. The pad shows only for manual entry; the feed and a watch hide it (#93).
import { EMPTY_PICK, OUTCOMES, canLog, chosenText } from "../core/selection.js";
import { ENTRY } from "./copy.js";
import { freezeDeep } from "./format.js";
import { inputMode } from "./vm-feed.js";

const PAD_KEYS = Object.freeze(["J", "K", "L", "P", "A", "N", "O"]);   // R has no button: it lights K
const HINTS = Object.freeze({ manual: ENTRY.hintManual, feed: ENTRY.hintFeed, watch: ENTRY.hintWatch });

/**
 * @param {object} pv  presented view
 * @returns {object} frozen {mode, manualHidden, dim, chosen: {text, placeholder, hint}, keysOn: {J..O}, outOn:
 *   {incomplete, sack, scramble}, logDisabled, hint, flagOpen}   flagOpen: v1.2 (A7), #flagBtn.on / aria-expanded
 */
export function entryVm(pv) {
  const presented = (pv && pv.presented) || null;
  const pick = (pv && pv.view && pv.view.pick) || EMPTY_PICK;
  const keys = (presented && presented.keys) || null;
  const active = Boolean(presented && presented.drive_active);
  const mode = inputMode(pv);
  const lit = pick.k === "R" ? "K" : pick.k;
  return freezeDeep({
    mode,
    manualHidden: mode !== "manual",
    dim: mode === "manual" && !active,
    chosen: { ...chosenText(pick, keys, presented && presented.family_names) },
    keysOn: Object.fromEntries(PAD_KEYS.map((key) => [key, key === lit])),
    outOn: Object.fromEntries(OUTCOMES.map((out) => [out, pick.out === out])),
    logDisabled: !canLog(pick, keys, active),
    hint: HINTS[mode],
    flagOpen: Boolean(pv && pv.view && pv.view.flag && pv.view.flag.open),
  });
}
