/**
 * The words drawn on the field for one play (docs/design/play-drawing.md section 3, binding): what it was, then how
 * it ended, as descriptive as ESPN's own play-by-play: "Deep pass left · +21", "Inside run (left guard) · −2",
 * "Punt · 53 yds · out of bounds", "No play · defensive offside on TB". Pure: no DOM, no three.js. Text only (G27):
 * renderers set it with textContent. Also the label model every field label is laid out with (paths.js, shadows.js):
 * a view's metrics, a label's box, the strokes it must keep clear of, and where it fits.
 *
 * - Pass words come from ESPN's gamebook text: the depth word (call.depth) and the side (geo.lat). Run words come
 *   from the gap (geo.gap). Rows typed by hand carry neither, so they read the engine's leaf (LEAF_WORDS).
 * - On the caller's plays a retag wins for the play type (pred.family and pred.leaf, DC B7: Sam's retag is the
 *   model's truth). The geometry, and ESPN's depth and side words, still follow ESPN's text.
 * - Results: +N or −N yards (true minus sign), "no gain", "incomplete", "TD", "INT", "fumble lost", "safety".
 */
import { FAMILIES, deepFreeze } from "../core/domain.js";
import { FIELD } from "./coords.js";
import {
  ARC_SCREEN_LIFTS, LABEL_CHAR_YD, LABEL_EDGE_YD, LABEL_LINE_YD, bucketOfLeaf, isFiniteNum, ownValue,
} from "./grammar.js";

export const LABEL_SEP = " · ";
export const MINUS = "−";

const GAP_WORDS = Object.freeze({
  "up the middle": ["run_inside", "Inside run (up the middle)"],
  "left guard": ["run_inside", "Inside run (left guard)"],
  "right guard": ["run_inside", "Inside run (right guard)"],
  "left tackle": ["run_ot_left", "Off-tackle left"],
  "right tackle": ["run_ot_right", "Off-tackle right"],
  "left end": ["run_edge_left", "Outside run left"],
  "right end": ["run_edge_right", "Outside run right"],
});
/** The engine's leaves in words, for rows with no gap or depth words (hand-typed rows, retags). */
const LEAF_WORDS = Object.freeze({
  run_inside: "Inside run", run_ot_left: "Off-tackle left", run_edge_left: "Outside run left",
  run_ot_right: "Off-tackle right", run_edge_right: "Outside run right",
});
const DEPTH_WORDS = Object.freeze({ short: "short", mid: "intermediate", deep: "deep" });
const SIDE_WORDS = Object.freeze({ left: "left", middle: "middle", right: "right" });
const SCRAMBLE_SIDE = Object.freeze({ left: "left", middle: "up the middle", right: "right" });
const TEAM_RE = /^[A-Z0-9]{2,4}$/;
const MIDFIELD = 50;
const GOAL = 100;

// ---------------------------------------------------------------- small words
const join = (...parts) => parts.filter(Boolean).join(LABEL_SEP);
const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const word = (value) => (typeof value === "string" && value.trim() ? value.trim() : "");

/** 8 -> "+8", -11 -> "−11" (U+2212), 0 -> "no gain"; "" when unknown. */
export function signedYards(yards) {
  if (!isFiniteNum(yards)) return "";
  if (yards === 0) return "no gain";
  return yards > 0 ? `+${yards}` : `${MINUS}${Math.abs(yards)}`;
}

const isTouchdown = (row) => Boolean(row.result?.td) || row.scoring?.type === "TD";
const lostFumble = (row) => Boolean(row.result?.turnover) && row.result?.turnover_kind !== "int";

// ---------------------------------------------------------------- what it was
/** The play type the label names: the retag on the caller's plays (pred), else ESPN's call. */
function playType(row) {
  const pred = row.pred;
  if (pred && FAMILIES.includes(pred.family)) return { family: pred.family, leaf: pred.leaf ?? null };
  return { family: row.call?.family ?? null, leaf: row.call?.leaf ?? null };
}

/** ESPN's text (the geometry's truth) says a ball was thrown. */
const thrown = (row) => Boolean(row.call?.family) && row.call.family !== "run" && row.call.leaf !== "rpo_run";

function depthWord(row, leaf) {
  return ownValue(DEPTH_WORDS, row.call?.depth) ?? ownValue(DEPTH_WORDS, bucketOfLeaf(leaf)) ?? "";
}

