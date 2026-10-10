// The next call (FI 3.5): top pick and the then-line, the tilt pill, pass/run split against the league, five
// families with league values and hot arrows, the 14 specific plays under them, and the why lines.
// v1.5 (G4-1): off the field in a fed or watched game the board recaps his last call and his night so far ("recap"),
// and at the final whistle it shows FINAL, the score and SHADOW v LEAGUE's three lines ("final"); typing by hand
// mid-game keeps the off-field copy. v1.5 (G4-2, G4-4, G4-6): the plate names the caller it shadows (on 4th down it
// says the call is the play if he goes for it), the tilt tag says what it measures, and the call has spoken words.
import { familyOf, own } from "../core/domain.js";
import { playLabel } from "../field/play-label.js";
import { PREDICTION, SCORECARD } from "./copy.js";
import { capitalize, freezeDeep, pct, pct1, signed1 } from "./format.js";
import { verdictOf, verdictText } from "./verdict.js";
import { inputMode } from "./vm-feed.js";
import { actualText } from "./vm-log.js";
import { lastNameOf } from "./vm-masthead.js";
import { comparisonPairs } from "./vm-scorecard.js";
import { isFinal, scoreboardVm } from "./vm-scoreboard.js";

export const HOT_PTS = 0.04;                    // live.py HOT_PTS: at least 4 points off the league
export const HOT_RATIO = 1.3;                   // live.py HOT_RATIO: and at least 1.3 times the other side
const SPOT_EXAMPLE_YARD = 25;
const FLAG_CLASSES = new Set(["tiltpass", "tiltrun", "leanpass", "leanrun", "noedge"]);
const MAX_PLATE_NAME = 16;                      // a longer last name leaves the plate's caption plain ("Next call")
const FOURTH_DOWN = 4;
const RECENT_SNAPS = 6;                         // the recap's row of verdict glyphs
const FINAL_KEY = "G";                          // the stat board's key (core/keymap.js)
/** The SHADOW v LEAGUE pairs the scoreboard band carries (DESIGN.md), which FINAL repeats. */
const BAND_PAIRS = Object.freeze(["called_right", "top3", "passrun_logloss"]);
const finite = (x) => typeof x === "number" && Number.isFinite(x);
const round1 = (x) => Math.round(x * 10) / 10 || 0;
const percentOf = (p) => Math.round(p * 100);

/** The server's hot rule (live.py _hot), for data that arrives without a hot flag. */
export function hotOf(p, pLeague) {
  if (!finite(p) || !finite(pLeague)) return "";
  if (p - pLeague >= HOT_PTS && p >= HOT_RATIO * pLeague) return "up";
  if (pLeague - p >= HOT_PTS && pLeague >= HOT_RATIO * p) return "down";
  return "";
}

function hotFields(item) {
  const given = item.hot;
  const hot = given === "up" || given === "down" ? given : given == null ? hotOf(item.p, item.p_league) : "";
  return {
    hot,
    hotGlyph: hot === "up" ? PREDICTION.hotUpGlyph : hot === "down" ? PREDICTION.hotDownGlyph : "",
    hotTitle: hot === "up" ? PREDICTION.hotUp : hot === "down" ? PREDICTION.hotDown : "",
  };
}

/** A plate caption naming the caller this app shadows, by last name; a long or missing name gives the plain one. */
function plateName(p, named, plain) {
  const last = lastNameOf(p.profile && p.profile.caller);
  return last && last.length <= MAX_PLATE_NAME ? named(last) : plain;
}

/** The shortest start of the offense's abbreviation that is not also the opponent's: DAL v TB gives "D 25". */
function spotExample(off, opp) {
  for (let n = 1; n <= off.length; n += 1) {
    if (!opp.startsWith(off.slice(0, n))) return `${off.slice(0, n)} ${SPOT_EXAMPLE_YARD}`;
  }
  return `${off} ${SPOT_EXAMPLE_YARD}`;
}

