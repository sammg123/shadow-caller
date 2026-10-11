// ui/scorecard.js (ui-architecture 2.6, FI 3.7; owner A8): Tonight's scorecard: SHADOW v LEAGUE (only the pairs the
// model computes), then the FI groups, the note; empty before the first logged snap.
import assert from "node:assert/strict";
import test from "node:test";
import { scorecardVm } from "../../static/js/model/vm-scorecard.js";
import { mount } from "../../static/js/ui/scorecard.js";
import { all, fakeCtx, inDoc, makePv, one, patch, regionRoot, state, text } from "./game-surfaces-harness.mjs";

const vmOf = (presented = state.final(), view = {}) => scorecardVm(makePv({ presented, view }));
const group = (root, id) => one(root, `[data-group="${id}"]`);
const pair = (root, id) => one(root, `[data-pair="${id}"]`);
const kpiValues = (node) => all(node, ".sc-kpi-value").map(text);
const side = (node, which) => text(one(one(node, `[data-side="${which}"]`), ".sc-card-full"));

function setup(doc) {
  const root = regionRoot(doc, { tag: "div", id: "kpiArea" });
  const { ctx } = fakeCtx();
  return { root, card: mount(root, ctx) };
}

test("before the first logged snap it says so, and shows no pairs or groups (#6)", () => inDoc((doc) => {
  const { root, card } = setup(doc);
  card.update(vmOf(patch(state.final(), { metrics: { n: 0 } })));
  assert.equal(text(one(root, ".sc-panel-title")), "Tonight's scorecard");
  const empty = one(root, ".sc-card-empty");
  assert.deepEqual([empty.hidden, text(empty)], [false, "Scores appear after the first logged snap."]);
  assert.equal(one(root, ".sc-card-pairs").hidden, true);
  assert.equal(all(root, ".sc-card-group").length, 0);
  assert.equal(one(root, ".sc-card-note").hidden, true);
}));

test("the replayed game: three groups with their counts and every FI 3.7 value (#110)", () => inDoc((doc) => {
  const { root, card } = setup(doc);
  card.update(vmOf());
  assert.deepEqual(all(root, ".sc-card-group").map((g) => text(one(g, ".sc-card-sub"))),
    ["Specific play (59 snaps)", "Play type (59 snaps)", "Pass vs run (59 snaps)"]);
  assert.deepEqual(kpiValues(group(root, "leaf")), ["32 of 59", "47 of 59", "1.62", "1.62"]);
  assert.deepEqual(kpiValues(group(root, "passrun")), ["0.421", "85%", "1 of 2", "75%"]);
  assert.deepEqual(all(group(root, "family"), ".sc-kpi-label").map(text), ["Most likely type was right", "Log loss (league 0.69)"]);
  assert.equal(text(one(root, ".sc-card-note")), "Lower log loss is better. One game is a pipeline test, not proof.");
  assert.equal(one(root, ".sc-card-empty").hidden, true);
}));

test("log loss is styled better below the league and worse otherwise; a tie on screen is neither (#111, G4-3)",
  () => inDoc((doc) => {
    const { root, card } = setup(doc);
    card.update(vmOf());
    const toned = all(root, ".sc-kpi-value").filter((v) => v.hasAttribute("data-tone"));
    assert.deepEqual(toned.map((v) => [text(v), v.getAttribute("data-tone"),
      v.getAttribute("class").includes(v.getAttribute("data-tone"))]), [["0.72", "worse", true], ["0.421", "better", true]]);
    const leafLoss = all(group(root, "leaf"), ".sc-kpi-value")[2];
    assert.deepEqual([text(leafLoss), leafLoss.getAttribute("class").includes("worse")], ["1.62", false],
      "his 1.62 against the league's 1.62 is not red");
  }));

