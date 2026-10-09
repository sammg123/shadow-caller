import test from "node:test";
import assert from "node:assert/strict";
import { drivesVm } from "../../static/js/model/vm-drives.js";
import { makePv, state, timeline, tlOf, patch, isDeepFrozen } from "./model-fixtures.mjs";

const finalVm = () => drivesVm(makePv({ presented: state.final(), tl: tlOf(timeline.final()) }));
const pick = (d) => [d.idx, d.team, d.caller, d.dir, d.x0, d.x1, d.resultText, d.complete, d.plays, d.yards, d.time];

test("21 drives with ESPN's results in order (DC G17)", () => {
  const vm = finalVm();
  assert.equal(vm.drives.length, 21);
  assert.deepEqual(vm.drives.map((d) => d.result), [
    "TD", "TD", "PUNT", "PUNT", "PUNT", "PUNT", "PUNT", "PUNT", "FG", "END OF HALF", "TD", "INT", "TD", "FUMBLE",
    "FG", "DOWNS", "DOWNS", "TD", "PUNT", "INT", "END OF GAME",
  ]);
  assert.equal(vm.heading, "Drives");
});

test("segments on the 100-yard scale, each in its team's direction", () => {
  const vm = finalVm();
  assert.deepEqual(pick(vm.drives[0]), [1, "DAL", true, 1, 30, 100, "TD", true, 9, 70, "4:09"]);
  assert.deepEqual(pick(vm.drives[1]), [2, "TB", false, -1, 73, 0, "TD", true, 15, 73, "10:58"]);
  assert.deepEqual(pick(vm.drives[9]), [10, "TB", false, -1, 71, 56, "END OF HALF", true, 3, 34, "0:21"]);
  assert.deepEqual({ ...vm.drives[1].span }, { lo: 0, hi: 73 });
});

test("the 0-play fumble drive sits at its return spot (DC C3, drive 14)", () => {
  const d = finalVm().drives[13];
  assert.deepEqual(pick(d), [14, "DAL", true, 1, 28, 28, "FUMBLE", true, 0, 0, "0:07"]);
  assert.equal(d.summary, "0 plays, 0 yds, 0:07");
});

test("summaries in plain words", () => {
  const vm = finalVm();
  assert.equal(vm.drives[0].summary, "9 plays, 70 yds, 4:09");
  assert.equal(vm.drives[0].label, "DAL TD");
  assert.equal(vm.drives.filter((d) => d.current).length, 0);
});

test("a drive in progress ends at the last row's next spot (100 plays in)", () => {
  const body = timeline.at104();
  // drive 12 as the server reports it after 100 plays (timeline.py on the same game): 2 snaps, 7 yards so far
  const drives = body.drives.map((d) => (d.idx === 12 ? { ...d, complete: false, end: null, result: null,
    result_text: null, time: null, time_s: null, yards: 7, plays: 2, seq: [98, 100] } : d));
  const tl = tlOf(patch(body, { drives }), 100);
  const d = drivesVm(makePv({ presented: state.final(), tl })).drives[11];
  assert.deepEqual(pick(d), [12, "DAL", true, 1, 32, 39, "", false, 2, 7, null]);
  assert.equal(d.current, true);
  assert.equal(d.summary, "2 plays, 7 yds");
});

test("unknown result codes fall back to ESPN's words; spots are clamped to the field", () => {
  const body = timeline.final();
  const drives = body.drives.map((d, i) => (i === 0 ? { ...d, result: "WEIRD", result_text: "Weird thing",
    start: { ...d.start, x: -5 } } : d));
  const d = drivesVm(makePv({ tl: tlOf(patch(body, { drives })) })).drives[0];
  assert.equal(d.resultText, "Weird thing");
  assert.equal(d.x0, 0);
});

test("hand-entered drives show the engine's results", () => {
  const body = timeline.final();
  const drives = [{ idx: 1, id: null, team: "DAL", offense_is_caller: true, start: { qtr: 1, clock: "15:00", x: 25 },
    end: { qtr: 1, clock: "12:00", x: 40 }, plays: 4, yards: 15, time: null, time_s: null, result: "TURNOVER",
    result_text: "TURNOVER", complete: true, seq: [1, 4], engine_drive: 1 }];
  const d = drivesVm(makePv({ tl: tlOf(patch(body, { drives, rows: [] })) })).drives[0];
  assert.deepEqual([d.x0, d.x1, d.resultText, d.summary], [25, 40, "TURNOVER", "4 plays, 15 yds"]);
});

test("no timeline yet gives no drives; output is deep-frozen", () => {
  assert.deepEqual([...drivesVm(makePv()).drives], []);
  assert.ok(isDeepFrozen(finalVm()));
});

test("an in-progress drive with no drawn rows uses its yards; a drive without a start stays put", () => {
  const body = timeline.final();
  const drives = [
    { ...body.drives[0], complete: false, end: null, result: null, result_text: null, time: null, yards: 12 },
    { ...body.drives[1], start: null, complete: false, end: null, yards: null, time: 7 },
  ];
  const vm = drivesVm(makePv({ tl: tlOf(patch(body, { drives, rows: [] })) }));
  assert.deepEqual([vm.drives[0].x0, vm.drives[0].x1, vm.drives[0].label], [30, 42, "DAL drive"]);
  assert.deepEqual([vm.drives[1].x0, vm.drives[1].x1, vm.drives[1].summary], [null, null, "15 plays"]);
  assert.deepEqual({ ...vm.drives[1].span }, { lo: null, hi: null });
});

// v1.2 (A8, additive): a drive button reviews its first drawn snap; the drive holding the reviewed row is marked.
test("each drive knows its first drawn snap, and which drive holds the reviewed play", () => {
  const live = finalVm();
  assert.equal(live.reviewSeq, null);
  assert.deepEqual(live.drives.slice(0, 3).map((d) => d.firstSeq), [1, 14, 37], "kickoffs draw, so they count");
  assert.equal(live.drives.some((d) => d.reviewing), false);
  const vm = drivesVm(makePv({ presented: state.final(), tl: tlOf(timeline.final()), view: { review: { seq: 104 } } }));
  assert.equal(vm.reviewSeq, 104);
  assert.deepEqual(vm.drives.filter((d) => d.reviewing).map((d) => d.idx), [12]);
  const early = drivesVm(makePv({ tl: tlOf(timeline.final(), 13) }));
  assert.equal(early.drives[1].firstSeq, null, "a drive with no drawn row has nothing to review yet");
});