const sideWord = (row) => (thrown(row) ? ownValue(SIDE_WORDS, row.geo?.lat) ?? "" : "");

/** "deep pass left", "short pass", "pass". */
function passWords(row, leaf) {
  return [depthWord(row, leaf), "pass", sideWord(row)].filter(Boolean).join(" ");
}

/** ESPN's gap words when they agree with the leaf, else the leaf's own words. */
function runWords(row, leaf) {
  const gap = ownValue(GAP_WORDS, row.geo?.gap);
  if (gap && (!leaf || gap[0] === leaf)) return gap[1];
  return ownValue(LEAF_WORDS, leaf) ?? (gap ? gap[1] : "Run");
}

function scrambleWords(row) {
  const gap = word(row.geo?.gap);
  const side = gap === "up the middle" ? "up the middle" : gap.startsWith("left") ? "left"
    : gap.startsWith("right") ? "right" : ownValue(SCRAMBLE_SIDE, row.geo?.lat) ?? "";
  return side ? `QB scramble ${side}` : "QB scramble";
}

/** The retag names the RPO's leaf; with no leaf, ESPN's text says whether the ball was thrown. */
const rpoWords = (row, leaf) => (leaf === "rpo_throw" || (leaf !== "rpo_run" && thrown(row)) ? "RPO throw"
  : "RPO handoff");

function whatOf(row) {
  const outcome = row.call?.outcome;
  if (outcome === "sack") return "Sack";
  if (outcome === "scramble") return scrambleWords(row);
  const { family, leaf } = playType(row);
  if (family === "screen") return "Screen";
  if (family === "rpo") return rpoWords(row, leaf);
  if (family === "pa") return `Play-action ${passWords(row, leaf)}`;
  if (family === "dropback") return capital(passWords(row, leaf));
  if (family === "run") return runWords(row, leaf);
  return "Play";
}

// ---------------------------------------------------------------- how it ended
function snapResult(row) {
  if (row.result?.safety) return "safety";
  if (lostFumble(row)) return join("fumble lost", isTouchdown(row) ? "returned for TD" : "");
  if (isTouchdown(row)) return "TD";
  if (row.call?.outcome === "incomplete") return "incomplete";
  return signedYards(row.result?.yards);
}

/** "Pass intercepted · short middle"; a screen or an RPO throw that was picked reads "Screen · INT"; a typed row
 * with no play type is a pass all the same ("Pass intercepted"). */
function interceptionLabel(row) {
  const { family, leaf } = playType(row);
  const returned = isTouchdown(row) ? "returned for TD" : "";
  const named = family !== null && family !== "dropback" && family !== "pa";
  if (named) return join(whatOf(row), "INT", returned);
  const where = [depthWord(row, leaf), sideWord(row)].filter(Boolean).join(" ");
  return join(family === "pa" ? "Play-action pass intercepted" : "Pass intercepted", where, returned);
}

function snapLabel(row) {
  if (row.result?.turnover_kind === "int") return interceptionLabel(row);
  return join(whatOf(row), snapResult(row));
}

// ---------------------------------------------------------------- flags
/** "defensive offside on TB": the server's note, else the foul and the team; "" when neither is there. */
function foulWords(pen) {
  const note = word(pen?.note);
  if (note) return note;
  const foul = word(pen?.foul).toLowerCase();
  const on = word(pen?.on);
  return foul ? [foul, on ? `on ${on}` : ""].filter(Boolean).join(" ") : "";
}

const enforced = (pen) => Boolean(pen) && pen.status !== "declined" && pen.status !== "offsetting";

/** The flag's yards for the offense: lost when the offense fouled, gained when the defense did. */
function flagYards(row, pen) {
  if (!enforced(pen) || !isFiniteNum(pen.yards) || pen.yards === 0) return "";
  if (pen.on === row.team) return signedYards(-Math.abs(pen.yards));
  if (pen.on === row.opp) return signedYards(Math.abs(pen.yards));
  const { x0, x_next: next, dir } = row.geo ?? {};
  return isFiniteNum(x0) && isFiniteNum(next) && next !== x0 ? signedYards((next - x0) * (dir === -1 ? -1 : 1)) : "";
}

/** A flag on a play that stands: " · flag: face mask on DAL". */
function flagSuffix(row) {
  const pen = row.result?.penalty;
  if (!enforced(pen)) return "";
  const words = foulWords(pen);
  return words ? `flag: ${words}` : "flag";
}

