// The shadow plays before a caller snap (A5 part 2; play-drawing.md 4 and 4b, binding): ghost-layer.js on a WebGL-free
// stage. The top 2 of his model as thin dashed lines in their rank's colour, in the same shape language as real plays,
// each plate tagged "NEXT 1 · ..." and placed in screen space, the hovered play lit (and drawn when it is outside the
// top 2), faded at the snap, laid out again when the view changes; the previous play turns steel with its LAST plate.
import assert from "node:assert/strict";
import test from "node:test";
import { D25, TL, actionStage, artsUnder, row, stripsUnder } from "./action-stage.mjs";

const { buildGhostSet } = await import("../../static/js/field/ghosts.js");
const { buildDrawing } = await import("../../static/js/field/paths.js");
const { fitPlan, planDrawing } = await import("../../static/js/field/timing.js");
const { ALL } = await import("../../static/js/field/play-strip.js");
const { PLAY_LOOK } = await import("../../static/js/field/play-style.js");
const { shadowOpacity } = await import("../../static/js/field/shadow-style.js");
const { verdictChipText } = await import("../../static/js/model/vm-field.js");

const INPUT = Object.freeze({
  leaves: [{ leaf: "run_inside", p: 0.273 }, { leaf: "pa_short", p: 0.158 }, { leaf: "dropback_short", p: 0.14 }],
  all: [{ leaf: "run_inside", p: 0.273 }, { leaf: "pa_short", p: 0.158 }, { leaf: "dropback_short", p: 0.14 },
    { leaf: "dropback_deep", p: 0.12 }, { leaf: "screen", p: 0.05 }, { leaf: "run_edge_left", p: 0.04 }],
});
const SET = buildGhostSet(INPUT, D25);
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

async function setup(opts = {}) {
  const env = await actionStage(opts);
  const L = env.layers();
  env.stage.cams.view({ situation: D25, ghosts: SET }, { instant: true });
  L.overlays.situation(D25);
  return { ...env, L };
}

const shadowRoot = (stage) => stage.roots.ghosts.children.find((c) => c.name === "shadow-plays");
const shadowLabels = (stage) => stage.labels.byClass("sc-shadow-label");
/** The shadows' own strokes (dashed at PLAY_LOOK.shadowDash), not their end cues. */
const mainStrokes = (stage) => stripsUnder(shadowRoot(stage))
  .filter((m) => m.material.uniforms.uDash.value.x === PLAY_LOOK.shadowDash[0]);

test("show: his top 2 as thin dashed lines past the line of scrimmage, each plate tagged and placed by its stroke", async () => {
  const { stage, L } = await setup({ reduced: true });
  L.ghosts.show(SET);
  assert.deepEqual(L.ghosts.shown(), ["run_inside", "pa_short"]);
  assert.deepEqual(shadowLabels(stage).map((h) => h.text()), ["NEXT 1 · Inside run (A/B gap) · 27%",
    "NEXT 2 · PA short (0–9) · 16%"]);
  assert.deepEqual(shadowLabels(stage).map((h) => h.words?.tag), ["NEXT 1", "NEXT 2"], "the tag on its own tab");
  const strips = mainStrokes(stage);
  assert.equal(strips.length, 2, "one stroke each");
  assert.equal(stripsUnder(shadowRoot(stage)).length, 4, "and where each ends: an arrowhead, a tick");
  assert.ok(strips.every((m) => m.material.uniforms.uWidth.value <= 3), "thin: about 2.5 px");
  const opacities = strips.map((m) => m.material.uniforms.uOpacity.value).sort();
  near(opacities[0], shadowOpacity(0.35, { shadowBase: PLAY_LOOK.shadowBase, shadowGain: PLAY_LOOK.shadowGain }));
  near(opacities[1], shadowOpacity(0.5, { shadowBase: PLAY_LOOK.shadowBase, shadowGain: PLAY_LOOK.shadowGain }));
  const [first, second] = shadowLabels(stage);
  assert.ok(first.element.classList.contains("rank-1") && second.element.classList.contains("rank-2"));
  assert.ok(first.offset && second.offset, "placed in screen space: an offset from a point by its own stroke");
  const layout = L.ghosts.clarity();
  assert.ok(layout.plates.every((pl) => pl.clear), JSON.stringify(layout.plates));
});

