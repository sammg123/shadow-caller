// Under the Lights: what the LED fascia ribbons say (DESIGN.md "LED fascia ribbons ... diegetic copies of the HUD
// ribbons", "On LED, the caller is warm white and the opponent is amber", "The Offense Paints the Board Rule": a team's
// own logo is the only team color an LED may show; owner W1). Pure: a timeline row and the game's teams in, a message
// out ({ parts: [{ text, tone }], logo, holdMs }). The play's own words come from field/play-label.js, the same words
// the field draws beside the play, so the bowl never says anything the feed doesn't.
import { safeLogoUrl } from "../../../../core/domain.js";
import { playLabel } from "../../../../field/play-label.js";
import { shadowInputOf } from "../../../../field/play-style.js";
import { SHADOW_COUNT, shadowCandidates } from "../../../../field/shadows.js";
import { pct } from "../../../../model/format.js";

export const SEP = " · ";
/** LED tones (DESIGN.md): warm white, gold, amber, the flag's yellow, and dim for secondary words. */
export const TONES = Object.freeze({ warm: "#fff3d1", gold: "#ffd27a", amber: "#ffb21e", flag: "#ffd400",
  dim: "#b9ad92", red: "#ff4d3d" });
/** The verdict words of the HUD's upper ribbon (DESIGN.md), in their LED tones. */
const VERDICTS = Object.freeze({ top1: ["TOP PICK", "warm"], top3: ["IN HIS TOP 3", "amber"], miss: ["MISS", "red"] });
const TITLE = "Shadow Play-Caller";
const TD_HOLD_MS = 3200;
const MOMENT_HOLD_MS = 2600;

const nameOf = (teams, abbr) => {
  const t = abbr && teams ? teams[abbr] : null;
  return (typeof t?.name === "string" && t.name.trim()) || abbr || "";
};
const upper = (s) => String(s ?? "").toUpperCase();
const toneOf = (row) => (row?.offense_is_caller ? "warm" : "amber");

/** The team whose logo an LED may show: the dark-background variant when the team has one (DC C2). */
export function logoOf(teams, abbr) {
  const t = abbr && teams ? teams[abbr] : null;
  return safeLogoUrl(t?.logo_dark) ?? safeLogoUrl(t?.logo) ?? null;
}

/** Away and home from the frame (DC A1 field.home; team_order is away, home). */
export function sidesOf(frame) {
  const order = Array.isArray(frame?.teamOrder) ? frame.teamOrder : [];
  const home = frame?.field?.home ?? order[1] ?? null;
  const away = order.find((t) => t !== home) ?? null;
  return { home, away };
}

/** The resting message on the upper ribbon: the game, with both logos. */
export function gameMessage(frame) {
  const teams = frame?.teams ?? null;
  const { home, away } = sidesOf(frame);
  if (!home || !away) return { parts: [{ text: upper(TITLE), tone: "warm" }], logos: [], holdMs: 0 };
  return { parts: [{ text: upper(nameOf(teams, away)), tone: "amber" }, { text: " AT ", tone: "dim" },
    { text: upper(nameOf(teams, home)), tone: "warm" }], logos: [logoOf(teams, away), logoOf(teams, home)].filter(Boolean),
  holdMs: 0 };
}

/** The resting message on the field-wall ribbon before any play: the product's name. */
export function idleMessage() {
  return { parts: [{ text: upper(TITLE), tone: "warm" }], logos: [], holdMs: 0 };
}

/** The team that scored on a touchdown row: the defense after a turnover or on a punt, else the row's team. */
export function scorerOf(row) {
  const res = row?.result ?? {};
  return res.turnover || row?.kind === "punt" ? (row?.opp ?? row?.team) : row?.team;
}

/** A touchdown: TOUCHDOWN and the team's name, between its logos, held a little longer. */
function touchdown(row, teams) {
  const team = scorerOf(row);
  const tone = team === row.team ? toneOf(row) : row.offense_is_caller ? "amber" : "warm";
  return { kind: "td", team, parts: [{ text: "TOUCHDOWN ", tone }, { text: upper(nameOf(teams, team)), tone }],
    logos: [logoOf(teams, team)].filter(Boolean), holdMs: TD_HOLD_MS };
}

