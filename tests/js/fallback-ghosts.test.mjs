// field/fallback-ghosts.js (A6): before a caller snap, his top 2 plays as shadow plays on the 2D field
// (docs/design/play-drawing.md 4 and 4b, binding): the same shapes as real plays, each past the ball in its own lane,
// thin and dashed, #1 amber and #2 warm white, each with a tagged plate "NEXT 1 · Inside run (A/B gap) · 27%"; a
// hovered play lit (and drawn when outside the top 2).
import assert from "node:assert/strict";
import test from "node:test";

import {
  SHADOW_HOVER_OPACITY, shadowInput, shadowLayer, shadowPaint, shadowPlaysFor, shownLeaves, viewMetrics,
} from "../../static/js/field/fallback-ghosts.js";
import { OBLIQUE, layoutPlane, sceneContext } from "../../static/js/field/fallback-draw.js";
import { PASS_LIFT } from "../../static/js/field/fallback-steps.js";
import { buildGhostSet, ghostInputFromPred } from "../../static/js/field/ghosts.js";
import { buildDrawing, situationFromRow } from "../../static/js/field/paths.js";
import { labelBox } from "../../static/js/field/play-label.js";
import { buildShadowPlays } from "../../static/js/field/shadows.js";
import { resolveLook } from "../../static/js/theme/look-schema.js";
import { NEUTRAL_LOOK } from "../../static/js/theme/neutral-look.js";
import { META_LEAVES, capture, rowById, rowBySeq } from "./field-rows.mjs";

const T = capture();
const C = 26.667;
const ctxFor = (look = NEUTRAL_LOOK, size = { width: 1440, height: 900 }) => sceneContext({ look,
  layout: layoutPlane(size), field: T.field, teams: T.teams, teamOrder: T.team_order, ids: "g1" });
const firstSnap = rowById("40187298068");
const SIT = situationFromRow(firstSnap);
const SET = buildGhostSet(ghostInputFromPred(firstSnap.pred), SIT);
const INPUT = shadowInput(SET, SIT);
const near = (a, b, label = "", eps = 0.02) => assert.ok(Math.abs(a - b) <= eps, `${label} ${a} != ${b}`);

function walk(nodes, out = []) {
  for (const n of nodes ?? []) {
    out.push(n);
    walk(n.children, out);
  }
  return out;
}
const textOf = (label) => walk([label.node]).find((n) => n.tag === "text").text;
const strokes = (zone) => walk([zone.node]).filter((n) => ["edge", "core"].includes(n.attrs?.["data-stroke"]));
const layerOf = (opts = {}, ctx = ctxFor()) => shadowLayer(shadowPlaysFor(INPUT, ctx, opts), ctx);

test("the conductor's GhostSet becomes a shadow request: his order, his odds, the snap and the team with the ball", () => {
  assert.deepEqual(INPUT.situation, { ballX: 30, dir: 1, poss: "DAL", kind: "snap", down: 1 },
    "the down comes from the snap on the field (the GhostSet carries none)");
  assert.equal(shadowInput(SET, { ...SIT, ballX: 31 }).situation.down, undefined, "another snap's down is not this one's");
  assert.equal(INPUT.key, SET.key);
  assert.deepEqual(shownLeaves(INPUT), ["run_inside", "pa_short"], "the top 2");
  const own = shadowInput({ source: firstSnap.pred, situation: SIT, leafOrder: META_LEAVES });
  assert.deepEqual(shownLeaves(own), ["run_inside", "pa_short"], "a request of its own: a row's pred");
  const built = shadowInput(buildShadowPlays(firstSnap.pred, SIT));
  assert.deepEqual(shownLeaves(built), ["run_inside", "pa_short"], "ShadowPlays the caller already built");
  assert.deepEqual(built.situation, { ballX: 30, dir: 1, poss: "DAL", kind: "snap" });
  for (const nothing of [null, 7, {}, { shapes: [], ballX: 30, dir: 1 }, { source: firstSnap.pred }]) {
    assert.equal(shadowInput(nothing, null), null, JSON.stringify(nothing));
  }
  const kickoff = { source: firstSnap.pred, situation: { ...SIT, kind: "kickoff" }, leafOrder: META_LEAVES };
  assert.equal(shadowInput(kickoff), null, "no shadows on a kickoff");
  assert.deepEqual(shownLeaves(null), []);
});