test("each plate keeps its rank (and family) classes through a hover and a layout, once each", async () => {
  const { stage, L } = await setup({ reduced: true });
  L.ghosts.show(SET);
  const classes = () => shadowLabels(stage).map((h) => h.element.className.split(/\s+/)
    .filter((c) => c.startsWith("family-") || c.startsWith("rank-")));
  assert.deepEqual(classes(), [["rank-1", "family-run"], ["rank-2", "family-pa"]]);
  L.ghosts.highlight("screen");
  assert.ok(classes().some((c) => c.includes("family-screen")), "the hovered screen's plate too");
  L.ghosts.highlight(null);
  L.ghosts.relayout();
  assert.deepEqual(classes(), [["rank-1", "family-run"], ["rank-2", "family-pa"]], "kept through a layout, once each");
});

test("4b: #1 in amber, #2 in warm white (never by family or team), each over a thin dark casing", async () => {
  const look = { world: { plays: { ranks: ["#ffb21e", "#fff3d1"], casing: { color: "#0d1424", opacity: 0.4,
    width: 1.8 } } } };
  const { stage, L } = await setup({ reduced: true, look });
  L.ghosts.show(SET);
  const strips = stripsUnder(shadowRoot(stage));
  const hex = (m) => `#${m.material.uniforms.uColor.value.getHexString()}`;
  const colors = new Set(strips.map(hex));
  assert.ok(colors.has("#ffb21e") && colors.has("#fff3d1") && colors.has("#0d1424"), [...colors].join(" "));
  const runStroke = mainStrokes(stage).find((m) => hex(m) === "#ffb21e");
  assert.ok(runStroke, "his #1 (the inside run) in amber");
  const casings = strips.filter((m) => hex(m) === "#0d1424");
  assert.equal(casings.length, 4, "a casing under each stroke and each end mark");
  assert.ok(casings.every((m) => m.material.uniforms.uInner.value > 0.5), "rings outside the strokes");
  assert.ok(casings.every((m) => strips.some((s) => s !== m && s.geometry !== m.geometry && s.renderOrder > m.renderOrder)));
  L.ghosts.fade(0, 0);
  assert.equal(stripsUnder(shadowRoot(stage)).length, 0, "the casings go with their shadows");
});

test("they grow out of the line of scrimmage over ghostInMs, then the loop may stop", async () => {
  const { stage, L, tick } = await setup();
  L.ghosts.show(SET);
  const strips = stripsUnder(shadowRoot(stage));
  assert.ok(strips.every((m) => m.material.uniforms.uReveal.value === 0 || !m.visible), "not drawn yet");
  assert.equal(tick(100), true);
  assert.equal(tick(stage.look.motion.ghostInMs), false);
  assert.ok(strips.every((m) => m.material.uniforms.uReveal.value === ALL));
});

test("the previous play dims when the call goes up (and not while a past play is reviewed)", async () => {
  const { stage, L, tick } = await setup({ reduced: true });
  const drawing = buildDrawing(row(2));
  const plan = fitPlan(planDrawing(drawing, stage.look.motion), 2000);
  L.player.start(drawing, plan, row(2)).finish();
  L.ghosts.show(SET);
  tick(50);
  const [art] = artsUnder(stage.roots.plays);
  const core = stripsUnder(art).find((m) => m.material.uniforms.uInner.value === 0 && m.renderOrder > 8);
  near(core.material.uniforms.uOpacity.value, core.material.userData.opacity * stage.look.lastPlay.dimOpacity);
  assert.equal(`#${core.material.uniforms.uColor.value.getHexString()}`, PLAY_LOOK.last.core, "4b: in muted steel");
  const words = stage.labels.byClass("sc-play-label")[0];
  assert.deepEqual([words.words?.tag, words.words?.body], ["LAST", "Short pass middle · incomplete"]);
  assert.ok(words.element.classList.contains("is-last"));
  assert.ok(words.offset, "the LAST plate is placed in screen space with the predictions'");
  const fresh = await setup({ reduced: true });
  fresh.L.player.start(drawing, plan, row(2)).finish();
  fresh.L.player.review({ row: row(104), drawing: buildDrawing(row(104)) });
  fresh.L.ghosts.show(SET);
  fresh.L.player.review(null);
  const [live] = artsUnder(fresh.stage.roots.plays).filter((a) => a.visible);
  const liveCore = stripsUnder(live).find((m) => m.material.uniforms.uInner.value === 0 && m.renderOrder > 8);
  near(liveCore.material.uniforms.uOpacity.value, liveCore.material.userData.opacity);
});

