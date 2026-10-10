// field/fallback-plays.js (A6): a timeline row's Drawing as 2D parts, animated by progress, plus residue rules.
// The grammar is docs/design/play-drawing.md (binding): every play starts on the line of scrimmage; a pass is an
// arc, an incompletion an arc ending in an X, a run one straight line on the turf; every play carries its label.
import assert from "node:assert/strict";
import test from "node:test";

import { OBLIQUE, layoutPlane, sceneContext } from "../../static/js/field/fallback-draw.js";
import { PASS_LIFT, liftOf } from "../../static/js/field/fallback-steps.js";
import {
  carriersOf, foldPlays, partAt, playNode, playSpec, retireLast, strokeStyle, trailNodes,
} from "../../static/js/field/fallback-plays.js";
import { buildDrawing } from "../../static/js/field/paths.js";
import { planDrawing } from "../../static/js/field/timing.js";
import { resolveLook } from "../../static/js/theme/look-schema.js";
import { NEUTRAL_LOOK } from "../../static/js/theme/neutral-look.js";
import { capture, frozenCopy, rowById, rowBySeq } from "./field-rows.mjs";

const T = capture();
const C = 26.667;
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
const textOf = (node) => walk([node]).find((n) => n.tag === "text")?.text;

test("an incompletion: a solid arc from the line of scrimmage to the target, then an X on the turf", () => {
  const spec = specOf("40187298068");
  assert.deepEqual(spec.steps.map((s) => [s.t, s.role]), [["arc", "pass"], ["mark", "incomplete"]]);
  const arc = partsOf(spec.steps[0], "core")[0];
  assert.equal(arc.attrs["stroke-dasharray"], undefined, "the real play draws solid");
  assert.deepEqual([arc.anim.kind, arc.anim.geom.kind], ["path", "quad"]);
  const { a, c, b } = arc.anim.geom;
  const L = ctxFor().layout;
  near(a.px, L.rect.x + 40 * L.px, "thrown from the line of scrimmage, x 30 (no drop back)");
  near(a.py, L.rect.y + L.rect.h - C * L.px, "on the center line");
  near(b.px, L.rect.x + 45 * L.px, "to the target at x 35");
  near((a.py + b.py) / 2 - c.py, 2 * 1.5 * PASS_LIFT * L.px, "a pass bows by its full apex: an arch, not a line");
  const x = spec.steps[1].parts[0];
  assert.deepEqual([x.tag, x.attrs["data-mark"], x.anim.kind], ["g", "incomplete", "pop"]);
  const [edge, core] = x.children;
  assert.ok(edge.attrs["stroke-width"] > core.attrs["stroke-width"], "a light core inside its edge");
  const [x1, y1, x2, y2, x3, y3, x4, y4] = nums(core.attrs.d);
  near((x1 + x2) / 2, b.px, "the X crosses at the target (x)");
  near((y1 + y2) / 2, b.py, "the X crosses at the target (y)");
  near((x3 + x4) / 2, b.px);
  near((y3 + y4) / 2, b.py);
  assert.ok(x2 - x1 >= 10 && Math.abs(x3 - x4) >= 10, "two arms you can see");
});

test("partAt draws a stroke up to its progress, and hides it before it starts", () => {
  const spec = specOf("4018729801915");
  const yac = partsOf(spec.steps[2], "core")[0];
  const { a, b } = yac.anim.geom;
  assert.equal(partAt(yac, 0).visibility, "hidden");
  const half = nums(partAt(yac, 0.5).d);
  near(half[2], (a.px + b.px) / 2, "halfway along the YAC");
  const full = nums(partAt(yac, 1).d);
  near(full[2], b.px, "the whole stroke");
  const arc = partsOf(spec.steps[0], "core")[0];
  const { a: qa, c: qc, b: qb } = arc.anim.geom;
  const end = nums(partAt(arc, 0.5).d).slice(-2);
  near(end[0], 0.25 * qa.px + 0.5 * qc.px + 0.25 * qb.px, "Bezier point at 0.5 (x)");
  near(end[1], 0.25 * qa.py + 0.5 * qc.py + 0.25 * qb.py, "Bezier point at 0.5 (y)");
});

