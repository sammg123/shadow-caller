import test from "node:test";
import assert from "node:assert/strict";
import { playsVm } from "../../static/js/model/vm-plays.js";
import { makePv, state, timeline, tlOf, patch, isDeepFrozen } from "./model-fixtures.mjs";

const finalPv = (extra = {}) => makePv({ presented: state.final(), tl: tlOf(timeline.final()), ...extra });
const bySeq = (vm, seq) => vm.rows.find((r) => r.seq === seq);

test("every applied row, newest first; 64 caller snaps, 59 graded (DC G1)", () => {
  const vm = playsVm(finalPv());
  assert.equal(vm.rows.length, 183);
  assert.equal(vm.rows[0].seq, 183);
  assert.equal(vm.rows.filter((r) => r.caller).length, 64);
  assert.equal(vm.rows.filter((r) => r.verdict !== "none").length, 59);
  assert.equal(vm.heading, "Plays");
});

test("the first DAL snap reads like the contract row (DC B2)", () => {
  const row = bySeq(playsVm(finalPv()), 2);
  assert.deepEqual({ ...row }, {
    seq: 2, id: "40187298068", kind: "play", team: "DAL", caller: true, drive: 1, time: "Q1 14:54",
    situation: "1st & 10 at DAL 30", text: "D.Prescott pass incomplete short middle to B.Spann-Ford (C.Rozeboom).",
    result: "INC", call: "Short (0–9 air yds), incomplete", verdict: "top3", verdictText: "In his top 3",
    nullified: false, retagged: false, scoring: false, face: "Short pass middle · B.Spann-Ford",
  });
});

test("G5-10: the ribbon's face is the field's words for the play and who had the ball, never ESPN's whole text", () => {
  const vm = playsVm(finalPv());
  const face = (seq) => bySeq(vm, seq).face;
  assert.equal(face(3), "Short pass middle · J.Williams", "a pass names its target, not the passer");
  assert.equal(face(5), "Inside run (up the middle) · J.Williams", "a run names its runner");
  assert.equal(face(7), "Deep pass middle · G.Pickens");
  assert.equal(face(1), "Kickoff · return to DAL 30", "a kick keeps the field's whole label");
  assert.equal(face(8), "No play · defensive offside on TB", "so does a play a flag wiped out");
  assert.ok(vm.rows.every((r) => typeof r.face === "string"), "every row has one ('' when the field draws nothing)");
  assert.ok(vm.rows.filter((r) => r.face).every((r) => r.face.length <= 64), "one ribbon page, about 60 characters");
});

test("opponent snaps, kickoffs and admin rows carry no call or verdict", () => {
  const vm = playsVm(finalPv());
  const tb = bySeq(vm, 17);
  assert.deepEqual([tb.team, tb.caller, tb.call, tb.verdict, tb.verdictText, tb.result], ["TB", false, "", "none", "", "+5"]);
  const admin = bySeq(vm, 13);
  assert.deepEqual([admin.kind, admin.result, admin.situation, admin.text], ["admin", "", "", "Official Timeout at 10:51."]);
  assert.deepEqual([bySeq(vm, 1).situation, bySeq(vm, 1).result], ["", "KICKOFF 62"]);
});

test("verdicts across the game: 32 top picks, 15 more in his top 3, 12 misses", () => {
  const vm = playsVm(finalPv());
  const count = (k) => vm.rows.filter((r) => r.verdict === k).length;
  assert.deepEqual([count("top1"), count("top3"), count("miss")], [32, 15, 12]);
  assert.deepEqual([bySeq(vm, 3).verdictText, bySeq(vm, 7).verdictText], ["Top pick", "Miss"]);
});

test("nullified snaps keep their verdict and show the flag", () => {
  const row = bySeq(playsVm(finalPv()), 8);
  assert.deepEqual([row.nullified, row.result, row.verdict], [true, "FLAG", "miss"]);
});

test("7 scoring rows", () => {
  assert.equal(playsVm(finalPv()).rows.filter((r) => r.scoring).length, 7);
});

test("rows group by drive, newest drive first, with ESPN's result", () => {
  const vm = playsVm(finalPv());
  assert.equal(vm.groups.length, 21);
  assert.deepEqual([vm.groups[0].idx, vm.groups[0].team, vm.groups[0].resultText], [21, "TB", "END OF GAME"]);
  const first = vm.groups[vm.groups.length - 1];
  assert.deepEqual([first.idx, first.team, first.caller, first.resultText, first.summary],
    [1, "DAL", true, "TD", "9 plays, 70 yds, 4:09"]);
  assert.deepEqual(first.rows.map((r) => r.seq), [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  assert.equal(vm.groups.reduce((n, g) => n + g.rows.length, 0), 183);
});

test("hand-entered plays that are not on the field get a note (DC C1)", () => {
  const body = timeline.final();
  const one = playsVm(finalPv({ tl: tlOf(patch(body, { unlinked: [60] })) }));
  assert.equal(one.unlinkedNote, "1 hand-entered play isn't on the field");
  const two = playsVm(finalPv({ tl: tlOf(patch(body, { unlinked: [60, 61] })) }));
  assert.equal(two.unlinkedNote, "2 hand-entered plays aren't on the field");
  assert.equal(playsVm(finalPv()).unlinkedNote, "");
});

test("only rows already drawn appear (no spoilers on screen)", () => {
  const vm = playsVm(finalPv({ tl: tlOf(timeline.final(), 104) }));
  assert.equal(vm.rows[0].seq, 104);
  assert.equal(vm.rows.length, 104);
});

test("nothing presented yet gives an empty feed, deep-frozen", () => {
  const vm = playsVm(makePv());
  assert.deepEqual([vm.rows.length, vm.groups.length, vm.unlinkedNote], [0, 0, ""]);
  assert.ok(isDeepFrozen(playsVm(finalPv())));
});

test("the feed is read only (restructure-v2.md 1): no row offers a retag or a review", () => {
  const vm = playsVm(finalPv());
  for (const key of ["retag", "reviewable", "reviewing"]) assert.ok(vm.rows.every((r) => !(key in r)), key);
  assert.ok(!("retagSeq" in vm) && !("reviewSeq" in vm));
});