function offFieldVm(pv, game) {
  const off = String(game.offense || "");
  const mode = inputMode(pv);
  const body = mode === "watch" ? [{ text: PREDICTION.offFieldWatch(off), strong: false }]
    : mode === "feed" ? [{ text: PREDICTION.offFieldFeed(off), strong: false }]
      : PREDICTION.offFieldManual(off, spotExample(off, String(game.opponent || "")))
        .map((s) => ({ text: s.text, strong: Boolean(s.strong) }));
  return { kind: "offfield", heading: PREDICTION.offFieldHeading(off), body };
}

/** The tag beside the call figure (v1.5, G4-6: words for what the server's flag measures; a flag it never sends keeps
 * its own words). */
function flagOf(flag) {
  const raw = typeof flag === "string" ? flag : "";
  const lower = raw.toLowerCase();
  const kind = lower.startsWith("tilt") ? "tilt" : lower.startsWith("lean") ? "lean" : "none";
  const side = kind === "none" ? null : lower.endsWith("pass") ? "pass" : lower.endsWith("run") ? "run" : null;
  const cls = lower.replace(/\s+/g, "");
  const known = FLAG_CLASSES.has(cls);
  const text = !known ? capitalize(raw) : kind === "none" ? PREDICTION.flagText.none : PREDICTION.flagText[kind](side);
  return { text, cls: known ? cls : "", kind, side, title: PREDICTION.pillTitle };
}

function splitOf(p, pLeague) {
  return {
    pass: finite(p) ? p * 100 : 0,
    league: finite(pLeague) ? pLeague * 100 : 0,
    labels: [PREDICTION.splitPass(pct(p)), PREDICTION.splitLeague(pct(pLeague)),
      PREDICTION.splitRun(pct(finite(p) ? 1 - p : null))],
    leagueTitle: PREDICTION.league(pct(pLeague)),
    ariaLabel: PREDICTION.splitAria,
  };
}

/** The leaf a manual pick stands for (keys[k][i % length]); with an outcome set the leaf is not the call. */
function pickedLeaf(pick, keys) {
  if (!pick || !pick.k || pick.out || !keys || !Array.isArray(keys[pick.k]) || !keys[pick.k].length) return null;
  const cycle = keys[pick.k];
  const entry = cycle[(Number.isInteger(pick.i) && pick.i > 0 ? pick.i : 0) % cycle.length];
  return entry ? entry.leaf : null;
}

function leafEntry(leaf, topP, marks) {
  return {
    key: leaf.key, name: leaf.name, p: leaf.p, pct1: pct1(leaf.p),
    barPct: finite(leaf.p) && topP > 0 ? Math.min(100, (leaf.p / topP) * 100) : 0,
    ...hotFields(leaf),
    picked: leaf.key === marks.picked,
    highlighted: leaf.key === marks.hover,
  };
}

const share = (x) => (finite(x) ? x * 100 : null);   // a 0..1 share as 0..100 for bar geometry; null when unknown

function familyEntry(family, topP, marks) {
  return {
    key: family.key, name: family.name, p: family.p, pct: pct(family.p),
    leaguePct: pct(family.p_league), leagueText: PREDICTION.league(pct(family.p_league)),
    barPct: share(family.p), leagueBarPct: share(family.p_league),   // v1.2 (A7): the LED bar and its league notch
    ...hotFields(family),
    leaves: (family.leaves || []).map((leaf) => leafEntry(leaf, topP, marks)),
  };
}

function whyLine(kind, pts, text) {
  const r = round1(pts);
  return { kind, pts: signed1(r), sign: r >= 0 ? "up" : "down", text };
}

function scriptText(pred, memory) {
  if (!pred.script) return "";
  const n = memory && memory.script_plays;
  return Number.isInteger(n) ? PREDICTION.script(n) : PREDICTION.scriptNoCount;
}

function whyLines(pred, script) {
  const habits = Math.round((pred.p_habits - pred.p_league) * 1000) / 10;   // FI 3.5 item 1
  return [
    whyLine("habits", habits, PREDICTION.habits),
    ...(script ? [{ kind: "script", pts: PREDICTION.scriptPts, sign: "none", text: script }] : []),
    ...(pred.memory_parts || []).map((part) => whyLine("memory", part.pts, String(part.term))),
  ];
}

