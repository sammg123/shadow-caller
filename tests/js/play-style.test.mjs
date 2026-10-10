// field/play-style.js: how one play, or one shadow play, looks on the 3D field (A5 part 2; play-drawing.md, binding).
// Pure: the Drawing's steps as frozen "parts" (strokes, the arc's ground track, arrowheads, marks) with every color,
// width, dash and opacity taken from the Look, the team colors and the world's optional look.world.plays group.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { NEUTRAL_LOOK } from "../../static/js/theme/neutral-look.js";
import { resolveLook } from "../../static/js/theme/look-schema.js";
import { mixHex, teamPaint } from "../../static/js/theme/team-colors.js";
import { buildDrawing, situationFromRow } from "../../static/js/field/paths.js";
import { buildShadowPlays, shadowForLeaf } from "../../static/js/field/shadows.js";
import { buildGhostSet } from "../../static/js/field/ghosts.js";
import { CROSSBAR_YD } from "../../static/js/field/grammar.js";
import {
  CORE_MIX, DASH_YD, EDGE_WIDTH, GHOSTED, PLAY_LOOK, SOFT, TONE_FALLBACK, carriersOf, chipSpot, dimOpacityOf, markPop,
  pathOf, playParts, resolvePlayLook, revealAt, shadowInputOf, shadowParts, trailStyle,
} from "../../static/js/field/play-style.js";
import { loadJson } from "./fixtures.mjs";

const TL = loadJson("timeline_tb_dal.json");
const row = (seq) => {
  const r = TL.rows.find((x) => x.seq === seq);
  if (!r) throw new Error(`no row ${seq}`);
  return r;
};
const EPS = 1e-6;
const near = (a, b, label = "") => assert.ok(Math.abs(a - b) <= EPS, `${label} ${a} != ${b}`);
const paintFor = (look) => (team) => teamPaint(TL.teams[team] ?? null, look.teamColor.against, look.teamColor.minContrast);
const envFor = (look = NEUTRAL_LOOK, tokens = {}) => ({ paint: paintFor(look), plays: resolvePlayLook(look, tokens) });
const parts = (seq, look = NEUTRAL_LOOK) => playParts(buildDrawing(row(seq)), row(seq), look, envFor(look));
const ofStep = (list, i) => list.filter((p) => p.step === i);
const D25 = Object.freeze({ ballX: 25, ltgX: 35, dir: 1, poss: "DAL", kind: "snap", goalToGo: false, down: 1, togo: 10 });

test("resolvePlayLook: defaults, the world's overrides, tones from the world, then the page, then the fallback", () => {
  const base = resolvePlayLook(NEUTRAL_LOOK);
  assert.equal(base.headGlow, PLAY_LOOK.headGlow);
  assert.deepEqual(base.tones, TONE_FALLBACK);
  assert.ok(Object.isFrozen(base) && Object.isFrozen(base.tones));
  const tokens = { good: "#7DDB6A", bad: "#ff4d3d", warn: "not a color" };
  const page = resolvePlayLook(NEUTRAL_LOOK, tokens);
  assert.deepEqual(page.tones, { good: "#7ddb6a", bad: "#ff4d3d", warn: TONE_FALLBACK.warn });
  const look = resolveLook({ world: { plays: { headGlow: 3, arrowYd: -2, trackDash: [0.4, 0.6], shadowDash: [1],
    tones: { bad: "#aa0000" }, nope: 1 } } });
  const world = resolvePlayLook(look, tokens);
  assert.equal(world.headGlow, 3);
  assert.equal(world.arrowYd, PLAY_LOOK.arrowYd, "a bad value takes the default");
  assert.deepEqual(world.trackDash, [0.4, 0.6]);
  assert.deepEqual(world.shadowDash, PLAY_LOOK.shadowDash, "a dash needs two lengths");
  assert.equal(world.tones.bad, "#aa0000", "the world's own tone wins over the page's");
  assert.equal(world.nope, undefined, "unknown keys are dropped");
  assert.deepEqual(resolvePlayLook(null), resolvePlayLook({}), "no look at all still resolves");
});

