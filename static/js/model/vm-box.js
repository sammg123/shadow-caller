// Box score (DC C4): team stats, away team first. v1.2 (A8): ESPN's own box score when the server sends it
// (`box_espn`, ui-architecture Appendix B: never in Watch mode or mid-game), else the one derived from the rows
// drawn so far. `source` and `sourceText` say which one is showing.
import { BOX } from "./copy.js";
import { DASH, freezeDeep } from "./format.js";
import { teamsOf } from "./vm-scoreboard.js";

const finite = (x) => typeof x === "number" && Number.isFinite(x);
const num = (x) => (finite(x) ? String(x) : DASH);
const both = (a, b) => (finite(a) && finite(b) ? BOX.pair(a, b) : DASH);

/** [label, value of one team's box] in the order of a TV stat card. */
const ROWS = Object.freeze([
  [BOX.firstDowns, (b) => num(b.first_downs?.total)],
  [BOX.passFirstDowns, (b) => num(b.first_downs?.pass)],
  [BOX.rushFirstDowns, (b) => num(b.first_downs?.rush)],
  [BOX.penFirstDowns, (b) => num(b.first_downs?.pen)],
  [BOX.third, (b) => both(b.third?.conv, b.third?.att)],
  [BOX.fourth, (b) => both(b.fourth?.conv, b.fourth?.att)],
  [BOX.plays, (b) => num(b.plays)],
  [BOX.yards, (b) => num(b.yards)],
  [BOX.passYards, (b) => num(b.pass?.net)],
  [BOX.compAtt, (b) => both(b.pass?.comp, b.pass?.att)],
  [BOX.sacks, (b) => both(b.pass?.sacks, b.pass?.sack_yds)],
  [BOX.interceptions, (b) => num(b.pass?.int)],
  [BOX.rushYards, (b) => num(b.rush?.yds)],
  [BOX.rushAtt, (b) => num(b.rush?.att)],
  [BOX.penalties, (b) => both(b.penalties?.n, b.penalties?.yds)],
  [BOX.turnovers, (b) => num(b.turnovers)],
  [BOX.fumblesLost, (b) => num(b.fumbles_lost)],
  [BOX.possession, (b) => (typeof b.top === "string" && b.top ? b.top : DASH)],
]);

function columnsOf(pv, box) {
  const present = (abbr) => box[abbr] && typeof box[abbr] === "object";
  const ordered = teamsOf(pv).order.filter(present);
  return ordered.length ? ordered : Object.keys(box).filter(present).sort();
}

const isBox = (box) => Boolean(box) && typeof box === "object";
const hasColumns = (box) => isBox(box) && Object.values(box).some((team) => isBox(team));

/** ESPN's own box when it has team columns, else the derived one: {box, source} or null. */
function boxOf(tl) {
  if (!tl) return null;
  if (hasColumns(tl.boxEspn)) return { box: tl.boxEspn, source: "espn" };
  return isBox(tl.box) ? { box: tl.box, source: "derived" } : null;
}

const SOURCE_TEXT = Object.freeze({ espn: BOX.sourceEspn, derived: BOX.sourceDerived });

/**
 * @param {object} pv  presented view
 * @returns {object} frozen {heading, available, teams: string[], rows: {label, values: string[]}[],
 *   source: "espn"|"derived"|null, sourceText, emptyText}
 */
export function boxVm(pv) {
  const picked = boxOf(pv && pv.tl);
  const teams = picked ? columnsOf(pv, picked.box) : [];
  if (!teams.length) {
    return freezeDeep({ heading: BOX.heading, available: false, teams: [], rows: [], source: null, sourceText: "",
      emptyText: BOX.empty });
  }
  return freezeDeep({
    heading: BOX.heading,
    available: true,
    teams,
    rows: ROWS.map(([label, value]) => ({ label, values: teams.map((abbr) => value(picked.box[abbr])) })),
    source: picked.source,
    sourceText: SOURCE_TEXT[picked.source],
    emptyText: "",
  });
}
