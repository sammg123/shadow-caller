import test from "node:test";
import assert from "node:assert/strict";
import { makePv, state, isDeepFrozen } from "./model-fixtures.mjs";

const load = async () => (await import("../../static/js/model/vm-flags.js")).flagsVm;
const open = { flag: { open: true, gen: 1 } };

test("two columns of coded fouls with their keys and summaries (#64)", async () => {
  const flagsVm = await load();
  const { penaltySummary } = await import("../../static/js/core/flags.js");
  const presented = state.tilt();
  const vm = flagsVm(makePv({ presented, view: open }));
  assert.deepEqual([vm.hidden, vm.buttonOn], [false, true]);
  assert.deepEqual({ ...vm.headings }, { def: "On TB (defense)", off: "On DAL (offense)" });
  assert.deepEqual(vm.def.map((f) => f.code), ["OFFSIDE", "DH", "IC", "DPI", "RTP", "URD", "FM", "12D"]);
  assert.deepEqual(vm.def.map((f) => f.key), ["O", "H", "C", "D", "R", "U", "M", "Z"]);
  assert.deepEqual(vm.off.map((f) => f.code), ["FS", "DOG", "ILF", "OH", "OPI", "IBB", "IG", "URO"]);
  assert.deepEqual(vm.off.map((f) => f.key), ["F", "G", "E", "L", "P", "B", "I", "N"]);
  assert.equal(vm.def.find((f) => f.code === "URD").label, "Unnecessary roughness");
  assert.equal(vm.off.find((f) => f.code === "URO").label, "Unnecessary roughness");
  assert.equal(vm.def[1].summary, penaltySummary(presented.penalties.DH));
  assert.deepEqual({ ...vm.offset }, { code: "OFFSET", key: "W", label: "Offsetting", summary: "replay the down" });
  assert.deepEqual([vm.otherD, vm.otherO, vm.otherSummary, vm.autoFirst],
    ["Other on TB", "Other on DAL", "yards from the Yards box", "automatic 1st down"]);
});

test("the note follows the current pick on every render (G25, #65)", async () => {
  const flagsVm = await load();
  const { flagNote } = await import("../../static/js/core/flags.js");
  const presented = state.tilt();
  const pick = { k: "A", i: 1, out: null };
  const vm = flagsVm(makePv({ presented, view: { ...open, pick } }));
  assert.equal(vm.note, flagNote(pick, presented.keys, presented.family_names));
  assert.equal(flagsVm(makePv({ presented, view: open })).note, "No play picked: the flag just moves the ball.");
});

test("hidden when closed, with the feed on, or during a watch (#93)", async () => {
  const flagsVm = await load();
  assert.equal(flagsVm(makePv({ presented: state.tilt() })).hidden, true);
  assert.equal(flagsVm(makePv({ presented: state.feedOn(), view: open })).hidden, true);
  const watching = flagsVm(makePv({ presented: state.tilt(), view: open, version: { watch: { state: "paused" } } }));
  assert.equal(watching.hidden, true);
  assert.ok(isDeepFrozen(watching));
  assert.equal(flagsVm(makePv()).hidden, true);
});

test("a state without penalties gives empty columns, not an error", async () => {
  const flagsVm = await load();
  const { patch } = await import("./model-fixtures.mjs");
  const vm = flagsVm(makePv({ presented: patch(state.tilt(), { penalties: undefined }), view: open }));
  assert.deepEqual([vm.def.length, vm.off.length, vm.hidden], [0, 0, false]);
});
