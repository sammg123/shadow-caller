import test from "node:test";
import assert from "node:assert/strict";
import { transportVm, watchOf, isWatchSession } from "../../static/js/model/vm-transport.js";
import { makePv, state, isDeepFrozen } from "./model-fixtures.mjs";

const watch = (over) => ({ state: "playing", event_id: "401872980", speed: 4, idx: 104, total: 183,
  next_at: 1791504012345, error: null, ...over });
const can = (vm) => [vm.canStart, vm.canPlay, vm.canPause, vm.canStep, vm.canStop, vm.canBack, vm.canAgain];
const pressed = (vm) => vm.speeds.filter((s) => s.pressed).map((s) => s.value);

test("an old server without watch: controls unavailable", () => {
  const vm = transportVm(makePv({ presented: state.final() }));
  assert.deepEqual([vm.available, vm.active, vm.state], [false, false, "idle"]);
  assert.deepEqual(can(vm), [false, false, false, false, false, false, false]);
});

test("playing at 4x, row 104 of 183 (DC E1)", () => {
  const vm = transportVm(makePv({ version: { watch: watch() } }));
  assert.deepEqual([vm.available, vm.active, vm.state, vm.progress], [true, true, "playing", "104 / 183"]);
  assert.deepEqual(can(vm), [false, false, true, false, true, false, false]);
  assert.deepEqual(vm.speeds.map((s) => [s.value, s.label]), [[1, "1x"], [2, "2x"], [4, "4x"], [10, "10x"]]);
  assert.deepEqual(pressed(vm), [4]);
});

test("paused: play, step and stop", () => {
  const vm = transportVm(makePv({ version: { watch: watch({ state: "paused", speed: 10 }) } }));
  assert.deepEqual(can(vm), [false, true, false, true, true, false, false]);
  assert.deepEqual(pressed(vm), [10]);
});

test("done: back to my game or watch again", () => {
  const vm = transportVm(makePv({ version: { watch: watch({ state: "done", idx: 183 }) } }));
  assert.deepEqual(can(vm), [true, false, false, false, true, true, true]);
  assert.equal(vm.progress, "183 / 183");
});

test("idle: start at the speed chosen beforehand", () => {
  const vm = transportVm(makePv({ version: { watch: { state: "idle", speed: null, idx: 0, total: 0 } }, prefs: { watchSpeed: 2 } }));
  assert.deepEqual([vm.active, vm.canStart, vm.progress], [false, true, ""]);
  assert.deepEqual(pressed(vm), [2]);
});

test("errors show the server's text; odd speeds press nothing", () => {
  const vm = transportVm(makePv({ version: { watch: watch({ state: "error", error: "no saved game", speed: 2.5 }) } }));
  assert.equal(vm.error, "no saved game");
  assert.deepEqual(pressed(vm), []);
  assert.equal(vm.canStop, true);
});

test("the state body's watch is used when the version has none", () => {
  const presented = { ...state.final(), watch: watch({ state: "paused" }) };
  assert.equal(watchOf(makePv({ presented })).state, "paused");
  assert.equal(transportVm(makePv({ presented })).state, "paused");
  assert.equal(watchOf(makePv()), null);
});

test("isWatchSession covers playing, paused, done and error", () => {
  assert.deepEqual(["idle", "playing", "paused", "done", "stopped", "error", undefined].map(isWatchSession),
    [false, true, true, true, false, true, false]);
  assert.ok(isDeepFrozen(transportVm(makePv({ version: { watch: watch() } }))));
});
