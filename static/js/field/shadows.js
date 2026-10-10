/**
 * Before each snap of the modeled caller, his most likely plays drawn as shadows (docs/design/play-drawing.md
 * sections 4 and 4b, binding): the top 2 of his model, in the same shape language as real plays (paths.js), dashed,
 * never solid, each tagged on its plate: "NEXT 1 · Deep shot (20+) · 31%". Pure: no DOM, no three.js. It replaces
 * ghosts.js (category zones and bands).
 *
 * The model predicts the play type, not the side, so a predicted pass flies at its bucket's typical air yards, a run
 * is a line 4 yards long angled to its gap, and the screen is a short arc to the near flat (grammar.js SHADOW_*).
 * 4b: every stroke starts 1.5 yd past the ball, never on it, and two that would come within 3 yd of each other fan
 * out to their own lanes, passes arcing in the far lanes above the runs on the turf; nor do they lie on the previous
 * play (`avoid`'s drawing) where it is in their way ahead of the ball (shadow-lanes.js).
 * `label.at` is the field-space spot of the words, for the canvas label renderers: they stack as one block in rank
 * order, #1 on top, underneath the shadows, a line down until every line of it is clear of other text, the strokes
 * (as the view shows them: an arc rises up the screen) and the ball (play-label.js label model; `metrics` describes
 * the view). The css2d and 2D fields place the words in screen space instead (presnap-layout.js), from each plate's
 * `tag` and `body`.
 * On 4th down he usually kicks, which the model doesn't predict: the shadows are what he calls if he goes, so their
 * words read "NEXT 1 · If he goes · " and they draw quieter (grammar.js SHADOW_FOURTH_OPACITY).
 *
 * A ShadowPlay is { rank, leaf, family, p, name, key, stack, lane, hovered, label: { text, tag, body, at, approx },
 * drawing }, where `drawing` has the Drawing shape (kind "shadow", no ball of its own) and every step carries
 * `dashed: true` and its `opacity`; `snapX` is the ball's x (the stroke starts past it). `lane` is the yards (field y)
 * its stroke moved to stay clear of the others;
 * `stack` counts earlier shadows with the very same shape (none once fanned). `hovered` marks the play the prediction
 * panel is hovering or focusing.
 */
import { LEAVES, deepFreeze } from "../core/domain.js";
import { pct, pct1 } from "../model/format.js";
import {
  LABEL_LINE_YD, SHADOW_FOURTH_OPACITY, SHADOW_LABEL_GAP_YD, SHADOW_OPACITY, familyOfLeaf, isFiniteNum, ownValue,
} from "./grammar.js";
import {
  LABEL_SEP, labelBox, labelFootprint, labelScaleAt, placeLabelText, resolveLabelMetrics,
} from "./play-label.js";
import { laneStrokes } from "./shadow-lanes.js";

/** How many shadows show before a snap (play-drawing.md 4: "maybe show top 2 most likely plays"). */
export const SHADOW_COUNT = 2;
/** A shadow whose arc matches an earlier one's exactly flies this much higher per match, so both stay visible
 * (arc heights are generic; the model predicts depth, not side, so the length and lane stay true). */
export const SHADOW_STACK_LIFT = 0.6;
/** The words before each shadow's on 4th down: he usually kicks, and the model only knows what he calls if he goes. */
export const FOURTH_DOWN_WORDS = "If he goes";
/** Every plate before a snap says what it is (play-drawing.md 4b): "NEXT 1 · Inside run (A/B gap) · 21%" for his
 * predictions, "LAST · Short pass left · +11" for the play before them (the renderers tag the previous play's words). */
export const NEXT_TAG = "NEXT";
export const LAST_TAG = "LAST";

