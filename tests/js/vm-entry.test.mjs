import test from "node:test";
import assert from "node:assert/strict";
import { makePv, state, isDeepFrozen } from "./model-fixtures.mjs";

const load = async () => (await import("../../static/js/model/vm-entry.js")).entryVm;
const keysOn = (vm) => Object.entries(vm.keysOn).filter(([, on]) => on).map(([k]) => k);
const outOn = (vm) => Object.entries(vm.outOn).filter(([, on]) => on).map(([k]) => k);

test("manual entry off the field: dimmed, nothing picked, Log play disabled (#5)", async () => {
  const entryVm = await load();
  const { chosenText } = await import("../../static/js/core/selection.js");
  const presented = state.final();
  const vm = entryVm(makePv({ presented }));
  assert.deepEqual([vm.mode, vm.manualHidden, vm.dim, vm.logDisabled], ["manual", false, true, true]);
  assert.deepEqual(vm.chosen, chosenText({ k: null, i: 0, out: null }, presented.keys, presented.family_names));
  assert.deepEqual([keysOn(vm), outOn(vm)], [[], []]);
  assert.equal(vm.hint,
    "Press the play key (tap again to cycle), type yards, Enter. I incomplete, X flag, Esc clears, U undoes. Down, distance and field position advance on their own.");
});

test("during a drive a pick lights its key and enables Log play (#39, #59)", async () => {
  const entryVm = await load();
  const vm = entryVm(makePv({ presented: state.tilt(), view: { pick: { k: "K", i: 0, out: null } } }));
  assert.deepEqual([vm.dim, vm.logDisabled, keysOn(vm)], [false, false, ["K"]]);
  const sack = entryVm(makePv({ presented: state.tilt(), view: { pick: { k: "P", i: 1, out: "sack" } } }));
  assert.deepEqual([keysOn(sack), outOn(sack)], [["P"], ["sack"]]);
});

test("feed on hides the pad, undims and switches the hint (#93)", async () => {
  const entryVm = await load();
  const vm = entryVm(makePv({ presented: state.feedOn() }));
  assert.deepEqual([vm.mode, vm.manualHidden, vm.dim], ["feed", true, false]);
  assert.equal(vm.hint,
    "ESPN logs each play, down, distance, spot, clock and score. It can't see play-action, screens or RPOs: press A, N or O to fix the last play. P undoes that, J/K/L change the run gap, U undoes.");
});

test("a watch hides the pad too and says how to drive the playback", async () => {
  const entryVm = await load();
  const vm = entryVm(makePv({ presented: state.final(), version: { watch: { state: "playing" } } }));
  assert.deepEqual([vm.mode, vm.manualHidden, vm.dim], ["watch", true, false]);
  assert.equal(vm.hint,
    "Plays log themselves as the game plays back. A, N or O fix the last play (the playback pauses first). Space pauses or resumes, Left and Right step, 1 to 4 set the speed.");
  assert.ok(isDeepFrozen(vm));
});

test("before the first state: a dimmed manual pad; R lights K", async () => {
  const entryVm = await load();
  const empty = entryVm(makePv());
  assert.deepEqual([empty.mode, empty.dim, empty.logDisabled, empty.chosen.placeholder], ["manual", true, true, true]);
  const r = entryVm(makePv({ presented: state.tilt(), view: { pick: { k: "R", i: 0, out: null } } }));
  assert.deepEqual(keysOn(r), ["K"]);
});