test("the top 2 as shadow plays: a run a line on the turf, a pass an arc, each from 1.5 yd past the ball in its lane", () => {
  const ctx = ctxFor();
  const layer = layerOf();
  assert.deepEqual(layer.zones.map((z) => [z.key, z.rank, z.opacity]), [["run_inside", 1, 0.95], ["pa_short", 2, 0.83]],
    "4b: thin lines carry more ink, #2 slightly fainter");
  const [run, pass] = layer.zones;
  assert.deepEqual([run.node.attrs.class, run.node.attrs["data-part"], run.node.attrs["data-leaf"]],
    ["sc-fb-shadow", "shadow", "run_inside"]);
  const line = walk([run.node]).find((n) => n.attrs?.["data-stroke"] === "core" && n.attrs["data-role"] === "line");
  const [ax, ay, bx, by] = line.attrs.d.match(/-?\d+(\.\d+)?/g).map(Number);
  const [a, b] = [ctx.pt(31.5, C - 2), ctx.pt(35.5, C - 2)];
  near(ax, a.px, "1.5 yd past the line of scrimmage, in the near lane");
  near(ay, a.py);
  near(bx, b.px, "4 yards on, straight ahead (A/B gap)");
  near(by, b.py);
  const arc = walk([pass.node]).find((n) => n.attrs?.["data-stroke"] === "core" && n.attrs["data-role"] === "line");
  assert.match(arc.attrs.d, /Q/, "play-action short flies: an arc");
  near(Number(arc.attrs.d.match(/-?\d+(\.\d+)?/g)[4]), ctx.pt(36, C + 2).px, "6 air yards, the far lane");
  assert.equal(run.dir, 1);
});

test("4b: shadows are thin dashed lines over a thin dark ring, a small arrowhead on a run, a tick on a pass", () => {
  for (const zone of layerOf().zones) {
    const all = strokes(zone);
    const lines = all.filter((n) => n.attrs["data-role"] === "line");
    assert.equal(lines.length, 2, `${zone.key}: a core and its ring`);
    assert.ok(lines.every((n) => n.attrs["stroke-dasharray"]), `${zone.key}: dashed`);
    const core = lines.find((n) => n.attrs["data-stroke"] === "core");
    assert.ok(Number(core.attrs["stroke-width"]) >= 2 && Number(core.attrs["stroke-width"]) <= 3.5, "thin");
    assert.ok(Number(lines.find((n) => n.attrs["data-stroke"] === "edge").attrs["stroke-width"])
      <= Number(core.attrs["stroke-width"]) + 3, "a thin ring, never a band");
    const end = all.find((n) => n.attrs["data-role"] === "end" && n.attrs["data-stroke"] === "core");
    assert.ok(end, `${zone.key}: an end mark`);
    assert.equal((end.attrs.d.match(/L/g) ?? []).length, zone.key === "run_inside" ? 2 : 1, "arrowhead / tick");
    assert.equal(zone.node.attrs["data-hovered"], "false");
  }
});