/** The engine's names for the 14 plays (granular.py LEAF_NAMES; the server sends the same in `leaf_names`). */
export const LEAF_NAMES = deepFreeze({
  run_inside: "Inside run (A/B gap)", run_ot_left: "Off-tackle left", run_edge_left: "Outside left (edge)",
  run_ot_right: "Off-tackle right", run_edge_right: "Outside right (edge)",
  dropback_short: "Short (0–9 air yds)", dropback_mid: "Intermediate (10–19)", dropback_deep: "Deep shot (20+)",
  pa_short: "PA short (0–9)", pa_mid: "PA intermediate (10–19)", pa_deep: "PA deep shot (20+)",
  screen: "Screen", rpo_run: "RPO, handed off or kept", rpo_throw: "RPO, thrown",
});

/** The prediction panel's top line names this many plays with whole percentages (pct); its list uses pct1. */
const TOP_LINE = 3;
const NAME_MAX = 60;
const KEY_DIGITS = 4;
const MAX_STACK = 12;
/** A shadow's text may sit over the dimmed previous play's stroke (never over text, a shadow or a mark) to stay within
 * this many lines of its base, under its shadow, rather than drift toward the sideline. */
const NEAR_LINES = 3;

const isProb = (p) => isFiniteNum(p) && p >= 0 && p <= 1;
const isLeaf = (leaf) => typeof leaf === "string" && LEAVES.includes(leaf);
const nameOf = (value) => (typeof value === "string" && value.trim() && value.length <= NAME_MAX ? value.trim() : null);
const entry = (leaf, p, name) => (isLeaf(leaf) && isProb(p) ? { leaf, p, name: nameOf(name) } : null);
const byPDesc = (a, b) => b.p - a.p || LEAVES.indexOf(a.leaf) - LEAVES.indexOf(b.leaf);

function leafName(leaf, leafNames) {
  const given = leafNames && typeof leafNames === "object" ? nameOf(ownValue(leafNames, leaf)) : null;
  return given ?? LEAF_NAMES[leaf];
}

// ---------------------------------------------------------------- inputs
/** /api/state `prediction`: `top` in the model's order, then every leaf of `families`. */
function fromPrediction(prediction) {
  const fams = Array.isArray(prediction.families) ? prediction.families : [];
  const rest = fams.flatMap((f) => (Array.isArray(f?.leaves) ? f.leaves : [])).map((l) => entry(l?.key, l?.p, l?.name));
  return { first: prediction.top.map((t) => entry(t?.key, t?.p, t?.name)), rest };
}

/** A timeline row's `pred` (review and replay): `top3`, weighted by `dist.his_l` in the canonical leaf order. */
function fromPred(pred, leafOrder) {
  const hisL = pred.dist.his_l;
  const rest = LEAVES.map((leaf) => entry(leaf, hisL[leafOrder.indexOf(leaf)], null));
  const named = Array.isArray(pred.top3) ? pred.top3 : [];
  return { first: named.map((leaf) => rest.find((e) => e?.leaf === leaf) ?? null), rest };
}

/** A field view model's ghost input ({ leaves, all }), kept in its own order. */
function fromGhostInput(input) {
  const list = (v) => (Array.isArray(v) ? v : []).map((e) => entry(e?.leaf, e?.p, e?.name));
  return { first: list(input.leaves), rest: list(input.all) };
}

function sourceEntries(source, leafOrder) {
  if (!source || typeof source !== "object") return { first: [], rest: [] };
  if (Array.isArray(source.top)) return fromPrediction(source);
  if (Array.isArray(source.dist?.his_l) && Array.isArray(leafOrder)) return fromPred(source, leafOrder);
  if (Array.isArray(source.leaves)) return fromGhostInput(source);
  return { first: [], rest: [] };
}

/**
 * Every play the source knows, in rank order: the model's own top first, then the rest by probability.
 * @param {object} source  /api/state `prediction`, a row's `pred`, or a ghost input ({ leaves })
 * @param {{ leafNames?: object, leafOrder?: string[] }} [opts]  names (else the source's, else LEAF_NAMES); the
 *   canonical leaf order of `pred.dist` (timeline meta)
 * @returns {ReadonlyArray<{ leaf: string, p: number, rank: number, name: string }>}
 */
