import test from "node:test";
import assert from "node:assert/strict";
import { lastNameOf, mastheadVm } from "../../static/js/model/vm-masthead.js";
import { makePv, state, isDeepFrozen } from "./model-fixtures.mjs";

test("title, game label and who label (#1)", () => {
  const vm = mastheadVm(makePv({ presented: state.final() }));
  assert.equal(vm.title, "Shadow Play-Caller");
  assert.equal(vm.gameLabel, "Buccaneers at Cowboys, Thursday Night Football, Oct 8");
  assert.equal(vm.whoLabel, "Shadowing Schottenheimer · DAL");
  assert.deepEqual([vm.boothOpen, vm.scorecardOpen], [false, false]);
});

// v1.5 (G4-2): the plate names the caller it shadows in a line that fits; the full words are its tooltip
test("the plate's tooltip carries the whole game and who is modelled (G4-2)", () => {
  const vm = mastheadVm(makePv({ presented: state.final() }));
  assert.equal(vm.plateTitle,
    "Buccaneers at Cowboys, Thursday Night Football, Oct 8 · Modelling Brian Schottenheimer (DAL offense)");
  const noGame = mastheadVm(makePv({ presented: { ...state.final(), game: { ...state.final().game, label: "" } } }));
  assert.equal(noGame.plateTitle, "Modelling Brian Schottenheimer (DAL offense)");
});

test("the caller's last name comes from the profile, for any caller (G4-2)", () => {
  assert.equal(lastNameOf("Brian Schottenheimer"), "Schottenheimer");
  assert.equal(lastNameOf("  Kliff   Kingsbury "), "Kingsbury");
  assert.equal(lastNameOf("Frank Smith Jr."), "Smith");
  assert.equal(lastNameOf("Joe Brady III"), "Brady");
  assert.equal(lastNameOf("Madonna"), "Madonna");
  assert.deepEqual([lastNameOf(""), lastNameOf(null), lastNameOf(42)], ["", "", ""]);
  const kc = { ...state.final(), profile: { ...state.final().profile, caller: "Matt Nagy", team: "KC" } };
  assert.equal(mastheadVm(makePv({ presented: kc })).whoLabel, "Shadowing Nagy · KC");
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
  assert.deepEqual([vm.title, vm.gameLabel, vm.whoLabel, vm.plateTitle], ["Shadow Play-Caller", "", "", ""]);
  assert.ok(isDeepFrozen(vm));
});
