// How one logged caller snap graded against his prediction (DC B7), for the play feed and the field's verdict moment.
import { PLAYS } from "./copy.js";

const NONE = Object.freeze({ level: null, rank: null, top1: false, top3: false, key: "none" });
const TOP3_RANK = 3;

const keyOf = (top1, top3) => (top1 ? "top1" : top3 ? "top3" : "miss");

function leafVerdict(rank) {
  const top1 = rank === 1;
  const top3 = rank <= TOP3_RANK;
  return { level: "leaf", rank, top1, top3, key: keyOf(top1, top3) };
}

function familyVerdict(pred) {
  const top1 = pred.fam_top === pred.family;
  return { level: "family", rank: null, top1, top3: top1, key: keyOf(top1, top1) };
}

function passRunVerdict(pred) {
  const top1 = (pred.p >= 0.5) === (pred.dropback === 1);
  return { level: "passrun", rank: null, top1, top3: top1, key: keyOf(top1, top1) };
}

/**
 * Specific play when it has a rank (top pick, in his top 3, miss); else the play type (hit or miss); else pass vs
 * run (a pass with no type, like shorthand I). "In his top 3" is only ever claimed for a specific play.
 * @param {object|null} pred  a timeline row's pred, or a log row
 * @returns {{level: string|null, rank: number|null, top1: boolean, top3: boolean, key: "top1"|"top3"|"miss"|"none"}}
 */
export function verdictOf(pred) {
  if (!pred) return NONE;
  if (Number.isInteger(pred.leaf_rank) && pred.leaf_rank > 0) return Object.freeze(leafVerdict(pred.leaf_rank));
  if (pred.family && pred.fam_top) return Object.freeze(familyVerdict(pred));
  if (Number.isFinite(pred.p) && (pred.dropback === 0 || pred.dropback === 1)) return Object.freeze(passRunVerdict(pred));
  return NONE;
}

/** "Top pick", "In his top 3", "Miss", or "" for no verdict. */
export function verdictText(key) {
  return Object.hasOwn(PLAYS.verdict, key) ? PLAYS.verdict[key] : "";
}
