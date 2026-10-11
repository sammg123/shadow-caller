// The video board (restructure-v2.md section 3): one card that shows every section at once, after every play, and
// never switches faces. PREVIOUS PLAY and LAST 6 are vm-last-play.js; NEXT CALL is here: the call (FI 3.5: top pick
// and the then-line, the tilt tag, the pass/run split against the league, five families with league values and hot
// arrows, the 14 specific plays under them, the why lines), or who has the ball while he doesn't, or FINAL at the
// final whistle (the score and the way to the Model Report; Sam: no Shadow v League numbers on this screen, they live
// in the Model Report). The plates name the caller it shadows
// (G4-2; on 4th down the call is the play if he goes for it, G4-4), the tilt tag says what it measures (G4-6), and the
// whole board has one sentence for its live region. No user input: a play is shown on the field, never picked.
import { PREDICTION } from "./copy.js";
import { capitalize, freezeDeep, pct, pct1, signed1 } from "./format.js";
import { previousOf, previousSpoken, recentOf } from "./vm-last-play.js";
import { lastNameOf } from "./vm-masthead.js";
import { isFinal, scoreboardVm } from "./vm-scoreboard.js";

export const HOT_PTS = 0.04;                    // live.py HOT_PTS: at least 4 points off the league
export const HOT_RATIO = 1.3;                   // live.py HOT_RATIO: and at least 1.3 times the other side
const FLAG_CLASSES = new Set(["tiltpass", "tiltrun", "leanpass", "leanrun", "noedge"]);
const MAX_PLATE_NAME = 16;                      // a longer last name leaves the plate's caption plain ("Next call")
const FOURTH_DOWN = 4;
const REPORT_HREF = "/report";                  // the Model Report page, where the full scorecard lives (section 6)
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

// ---------------------------------------------------------------- NEXT CALL: the call
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

function leafEntry(leaf, topP, hover) {
  return {
    key: leaf.key, name: leaf.name, p: leaf.p, pct1: pct1(leaf.p),
    barPct: finite(leaf.p) && topP > 0 ? Math.min(100, (leaf.p / topP) * 100) : 0,
    ...hotFields(leaf),
    highlighted: leaf.key === hover,
  };
}

const share = (x) => (finite(x) ? x * 100 : null);   // a 0..1 share as 0..100 for bar geometry; null when unknown

function familyEntry(family, topP, hover) {
  return {
    key: family.key, name: family.name, p: family.p, pct: pct(family.p),
    leaguePct: pct(family.p_league), leagueText: PREDICTION.league(pct(family.p_league)),
    barPct: share(family.p), leagueBarPct: share(family.p_league),   // v1.2 (A7): the LED bar and its league notch
    ...hotFields(family),
    leaves: (family.leaves || []).map((leaf) => leafEntry(leaf, topP, hover)),
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

function callVm(pv, p) {
  const pred = p.prediction;
  const top = (pred.top || []).map((t) => ({ leaf: t.key, name: t.name, family: t.family, p: t.p, pct: pct(t.p) }));
  const topP = top.length && finite(top[0].p) ? top[0].p : 0;
  const hover = (pv.view && pv.view.hoverLeaf) || null;
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
    families: (pred.families || []).map((family) => familyEntry(family, topP, hover)),
    legend: PREDICTION.legend,
    leafTitle: PREDICTION.leafTitle,
    why: whyLines(pred, script),
    script: { on: Boolean(script), text: script },
  };
}

/** v1.5 (G4-2): "Next call, snap 2: Short (0–9 air yds), 24 percent. Then ..." (4th down says so first). */
function callSpoken(next) {
  const [first, second] = next.top;
  if (!first || !finite(first.p)) return "";
  const parts = [PREDICTION.spokenCall(next.snap.n, first.name, percentOf(first.p))];
  if (second && finite(second.p)) parts.push(PREDICTION.spokenThen(second.name, percentOf(second.p)));
  return [...(next.fourth.on ? [PREDICTION.spokenFourth] : []), ...parts].join(" ");
}

// ---------------------------------------------------------------- NEXT CALL: while he doesn't have the ball
/** Who has the ball while his offense doesn't (ESPN's status, DC C5): "TB has the ball"; after a score, the team
 * that kicks off; else (before kickoff, at the half, a hand-entered game) nothing, and the body says when his call
 * comes. */
function offFieldVm(pv, p) {
  const off = String(p.game.offense || "");
  const status = (pv.tl && pv.tl.status) || {};
  const poss = typeof status.poss === "string" && status.poss ? status.poss : null;
  const heading = !poss ? "" : status.ball_kind === "kickoff" ? PREDICTION.kicksOff(poss)
    : poss !== off ? PREDICTION.hasBall(poss) : "";
  return { kind: "offfield", plate: plateName(p, PREDICTION.nextCall, PREDICTION.nextCallPlain), heading,
    body: heading ? "" : PREDICTION.waiting(off) };
}

// ---------------------------------------------------------------- NEXT CALL: FINAL
/** The final score and the way to the Model Report, where the scorecard lives (restructure-v2.md 1: no Shadow v
 * League numbers on the GameCast). */
function finalVm(pv) {
  return {
    kind: "final",
    plate: PREDICTION.finalPlate,
    teams: scoreboardVm(pv).teams.map((t) => ({ abbr: t.abbr, name: t.name, score: t.score, caller: t.caller })),
    link: { text: PREDICTION.finalKey, href: REPORT_HREF, title: PREDICTION.finalKeyTitle },
  };
}

function nextSpoken(next) {
  if (next.kind === "call") return callSpoken(next);
  if (next.kind === "final") {
    return `${next.plate}. ${next.teams.map((t) => `${t.name} ${t.score}`.trim()).join(", ")}.`;
  }
  return next.heading ? `${next.heading}.` : next.body;
}

/**
 * @param {object} pv  presented view
 * @returns {object} frozen; {kind: "empty"} before the first state; else {kind, next, previous, recent, spoken}:
 *   kind is NEXT CALL's: "call" with a prediction ({heading, fourth, snap, top[3], call, thenLine, flag, split,
 *   families[], legend, leafTitle, why[], script}), "final" once ESPN's game is over ({plate, teams, link}), else
 *   "offfield" ({plate, heading, body}); previous and recent are vm-last-play.js's, null before his
 *   first snap; spoken is the whole board in words, for its live region
 */
export function predictionVm(pv) {
  const p = pv && pv.presented;
  if (!p || !p.game) return freezeDeep({ kind: "empty" });
  const next = p.prediction ? callVm(pv, p) : isFinal(pv) ? finalVm(pv) : offFieldVm(pv, p);
  const previous = previousOf(pv);
  const recent = recentOf(p, plateName(p, PREDICTION.soFar, PREDICTION.soFarPlain));
  const spoken = [previousSpoken(previous), nextSpoken(next)].filter(Boolean).join(" ");
  return freezeDeep({ kind: next.kind, next, previous, recent, spoken });
}
