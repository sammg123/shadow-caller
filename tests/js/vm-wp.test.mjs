import test from "node:test";
import assert from "node:assert/strict";
import { wpVm } from "../../static/js/model/vm-wp.js";
import { makePv, state, timeline, tlOf, patch, isDeepFrozen } from "./model-fixtures.mjs";

const finalVm = () => wpVm(makePv({ presented: state.final(), tl: tlOf(timeline.final()) }));

test("one point per applied play, on the caller's side (DC B6.7)", () => {
  const vm = finalVm();
  assert.equal(vm.available, true);
  assert.equal(vm.points.length, 183);
  assert.deepEqual({ ...vm.points[0] }, { seq: 1, wp: 0.8732, t: 0, qtr: 1 });
  assert.equal(vm.points.find((p) => p.seq === 104).wp, 0.6324);
  assert.equal(vm.start, 0.8619);
  assert.equal(vm.current, 0);
  assert.equal(vm.currentText, "0%");
  assert.equal(vm.ariaLabel, "DAL win probability 0%");
  assert.equal(vm.tMax, 3600);
});

test("mid-game: the interception drops DAL to 63% (DC G16)", () => {
  const vm = wpVm(makePv({ presented: state.final(), tl: tlOf(timeline.at104()) }));
  assert.equal(vm.current, 0.6324);
  assert.equal(vm.ariaLabel, "DAL win probability 63%");
  assert.equal(vm.points.length, 104);
});

test("markers for the 7 scores and 3 turnovers, ticks at each drive start", () => {
  const vm = finalVm();
  assert.deepEqual(vm.markers.map((m) => [m.seq, m.kind, m.team, m.text]), [
    [12, "score", "DAL", "TD"], [35, "score", "TB", "TD"], [87, "score", "DAL", "FG"], [96, "score", "TB", "TD"],
    [104, "turnover", "DAL", "INT"], [111, "score", "TB", "TD"], [113, "turnover", "DAL", "FUMBLE"],
    [123, "score", "TB", "FG"], [159, "score", "DAL", "TD"], [176, "turnover", "DAL", "INT"],
  ]);
  assert.equal(vm.ticks.length, 21);
  assert.deepEqual({ ...vm.ticks[1] }, { idx: 2, team: "TB", t: 0 + vm.points.find((p) => p.seq === 14).t });
});

test("with the caller away, the opening value flips to his side", () => {
  const body = timeline.final();
  const teams = { DAL: { ...body.teams.DAL, home: false }, TB: { ...body.teams.TB, home: true } };
  const vm = wpVm(makePv({ tl: tlOf(patch(body, { teams })) }));
  assert.ok(Math.abs(vm.start - 0.1381) < 1e-9);
});

test("points follow ESPN's order even if a play arrived late", () => {
  const body = timeline.final();
  const [a, b, ...rest] = body.rows;
  const rows = [{ ...b, seq: 1 }, { ...a, seq: 2 }, ...rest];
  const vm = wpVm(makePv({ tl: tlOf(patch(body, { rows })) }));
  assert.deepEqual(vm.points.slice(0, 2).map((p) => p.seq), [2, 1]);
});

test("at kickoff, before ESPN's first number, the slot says when win probability appears", () => {
  const body = timeline.final();
  const kickoff = { ...tlOf(patch(body, { rows: [], wp_start: null })), source: "log" };   // the server: no play yet
  const vm = wpVm(makePv({ presented: state.final(), tl: kickoff }));
  assert.equal(vm.available, false);
  assert.equal(vm.note, "Win probability appears after the first play.");
  assert.deepEqual([...vm.points], []);
  assert.equal(wpVm(makePv()).available, false);
  const rows = body.rows.filter((r) => r.pred).slice(0, 3).map((r) => ({ ...r, src: "log", wp: null }));
  assert.equal(wpVm(makePv({ tl: tlOf(patch(body, { rows, wp_start: null })) })).available, false,
    "rows that aren't ESPN's never draw a line");
});

test("before the first play the line starts at ESPN's opening value", () => {
  const vm = wpVm(makePv({ tl: tlOf(timeline.final(), 0) }));
  assert.equal(vm.available, true);
  assert.equal(vm.current, 0.8619);
  assert.equal(vm.ariaLabel, "DAL win probability 86%");
  assert.ok(isDeepFrozen(vm));
});

test("caller side from the game when teams carry no home flag; every score type has a word", () => {
  const body = timeline.final();
  const teams = { DAL: { ...body.teams.DAL, home: undefined }, TB: { ...body.teams.TB, home: undefined } };
  const rows = body.rows.map((r) => (r.seq === 87 ? { ...r, scoring: { ...r.scoring, type: "SF" } }
    : r.seq === 123 ? { ...r, scoring: { ...r.scoring, type: "D2P" } } : r));
  const vm = wpVm(makePv({ presented: state.final(), tl: tlOf(patch(body, { teams, rows })) }));
  assert.equal(vm.start, 0.8619);
  assert.deepEqual(vm.markers.filter((m) => m.seq === 87 || m.seq === 123).map((m) => m.text), ["SAFETY", "2PT"]);
});

test("no opening value and no points: nothing to say yet", () => {
  const body = timeline.final();
  const vm = wpVm(makePv({ tl: tlOf(patch(body, { wp_start: null, rows: body.rows.map((r) => ({ ...r, wp: null })) })) }));
  assert.deepEqual([vm.available, vm.start, vm.current, vm.currentText, vm.ariaLabel], [true, null, null, "", ""]);
});

// v1.2 (A8, additive): the readout names whose side the line is on.
test("the caller's abbreviation rides along for the readout; none when unavailable", () => {
  assert.equal(finalVm().caller, "DAL");
  assert.equal(wpVm(makePv()).caller, null);
});
