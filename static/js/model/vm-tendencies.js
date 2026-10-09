// His tendencies (FI 3.8): pass/run terms with 90% intervals in a deliberate order (G14), the play-type mix
// against what the league would call, and the held-out check.
import { FAMILIES } from "../core/domain.js";
import { TENDENCIES } from "./copy.js";
import { freezeDeep, intText, pct } from "./format.js";

/** Habit terms, then memory terms (G14). Unknown keys follow, alphabetically, inside their own group. */
export const TERM_ORDER = Object.freeze(["early_down", "third_long", "trailing9", "red_zone", "dq", "last",
  "last_fail", "explosive_prev", "sack_prev"]);
const GROUP_ORDER = Object.freeze(["habit", "memory"]);
const AXIS = Object.freeze({ min: -1.2, max: 1.2 });                              // FI 3.8 clamp
const SEASON_JOIN = "–";                                                     // "2025–2026"
const finite = (x) => typeof x === "number" && Number.isFinite(x);

const rankIn = (list, item) => (list.includes(item) ? list.indexOf(item) : list.length);
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function orderedKeys(coefs) {
  const keys = Object.keys(coefs).filter((k) => k !== "intercept" && coefs[k] && typeof coefs[k] === "object");
  const group = (k) => rankIn(GROUP_ORDER, coefs[k].group);
  return keys.sort((a, b) => group(a) - group(b) || rankIn(TERM_ORDER, a) - rankIn(TERM_ORDER, b) || byName(a, b));
}

/** Where a value sits on the clamped axis, 0 (more run) to 1 (more pass). */
function axisPos(v) {
  const clamped = Math.max(AXIS.min, Math.min(AXIS.max, finite(v) ? v : 0));
  return (clamped - AXIS.min) / (AXIS.max - AXIS.min);
}

function termRow(key, c) {
  return {
    key,
    label: String(c.label || key),
    group: c.group || "",
    sure: c.lo > 0 || c.hi < 0,
    sign: c.est >= 0 ? "pass" : "run",
    pos: { lo: axisPos(c.lo), est: axisPos(c.est), hi: axisPos(c.hi) },
  };
}

function mixRows(rates, names) {
  const keys = Object.keys(rates).filter((k) => rates[k] && typeof rates[k] === "object")
    .sort((a, b) => rankIn(FAMILIES, a) - rankIn(FAMILIES, b) || byName(a, b));
  return keys.map((key) => ({
    key,
    name: (names && names[key]) || key,
    his: pct(rates[key].his),
    exp: TENDENCIES.expected(pct(rates[key].league_expected)),
  }));
}

function heldOutText(granular) {
  const sp = granular && granular.cv && granular.cv.specific_play;
  return sp ? TENDENCIES.heldOut(pct(sp.top1_his), pct(sp.top3_his), intText(sp.n)) : "";
}

function noteOf(profile) {
  const seasons = Array.isArray(profile.seasons) ? profile.seasons.join(SEASON_JOIN) : "";
  return TENDENCIES.note(intText(profile.n_snaps), profile.n_games, seasons);
}

const AXIS_VM = { min: AXIS.min, max: AXIS.max, zero: axisPos(0), left: TENDENCIES.moreRun, right: TENDENCIES.morePass,
  ariaLabel: TENDENCIES.plotAria };

/**
 * @param {object} pv  presented view
 * @returns {object} frozen {title, termsHeading, rows: {key, label, group, sure, sign, pos: {lo, est, hi}}[], axis,
 *   note, mixHeading, mix: {key, name, his, exp}[], heldOut}
 */
export function tendenciesVm(pv) {
  const presented = pv && pv.presented;
  const profile = presented && presented.profile;
  const base = { termsHeading: TENDENCIES.termsHeading, mixHeading: TENDENCIES.mixHeading, axis: { ...AXIS_VM } };
  if (!profile || !profile.coefs) {
    return freezeDeep({ ...base, title: TENDENCIES.fallbackTitle, rows: [], note: "", mix: [], heldOut: "" });
  }
  const granular = profile.granular || null;
  return freezeDeep({
    ...base,
    title: profile.caller ? TENDENCIES.title(profile.caller) : TENDENCIES.fallbackTitle,
    rows: orderedKeys(profile.coefs).map((key) => termRow(key, profile.coefs[key])),
    note: noteOf(profile),
    mix: granular && granular.family_rates ? mixRows(granular.family_rates, presented.family_names) : [],
    heldOut: heldOutText(granular),
  });
}
