/**
 * @deprecated since 2026-10-09 (v1.4): use field/shadows.js. docs/design/play-drawing.md (Sam's binding direction)
 * replaces these zones and bands with shadow plays: the top 2 drawn as dashed, translucent arcs and lines from the
 * line of scrimmage (`buildShadowPlays`, `shadowForLeaf`). This module stays, unchanged, until every renderer has
 * moved over.
 *
 * Prediction -> ghost geometry before the snap (directions.md: "Category zones and lanes before the snap, weighted
 * by probability ... Zones, never routes; no player figures anywhere"). Pure: no DOM, no three.js.
 *
 *   shapes       the top 3 calls (ui-architecture.md 2.4): run leaves and rpo_run are lanes through their gap,
 *                pass leaves, rpo_throw and screen are full-width depth bands (pass leaves carry no side).
 *   leafZones    all 14 specific plays from the full distribution, weight = p / the largest p.
 *   familyZones  the 5 families (run, dropback, play-action, screen, RPO), each the union of its leaves' shapes.
 * Shapes with identical extents keep separate entries with `stack` 0, 1, 2 in rank order, so highlightGhost(leaf)
 * still finds each one.
 */
import { FAMILIES, LEAVES, deepFreeze } from "../core/domain.js";
import { FIELD, clampY, depthSpan, yFromLateral } from "./coords.js";
import {
  GHOST_DEPTH, GHOST_FAMILY, GHOST_PASS_HALF_SPAN, GHOST_RUN, LABEL_CLEAR_X, LABEL_STACK_OFFSET, MIN_BAND_YD,
  bucketOfLeaf, familyOfLeaf, isFiniteNum, ownValue,
} from "./grammar.js";

const C = FIELD.CENTER_Y;
const MAX_SHAPES = 3;
const KEY_DIGITS = 4;
const LABEL_EDGE_YD = 1;
const EPS = 1e-9;

const isProb = (p) => isFiniteNum(p) && p >= 0 && p <= 1;

// ---------------------------------------------------------------- inputs
const leafEntry = (leaf, p) => (LEAVES.includes(leaf) && isProb(p) ? { leaf, p } : null);
const familyEntry = (family, p) => (FAMILIES.includes(family) && isProb(p) ? { family, p } : null);
const byPDesc = (a, b) => b.p - a.p;

/** @deprecated use shadows.js buildShadowPlays(prediction, situation), which reads `prediction.top` itself.
 * Ghost input from /api/state `prediction`: the top 3 (`top`), plus every leaf and family from `families`. */
export function ghostInputFromPrediction(prediction) {
  const top = Array.isArray(prediction?.top) ? prediction.top : [];
  const leaves = top.map((t) => leafEntry(t?.key, t?.p)).filter(Boolean).slice(0, MAX_SHAPES);
  if (!leaves.length) return null;
  const fams = Array.isArray(prediction.families) ? prediction.families : [];
  const leafP = new Map(fams.flatMap((f) => (Array.isArray(f?.leaves) ? f.leaves : []).map((l) => [l?.key, l?.p])));
  const famP = new Map(fams.map((f) => [f?.key, f?.p]));
  return deepFreeze({
    leaves,
    all: LEAVES.map((leaf) => leafEntry(leaf, leafP.get(leaf))).filter(Boolean),
    families: FAMILIES.map((family) => familyEntry(family, famP.get(family))).filter(Boolean),
  });
}

/**
 * @deprecated use shadows.js buildShadowPlays(row.pred, situation, { leafOrder }), which reads `pred` itself.
 * Ghost input from a timeline row's `pred` (review and replay): `top3` weighted by `dist.his_l`, plus the whole
 * tree. `leafOrder` and `familyOrder` are the canonical orders the arrays follow (timeline `meta`).
 */
export function ghostInputFromPred(pred, leafOrder = LEAVES, familyOrder = FAMILIES) {
  const hisL = pred?.dist?.his_l;
  if (!Array.isArray(hisL) || !Array.isArray(leafOrder)) return null;
  const all = LEAVES.map((leaf) => leafEntry(leaf, hisL[leafOrder.indexOf(leaf)])).filter(Boolean);
  const named = Array.isArray(pred.top3) ? pred.top3 : [];
  const fromTop = named.map((leaf) => all.find((e) => e.leaf === leaf)).filter(Boolean);
  const leaves = (fromTop.length ? fromTop : [...all].sort(byPDesc)).slice(0, MAX_SHAPES);
  if (!leaves.length) return null;
  const hisF = Array.isArray(pred.dist.his_f) && Array.isArray(familyOrder) ? pred.dist.his_f : [];
  const families = FAMILIES.map((f) => familyEntry(f, hisF[familyOrder.indexOf(f)])).filter(Boolean);
  return deepFreeze({ leaves, all, families });
}

// ---------------------------------------------------------------- geometry
function bandAt(range, ballX, dir) {
  const span = depthSpan(ballX, dir, range, MIN_BAND_YD);
  return { kind: "band", x0: span.x0, x1: span.x1, y0: clampY(C - GHOST_PASS_HALF_SPAN),
    y1: clampY(C + GHOST_PASS_HALF_SPAN), clamped: span.clamped };
}

