// Scoreboard and situation (DC C2, C5, D): teams in away-home order, score, quarter, clock with the est. flag,
// down and distance (Goal, G16), ball on, possession, timeouts, the caller's win probability.
// ESPN source: from the timeline status and rows drawn so far. Manual source: from the strip's situation.
import { safeLogoUrl } from "../core/domain.js";
import { downDistance, clockText, freezeDeep, pct, qtrText, situationText, spotText } from "./format.js";

const WP_DECIMALS = 1e4;
const finite = (x) => typeof x === "number" && Number.isFinite(x);

/** "espn" or "log": the /api/state pointer when the server sends it, else what the drawn rows say. */
export function sourceOf(pv) {
  const pointer = (pv && pv.tl && pv.tl.source) || (pv && pv.presented && pv.presented.timeline
    && pv.presented.timeline.source);
  if (pointer === "espn" || pointer === "log") return pointer;
  const rows = (pv && pv.tl && pv.tl.rows) || [];
  return rows.some((row) => row.src === "espn") ? "espn" : "log";
}

function orderFromTeams(teams) {
  const abbrs = Object.keys(teams);
  const home = abbrs.filter((a) => teams[a] && teams[a].home);
  return [...abbrs.filter((a) => !home.includes(a)), ...home];
}

function orderFromGame(game) {
  if (!game || !game.offense || !game.opponent) return [];
  return game.offense_is_home ? [game.opponent, game.offense] : [game.offense, game.opponent];
}

/** {caller, opp, order (away, home), byAbbr}: from the timeline teams when present, else from the game. */
export function teamsOf(pv) {
  const teams = (pv && pv.tl && pv.tl.teams) || null;
  const game = (pv && pv.presented && pv.presented.game) || null;
  if (teams && Object.keys(teams).length >= 2) {
    const order = orderFromTeams(teams);
    const caller = order.find((a) => teams[a].caller) || (game && game.offense) || order[order.length - 1];
    return { caller, opp: order.find((a) => a !== caller) || null, order, byAbbr: { ...teams } };
  }
  if (!game) return { caller: null, opp: null, order: [], byAbbr: {} };
  return { caller: game.offense, opp: game.opponent, order: orderFromGame(game), byAbbr: {} };
}

function teamEntry(abbr, t, info) {
  const known = t.byAbbr[abbr] || {};
  return {
    abbr,
    name: known.name || abbr,
    location: known.location || "",
    logo: safeLogoUrl(known.logo),                // only the app's own logo proxy (ui-architecture section 1)
    logoDark: safeLogoUrl(known.logo_dark),       // v1.2 (A8): ESPN's dark-background variant, for LED windows
    score: finite(info.scores[abbr]) ? String(info.scores[abbr]) : "",
    poss: info.poss === abbr,
    timeouts: Number.isInteger(info.timeouts[abbr]) ? info.timeouts[abbr] : null,
    caller: abbr === t.caller,
    side: known.side === "left" || known.side === "right" ? known.side : abbr === t.caller ? "left" : "right",
    home: Boolean(known.home),
  };
}

/** The newest drawn row that says where the ball is (the status rule, DC C5), as down and spot facts. */
function ballFromRows(rows) {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (row.kind === "admin" && row.admin && ["end_half", "end_game"].includes(row.admin.what)) return null;
    if (row.scoring) return null;
    if (row.post) return row.post;
  }
  return null;
}

function ballTexts(post, t) {
  if (!post || !post.poss) return { downText: "", ballOn: "", situation: "" };
  const other = post.poss === t.caller ? t.opp : t.caller;
  return {
    downText: downDistance(post.down, post.togo, post.yardline_100),
    ballOn: spotText(post.yardline_100, post.poss, other),
    situation: situationText(post.down, post.togo, post.yardline_100, post.poss, other),
  };
}

function callerWp(wpHome, t) {
  if (!finite(wpHome)) return null;
  const callerHome = Boolean((t.byAbbr[t.caller] || {}).home);
  return callerHome ? wpHome : Math.round((1 - wpHome) * WP_DECIMALS) / WP_DECIMALS;
}

function espnBoard(pv, t) {
  const status = pv.tl.status;
  const ball = status.state === "post" ? null : ballFromRows(pv.tl.rows || []);
  const wpCaller = callerWp(status.wp_home, t);
  return {
    teams: t.order.map((abbr) => teamEntry(abbr, t, { scores: status.score || {}, poss: status.poss,
      timeouts: status.timeouts || {} })),
    qtr: Number.isInteger(status.qtr) ? status.qtr : null,
    qtrText: qtrText(status.qtr),
    clock: clockText(status.clock),
    clockEst: false,
    ...ballTexts(ball, t),
    state: status.state || "pre",
    poss: status.poss || null,
    wpCaller,
    wpText: wpCaller === null ? "" : pct(wpCaller),
  };
}

function manualBoard(pv, t) {
  const p = pv && pv.presented;
  const sit = (p && p.sit) || {};
  const active = Boolean(p && p.drive_active);
  const scores = t.caller ? { [t.caller]: sit.score_off, [t.opp]: sit.score_opp } : {};
  const poss = active ? t.caller : null;
  const post = active ? { poss, down: sit.down, togo: sit.togo, yardline_100: sit.yardline_100 } : null;
  return {
    teams: t.order.map((abbr) => teamEntry(abbr, t, { scores, poss, timeouts: {} })),
    qtr: Number.isInteger(sit.qtr) ? sit.qtr : null,
    qtrText: qtrText(sit.qtr),
    clock: clockText(sit.clock_str) || clockText(sit.clock),
    clockEst: Boolean(sit.clock_estimated),
    ...ballTexts(post, t),
    state: p && Array.isArray(p.log) && p.log.length ? "in" : "pre",
    poss,
    wpCaller: null,
    wpText: "",
  };
}

/**
 * @param {object} pv  presented view
 * @returns {object} frozen {teams: {abbr, name, location, logo, logoDark, score, poss, timeouts, caller, side, home}[],
 *   qtr, qtrText, clock, clockEst, downText, ballOn, situation, state, poss, wpCaller, wpText, source}
 */
export function scoreboardVm(pv) {
  const t = teamsOf(pv);
  const source = sourceOf(pv);
  const board = source === "espn" && pv.tl && pv.tl.status ? espnBoard(pv, t) : manualBoard(pv, t);
  return freezeDeep({ ...board, source });
}