// ---------------------------------------------------------------- kicks
function teamsOf(row) {
  const team = TEAM_RE.test(row.team ?? "") ? row.team : null;
  const opp = TEAM_RE.test(row.opp ?? "") ? row.opp : null;
  return row.geo?.dir === -1 ? { caller: opp, other: team } : { caller: team, other: opp };
}

/** A field x as ESPN names it: "DAL 30", "TB 26", "50", "TB end zone". */
function spotName(row, x) {
  const yd = Math.round(x);
  const { caller, other } = teamsOf(row);
  if (yd === MIDFIELD) return "50";
  if (yd <= 0 || yd >= GOAL) return [yd <= 0 ? caller : other, "end zone"].filter(Boolean).join(" ");
  const named = yd < MIDFIELD ? [caller, yd] : [other, GOAL - yd];
  return named.filter((p) => p !== null).join(" ");
}

/** The landing marks a kick row can carry, in ESPN's order of importance, with their words. */
const LANDING_WORDS = Object.freeze([["touchback", "touchback"], ["oob", "out of bounds"], ["fair_catch", "fair catch"],
  ["downed", "downed"], ["muffed", "muffed"]]);

/** How a kicked ball ended for the receivers: a lost ball, a score, a landing mark, else the return's end. */
function landingWords(row, k) {
  const scored = isTouchdown(row) ? "returned for TD" : "";
  if (row.result?.turnover) return join(k.muffed ? "muffed, lost" : "fumble lost", scored);
  if (scored) return scored;
  const hit = LANDING_WORDS.find(([key]) => k[key] === true);
  if (hit) return hit[1];
  return isFiniteNum(k.ret_end_x) ? `return to ${spotName(row, k.ret_end_x)}` : "";
}

const distWords = (k) => (isFiniteNum(k.dist) ? `${k.dist} yds` : "");

function kickoffLabel(row) {
  const k = row.kick ?? {};
  if (k.blocked) return join("Kickoff", "blocked");
  return join("Kickoff", landingWords(row, k) || distWords(k));
}

function puntLabel(row) {
  const k = row.kick ?? {};
  if (k.blocked) return join("Punt", "blocked");
  return join("Punt", distWords(k), landingWords(row, k));
}

function fgLabel(row) {
  const k = row.kick ?? {};
  const good = typeof k.good === "boolean" ? k.good : row.kind === "fg";
  const head = isFiniteNum(k.dist) ? `FG ${k.dist} yds` : "FG";
  return join(head, k.blocked ? "blocked" : good ? "good" : "no good");
}

const KIND_LABELS = Object.freeze({
  play: snapLabel,
  kneel: (row) => join("Kneel", signedYards(row.result?.yards)),
  spike: () => join("Spike", "clock stopped"),
  other: (row) => join("Play", signedYards(row.result?.yards)),
  kickoff: kickoffLabel,
  punt: puntLabel,
  fg: fgLabel,
  fg_miss: fgLabel,
});

// ---------------------------------------------------------------- public API
/**
 * The label drawn on the field for a timeline row: `<what it was> · <result>`, plus the flag when one stands.
 * "" for admin rows and anything that is not a row. Never mutates the row.
 * @param {object} row  a timeline row (DC B3)
 * @returns {string}
 */
export function playLabel(row) {
  if (!row || typeof row !== "object" || row.kind === "admin") return "";
  const pen = row.result?.penalty;
  if (row.kind === "penalty") return join("Flag", foulWords(pen), flagYards(row, pen));
  if (row.result?.nullified) return join("No play", foulWords(pen) || "flag");
  const build = ownValue(KIND_LABELS, row.kind);
  return build ? join(build(row), flagSuffix(row)) : "";
}

// ---------------------------------------------------------------- the label model (paths.js, shadows.js)
/**
 * How label text sits on the screen, in field yards, so every label on the field (a play's, the shadows') is laid
 * out clear of the others and of the strokes as the viewer sees them: `charYd` one character along the text,
 * `lineYd` one line across it, `padYd` the plate's padding along it, `down` the field axis pointing down the screen,
 * `lifts` how many yards of `down` one yard of height reads as (an arc rises up the screen; a range when several).
 * A perspective view shows farther ground smaller, so text of a fixed pixel size takes more yards there: `atV` is
 * where the view was measured (its `down` coordinate, the line of scrimmage) and `grow` how much more a label takes
 * per yard past it, up the screen (labelBox). Nearer the camera a label is taken as measured, never smaller.
 * The default models the cameras that show plays by default (from the near sideline, y = 0, so down is toward it;
 * grammar.js ARC_SCREEN_LIFTS) at the app's desktop sizes; labelMetrics measures a real view.
 */