test("a completion: the arc to the catch, a small catch dot, the YAC on the turf ending in an arrowhead", () => {
  const row = rowById("4018729801915");
  const spec = specOf("4018729801915");
  assert.deepEqual(spec.steps.map((s) => [s.t, s.role]), [["arc", "pass"], ["mark", "catch"], ["ground", "yac"]]);
  const L = ctxFor().layout;
  near(partsOf(spec.steps[0], "core")[0].anim.geom.a.px, L.rect.x + 23 * L.px, "from the line of scrimmage, x 13");
  const dot = spec.steps[1].parts;
  assert.deepEqual(dot.map((p) => [p.tag, p.anim.kind]), [["circle", "pop"]], "a dot, never a catch-area circle");
  near(dot[0].attrs.cx, L.rect.x + 62 * L.px, "at the catch, x 52");
  assert.ok(dot[0].attrs.r >= 3 && dot[0].attrs.r <= 6, `small: r ${dot[0].attrs.r}`);
  assert.ok(spec.steps[2].parts.some((p) => p.role === "head"), "an arrowhead on the YAC");
  assert.deepEqual(carriersOf(row, buildDrawing(row)), ["DAL", "DAL", "DAL"]);
  assert.equal(spec.label.text, "Deep pass middle · +48");
});

test("a run: one straight line on the turf from the line of scrimmage, angled to its gap, grown from the line", () => {
  const spec = specOf("4018729802242");
  assert.deepEqual(spec.steps.map((s) => [s.t, s.role]), [["ground", "run"]], "no corridor, no lane, no cutback");
  const core = partsOf(spec.steps[0], "core")[0];
  const L = ctxFor().layout;
  const { a, b } = core.anim.geom;
  near(a.px, L.rect.x + 96 * L.px, "from the line of scrimmage, x 86");
  near(b.px, L.rect.x + 24 * L.px, "to where he went out, x 14");
  near(b.py, L.rect.y + L.rect.h - (C - 4) * L.px, "4 yd toward TB's left: the left tackle");
  assert.equal(partAt(core, 0).visibility, "hidden");
  near(nums(partAt(core, 0.5).d)[2], L.rect.x + 60 * L.px, "halfway, x 50", 0.05);
  const head = spec.steps[0].parts.find((p) => p.role === "head");
  assert.equal(head.anim.kind, "end", "the arrowhead lands with the end of the run");
  assert.equal(spec.label.text, "Off-tackle left · +72");
});

test("a run for no gain is a zero-length line: a dot at the line, no arrowhead", () => {
  const spec = playSpec(buildDrawing(rowBySeq(9)), rowBySeq(9), ctxFor());
  const core = partsOf(spec.steps[0], "core")[0];
  const [x1, y1, x2, y2] = nums(core.attrs.d);
  assert.deepEqual([x1, y1], [x2, y2]);
  assert.equal(core.attrs["stroke-linecap"], "round", "a round cap draws the dot");
  assert.ok(!spec.steps[0].parts.some((p) => p.role === "head"));
  assert.equal(spec.label.text, "Inside run (up the middle) · no gain");
});

test("who carries: possession flips after an interception or a lost ball and after a kick's flight", () => {
  const kick = rowById("40187298040");
  assert.deepEqual(carriersOf(kick, buildDrawing(kick)), ["TB", "DAL"]);
  const pick = rowById("4018729802466");
  assert.deepEqual(carriersOf(pick, buildDrawing(pick)), ["DAL", "DAL", "TB"], "the return is TB's");
  const muff = rowById("4018729802667");
  assert.deepEqual(carriersOf(muff, buildDrawing(muff)), ["TB", "DAL", "DAL", "DAL"]);
  const spec = specOf("4018729802466");
  const int = spec.steps[1].parts[0];
  assert.equal(int.attrs["data-mark"], "int");
  assert.match(walk([int]).map((n) => n.attrs?.style ?? "").join(" "), /--sc-bad/, "INT in the bad tone");
  const tb = strokeStyle(ctxFor(), "ground", "TB");
  assert.equal(partsOf(spec.steps[2], "edge")[0].attrs.stroke, tb.edge, "the return in TB's color");
  assert.equal(spec.label.text, "Pass intercepted · short middle");
});

