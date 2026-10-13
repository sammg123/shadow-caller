// static/js/report/model/side.js: the Model Report with both sides tracked (restructure-v2.md 11 decision 4). A switch
// between the two callers' sections (his night so far, scorecard, hit rate, surprises, tendencies, memory, every call)
// while the win probability, the drives and the team stats stay the game's; with one caller nothing changes. Real
// captures, plus both sides derived from them (both-sides.mjs).
import assert from "node:assert/strict";
import test from "node:test";
import { REPORT_COMPONENTS } from "../../../static/js/report/bindings.js";
import { callSideOf, shownSide, sidePv, switchVm } from "../../../static/js/report/model/side.js";
import { callsVm } from "../../../static/js/report/model/vm-calls.js";
import { bothState, bothTimeline, callsOf } from "../both-sides.mjs";
import { isDeepFrozen, makePv, state, timeline, tlOf } from "../model-fixtures.mjs";

const onePv = () => makePv({ presented: state.final(), tl: tlOf(timeline.final()) });
const bothPv = (sideChoice, opts = {}) => makePv({ presented: bothState(opts), tl: tlOf(bothTimeline()),
  ...(sideChoice === undefined ? {} : { sideChoice }) });
const select = (name, pv) => REPORT_COMPONENTS.find((s) => s.name === name).select(pv);

// ---------------------------------------------------------------- which caller the report shows
test("one caller: no side, no switch, and every board reads the state as it is", () => {
  const pv = onePv();
  assert.equal(shownSide(pv), null);
  assert.equal(sidePv(pv), pv, "the same view: nothing filtered");
  assert.deepEqual({ ...switchVm(pv), keys: [...switchVm(pv).keys] }, { shown: false, label: "", group: "", keys: [] });
});

test("both callers: the first named (away) until the viewer picks; a pick of a side nobody tracks is ignored", () => {
  assert.equal(shownSide(bothPv()).team, "TB");
  assert.equal(shownSide(bothPv("DAL")).team, "DAL");
  assert.equal(shownSide(bothPv("NYG")).team, "TB");
  assert.equal(shownSide(bothPv(null)).caller, "Zac Robinson");
});

test("the switch: one key per caller, his last name and team, the shown one pressed", () => {
  const vm = switchVm(bothPv("DAL"));
  assert.equal(vm.shown, true);
  assert.equal(vm.label, "Shadowing");
  assert.equal(vm.group, "Whose calls the report shows");
  assert.deepEqual(vm.keys.map((k) => [k.team, k.name, k.pressed]),
    [["TB", "Robinson", false], ["DAL", "Schottenheimer", true]]);
  assert.equal(vm.keys[0].title, "Show Zac Robinson's calls (TB offense). Win probability, drives and team stats "
    + "are the whole game's.");
  assert.ok(isDeepFrozen(vm));
});

// ---------------------------------------------------------------- his sections, the game's boards
test("his sections read his calls only: the calls table, the night, the surprises, the memory, the hit rate", () => {
  const presented = bothState();
  const tb = callsOf(presented, "TB");
  const dal = callsOf(presented, "DAL");
  const callRows = (vm) => vm.items.filter((i) => i.kind === "call");
  assert.equal(callRows(select("calls", bothPv("TB"))).length, tb.length);
  assert.equal(callRows(select("calls", bothPv("DAL"))).length, dal.length);
  assert.equal(select("night", bothPv("TB")).track.calls.length, tb.length);
  assert.equal(select("night", bothPv("DAL")).track.calls.length, dal.length);
  assert.equal(select("hit-rate", bothPv("DAL")).total.calls, dal.length);
  const surprise = select("surprises", bothPv("TB")).rows[0];
  assert.equal(bothTimeline().rows.find((r) => r.seq === surprise.seq).team, "TB");
  assert.ok(select("memory", bothPv("DAL")).rows.every((r) => bothTimeline().rows.find((x) => x.seq === r.seq).team
    === "DAL"));
});

test("his plates name him; with one caller every plate reads as before", () => {
  const plates = (pv) => ({ night: select("night", pv).heading, league: select("league", pv).plate,
    tendencies: select("tendencies", pv).title, situations: select("hit-rate", pv).heading,
    surprises: select("surprises", pv).heading, memory: select("memory", pv).heading, calls: select("calls", pv).heading });
  assert.deepEqual(plates(bothPv("TB")), { night: "Robinson so far", league: "Robinson's scorecard",
    tendencies: "Robinson's tendencies", situations: "Robinson's hit rate by down and distance",
    surprises: "Robinson's biggest surprises", memory: "Robinson's in-game memory",
    calls: "Robinson's calls v the model" });
  assert.deepEqual(plates(onePv()), { night: "Schottenheimer so far", league: "Schottenheimer's scorecard",
    tendencies: "Schottenheimer's tendencies", situations: "Hit rate by down and distance",
    surprises: "His biggest surprises", memory: "In-game memory", calls: "Every call v the model" });
});

test("his scorecard and tendencies come from his side: the server's when sent, else counted from his calls", () => {
  const sent = { TB: { ...state.final().metrics, n: 70 } };
  assert.equal(select("league", bothPv("TB", { metrics: sent })).pairs[0].snaps, 70, "the server's numbers, as sent");
  const counted = select("league", bothPv("TB", { perSide: false }));
  const tb = callsOf(bothState(), "TB");
  assert.match(JSON.stringify(counted), new RegExp(`${tb.filter((r) => r.leaf_rank === 1).length} of ${tb.length}`));
  const named = select("tendencies", bothPv("TB", { perSide: false }));
  assert.deepEqual([named.title, named.rows.length], ["Robinson's tendencies", 0],
    "no profile sent for him: his name on an empty board, never another caller's terms");
});

test("the game's boards stay the game's: win probability, drives and team stats ignore the switch", () => {
  for (const name of ["win-prob", "drive-chart", "box-score"]) {
    assert.deepEqual(select(name, bothPv("TB")), select(name, bothPv("DAL")), name);
  }
  const drives = select("drive-chart", bothPv("TB")).drives;
  assert.ok(drives.some((d) => d.team === "TB" && d.firstSeq !== null), "a drive of either caller opens his calls");
  assert.ok(drives.some((d) => d.team === "DAL" && d.firstSeq !== null));
});

test("the view his boards read is built once per render and never changes its input", () => {
  const pv = bothPv("TB");
  const narrowed = sidePv(pv);
  assert.equal(sidePv(pv), narrowed);
  assert.deepEqual([narrowed.side.team, narrowed.side.last], ["TB", "Robinson"]);
  assert.ok(narrowed.tl.rows.every((r) => !r.offense_is_caller || r.team === "TB" || !r.pred));
  assert.ok(isDeepFrozen(pv));
  assert.equal(callsVm(narrowed).items.filter((i) => i.kind === "call").length, callsOf(pv.presented, "TB").length);
});

// ---------------------------------------------------------------- whose call a play is
test("whose call a play is: the tracked caller of that row's offense, else nobody", () => {
  const tl = tlOf(bothTimeline());
  assert.equal(callSideOf(tl, 120), "TB");
  assert.equal(callSideOf(tl, 104), "DAL");
  assert.equal(callSideOf(tl, 113), null, "a kickoff is nobody's call");
  assert.equal(callSideOf(tl, 9999), null);
  assert.equal(callSideOf(null, 120), null);
  assert.equal(callSideOf(tlOf(timeline.final()), 120), null, "one caller: an opponent's play has no row");
});
