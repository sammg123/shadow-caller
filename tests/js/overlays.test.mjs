// field/overlays.js (A5 part 2; ui-architecture 14.4 `overlays`, 2.5 markVerdict): the verdict chip under the play's
// words, its words (G2-7: what was graded), its slots (live and review), relabels after a retag, and the situation.
import assert from "node:assert/strict";
import test from "node:test";
import { actionStage, row } from "./action-stage.mjs";

const { createOverlays } = await import("../../static/js/field/overlays.js");
const { buildDrawing } = await import("../../static/js/field/paths.js");

const LABEL = buildDrawing(row(159)).label;           // "Deep pass left · TD", the Dallas touchdown
const chipTexts = (stage) => stage.labels.byClass("sc-verdict-chip").map((h) => h.text());

async function overlaysOn(labels = "css2d") {
  const { stage, st } = await actionStage({ labels });
  return { stage, st, overlays: createOverlays(stage) };
}

test("a verdict chip carries the words it is given, and its key's plain words without them (G2-7)", async () => {
  const { stage, overlays } = await overlaysOn();
  overlays.verdict({ seq: 159, key: "top3", label: LABEL, text: "In his top 3 · #2 Intermediate · 39%" });
  assert.deepEqual(chipTexts(stage), ["In his top 3 · #2 Intermediate · 39%"]);
  assert.deepEqual(overlays.chip("live"), { seq: 159, key: "top3", text: "In his top 3 · #2 Intermediate · 39%",
    label: LABEL });
  overlays.verdict({ seq: 159, key: "top3", label: LABEL });
  assert.deepEqual(chipTexts(stage), ["In his top 3"], "one chip per slot");
  const [handle] = stage.labels.byClass("sc-verdict-chip");
  assert.ok(handle.element.classList.contains("is-top3"));
});

test("retext rewords the chip of that play only, keeping whether it shows (G2-7)", async () => {
  const { stage, overlays } = await overlaysOn();
  overlays.verdict({ seq: 159, key: "top3", label: LABEL }, { slot: "live", visible: false });
  overlays.retext("live", 158, "Miss · #13 Deep shot · 1%");
  assert.deepEqual(chipTexts(stage), ["In his top 3"], "another play's words never land on this chip");
  overlays.retext("live", 159, "In his top 3 · #2 Intermediate · 39%");
  assert.deepEqual(chipTexts(stage), ["In his top 3 · #2 Intermediate · 39%"]);
  assert.equal(stage.labels.byClass("sc-verdict-chip")[0].object.visible, false, "hidden while a review holds the field");
  overlays.retext("review", 159, "x");
  assert.equal(overlays.chip("review"), null, "no review chip, nothing to reword");
});

test("a retag regrades the chip from the row's new pred, words included (DC B7, G2-7)", async () => {
  const { stage, overlays } = await overlaysOn();
  overlays.verdict({ seq: 159, key: "top3", label: LABEL, text: "In his top 3 · #2 Intermediate · 39%" });
  const retagged = { ...row(159), pred: { ...row(159).pred, leaf: "pa_mid", leaf_rank: 9, leaf_p: 0.021 } };
  overlays.relabel("live", { row: retagged, label: LABEL });
  assert.deepEqual(chipTexts(stage), ["Miss · #9 PA intermediate · 2%"]);
  assert.equal(overlays.chip("live").key, "miss");
  overlays.verdict({ seq: 159, key: "top3", label: LABEL });
  overlays.relabel("live", { row: retagged, label: LABEL });
  assert.deepEqual(chipTexts(stage), ["Miss"], "plain words stay plain");
});

test("the review slot keeps its own chip; clearing one leaves the other (14.4)", async () => {
  const { stage, overlays } = await overlaysOn();
  overlays.verdict({ seq: 159, key: "top3", label: LABEL, text: "In his top 3 · #2 Intermediate · 39%" });
  overlays.verdict({ seq: 7, key: "miss", label: buildDrawing(row(7)).label }, { slot: "review" });
  assert.deepEqual(chipTexts(stage).sort(), ["In his top 3 · #2 Intermediate · 39%", "Miss"]);
  overlays.clearVerdict("review");
  assert.deepEqual(chipTexts(stage), ["In his top 3 · #2 Intermediate · 39%"]);
  overlays.clear();
  assert.deepEqual(chipTexts(stage), []);
});

test("no chip for no verdict, an unknown key or a play with no words", async () => {
  const { stage, overlays } = await overlaysOn();
  overlays.verdict({ seq: 2, key: "none", label: LABEL, text: "x" });
  overlays.verdict({ seq: 2, key: "great", label: LABEL });
  overlays.verdict({ seq: 2, key: "top1", label: null, text: "Top pick · 40%" });
  assert.deepEqual(chipTexts(stage), []);
  assert.equal(overlays.chip("live"), null);
});

test("canvas label renderers get the chip one line down the field; the situation is kept for the ghosts", async () => {
  const { stage, overlays } = await overlaysOn("sprite");
  overlays.verdict({ seq: 159, key: "top1", label: LABEL, text: "Top pick · 43%" });
  const [handle] = stage.labels.byClass("sc-verdict-chip");
  assert.notDeepEqual({ x: handle.pt.x, y: handle.pt.y }, { x: LABEL.at.x, y: LABEL.at.y });
  assert.equal(handle.text(), "Top pick · 43%");
  const sit = { ballX: 25, ltgX: 35, dir: 1, poss: "DAL" };
  overlays.situation(sit);
  assert.equal(overlays.current(), sit);
  overlays.situation("nope");
  assert.equal(overlays.current(), null);
});