test("carriersOf: possession flips after an interception, a lost ball and a kick's flight", () => {
  const carry = (seq) => carriersOf(row(seq), buildDrawing(row(seq)));
  assert.deepEqual(carry(3), ["DAL", "DAL", "DAL"]);
  assert.deepEqual(carry(104), ["DAL", "DAL", "TB"], "the INT return is the defense's");
  assert.deepEqual(carry(1), ["TB", "DAL"], "a kickoff: the kicking team flies it, the receivers return it");
  assert.deepEqual(carry(113), ["TB", "DAL", "DAL", "DAL"], "the receivers fumble; the mark is the last step");
  assert.deepEqual(carry(43), ["DAL", "TB"]);
  assert.deepEqual(carriersOf(row(13), buildDrawing(row(13))), [], "admin rows have no steps");
});

test("a completion: the arc (edge and core, Light Core Rule), its ground track, the catch dot, then the YAC", () => {
  const list = parts(3);
  const look = NEUTRAL_LOOK;
  const dal = paintFor(look)("DAL");
  const arc = ofStep(list, 0);
  const edge = arc.find((p) => p.type === "stroke" && p.layer === "edge");
  const core = arc.find((p) => p.type === "stroke" && p.layer === "core");
  assert.equal(edge.color, dal.edge);
  assert.equal(core.color, mixHex(dal.edge, look.strokes.arc.core, CORE_MIX));
  assert.equal(core.units, "px");
  assert.equal(core.width, look.strokes.arc.widthPx);
  assert.equal(edge.width, look.strokes.arc.widthPx * EDGE_WIDTH);
  near(edge.inner, 1 / EDGE_WIDTH, "the edge stops where the core starts");
  assert.equal(core.inner, 0);
  assert.equal(core.dash, null, "a real pass draws solid");
  assert.ok(core.order > edge.order);
  assert.ok(core.path.points.length > 8, "the arc is sampled");
  assert.ok(Math.max(...core.path.points.map((p) => p.h)) > 1, "it flies");
  const track = arc.find((p) => p.type === "track");
  assert.deepEqual(track.path.points.map((p) => p.h), [0, 0], "the ground track lies on the turf");
  assert.ok(track.dash && track.opacity < 0.5);
  const dot = ofStep(list, 1);
  assert.deepEqual(dot.map((p) => [p.type, p.glyph, p.layer]), [["mark", "dot", "edge"], ["mark", "dot", "core"]]);
  const yac = ofStep(list, 2);
  assert.ok(yac.some((p) => p.type === "stroke" && p.layer === "core" && p.path.points.every((q) => q.h === 0)));
  assert.ok(yac.some((p) => p.type === "arrow"), "a carry ends in an arrowhead");
  assert.ok(Object.isFrozen(list) && Object.isFrozen(core.path.points));
});

test("an incompletion ends in an X; an interception in INT and the defense's return; a TD in TD", () => {
  const inc = parts(2);
  assert.deepEqual(ofStep(inc, 1).map((p) => p.glyph), ["x", "x"]);
  assert.ok(inc.every((p) => p.dash === null || p.type === "track"), "solid, not dashed (play-drawing.md 4, 5)");
  const int = parts(104);
  const mark = ofStep(int, 1);
  assert.deepEqual(mark.map((p) => [p.glyph, p.text]), [["text", "INT"], ["text", "INT"]]);
  assert.equal(mark.find((p) => p.layer === "edge").color, TONE_FALLBACK.bad);
  const tb = paintFor(NEUTRAL_LOOK)("TB");
  assert.equal(ofStep(int, 2).find((p) => p.type === "stroke" && p.layer === "edge").color, tb.edge);
  const td = parts(159);
  assert.ok(td.some((p) => p.type === "mark" && p.text === "TD"));
});