/** The badge's plate is on the other side of its spot from the play's words (on screen: y down). */
function badgeAwayFromWords(spec, role, spot) {
  const plate = spec.steps.find((st) => st.role === role).parts[0].children[0].attrs;
  const wordsBelow = spec.label.at.py > spot.py;
  return wordsBelow ? plate.y + plate.height <= spot.py : plate.y >= spot.py;
}

test("lettered marks (INT, TD) sit beside their spot like a badge, away from the play's words", () => {
  const ctx = ctxFor();
  const pick = specOf("4018729802466");
  const int = pick.steps[1].parts[0];
  const plate = int.children[0].attrs;
  const spot = ctx.pt(76, C);
  near(plate.x + plate.width / 2, spot.px, "centered over the spot");
  assert.ok(badgeAwayFromWords(pick, "int", spot), "the INT on the other side of its spot from the words");
  assert.equal(int.anim.cy < spot.py, plate.y < spot.py, "it pops in where it sits");
  const run = playSpec(buildDrawing(rowBySeq(12)), rowBySeq(12), ctx);
  assert.ok(badgeAwayFromWords(run, "td", ctx.pt(100, C)), "a TD run's badge away from its words");
  const pass = playSpec(buildDrawing(rowBySeq(159)), rowBySeq(159), ctx);
  assert.ok(badgeAwayFromWords(pass, "td", ctx.pt(100, C + 12)), "a TD pass's badge away from its words");
  const flag = specOf("401872980210").steps[1].parts[0];
  near(flag.anim.cy, ctx.pt(92, C).py, "a flag stays on its spot", 0.05);
});

test("a no-play: the wiped run is dimmed and dashed, the flag in line-to-gain yellow, the ball marches", () => {
  const spec = specOf("401872980210");
  assert.deepEqual(spec.steps.map((s) => [s.t, s.role, s.ghosted]),
    [["ground", "run", true], ["mark", "flag", false], ["ground", "march", false]]);
  const run = spec.steps[0];
  near(run.opacity, NEUTRAL_LOOK.strokes.ground.ghostedOpacity, "ghosted opacity", 1e-9);
  assert.ok(partsOf(run, "core")[0].attrs["stroke-dasharray"], "dashed");
  assert.ok(walk(spec.steps[1].parts).some((n) => n.attrs?.fill === NEUTRAL_LOOK.lines.ltg.color));
  assert.equal(partsOf(spec.steps[2], "core")[0].attrs.stroke, NEUTRAL_LOOK.lines.ltg.color);
  assert.equal(spec.label.text, "No play · defensive offside on TB");
  assert.match(spec.label.node.children[1].attrs.style, /--sc-warn/, "a no-play's words in the warning tone");
});

test("the label: the drawing's words at its spot (text, never markup), toned by how the play ended", () => {
  const ctx = ctxFor();
  const run = specOf("4018729802242");
  const at = ctx.pt(14, 17.667);
  assert.equal(textOf(run.label.node), "Off-tackle left · +72");
  assert.deepEqual([run.label.at.px, run.label.at.py], [at.px, at.py], "at drawing.label.at");
  assert.equal(run.label.node.attrs["data-part"], "play-label");
  assert.equal(run.label.node.attrs["data-approx"], "false");
  assert.match(run.label.node.attrs.class, /\bsc-label\b/, "the look's label class");
  assert.match(run.label.node.children[1].attrs.style, /--sc-ink\)/);
  assert.match(specOf("4018729802466").label.node.children[1].attrs.style, /--sc-bad/, "an interception reads bad");
  const inc = specOf("40187298068").label;
  assert.equal(inc.node.attrs["data-approx"], "true", "an estimated target says so");
  assert.equal(specOf("401872980353").label, null, "an admin row has no words");
  assert.equal(specOf("4018729802242", {}, resolveLook({ labels: { result: false } })).label, null);
  assert.equal(specOf("4018729802242", {}, resolveLook({ labels: { renderer: "none" } })).label, null);
});

