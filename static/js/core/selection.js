// The manual-entry pick: tap cycles, outcomes, the chosen line and the request bodies
// (ui-architecture.md 2.2, FI 1.3 to 1.5, 2.4, 2.5; owner A2). Pure.
import { familyOf } from "./domain.js";

/** @typedef {{ k: string | null, i: number, out: null | "incomplete" | "sack" | "scramble" }} Pick */

export const EMPTY_PICK = Object.freeze({ k: null, i: 0, out: null });
export const PLAY_KEYS = Object.freeze(["J", "K", "L", "R", "P", "A", "N", "O"]);
export const OUTCOMES = Object.freeze(["incomplete", "sack", "scramble"]);
/** Keys searched, in order, when a prediction row is clicked (R is only an alias of K). */
const LEAF_SEARCH_KEYS = Object.freeze(["J", "K", "L", "P", "A", "N", "O"]);
const KEY_ALIAS = Object.freeze({ R: "K" });
const INCOMPLETE_KEEPS_NAME = Object.freeze(["dropback", "pa", "screen"]);
const OUTCOME_KEEPS_FAMILY = Object.freeze(["dropback", "pa", "rpo"]);
const OUTCOME_SUFFIX = Object.freeze({ incomplete: ", incomplete", sack: ", sack", scramble: ", scramble" });
const PLAIN_PASS = "Dropback pass";
const RPO_THROWN = "RPO, thrown";
const PLACEHOLDER = "Pick the play";

/** Press a play key: R acts as K, the same key moves along its cycle, another key starts over; clears the outcome. */
export function tap(pick, key) {
  if (!PLAY_KEYS.includes(key)) return pick;
  const k = KEY_ALIAS[key] ?? key;
  return { k, i: pick.k === k ? pick.i + 1 : 0, out: null };
}

/** Press I, S or C: the same outcome again turns it off (#44). */
export function toggleOutcome(pick, out) {
  if (!OUTCOMES.includes(out)) return pick;
  return { ...pick, out: pick.out === out ? null : out };
}

/** The pick a click on a prediction row makes: the key and tap count that yield the leaf (#37). */
export function pickLeaf(keys, leaf) {
  if (!keys) return null;
  for (const k of LEAF_SEARCH_KEYS) {
    const i = (keys[k] ?? []).findIndex((x) => x.leaf === leaf);
    if (i >= 0) return { k, i, out: null };
  }
  return null;
}

/** The picked entry of the served cycle, `keys[k][i % length]`, or null. */
export function selectedLeaf(pick, keys) {
  const cycle = pick.k && keys ? keys[pick.k] : null;
  if (!Array.isArray(cycle) || cycle.length === 0) return null;
  return cycle[pick.i % cycle.length] ?? null;
}

function incompleteName(entry) {
  const family = entry ? familyOf(entry.leaf) : null;
  if (entry && INCOMPLETE_KEEPS_NAME.includes(family)) return entry.name;
  return entry && family === "rpo" ? RPO_THROWN : PLAIN_PASS;
}

function sackOrScrambleName(entry, familyNames) {
  const family = entry ? familyOf(entry.leaf) : null;
  if (!entry || !OUTCOME_KEEPS_FAMILY.includes(family) || entry.leaf === "rpo_run") return PLAIN_PASS;
  return familyNames?.[family] ?? PLAIN_PASS;
}

function tapHint(pick, keys) {
  const cycle = keys?.[pick.k];
  if (pick.out || !Array.isArray(cycle) || cycle.length < 2) return null;
  const next = cycle[(pick.i + 1) % cycle.length];
  return `tap ${pick.k} for ${next.name}`;
}

/** The chosen line, cell for cell as FI 1.5 (the server's _resolve_call makes the same conversions). */
export function chosenText(pick, keys, familyNames) {
  const entry = selectedLeaf(pick, keys);
  if (pick.out) {
    const name = pick.out === "incomplete" ? incompleteName(entry) : sackOrScrambleName(entry, familyNames);
    return { text: name + OUTCOME_SUFFIX[pick.out], placeholder: false, hint: null };
  }
  if (!entry) return { text: PLACEHOLDER, placeholder: true, hint: null };
  return { text: entry.name, placeholder: false, hint: tapHint(pick, keys) };
}

/** Log play is enabled only with a drive and a leaf or an outcome picked (#59). */
export function canLog(pick, keys, driveActive) {
  return Boolean(driveActive) && (selectedLeaf(pick, keys) !== null || pick.out !== null);
}

function yardsOf(text, fallback) {
  const n = Number.parseInt(String(text ?? "") || "0", 10);
  return Number.isFinite(n) && n !== 0 ? n : fallback;
}

/** POST /api/play body (FI 2.4), or null when nothing is picked. */
export function playPayload(pick, keys, form) {
  const entry = selectedLeaf(pick, keys);
  if (!entry && !pick.out) return null;
  const body = { yards: yardsOf(form.yards, 0), td: Boolean(form.td), turnover: Boolean(form.turnover) };
  const call = entry ? { leaf: entry.leaf } : { family: "dropback" };
  return pick.out ? { ...body, ...call, outcome: pick.out } : { ...body, ...call };
}

/** POST /api/penalty body (FI 2.5): yards from the Yards box (0 becomes null), the pick when there is one. */
export function flagPayload(code, pick, keys, form) {
  const entry = selectedLeaf(pick, keys);
  const body = { code, yards: yardsOf(form.yards, null), auto_first: Boolean(form.autoFirst) };
  if (!entry && !pick.out) return body;
  return { ...body, play: { leaf: entry ? entry.leaf : null, family: entry ? null : "dropback", outcome: pick.out } };
}
