// What the field shows between plays (ui-architecture 2.3): the situation the scene draws, the ghost input for the
// caller's next call, the facts the #field hooks report (#27, #28), its aria-label and the approximation legend.
// Field math stays in field/coords.js (DC A5); this module only picks which facts to hand it.
import { dirOf, goalX, xFromYardline100, yardline100FromX } from "../field/coords.js";
import { ghostInputFromPrediction } from "../field/ghosts.js";
import { LEAF_NAMES } from "../field/shadows.js";
import { FIELD } from "./copy.js";
import { downDistance, freezeDeep, pct, spotText } from "./format.js";
import { verdictOf, verdictText } from "./verdict.js";
import { sourceOf } from "./vm-scoreboard.js";

const finite = (x) => typeof x === "number" && Number.isFinite(x);
const NO_FACTS = Object.freeze({ los: null, ltg: null, poss: null, ballX: null, ltgX: null });

/** 1. The caller's drive (presented.drive_active): from the strip's situation, attacking +x. */
function callerSituation(sit, caller) {
  const ballX = xFromYardline100(caller, sit.yardline_100, caller);
  if (!finite(ballX) || !finite(sit.togo)) return null;
  const goalToGo = sit.togo >= sit.yardline_100;
  return { ballX, ltgX: goalToGo ? goalX(1) : ballX + sit.togo, dir: 1, poss: caller, kind: "snap", goalToGo,
    down: sit.down ?? null, togo: sit.togo };
}

function lastPost(rows) {
  for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i].post) return rows[i];
  return null;
}

function lineToGainX(row, dir, ballX) {
  const from = row.geo && finite(row.geo.x_next) ? row.geo.x_next : ballX;
  const x = from + dir * row.post.togo;
  return dir === 1 ? Math.min(goalX(dir), x) : Math.max(goalX(dir), x);
}

/** 2. ESPN's ball when the caller is off the field (opponent drives, kickoffs). No ghosts: the opponent has no model. */
function espnSituation(tl, caller) {
  const status = tl.status;
  const dir = dirOf(status.poss, caller);
  const base = { ballX: status.ball_x, dir, poss: status.poss };
  if (status.ball_kind === "kickoff") return { ...base, ltgX: null, kind: "kickoff", goalToGo: false, down: null, togo: null };
  const row = lastPost(tl.rows || []);
  if (!row || !finite(row.post.togo)) return { ...base, ltgX: null, kind: "snap", goalToGo: false, down: null, togo: null };
  const goalToGo = finite(row.post.yardline_100) && row.post.togo >= row.post.yardline_100;
  return { ...base, ltgX: lineToGainX(row, dir, status.ball_x), kind: "snap", goalToGo, down: row.post.down ?? null,
    togo: row.post.togo };
}

function situationOf(pv, presented, caller) {
  if (presented.drive_active && presented.sit) return callerSituation(presented.sit, caller);
  const tl = pv.tl;
  const status = tl && tl.status;
  if (!status || status.state !== "in" || !finite(status.ball_x) || !status.poss) return null;
  return sourceOf(pv) === "espn" ? espnSituation(tl, caller) : null;
}

function factsOf(sit, caller) {
  if (!sit) return NO_FACTS;
  return {
    los: yardline100FromX(sit.poss, sit.ballX, caller),
    ltg: finite(sit.ltgX) ? yardline100FromX(sit.poss, sit.ltgX, caller) : null,
    poss: sit.poss, ballX: sit.ballX, ltgX: sit.ltgX,
  };
}

function ariaOf(sit, facts, caller, opp) {
  if (!sit) return FIELD.offField(caller);
  const other = sit.poss === caller ? opp : caller;
  const spot = spotText(facts.los, sit.poss, other);
  if (sit.kind === "kickoff") return FIELD.kickoff(sit.poss, spot);
  const dd = downDistance(sit.down, sit.togo, facts.los);
  const ltg = facts.ltg === null ? "" : sit.goalToGo ? FIELD.goalLine : spotText(facts.ltg, sit.poss, other);
  return [FIELD.ballOn(spot), dd ? FIELD.downDistance(dd) : "", ltg ? FIELD.lineToGain(ltg) : ""].filter(Boolean).join(" ");
}

function ghostInputOf(presented, sit) {
  if (!sit || !presented.drive_active || !presented.prediction) return null;
  const input = ghostInputFromPrediction(presented.prediction);
  return input ? { ...input, leaves: (input.leaves || []).map((leaf) => ({ ...leaf })) } : null;
}

/** A leaf's name without its parenthesis: "Intermediate (10–19)" reads "Intermediate" on a chip. */
function shortLeafName(leaf, leafNames) {
  const own = (names) => (names && typeof names === "object" && Object.hasOwn(names, leaf) ? names[leaf] : null);
  const name = [own(leafNames), own(LEAF_NAMES)].find((n) => typeof n === "string" && n.trim() !== "");
  return name ? name.replace(/\s*\([^)]*\)\s*$/, "").trim() : "";
}

/**
 * G2-7: what the field's verdict chip says was graded, from a caller row's pred: "Top pick · 43%", "In his top 3 ·
 * #2 Intermediate · 39%", "Miss · #11 Deep shot · 3%" (his rank for the play he ran, its name, his odds for it). A
 * grade without a specific play (a hand-typed play type, pass or run) keeps its plain words; no grade, "".
 * @param {object | null} pred  a timeline row's pred
 * @param {Record<string, string> | null} [leafNames]  the server's leaf names (timeline meta), else the engine's
 */
export function verdictChipText(pred, leafNames = null) {
  const v = verdictOf(pred);
  const head = verdictText(v.key);
  if (!head || v.level !== "leaf") return head;
  const odds = Number.isFinite(pred.leaf_p) ? pct(pred.leaf_p) : "";
  if (v.top1) return [head, odds].filter(Boolean).join(" · ");
  const play = [`#${v.rank}`, shortLeafName(pred.leaf, leafNames)].filter(Boolean).join(" ");
  return [head, play, odds].filter(Boolean).join(" · ");
}

/**
 * @param {object} pv  presented view
 * @returns {object} frozen {situation, ghostInput, facts: {driveActive, los, ltg, poss, ballX, ltgX}, ariaLabel, legend}
 */
export function fieldVm(pv) {
  const presented = pv && pv.presented;
  if (!presented || !presented.game) {
    return freezeDeep({ situation: null, ghostInput: null, facts: { driveActive: false, ...NO_FACTS }, ariaLabel: "",
      legend: FIELD.legend });
  }
  const { offense: caller, opponent: opp } = presented.game;
  const situation = situationOf(pv, presented, caller);
  const facts = factsOf(situation, caller);
  return freezeDeep({
    situation,
    ghostInput: ghostInputOf(presented, situation),
    facts: { driveActive: Boolean(presented.drive_active), ...facts },
    ariaLabel: ariaOf(situation, facts, caller, opp),
    legend: FIELD.legend,
  });
}
