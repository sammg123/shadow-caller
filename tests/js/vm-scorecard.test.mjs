import test from "node:test";
import assert from "node:assert/strict";
import { scorecardVm, comparisonPairs } from "../../static/js/model/vm-scorecard.js";
import { makePv, state, patch, isDeepFrozen } from "./model-fixtures.mjs";

const kpis = (vm, id) => vm.groups.find((g) => g.id === id).kpis.map((k) => [k.value, k.label, k.tone]);
const withMetrics = (metrics) => patch(state.final(), { metrics });

test("before the first snap the scorecard says so (#6)", () => {
  const vm = scorecardVm(makePv({ presented: withMetrics({ n: 0 }) }));
  assert.equal(vm.empty, true);
  assert.equal(vm.emptyText, "Scores appear after the first logged snap.");
  assert.deepEqual([...vm.groups], []);
  assert.deepEqual([...vm.pairs], []);
});

test("nothing presented yet is an empty scorecard", () => {
  assert.equal(scorecardVm(makePv()).empty, true);
});

test("the replayed game reproduces every FI 3.7 value", () => {
  const vm = scorecardVm(makePv({ presented: state.final() }));
  assert.equal(vm.heading, "Tonight's scorecard");
  assert.deepEqual(vm.groups.map((g) => [g.id, g.title]), [
    ["leaf", "Specific play (59 snaps)"],
    ["family", "Play type (59 snaps)"],
    ["passrun", "Pass vs run (59 snaps)"],
  ]);
  assert.deepEqual(kpis(vm, "leaf"), [
    ["32 of 59", "Top pick was right", ""],
    ["47 of 59", "Actual play in his top 3 (league 48)", ""],
    ["1.62", "His model, log loss", "worse"],
    ["1.62", "League, log loss", ""],
  ]);
  assert.deepEqual(kpis(vm, "family"), [
    ["45 of 59", "Most likely type was right", ""],
    ["0.72", "Log loss (league 0.69)", "worse"],
  ]);
  assert.deepEqual(kpis(vm, "passrun"), [
    ["0.421", "His model, log loss (league 0.424)", "better"],
    ["85%", "Called right (league 81%)", ""],
    ["1 of 2", "Tilts that came true", ""],
    ["75%", "Pass rate tonight", ""],
  ]);
  assert.equal(vm.note, "Lower log loss is better. One game is a pipeline test, not proof.");
});

test("one snap and no tilts yet (FI #30 state)", () => {
  const vm = scorecardVm(makePv({ presented: state.tilt() }));
  assert.deepEqual(kpis(vm, "leaf")[0], ["1 of 1", "Top pick was right", ""]);
  assert.deepEqual(kpis(vm, "leaf")[2], ["1.21", "His model, log loss", "better"]);
  assert.deepEqual(kpis(vm, "passrun")[2], ["0", "Tilts that came true", ""]);
  assert.deepEqual(kpis(vm, "passrun")[3], ["0%", "Pass rate tonight", ""]);
});

test("specific-play and play-type groups appear only when they have snaps (#110)", () => {
  const m = state.final().metrics;
  const vm = scorecardVm(makePv({ presented: withMetrics({ ...m, granular: { ...m.granular, leaf_n: 0, fam_n: 0 } }) }));
  assert.deepEqual(vm.groups.map((g) => g.id), ["passrun"]);
  const noGranular = scorecardVm(makePv({ presented: withMetrics({ ...m, granular: undefined }) }));
  assert.deepEqual(noGranular.groups.map((g) => g.id), ["passrun"]);
});

test("expanded follows the G toggle", () => {
  assert.equal(scorecardVm(makePv({ presented: state.final(), view: { scorecardOpen: true } })).expanded, true);
  assert.equal(scorecardVm(makePv({ presented: state.final() })).expanded, false);
});

test("SHADOW vs LEAGUE pairs: only what the scorecard computes, in the directions' order", () => {
  const pairs = comparisonPairs(state.final().metrics);
  assert.deepEqual(pairs.map((p) => [p.id, p.label, p.shadow.text, p.league.text, p.better, p.leader]), [
    ["called_right", "Called right", "85%", "81%", "higher", "shadow"],
    ["top3", "Actual play in his top 3", "47", "48", "higher", "league"],
    ["passrun_logloss", "Pass vs run log loss", "0.421", "0.424", "lower", "shadow"],
    ["family_logloss", "Play type log loss", "0.72", "0.69", "lower", "league"],
    ["leaf_logloss", "Specific play log loss", "1.62", "1.62", "lower", "league"],
  ]);
  assert.deepEqual(pairs.map((p) => p.basis), ["59 snaps", "59 snaps", "59 snaps", "59 snaps", "59 snaps"]);
  assert.deepEqual([pairs[2].shadow.brief, pairs[2].league.brief], [".421", ".424"]);
  assert.equal(pairs[0].shadow.value, state.final().metrics.acc_model);
});

test("no pair is ever invented: there is no league top-pick count", () => {
  const ids = comparisonPairs(state.final().metrics).map((p) => p.id);
  assert.equal(ids.includes("top1"), false);
  assert.equal(ids.includes("tilts"), false);
  const m = state.final().metrics;
  const thin = comparisonPairs({ ...m, granular: { ...m.granular, leaf_n: 0, fam_n: 0 } });
  assert.deepEqual(thin.map((p) => p.id), ["called_right", "passrun_logloss"]);
  assert.deepEqual([...comparisonPairs({ n: 0 })], []);
  assert.deepEqual([...comparisonPairs(null)], []);
});

test("a tie is even, not a win", () => {
  const m = state.final().metrics;
  const [calledRight] = comparisonPairs({ ...m, acc_league: m.acc_model });
  assert.equal(calledRight.leader, "even");
});

test("the scorecard carries the same pairs and is deep-frozen", () => {
  const vm = scorecardVm(makePv({ presented: state.final() }));
  assert.deepEqual(vm.pairs.map((p) => p.id), comparisonPairs(state.final().metrics).map((p) => p.id));
  assert.ok(isDeepFrozen(vm));
});
