import test from "node:test";
import assert from "node:assert/strict";
import { logVm } from "../../static/js/model/vm-log.js";
import { makePv, state, patch, isDeepFrozen, timeline, tlOf } from "./model-fixtures.mjs";

const withLog = (log) => patch(state.final(), { log });
const plain = (row) => ({ ...row, rank: { ...row.rank } });

test("an empty log says so (#6)", () => {
  const vm = logVm(makePv({ presented: withLog([]) }));
  assert.equal(vm.empty, true);
  assert.equal(vm.emptyText, "No snaps yet. Each logged play shows his top pick next to what he called.");
  assert.equal(logVm(makePv()).empty, true);
});

test("columns in order (#112)", () => {
  const vm = logVm(makePv({ presented: state.final() }));
  assert.deepEqual([...vm.columns], ["#", "Time", "Situation", "His top pick", "Actual", "His % on it", "League %", "Rank", "Yds"]);
  assert.equal(vm.heading, "Play log");
});

test("every row, newest first, with the FI 3.9 cells", () => {
  const vm = logVm(makePv({ presented: state.final() }));
  assert.equal(vm.rows.length, 59);
  assert.deepEqual(plain(vm.rows[0]), {
    seq: 59, snap: "55", time: "Q4 1:22", situation: "2nd & 1 at TB 24", topPick: "Short (0–9 air yds) 39%",
    actual: "Short (0–9 air yds), turnover", hisP: "39%", lgP: "43%", rank: { text: "1", tone: "good" }, yds: "0",
    nullified: false, verdict: "top1", tlSeq: null, reviewing: false,
  });
});

test("nullified rows: empty # (G15), Yds flag, names say no play (#108)", () => {
  const vm = logVm(makePv({ presented: state.final() }));
  const flagged = vm.rows.filter((r) => r.nullified);
  assert.equal(flagged.length, 4);
  assert.ok(flagged.every((r) => r.snap === "" && r.yds === "flag" && r.actual.includes("(no play:")));
});

test("goal to go reads Goal in the log (G16)", () => {
  const vm = logVm(makePv({ presented: state.final() }));
  const bySeq = (seq) => vm.rows.find((r) => r.seq === seq);
  assert.equal(bySeq(7).situation, "1st & Goal at TB 8");
  assert.equal(bySeq(9).situation, "2nd & Goal at TB 4");
});

test("rank tones: 1 good, 2 and 3 plain, 4 and up bad (#113)", () => {
  const vm = logVm(makePv({ presented: state.final() }));
  const tones = new Map(vm.rows.map((r) => [r.rank.text, r.rank.tone]));
  assert.equal(tones.get("1"), "good");
  assert.equal(tones.get("2"), "");
  assert.equal(tones.get("3"), "");
  assert.equal(tones.get("4"), "bad");
  assert.equal(tones.get("13"), "bad");
});

test("a hand-entered snap from the FI #30 state", () => {
  const vm = logVm(makePv({ presented: state.tilt() }));
  assert.deepEqual(plain(vm.rows[0]), {
    seq: 1, snap: "1", time: "Q1 15:00", situation: "1st & 10 at DAL 25", topPick: "Inside run (A/B gap) 30%",
    actual: "Inside run (A/B gap)", hisP: "30%", lgP: "27%", rank: { text: "1", tone: "good" }, yds: "-3",
    nullified: false, verdict: "top1", tlSeq: null, reviewing: false,
  });
});

test("shorthand I logs a pass with no type: dashes in the model columns (#80)", () => {
  const base = state.tilt().log[0];
  const pass = { ...base, seq: 2, snap: 2, name: "Pass", call: "P", family: null, leaf: null, turnover: true,
    leaf_p: null, leaf_p_league: null, fam_p: null, fam_p_league: null, leaf_rank: null };
  const vm = logVm(makePv({ presented: withLog([pass]) }));
  assert.deepEqual([vm.rows[0].actual, vm.rows[0].hisP, vm.rows[0].lgP, vm.rows[0].rank.text],
    ["Pass, turnover", "—", "—", "—"]);
});

test("rows with only a play type, legacy rows and touchdowns", () => {
  const base = state.tilt().log[0];
  const famOnly = { ...base, seq: 3, leaf_p: null, fam_p: 0.5, fam_p_league: 0.4567, leaf_rank: null };
  const legacy = { ...base, seq: 4, top_leaf: null, p: 0.3, name: null, call: "R", td: true };
  const vm = logVm(makePv({ presented: withLog([famOnly, legacy]) }));
  assert.deepEqual([vm.rows[0].hisP, vm.rows[0].lgP], ["50%", "46%"]);
  assert.deepEqual([vm.rows[1].topPick, vm.rows[1].actual], ["Run 70%", "Run, TD"]);
  assert.ok(isDeepFrozen(vm));
});

test("a row with no prediction numbers and no yards still renders", () => {
  const base = state.tilt().log[0];
  const bare = { ...base, top_leaf: null, p: null, yards: null, snap: null };
  const vm = logVm(makePv({ presented: withLog([bare]) }));
  assert.deepEqual([vm.rows[0].topPick, vm.rows[0].yds, vm.rows[0].snap], ["—", "", ""]);
});

// v1.2 (A8, additive): each logged snap knows its row on the field (to review it there) and its verdict.
test("each logged snap links to its drawn row on the field and carries its verdict", () => {
  const pv = (extra = {}) => makePv({ presented: state.final(), tl: tlOf(timeline.final()), ...extra });
  const vm = logVm(pv());
  assert.deepEqual(vm.rows.slice(3, 6).map((r) => [r.seq, r.verdict]), [[56, "top3"], [55, "top1"], [54, "miss"]]);
  assert.deepEqual(vm.rows.slice(0, 3).map((r) => [r.seq, r.tlSeq]), [[59, 176], [58, 175], [57, 174]]);
  assert.equal(vm.rows.filter((r) => r.tlSeq !== null).length, 59, "every snap of the replayed game is on the field");
  const reviewing = logVm(pv({ view: { review: { seq: 175 } } }));
  assert.deepEqual(reviewing.rows.filter((r) => r.reviewing).map((r) => r.seq), [58]);
  const early = logVm(makePv({ presented: state.final(), tl: tlOf(timeline.final(), 100) }));
  assert.equal(early.rows[0].tlSeq, null, "a snap whose row isn't drawn yet has no link");
});
