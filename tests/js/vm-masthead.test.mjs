import test from "node:test";
import assert from "node:assert/strict";
import { lastNameOf, mastheadVm } from "../../static/js/model/vm-masthead.js";
import { viewKeysVm } from "../../static/js/model/vm-view-keys.js";
import { isDeepFrozen, makePv, state, timeline, tlOf } from "./model-fixtures.mjs";

const pv = (over = {}) => makePv({ presented: state.final(), tl: tlOf(timeline.final()), ...over });

test("the plate: the title and who it shadows (restructure-v2.md 2: \"Shadowing Schottenheimer · DAL\")", () => {
  const vm = mastheadVm(pv());
  assert.equal(vm.title, "Shadow Play-Caller");
  assert.equal(vm.whoLabel, "Shadowing Schottenheimer · DAL");
  assert.equal(vm.plateTitle, "Modelling Brian Schottenheimer (DAL offense)");
});

test("the current game, where phase 2's game picker goes: away at home, and ESPN's status once it says", () => {
  assert.equal(mastheadVm(pv()).gameLabel, "TB at DAL");
  assert.equal(mastheadVm(pv()).gameTitle, "Buccaneers at Cowboys, Thursday Night Football, Oct 8");
  const final = mastheadVm(pv({ version: { watch: { state: "done", game: { status: "post", detail: "Final" } } } }));
  assert.equal(final.gameLabel, "TB at DAL · Final");
  const noTeams = mastheadVm(makePv({ presented: state.final() }));
  assert.equal(noTeams.gameLabel, "TB at DAL", "from the game when the timeline has no teams yet");
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

test("before the first state the labels are empty", () => {
  const vm = mastheadVm(makePv());
  assert.deepEqual([vm.title, vm.gameLabel, vm.whoLabel, vm.plateTitle, vm.gameTitle],
    ["Shadow Play-Caller", "", "", "", ""]);
  assert.ok(isDeepFrozen(vm));
});

test("view keys: the camera's label comes from the engine's modes, else from its id; the settings menu's state", () => {
  const modes = [{ id: "wide", label: "Wide" }, { id: "blimp", label: "Blimp" }];
  const named = viewKeysVm(makePv({ view: { camera: "blimp", settingsOpen: true }, cameraModes: modes }));
  assert.deepEqual([named.cameraMode, named.cameraLabel, named.settingsOpen], ["blimp", "Blimp", true]);
  const bare = viewKeysVm(makePv({ view: { camera: "wide" } }));
  assert.deepEqual([bare.cameraMode, bare.cameraLabel, bare.settingsOpen], ["wide", "Wide", false]);
  const none = viewKeysVm(makePv());
  assert.deepEqual([none.cameraMode, none.cameraLabel], ["", ""]);
  assert.ok(isDeepFrozen(named));
});
