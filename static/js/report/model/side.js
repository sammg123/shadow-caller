// The Model Report with both sides tracked (pure; restructure-v2.md 11 decision 4): a switch between the two callers'
// sections (his night so far, scorecard, hit rate, surprises, tendencies, in-game memory, every call) while the win
// probability, the drives and the team stats stay the game's. The viewer's pick rides on pv.sideChoice (the
// scheduler's extras, report/main.js); until he picks, the first caller the server names. His boards read sidePv(pv):
// his slice of the state (model/sides.js: his calls, his scorecard, his profile, his memory) and the timeline with the
// other caller's calls left out, plus `side` for the plates that name him (namedPlate). sideToShow says whose sections
// a cite or a drive button needs (report/model/cite.js). With one caller there is no switch and every board reads the
// state as it is, exactly as before.
import { freezeDeep } from "../../model/format.js";
import { sideSlice, trackedSides } from "../../model/sides.js";
import { SIDES } from "./copy.js";

const NO_SWITCH = freezeDeep({ shown: false, label: "", group: "", keys: [] });

/**
 * The caller whose sections the report shows: the viewer's pick when it is a tracked side, else the first one.
 * @param {object} pv  presented view, with sideChoice (a team, or null before any pick)
 * @returns {{team: string, caller: string, last: string, slug: string | null} | null} null with one caller
 */
export function shownSide(pv) {
  const sides = trackedSides(pv && pv.presented);
  if (sides.length < 2) return null;
  return sides.find((s) => s.team === pv.sideChoice) ?? sides[0];
}

const timelines = new WeakMap();

/** The timeline with only `team`'s calls among the caller rows (the rest of the game stays as it is). */
function sideTimeline(tl, team) {
  if (!tl || !Array.isArray(tl.rows)) return tl;
  const memo = timelines.get(tl) ?? new Map();
  if (!memo.has(team)) {
    memo.set(team, Object.freeze({ ...tl, rows: Object.freeze(tl.rows.filter((r) => !r || !r.offense_is_caller
      || r.team === team)) }));
    timelines.set(tl, memo);
  }
  return memo.get(team);
}

const views = new WeakMap();

/**
 * The view his boards read: his slice of the state, his calls on the timeline, and `side` (the shown caller). One
 * caller: pv itself.
 * @param {object} pv  presented view
 * @returns {object} the same object for the same pv
 */
export function sidePv(pv) {
  const side = shownSide(pv);
  if (!side) return pv;
  if (!views.has(pv)) {
    views.set(pv, Object.freeze({ ...pv, presented: sideSlice(pv.presented, side.team),
      tl: sideTimeline(pv.tl, side.team), side }));
  }
  return views.get(pv);
}

/**
 * The play-caller switch in the ribbon: a key per tracked caller in the server's order (away then home), his team in
 * the key's window and his last name on its face ("TB" "Robinson"), the shown one pressed.
 * @param {object} pv  presented view
 * @returns {object} frozen {shown, label, group, keys: {team, name, title, pressed}[]}; not shown with one caller
 */
export function switchVm(pv) {
  const sides = trackedSides(pv && pv.presented);
  if (sides.length < 2) return NO_SWITCH;
  const shown = shownSide(pv);
  return freezeDeep({
    shown: true, label: SIDES.label, group: SIDES.group,
    keys: sides.map((s) => ({ team: s.team, name: s.last || s.caller || s.team,
      title: SIDES.title(s.caller || s.team, s.team), pressed: s.team === shown.team })),
  });
}

/**
 * A board's plate: with both callers tracked it names the shown one ("Robinson's biggest surprises"); with one caller,
 * or a caller with no name, the plain plate as before.
 * @param {object} pv  presented view (sidePv's, which carries `side`)
 * @param {(last: string) => string} named
 * @param {string} plain
 */
export function namedPlate(pv, named, plain) {
  const last = pv && pv.side && pv.side.last;
  return last ? named(last) : plain;
}

/**
 * Whose call a play is: the offense of the caller row at `seq` when that offense is tracked (a cite or a drive jumps
 * to his section), else null (a kick, an admin row, an opponent's play with one caller tracked).
 * @param {object | null} tl  the presented timeline
 * @param {number} seq  the timeline's seq
 * @returns {string | null}
 */
export function callSideOf(tl, seq) {
  const rows = tl && Array.isArray(tl.rows) ? tl.rows : [];
  const row = rows.find((r) => r && r.seq === seq);
  return row && row.offense_is_caller === true && row.pred && typeof row.team === "string" ? row.team : null;
}

/**
 * The caller to switch to before bringing the call at `seq` into view: his team when that play is another tracked
 * caller's call than the shown one, else null (one caller, his own call, or no call at all).
 * @param {object} pv  presented view, with sideChoice
 * @param {number} seq
 * @returns {string | null}
 */
export function sideToShow(pv, seq) {
  const shown = shownSide(pv);
  if (!shown) return null;
  const team = callSideOf(pv.tl, seq);
  return team && team !== shown.team && trackedSides(pv.presented).some((s) => s.team === team) ? team : null;
}