/** v1.5 (G4-2): what the board's live region says: "Next call, snap 2: Short (0–9 air yds), 24 percent. Then ..." */
function spokenOf(pred, top, fourth) {
  if (!top[0] || !finite(top[0].p)) return "";
  const parts = [PREDICTION.spokenCall(pred.snap_next, top[0].name, percentOf(top[0].p))];
  if (top[1] && finite(top[1].p)) parts.push(PREDICTION.spokenThen(top[1].name, percentOf(top[1].p)));
  return [...(fourth ? [PREDICTION.spokenFourth] : []), ...parts].join(" ");
}

function callVm(pv, p) {
  const pred = p.prediction;
  const top = (pred.top || []).map((t) => ({ leaf: t.key, name: t.name, family: t.family, p: t.p, pct: pct(t.p) }));
  const topP = top.length && finite(top[0].p) ? top[0].p : 0;
  const view = pv.view || {};
  const marks = { picked: pickedLeaf(view.pick, p.keys), hover: view.hoverLeaf || null };
  const script = scriptText(pred, p.memory);
  const fourth = Boolean(p.sit && p.sit.down === FOURTH_DOWN);
  return {
    kind: "call",
    heading: fourth ? PREDICTION.fourthDown : plateName(p, PREDICTION.nextCall, PREDICTION.nextCallPlain),
    fourth: { on: fourth, title: fourth ? PREDICTION.fourthDownTitle : "" },
    snap: Number.isInteger(pred.snap_next) ? { n: pred.snap_next, text: PREDICTION.snap(pred.snap_next) }
      : { n: null, text: "" },
    top,
    call: top[0] ? { ...top[0] } : null,
    thenLine: { lead: PREDICTION.then, items: top.slice(1).map((t) => ({ ...t })) },
    flag: flagOf(pred.flag),
    split: splitOf(pred.p, pred.p_league),
    families: (pred.families || []).map((family) => familyEntry(family, topP, marks)),
    legend: PREDICTION.legend,
    leafTitle: PREDICTION.leafTitle,
    why: whyLines(pred, script),
    script: { on: Boolean(script), text: script },
    spoken: spokenOf(pred, top, fourth),
  };
}

// ---------------------------------------------------------------- v1.5 (G4-1): off the field, his night so far
/** The drawn timeline row of a log row (its ESPN play id, or "log-<seq>" for a typed snap; DC B7), else null. */
function timelineRowOf(pv, logRow) {
  const rows = (pv.tl && Array.isArray(pv.tl.rows)) ? pv.tl.rows : [];
  const id = logRow.espn_id ? String(logRow.espn_id) : `log-${logRow.seq}`;
  for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i] && rows[i].id === id) return rows[i];
  return null;
}

/** A touchdown or a turnover leads the recap with the referee's signal and the word. */
function leadOf(logRow, row) {
  const result = (row && row.result) || {};
  if (logRow.turnover || result.turnover) {
    const kind = result.turnover_kind === "int" ? "int" : result.turnover_kind === "fumble" ? "fumble" : "turnover";
    return { kind, text: PREDICTION.lead[kind] };
  }
  const td = Boolean(logRow.td) || Boolean(result.td) || Boolean(row && row.scoring && row.scoring.type === "TD");
  return td ? { kind: "td", text: PREDICTION.lead.td } : null;
}

function predictedOf(logRow, leafNames) {
  const leaf = typeof logRow.top_leaf === "string" ? logRow.top_leaf : null;
  if (!leaf) return null;
  return { leaf, name: own(leafNames, leaf) || leaf, pct: pct(logRow.top_leaf_p), family: familyOf(leaf) };
}

/** Top pick and in-his-top-3 counts, from the scorecard's own numbers (no league count exists, so none is shown). */
function tallyOf(metrics) {
  const g = (metrics && metrics.granular) || {};
  if (!(g.leaf_n > 0)) return [];
  return [{ id: "top1", label: PREDICTION.tallyTop1, value: SCORECARD.of(g.leaf_top1, g.leaf_n) },
    { id: "top3", label: PREDICTION.tallyTop3, value: SCORECARD.of(g.leaf_top3, g.leaf_n) }];
}