export function shadowCandidates(source, { leafNames, leafOrder = LEAVES } = {}) {
  const { first, rest } = sourceEntries(source, leafOrder);
  const ordered = [...first, ...rest.filter(Boolean).sort(byPDesc)].filter(Boolean)
    .filter((e, i, list) => list.findIndex((o) => o.leaf === e.leaf) === i);
  return deepFreeze(ordered.map((e, i) => ({ leaf: e.leaf, p: e.p, rank: i + 1,
    name: e.name ?? leafName(e.leaf, leafNames) })));
}

// ---------------------------------------------------------------- geometry (play-drawing.md 4 and 4b: shadow-lanes.js)
function boundsOf(step) {
  const xs = [step.from.x, step.to.x];
  const ys = [step.from.y, step.to.y];
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys),
    h: step.t === "arc" ? step.apex : 0 };
}

// ---------------------------------------------------------------- labels
/**
 * The plate's words (play-drawing.md 4b): its tag, "NEXT 1" (rank 1), and its body, the engine's name and the
 * percentage exactly as the prediction panel shows it; `text` reads them together: "NEXT 1 · Deep shot (20+) · 31%",
 * on 4th down "NEXT 1 · If he goes · Short (0–9 air yds) · 41%". With no rank the tag is "NEXT".
 */
function labelWords(rank, name, p, fourth) {
  const percent = rank !== null && rank <= TOP_LINE ? pct(p) : pct1(p);
  const tag = rank === null ? NEXT_TAG : `${NEXT_TAG} ${rank}`;
  const body = [fourth ? FOURTH_DOWN_WORDS : "", name, percent].filter(Boolean).join(LABEL_SEP);
  return { tag, body, text: [tag, body].join(LABEL_SEP) };
}

const dot = (p, axis) => p.x * axis.x + p.y * axis.y;
const textAxisOf = (m) => ({ x: -m.down.y, y: m.down.x });

/** Underneath the stroke as the view shows it: centered on it along the text (u), a gap below its lowest point (v;
 * the gap keeps its share of a line, SHADOW_LABEL_GAP_YD at the default LABEL_LINE_YD). */
function baseOf(stroke, m) {
  const t = textAxisOf(m);
  const gap = (m.lineYd * SHADOW_LABEL_GAP_YD) / LABEL_LINE_YD;
  return { u: (dot(stroke.from, t) + dot(stroke.to, t)) / 2,
    v: Math.max(dot(stroke.from, m.down), dot(stroke.to, m.down)) + gap };
}

/** Half a line's depth at v (play-label labelBox: past the line of scrimmage a perspective view's line is deeper). */
const halfLine = (m, v) => (m.lineYd * labelScaleAt(m, v)) / 2;

/**
 * The lines the words can sit on, as v (down the screen) by index: 0 the base, k > 0 the k-th line down (nearer the
 * camera, where a line is never deeper than the one above it), -k the k-th line up. Each line is far enough from the
 * one below that their boxes never meet, also past the line of scrimmage, where each line up is deeper than the last.
 */
function lineGrid(v0, m, count) {
  const shrink = 1 - (m.grow * m.lineYd) / 2;           // play-label caps grow, so this stays at least 0.75
  const walk = (next) => Array.from({ length: count }).reduce((vs) => [...vs, next(vs.at(-1))], [v0]);
  const down = walk((v) => v + 2 * halfLine(m, v));
  const up = walk((v) => v - (2 * halfLine(m, v)) / shrink);
  return (k) => (k >= 0 ? down[k] : up[-k]);
}

/** The block's first line: down from the base, then up from it. */
const BLOCK_LINES = Object.freeze([...Array.from({ length: MAX_STACK }, (_, k) => k),
  ...Array.from({ length: MAX_STACK }, (_, k) => -k - 1)]);