test("the words are laid out in the 2D view itself: on a phone's small field they still never sit on the ball", () => {
  const row = rowBySeq(6);
  const px = { charPx: 6.2, linePx: 27, padPx: 12 };      // a 23 px plate of 11 px text, measured on the page
  const phone = sceneContext({ look: NEUTRAL_LOOK, layout: layoutPlane({ width: 390, height: 844 }), field: T.field,
    teams: T.teams, teamOrder: T.team_order, ids: "p2" });
  const spec = playSpec(buildDrawing(row), row, phone, { labelPx: px });
  assert.equal(spec.label.text, "Inside run (up the middle) · +21");
  const ball = phone.pt(71, C);
  const gapPx = Math.abs(spec.label.at.py - ball.py);
  assert.ok(gapPx >= (px.linePx - 4) / 2 + 6.5, `the plate's edge clears the ball's ring: ${gapPx} px apart`);
  const old = phone.pt(buildDrawing(row).label.at.x, buildDrawing(row).label.at.y);
  assert.ok(Math.abs(old.py - ball.py) < (px.linePx - 4) / 2 + 6.5, "the desktop spot would have covered it");
  const desk = playSpec(buildDrawing(row), row, ctxFor(), { labelPx: px });
  const at = ctxFor().pt(71, C + 5);
  assert.deepEqual([desk.label.at.px, desk.label.at.py], [at.px, at.py], "a desktop field: where it always was");
  assert.deepEqual(playSpec(buildDrawing(row), row, ctxFor()).label.at, desk.label.at, "unmeasured: the label model's");
});

test("the verdict chip sits on the far side of the words from the end of the play", () => {
  const below = specOf("4018729802242", { verdict: "top1" });
  const chip = walk([below.verdictNode]).find((n) => n.tag === "text");
  assert.equal(chip.text, "Top pick");
  assert.match(chip.attrs.style, /--sc-good/);
  assert.ok(chip.attrs.y > below.label.at.py, "a label below the center line: the chip goes further down");
  const above = specOf("4018729801915", { verdict: "miss" });
  assert.ok(walk([above.verdictNode]).find((n) => n.tag === "text").attrs.y < above.label.at.py, "and up when above");
  const td = playSpec(buildDrawing(rowBySeq(159)), rowBySeq(159), ctxFor(), { verdict: "top3" });
  const chipY = walk([td.verdictNode]).find((n) => n.tag === "text").attrs.y;
  const end = ctxFor().pt(100, C + 12);
  assert.equal(Math.sign(chipY - td.label.at.py), Math.sign(td.label.at.py - end.py),
    "the chip goes beyond the words, away from the play, never onto its end");
  assert.equal(specOf("4018729802242", { verdict: "none" }).verdictNode, null);
  assert.equal(specOf("4018729802242").verdictNode, null);
});

test("a pass bows by its whole height, a kick by the field's slight tilt", () => {
  assert.equal(PASS_LIFT, 1);
  assert.equal(liftOf({ t: "arc", role: "pass" }), PASS_LIFT);
  for (const role of ["punt", "kickoff", "fg"]) assert.equal(liftOf({ t: "arc", role }), OBLIQUE, role);
  assert.equal(liftOf({ t: "ground", role: "run" }), OBLIQUE);
  const punt = specOf("4018729801082");
  const arc = partsOf(punt.steps[0], "core")[0].anim.geom;
  const L = ctxFor().layout;
  const row = buildDrawing(rowById("4018729801082")).steps[0];
  near((arc.a.py + arc.b.py) / 2 - arc.c.py, 2 * row.apex * OBLIQUE * L.px, "a punt keeps the slight tilt");
});