test("only the groups with snaps appear (#110)", () => inDoc((doc) => {
  const { root, card } = setup(doc);
  const m = state.final().metrics;
  card.update(vmOf(patch(state.final(), { metrics: { ...m, granular: { ...m.granular, leaf_n: 0, fam_n: 0 } } })));
  assert.deepEqual(all(root, ".sc-card-group").map((g) => g.getAttribute("data-group")), ["passrun"]);
  assert.deepEqual(all(root, ".sc-card-pair").map((p) => p.getAttribute("data-pair")), ["called_right", "passrun_logloss"]);
}));

test("SHADOW v LEAGUE: only computed pairs, each with both sides and a lamp on the leader", () => inDoc((doc) => {
  const { root, card } = setup(doc);
  card.update(vmOf());
  assert.equal(text(one(one(root, ".sc-card-pairs"), ".sc-card-sub")), "Shadow v League");
  assert.deepEqual(all(root, ".sc-card-pair").map((p) => [p.getAttribute("data-pair"), p.getAttribute("data-leader")]), [
    ["called_right", "shadow"], ["top3", "league"], ["passrun_logloss", "shadow"], ["family_logloss", "league"],
    ["leaf_logloss", "even"]]);
  assert.deepEqual(all(root, ".sc-card-plabel").slice(0, 2).map(text), ["Run/pass right", "Play in top 3"]);
  const calledRight = pair(root, "called_right");
  assert.deepEqual([side(calledRight, "shadow"), side(calledRight, "league")], ["85%", "81%"]);
  assert.equal(one(calledRight, '[data-side="shadow"]').getAttribute("data-lead"), "true");
  assert.equal(one(calledRight, '[data-side="league"]').getAttribute("data-lead"), "false");
  assert.equal(text(one(calledRight, ".sc-card-leadtext")), "Shadow leads");
  const passRun = pair(root, "passrun_logloss");
  assert.deepEqual([side(passRun, "shadow"), text(one(one(passRun, '[data-side="shadow"]'), ".sc-card-brief"))], ["0.421", ".421"]);
  assert.equal(one(one(passRun, '[data-side="league"]'), ".sc-card-full").getAttribute("data-ghost"), "8.888");
  assert.equal(text(one(calledRight, ".sc-card-basis")), "59 snaps");
}));

// v1.5 (G4-3): the snap count is said once, under SHADOW v LEAGUE, when every pair counts the same snaps
test("the basis line sits under the plate and the pairs say whether they share it (G4-3)", () => inDoc((doc) => {
  const { root, card } = setup(doc);
  card.update(vmOf());
  const pairs = one(root, ".sc-card-pairs");
  const line = one(pairs, ".sc-card-basisline");
  assert.equal(text(line), "his model v league baseline · 59 snaps");
  assert.equal(pairs.getAttribute("data-basis-shared"), "true");
  assert.equal(line.parentNode, one(pairs, ".sc-card-plate"), "the line sits on the plate, under its caption");
  assert.equal(text(one(one(pairs, ".sc-card-plate"), ".sc-card-sub")), "Shadow v League");
  const m = state.final().metrics;
  card.update(vmOf(patch(state.final(), { metrics: { ...m, granular: { ...m.granular, leaf_n: 58 } } })));
  assert.deepEqual([pairs.getAttribute("data-basis-shared"), text(line)], ["false", "his model v league baseline"]);
  assert.equal(text(one(pair(root, "top3"), ".sc-card-basis")), "58 snaps", "each pair keeps its own count");
}));

test("a tie lights no lamp; the Model Report's full size marks the scorecard expanded; destroy removes it",
  () => inDoc((doc) => {
  const { root, card } = setup(doc);
  const m = state.final().metrics;
  card.update({ ...vmOf(patch(state.final(), { metrics: { ...m, acc_league: m.acc_model } })), expanded: true });
  const even = pair(root, "called_right");
  assert.equal(even.getAttribute("data-leader"), "even");
  assert.deepEqual(all(even, ".sc-card-side").map((s) => s.getAttribute("data-lead")), ["false", "false"]);
  assert.equal(text(one(even, ".sc-card-leadtext")), "Even");
  assert.equal(one(root, ".sc-scorecard").getAttribute("data-expanded"), "true");
  card.destroy();
  assert.equal(root.childNodes.length, 0);
}));
