// The next call (FI 3.5): top pick and the then-line, the tilt pill, pass/run split against the league, five
// families with league values and hot arrows, the 14 specific plays under them, and the why lines.
import { PREDICTION } from "./copy.js";
import { capitalize, freezeDeep, pct, pct1, signed1 } from "./format.js";
import { inputMode } from "./vm-feed.js";

export const HOT_PTS = 0.04;                    // live.py HOT_PTS: at least 4 points off the league
export const HOT_RATIO = 1.3;                   // live.py HOT_RATIO: and at least 1.3 times the other side
const SPOT_EXAMPLE_YARD = 25;
const FLAG_CLASSES = new Set(["tiltpass", "tiltrun", "leanpass", "leanrun", "noedge"]);
const finite = (x) => typeof x === "number" && Number.isFinite(x);
const round1 = (x) => Math.round(x * 10) / 10 || 0;

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

function flagOf(flag) {
  const raw = typeof flag === "string" ? flag : "";
  const lower = raw.toLowerCase();
  const kind = lower.startsWith("tilt") ? "tilt" : lower.startsWith("lean") ? "lean" : "none";
  const side = kind === "none" ? null : lower.endsWith("pass") ? "pass" : lower.endsWith("run") ? "run" : null;
  const cls = lower.replace(/\s+/g, "");
  return { text: capitalize(raw), cls: FLAG_CLASSES.has(cls) ? cls : "", kind, side, title: PREDICTION.pillTitle };
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

function callVm(pv, p) {
  const pred = p.prediction;
  const top = (pred.top || []).map((t) => ({ leaf: t.key, name: t.name, family: t.family, p: t.p, pct: pct(t.p) }));
  const topP = top.length && finite(top[0].p) ? top[0].p : 0;
  const view = pv.view || {};
  const marks = { picked: pickedLeaf(view.pick, p.keys), hover: view.hoverLeaf || null };
  const script = scriptText(pred, p.memory);
  return {
    kind: "call",
    heading: PREDICTION.mostLikely,
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
  };
}

/**
 * @param {object} pv  presented view
 * @returns {object} frozen; kind "empty" before the first state, "offfield" with no drive (copy by mode, G24),
 *   or "call": {heading, snap, top[3], call, thenLine, flag, split, families[], legend, leafTitle, why[], script}
 */
export function predictionVm(pv) {
  const p = pv && pv.presented;
  if (!p || !p.game) return freezeDeep({ kind: "empty" });
  return freezeDeep(p.prediction ? callVm(pv, p) : offFieldVm(pv, p.game));
}