test("the ball and its trail ride the arc as drawn", () => {
  const row = rowById("4018729801915");
  const drawing = buildDrawing(row);
  const plan = planDrawing(drawing);
  const ctx = ctxFor();
  const arc = partsOf(specOf("4018729801915").steps[0], "core")[0].anim.geom;
  const mid = (plan.steps[0].startMs + plan.steps[0].endMs) / 2;
  const trail = trailNodes(drawing, plan, mid, ctx, "DAL");
  const pts = nums(trail[0].attrs.d);
  const [x, y] = pts.slice(-2);
  const top = { px: 0.25 * arc.a.px + 0.5 * arc.c.px + 0.25 * arc.b.px, py: 0.25 * arc.a.py + 0.5 * arc.c.py + 0.25 * arc.b.py };
  near(x, top.px, "at the top of the arch (x)", 0.6);
  near(y, top.py, "at the top of the arch (y)", 0.6);
});

test("a field goal flies from the line of scrimmage; its mark sits on the crossbar", () => {
  const spec = specOf("4018729802060");
  assert.deepEqual(spec.steps.map((s) => s.role), ["fg", "fg_good"], "no hold behind the line");
  const L = ctxFor().layout;
  near(partsOf(spec.steps[0], "core")[0].anim.geom.a.px, L.rect.x + 87 * L.px, "from the line of scrimmage, x 77");
  const pop = spec.steps[1].parts[0].anim;
  near(pop.cy, L.rect.y + L.rect.h - (C + 3.333 * OBLIQUE) * L.px, "lifted to the crossbar", 0.05);
  assert.equal(spec.label.text, "FG 41 yds · good");
});

test("pixel looks draw marks as lit-cell glyphs; the X and the catch dot stay strokes", () => {
  const look = resolveLook({ strokes: { mark: { approx: "pixel" } } });
  const sack = specOf("4018729802713", {}, look);
  assert.ok(walk(sack.steps[1].parts).some((n) => (n.attrs?.d ?? "").split("M").length > 10), "a pixel glyph");
  const x = specOf("40187298068", {}, look).steps[1].parts[0];
  assert.equal(x.children[1].attrs["stroke-linecap"], "square", "a square-capped X in a pixel look");
  const int = specOf("4018729802466", {}, look).steps[1].parts[0];
  const plate = int.children[0];
  assert.ok(plate.attrs.width > plate.attrs.height, "the INT plate is as wide as its letters");
});

test("playNode draws every step at its opacity; playSpec never mutates its row or drawing", () => {
  const row = frozenCopy(rowById("4018729802667"));
  const drawing = buildDrawing(row);
  assert.doesNotThrow(() => playSpec(drawing, row, ctxFor(), { verdict: "miss" }));
  const admin = rowById("401872980353");
  assert.equal(playSpec(buildDrawing(admin), admin, ctxFor()).steps.length, 0);
  const node = playNode(specOf("401872980210"), 0.5);
  assert.equal(node.attrs.opacity, 0.5);
  assert.deepEqual(node.children.map((g) => g.attrs["data-role"]), ["run", "flag", "march"]);
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
  const mid = plan.steps[0].startMs + (plan.steps[0].endMs - plan.steps[0].startMs) / 2;
  const trail = trailNodes(drawing, plan, mid, ctx, "DAL");
  assert.equal(trail.length, 1);
  assert.ok(nums(trail[0].attrs.d).length >= 6);
  assert.deepEqual(trailNodes(drawing, plan, mid, ctxFor(resolveLook({ ball: { trail: { kind: "none" } } })), "DAL"), []);
});