test("runs, sacks and flags: flat lines, a loss color, the yellow walk, the no-play dimmed and dashed", () => {
  const run = parts(95);
  const line = run.filter((p) => p.type === "stroke");
  assert.equal(line.length, 2);
  assert.ok(line.every((p) => p.path.points.length === 2 && p.path.points.every((q) => q.h === 0)));
  near(line[0].path.length, Math.hypot(86 - 14, 4), "72 yards, 4 yd wide to the left tackle");
  const sack = parts(114);
  const sackEdge = sack.find((p) => p.type === "stroke" && p.layer === "edge");
  assert.equal(sackEdge.color, TONE_FALLBACK.bad);
  assert.ok(sack.some((p) => p.type === "mark" && p.glyph === "burst"));
  const flag = parts(8);
  const ghosted = flag.filter((p) => p.step === 0 && p.type === "stroke");
  const spec = NEUTRAL_LOOK.strokes.ground;
  assert.ok(ghosted.every((p) => p.dash && p.opacity === spec.ghostedOpacity), "a no-play: dimmed and dashed");
  assert.equal(ghosted.find((p) => p.layer === "edge").color,
    mixHex(paintFor(NEUTRAL_LOOK)("DAL").edge, GHOSTED.gray, GHOSTED.mix));
  const walk = flag.filter((p) => p.step === 2 && p.type === "stroke");
  assert.equal(walk.find((p) => p.layer === "core").color, NEUTRAL_LOOK.lines.ltg.color);
  assert.ok(walk.every((p) => p.dash));
  assert.ok(flag.some((p) => p.step === 1 && p.glyph === "flag"));
});

test("kicks: arcs, the landing marks, the field goal's check lifted to the crossbar as a billboard", () => {
  const punt = parts(43);
  assert.ok(punt.some((p) => p.type === "mark" && p.glyph === "arrow"), "out of bounds");
  const fg = parts(87);
  const good = fg.filter((p) => p.type === "mark");
  assert.ok(good.every((p) => p.glyph === "check" && p.billboard && p.lift > CROSSBAR_YD));
  assert.equal(good.find((p) => p.layer === "edge").color, TONE_FALLBACK.good);
  assert.ok(!fg.some((p) => p.type === "arrow" && p.step === 0), "the holder's spot has no arrowhead");
  const kick = parts(161);
  assert.ok(kick.some((p) => p.type === "mark" && p.glyph === "diamond"), "a touchback");
});

test("approximate steps take the look's approx style; a zero-length carry draws nothing", () => {
  const look = resolveLook({ strokes: { ground: { approx: "dashed" }, arc: { approx: "soft" } } });
  const fumble = playParts(buildDrawing(row(113)), row(113), look, envFor(look));
  const loose = fumble.filter((p) => p.step === 2 && p.type === "stroke");
  assert.ok(loose.length && loose.every((p) => p.dash !== null), "the loose ball's runback is an estimate");
  assert.deepEqual(loose.find((p) => p.layer === "core").dash, DASH_YD);
  const soft = resolveLook({ strokes: { arc: { approx: "soft" } } });
  const miss = { ...row(87), seq: 870, kind: "fg_miss", kick: { ...row(87).kick, good: false } };
  const missDrawing = buildDrawing(miss);
  const arcStep = missDrawing.steps.findIndex((s) => s.t === "arc");
  const flight = playParts(missDrawing, miss, soft, envFor(soft)).filter((p) => p.step === arcStep
    && p.type === "stroke");
  near(flight[0].opacity, soft.strokes.arc.opacity * SOFT, "soft: the stroke at 55%");
  const noGain = parts(9);
  assert.equal(noGain.filter((p) => p.type === "stroke" || p.type === "arrow").length, 0);
});

test("world-width strokes for a ribbon look; the mark's size comes from strokes.mark", () => {
  const look = resolveLook({ strokes: { ground: { geometry: "ribbon", widthYd: 0.9 }, mark: { widthYd: 3 } } });
  const list = playParts(buildDrawing(row(5)), row(5), look, envFor(look));
  const core = list.find((p) => p.type === "stroke" && p.layer === "core");
  assert.equal(core.units, "yd");
  assert.equal(core.width, 0.9);
  const inc = playParts(buildDrawing(row(2)), row(2), look, envFor(look));
  assert.equal(inc.find((p) => p.type === "mark" && p.layer === "core").size, 3);
});

