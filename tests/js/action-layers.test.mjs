// The action layer (A5 part 2; play-drawing.md, binding): player.js, overlays.js and residue.js on a WebGL-free stage
// (tests/js/action-stage.mjs), through the 14.4 layer contract the facade (scene.js) drives.
import assert from "node:assert/strict";
import test from "node:test";
import { D25, TL, actionStage, artsUnder, row, stripsUnder } from "./action-stage.mjs";

const { buildDrawing } = await import("../../static/js/field/paths.js");
const { fitPlan, planDrawing } = await import("../../static/js/field/timing.js");
const { ALL } = await import("../../static/js/field/play-strip.js");

const planFor = (stage, drawing, ms = 3000) => fitPlan(planDrawing(drawing, stage.look.motion), ms);
const item = (seq) => ({ row: row(seq), drawing: buildDrawing(row(seq)) });

function run(stage, layers, seq, ms = 3000) {
  const drawing = buildDrawing(row(seq));
  const plan = planFor(stage, drawing, ms);
  const job = layers.player.start(drawing, plan, row(seq));
  for (let t = 0; t <= plan.totalMs; t += 50) job.update(t);
  assert.equal(job.update(plan.totalMs), false);
  return { drawing, plan, job };
}

test("a completion draws from the line of scrimmage: arc, catch, YAC, then its words; the ball hands back", async () => {
  const { stage, layers } = await actionStage();
  const L = layers();
  stage.lines.set(D25, { instant: true });
  const drawing = buildDrawing(row(3));
  const plan = planFor(stage, drawing);
  const job = L.player.start(drawing, plan, row(3));
  assert.equal(stage.lines.state().ball.visible, false, "the player flies its own ball");
  const arc = plan.steps[0];
  assert.equal(job.update((arc.startMs + arc.endMs) / 2), true);
  assert.ok(job.ball().h > 0.5, "the ball is in the air");
  assert.equal(stage.labels.texts().length, 0, "no words before the play lands");
  const [art] = artsUnder(stage.roots.plays);
  const core = stripsUnder(art).find((m) => m.material.uniforms.uInner.value === 0 && m.renderOrder > 8);
  assert.ok(core.material.uniforms.uReveal.value < ALL);
  assert.equal(job.update(plan.totalMs), false);
  assert.equal(job.ball(), null);
  assert.deepEqual(stage.labels.texts(), ["Short pass middle · +8"]);
  const [label] = stage.labels.live;
  assert.ok(label.element.classList.contains("sc-play-label"));
  assert.deepEqual([label.object.center.x, label.object.center.y], [0.5, 0.5]);
  assert.deepEqual(label.pt, { ...drawing.label.at, h: 0 });
  assert.equal(L.player.lastDrawing(), drawing);
});

test("every row of the game draws whole, from start to finish, and clearing leaves nothing behind", async () => {
  const { stage, layers } = await actionStage();
  const L = layers();
  for (const r of TL.rows) {
    const drawing = buildDrawing(r);
    if (!drawing.steps.length) continue;
    const plan = planFor(stage, drawing, 2000);
    const job = L.player.start(drawing, plan, r);
    job.update(plan.totalMs / 3);
    job.finish();
  }
  assert.equal(artsUnder(stage.roots.plays).length, 1, "only the play on display");
  assert.ok(L.residue.count() > 0 && L.residue.count() < 20, "the last drive's earlier plays");
  L.player.clear();
  L.residue.clear();
  assert.equal(artsUnder(stage.roots.plays).length, 0);
  assert.equal(stage.labels.live.length, 0);
  assert.equal(stage.roots.residue.children[0].children.length, 0);
});

test("the next play hands the last one to residue: same drive kept, a new drive starts clean", async () => {
  const { stage, layers } = await actionStage();
  const L = layers();
  run(stage, L, 2);
  run(stage, L, 3);
  assert.equal(L.residue.count(), 1);
  assert.deepEqual(stage.labels.texts(), ["Short pass middle · +8"], "the old words go with it");
  run(stage, L, 5);
  assert.equal(L.residue.count(), 2);
  run(stage, L, 14);
  assert.equal(L.residue.count(), 0, "TB's drive: DAL's plays leave");
  const merged = stage.roots.residue.children[0];
  run(stage, L, 15);
  assert.ok(merged.children.length > 0 && merged.children.length <= 12, "merged per material");
});