/** The ribbon's words for one play (the newest play, like the HUD's upper ribbon), or null for an admin row. */
export function playMessage(row, teams) {
  if (!row || row.kind === "admin") return null;
  if (row.result?.td) return touchdown(row, teams);
  const label = playLabel(row);
  if (!label) return null;
  const pen = row.result?.penalty;
  if (pen?.no_play || row.kind === "penalty") {
    return { kind: "flag", parts: [{ text: "FLAG", tone: "flag" }, { text: SEP + upper(label), tone: "warm" }],
      logos: [], holdMs: MOMENT_HOLD_MS };
  }
  const turnover = row.result?.turnover;
  const head = { text: upper(row.team ?? ""), tone: toneOf(row) };
  if (turnover) {
    const def = row.opp ?? "";
    return { kind: "turnover", team: def, parts: [{ text: row.result.turnover_kind === "int" ? "INTERCEPTED" : "TURNOVER",
      tone: "gold" }, { text: SEP + upper(def) + " BALL", tone: row.offense_is_caller ? "amber" : "warm" }],
    logos: [logoOf(teams, def)].filter(Boolean), holdMs: MOMENT_HOLD_MS };
  }
  return { kind: "play", parts: [head, { text: SEP + upper(label), tone: toneOf(row) }], logos: [], holdMs: 0 };
}

/** The play's words with no moment: "DAL · SHORT PASS MIDDLE · +8" (what a held moment steps back to). */
export function plainMessage(row) {
  const label = row && row.kind !== "admin" ? playLabel(row) : "";
  if (!label) return null;
  return { kind: "play", parts: [{ text: upper(row.team ?? ""), tone: toneOf(row) },
    { text: SEP + upper(label), tone: toneOf(row) }], logos: [], holdMs: 0 };
}

/** A message with the caller play's grade after it (top1, top3, miss; anything else leaves it as it is). */
export function withVerdict(msg, key) {
  const v = Object.hasOwn(VERDICTS, key) ? VERDICTS[key] : null;
  if (!msg || !v) return msg;
  return { ...msg, parts: [...msg.parts, { text: SEP + v[0], tone: v[1] }] };
}

/** One shadow play on the ribbon: its name in warm white, its odds in amber (the video board's then-line). */
const calledPlay = (c) => [{ text: `${upper(c.name)} `, tone: "warm" }, { text: pct(c.p), tone: "amber" }];

/**
 * The next call as the shadow plays show it (G3-6), for the field-wall ribbon before a caller snap: "NEXT CALL ·
 * INSIDE RUN (A/B GAP) 24% · THEN PA SHORT (0–9) 16%". `set` is what the presnap moment gets (the conductor's
 * GhostSet, ShadowPlays, or { source, situation?, leafNames? }); his top SHADOW_COUNT plays in his order, named as the
 * field's shadows are and with the board's whole percentages. Null when there is nothing to call.
 */
export function callMessage(set) {
  const input = shadowInputOf(set);
  if (!input) return null;
  const picks = shadowCandidates(input.source, { ...(input.leafNames ? { leafNames: input.leafNames } : {}),
    ...(input.leafOrder ? { leafOrder: input.leafOrder } : {}) }).slice(0, SHADOW_COUNT);
  if (!picks.length) return null;
  const [first, ...rest] = picks;
  const then = rest.flatMap((c) => [{ text: `${SEP}THEN `, tone: "dim" }, ...calledPlay(c)]);
  return { kind: "call", parts: [{ text: `NEXT CALL${SEP}`, tone: "dim" }, ...calledPlay(first), ...then], logos: [],
    holdMs: 0 };
}

/** The plain text of a message (tests, accessibility notes). */
export const textOf = (msg) => (msg?.parts ?? []).map((p) => p.text).join("");
