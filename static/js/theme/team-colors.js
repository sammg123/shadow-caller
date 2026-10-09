// Team colors that stay legible (ui-architecture.md 2.7; DC C2; three-recipe 10.3; owner A10). Pure.
// DAL navy vanishes on a night scene (1.36:1) and TB red matches green turf (1.03:1), so a team color is never the
// only signal: a drawn path uses the team's primary when it reads against every background, else its alternate,
// else a light (or dark) core with the team color as the edge or glow. Fills (end zones, scoreboard cabinets) keep
// the team's own color, with an ink chosen for text on it. Missing or malformed colors use the neutral team.
import { safeHex } from "../core/domain.js";

/** The neutral team for manual mode without ESPN colors (base.css uses the same defaults). */
export const NEUTRAL_TEAM = Object.freeze({ color: "#5b6470", alt_color: "#c9ced4" });

/** The backgrounds DC C2 measured against: the turf, the night scene, and a white page. */
export const REFERENCE_BACKGROUNDS = Object.freeze({ turf: "#2e6b3a", night: "#0b0f14", white: "#ffffff" });

export const DEFAULT_MIN_CONTRAST = 3;
const LIGHT = "#ffffff";
const DARK = "#000000";
const LINEAR_KNEE = 0.04045;
const GLOW_LUMINANCE = 0.08;
const LIFT_STEPS = 24;

function channels(hex) {
  const ok = safeHex(hex);
  if (!ok) throw new TypeError(`expected a #rrggbb color, got ${JSON.stringify(hex)}`);
  return [1, 3, 5].map((i) => parseInt(ok.slice(i, i + 2), 16));
}

const toLinear = (c8) => {
  const c = c8 / 255;
  return c <= LINEAR_KNEE ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG 2 relative luminance of a #rrggbb color, 0 (black) to 1 (white). */
export function luminance(hex) {
  const [r, g, b] = channels(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two #rrggbb colors, 1 to 21 (symmetric). */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The worst contrast of `hex` over `against`; Infinity when there is nothing to stand against. */
export function minContrastAgainst(hex, against) {
  const list = (against ?? []).filter((bg) => safeHex(bg));
  return list.length ? Math.min(...list.map((bg) => contrast(hex, bg))) : Infinity;
}

/** White or black, whichever reads better as text on `fill`. */
export function inkOn(fill) {
  return contrast(LIGHT, fill) >= contrast(DARK, fill) ? LIGHT : DARK;
}

const toHex2 = (n) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");

/** Mix two colors in sRGB: t 0 gives `a`, 1 gives `b`. */
export function mixHex(a, b, t) {
  const ca = channels(a);
  const cb = channels(b);
  const k = Math.min(1, Math.max(0, Number(t) || 0));
  return `#${ca.map((c, i) => toHex2(c + (cb[i] - c) * k)).join("")}`;
}

/** Lift `hex` toward white until its luminance reaches `target` (a glow that still reads at night). */
export function liftToLuminance(hex, target = GLOW_LUMINANCE) {
  const base = safeHex(hex) ? hex.toLowerCase() : null;
  if (!base) throw new TypeError(`expected a #rrggbb color, got ${JSON.stringify(hex)}`);
  if (luminance(base) >= target) return base;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < LIFT_STEPS; i += 1) {
    const mid = (lo + hi) / 2;
    if (luminance(mixHex(base, LIGHT, mid)) >= target) hi = mid;
    else lo = mid;
  }
  return mixHex(base, LIGHT, hi);
}

const normalized = (hex) => (safeHex(hex) ? hex.toLowerCase() : null);

/** The team's colors after validation, or the neutral team when the primary is missing or malformed. */
function colorsOf(team) {
  const color = normalized(team?.color);
  if (!color) return { color: NEUTRAL_TEAM.color, alt: NEUTRAL_TEAM.alt_color, neutral: true };
  return { color, alt: normalized(team?.alt_color), neutral: false };
}

function coreFor(against) {
  return minContrastAgainst(LIGHT, against) >= minContrastAgainst(DARK, against) ? LIGHT : DARK;
}

/**
 * How to paint a team against `against` (the look's teamColor.against): fill = the team's own color; edge = the
 * primary when it reaches `minContrast` against every background, else the alternate when that does (usedAlt),
 * else the primary again with `needsCore` (draw a light or dark core inside the stroke); core = the core color;
 * ink = text on the fill; alt = the validated alternate (or the edge).
 * @returns {Readonly<{ fill: string, edge: string, core: string, ink: string, alt: string, usedAlt: boolean,
 *   needsCore: boolean, neutral: boolean }>}
 */
export function teamPaint(team, against = [], minContrast = DEFAULT_MIN_CONTRAST) {
  const { color, alt, neutral } = colorsOf(team);
  const reads = (hex) => minContrastAgainst(hex, against) >= minContrast;
  const primaryReads = reads(color);
  const altReads = !primaryReads && alt !== null && reads(alt);
  return Object.freeze({
    fill: color,
    edge: altReads ? alt : color,
    core: coreFor(against),
    ink: inkOn(color),
    alt: alt ?? color,
    usedAlt: altReads,
    needsCore: !primaryReads && !altReads,
    neutral,
  });
}

/** Contrast of a team's primary and alternate against named backgrounds (default: turf, night, white). */
export function legibility(team, backgrounds = REFERENCE_BACKGROUNDS) {
  const table = (hex) => (hex ? Object.fromEntries(Object.entries(backgrounds)
    .map(([name, bg]) => [name, contrast(hex, bg)])) : null);
  return { color: table(normalized(team?.color)), alt: table(normalized(team?.alt_color)) };
}
