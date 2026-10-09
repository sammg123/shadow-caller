import test from "node:test";
import assert from "node:assert/strict";
import { boxVm } from "../../static/js/model/vm-box.js";
import { makePv, state, timeline, tlOf, patch, isDeepFrozen } from "./model-fixtures.mjs";

test("team stats from the rows equal ESPN's final box score (DC C4)", () => {
  const vm = boxVm(makePv({ presented: state.final(), tl: tlOf(timeline.final()) }));
  assert.equal(vm.available, true);
  assert.equal(vm.heading, "Team stats");
  assert.deepEqual([...vm.teams], ["TB", "DAL"]);
  assert.deepEqual(vm.rows.map((r) => [r.label, ...r.values]), [
    ["First downs", "24", "20"],
    ["Passing first downs", "10", "12"],
    ["Rushing first downs", "10", "5"],
    ["First downs by penalty", "4", "3"],
    ["3rd down", "7-13", "4-10"],
    ["4th down", "0-1", "0-1"],
    ["Total plays", "65", "55"],
    ["Total yards", "419", "366"],
    ["Passing yards", "178", "316"],
    ["Comp-Att", "19-25", "24-42"],
    ["Sacks-Yards lost", "1-11", "0-0"],
    ["Interceptions thrown", "0", "2"],
    ["Rushing yards", "241", "50"],
    ["Rushing attempts", "39", "13"],
    ["Penalties", "14-92", "7-57"],
    ["Turnovers", "0", "3"],
    ["Fumbles lost", "0", "1"],
    ["Possession", "39:21", "20:39"],
  ]);
});

test("mid-game the box only counts applied plays (DC G22)", () => {
  const vm = boxVm(makePv({ tl: tlOf(timeline.at104()) }));
  const yards = vm.rows.find((r) => r.label === "Total yards");
  assert.deepEqual([...yards.values], ["241", "187"]);
});

test("a hand-entered game has the caller's column only, without possession time", () => {
  const body = timeline.final();
  const dal = { ...body.box.DAL, top_s: null, top: null };
  const vm = boxVm(makePv({ tl: tlOf(patch(body, { box: { DAL: dal } })) }));
  assert.deepEqual([...vm.teams], ["DAL"]);
  assert.deepEqual([...vm.rows.find((r) => r.label === "Possession").values], ["—"]);
});

test("no timeline means no box score", () => {
  const vm = boxVm(makePv());
  assert.deepEqual([vm.available, vm.teams.length, vm.rows.length], [false, 0, 0]);
  assert.ok(isDeepFrozen(boxVm(makePv({ tl: tlOf(timeline.final()) }))));
});
