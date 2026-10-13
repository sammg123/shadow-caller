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

// ---------------------------------------------------------------- restructure-v2.md 11: the tracked play-callers
const ROBINSON = { team: "TB", caller: "Zac Robinson", slug: "zac-robinson" };
const SCHOTT = { team: "DAL", caller: "Brian Schottenheimer", slug: "brian-schottenheimer" };
const tracked = (list, extra = {}) => ({ ...state.final(), tracked: list, ...extra });

test("one tracked caller: the plate names him from /api/state's tracked list", () => {
  const vm = mastheadVm(pv({ presented: tracked([SCHOTT]) }));
  assert.equal(vm.whoLabel, "Shadowing Schottenheimer · DAL");
  assert.equal(vm.plateTitle, "Modelling Brian Schottenheimer (DAL offense)");
  assert.equal(vm.sides, 1);
  const other = mastheadVm(pv({ presented: tracked([{ team: "KC", caller: "Matt Nagy Jr.", slug: "matt-nagy" }]) }));
  assert.equal(other.whoLabel, "Shadowing Nagy · KC", "whoever the track names, not the profile");
});

test("both sides tracked: the plate names both callers, away first (restructure-v2.md 11 decision 4)", () => {
  const vm = mastheadVm(pv({ presented: tracked([ROBINSON, SCHOTT]) }));
  assert.equal(vm.whoLabel, "Shadowing Robinson · TB and Schottenheimer · DAL");
  assert.equal(vm.plateTitle, "Modelling Zac Robinson (TB offense) and Brian Schottenheimer (DAL offense)");
  assert.equal(vm.sides, 2);
  assert.ok(isDeepFrozen(vm));
});

test("a tracked list that says nothing usable falls back to the profile; a repeated team counts once", () => {
  for (const list of [[], [null, { team: 7 }, { caller: "No Team" }], "DAL"]) {
    const vm = mastheadVm(pv({ presented: tracked(list) }));
    assert.equal(vm.whoLabel, "Shadowing Schottenheimer · DAL", JSON.stringify(list));
    assert.equal(vm.sides, 1);
  }
  const twice = mastheadVm(pv({ presented: tracked([SCHOTT, { ...SCHOTT, caller: "Someone Else" }]) }));
  assert.equal(twice.whoLabel, "Shadowing Schottenheimer · DAL");
  const nameless = mastheadVm(pv({ presented: tracked([{ team: "TB", caller: "", slug: null }, SCHOTT]) }));
  assert.equal(nameless.whoLabel, "Shadowing TB and Schottenheimer · DAL", "a side with no name still shows");
});

test("the game's words come from the track when neither the timeline nor the game has the teams", () => {
  const game = { ...state.final().game, offense: undefined, opponent: undefined };
  const presented = { ...state.final(), game, track: { event_id: "401872980", sides: ["TB", "DAL"], label: "TB at DAL" } };
  assert.equal(mastheadVm(makePv({ presented })).gameLabel, "TB at DAL");
  const bad = { ...presented, track: { label: 42 } };
  assert.equal(mastheadVm(makePv({ presented: bad })).gameLabel, "");
});

test("a neutral-site game reads vs on the top bar, as in the picker and the tooltip; any other game reads at", () => {
  const neutral = { ...state.final(), game: { ...state.final().game, neutral: true } };
  assert.equal(mastheadVm(pv({ presented: neutral })).gameLabel, "TB vs DAL", "the timeline's teams");
  assert.equal(mastheadVm(makePv({ presented: neutral })).gameLabel, "TB vs DAL", "the game's own teams");
  const final = mastheadVm(pv({ presented: neutral, version: { watch: { state: "done", game: { status: "post",
    detail: "Final" } } } }));
  assert.equal(final.gameLabel, "TB vs DAL · Final");
  for (const flag of [false, "true", 1, null]) {
    const game = { ...state.final().game, neutral: flag };
    assert.equal(mastheadVm(pv({ presented: { ...state.final(), game } })).gameLabel, "TB at DAL", String(flag));
  }
});