test("pathOf and revealAt: the tip of a revealed path is where the ball is (sampled arcs, eased carries)", () => {
  const d = buildDrawing(row(7));
  const arc = pathOf(d.steps[0]);
  assert.equal(arc.points[0].x, d.steps[0].from.x);
  assert.equal(arc.points.at(-1).x, d.steps[0].to.x);
  assert.equal(arc.cum[0], 0);
  near(arc.cum.at(-1), arc.length);
  near(revealAt(arc, 0), 0);
  near(revealAt(arc, 1), arc.length);
  const half = (arc.points.length - 1) / 2;
  near(revealAt(arc, 0.5), (arc.cum[Math.floor(half)] + arc.cum[Math.ceil(half)]) / 2, "half the samples");
  const line = pathOf(buildDrawing(row(5)).steps[0]);
  assert.equal(line.points.length, 2);
  near(revealAt(line, 0.25), line.length / 4);
  assert.equal(pathOf({ t: "mark", at: { x: 1, y: 2 } }), null);
});

test("shadowParts: one dashed, translucent stroke in the shadow tint; the hovered one lit", () => {
  const shadows = buildShadowPlays({ leaves: [{ leaf: "dropback_deep", p: 0.47 }, { leaf: "run_inside", p: 0.2 }] },
    D25, { hover: "screen" });
  const env = envFor();
  const [deep, run] = shadows.map((s) => shadowParts(s, NEUTRAL_LOOK, env));
  assert.equal(deep.length, 2, "the arc, then the ring it is aimed at");
  assert.deepEqual(deep[0].dash, PLAY_LOOK.shadowDash);
  assert.equal(deep[0].width, NEUTRAL_LOOK.strokes.arc.widthPx * PLAY_LOOK.shadowWidth);
  const ring = deep[1];
  assert.ok(ring.dash && ring.lag > 0 && ring.path.points.every((p) => p.h === 0));
  const [cx, cy] = [shadows[0].drawing.steps[0].to.x, shadows[0].drawing.steps[0].to.y];
  assert.ok(ring.path.points.every((p) => Math.abs(Math.hypot(p.x - cx, p.y - cy) - PLAY_LOOK.targetYd) < 1e-9));
  assert.equal(run[1].dash, null, "a run's chevron");
  assert.equal(run[1].path.points[1].x, shadows[1].drawing.steps[0].to.x, "its tip at the end of the run");
  assert.equal(deep[0].color, NEUTRAL_LOOK.ghost.stroke, "ghost.fill neutral: the ghost stroke color");
  assert.equal(deep[0].opacity, 0.5);
  assert.equal(run[0].opacity, 0.35);
  assert.ok(run[0].path.points.every((p) => p.h === 0) && deep[0].path.points.some((p) => p.h > 1));
  assert.ok(run[0].order < deep[0].order);
  const hovered = shadowParts(shadowForLeaf("screen", 0.05, D25, 4), NEUTRAL_LOOK, env);
  assert.equal(hovered[0].opacity, PLAY_LOOK.hoverOpacity);
  const team = resolveLook({ ghost: { fill: "team" } });
  const tinted = shadowParts(shadows[0], team, envFor(team));
  assert.equal(tinted[0].color, mixHex(paintFor(team)("DAL").edge, team.ghost.stroke, CORE_MIX));
  assert.deepEqual(shadowParts(null, NEUTRAL_LOOK, env), []);
});