const isPt = (p) => isFiniteNum(p?.x) && isFiniteNum(p?.y);
const drawingOf = (a) => (Array.isArray(a.drawing?.steps) ? a.drawing : Array.isArray(a.steps) ? a : null);

/** What the text must clear besides the shadows: labels (`{ text, at }`), drawings (paths.buildDrawing: their
 * strokes, marks and label) and other ShadowPlays (their drawing). A real play's strokes are `dimmed` (soft); every
 * label, mark and shadow stroke is `hard`. */
function blockersOf(avoid, m) {
  const items = (Array.isArray(avoid) ? avoid : []).filter((a) => a && typeof a === "object");
  const drawings = items.map(drawingOf).filter(Boolean);
  const labels = items.map((a) => (drawingOf(a) ? drawingOf(a).label : a)).filter((l) => isPt(l?.at));
  const soft = (d, st) => d.kind !== "shadow" && st?.t !== "mark";
  const where = (keep) => labelFootprint(drawings.flatMap((d) => d.steps.filter((st) => keep(soft(d, st)))), m);
  return { boxes: labels.map((l) => labelBox(l, m)), hard: where((x) => !x), dimmed: where((x) => x) };
}

/**
 * The block's spots with its first line on line k: member j on line k + j, centered on its own shadow, each clear of
 * `boxes` (and of the block's words above it) and of `points`; null when one isn't (`strict`), or off the field.
 */
function blockAt(k, block, { boxes, points, m, line, strict = true }) {
  const t = textAxisOf(m);
  const placed = block.reduce((acc, item, j) => {
    if (!acc) return null;
    const v = line(k + j);
    const at = placeLabelText(item.text, [{ x: item.u * t.x + v * m.down.x, y: item.u * t.y + v * m.down.y }],
      { boxes: acc.boxes, points, metrics: m, strict });
    return at ? { boxes: [...acc.boxes, labelBox({ text: item.text, at }, m)], spots: [...acc.spots, at] } : null;
  }, { boxes, spots: [] });
  return placed?.spots ?? null;
}

/** The first of `lines` where the whole block fits, or null. */
function firstFit(lines, block, ctx) {
  for (const k of lines) {
    const spots = blockAt(k, block, ctx);
    if (spots) return spots;
  }
  return null;
}

/** All the lines, top to bottom (up past the base, the base, then down). */
const ALL_LINES = Object.freeze([...BLOCK_LINES].sort((a, b) => a - b));

/**
 * The block in rank order with room between where it needs it: #1 on the first line from the base (down, then up)
 * where it is clear, each next member on the first clear line below the one before (a crowded view: a phone's deep
 * lines, the previous play's words in the way). Null when one has no line.
 */
function orderedFit(block, { boxes, points, m, line }) {
  const t = textAxisOf(m);
  /** `item` on line k, clear of what is placed so far (`acc.boxes`): the stack grown by it, or null. */
  const place = (item, k, acc) => {
    const v = line(k);
    const at = placeLabelText(item.text, [{ x: item.u * t.x + v * m.down.x, y: item.u * t.y + v * m.down.y }],
      { boxes: acc.boxes, points, metrics: m, strict: true });
    return at ? { k, boxes: [...acc.boxes, labelBox({ text: item.text, at }, m)], spots: [...acc.spots, at] } : null;
  };
  const below = (item, acc) => ALL_LINES.filter((k) => k > acc.k).reduce((hit, k) => hit ?? place(item, k, acc), null);
  for (const k0 of BLOCK_LINES) {
    const first = place(block[0], k0, { boxes, spots: [] });
    const placed = first && block.slice(1).reduce((acc, item) => (acc ? below(item, acc) : null), first);
    if (placed) return placed.spots;
  }
  return null;
}

/**
 * The words as one block in rank order, #1 on top, from under #1's shadow: the first line where every member is
 * clear of everything; else, within NEAR_LINES, one where they only cross the dimmed previous play's strokes; else
 * the first line clear of everything further on; else in order with a line skipped where one is taken; then the same
 * clear of other text at least (never text on text); then, a view too crowded for that (a phone's deep lines), in
 * order clear of each other only, over the dimmed previous words (never #2 over #1); else the base line as it is.
 */