export const LABEL_METRICS = deepFreeze({ charYd: LABEL_CHAR_YD, lineYd: LABEL_LINE_YD, padYd: 0,
  down: { x: 0, y: -1 }, lifts: [...ARC_SCREEN_LIFTS], grow: 0, atV: 0 });
/** labelMetrics' defaults, in px: a 22 px plate of 14 px text with 6 px of padding a side, 4 px between plates. */
export const LABEL_PX = deepFreeze({ char: 7.2, line: 26, pad: 12 });

const EPS = 1e-9;
const SAMPLE_YD = 1;
const SAMPLES_PER_LINE = 3;        // footprint points sit at most a third of a line apart, so no box slips between
const MARK_HALF_CHARS = 1.5;       // a mark's glyph is about three characters wide and a line tall
const MAX_METRIC_YD = 30;          // a label metric past this is a degenerate view (seen edge-on)
const MIN_PX = 1e-3;
const DEFAULT_LABEL_CHARS = 30;    // a label given without its text counts as this long
const GROW_PROBE_YD = 12;          // labelMetrics compares a yard's depth this far up the screen with the measured one
const MAX_GROW_LINES = 0.5;        // `grow` stays under half a line's depth per line: a line never doubles in a line

const isPt = (p) => isFiniteNum(p?.x) && isFiniteNum(p?.y);
const lerp = (a, b, k) => a + (b - a) * k;
const dot = (p, axis) => p.x * axis.x + p.y * axis.y;
/** The field axis the text runs along: `down` turned a quarter (only its line matters). */
const textAxis = (m) => ({ x: -m.down.y, y: m.down.x });
const isAxis = (d) => isPt(d) && (d.x === 0 || d.y === 0) && Math.abs(d.x) + Math.abs(d.y) === 1;
const yards = (v, fallback, min) => (isFiniteNum(v) && v >= min && v <= MAX_METRIC_YD ? v : fallback);
const px = (v, fallback) => (isFiniteNum(v) && v > 0 ? v : fallback);

/** How much a line `lineYd` deep may deepen per yard (labelBox; shadows.js stacks lines with it). */
const growCap = (lineYd) => MAX_GROW_LINES / lineYd;

/** Metrics with every field checked; a missing or bad field takes LABEL_METRICS'. */
export function resolveLabelMetrics(metrics) {
  const m = metrics && typeof metrics === "object" ? metrics : {};
  const lifts = Array.isArray(m.lifts) ? m.lifts.filter((l) => yards(l, null, 0) !== null) : [];
  const lineYd = yards(m.lineYd, LABEL_METRICS.lineYd, EPS);
  return {
    charYd: yards(m.charYd, LABEL_METRICS.charYd, EPS), lineYd, padYd: yards(m.padYd, LABEL_METRICS.padYd, 0),
    down: isAxis(m.down) ? { x: m.down.x + 0, y: m.down.y + 0 } : LABEL_METRICS.down,
    lifts: lifts.length ? lifts : LABEL_METRICS.lifts,
    grow: isFiniteNum(m.grow) && m.grow > 0 ? Math.min(m.grow, growCap(lineYd)) : 0,
    atV: isFiniteNum(m.atV) ? m.atV : 0,
  };
}

/**
 * How many times its measured size a label takes at `v` (yards down the screen, labelBox's v): 1 at the measured
 * point and nearer the camera, more past it (`grow` a yard). Metrics as resolveLabelMetrics gives them.
 */
export function labelScaleAt(m, v) {
  return 1 + m.grow * Math.max(0, m.atV - v);
}

/** Pixels down the screen per yard along `down` at field point `p` (on the turf), or NaN for a degenerate view. */
function depthPx(project, p, down) {
  const a = project({ x: p.x, y: p.y, h: 0 });
  const b = project({ x: p.x + down.x, y: p.y + down.y, h: 0 });
  return Math.abs(b?.y - a?.y);
}

/** How much more depth a yard of text takes per yard up the screen from `at` (0 when the view shows none). */
function growOf(project, at, down, lineYd) {
  const here = depthPx(project, at, down);
  const there = depthPx(project, { x: at.x - down.x * GROW_PROBE_YD, y: at.y - down.y * GROW_PROBE_YD }, down);
  if (!isFiniteNum(here) || !isFiniteNum(there) || there < MIN_PX) return 0;
  return Math.min(growCap(lineYd), Math.max(0, (here / there - 1) / GROW_PROBE_YD));
}

