// The Model Report's ribbon (static/js/report/model/vm-head.js): who the page shadows, the game, the score with the
// teams' LED logos, and a status lamp that says whether the game is final, playing back or live.
import assert from "node:assert/strict";
import test from "node:test";
import { headVm } from "../../../static/js/report/model/vm-head.js";
import { isDeepFrozen, makePv, readFixture, state, timeline, tlOf } from "../model-fixtures.mjs";

const playing = () => readFixture("version_watch_playing.json");

test("a finished game: who, the game, the final score away first, and the Final lamp", () => {
  const vm = headVm(makePv({ presented: state.final(), tl: tlOf(timeline.final()) }));
  assert.equal(vm.who, "Shadowing Schottenheimer · DAL");
  assert.equal(vm.game, "Buccaneers at Cowboys, Thursday Night Football, Oct 8");
  assert.deepEqual(vm.teams, [
    { abbr: "TB", score: "24", logo: "/api/logo/TB", logoDark: "/api/logo/TB?v=dark", caller: false },
    { abbr: "DAL", score: "16", logo: "/api/logo/DAL", logoDark: "/api/logo/DAL?v=dark", caller: true }]);
  assert.deepEqual(vm.status, { tone: "final", text: "Final", word: "Final" });
  assert.equal(vm.spoken, "TB 24, DAL 16. Final.");
  assert.ok(isDeepFrozen(vm));
});

test("a watch playing back: the live lamp, the speed and the game clock", () => {
  const body = timeline.at104();
  const vm = headVm(makePv({ presented: state.final(), tl: tlOf(body), version: playing() }));
  assert.deepEqual(vm.status, { tone: "live", text: "Watching at 4x · Q3 10:51", word: "Watching at 4x" });
  assert.deepEqual(vm.teams.map((t) => t.score), ["14", "10"]);
  assert.equal(vm.spoken, "TB 14, DAL 10. Watching at 4x.", "the clock ticks on screen; the live region says only news");
});

test("a paused watch, the ESPN feed, and a game still in progress each say so", () => {
  const body = timeline.at104();
  const paused = { ...playing(), watch: { ...playing().watch, state: "paused" } };
  assert.deepEqual(headVm(makePv({ presented: state.final(), tl: tlOf(body), version: paused })).status,
    { tone: "paused", text: "Paused · Q3 10:51", word: "Paused" });
  const feed = { ...playing(), watch: { state: "idle" }, feed: { ...playing().feed, on: true, state: "live" } };
  assert.deepEqual(headVm(makePv({ presented: state.final(), tl: tlOf(body), version: feed })).status,
    { tone: "live", text: "ESPN live · Q3 10:51", word: "ESPN live" });
  assert.deepEqual(headVm(makePv({ presented: state.final(), tl: tlOf(body) })).status,
    { tone: "idle", text: "Q3 10:51", word: "" });
});

test("before the first state: the title alone, no score, no status words", () => {
  const vm = headVm(makePv());
  assert.deepEqual([vm.who, vm.game, vm.teams.length, vm.status.text], ["", "", 0, ""]);
});