test("shadowInputOf: a GhostSet (or a shadow input) as buildShadowPlays' source and situation", () => {
  const set = buildGhostSet({ leaves: [{ leaf: "run_inside", p: 0.27 }, { leaf: "pa_short", p: 0.16 },
    { leaf: "dropback_short", p: 0.14 }], all: [{ leaf: "screen", p: 0.05 }, { leaf: "run_inside", p: 0.27 }] }, D25);
  const input = shadowInputOf(set, { poss: "DAL" });
  assert.equal(input.key, set.key);
  assert.deepEqual(input.source.leaves.map((e) => e.leaf), ["run_inside", "pa_short", "dropback_short"]);
  assert.ok(input.source.all.some((e) => e.leaf === "screen"));
  assert.deepEqual(input.situation, { ballX: 25, dir: 1, kind: "snap", poss: "DAL" });
  const shadows = buildShadowPlays(input.source, input.situation);
  assert.deepEqual(shadows.map((s) => s.leaf), ["run_inside", "pa_short"]);
  const direct = { key: "k", source: { leaves: [{ leaf: "screen", p: 0.2 }] }, situation: D25, leafOrder: ["x"] };
  assert.deepEqual(shadowInputOf(direct).situation, { ballX: 25, dir: 1, kind: "snap", poss: "DAL" });
  assert.deepEqual(shadowInputOf(direct).leafOrder, ["x"]);
  assert.equal(shadowInputOf({ source: { leaves: [{ leaf: "screen", p: 0.2 }] } }), null, "no snap known: nothing");
  const live = shadowInputOf({ source: { leaves: [{ leaf: "screen", p: 0.2 }] } }, { live: D25 });
  assert.equal(live.situation.ballX, 25, "a request without a situation is for the live snap");
  assert.ok(live.key.includes("screen"), "a key of its own");
  assert.equal(shadowInputOf(set, { live: { ...D25, poss: "TB" } }).situation.poss, "TB", "the live snap names the team");
  assert.equal(shadowInputOf(set, { live: { ...D25, ballX: 60 }, poss: "DAL" }).situation.poss, "DAL");
  const plays = buildShadowPlays(input.source, input.situation);
  const fromPlays = shadowInputOf(plays);
  assert.deepEqual(fromPlays.situation, { ballX: 25, dir: 1, kind: "snap", poss: "DAL" }, "ShadowPlays: their snap");
  assert.deepEqual(fromPlays.source.leaves.map((e) => e.leaf), ["run_inside", "pa_short"]);
  assert.equal(shadowInputOf(null), null);
  assert.equal(shadowInputOf([]), null);
  assert.equal(shadowInputOf({ shapes: [] }), null);
  assert.equal(shadowInputOf({ shapes: set.shapes, ballX: Number.NaN, dir: 1 }), null);
  assert.equal(shadowInputOf({ ...set, ballX: 25 }, { live: { ...D25, kind: "kickoff" } }).situation.kind, "snap");
});

test("markPop, chipSpot and trailStyle", () => {
  assert.deepEqual(markPop(0), { scale: 1.6, opacity: 0 });
  assert.deepEqual(markPop(1), { scale: 1, opacity: 1 });
  assert.ok(markPop(0.5).scale < 1.3 && markPop(0.5).opacity === 0.5);
  const spot = chipSpot({ text: "Deep pass left · +21", at: { x: 40, y: 20 } }, { lineYd: 3, down: { x: 0, y: -1 } });
  assert.deepEqual(spot, { x: 40, y: 17 });
  assert.deepEqual(chipSpot({ at: { x: 1, y: 2 } }, null), { x: 1, y: 2 - 3.5 });
  const dal = paintFor(NEUTRAL_LOOK)("DAL");
  const trail = trailStyle(NEUTRAL_LOOK, dal);
  assert.equal(trail.kind, "ribbon");
  assert.equal(trail.color, mixHex(dal.edge, NEUTRAL_LOOK.strokes.arc.core, CORE_MIX));
  const hex = resolveLook({ ball: { trail: { kind: "spark", color: "#ffd27a", widthPx: 3, fadeMs: 400 } } });
  assert.deepEqual(trailStyle(hex, dal), { kind: "spark", color: "#ffd27a", widthPx: 3, fadeMs: 400 });
});

test("every part of every real row is well formed (finite points, a color, an order)", () => {
  for (const r of TL.rows) {
    const list = playParts(buildDrawing(r), r, NEUTRAL_LOOK, envFor());
    for (const p of list) {
      assert.match(p.color, /^#[0-9a-f]{6}$/, `${r.seq} ${p.type}`);
      assert.ok(Number.isFinite(p.order) && p.opacity >= 0 && p.opacity <= 1, `${r.seq} ${p.type}`);
      const pts = p.path?.points ?? [p.at];
      assert.ok(pts.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y)), `${r.seq} ${p.type}`);
    }
  }
  const sit = situationFromRow(row(2));
  assert.equal(sit.ballX, 30);
});

