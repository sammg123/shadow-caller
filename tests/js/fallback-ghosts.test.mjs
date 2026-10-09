// field/fallback-ghosts.js (A6): before a caller snap, his top 2 plays as shadow plays on the 2D field
// (docs/design/play-drawing.md 4, binding): the same shapes as real plays, from the line of scrimmage, dashed and
// translucent, with "1 · Inside run (A/B gap) · 27%" underneath; a hovered play lit (and drawn when outside the top 2).
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
  assert.deepEqual(INPUT.situation, { ballX: 30, dir: 1, poss: "DAL", kind: "snap" });
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

test("the top 2 as shadow plays: a run a line on the turf, a pass an arc, both from the line of scrimmage", () => {
  const ctx = ctxFor();
  const layer = layerOf();
  assert.deepEqual(layer.zones.map((z) => [z.key, z.rank, z.opacity]), [["run_inside", 1, 0.5], ["pa_short", 2, 0.35]]);
  const [run, pass] = layer.zones;
  assert.deepEqual([run.node.attrs.class, run.node.attrs["data-part"], run.node.attrs["data-leaf"]],
    ["sc-fb-shadow", "shadow", "run_inside"]);
  const line = walk([run.node]).find((n) => n.attrs?.["data-stroke"] === "core");
  const [ax, ay, bx, by] = line.attrs.d.match(/-?\d+(\.\d+)?/g).map(Number);
  const [a, b] = [ctx.pt(30, C), ctx.pt(34, C)];
  near(ax, a.px, "from the line of scrimmage");
  near(ay, a.py);
  near(bx, b.px, "4 yards downfield, straight ahead (A/B gap)");
  near(by, b.py);
  const arc = walk([pass.node]).find((n) => n.attrs?.["data-stroke"] === "core");
  assert.match(arc.attrs.d, /Q/, "play-action short flies: an arc");
  near(Number(arc.attrs.d.match(/-?\d+(\.\d+)?/g)[4]), ctx.pt(36, C).px, "6 air yards, the short bucket's typical");
  assert.equal(run.dir, 1);
});

test("shadows read as shadows: every stroke dashed, edge and core alike, never solid", () => {
  for (const zone of layerOf().zones) {
    const all = strokes(zone);
    assert.ok(all.length >= 2, zone.key);
    assert.ok(all.every((n) => n.attrs["stroke-dasharray"]), `${zone.key}: dashed`);
    assert.equal(zone.node.attrs["data-hovered"], "false");
  }
});

test("text underneath each shadow: rank, the engine's name, his percentage, one line apart, never overlapping", () => {
  const ctx = ctxFor();
  const shadows = shadowPlaysFor(INPUT, ctx);
  const layer = shadowLayer(shadows, ctx);
  assert.deepEqual(layer.labels.map(textOf), ["1 · Inside run (A/B gap) · 27%", "2 · PA short (0–9) · 16%"]);
  assert.deepEqual(layer.labels.map((l) => [l.key, l.rank, l.opacity]), [["run_inside", 1, 1], ["pa_short", 2, 1]]);
  const los = ctx.pt(30, C);
  assert.ok(layer.labels.every((l) => l.node.children[1].attrs.y > los.py), "underneath: toward the near sideline");
  const m = viewMetrics(ctx, 30);
  const [p, q] = shadows.map((s) => labelBox(s.label, m));
  assert.ok(Math.abs(p.v - q.v) >= p.hh + q.hh - 1e-9 || Math.abs(p.u - q.u) >= p.hw + q.hw - 1e-9, "apart");
  const tag = layer.labels[0].node;
  assert.match(tag.attrs.class, /\bsc-ghost-label\b.*\brank-1\b/);
  assert.equal(tag.attrs["data-part"], "shadow-label");
  assert.match(tag.children[0].attrs.style, /stroke-dasharray/, "a dashed plate: a shadow's words");
});

test("hovering a play outside the top 2 draws its shadow too, lit, and dims the others", () => {
  const layer = layerOf({ hover: "screen" });
  assert.deepEqual(layer.zones.map((z) => z.key), ["run_inside", "pa_short", "screen"]);
  const op = Object.fromEntries(layer.zones.map((z) => [z.key, z.opacity]));
  assert.equal(op.screen, SHADOW_HOVER_OPACITY);
  assert.ok(op.run_inside < 0.5 && op.pa_short < 0.35, "the rest step back");
  assert.equal(layer.zones[2].node.attrs["data-hovered"], "true");
  assert.equal(textOf(layer.labels[2]), "10 · Screen · 2.8%", "his rank and pct1 past the top line");
  assert.ok(layer.labels[0].opacity < 1 && layer.labels[2].opacity === 1);
  const top = layerOf({ hover: "pa_short" });
  assert.deepEqual(top.zones.map((z) => z.key), ["run_inside", "pa_short"], "a top-2 play is only lit");
  assert.equal(top.zones[1].opacity, SHADOW_HOVER_OPACITY);
  assert.deepEqual(layerOf({ hover: "not_a_leaf" }).zones.map((z) => z.opacity), [0.5, 0.35]);
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

test("the world tints the shadows (team, the field's paint, or its own color); they stay dashed", () => {
  const neutral = shadowPaint(ctxFor());
  assert.equal(neutral.core, NEUTRAL_LOOK.field.paint);
  const own = shadowPaint(ctxFor(resolveLook({ ghost: { fill: "#fff3d1" } })));
  assert.equal(own.core, "#fff3d1");
  assert.notEqual(own.edge, own.core, "a darker edge keeps it readable on the turf");
  const team = shadowPaint(ctxFor(resolveLook({ ghost: { fill: "team" } })), "DAL");
  const dal = ctxFor().paints.byTeam.DAL.edge;
  assert.equal(team.edge, dal, "the caller's color on the edge");
  const zone = shadowLayer(shadowPlaysFor(INPUT, ctxFor(resolveLook({ ghost: { fill: "#fff3d1" } }))),
    ctxFor(resolveLook({ ghost: { fill: "#fff3d1" } }))).zones[0];
  assert.ok(strokes(zone).some((n) => n.attrs.stroke === "#fff3d1" && n.attrs["stroke-dasharray"]));
});

test("shadow dashes are square-ended, finer in a pixel or hatch look, like an LED board's dots", () => {
  const dashOf = (style) => {
    const ctx = ctxFor(resolveLook({ ghost: { style } }));
    const zone = shadowLayer(shadowPlaysFor(INPUT, ctx), ctx).zones[0];
    assert.ok(strokes(zone).every((n) => n.attrs["stroke-linecap"] === "butt" && n.attrs["stroke-dasharray"]), style);
    return strokes(zone)[0].attrs["stroke-dasharray"].split(" ").map(Number);
  };
  const [zoneOn] = dashOf("zone");
  assert.ok(dashOf("pixel")[0] < zoneOn && dashOf("hatch")[0] < zoneOn);
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