function placeBlock(block, { boxes, hard, all, m, line }) {
  const near = BLOCK_LINES.slice(0, NEAR_LINES);
  const ctx = { boxes, m, line };
  return firstFit(near, block, { ...ctx, points: all }) ?? firstFit(near, block, { ...ctx, points: hard })
    ?? firstFit(BLOCK_LINES, block, { ...ctx, points: all }) ?? orderedFit(block, { ...ctx, points: all })
    ?? firstFit(BLOCK_LINES, block, { ...ctx, points: [] }) ?? orderedFit(block, { ...ctx, points: [] })
    ?? orderedFit(block, { ...ctx, boxes: [], points: [] })
    ?? blockAt(0, block, { ...ctx, points: all, strict: false });
}

// ---------------------------------------------------------------- the shadows
function snapOf(sit) {
  const ok = sit && sit.kind !== "kickoff" && isFiniteNum(sit.ballX) && (sit.dir === 1 || sit.dir === -1);
  return ok ? { ballX: sit.ballX, dir: sit.dir, poss: sit.poss ?? null, fourth: sit.down === 4 } : null;
}

function opacityOf(rank, fourth) {
  const scale = fourth ? SHADOW_FOURTH_OPACITY : SHADOW_OPACITY;
  return scale[rank === null ? scale.length - 1 : Math.min(rank, scale.length) - 1];
}

function shadowOf(pick, { stroke, stack, lane }, label, sit) {
  const opacity = opacityOf(pick.rank, sit.fourth);
  const step = { ...stroke, approx: true, ghosted: false, dashed: true, opacity };
  const drawing = {
    kind: "shadow", seq: null, id: `shadow:${pick.leaf}`, team: sit.poss, dir: sit.dir, offenseIsCaller: true,
    ghosted: false, dashed: true, opacity, steps: [step], ballStart: null, ballEnd: null, resultLabel: null,
    label, bounds: boundsOf(step), snapX: sit.ballX,
  };
  const key = [pick.leaf, pick.rank, sit.ballX, sit.dir, pick.p.toFixed(KEY_DIGITS), sit.fourth ? "4th" : ""].join(":");
  return { rank: pick.rank, leaf: pick.leaf, family: familyOfLeaf(pick.leaf), p: pick.p, name: pick.name, key, stack,
    lane, hovered: Boolean(pick.hovered), label, drawing };
}

const sameShape = (a, b) => a.t === b.t && a.to.x === b.to.x && a.to.y === b.to.y;

/** Each stroke with its `stack`: how many earlier strokes have the same shape (with lanes, none do: a stacked arc
 * flies higher all the same), and its `lane`. */
function stackStrokes(laned) {
  const strokes = laned.map((l) => l.stroke);
  return strokes.map((stroke, i) => {
    const stack = strokes.slice(0, i).filter((o) => sameShape(o, stroke)).length;
    const apex = stroke.t === "arc" ? { apex: stroke.apex * (1 + SHADOW_STACK_LIFT * stack) } : {};
    return { stroke: { ...stroke, ...apex }, stack, lane: laned[i].lane };
  });
}

/** The real plays' strokes in `avoid` (the previous play's: never another shadow's), which the shadows' lanes keep
 * clear of where they lie in their way (shadow-lanes.js). */
const realSteps = (avoid) => (Array.isArray(avoid) ? avoid : []).filter((a) => a && typeof a === "object")
  .map(drawingOf).filter((d) => d && d.kind !== "shadow").flatMap((d) => d.steps);

/** Strokes first, so every label knows every stroke (and the ball); then the words as one block in rank order (#1 on
 * top, each centered on its own shadow), clear of everything in `avoid`. */
