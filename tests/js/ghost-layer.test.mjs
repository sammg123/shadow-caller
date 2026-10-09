// The shadow plays before a caller snap (A5 part 2; play-drawing.md 4, binding): ghost-layer.js on a WebGL-free stage.
// The top 2 of his model, dashed and translucent in the same shape language as real plays, text underneath, the hovered
// play lit (and drawn when it is outside the top 2), faded at the snap, laid out again when the view changes.
import assert from "node:assert/strict";
import test from "node:test";
import { D25, actionStage, artsUnder, row, stripsUnder } from "./action-stage.mjs";

const { buildGhostSet } = await import("../../static/js/field/ghosts.js");
const { buildDrawing } = await import("../../static/js/field/paths.js");
const { fitPlan, planDrawing } = await import("../../static/js/field/timing.js");
const { ALL } = await import("../../static/js/field/play-strip.js");
const { PLAY_LOOK } = await import("../../static/js/field/play-style.js");

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

test("show: his top 2 as dashed, translucent shadows from the line of scrimmage, text underneath", async () => {
  const { stage, L } = await setup({ reduced: true });
  L.ghosts.show(SET);
  assert.deepEqual(L.ghosts.shown(), ["run_inside", "pa_short"]);
  assert.deepEqual(shadowLabels(stage).map((h) => h.text()), ["1 · Inside run (A/B gap) · 27%", "2 · PA short (0–9) · 16%"]);
  const strips = mainStrokes(stage);
  assert.equal(strips.length, 2, "one stroke each");
  assert.equal(stripsUnder(shadowRoot(stage)).length, 4, "and where each ends: a chevron, a target ring");
  const opacities = strips.map((m) => m.material.uniforms.uOpacity.value).sort();
  assert.deepEqual(opacities, [0.35, 0.5]);
  const [first] = shadowLabels(stage);
  assert.ok(first.element.classList.contains("rank-1"));
  assert.ok(first.pt.y < D25.ballX, "underneath (toward the near sideline the camera sits on)");
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
  const fresh = await setup({ reduced: true });
  fresh.L.player.start(drawing, plan, row(2)).finish();
  fresh.L.player.review({ row: row(104), drawing: buildDrawing(row(104)) });
  fresh.L.ghosts.show(SET);
  fresh.L.player.review(null);
  const [live] = artsUnder(fresh.stage.roots.plays).filter((a) => a.visible);
  const liveCore = stripsUnder(live).find((m) => m.material.uniforms.uInner.value === 0 && m.renderOrder > 8);
  near(liveCore.material.uniforms.uOpacity.value, liveCore.material.userData.opacity);
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
  const before = shadowLabels(stage).map((h) => ({ ...h.pt }));
  stage.cams.setMode("endzone", { instant: true });
  tick(16);
  const after = shadowLabels(stage).map((h) => ({ ...h.pt }));
  assert.notDeepEqual(after, before, "laid out in the end zone camera's own metrics");
  assert.equal(after.length, 2);
  L.ghosts.relayout();
  assert.deepEqual(shadowLabels(stage).map((h) => ({ ...h.pt })), after, "the same view lays out the same");
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