test("a stroke's edge may be the team's alternate or a color of its own", () => {
  const alt = resolveLook({ strokes: { ground: { edge: "team-alt" }, arc: { edge: "#123456" } } });
  const env = envFor(alt);
  const run = playParts(buildDrawing(row(5)), row(5), alt, env).find((p) => p.layer === "edge");
  assert.equal(run.color, paintFor(alt)("DAL").alt);
  const pass = playParts(buildDrawing(row(3)), row(3), alt, env).find((p) => p.layer === "edge" && p.step === 0);
  assert.equal(pass.color, "#123456");
  const own = resolveLook({ ghost: { fill: "#abcdef" } });
  const shadow = buildShadowPlays({ leaves: [{ leaf: "run_inside", p: 0.3 }] }, D25)[0];
  assert.equal(shadowParts(shadow, own, envFor(own))[0].color, "#abcdef");
});

test("v1.4 (W6): a kick on display dims further once the next call is up (look.world.plays.kickDim)", () => {
  const base = { lastPlay: { dimOpacity: 0.3 } };
  assert.equal(PLAY_LOOK.kickDim, 1, "by default a kick dims like any play");
  assert.equal(dimOpacityOf(base, { kind: "kickoff" }), 0.3);
  const look = { ...base, world: { plays: { kickDim: 0.4 } } };
  for (const kind of ["kickoff", "punt", "fg"]) near(dimOpacityOf(look, { kind }), 0.12, kind);
  assert.equal(dimOpacityOf(look, { kind: "play" }), 0.3, "a scrimmage play keeps lastPlay.dimOpacity");
  assert.equal(dimOpacityOf(look, null), 0.3);
  assert.equal(resolvePlayLook({ world: { plays: { kickDim: 2 } } }).kickDim, 1, "out of range: the default");
});

// ---------------------------------------------------------------- G3-1: two shadow plays that read as two plays
const RAMP = Object.freeze({ pass: "#fff3d1", run: "#ffb21e", rpo: "#ffd27a" });
const CASING = Object.freeze({ color: "#0d1424", opacity: 0.4, width: 1.8 });
const familyLook = (plays = {}) => resolveLook({ ghost: { tint: "family" },
  world: { plays: { families: RAMP, casing: CASING, shadowWidth: 3.2, ...plays } } });
/** A shadow's own parts: its stroke and end cue (no casing), by type and order. */
const lit = (list) => list.filter((p) => p.layer !== "casing");
const casings = (list) => list.filter((p) => p.layer === "casing");

test("G3-1: ghost.tint family colors each shadow by its family on the board's ramp: pass warm, run amber, RPO gold", () => {
  const look = familyLook();
  const env = envFor(look);
  const shadows = buildShadowPlays({ leaves: [{ leaf: "run_inside", p: 0.28 }, { leaf: "pa_short", p: 0.16 },
    { leaf: "rpo_run", p: 0.05 }, { leaf: "dropback_deep", p: 0.04 }, { leaf: "screen", p: 0.03 }] }, D25,
  { hover: "rpo_run" });
  const color = (leaf) => lit(shadowParts(shadows.find((s) => s.leaf === leaf), look, env)).map((p) => p.color);
  assert.deepEqual(color("run_inside"), [RAMP.run, RAMP.run], "the run's line and its chevron in amber");
  assert.deepEqual(color("pa_short"), [RAMP.pass, RAMP.pass], "play-action is a pass: warm white");
  assert.deepEqual(color("rpo_run"), [RAMP.rpo, RAMP.rpo], "the RPO in gold, between the two");
  for (const leaf of ["dropback_deep", "screen"]) {
    const one = shadowForLeaf(leaf, 0.04, D25, 4);
    assert.deepEqual(lit(shadowParts(one, look, env)).map((p) => p.color), [RAMP.pass, RAMP.pass], leaf);
  }
  const partial = resolveLook({ ghost: { tint: "family", stroke: "#abcdef" }, world: { plays: { families: { run: RAMP.run } } } });
  assert.equal(lit(shadowParts(shadows[1], partial, envFor(partial)))[0].color, "#abcdef",
    "a family the world gives no tone takes ghost.stroke (the fallback the 2D field draws with)");
});

