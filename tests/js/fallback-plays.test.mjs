// field/fallback-plays.js (A6): a timeline row's Drawing as 2D parts, animated by progress, plus residue rules.
import assert from "node:assert/strict";
import test from "node:test";

import { OBLIQUE, layoutPlane, sceneContext } from "../../static/js/field/fallback-draw.js";
import {
  carriersOf, foldPlays, partAt, playSpec, retireLast, trailNodes,
} from "../../static/js/field/fallback-plays.js";
import { buildDrawing } from "../../static/js/field/paths.js";
import { planDrawing } from "../../static/js/field/timing.js";
import { resolveLook } from "../../static/js/theme/look-schema.js";
import { NEUTRAL_LOOK } from "../../static/js/theme/neutral-look.js";
import { capture, frozenCopy, rowById } from "./field-rows.mjs";

const T = capture();
const ctxFor = (look = NEUTRAL_LOOK) => sceneContext({ look, layout: layoutPlane({ width: 1440, height: 900 }),
  field: T.field, teams: T.teams, teamOrder: T.team_order, ids: "p1" });
const near = (a, b, label = "", eps = 0.02) => assert.ok(Math.abs(a - b) <= eps, `${label} ${a} != ${b}`);
const specOf = (id, opts, look) => {
  const row = rowById(id);
  return playSpec(buildDrawing(row), row, ctxFor(look), opts);
};
const partsOf = (step, role) => step.parts.filter((p) => p.role === role);
const nums = (d) => d.match(/-?\d+(\.\d+)?/g).map(Number);

function walk(nodes, out = []) {
  for (const n of nodes ?? []) {
    out.push(n);
    walk(n.children, out);
  }
  return out;
}

test("an incompletion: the snap (approximate, dashed), the throw as an arc lifted by its apex, the band", () => {
  const spec = specOf("40187298068");
  assert.deepEqual(spec.steps.map((s) => s.t), ["ground", "arc", "band"]);
  const snapCore = partsOf(spec.steps[0], "core")[0];
  assert.ok(snapCore.attrs["stroke-dasharray"], "approximate strokes are dashed in the neutral look");
  const arc = partsOf(spec.steps[1], "core")[0];
  assert.equal(arc.anim.kind, "path");
  assert.equal(arc.anim.geom.kind, "quad");
  const { a, c, b } = arc.anim.geom;
  const L = ctxFor().layout;
  near(a.px, L.rect.x + 34 * L.px, "release at x 24");
  near(b.px, L.rect.x + 45 * L.px, "target at x 35");
  near((a.py + b.py) / 2 - c.py, 2 * 1.98 * OBLIQUE * L.px, "control point lifts by twice the apex");
  assert.equal(spec.steps[2].parts[0].anim.kind, "fade");
  assert.equal(spec.label.text, "INC");
});

test("partAt draws a stroke up to its progress, and hides it before it starts", () => {
  const spec = specOf("4018729801915");
  const yac = partsOf(spec.steps[3], "core")[0];
  const { a, b } = yac.anim.geom;
  assert.equal(partAt(yac, 0).visibility, "hidden");
  const half = nums(partAt(yac, 0.5).d);
  near(half[2], (a.px + b.px) / 2, "halfway along the YAC");
  const full = nums(partAt(yac, 1).d);
  near(full[2], b.px, "the whole stroke");
  const arc = partsOf(spec.steps[1], "core")[0];
  const { a: qa, c: qc, b: qb } = arc.anim.geom;
  const end = nums(partAt(arc, 0.5).d).slice(-2);
  near(end[0], 0.25 * qa.px + 0.5 * qc.px + 0.25 * qb.px, "Bezier point at 0.5 (x)");
  near(end[1], 0.25 * qa.py + 0.5 * qc.py + 0.25 * qb.py, "Bezier point at 0.5 (y)");
});