function laneAt(range, L, halfWidth, ballX, dir) {
  const span = depthSpan(ballX, dir, range, MIN_BAND_YD);
  return { kind: "corridor", x0: span.x0, x1: span.x1, yC: clampY(yFromLateral(L, dir)), halfWidth,
    clamped: span.clamped };
}

function leafGeometry(leaf, ballX, dir) {
  const lane = ownValue(GHOST_RUN, leaf);
  if (lane) return laneAt(GHOST_DEPTH.run, lane[0], lane[1], ballX, dir);
  return bandAt(GHOST_DEPTH[bucketOfLeaf(leaf)], ballX, dir);
}

function familyGeometry(family, ballX, dir) {
  const spec = GHOST_FAMILY[family];
  return spec.kind === "corridor"
    ? laneAt(spec.depth, spec.L, spec.halfWidth, ballX, dir)
    : bandAt(spec.depth, ballX, dir);
}

const extentKey = (g) => (g.kind === "band"
  ? `b:${g.x0}:${g.x1}:${g.y0}:${g.y1}`
  : `c:${g.x0}:${g.x1}:${g.yC}:${g.halfWidth}`);

/**
 * Rank (1 = most likely), weight (p / the largest p) and stack (index among identical extents, in rank order).
 * `presorted` items are already in rank order (the top 3 as the model listed them).
 */
function ranked(items, { presorted = false } = {}) {
  const maxP = Math.max(0, ...items.map((i) => i.p));
  const order = presorted ? items : [...items].sort(byPDesc);
  return items.map((item) => {
    const rank = order.indexOf(item) + 1;
    const stack = order.slice(0, rank - 1).filter((o) => extentKey(o) === extentKey(item)).length;
    return { ...item, rank, weight: maxP > 0 ? item.p / maxP : 0, stack };
  });
}

// ---------------------------------------------------------------- labels
const labelBase = (g) => (g.kind === "corridor" ? { x: g.x1, y: g.yC } : { x: (g.x0 + g.x1) / 2, y: C });
const isClear = (c, placed) => placed.every((p) => Math.abs(p.x - c.x) >= LABEL_CLEAR_X
  || Math.abs(p.y - c.y) >= LABEL_STACK_OFFSET - EPS);

/** The first spot clear of every placed label: toward the near sideline first, then the far one. */
function freeLabel(base, placed) {
  const steps = Array.from({ length: 2 * placed.length + 1 }, (_, i) => i);
  const offsets = [...steps.map((i) => -i), ...steps.slice(1)];
  const onField = offsets.map((i) => ({ x: base.x, y: base.y + i * LABEL_STACK_OFFSET }))
    .filter((c) => c.y >= LABEL_EDGE_YD && c.y <= FIELD.WIDTH - LABEL_EDGE_YD);
  return onField.find((c) => isClear(c, placed)) ?? { x: base.x, y: clampY(base.y) };
}

function placeLabels(shapes) {
  const spots = shapes.reduce((placed, s) => [...placed, freeLabel(labelBase(s), placed)], []);
  return shapes.map((s, i) => ({ ...s, label: { at: spots[i] } }));
}

// ---------------------------------------------------------------- the set
const keyPart = (entries, name) => entries.map((e) => `${e[name]}:${e.p.toFixed(KEY_DIGITS)}`).join(",");

function keyOf(input, ballX, dir, leaves) {
  return [`${ballX}`, `${dir}`, keyPart(leaves, "leaf"), keyPart(input.all ?? [], "leaf"),
    keyPart(input.families ?? [], "family")].join("|");
}

const validLeaves = (list) => (Array.isArray(list) ? list.filter((e) => leafEntry(e?.leaf, e?.p)) : []);
const validFamilies = (list) => (Array.isArray(list) ? list.filter((e) => familyEntry(e?.family, e?.p)) : []);

/**
 * @deprecated use shadows.js buildShadowPlays(input, situation): shadow plays, not zones (play-drawing.md 4).
 * The ghosts for a situation: the top 3 shapes with labels, plus weighted zones for every leaf and family the input
 * carries. Null without a snap situation (no ball, a kickoff) or without a valid call.
 */
export function buildGhostSet(input, sit) {
  const snap = sit && sit.kind !== "kickoff" && isFiniteNum(sit.ballX) && (sit.dir === 1 || sit.dir === -1);
  if (!input || !snap) return null;
  const { ballX, dir } = sit;
  const leaves = validLeaves(input.leaves).slice(0, MAX_SHAPES);
  if (!leaves.length) return null;
  const shapes = placeLabels(ranked(leaves.map((e) => ({ leaf: e.leaf, family: familyOfLeaf(e.leaf), p: e.p,
    ...leafGeometry(e.leaf, ballX, dir) })), { presorted: true }));
  const all = validLeaves(input.all);
  const fams = validFamilies(input.families);
  return deepFreeze({
    key: keyOf({ all, families: fams }, ballX, dir, leaves),
    ballX,
    dir,
    shapes,
    leafZones: ranked(all.map((e) => ({ leaf: e.leaf, family: familyOfLeaf(e.leaf), p: e.p,
      ...leafGeometry(e.leaf, ballX, dir) }))),
    familyZones: ranked(fams.map((e) => ({ family: e.family, p: e.p, ...familyGeometry(e.family, ballX, dir) }))),
  });
}
