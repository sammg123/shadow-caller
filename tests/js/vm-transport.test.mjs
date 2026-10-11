import test from "node:test";
import assert from "node:assert/strict";
import { isWatchSession, transportVm, watchOf } from "../../static/js/model/vm-transport.js";
import { isDeepFrozen, makePv, state, timeline, tlOf } from "./model-fixtures.mjs";

const watch = (over) => ({ state: "paused", event_id: "401872980", speed: 4, idx: 104, total: 183, next_at: null,
  error: null, ...over });
/** restructure-v2.md 9: watch.marks (in /api/state's watch, never /api/version's brief) and watch.game. */
const MARKS = Object.freeze([
  { idx: 0, kind: "drive", team: "TB", label: "TB drive 1" },
  { idx: 6, kind: "drive", team: "DAL", label: "DAL drive 1" },
  { idx: 46, kind: "quarter", team: "", label: "Q2" },
  { idx: 61, kind: "score", team: "DAL", label: "DAL TD" },
]);
const can = (vm) => ({ back: vm.canBack, play: vm.canPlay, forward: vm.canForward, reset: vm.canReset,
  live: vm.canGoLive, seek: vm.canSeek });
const pressed = (vm) => vm.speeds.filter((s) => s.pressed).map((s) => s.value);
const pv = ({ version, presented, view, ...rest } = {}) => makePv({
  version: version === undefined ? { watch: watch() } : version,
  presented: presented === undefined ? { ...state.final(), watch: { ...watch(), marks: MARKS } } : presented,
  tl: tlOf(timeline.final()), view, ...rest });

test("paused at play 104 of 183: back, play, forward, reset and Go Live; the bar sits where the game is", () => {
  const vm = transportVm(pv());
  assert.deepEqual([vm.state, vm.idx, vm.total, vm.count, vm.at, vm.busy], ["paused", 104, 183, "104 / 183",
    Number((104 / 183).toFixed(5)), false]);
  assert.deepEqual(can(vm), { back: true, play: true, forward: true, reset: true, live: true, seek: true });
  assert.deepEqual([vm.playing, vm.playLabel, vm.live], [false, "Play", false]);
  assert.equal(vm.valueText, "Play 104 of 183");
});

test("playing: the key says Pause; the speeds are 1x 2x 4x 10x with exactly the watch's lit", () => {
  const vm = transportVm(pv({ version: { watch: watch({ state: "playing", speed: 10 }) } }));
  assert.deepEqual([vm.state, vm.playing, vm.playLabel, vm.canPlay], ["playing", true, "Pause", true]);
  assert.deepEqual(vm.speeds.map((s) => [s.value, s.label, s.key]), [[1, "1x", "1"], [2, "2x", "2"], [4, "4x", "3"],
    [10, "10x", "4"]]);
  assert.deepEqual(pressed(vm), [10]);
});

test("at kickoff nothing goes back; at the final whistle nothing goes forward and Go Live is lit", () => {
  const kickoff = transportVm(pv({ version: { watch: watch({ idx: 0 }) } }));
  assert.deepEqual(can(kickoff), { back: false, play: true, forward: true, reset: false, live: true, seek: true });
  assert.equal(kickoff.valueText, "Kickoff");
  const final = transportVm(pv({ version: { watch: watch({ state: "done", idx: 183, game: { status: "post",
    detail: "Final" } }) } }));
  assert.deepEqual(can(final), { back: true, play: false, forward: false, reset: true, live: false, seek: true });
  assert.deepEqual([final.live, final.valueText, final.count], [true, "Final", "183 / 183"]);
});

test("following a live game: Go Live is lit, back and reset still work, nothing to play or step forward", () => {
  const vm = transportVm(pv({ version: { watch: { state: "stopped", idx: 0, total: 0 }, feed: { on: true } },
    presented: { ...state.feedOn(), watch: { state: "stopped", idx: 0, total: 0, marks: [] } } }));
  assert.equal(vm.state, "live");
  assert.deepEqual(can(vm), { back: true, play: false, forward: false, reset: true, live: false, seek: false });
  assert.deepEqual([vm.live, vm.count, vm.valueText], [true, "", "Live"]);
});

test("while the page opens the game the bar is loading and nothing can be pressed", () => {
  const vm = transportVm(pv({ version: null, presented: null, view: { playback: { kind: "open", target: null } } }));
  assert.equal(vm.state, "loading");
  assert.deepEqual(can(vm), { back: false, play: false, forward: false, reset: false, live: false, seek: false });
  assert.equal(vm.busy, true);
});

test("a seek in flight shows its target on the bar before the server answers", () => {
  const vm = transportVm(pv({ view: { playback: { kind: "seek", target: 20 } } }));
  assert.deepEqual([vm.busy, vm.idx, vm.target, vm.at], [true, 104, 20, Number((20 / 183).toFixed(5))]);
});

