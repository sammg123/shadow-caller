// Tonight's scorecard (FI 3.7) and the SHADOW vs LEAGUE pairs. A pair exists only where the server computes both
// sides: there is no league top-pick count and no league tilt count, so neither ever appears as a pair.
import { SCORECARD } from "./copy.js";
import { fixed, freezeDeep, pct } from "./format.js";

const PASS_RUN_DP = 3;                          // pass/run log loss: 0.421
const GRANULAR_DP = 2;                          // play type and specific play log loss: 0.72, 1.62
const finite = (x) => typeof x === "number" && Number.isFinite(x);

/**
 * better when his log loss is below the league's, worse when above, "" when the two read the same at the scorecard's
 * precision (v1.5, G4-3: the screen's own numbers decide, so 1.62 v 1.62 is never red; FI 3.7 had a tie read worse).
 */
function lossTone(model, league, dp) {
  if (!finite(model) || !finite(league) || fixed(model, dp) === fixed(league, dp)) return "";
  return model < league ? "better" : "worse";
}

const kpi = (value, label, tone = "") => ({ value, label, tone });

function leafGroup(g) {
  return {
    id: "leaf",
    title: SCORECARD.leafTitle(g.leaf_n),
    kpis: [
      kpi(SCORECARD.of(g.leaf_top1, g.leaf_n), SCORECARD.topPick),
      kpi(SCORECARD.of(g.leaf_top3, g.leaf_n), SCORECARD.top3(g.leaf_top3_league)),
      kpi(fixed(g.leaf_logloss, GRANULAR_DP), SCORECARD.hisLogloss,
        lossTone(g.leaf_logloss, g.leaf_logloss_league, GRANULAR_DP)),
      kpi(fixed(g.leaf_logloss_league, GRANULAR_DP), SCORECARD.leagueLogloss),
    ],
  };
}

function familyGroup(g) {
  return {
    id: "family",
    title: SCORECARD.familyTitle(g.fam_n),
    kpis: [
      kpi(SCORECARD.of(g.fam_top_hits, g.fam_n), SCORECARD.familyTop),
      kpi(fixed(g.fam_logloss, GRANULAR_DP), SCORECARD.familyLogloss(fixed(g.fam_logloss_league, GRANULAR_DP)),
        lossTone(g.fam_logloss, g.fam_logloss_league, GRANULAR_DP)),
    ],
  };
}

function passRunGroup(m) {
  return {
    id: "passrun",
    title: SCORECARD.passRunTitle(m.n),
    kpis: [
      kpi(fixed(m.logloss_model, PASS_RUN_DP), SCORECARD.passRunLogloss(fixed(m.logloss_league, PASS_RUN_DP)),
        lossTone(m.logloss_model, m.logloss_league, PASS_RUN_DP)),
      kpi(pct(m.acc_model), SCORECARD.calledRight(pct(m.acc_league))),
      kpi(m.tilt_n ? SCORECARD.of(m.tilt_hits, m.tilt_n) : "0", SCORECARD.tilts),
      kpi(pct(m.dropback_rate), SCORECARD.passRate),
    ],
  };
}

/**
 * The side that leads, by what the screen shows (v1.5, G4-3): two sides that read the same are even, so no lamp lights
 * on a tie the viewer can't see a difference in. Rounding keeps order, so sides that read differently compare the same
 * way unrounded.
 */
function leaderOf(shadow, league, better) {
  if (!finite(shadow.value) || !finite(league.value) || shadow.text === league.text) return "even";
  return (better === "higher") === (shadow.value > league.value) ? "shadow" : "league";
}

/** One side of a pair: the number, its scorecard text, and the short form a scoreboard can use (".421"). */
const side = (value, text) => ({ value, text, brief: text.replace(/^0\./, ".") });

function pair(id, label, shadow, league, better, basis) {
  return { id, label, shadow, league, better, leader: leaderOf(shadow, league, better), basis: SCORECARD.basis(basis),
    snaps: basis };
}

function lossPair(id, label, model, league, dp, basis) {
  return pair(id, label, side(model, fixed(model, dp)), side(league, fixed(league, dp)), "lower", basis);
}

/**
 * Called right, actual play in his top 3, then log loss at the three levels, in the directions' order.
 * @param {object|null} metrics  /api/state metrics
 * @returns {object[]} frozen {id, label, shadow: {value, text, brief}, league: {...}, better, leader, basis, snaps}[]
 */
export function comparisonPairs(metrics) {
  if (!metrics || !metrics.n) return freezeDeep([]);
  const m = metrics;
  const g = m.granular || {};
  const leaf = g.leaf_n > 0;
  const family = g.fam_n > 0;
  return freezeDeep([
    pair("called_right", SCORECARD.pairCalledRight, side(m.acc_model, pct(m.acc_model)),
      side(m.acc_league, pct(m.acc_league)), "higher", m.n),
    ...(leaf ? [pair("top3", SCORECARD.pairTop3, side(g.leaf_top3, String(g.leaf_top3)),
      side(g.leaf_top3_league, String(g.leaf_top3_league)), "higher", g.leaf_n)] : []),
    lossPair("passrun_logloss", SCORECARD.pairPassRun, m.logloss_model, m.logloss_league, PASS_RUN_DP, m.n),
    ...(family ? [lossPair("family_logloss", SCORECARD.pairFamily, g.fam_logloss, g.fam_logloss_league, GRANULAR_DP,
      g.fam_n)] : []),
    ...(leaf ? [lossPair("leaf_logloss", SCORECARD.pairLeaf, g.leaf_logloss, g.leaf_logloss_league, GRANULAR_DP,
      g.leaf_n)] : []),
  ]);
}

/** v1.5 (G4-3): the basis said once under SHADOW v LEAGUE ("his model v league baseline · 59 snaps") when every pair
 * counts the same snaps; pairs that count different snaps keep their own counts, and the line names no number. */
function basisOf(pairs) {
  const counts = new Set(pairs.map((p) => p.snaps));
  const shared = pairs.length > 0 && counts.size === 1;
  return { basisShared: shared, basisLine: shared ? SCORECARD.basisLine(pairs[0].basis) : SCORECARD.basisLinePlain };
}

/**
 * @param {object} pv  presented view
 * @returns {object} frozen {heading, empty, emptyText, groups: {id, title, kpis: {value, label, tone}[]}[], note,
 *   expanded, pairs, basisLine, basisShared}; expanded is false here: the Model Report shows the scorecard at full
 *   size (report/model/vm-league.js), the only page it is on (restructure-v2.md 1 and 6)
 */
export function scorecardVm(pv) {
  const metrics = pv && pv.presented && pv.presented.metrics;
  const expanded = false;
  if (!metrics || !metrics.n) {
    return freezeDeep({ heading: SCORECARD.heading, empty: true, emptyText: SCORECARD.empty, groups: [], note: "",
      expanded, pairs: [], basisLine: "", basisShared: false });
  }
  const g = metrics.granular || {};
  const groups = [...(g.leaf_n > 0 ? [leafGroup(g)] : []), ...(g.fam_n > 0 ? [familyGroup(g)] : []),
    passRunGroup(metrics)];
  const pairs = comparisonPairs(metrics);
  return freezeDeep({ heading: SCORECARD.heading, empty: false, emptyText: "", groups, note: SCORECARD.note, expanded,
    pairs, ...basisOf(pairs) });
}
