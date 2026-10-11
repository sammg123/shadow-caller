// The Model Report's call rows (static/js/report/model/calls.js, vm-calls.js): every snap he called that the model
// graded, from the saved TB at DAL game (59 Dallas calls in 9 drives), with the model's top 3 and their chances.
import assert from "node:assert/strict";
import test from "node:test";
import { callerCalls, callFacts, chanceOn, leafTable } from "../../../static/js/report/model/calls.js";
import { callsVm } from "../../../static/js/report/model/vm-calls.js";
import { isDeepFrozen, makePv, patch, state, timeline, tlOf } from "../model-fixtures.mjs";

const finalPv = () => makePv({ presented: state.final(), tl: tlOf(timeline.final()) });
const calls = (vm) => vm.items.filter((item) => item.kind === "call");
const callAt = (vm, seq) => calls(vm).find((item) => item.seq === seq);

test("his graded snaps: 59 calls, in timeline order, only the caller's rows with a prediction", () => {
  const rows = callerCalls(tlOf(timeline.final()));
  assert.equal(rows.length, 59);
  assert.deepEqual([rows[0].seq, rows.at(-1).seq], [2, 176]);
  assert.ok(rows.every((row) => row.offense_is_caller === true && row.pred));
  assert.ok(rows.every((row, i) => i === 0 || row.seq > rows[i - 1].seq));
  assert.deepEqual(callerCalls(null), []);
  assert.deepEqual(callerCalls({ rows: [{ seq: 1, offense_is_caller: true, pred: null }] }), []);
});

test("one call's facts: snap, time, situation, the model's top 3 with chances, what he called, rank, verdict", () => {
  const tl = tlOf(timeline.final());
  const facts = callFacts(callerCalls(tl)[0], leafTable(makePv({ tl })));
  assert.deepEqual({ ...facts, top3: undefined }, {
    seq: 2, drive: 1, qtr: 1, snap: "1", time: "Q1 14:54", situation: "1st & 10 at DAL 30",
    called: "Short (0–9 air yds), incomplete", calledPct: "14%", rank: "3", verdict: "top3", verdictText: "In his top 3",
    nullified: false, result: "INC", chance: 0.14, top3: undefined,
  });
  assert.deepEqual(facts.top3.map((t) => [t.name, t.pct, t.called]), [
    ["Inside run (A/B gap)", "27%", false], ["PA short (0–9)", "16%", false], ["Short (0–9 air yds)", "14%", true]]);
});

test("the chance on his call: the specific play, else the play type, else pass or run", () => {
  assert.equal(chanceOn({ leaf_p: 0.14, fam_p: 0.5, p: 0.7, dropback: 1 }), 0.14);
  assert.equal(chanceOn({ leaf_p: null, fam_p: 0.5, p: 0.7, dropback: 1 }), 0.5);
  assert.equal(chanceOn({ p: 0.7, dropback: 1 }), 0.7);
  assert.ok(Math.abs(chanceOn({ p: 0.7, dropback: 0 }) - 0.3) < 1e-12);
  assert.equal(chanceOn({ p: 0.7 }), null);
});

test("the table: a row per drive of his, then its calls, oldest first (59 calls, 9 drives)", () => {
  const vm = callsVm(finalPv());
  assert.equal(vm.heading, "Every call v the model");
  assert.deepEqual(vm.columns, ["#", "Time", "Situation", "His top 3", "He called", "Rank", "Verdict"]);
  assert.equal(vm.empty, false);
  assert.equal(vm.countText, "59 calls");
  assert.equal(calls(vm).length, 59);
  const drives = vm.items.filter((item) => item.kind === "drive");
  assert.deepEqual(drives.map((d) => d.drive), [1, 3, 5, 7, 9, 12, 16, 18, 20]);
  assert.deepEqual(vm.items[0], { kind: "drive", key: "drive-at:2", drive: 1, text: "DAL TD · 9 plays, 70 yds, 4:09",
    result: "TD" });
  assert.equal(vm.items[1].key, "call:2");
  assert.equal(drives.at(-1).text, "DAL INT · 7 plays, 52 yds, 2:26");
  assert.ok(isDeepFrozen(vm));
});

test("verdicts: top pick, in his top 3 with its rank, and a miss with its rank of 14", () => {
  const vm = callsVm(finalPv());
  assert.deepEqual([callAt(vm, 3).verdict, callAt(vm, 3).verdictText, callAt(vm, 3).rank], ["top1", "Top pick", "1"]);
  assert.deepEqual([callAt(vm, 2).verdict, callAt(vm, 2).rank], ["top3", "3"]);
  const miss = callAt(vm, 158);
  assert.deepEqual([miss.snap, miss.time, miss.verdict, miss.verdictText, miss.rank, miss.calledPct],
    ["47", "Q4 5:35", "miss", "Miss", "13", "0.5%"]);
});

test("a play a flag wiped out keeps its call and grade, shows no snap number, and says no play (G15)", () => {
  const call = callAt(callsVm(finalPv()), 8);
  assert.deepEqual([call.snap, call.nullified, call.result, call.called],
    ["", true, "FLAG", "Off-tackle left (no play: defensive offside on TB)"]);
  assert.equal(call.verdict, "miss");
});

test("touchdowns and turnovers ride on the call's words", () => {
  const vm = callsVm(finalPv());
  assert.equal(callAt(vm, 12).called, "Inside run (A/B gap), TD");
  assert.equal(callAt(vm, 104).called, "Short (0–9 air yds), turnover");
});

test("no calls yet: a plain empty line and no rows", () => {
  const vm = callsVm(makePv({ presented: state.tilt(), tl: tlOf(timeline.final(), 1) }));
  assert.deepEqual([vm.empty, vm.items.length, vm.emptyText, vm.countText],
    [true, 0, "No calls yet: his first snap hasn't happened.", ""]);
  assert.equal(callsVm(makePv()).empty, true);
});

test("a call with no chances on record (an old game file) keeps its row with its top pick alone", () => {
  const body = timeline.final();
  const row = body.rows.find((r) => r.seq === 3);
  const bare = { ...row, pred: { ...row.pred, dist: null, top3: null } };
  const tl = tlOf(patch(body, { rows: body.rows.map((r) => (r.seq === 3 ? bare : r)) }));
  const call = callAt(callsVm(makePv({ presented: state.final(), tl })), 3);
  assert.deepEqual(call.top3.map((t) => [t.name, t.pct, t.called]), [["Short (0–9 air yds)", "34%", true]]);
});

test("server text stays text: a hostile play name is carried as it is, never parsed", () => {
  const body = timeline.final();
  const evil = "<img src=x onerror=alert(1)>";
  const rows = body.rows.map((r) => (r.seq === 3 ? { ...r, pred: { ...r.pred, name: evil } } : r));
  const call = callAt(callsVm(makePv({ presented: state.final(), tl: tlOf(patch(body, { rows })) })), 3);
  assert.equal(call.called, evil);
});
