// Win probability (DC B6.7): ESPN's value after each drawn play, on the caller's side, in ESPN order, with score
// and turnover markers and a tick where each drive starts. At kickoff no play is applied, so the server's timeline
// isn't ESPN's yet (DC D) and has no opening value: the slot says the line appears after the first play.
import { WP } from "./copy.js";
import { freezeDeep, pct, resultText } from "./format.js";
import { sourceOf, teamsOf } from "./vm-scoreboard.js";

const REGULATION_S = 3600;
const WP_DECIMALS = 1e4;
const SCORE_WORD = Object.freeze({ TD: "TD", FG: "FG", SF: "SAFETY", D2P: "2PT" });
const finite = (x) => typeof x === "number" && Number.isFinite(x);

function callerIsHome(pv, t) {
  const known = t.byAbbr[t.caller];
  if (known && typeof known.home === "boolean") return known.home;
  return Boolean(pv.presented && pv.presented.game && pv.presented.game.offense_is_home);
}

function markerOf(row, point) {
  if (row.scoring) {
    return { seq: row.seq, t: point.t, wp: point.wp, kind: "score", team: row.scoring.team,
      text: SCORE_WORD[row.scoring.type] || String(row.scoring.type || "") };
  }
  if (!row.result || !row.result.turnover) return null;
  const loser = row.kind === "punt" ? row.opp : row.team;            // a punt's receiver is the one who loses it
  return { seq: row.seq, t: point.t, wp: point.wp, kind: "turnover", team: loser, text: resultText(row) };
}

function seriesOf(rows) {
  const withWp = rows.filter((row) => row.wp && finite(row.wp.caller));
  return [...withWp].sort((a, b) => (a.espn_seq ?? a.seq) - (b.espn_seq ?? b.seq) || a.seq - b.seq);
}

function ticksOf(drives, rows) {
  const tOf = new Map(rows.map((row) => [row.seq, row.t]));
  return drives.filter((d) => d && Array.isArray(d.seq) && finite(tOf.get(d.seq[0])))
    .map((d) => ({ idx: d.idx, team: d.team, t: tOf.get(d.seq[0]) }));
}

const unavailable = (note) => freezeDeep({ heading: WP.heading, available: false, note, points: [], markers: [],
  ticks: [], start: null, current: null, currentText: "", ariaLabel: "", tMax: REGULATION_S, caller: null });

/**
 * @param {object} pv  presented view
 * @returns {object} frozen {heading, available, note, points: {seq, wp, t, qtr}[], markers: {seq, t, wp, kind, team,
 *   text}[], ticks: {idx, team, t}[], start, current, currentText, ariaLabel, tMax, caller}
 */
export function wpVm(pv) {
  const tl = pv && pv.tl;
  if (!tl) return unavailable("");
  const rows = Array.isArray(tl.rows) ? tl.rows : [];
  if (sourceOf(pv) !== "espn" && (rows.length || !finite(tl.wpStart))) return unavailable(WP.unavailable);
  const t = teamsOf(pv);
  const series = seriesOf(rows);
  const points = series.map((row) => ({ seq: row.seq, wp: row.wp.caller, t: row.t, qtr: row.qtr }));
  const start = !finite(tl.wpStart) ? null
    : callerIsHome(pv, t) ? tl.wpStart : Math.round((1 - tl.wpStart) * WP_DECIMALS) / WP_DECIMALS;
  const current = points.length ? points[points.length - 1].wp : start;
  return freezeDeep({
    heading: WP.heading,
    available: true,
    note: "",
    points,
    markers: series.map((row, i) => markerOf(row, points[i])).filter(Boolean),
    ticks: ticksOf(Array.isArray(tl.drives) ? tl.drives : [], rows),
    start,
    current,
    currentText: current === null ? "" : pct(current),
    ariaLabel: current === null ? "" : WP.aria(t.caller, pct(current)),
    tMax: Math.max(REGULATION_S, ...points.map((p) => (finite(p.t) ? p.t : 0))),
    caller: t.caller || null,                      // v1.2 (A8): whose side the line is on, for the readout
  });
}
