// Situation strip edit rules (ui-architecture.md 2.2, FI 2.3; gaps G1, G2, G3; owner A2). Pure.
import { own } from "./domain.js";

export const STRIP_FIELDS = Object.freeze(["iQtr", "iClock", "iOff", "iOpp", "iDown", "iTogo", "iYard"]);
/** Where a drive usually starts (a touchback): Ball on's placeholder while the offense is off the field (G5-3). */
export const NEW_DRIVE_YARD = 25;

const MIDFIELD = 50;
const FULL_FIELD = 100;
const BODY_KEY = Object.freeze({
  iQtr: "qtr", iClock: "clock", iOff: "score_off", iOpp: "score_opp", iDown: "down", iTogo: "togo",
});
const SIDE_SPOT_RE = /^([A-Za-z]+)\s*(\d+)$/;
const NUMBER_RE = /^\d+$/;
const NO_SAVE = Object.freeze({ body: null, restore: true });
const NO_PLACEHOLDERS = Object.freeze({});
const OFF_FIELD_PLACEHOLDERS = Object.freeze({ iYard: String(NEW_DRIVE_YARD) });

function ownSide(yardline100, sideAtFifty, game) {
  return yardline100 > MIDFIELD || (yardline100 === MIDFIELD && sideAtFifty !== game.opponent);
}

/**
 * What each strip field shows for the served situation; the 50 follows the remembered chip side (FI 5.5).
 * With no drive (G5-3) the served spot is the last snap's, not where the next drive starts: Ball on is blank with
 * the placeholder NEW_DRIVE_YARD and the chip sits on the offense's own side, so a bare number starts the drive there
 * ("25" is DAL 25 after a field goal from TB 5); a typed side ("T 30") or a chip click still picks the other side.
 * Without `driveActive` the strip shows the served spot, as during a drive.
 * @param {{ driveActive?: boolean }} [opts]
 */
export function stripValues(sit, game, sideAtFifty, { driveActive = true } = {}) {
  const yl = sit.yardline_100;
  const offField = driveActive === false;
  const own = offField || ownSide(yl, sideAtFifty, game);
  const team = own ? game.offense : game.opponent;
  return {
    iQtr: String(sit.qtr), iClock: String(sit.clock_str), iOff: String(sit.score_off), iOpp: String(sit.score_opp),
    iDown: String(sit.down), iTogo: sit.togo >= yl ? "G" : String(sit.togo),
    iYard: offField ? "" : String(own ? FULL_FIELD - yl : yl),
    side: { team, own, title: `Ball on ${team}'s ${own ? "own " : ""}side. Click to switch.` },
    placeholders: offField ? OFF_FIELD_PLACEHOLDERS : NO_PLACEHOLDERS,
  };
}

function spotBody(text, chipTeam) {
  const sided = SIDE_SPOT_RE.exec(text);
  if (sided) return { spot: `${sided[1].toUpperCase()} ${sided[2]}` };
  return { spot: `${chipTeam} ${text}` };
}

/**
 * What saving a strip field sends. Untouched or emptied fields send nothing and show the server value again (G1);
 * any typed text sends, even when it equals the shown value (G2); "D 25" or "d25" in Ball on is sent with its side (G3).
 */
export function commit(fieldId, raw, { edited, chipTeam }) {
  const text = String(raw ?? "").trim();
  if (!edited || text === "") return NO_SAVE;
  if (fieldId === "iYard") return { body: spotBody(text, chipTeam), restore: false };
  const key = own(BODY_KEY, fieldId);
  return key ? { body: { [key]: text }, restore: false } : NO_SAVE;
}

/**
 * Clicking the side chip: the same number on the other team's side; at the 50 the chosen side is remembered. An
 * empty box means the number shown: the served spot during a drive, the placeholder's NEW_DRIVE_YARD off the field.
 */
export function sideSwitch({ chipTeam, yardText, sit, game, driveActive = true }) {
  const other = chipTeam === game.offense ? game.opponent : game.offense;
  const typed = NUMBER_RE.test(String(yardText ?? "").trim()) ? Number.parseInt(yardText, 10) : 0;
  const yl = sit.yardline_100;
  const shown = driveActive === false ? NEW_DRIVE_YARD : (yl > MIDFIELD ? FULL_FIELD - yl : yl);
  const yard = typed || shown;
  return { body: { spot: `${other} ${yard}` }, sideAtFifty: yard === MIDFIELD ? other : null };
}
