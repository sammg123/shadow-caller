// field/fallback-ghosts.js (A6): the predicted zones on the 2D field, weighted by rank, in the look's ghost style.
import assert from "node:assert/strict";
import test from "node:test";

import { ghostFill, ghostLayer } from "../../static/js/field/fallback-ghosts.js";
import { layoutPlane, sceneContext } from "../../static/js/field/fallback-draw.js";
import { buildGhostSet, ghostInputFromPred } from "../../static/js/field/ghosts.js";
import { situationFromRow } from "../../static/js/field/paths.js";
import { resolveLook } from "../../static/js/theme/look-schema.js";
import { NEUTRAL_LOOK } from "../../static/js/theme/neutral-look.js";
import { capture, rowById } from "./field-rows.mjs";

const T = capture();
const ctxFor = (look = NEUTRAL_LOOK) => sceneContext({ look, layout: layoutPlane({ width: 1440, height: 900 }),
  field: T.field, teams: T.teams, teamOrder: T.team_order, ids: "g1" });
const firstSnap = rowById("40187298068");
const SET = buildGhostSet(ghostInputFromPred(firstSnap.pred), situationFromRow(firstSnap));

function walk(nodes, out = []) {
  for (const n of nodes ?? []) {
    out.push(n);
    walk(n.children, out);
  }
  return out;
}
const textOf = (label) => walk([label.node]).find((n) => n.tag === "text").text;
const cellCount = (zone) => (walk([zone.node]).find((n) => n.tag === "path")?.attrs.d.match(/M/g) ?? []).length;

test("the top three zones in rank order, opacity by rank, labels with his percentages", () => {
  const layer = ghostLayer(SET, ctxFor());
  assert.deepEqual(layer.zones.map((z) => [z.key, z.rank]), [["run_inside", 1], ["pa_short", 2], ["dropback_short", 3]]);
  assert.deepEqual(layer.zones.map((z) => z.opacity), [0.5, 0.3, 0.18]);
  assert.deepEqual(layer.labels.map(textOf), ["27%", "16%", "14%"]);
  assert.ok(layer.labels.every((l) => l.opacity === 1));
  assert.equal(layer.zones[0].node.attrs["data-leaf"], "run_inside");
});

test("after the snap only the top call stays, faint; the others and every label clear", () => {
  const layer = ghostLayer(SET, ctxFor(), { phase: "aftersnap" });
  assert.deepEqual(layer.zones.map((z) => z.opacity), [NEUTRAL_LOOK.ghost.afterSnapOpacity, 0, 0]);
  assert.ok(layer.labels.every((l) => l.opacity === 0));
});

test("highlighting a top-three play lights it fully and dims the rest", () => {
  const layer = ghostLayer(SET, ctxFor(), { highlight: "pa_short" });
  const op = Object.fromEntries(layer.zones.map((z) => [z.key, z.opacity]));
  assert.ok(op.pa_short >= 0.75);
  assert.ok(Math.abs(op.run_inside - 0.5 * 0.35) < 1e-9);
  assert.ok(Math.abs(op.dropback_short - 0.18 * 0.35) < 1e-9);
  assert.equal(layer.zones.find((z) => z.key === "pa_short").highlighted, true);
});

test("highlighting a play outside the top three draws its own zone from the full distribution", () => {
  const layer = ghostLayer(SET, ctxFor(), { highlight: "screen" });
  const extra = layer.zones.find((z) => z.key === "hl:screen");
  assert.ok(extra, "a zone for the hovered play");
  assert.ok(extra.opacity >= 0.75);
  assert.equal(extra.node.attrs["data-leaf"], "screen");
  assert.ok(layer.labels.some((l) => l.key === "hl:screen" && textOf(l) === "2.8%"), "pct1 below 10%");
  assert.equal(ghostLayer(SET, ctxFor(), { highlight: "not_a_leaf" }).zones.length, 3);
});

test("pixel style: the top call lights every cell, the others only their outline cells", () => {
  const pixel = resolveLook({ ghost: { style: "pixel" } });
  const layer = ghostLayer(SET, ctxFor(pixel));
  assert.equal(cellCount(layer.zones[0]), 5 * 4, "corridor x 30-35, y 24.667-28.667");
  assert.equal(cellCount(layer.zones[1]), 2 * 9 + 2 * 49, "outline of a 9 by 51 band");
  const lit = ghostLayer(SET, ctxFor(pixel), { highlight: "pa_short" });
  assert.equal(cellCount(lit.zones[1]), 9 * 51, "a highlighted zone lights fully");
});

test("each ghost style draws something distinct", () => {
  const kinds = ["zone", "outline", "hatch", "pixel", "marker"].map((style) => {
    const layer = ghostLayer(SET, ctxFor(resolveLook({ ghost: { style } })));
    return JSON.stringify(layer.zones[1].node);
  });
  assert.equal(new Set(kinds).size, 5);
  const hatch = ghostLayer(SET, ctxFor(resolveLook({ ghost: { style: "hatch" } })));
  assert.ok(walk(hatch.defs).some((n) => n.tag === "pattern"), "hatch defines its pattern");
});

test("labels follow the look: off when ghost.labels is false or labels.renderer is none", () => {
  assert.equal(ghostLayer(SET, ctxFor(resolveLook({ ghost: { labels: false } }))).labels.length, 0);
  assert.equal(ghostLayer(SET, ctxFor(resolveLook({ labels: { renderer: "none" } }))).labels.length, 0);
});

test("ghost fill: the caller's team color, the field paint, or a literal color", () => {
  assert.equal(ghostFill(ctxFor(resolveLook({ ghost: { fill: "neutral" } }))), NEUTRAL_LOOK.field.paint);
  assert.equal(ghostFill(ctxFor(resolveLook({ ghost: { fill: "#fff3d1" } }))), "#fff3d1");
  const team = ghostFill(ctxFor(resolveLook({ ghost: { fill: "team" } })));
  assert.ok(["#002a5c", "#b0b7bc"].includes(team), `DAL primary or alternate, got ${team}`);
});

test("no set, no zones", () => {
  assert.deepEqual(ghostLayer(null, ctxFor()), { zones: [], labels: [], defs: [] });
});