/**
 * A view's label metrics, measured one yard around `at` (the line of scrimmage, say). `project({ x, y, h })` gives
 * screen pixels `{ x, y }` (y down); the plate's size is in px. The text runs along whichever field axis lies
 * flatter on screen. LABEL_METRICS when the view is degenerate there.
 * @returns {Readonly<{charYd: number, lineYd: number, padYd: number, down: {x: number, y: number}, lifts: number[]}>}
 */
export function labelMetrics(project, at, { charPx, linePx, padPx } = {}) {
  if (typeof project !== "function" || !isPt(at)) return LABEL_METRICS;
  const o = project({ x: at.x, y: at.y, h: 0 });
  const step = (p) => ({ x: p?.x - o?.x, y: p?.y - o?.y });
  const [ex, ey, eh] = [{ x: 1 }, { y: 1 }, { h: 1 }]
    .map((d) => step(project({ x: at.x + (d.x ?? 0), y: at.y + (d.y ?? 0), h: d.h ?? 0 })));
  const alongX = Math.abs(ex.x) >= Math.abs(ey.x);
  const [run, across] = alongX ? [ex, ey] : [ey, ex];
  if (![ex, ey, eh].every(isPt) || Math.abs(run.x) < MIN_PX || Math.abs(across.y) < MIN_PX) return LABEL_METRICS;
  const sign = across.y > 0 ? 1 : -1;
  const down = alongX ? { x: 0, y: sign } : { x: sign, y: 0 };
  const lineYd = px(linePx, LABEL_PX.line) / Math.abs(across.y);
  const m = {
    charYd: px(charPx, LABEL_PX.char) / Math.abs(run.x), lineYd, padYd: px(padPx, LABEL_PX.pad) / Math.abs(run.x),
    down, lifts: [Math.max(0, -eh.y / Math.abs(across.y))], grow: growOf(project, at, down, lineYd),
    atV: dot(at, down),
  };
  const sane = [m.charYd, m.lineYd, m.padYd, m.lifts[0]].every((v) => v <= MAX_METRIC_YD);
  return sane ? deepFreeze(m) : LABEL_METRICS;
}

function boxAt(at, chars, m) {
  const v = dot(at, m.down);
  const k = labelScaleAt(m, v);
  return { u: dot(at, textAxis(m)), v, hw: (k * (chars * m.charYd + m.padYd)) / 2, hh: (k * m.lineYd) / 2 };
}
const charsOf = (text) => (typeof text === "string" ? text.length : DEFAULT_LABEL_CHARS);
const meets = (a, b) => Math.abs(a.u - b.u) < a.hw + b.hw - EPS && Math.abs(a.v - b.v) < a.hh + b.hh - EPS;
const holds = (box, q) => Math.abs(q.u - box.u) < box.hw && Math.abs(q.v - box.v) < box.hh;

/** A label's box in the view: its center along the text (u) and down the screen (v), half its length (padding
 * included) and half a line. */
export function labelBox(label, metrics) {
  return boxAt(label.at, charsOf(label.text), resolveLabelMetrics(metrics));
}

const heightAt = (flight, k) => 4 * flight.apex * k * (1 - k) + flight.endH * k;

/** A mark's glyph: its center, edges and corners. */
function markPoints(at, m) {
  const t = textAxis(m);
  const [hu, hv] = [MARK_HALF_CHARS * m.charYd, m.lineYd / 2];
  return [-1, 0, 1].flatMap((i) => [-1, 0, 1].map((j) => ({ x: at.x + t.x * i * hu + m.down.x * j * hv,
    y: at.y + t.y * i * hu + m.down.y * j * hv })));
}