function layOut(picks, sit, { avoid, metrics }) {
  if (!picks.length) return [];
  const m = resolveLabelMetrics(metrics);
  const stacked = stackStrokes(laneStrokes(picks, sit, { avoid: realSteps(avoid) }));
  const blockers = blockersOf(avoid, m);
  const hard = [...labelFootprint(stacked.map((s) => s.stroke), m), ...blockers.hard];
  const all = [...hard, ...blockers.dimmed];
  const block = picks.map((pick, i) => ({ ...labelWords(pick.rank, pick.name, pick.p, sit.fourth),
    u: baseOf(stacked[i].stroke, m).u }));
  const line = lineGrid(baseOf(stacked[0].stroke, m).v, m, MAX_STACK + picks.length);
  const spots = placeBlock(block, { boxes: blockers.boxes, hard, all, m, line });
  return picks.map((pick, i) => shadowOf(pick, stacked[i],
    { text: block[i].text, tag: block[i].tag, body: block[i].body, at: spots[i], approx: true }, sit));
}

/**
 * The shadow plays before a snap: the `count` most likely plays (default 2), in rank order, plus the `hover`ed play
 * when it is not one of them (play-drawing.md 4: hovering or focusing a play in the prediction panel highlights its
 * shadow, and draws one for a play outside the top 2). Every label is laid out against every stroke, so the top
 * plays' text can step down a line to clear the hovered stroke: place labels from each result. [] without a snap
 * situation (no ball, a kickoff) or without a usable prediction.
 * @param {object} source  /api/state `prediction` (`top` order), a row's `pred` (`top3`), or a ghost input
 * @param {object} situation  a snap Situation (paths.situationFromRow, vm-field): ballX, dir, poss
 * @param {{ count?: number, leafNames?: object, leafOrder?: string[], avoid?: object[], hover?: string,
 *   metrics?: object }} [opts]  avoid: what is already on the field that the text must not cover: the previous
 *   play's Drawing (its strokes, marks and label), labels ({ text, at }), ShadowPlays. metrics: the view's label
 *   metrics (play-label.labelMetrics; the sideline cameras by default)
 * @returns {ReadonlyArray<object>} frozen ShadowPlays
 */
export function buildShadowPlays(source, situation, { count = SHADOW_COUNT, leafNames, leafOrder = LEAVES, avoid = [],
  hover = null, metrics } = {}) {
  const sit = snapOf(situation);
  const n = Number.isInteger(count) && count > 0 ? count : 0;
  if (!sit || !n) return deepFreeze([]);
  const all = shadowCandidates(source, { leafNames, leafOrder });
  const top = all.slice(0, n);
  const extra = top.some((c) => c.leaf === hover) ? [] : all.filter((c) => c.leaf === hover);
  const picks = [...top, ...extra.map((c) => ({ ...c, extra: true }))]
    .map((c) => ({ ...c, hovered: c.leaf === hover }));
  return deepFreeze(layOut(picks, sit, { avoid, metrics }));
}

/**
 * One play's shadow on its own (hovered), any of the 14 plays, labelled with its rank (null: no number) and drawn at
 * the lowest shadow opacity past #1. buildShadowPlays' `hover` is the whole picture (it can also move the top
 * plays' text off the hovered stroke); this only steps its own text clear of `avoid`.
 * @param {{ name?: string, leafNames?: object, avoid?: object[], metrics?: object }} [opts]  avoid: as
 *   buildShadowPlays' (the shadows already shown, say)
 * @returns {object | null} a frozen ShadowPlay, or null for an unknown leaf, a bad probability or no snap
 */
export function shadowForLeaf(leaf, p, situation, rank, { name, leafNames, avoid = [], metrics } = {}) {
  const sit = snapOf(situation);
  if (!sit || !isLeaf(leaf) || !isProb(p)) return null;
  const pick = { leaf, p, rank: Number.isInteger(rank) && rank > 0 ? rank : null,
    name: nameOf(name) ?? leafName(leaf, leafNames), hovered: true };
  return deepFreeze(layOut([pick], sit, { avoid, metrics })[0]);
}