test("each plate: 'NEXT 1' on a tab in its colour, then its words; a tagged plate placed later in screen space", () => {
  const ctx = ctxFor();
  const shadows = shadowPlaysFor(INPUT, ctx);
  const layer = shadowLayer(shadows, ctx);
  const words = (l) => walk([l.node]).filter((n) => n.tag === "text" && n.attrs["data-role"] !== "sep").map((n) => n.text);
  assert.deepEqual(layer.labels.map(words), [["NEXT 1", "Inside run (A/B gap) · 27%"], ["NEXT 2", "PA short (0–9) · 16%"]]);
  assert.deepEqual(layer.labels.map((l) => [l.key, l.rank, l.opacity]), [["run_inside", 1, 1], ["pa_short", 2, 1]]);
  const tag = layer.labels[0].node;
  assert.match(tag.attrs.class, /\bsc-ghost-label\b.*\brank-1\b/);
  assert.match(tag.attrs.class, /\bsc-fb-plate\b/);
  assert.equal(tag.attrs["data-part"], "shadow-label");
  assert.equal(tag.attrs["data-plate"], "next-1");
  const tab = walk([tag]).find((n) => n.attrs?.["data-role"] === "tab");
  assert.equal(tab.attrs.fill, shadowPaint(ctx, 1).core, "the tab wears its prediction's colour");
  assert.equal(walk([layer.labels[1].node]).find((n) => n.attrs?.["data-role"] === "tab").attrs.fill,
    shadowPaint(ctx, 2).core);
});

test("hovering a play outside the top 2 draws its shadow too, lit, and dims the others", () => {
  const layer = layerOf({ hover: "screen" });
  assert.deepEqual(layer.zones.map((z) => z.key), ["run_inside", "pa_short", "screen"]);
  const op = Object.fromEntries(layer.zones.map((z) => [z.key, z.opacity]));
  assert.equal(op.screen, SHADOW_HOVER_OPACITY);
  assert.ok(op.run_inside < 0.95 && op.pa_short < 0.83, "the rest step back");
  assert.equal(layer.zones[2].node.attrs["data-hovered"], "true");
  assert.deepEqual(walk([layer.labels[2].node]).filter((n) => n.tag === "text" && n.attrs["data-role"] !== "sep")
    .map((n) => n.text), ["NEXT 10", "Screen · 2.8%"], "his rank and pct1 past the top line");
  assert.ok(layer.labels[0].opacity < 1 && layer.labels[2].opacity === 1);
  const top = layerOf({ hover: "pa_short" });
  assert.deepEqual(top.zones.map((z) => z.key), ["run_inside", "pa_short"], "a top-2 play is only lit");
  assert.equal(top.zones[1].opacity, SHADOW_HOVER_OPACITY);
  assert.deepEqual(layerOf({ hover: "not_a_leaf" }).zones.map((z) => z.opacity), [0.95, 0.83]);
});

test("on 4th down the plates read 'If he goes' and the lines draw quieter, from the GhostSet and from a review", () => {
  const fourth = { ...SIT, down: 4, togo: 6 };
  const input = shadowInput(buildGhostSet(ghostInputFromPred(firstSnap.pred), fourth), fourth);
  const ctx = ctxFor();
  const layer = shadowLayer(shadowPlaysFor(input, ctx), ctx);
  assert.deepEqual(layer.zones.map((z) => [z.key, z.opacity]), [["run_inside", 0.83], ["pa_short", 0.75]]);
  const body = (l) => walk([l.node]).filter((n) => n.tag === "text").map((n) => n.text).join("");
  assert.deepEqual(layer.labels.map(body), ["NEXT 1 · If he goes · Inside run (A/B gap) · 27%",
    "NEXT 2 · If he goes · PA short (0–9) · 16%"]);
  const go = rowBySeq(130);
  const review = shadowInput(buildGhostSet(ghostInputFromPred(go.pred), situationFromRow(go)), situationFromRow(go));
  assert.match(body(shadowLayer(shadowPlaysFor(review, ctx), ctx).labels[0]), /^NEXT 1 · If he goes · /,
    "reviewing his 4th-and-3 go");
  const request = shadowInput({ source: firstSnap.pred, situation: fourth, leafOrder: META_LEAVES });
  assert.equal(request.situation.down, 4);
  assert.deepEqual(layerOf().zones.map((z) => z.opacity), [0.95, 0.83], "1st down: as loud as ever");
});