function stepPoints(step, m) {
  if (step?.t === "mark") return isPt(step.at) ? markPoints(step.at, m) : [];
  if ((step?.t !== "ground" && step?.t !== "arc") || !isPt(step.from) || !isPt(step.to)) return [];
  const flight = step.t === "arc" ? { apex: isFiniteNum(step.apex) ? step.apex : 0,
    endH: isFiniteNum(step.endH) ? step.endH : 0 } : { apex: 0, endH: 0 };
  const [lo, hi] = step.t === "arc" ? [Math.min(...m.lifts), Math.max(...m.lifts)] : [0, 0];
  const gap = Math.min(SAMPLE_YD, m.lineYd / SAMPLES_PER_LINE);
  const path = Math.hypot(step.to.x - step.from.x, step.to.y - step.from.y) + hi * (4 * flight.apex + flight.endH);
  const n = Math.max(1, Math.ceil(path / gap));
  return Array.from({ length: n + 1 }, (_, i) => i / n).flatMap((k) => {
    const [a, b] = [lo * heightAt(flight, k), hi * heightAt(flight, k)];
    const count = b > a ? Math.ceil((b - a) / gap) : 0;
    return Array.from({ length: count + 1 }, (_, j) => (count ? a + ((b - a) * j) / count : a)).map((up) => ({
      x: lerp(step.from.x, step.to.x, k) - m.down.x * up, y: lerp(step.from.y, step.to.y, k) - m.down.y * up }));
  });
}

/** Where steps (paths.js, shadows.js) show in the view, as points a label must not cover, at most a third of a line
 * apart: lines on the turf; an arc's flight lifted up the screen by its height times every lift from the least to the
 * most (its ground track is not drawn); a mark's glyph, about a line tall. Steps without finite points are skipped. */
export function labelFootprint(steps, metrics) {
  const m = resolveLabelMetrics(metrics);
  return (Array.isArray(steps) ? steps : []).flatMap((step) => stepPoints(step, m));
}

/** Slid along its text so the whole label stays on the field. */
function wholeAlongText(c, chars, m) {
  const hw = (chars * m.charYd + m.padYd) / 2;
  const slide = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
  return textAxis(m).x !== 0 ? { x: slide(c.x, FIELD.X_MIN + hw, FIELD.X_MAX - hw), y: c.y }
    : { x: c.x, y: slide(c.y, hw, FIELD.WIDTH - hw) };
}

const within = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const [Y_LO, Y_HI] = [LABEL_EDGE_YD, FIELD.WIDTH - LABEL_EDGE_YD];
const onField = (p) => p.x === within(p.x, FIELD.X_MIN, FIELD.X_MAX) && p.y === within(p.y, Y_LO, Y_HI);
const keepOnField = (p) => ({ x: within(p.x, FIELD.X_MIN, FIELD.X_MAX), y: within(p.y, Y_LO, Y_HI) });

/**
 * Where `text` goes: the first of `candidates` (field points, best first) whose box is clear of `boxes` (labelBox)
 * and of `points` (labelFootprint), each slid along its text to stay whole on the field; a candidate whose center is
 * off the field is skipped. With none clear: null when `strict`, else the first clear of the other text (never text
 * on text), else the first candidate, kept on the field. Null without a candidate.
 * @returns {{x: number, y: number} | null}
 */
export function placeLabelText(text, candidates, { boxes = [], points = [], metrics, strict = false } = {}) {
  const m = resolveLabelMetrics(metrics);
  const chars = charsOf(text);
  const spots = (Array.isArray(candidates) ? candidates : []).filter(isPt).map((c) => wholeAlongText(c, chars, m));
  const tries = spots.filter(onField).map((spot) => ({ spot, box: boxAt(spot, chars, m) }));
  const dots = nearDots(points, tries.map((t) => t.box), m);
  const walls = Array.isArray(boxes) ? boxes : [];
  const apart = tries.filter(({ box }) => walls.every((b) => !meets(box, b)));
  const clear = apart.find(({ box }) => dots.every((q) => !holds(box, q)));
  if (strict) return clear?.spot ?? null;
  return (clear ?? apart[0])?.spot ?? (spots.length ? keepOnField(spots[0]) : null);
}

/** The points (in the view's u, v) that could fall inside any of `boxes`: the rest cannot matter. */
function nearDots(points, boxes, m) {
  if (!boxes.length) return [];
  const axis = textAxis(m);
  const [u0, u1] = [Math.min(...boxes.map((b) => b.u - b.hw)), Math.max(...boxes.map((b) => b.u + b.hw))];
  const [v0, v1] = [Math.min(...boxes.map((b) => b.v - b.hh)), Math.max(...boxes.map((b) => b.v + b.hh))];
  return (Array.isArray(points) ? points : []).filter(isPt).map((p) => ({ u: dot(p, axis), v: dot(p, m.down) }))
    .filter((q) => q.u > u0 && q.u < u1 && q.v > v0 && q.v < v1);
}