/** The LAST plate's words ({ tag, body, sub }) once his next call is up, after `draw` put a play on display. */
async function lastPlateAfter(draw) {
  const { stage, L } = await setup({ reduced: true });
  draw(L, stage);
  L.ghosts.show(SET);
  return { ...stage.labels.byClass("sc-play-label")[0].words };
}
/** A jump or a step: the play drawn at once (scene.js placeAll), so no verdict is marked and no chip goes up. */
const atOnce = (seq) => (L) => L.player.placeAll([{ row: row(seq), drawing: buildDrawing(row(seq)) }]);
/** What the conductor's markVerdict gives a graded play's chip: what was graded, in the timeline's own leaf names. */
const chipWords = (seq) => verdictChipText(row(seq).pred, TL.meta.leaf_names);

test("4b: a play drawn at once (a jump, a step) keeps its verdict on its LAST plate, in its chip's words", async () => {
  assert.deepEqual(await lastPlateAfter(atOnce(126)),
    { tag: "LAST", body: "Short pass left · +11", sub: "Top pick · 19%" });
  assert.deepEqual(await lastPlateAfter(atOnce(151)),
    { tag: "LAST", body: "Short pass left · +15", sub: "Miss · #4 Intermediate · 10%" });
  const watched = await lastPlateAfter((L, stage) => {        // drawn, landed, then graded (scene.js markVerdict)
    const drawing = buildDrawing(row(151));
    L.player.start(drawing, fitPlan(planDrawing(drawing, stage.look.motion), 2000), row(151)).finish();
    L.player.verdict({ seq: 151, key: "miss" });
    L.overlays.retext("live", 151, chipWords(151));
  });
  assert.equal(watched.sub, chipWords(151), "the chip's words when it went up");
  assert.equal((await lastPlateAfter(atOnce(151))).sub, watched.sub, "the same words either way");
  assert.equal((await lastPlateAfter(atOnce(15))).sub, "", "a TB play has no verdict");
  assert.equal((await lastPlateAfter(atOnce(43))).sub, "", "nor his punt: no call to grade");
});

test("hover: a play outside the top 2 gets its shadow, lit; the others step back; leaving restores them", async () => {
  const { stage, L } = await setup({ reduced: true });
  L.ghosts.show(SET);
  const before = mainStrokes(stage);
  L.ghosts.highlight("screen");
  assert.equal(shadowLabels(stage).length, 3, "the hovered play is drawn too");
  assert.deepEqual(L.ghosts.shown(), ["run_inside", "pa_short"], "the data-ghosts hook: his top 2 (2D parity)");
  const hovered = shadowLabels(stage).find((h) => h.text().includes("Screen"));
  assert.ok(hovered.element.classList.contains("is-hovered"));
  assert.ok(shadowLabels(stage).filter((h) => h !== hovered).every((h) => h.element.classList.contains("is-muted")));
  const strips = mainStrokes(stage);
  assert.equal(strips.length, 3);
  assert.ok(before.every((m) => strips.includes(m)), "the top 2 keep their meshes");
  near(strips.find((m) => !before.includes(m)).material.uniforms.uOpacity.value, PLAY_LOOK.hoverOpacity);
  near(before[0].material.uniforms.uOpacity.value, before[0].material.userData.opacity * PLAY_LOOK.dimOthers);
  L.ghosts.highlight(null);
  assert.equal(shadowLabels(stage).length, 2);
  assert.ok(shadowLabels(stage).every((h) => !h.element.classList.contains("is-muted")));
  L.ghosts.highlight("run_inside");
  assert.ok(shadowLabels(stage)[0].element.classList.contains("is-hovered"), "a top play is only lit");
});

test("at the snap the text goes and the strokes fade to afterSnapOpacity; to zero they are gone", async () => {
  const { stage, L, tick } = await setup();
  L.ghosts.show(SET);
  tick(500);
  L.ghosts.fade(0.12, 200);
  assert.equal(tick(100), true);
  tick(200);
  assert.equal(shadowLabels(stage).length, 0);
  assert.deepEqual(L.ghosts.shown(), [], "the hook empties once the ball is snapped");
  const strips = mainStrokes(stage);
  assert.equal(strips.length, 2);
  near(strips[0].material.uniforms.uOpacity.value, strips[0].material.userData.opacity * 0.12);
  L.ghosts.highlight("screen");
  assert.equal(mainStrokes(stage).length, 2, "no hover once the ball is snapped");
  L.ghosts.show(SET);
  assert.equal(shadowLabels(stage).length, 3, "the same call again after the snap: shown again, the hover kept");
  L.ghosts.highlight(null);
  assert.equal(shadowLabels(stage).length, 2);
  L.ghosts.fade(0, 0);
  assert.equal(stripsUnder(shadowRoot(stage)).length, 0);
});