test("the shadows' text keeps clear of the previous play's words, which stay on the field dimmed", () => {
  const ctx = ctxFor();
  const prev = buildDrawing(rowBySeq(2));
  const next = rowBySeq(3);
  const input = shadowInput(buildGhostSet(ghostInputFromPred(next.pred), situationFromRow(next)), situationFromRow(next));
  const shadows = shadowPlaysFor(input, ctx, { avoid: [prev] });
  const m = viewMetrics(ctx, situationFromRow(next).ballX);
  const old = labelBox(prev.label, m);
  for (const s of shadows) {
    const box = labelBox(s.label, m);
    const apart = Math.abs(box.v - old.v) >= box.hh + old.hh - 1e-9 || Math.abs(box.u - old.u) >= box.hw + old.hw - 1e-9;
    assert.ok(apart, `${s.label.text} clear of "${prev.label.text}"`);
  }
});

test("the 2D view as label metrics: straight down from above, a height drawn as a lift up the screen", () => {
  const ctx = ctxFor();
  const m = viewMetrics(ctx, 30, { charPx: 9, linePx: 30, padPx: 12 });
  assert.deepEqual(m.down, { x: 0, y: -1 }, "down the screen is toward the near sideline");
  assert.deepEqual(m.lifts, [OBLIQUE, PASS_LIFT], "a kick tilts by OBLIQUE, a pass bows by its height");
  near(m.charYd, 9 / ctx.layout.px, "a character in yards at this size", 1e-9);
  near(m.lineYd, 30 / ctx.layout.px, "", 1e-9);
  const wider = shadowPlaysFor(INPUT, ctx, { labelPx: { charPx: 9, linePx: 30, padPx: 12 } });
  assert.equal(wider.length, 2);
});

test("4b: colour-coded by rank, never by team or family: #1 the world's amber, #2 warm white; dashes square-ended", () => {
  const ctx = ctxFor(resolveLook({ ghost: { fill: "team", style: "pixel" }, world: { plays: { ranks: ["#ffb21e",
    "#fff3d1"] } } }));
  assert.deepEqual(shadowPaint(ctx, 1).core, "#ffb21e");
  assert.deepEqual(shadowPaint(ctx, 2).core, "#fff3d1");
  assert.deepEqual(shadowPaint(ctx, 7).core, "#fff3d1", "a hovered third play in warm white");
  assert.notEqual(shadowPaint(ctx, 1).edge, shadowPaint(ctx, 1).core, "a darker ring keeps it readable on paint");
  const layer = shadowLayer(shadowPlaysFor(INPUT, ctx), ctx);
  for (const zone of layer.zones) {
    assert.ok(strokes(zone).every((n) => n.attrs["stroke-linecap"] === "butt"), "square-ended dashes");
  }
  const coreOf = (zone) => strokes(zone).find((n) => n.attrs["data-stroke"] === "core").attrs.stroke;
  assert.deepEqual(layer.zones.map(coreOf), ["#ffb21e", "#fff3d1"]);
  assert.deepEqual(shadowPaint(ctxFor()).core, "#ffb21e", "the default ramp: the board's amber for #1");
});

test("labels follow the look: none when ghost.labels is false or labels.renderer is none", () => {
  for (const look of [resolveLook({ ghost: { labels: false } }), resolveLook({ labels: { renderer: "none" } })]) {
    const ctx = ctxFor(look);
    const layer = shadowLayer(shadowPlaysFor(INPUT, ctx), ctx);
    assert.equal(layer.labels.length, 0);
    assert.equal(layer.zones.length, 2, "the shadows still draw");
  }
});

test("nothing to draw: no input, no shadows", () => {
  assert.deepEqual(shadowPlaysFor(null, ctxFor()), []);
  assert.deepEqual(shadowLayer([], ctxFor()), { zones: [], labels: [] });
  assert.deepEqual(shadowLayer(null, ctxFor()), { zones: [], labels: [] });
});