test("residue keep none and game; instant rows (placeAll) keep the last one with steps on display", async () => {
  const none = await actionStage({ look: { residue: { keep: "none", opacity: 0.3 } } });
  const Ln = none.layers();
  Ln.player.placeAll(TL.rows.slice(0, 40).map((r) => ({ row: r, drawing: buildDrawing(r) })));
  assert.equal(Ln.residue.count(), 0);
  const game = await actionStage({ look: { residue: { keep: "game", opacity: 0.2 } } });
  const Lg = game.layers();
  Lg.player.placeAll(TL.rows.map((r) => ({ row: r, drawing: buildDrawing(r) })));
  assert.equal(Lg.residue.count(), TL.rows.filter((r) => buildDrawing(r).steps.length).length - 1);
  assert.ok(game.stage.roots.residue.children[0].children.length <= 40, "a whole game: one draw a material");
  assert.deepEqual(game.stage.labels.texts(), ["Kneel · −1"]);
  Lg.player.placeAll([item(13)]);
  assert.deepEqual(game.stage.labels.texts(), ["Kneel · −1"], "an admin row changes nothing");
});

test("dimLast: the play on display dims to look.lastPlay.dimOpacity; until-presnap retires it", async () => {
  const { stage, layers, tick } = await actionStage();
  const L = layers();
  run(stage, L, 3);
  L.player.dimLast();
  assert.equal(tick(stage.look.motion.ghostInMs + 50), false, "the dim eases in, then the loop may stop");
  const [art] = artsUnder(stage.roots.plays);
  const core = stripsUnder(art).find((m) => m.material.uniforms.uInner.value === 0);
  assert.ok(Math.abs(core.material.uniforms.uOpacity.value - core.material.userData.opacity * 0.5) < 1e-9);
  assert.ok(stage.labels.live[0].element.classList.contains("is-dim"));
  const presnap = await actionStage({ look: { lastPlay: { keep: "until-presnap", dimOpacity: 0.5 } }, reduced: true });
  const Lp = presnap.layers();
  run(presnap.stage, Lp, 3);
  Lp.player.dimLast();
  assert.equal(artsUnder(presnap.stage.roots.plays).length, 0);
  assert.equal(Lp.residue.count(), 1);
});

test("v1.4 (W6): a kick on display dims to lastPlay.dimOpacity times the world's kickDim", async () => {
  const { stage, layers, tick } = await actionStage({ look: { world: { plays: { kickDim: 0.4 } } } });
  const L = layers();
  run(stage, L, 1);
  L.player.dimLast();
  tick(stage.look.motion.ghostInMs + 50);
  const [art] = artsUnder(stage.roots.plays);
  const core = stripsUnder(art).find((m) => m.material.uniforms.uInner.value === 0);
  const want = core.material.userData.opacity * stage.look.lastPlay.dimOpacity * 0.4;
  assert.ok(Math.abs(core.material.uniforms.uOpacity.value - want) < 1e-9);
});

test("verdict: a chip under the play's words, on the live play only; a retag relabels words and grade", async () => {
  const { stage, layers } = await actionStage();
  const L = layers();
  run(stage, L, 3);
  L.player.verdict({ seq: 2, key: "top1" });
  assert.equal(stage.labels.byClass("sc-verdict-chip").length, 0, "not the play on display");
  L.player.verdict({ seq: 3, key: "top1" });
  const [chip] = stage.labels.byClass("sc-verdict-chip");
  assert.equal(chip.text(), "Top pick");
  assert.ok(chip.element.classList.contains("is-top1"));
  assert.equal(L.overlays.chip("live").seq, 3);
  const retag = { ...row(3), pred: { ...row(3).pred, family: "pa", leaf: "pa_short", leaf_rank: 2 } };
  L.player.relabel([retag]);
  assert.ok(stage.labels.texts().includes("Play-action short pass middle · +8"));
  assert.equal(stage.labels.byClass("sc-verdict-chip")[0].text(), "In his top 3");
  run(stage, L, 5);
  assert.equal(L.overlays.chip("live"), null, "the chip leaves with its play");
  L.player.verdict({ seq: 5, key: "none" });
  assert.equal(L.overlays.chip("live"), null);
});

