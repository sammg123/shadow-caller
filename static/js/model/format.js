// Text formatters shared by every view model (pure). Numbers that fail Number.isFinite never reach the screen as
// "NaN%": percentages and fixed values fall back to the dash, everything else to "".

export const DASH = "—";                    // empty table cell, as FI 3.9 specifies
const ORDINALS = ["", "1st", "2nd", "3rd", "4th"];
const PCT1_LIMIT = 9.95;                        // below this a share keeps one decimal (rounds to 10% from here)
const SECONDS_PER_MINUTE = 60;
const OVERTIME_QTR = 5;
const LAST_REGULATION_QTR = 4;
const CLOCK_RE = /^\d{1,2}:\d{2}$/;

const finite = (x) => typeof x === "number" && Number.isFinite(x);

/** 0.4562 -> "46%" (FI 3.5). */
export function pct(x) {
  return finite(x) ? `${Math.round(x * 100)}%` : DASH;
}

/** One decimal under 10%, else rounded: 0.0494 -> "4.9%", 0.14 -> "14%" (FI 3.5). */
export function pct1(x) {
  if (!finite(x)) return DASH;
  const v = x * 100;
  return v < PCT1_LIMIT ? `${v.toFixed(1)}%` : `${Math.round(v)}%`;
}

/** 1 -> "1st"; anything else outside 1 to 4 -> "". */
export function ord(down) {
  return Number.isInteger(down) && down > 0 && down < ORDINALS.length ? ORDINALS[down] : "";
}

/** Always one decimal with a sign: 16.5 -> "+16.5", 10 -> "+10.0", -4.9 -> "-4.9" (G23). */
export function signed1(x) {
  if (!finite(x)) return "";
  const r = Math.round(x * 10) / 10 || 0;      // `|| 0` turns -0 into 0, so -0.04 reads "+0.0"
  return `${r >= 0 ? "+" : ""}${r.toFixed(1)}`;
}

/** x.toFixed(dp), or the dash. */
export function fixed(x, dp) {
  return finite(x) ? x.toFixed(dp) : DASH;
}

/** 1351 -> "1,351", the same in every locale. */
export function intText(n) {
  if (!finite(n)) return DASH;
  const sign = n < 0 ? "-" : "";
  return sign + String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** A spot from the possessing team's yardline_100: 70 -> "DAL 30", 8 -> "TB 8", 50 -> "50". */
export function spotText(yardline100, own, opp) {
  if (!finite(yardline100)) return "";
  if (yardline100 === 50) return "50";
  return yardline100 > 50 ? `${own} ${100 - yardline100}` : `${opp} ${yardline100}`;
}

/** "1st & 10"; "1st & Goal" when the distance reaches the goal line (G16). */
export function downDistance(down, togo, yardline100) {
  const d = ord(down);
  if (!d || !finite(togo)) return "";
  const goal = finite(yardline100) && togo >= yardline100;
  return `${d} & ${goal ? "Goal" : togo}`;
}

/** "1st & 10 at DAL 25". */
export function situationText(down, togo, yardline100, own, opp) {
  const dd = downDistance(down, togo, yardline100);
  const spot = spotText(yardline100, own, opp);
  return dd && spot ? `${dd} at ${spot}` : "";
}

/** Game seconds -> "M:SS"; a valid "M:SS" string passes through. */
export function clockText(value) {
  if (typeof value === "string") return CLOCK_RE.test(value.trim()) ? value.trim() : "";
  if (!finite(value) || value < 0) return "";
  const s = Math.round(value);
  return `${Math.floor(s / SECONDS_PER_MINUTE)}:${String(s % SECONDS_PER_MINUTE).padStart(2, "0")}`;
}

/** 1 -> "Q1", 5 -> "OT", 6 -> "2OT". */
export function qtrText(qtr) {
  if (!Number.isInteger(qtr) || qtr < 1) return "";
  if (qtr <= LAST_REGULATION_QTR) return `Q${qtr}`;
  return qtr === OVERTIME_QTR ? "OT" : `${qtr - LAST_REGULATION_QTR}OT`;
}

/** 8 -> "+8", -11 -> "-11", 0 -> "0". */
export function signedInt(n) {
  if (!finite(n)) return "";
  return n > 0 ? `+${n}` : String(n);
}

/** "no edge" -> "No edge" (the pill keeps the server's own capitals: "TILT PASS"). */
export function capitalize(text) {
  return typeof text === "string" && text ? text[0].toUpperCase() + text.slice(1) : "";
}

const TURNOVER_WORD = { int: "INT", fumble: "FUMBLE" };

function turnoverWord(result) {
  return TURNOVER_WORD[result.turnover_kind] || "TURNOVER";
}

function kickText(row, result) {
  const kick = row.kick || {};
  const dist = finite(kick.dist) ? ` ${kick.dist}` : "";
  if (row.kind === "fg") return `FG${dist} GOOD`;
  if (row.kind === "fg_miss") return kick.blocked ? "FG BLOCKED" : "FG MISSED";
  if (result.turnover) return "FUMBLE";
  if (kick.blocked) return `${row.kind === "punt" ? "PUNT" : "KICK"} BLOCKED`;
  if (row.kind === "punt") return `PUNT${dist}`;
  return kick.touchback ? "TOUCHBACK" : `KICKOFF${dist}`;
}

function snapText(row, result, call) {
  if (result.turnover) return turnoverWord(result);
  if (call.outcome === "incomplete") return "INC";
  if (row.kind === "spike") return "SPIKE";
  return signedInt(result.yards);              // runs, scrambles, sacks and kneels: the signed gain
}

/** The result word of a timeline row: "+8", "-11", "INC", "TD", "INT", "FLAG", "PUNT 53", "FG 41 GOOD", "" for admin. */
export function resultText(row) {
  if (!row || row.kind === "admin") return "";
  const result = row.result || {};
  if (result.nullified || row.kind === "penalty") return "FLAG";
  if (result.safety) return "SAFETY";
  if (row.scoring && row.scoring.type === "TD") return result.turnover ? `${turnoverWord(result)} TD` : "TD";
  if (["kickoff", "punt", "fg", "fg_miss"].includes(row.kind)) return kickText(row, result);
  return snapText(row, result, row.call || {});
}

/** Freezes a view model all the way down and returns it (VMs are plain frozen objects, ui-architecture 2.3). */
export function freezeDeep(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) freezeDeep(value[key]);
  }
  return value;
}
