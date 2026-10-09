// The flag panel's keys, summaries and note (ui-architecture.md 2.2, FI 1.6, 2.5; gap G25; owner A2). Pure.
import { chosenText, selectedLeaf } from "./selection.js";

/** Flag-mode letters (FI 1.6). In flag mode U, I, C, F, P, L, N, O, R, B and G are fouls, not their usual keys. */
export const FLAG_KEYS = Object.freeze({
  O: "OFFSIDE", H: "DH", C: "IC", D: "DPI", R: "RTP", U: "URD", M: "FM", Z: "12D",
  F: "FS", G: "DOG", E: "ILF", L: "OH", P: "OPI", B: "IBB", I: "IG", N: "URO", W: "OFFSET",
});

/** Button order of the coded fouls; defense and offense columns filter it by `against`. */
export const FLAG_ORDER = Object.freeze(["OFFSIDE", "DH", "IC", "DPI", "RTP", "URD", "FM", "12D", "FS", "DOG", "ILF", "OH",
  "OPI", "IBB", "IG", "URO"]);

/** The key letter printed on each coded foul's button (Other has none: mouse only). */
export const KEY_OF_CODE = Object.freeze(Object.fromEntries(Object.entries(FLAG_KEYS).map(([k, code]) => [code, k])));

const SIDE_WORDS_RE = / on (defense|offense)$/;
const NO_PICK_NOTE = "No play picked: the flag just moves the ball.";

/** The small line under each flag button (FI 1.6 "Summary shown"). */
export function penaltySummary(p) {
  if (!p) return "";
  if (p.yards === "spot") return "ball at the spot, auto 1st (Yards = past the line)";
  if (p.yards === "box") return "yards from the Yards box";
  if (!p.against) return "replay the down";
  const bits = [`${p.yards} yds`];
  if (p.first) bits.push("auto 1st");
  if (p.lod) bits.push("loss of down");
  if (p.presnap) bits.push("pre-snap");
  return bits.join(", ");
}

/** A foul's label without " on defense" or " on offense" (the column heading says which side). */
export function flagLabel(p) {
  return p && typeof p.label === "string" ? p.label.replace(SIDE_WORDS_RE, "") : "";
}

/** The panel note, derived from the current pick on every render so it never goes stale (G25, #65). */
export function flagNote(pick, keys, familyNames) {
  if (!selectedLeaf(pick, keys) && !pick.out) return NO_PICK_NOTE;
  const { text } = chosenText(pick, keys, familyNames);
  return `Your pick (${text}) is wiped out but still scored as his call. Pre-snap fouls ignore it.`;
}