test("review: one past play replayed with its words and grade while the live plays step aside", async () => {
  const { stage, layers, tick } = await actionStage();
  const L = layers();
  run(stage, L, 2);
  run(stage, L, 3);
  const live = artsUnder(stage.roots.plays)[0];
  L.player.review(item(104));
  assert.equal(live.visible, false);
  assert.equal(stage.roots.residue.children[0].visible, false);
  assert.equal(stage.labels.live.find((h) => h.text() === "Short pass middle · +8").object.visible, false);
  assert.equal(tick(200), true, "the review replays");
  tick(5000);
  assert.ok(stage.labels.texts().includes("Pass intercepted · short middle"));
  assert.equal(L.overlays.chip("review").key, "top1");
  assert.equal(L.residue.reviewDrawing().seq, 104);
  L.player.review(null);
  assert.equal(live.visible, true);
  assert.equal(stage.roots.residue.children[0].visible, true);
  assert.equal(L.overlays.chip("review"), null);
  assert.ok(!stage.labels.texts().includes("Pass intercepted · short middle"));
  const reduced = await actionStage({ reduced: true });
  const Lr = reduced.layers();
  Lr.player.review(item(87));
  assert.ok(reduced.stage.labels.texts().includes("FG 41 yds · good"), "reduced motion: at once");
});

test("overlays remember the painted situation; the setGameFrame clear empties every layer", async () => {
  const { stage, layers } = await actionStage();
  const L = layers();
  L.overlays.situation(D25);
  assert.equal(L.overlays.current(), D25);
  run(stage, L, 3);
  L.player.verdict({ seq: 3, key: "miss" });
  for (const layer of Object.values(L)) layer.clear();
  assert.equal(L.overlays.current(), null);
  assert.equal(stage.labels.live.length, 0);
  for (const layer of Object.values(L)) layer.dispose();
  assert.equal(stage.roots.residue.children.length, 0);
});

test("a retag while a play is reviewed relabels it; a job disposed early lets the ball go", async () => {
  const { stage, layers, tick } = await actionStage({ reduced: true });
  const L = layers();
  L.player.review(item(3));
  assert.ok(stage.labels.texts().includes("Short pass middle · +8"));
  const retag = { ...row(3), pred: { ...row(3).pred, family: "pa", leaf: "pa_short", leaf_rank: 1 } };
  L.residue.relabel([retag]);
  assert.ok(stage.labels.texts().includes("Play-action short pass middle · +8"));
  assert.equal(L.overlays.chip("review").key, "top1");
  L.residue.relabel([row(2)]);
  L.player.review(null);
  const drawing = buildDrawing(row(5));
  const job = L.player.start(drawing, planFor(stage, drawing), row(5));
  job.dispose();
  assert.equal(job.ball(), null);
  assert.equal(job.update(10), false, "a disposed job no longer draws");
  tick(50);
});

test("a malformed row in a relabel is a warning, never a fault (the WebGL field stays up)", async () => {
  const { stage, layers, st } = await actionStage({ reduced: true });
  const L = layers();
  run(stage, L, 3);
  const badRow = (seq) => Object.defineProperty({ ...row(seq) }, "result", { get() { throw new Error("bad row"); } });
  assert.doesNotThrow(() => L.player.relabel([badRow(3)]));
  assert.ok(st.warnings.some(([e]) => e === "warning"));
  assert.deepEqual(stage.labels.texts(), ["Short pass middle · +8"], "the words stay as they were");
  L.player.review(item(5));
  assert.doesNotThrow(() => L.residue.relabel([badRow(5)]));
});

test("a new game frame during a review (an epoch change) leaves the field live again, ball and all", async () => {
  const { stage, layers } = await actionStage();
  const L = layers();
  stage.lines.set(D25, { instant: true });
  L.player.review(item(104));
  assert.equal(L.player.isLive(), false);
  for (const layer of Object.values(L)) layer.clear();          // scene.js setGameFrame: every layer cleared
  assert.equal(L.player.isLive(), true, "live again");
  stage.lines.set(D25, { instant: true });
  assert.equal(stage.lines.state().ball.visible, true, "the resting ball is back");
  run(stage, L, 3);
  assert.equal(artsUnder(stage.roots.plays).filter((a) => a.visible).length, 1, "the next play draws in view");
  assert.equal(stage.labels.live.find((h) => h.text() === "Short pass middle · +8").object.visible, true);
});

test("canvas labels (sprite) dim by their own opacity; no labels at all (renderer none) draws plays without words", async () => {
  const sprite = await actionStage({ labels: "sprite" });
  const Ls = sprite.layers();
  run(sprite.stage, Ls, 3);
  Ls.player.dimLast();
  sprite.tick(400);
  assert.equal(sprite.stage.labels.live[0].object.material.opacity, sprite.stage.look.lastPlay.dimOpacity);
  const none = await actionStage({ labels: "none" });
  const Ln = none.layers();
  run(none.stage, Ln, 3);
  Ln.player.verdict({ seq: 3, key: "top1" });
  Ln.player.dimLast();
  assert.equal(none.stage.labels.live.length, 0);
  assert.equal(artsUnder(none.stage.roots.plays).length, 1);
});