test("G3-1: shadows stay dashed and translucent (0.5, 0.35) and wider; a dark casing rings each dashed stroke", () => {
  const look = familyLook();
  const env = envFor(look);
  const [run, pa] = buildShadowPlays({ leaves: [{ leaf: "run_inside", p: 0.28 }, { leaf: "pa_short", p: 0.16 }] }, D25);
  const runParts = shadowParts(run, look, env);
  const paParts = shadowParts(pa, look, env);
  const [runStroke] = lit(runParts);
  const [paStroke, ring] = lit(paParts);
  assert.equal(runStroke.opacity, 0.5);
  assert.equal(paStroke.opacity, 0.35);
  assert.deepEqual(paStroke.dash, PLAY_LOOK.shadowDash, "dashed, never solid (play-drawing.md 4)");
  near(runStroke.width, look.strokes.ground.widthPx * 3.2, "the world's shadowWidth (a px-wide ground here)");
  near(paStroke.width, look.strokes.arc.widthPx * 3.2);
  for (const [own, list] of [[runParts, lit(runParts)], [paParts, lit(paParts)]]) {
    const under = casings(own);
    assert.equal(under.length, list.length, "one casing per part: the stroke and its end cue");
    under.forEach((c, i) => {
      const p = list[i];
      assert.equal(c.path, p.path, "the same path");
      assert.equal(c.color, CASING.color);
      assert.equal(c.opacity, CASING.opacity);
      near(c.width, p.width * CASING.width, "1.8x the stroke's width");
      near(c.inner, 1 / CASING.width, "a ring outside the stroke: the stroke's own color is never darkened");
      assert.deepEqual(c.dash, p.dash, "dashed with its stroke");
      assert.equal(c.lag, p.lag, "and drawn as it grows");
      assert.ok(c.order < p.order, "under it");
      assert.equal(c.units, p.units);
    });
  }
  assert.ok(ring.dash, "the pass's target ring is dashed too");
  const chevron = lit(runParts)[1];
  near(chevron.width, look.strokes.ground.widthPx * 1.6, "a wide shadow's chevron stays a chevron (at most 1.6x)");
  near(lit(shadowParts(run, NEUTRAL_LOOK, envFor()))[1].width, NEUTRAL_LOOK.strokes.ground.widthPx
    * PLAY_LOOK.shadowWidth, "the neutral one is as wide as its stroke");
});

test("G3-1: without tint family (the neutral world) a shadow keeps ghost.stroke and no casing; bad values fall back", () => {
  const env = envFor();
  const [run] = buildShadowPlays({ leaves: [{ leaf: "run_inside", p: 0.28 }] }, D25);
  const plain = shadowParts(run, NEUTRAL_LOOK, env);
  assert.equal(casings(plain).length, 0);
  assert.ok(plain.every((p) => p.color === NEUTRAL_LOOK.ghost.stroke));
  const fill = resolveLook({ ghost: { tint: "fill" }, world: { plays: { families: RAMP } } });
  assert.ok(shadowParts(run, fill, envFor(fill)).every((p) => p.color === fill.ghost.stroke), "tint fill: one color");
  const bad = resolvePlayLook({ world: { plays: { families: { pass: "white", run: "#FFB21E", nope: "#000000" },
    casing: { color: "#00000", opacity: 2, width: 9 } } } });
  assert.deepEqual(bad.families, { pass: null, run: "#ffb21e", rpo: null }, "hex colors only, lowercased");
  assert.deepEqual(bad.casing, { color: null, opacity: PLAY_LOOK.casing.opacity, width: PLAY_LOOK.casing.width });
  assert.deepEqual(resolvePlayLook(NEUTRAL_LOOK).casing, { color: null, opacity: 0.4, width: 1.8 }, "no casing by default");
});

test("G3-5: every kick kind the server sends (timeline.py KICKS) dims as a kick, a missed field goal included", () => {
  const src = readFileSync(new URL("../../timeline.py", import.meta.url), "utf8");
  const kicks = [...(src.match(/^KICKS\s*=\s*\(([^)]*)\)/m)?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(kicks.includes("fg_miss"), `timeline.py KICKS: ${kicks}`);
  const look = { lastPlay: { dimOpacity: 0.3 }, world: { plays: { kickDim: 0.4 } } };
  for (const kind of kicks) near(dimOpacityOf(look, { kind }), 0.12, kind);
  const miss = { ...row(87), seq: 870, kind: "fg_miss", kick: { ...row(87).kick, good: false } };
  near(dimOpacityOf(look, buildDrawing(miss)), 0.12, "a missed field goal's drawing");
});