test("the same call is kept as is; a new one replaces it; none clears", async () => {
  const { stage, L } = await setup({ reduced: true });
  L.ghosts.show(SET);
  const strips = stripsUnder(shadowRoot(stage));
  L.ghosts.show(SET);
  assert.deepEqual(stripsUnder(shadowRoot(stage)), strips, "the same meshes");
  L.ghosts.show(buildGhostSet({ leaves: [{ leaf: "dropback_deep", p: 0.4 }, { leaf: "screen", p: 0.2 }] }, D25));
  assert.deepEqual(L.ghosts.shown(), ["dropback_deep", "screen"]);
  assert.ok(stripsUnder(shadowRoot(stage)).every((m) => !strips.includes(m)));
  L.ghosts.show(null);
  assert.equal(stripsUnder(shadowRoot(stage)).length, 0);
  assert.equal(shadowLabels(stage).length, 0);
  L.ghosts.show(buildGhostSet(INPUT, { ...D25, kind: "kickoff" }));
  assert.deepEqual(L.ghosts.shown(), [], "no shadows on a kickoff");
});

test("a camera change lays the text out again for the new view (V, a resize, the safe area)", async () => {
  const { stage, L, tick } = await setup({ reduced: true });
  L.ghosts.show(SET);
  tick(16);
  const spot = (h) => ({ ...h.pt, ...h.offset });
  const before = shadowLabels(stage).map(spot);
  stage.cams.setMode("endzone", { instant: true });
  tick(16);
  const after = shadowLabels(stage).map(spot);
  assert.notDeepEqual(after, before, "laid out in the end zone camera's own view");
  assert.equal(after.length, 2);
  L.ghosts.relayout();
  assert.deepEqual(shadowLabels(stage).map(spot), after, "the same view lays out the same");
});

test("the text waits while the camera is still far from the view it settles on, then steps in", async () => {
  const { stage, L, tick } = await setup({ reduced: true });
  stage.keepAlive((dt) => stage.cams.step(dt));
  stage.cams.view({ situation: { ...D25, ballX: 80, ltgX: 90 } }, { instant: true });
  stage.cams.view({ situation: D25, ghosts: SET });
  L.ghosts.show(SET);
  assert.equal(mainStrokes(stage).length, 2, "the strokes show at once");
  assert.ok(shadowLabels(stage).every((h) => h.object.visible === false), "no text laid out for a view not reached");
  tick(4000);
  assert.ok(shadowLabels(stage).length === 2 && shadowLabels(stage).every((h) => h.object.visible === true));
});

test("ghost.labels false draws no text; dispose removes the layer", async () => {
  const { stage, L } = await setup({ reduced: true, look: { ghost: { labels: false } } });
  L.ghosts.show(SET);
  assert.equal(shadowLabels(stage).length, 0);
  assert.equal(mainStrokes(stage).length, 2);
  L.ghosts.dispose();
  assert.equal(shadowRoot(stage), undefined);
});

test("the shadow text's plate is measured from the world's CSS once per canvas size; a layout fault is a warning", async () => {
  const { stage, L, st } = await setup({ reduced: true });
  const appended = [];
  const el = () => ({ style: {}, className: "", textContent: "", children: [],
    appendChild(c) { this.children.push(c); appended.push(c); }, remove() { this.removed = true; },
    getBoundingClientRect: () => ({ width: 250, height: 26 }) });
  stage.doc = { createElement: el, defaultView: { getComputedStyle: () => ({ paddingLeft: "6px", paddingRight: "6px",
    borderLeftWidth: "1px", borderRightWidth: "1px", getPropertyValue: () => "" }) } };
  stage.host = { appendChild: (c) => appended.push(c), querySelector: () => null };
  L.ghosts.show(SET);
  const probe = appended.find((c) => c.className === "sc-field-label");
  assert.ok(probe?.removed, "measured, then taken away");
  assert.match(probe.children[0].className, /sc-shadow-label rank-1/);
  L.ghosts.relayout();
  assert.equal(appended.filter((c) => c.className === "sc-field-label").length, 1, "once per size");
  L.ghosts.show(buildGhostSet({ leaves: [{ leaf: "dropback_deep", p: Number.NaN }] }, D25));
  assert.equal(st.warnings.length, 0, "a call with no usable odds draws nothing, quietly");
});