test("a completion: catch area pops in, the YAC stroke ends in an arrowhead, every step is DAL's", () => {
  const row = rowById("4018729801915");
  const spec = specOf("4018729801915");
  assert.deepEqual(spec.steps.map((s) => s.t), ["ground", "arc", "area", "ground"]);
  assert.ok(spec.steps[2].parts.every((p) => p.anim.kind === "pop"));
  assert.ok(spec.steps[3].parts.some((p) => p.role === "head"), "an arrowhead on the YAC");
  assert.deepEqual(carriersOf(row, buildDrawing(row)), ["DAL", "DAL", "DAL", "DAL"]);
  assert.equal(spec.label.text, "+48");
});

test("a run: the lane grows from the line of scrimmage with the ball", () => {
  const spec = specOf("4018729802242");
  const lane = spec.steps[1].parts.find((p) => p.anim.kind === "lane");
  assert.ok(lane, "a lane part");
  const L = ctxFor().layout;
  const half = partAt(lane, 0.5);
  near(half.x, L.rect.x + 60 * L.px, "half of 86 to 14 reaches x 50", 0.05);
  near(half.width, 36 * L.px, "36 yards long", 0.05);
  const zero = partAt(lane, 0);
  assert.equal(zero.visibility, "hidden");
});

test("who carries: a kickoff is kicked by TB and returned by DAL; an interception is returned by TB", () => {
  const kick = rowById("40187298040");
  assert.deepEqual(carriersOf(kick, buildDrawing(kick)), ["TB", "DAL"]);
  const pick = rowById("4018729802466");
  assert.deepEqual(carriersOf(pick, buildDrawing(pick)), ["DAL", "DAL", "DAL", "TB"]);
  const spec = specOf("4018729802466");
  const mark = spec.steps[2].parts[0];
  assert.match(walk([mark]).map((n) => n.attrs?.style ?? "").join(" "), /--sc-bad/, "a turnover is drawn in the bad tone");
});

test("a no-play: the wiped action is ghosted, the flag lands in the line-to-gain yellow, the ball marches", () => {
  const spec = specOf("401872980210");
  const ghosted = spec.steps.filter((s) => s.ghosted);
  assert.deepEqual(ghosted.map((s) => s.t), ["ground", "corridor"]);
  const g = NEUTRAL_LOOK.strokes;
  const laneOpacity = spec.steps[1].opacity;
  near(laneOpacity, g.corridor.ghostedOpacity, "ghosted lane opacity", 1e-9);
  const flag = spec.steps[2];
  assert.equal(flag.role, "flag");
  assert.ok(walk(flag.parts).some((n) => n.attrs?.fill === NEUTRAL_LOOK.lines.ltg.color));
  const march = partsOf(spec.steps[3], "core")[0];
  assert.equal(march.attrs.stroke, NEUTRAL_LOOK.lines.ltg.color);
  assert.equal(spec.label.text, "FLAG");
});

test("labels: the result word above the spot, the verdict chip under it in its tone", () => {
  const spec = specOf("4018729802242", { verdict: "top1" });
  const words = walk([spec.label.node]).filter((n) => n.tag === "text").map((n) => n.text);
  assert.deepEqual(words, ["+72"]);
  const chip = walk([spec.verdictNode]).find((n) => n.tag === "text");
  assert.equal(chip.text, "Top pick");
  assert.match(chip.attrs.style, /--sc-good/);
  assert.equal(specOf("4018729802242", { verdict: "none" }).verdictNode, null);
  assert.equal(specOf("4018729802242").verdictNode, null);
  const noLabels = specOf("4018729802242", {}, resolveLook({ labels: { result: false } }));
  assert.equal(noLabels.label, null);
});

test("a field goal's mark sits on the crossbar; kicks draw true-length arcs", () => {
  const spec = specOf("4018729802060");
  assert.deepEqual(spec.steps.map((s) => s.role), ["hold", "fg", "fg_good"]);
  const L = ctxFor().layout;
  const pop = spec.steps[2].parts[0].anim;
  near(pop.cy, L.rect.y + L.rect.h - (26.667 + 3.333 * OBLIQUE) * L.px, "lifted to the crossbar", 0.05);
});

