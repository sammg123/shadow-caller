import test from "node:test";
import assert from "node:assert/strict";
import { scoreboardVm, teamsOf, sourceOf } from "../../static/js/model/vm-scoreboard.js";
import { makePv, state, timeline, tlOf, patch, isDeepFrozen } from "./model-fixtures.mjs";

const team = (vm, abbr) => vm.teams.find((t) => t.abbr === abbr);
const espnPv = (body, presented = state.final()) => makePv({ presented, tl: tlOf(body) });

test("final whistle from the timeline status (DC C5)", () => {
  const vm = scoreboardVm(espnPv(timeline.final()));
  assert.deepEqual(vm.teams.map((t) => t.abbr), ["TB", "DAL"]);
  assert.deepEqual({ ...team(vm, "TB"), }, {
    abbr: "TB", name: "Buccaneers", location: "Tampa Bay", logo: "/api/logo/TB", logoDark: "/api/logo/TB?v=dark",
    score: "24", poss: false, timeouts: 2, caller: false, side: "right", home: false,
  });
  assert.deepEqual([team(vm, "DAL").score, team(vm, "DAL").timeouts, team(vm, "DAL").caller], ["16", 1, true]);
  assert.deepEqual([vm.qtr, vm.qtrText, vm.clock, vm.clockEst, vm.downText, vm.ballOn, vm.situation, vm.state, vm.poss],
    [4, "Q4", "0:00", false, "", "", "", "post", null]);
  assert.deepEqual([vm.wpCaller, vm.wpText], [0, "0%"]);
  assert.equal(vm.source, "espn");
});

test("after the interception TB has the ball at its 25 (DC C5)", () => {
  const vm = scoreboardVm(espnPv(timeline.at104()));
  assert.deepEqual([vm.poss, team(vm, "TB").poss, team(vm, "DAL").poss], ["TB", true, false]);
  assert.deepEqual([vm.downText, vm.ballOn, vm.situation], ["1st & 10", "TB 25", "1st & 10 at TB 25"]);
  assert.deepEqual([vm.qtrText, vm.clock, team(vm, "DAL").score, team(vm, "TB").score], ["Q3", "10:51", "10", "14"]);
  assert.deepEqual([team(vm, "DAL").timeouts, team(vm, "TB").timeouts], [3, 3]);
  assert.deepEqual([vm.wpCaller, vm.wpText], [0.6324, "63%"]);
});

test("goal to go reads Goal on the scoreboard (G16)", () => {
  const body = timeline.final();
  const vm = scoreboardVm(espnPv(patch(body, { rows: body.rows.slice(0, 8),
    status: { ...body.status, state: "in", poss: "DAL", last_seq: 8 } })));
  assert.deepEqual([vm.downText, vm.ballOn], ["1st & Goal", "TB 4"]);
});

test("after a score the ball waits for the kickoff: no down text", () => {
  const body = timeline.final();
  const vm = scoreboardVm(espnPv(patch(body, { rows: body.rows.slice(0, 12),
    status: { ...body.status, state: "in", poss: "DAL", ball_kind: "kickoff", last_seq: 12 } })));
  assert.deepEqual([vm.downText, vm.ballOn], ["", ""]);
});

test("logos must be the app's own proxy URLs", () => {
  const body = timeline.final();
  const teams = { ...body.teams, TB: { ...body.teams.TB, logo: "javascript:alert(1)" },
    DAL: { ...body.teams.DAL, logo: "/api/logo/DAL?v=dark" } };
  const vm = scoreboardVm(espnPv(patch(body, { teams })));
  assert.equal(team(vm, "TB").logo, null);
  assert.equal(team(vm, "DAL").logo, "/api/logo/DAL?v=dark");
});

test("hand-entered games read the strip's situation (DC D)", () => {
  const vm = scoreboardVm(makePv({ presented: state.tilt() }));
  assert.equal(vm.source, "log");
  assert.deepEqual(vm.teams.map((t) => [t.abbr, t.score, t.poss, t.timeouts, t.logo, t.name]),
    [["TB", "14", false, null, null, "TB"], ["DAL", "0", true, null, null, "DAL"]]);
  assert.deepEqual([vm.qtrText, vm.clock, vm.clockEst, vm.downText, vm.ballOn, vm.situation, vm.poss],
    ["Q1", "14:26", true, "3rd & 2", "TB 20", "3rd & 2 at TB 20", "DAL"]);
  assert.deepEqual([vm.wpCaller, vm.wpText], [null, ""]);
});

test("off the field by hand: no down, no possession", () => {
  const vm = scoreboardVm(makePv({ presented: state.final() }));
  assert.deepEqual([vm.downText, vm.ballOn, vm.poss, vm.state], ["", "", null, "in"]);
  assert.deepEqual(vm.teams.map((t) => t.score), ["24", "16"]);
});

test("source: the presented pointer, else the rows", () => {
  assert.equal(sourceOf(makePv({ presented: { ...state.final(), timeline: { source: "espn" } } })), "espn");
  assert.equal(sourceOf(espnPv(timeline.final())), "espn");
  assert.equal(sourceOf(makePv({ presented: state.final() })), "log");
});

test("teamsOf: caller, opponent and the away-home order from any source", () => {
  assert.deepEqual({ ...teamsOf(espnPv(timeline.final())), byAbbr: null },
    { caller: "DAL", opp: "TB", order: ["TB", "DAL"], byAbbr: null });
  const manual = teamsOf(makePv({ presented: state.tilt() }));
  assert.deepEqual([manual.caller, manual.opp, [...manual.order]], ["DAL", "TB", ["TB", "DAL"]]);
  assert.deepEqual([...teamsOf(makePv()).order], []);
});

test("nothing presented yet: an empty scoreboard, deep-frozen", () => {
  const vm = scoreboardVm(makePv());
  assert.deepEqual([vm.teams.length, vm.qtrText, vm.clock], [0, "", ""]);
  assert.ok(isDeepFrozen(scoreboardVm(espnPv(timeline.final()))));
});

test("no spot yet, or the half just ended: no down text", () => {
  const body = timeline.final();
  const inGame = { ...body.status, state: "in", poss: null };
  const timeoutOnly = scoreboardVm(espnPv(patch(body, { rows: [body.rows[12]], status: inGame })));
  assert.deepEqual([timeoutOnly.downText, timeoutOnly.ballOn], ["", ""]);
  const halftime = scoreboardVm(espnPv(patch(body, { rows: body.rows.slice(0, 93), status: inGame })));
  assert.deepEqual([halftime.downText, halftime.ballOn], ["", ""]);
});

// v1.2 (A8, additive): the dark-background logo for LED windows (DESIGN.md), validated like the default one.
test("each team carries ESPN's dark-background logo too, only as the app's own proxy URL", () => {
  const body = timeline.final();
  const teams = { ...body.teams, TB: { ...body.teams.TB, logo_dark: "https://evil.example/x.png" } };
  const vm = scoreboardVm(espnPv(patch(body, { teams })));
  assert.equal(team(vm, "TB").logoDark, null);
  assert.equal(team(vm, "DAL").logoDark, "/api/logo/DAL?v=dark");
  assert.equal(scoreboardVm(makePv({ presented: state.tilt() })).teams[0].logoDark, null, "no ESPN teams, no logos");
});
