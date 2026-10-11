// The Model Report's SHADOW v LEAGUE board (static/js/report/model/vm-league.js): every scorecard metric (the app's own
// scorecardVm, always at full size), under a plate that names the play-caller it belongs to.
import assert from "node:assert/strict";
import test from "node:test";
import { leagueVm } from "../../../static/js/report/model/vm-league.js";
import { isDeepFrozen, makePv, state } from "../model-fixtures.mjs";

test("every pair and every group, at full size, under his name", () => {
  const vm = leagueVm(makePv({ presented: state.final() }));
  assert.equal(vm.plate, "Schottenheimer's scorecard");
  assert.equal(vm.expanded, true);
  assert.deepEqual(vm.pairs.map((p) => [p.id, p.shadow.text, p.league.text, p.leader]), [
    ["called_right", "85%", "81%", "shadow"], ["top3", "47", "48", "league"],
    ["passrun_logloss", "0.421", "0.424", "shadow"], ["family_logloss", "0.72", "0.69", "league"],
    ["leaf_logloss", "1.62", "1.62", "even"]]);
  assert.deepEqual(vm.groups.map((g) => g.id), ["leaf", "family", "passrun"]);
  assert.equal(vm.note, "Lower log loss is better. One game is a pipeline test, not proof.");
  assert.ok(isDeepFrozen(vm));
});

test("no caller on record: the plain plate; no snaps yet: the scorecard's own empty line", () => {
  const vm = leagueVm(makePv());
  assert.deepEqual([vm.plate, vm.empty, vm.emptyText], ["Tonight's scorecard", true,
    "Scores appear after the first logged snap."]);
});