test("pixel looks draw lanes, bands and marks as lit cells", () => {
  const look = resolveLook({ ghost: { style: "pixel" }, strokes: { corridor: { approx: "pixel" },
    band: { approx: "pixel" }, mark: { approx: "pixel" } } });
  const run = specOf("4018729802242", {}, look);
  const lanes = run.steps[1].parts.filter((p) => p.anim.kind === "lane");
  assert.ok(lanes.every((p) => p.anim.geom.kind === "cells"));
  const count = lanes.reduce((n, p) => n + p.anim.geom.cells.length, 0);
  assert.equal(count, 72 * 3, "three rows of cells for 72 yards");
  const inc = specOf("40187298068", {}, look);
  assert.ok(nums(inc.steps[2].parts[0].attrs.d).length > 100, "checkerboard cells");
  const catchArea = specOf("4018729801915", {}, look).steps[2].parts;
  assert.ok(catchArea.every((p) => p.tag === "path" && p.anim.kind === "pop"), "a pixel ring where it was caught");
  const sack = specOf("4018729802713", {}, look);
  assert.ok(walk(sack.steps[1].parts).some((n) => (n.attrs?.d ?? "").split("M").length > 10), "a pixel glyph");
});

test("playSpec never mutates its row or drawing", () => {
  const row = frozenCopy(rowById("4018729802667"));
  const drawing = buildDrawing(row);
  assert.doesNotThrow(() => playSpec(drawing, row, ctxFor(), { verdict: "miss" }));
  assert.equal(playSpec(buildDrawing(rowById("401872980353")), rowById("401872980353"), ctxFor()).steps.length, 0);
});

test("residue: the last play moves to residue on the next play, cleared by a new drive, per look", () => {
  const e = (seq, drive) => ({ seq, drive, drawing: { steps: [{ t: "mark" }] } });
  const admin = { seq: 9, drive: 1, drawing: { steps: [] } };
  const drive = { residue: { keep: "drive" } };
  let plays = { last: null, residue: [] };
  plays = foldPlays(plays, e(1, 1), drive);
  plays = foldPlays(plays, e(2, 1), drive);
  plays = foldPlays(plays, admin, drive);
  assert.deepEqual([plays.last.seq, plays.residue.map((r) => r.seq)], [2, [1]]);
  plays = foldPlays(plays, e(3, 2), drive);
  assert.deepEqual([plays.last.seq, plays.residue.map((r) => r.seq)], [3, []]);
  const game = foldPlays(foldPlays(foldPlays({ last: null, residue: [] }, e(1, 1), { residue: { keep: "game" } }),
    e(2, 2), { residue: { keep: "game" } }), e(3, 3), { residue: { keep: "game" } });
  assert.deepEqual(game.residue.map((r) => r.seq), [1, 2]);
  const none = foldPlays(foldPlays({ last: null, residue: [] }, e(1, 1), { residue: { keep: "none" } }), e(2, 1),
    { residue: { keep: "none" } });
  assert.deepEqual(none.residue, []);
  assert.deepEqual(retireLast({ last: e(4, 2), residue: [e(3, 2)] }, drive).residue.map((r) => r.seq), [3, 4]);
  assert.deepEqual(retireLast({ last: e(4, 2), residue: [] }, { residue: { keep: "none" } }),
    { last: null, residue: [] });
});

test("the ball's trail follows the look: none, or a fading stroke behind the ball", () => {
  const row = rowById("4018729801915");
  const drawing = buildDrawing(row);
  const plan = planDrawing(drawing);
  const ctx = ctxFor();
  const mid = plan.steps[1].startMs + (plan.steps[1].endMs - plan.steps[1].startMs) / 2;
  const trail = trailNodes(drawing, plan, mid, ctx, "DAL");
  assert.equal(trail.length, 1);
  assert.ok(nums(trail[0].attrs.d).length >= 6);
  assert.deepEqual(trailNodes(drawing, plan, mid, ctxFor(resolveLook({ ball: { trail: { kind: "none" } } })), "DAL"), []);
});
