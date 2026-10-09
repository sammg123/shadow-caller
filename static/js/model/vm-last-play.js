// Last-play panel (FI 3.6): the row a retag will edit (newest standing row of any source, G19), with its retag keys.
// Shown with the feed on and during a watch; hidden while plays are entered by hand.
import { LAST_PLAY } from "./copy.js";
import { freezeDeep } from "./format.js";
import { inputMode } from "./vm-feed.js";
import { actualText } from "./vm-log.js";

const HIDDEN = Object.freeze({ hidden: true, kind: "waiting", heading: "", name: "", yardsText: "", text: "",
  buttons: Object.freeze([]), seq: null });

/**
 * The retag keys for a logged pass or run: pass A N O P, run O J K L. The key matching the row's family is
 * current; J, K and L never are (FI 3.6). Works on a log row or a timeline row's pred.
 * @param {{dropback: number, family: string|null}|null} row
 * @returns {{key: string, label: string, tone: "pass"|"run"|"rpo", current: boolean}[]}
 */
export function retagButtons(row) {
  if (!row) return [];
  const pass = row.dropback === 1 || row.dropback === true;
  return (pass ? LAST_PLAY.pass : LAST_PLAY.run).map(([key, label, family]) => ({
    key,
    label,
    tone: pass ? "pass" : key === "O" ? "rpo" : "run",
    current: Boolean(family) && row.family === family,
  }));
}

/** The log row POST /api/retag edits: the newest row that was not wiped out by a flag (FI 2.8). */
export function retagTarget(log) {
  return (Array.isArray(log) ? log : []).find((row) => row && !row.nullified) || null;
}

function yardsText(row) {
  if (typeof row.yards !== "number" || !Number.isFinite(row.yards)) return "";
  return LAST_PLAY.yards(row.yards) + (row.retagged ? LAST_PLAY.retagged : "");
}

/**
 * @param {object} pv  presented view
 * @returns {object} frozen {hidden, kind: "waiting"|"play", heading, name, yardsText, text, buttons[], seq}
 */
export function lastPlayVm(pv) {
  const presented = pv && pv.presented;
  if (!presented || inputMode(pv) === "manual") return HIDDEN;
  const row = retagTarget(presented.log);
  const off = (presented.game && presented.game.offense) || "";
  if (!row) {
    return freezeDeep({ hidden: false, kind: "waiting", heading: LAST_PLAY.waiting(off), name: "", yardsText: "",
      text: LAST_PLAY.waitingText, buttons: [], seq: null });
  }
  return freezeDeep({
    hidden: false,
    kind: "play",
    heading: row.source === "espn" ? LAST_PLAY.fromEspn : LAST_PLAY.byHand,
    name: actualText(row),
    yardsText: yardsText(row),
    text: typeof row.feed_text === "string" ? row.feed_text : "",
    buttons: retagButtons(row),
    seq: row.seq,
  });
}