/** His last six verdicts, oldest first, so the newest sits at the right end like the ribbon's newest message. */
function recentOf(log) {
  const items = log.slice(0, RECENT_SNAPS).map((row) => verdictOf(row).key).filter((key) => key !== "none")
    .map((key) => ({ key, text: verdictText(key) })).reverse();
  return { label: PREDICTION.recentLabel, items };
}

/**
 * Off the field in a fed or watched game: his last call with its odds, what happened (the field's own words), the
 * verdict, the night's tally and his last six verdicts. Null before his first snap (the off-field copy says when the
 * next call comes).
 */
function recapVm(pv, p) {
  const log = Array.isArray(p.log) ? p.log.filter(Boolean) : [];
  const last = log[0];
  if (!last) return null;
  const row = timelineRowOf(pv, last);
  const call = predictedOf(last, p.leaf_names);
  const verdict = verdictOf(last).key;
  const happened = (row && playLabel(row)) || actualText(last);
  const plate = plateName(p, PREDICTION.soFar, PREDICTION.soFarPlain);
  return {
    kind: "recap",
    plate,
    heading: PREDICTION.offFieldHeading(String(p.game.offense || "")),
    lead: leadOf(last, row),
    call,
    predictedLabel: PREDICTION.predicted,
    happened,
    verdict: { key: verdict, text: verdictText(verdict) },
    tally: tallyOf(p.metrics),
    recent: recentOf(log),
    spoken: recapSpoken(plate, call && finite(last.top_leaf_p) ? [call.name, percentOf(last.top_leaf_p)] : null,
      happened, verdictText(verdict)),
  };
}

/** The recap as sentences for the live region; the field's " · " is read as a pause, never as "dot". */
function recapSpoken(plate, call, happened, verdict) {
  const predicted = call ? PREDICTION.spokenPredicted(call[0], call[1]) : "";
  return [plate, predicted, happened.split(" · ").join(", "), verdict].filter(Boolean).map((s) => `${s}.`).join(" ");
}

// ---------------------------------------------------------------- v1.5 (G4-1): FINAL
function finalVm(pv, p) {
  const board = scoreboardVm(pv).teams;
  const pairs = comparisonPairs(p.metrics).filter((x) => BAND_PAIRS.includes(x.id));
  return {
    kind: "final",
    plate: PREDICTION.finalPlate,
    teams: board.map((t) => ({ abbr: t.abbr, score: t.score, caller: t.caller })),
    lines: pairs.map((x) => ({ id: x.id, label: x.label, shadow: x.shadow.brief, league: x.league.brief,
      leader: x.leader })),
    empty: pairs.length ? "" : SCORECARD.empty,
    key: { cap: FINAL_KEY, name: PREDICTION.finalKey, title: PREDICTION.finalKeyTitle },
    spoken: `${PREDICTION.finalPlate}. ${board.map((t) => `${t.name} ${t.score}`.trim()).join(", ")}.`,
  };
}

/**
 * @param {object} pv  presented view
 * @returns {object} frozen; kind "empty" before the first state; "call" with a prediction: {heading, fourth, snap,
 *   top[3], call, thenLine, flag, split, families[], legend, leafTitle, why[], script, spoken}; with none, "final"
 *   once ESPN's game is over: {plate, teams, lines, empty, key, spoken}; "recap" off the field in a fed or watched
 *   game after his first snap: {plate, heading, lead, call, predictedLabel, happened, verdict, tally, recent, spoken};
 *   else "offfield": {heading, body} with the copy by mode (G24)
 */
export function predictionVm(pv) {
  const p = pv && pv.presented;
  if (!p || !p.game) return freezeDeep({ kind: "empty" });
  if (p.prediction) return freezeDeep(callVm(pv, p));
  if (isFinal(pv)) return freezeDeep(finalVm(pv, p));
  const recap = inputMode(pv) === "manual" ? null : recapVm(pv, p);
  return freezeDeep(recap ?? offFieldVm(pv, p.game));
}
