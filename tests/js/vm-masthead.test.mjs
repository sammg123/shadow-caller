import test from "node:test";
import assert from "node:assert/strict";
import { mastheadVm } from "../../static/js/model/vm-masthead.js";
import { makePv, state, isDeepFrozen } from "./model-fixtures.mjs";

test("title, game label and who label (#1)", () => {
  const vm = mastheadVm(makePv({ presented: state.final() }));
  assert.equal(vm.title, "Shadow Play-Caller");
  assert.equal(vm.gameLabel, "Buccaneers at Cowboys, Thursday Night Football, Oct 8");
  assert.equal(vm.whoLabel, "Modelling Brian Schottenheimer (DAL offense)");
  assert.deepEqual([vm.boothOpen, vm.scorecardOpen], [false, false]);
});

test("camera label comes from the engine's modes, else from the id", () => {
  const modes = [{ id: "sideline", label: "Sideline" }, { id: "endzone", label: "End zone" }];
  const named = mastheadVm(makePv({ presented: state.final(), view: { camera: "endzone" }, cameraModes: modes }));
  assert.deepEqual([named.cameraMode, named.cameraLabel], ["endzone", "End zone"]);
  const bare = mastheadVm(makePv({ presented: state.final(), view: { camera: "overhead" } }));
  assert.deepEqual([bare.cameraMode, bare.cameraLabel], ["overhead", "Overhead"]);
  const none = mastheadVm(makePv({ presented: state.final() }));
  assert.deepEqual([none.cameraMode, none.cameraLabel], ["", ""]);
});

test("booth and scorecard toggles follow the view", () => {
  const vm = mastheadVm(makePv({ presented: state.final(), view: { booth: { open: true, auto: false }, scorecardOpen: true } }));
  assert.deepEqual([vm.boothOpen, vm.scorecardOpen], [true, true]);
});

test("before the first state the labels are empty", () => {
  const vm = mastheadVm(makePv());
  assert.deepEqual([vm.title, vm.gameLabel, vm.whoLabel], ["Shadow Play-Caller", "", ""]);
  assert.ok(isDeepFrozen(vm));
});