test("the drive ticks come from watch.marks: placed on the bar, the caller's marked, malformed ones dropped", () => {
  const bad = [{ idx: -1, kind: "drive", team: "TB", label: "x" }, { idx: 400, kind: "drive", team: "TB", label: "x" },
    { idx: 3, kind: "kickoff", team: "TB", label: "x" }, { idx: 2.5, kind: "drive", team: "TB", label: "x" }, null];
  const vm = transportVm(pv({ presented: { ...state.final(), watch: { ...watch(), marks: [...MARKS, ...bad] } } }));
  assert.deepEqual(vm.marks.map((m) => [m.kind, m.idx, m.at, m.team, m.caller, m.label]), [
    ["drive", 0, 0, "TB", false, "TB drive 1"], ["drive", 6, Number((6 / 183).toFixed(5)), "DAL", true, "DAL drive 1"],
    ["quarter", 46, Number((46 / 183).toFixed(5)), "", false, "Q2"],
    ["score", 61, Number((61 / 183).toFixed(5)), "DAL", true, "DAL TD"]]);
  assert.equal(new Set(vm.marks.map((m) => m.key)).size, vm.marks.length, "keys are unique");
  assert.deepEqual(vm.driveStarts, [0, 6], "PageUp and PageDown walk the drives");
});

test("no spoilers (DC E5): drive and quarter ticks span the game, a score shows once play has passed it", () => {
  const marks = [...MARKS, { idx: 150, kind: "score", team: "TB", label: "TD TB" },
    { idx: 160, kind: "drive", team: "DAL", label: "DAL ball · Q4 5:00" }];
  const at = (idx) => transportVm(pv({ version: { watch: watch({ idx }) },
    presented: { ...state.final(), watch: { ...watch({ idx }), marks } } }));
  const ticks = (vm) => vm.marks.map((m) => `${m.kind} ${m.idx}`);
  assert.deepEqual(ticks(at(0)), ["drive 0", "drive 6", "quarter 46", "drive 160"], "at kickoff: no score yet");
  assert.deepEqual(ticks(at(60)), ["drive 0", "drive 6", "quarter 46", "drive 160"], "the TD at 61 is still ahead");
  assert.deepEqual(ticks(at(61)), ["drive 0", "drive 6", "quarter 46", "score 61", "drive 160"], "its play is in");
  assert.deepEqual(ticks(at(183)), ["drive 0", "drive 6", "quarter 46", "score 61", "score 150", "drive 160"]);
  assert.deepEqual(at(60).driveStarts, [0, 6, 160], "every drive start stays reachable");
});

test("an error shows the server's own words", () => {
  const vm = transportVm(pv({ version: { watch: watch({ state: "error", error: "The app restarted during a watch." }) } }));
  assert.deepEqual([vm.state, vm.error], ["error", "The app restarted during a watch."]);
  assert.equal(vm.canPlay, false);
});

test("an error session is never stuck: Reset and Go Live rebuild from it, wherever it stopped", () => {
  // a server restart brings the session back as an error with nothing loaded (0 of 0): its place is unknown
  const restarted = transportVm(pv({ version: { watch: watch({ state: "error", idx: 0, total: 0, error: "Restarted.",
    game: { status: "post", detail: "Final" } }) }, presented: { ...state.final(), watch: { ...watch({ state: "error",
    idx: 0, total: 0 }), marks: MARKS, game: { status: "post", detail: "Final" } } } }));
  assert.deepEqual(can(restarted), { back: false, play: false, forward: false, reset: true, live: true, seek: false });
  assert.deepEqual([restarted.live, restarted.idx, restarted.total, restarted.count, restarted.valueText, restarted.at],
    [false, null, null, "", "", 0], "no 0 / 0, no Kickoff: the field still shows where the game was");
  // a session stopped mid-game (a run of plays it couldn't apply) keeps its place: the steps and the bar work too
  const stopped = transportVm(pv({ version: { watch: watch({ state: "error", idx: 40, error: "Stopped." }) } }));
  assert.deepEqual(can(stopped), { back: true, play: false, forward: true, reset: true, live: true, seek: true });
  const atEnd = transportVm(pv({ version: { watch: watch({ state: "error", idx: 183, error: "Stopped.",
    game: { status: "post", detail: "Final" } }) } }));
  assert.deepEqual([atEnd.canGoLive, atEnd.canReset, atEnd.live], [true, true, false], "Go Live rebuilds its end");
});

test("odd speeds press nothing; with no session the choice made beforehand is lit", () => {
  assert.deepEqual(pressed(transportVm(pv({ version: { watch: watch({ speed: 2.5 }) } }))), []);
  assert.deepEqual(pressed(transportVm(pv({ version: { watch: { state: "idle" } }, presented: null,
    prefs: { watchSpeed: 2 } }))), [2]);
});

test("watchOf is the freshest watch (version first); isWatchSession covers playing, paused, done and error", () => {
  const presented = { ...state.final(), watch: watch({ state: "paused" }) };
  assert.equal(watchOf(makePv({ presented })).state, "paused");
  assert.equal(watchOf(makePv({ presented, version: { watch: watch({ state: "playing" }) } })).state, "playing");
  assert.equal(watchOf(makePv()), null);
  assert.deepEqual(["idle", "playing", "paused", "done", "stopped", "error", undefined].map(isWatchSession),
    [false, true, true, true, false, true, false]);
  assert.ok(isDeepFrozen(transportVm(pv())));
  assert.equal(transportVm(makePv()).state, "idle", "nothing at all: idle, never a throw");
});
