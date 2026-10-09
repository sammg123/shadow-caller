// model/vm-scrub.js (owner W5; ui-architecture.md v1.4, 19): the replay scrub's view model. The game so far as one
// strip of slots (one per timeline row), drawn drives as seq ranges, scores, turnovers and quarter starts as marks,
// and the knob: the reviewed play, or the live edge. Review only: nothing here ever reaches the server.
import test from "node:test";
import assert from "node:assert/strict";
import { SCRUB, WATCH } from "../../static/js/model/copy.js";
import { describePlay, scrubVm, seqAtFraction, stepFrom } from "../../static/js/model/vm-scrub.js";
import { playLabel } from "../../static/js/field/play-label.js";
import { isDeepFrozen, makePv, rowBySeq, timeline, tlOf } from "./model-fixtures.mjs";

const FINAL = () => timeline.final();
const AT104 = () => timeline.at104();
const watching = (over = {}) => ({ watch: { state: "playing", event_id: "401872980", speed: 10, idx: 104, total: 183,
  next_at: null, error: null, ...over } });

/** The finished game, every row drawn, reviewing `seq` (null = live). */
const finalVm = (seq = null) => scrubVm(makePv({ tl: tlOf(FINAL()), view: { review: { seq } } }));
/** A watch 104 plays in, as the field has drawn them. */
const watchVm = (seq = null, drawn = 104) => scrubVm(makePv({ tl: tlOf(AT104(), drawn), version: watching(),
  view: { review: { seq } } }));

test("describePlay: when, who, then the play's own words from the field label", () => {
  const td = rowBySeq(FINAL(), 12);
  assert.equal(describePlay(td), `Q1 10:51 · DAL · ${playLabel(td)}`);
  assert.match(describePlay(td), /TD/);
  const kick = rowBySeq(FINAL(), 1);
  assert.equal(describePlay(kick), `Q1 15:00 · DAL · ${playLabel(kick)}`);
  assert.equal(describePlay(rowBySeq(FINAL(), 13)), "", "an admin row is not a play");
  assert.equal(describePlay(null), "");
});

test("a finished game: one slot per row, the knob at the live edge, and 156 plays to review", () => {
  const vm = finalVm();
  assert.equal(vm.available, true);
  assert.equal(vm.empty, false);
  assert.equal(vm.session, false);
  assert.equal(vm.total, 183);
  assert.equal(vm.lastSeq, 183);
  assert.equal(vm.liveSeq, 182, "the last kneel; row 183 is the end of the game");
  assert.equal(vm.plays.length, 156);
  assert.equal(vm.plays.every((p) => Number.isInteger(p.seq) && p.text && p.head && p.label), true);
  const kneel = vm.plays.at(-1);
  assert.deepEqual([kneel.head, kneel.label], ["Q4 0:31 · TB", playLabel(rowBySeq(FINAL(), 182))]);
  assert.equal(kneel.text, `${kneel.head} · ${kneel.label}`);
  assert.equal(vm.reviewing, false);
  assert.equal(vm.knobSeq, 182);
  assert.equal(vm.knobAt, 1, "live: the knob rides the front of the lit strip");
  assert.equal(vm.headAt, 1);
  assert.deepEqual({ ...vm.value }, { now: 156, max: 156, text: `${SCRUB.live}: ${vm.plays[155].text.replaceAll(" · ", ", ")}` });
  const last = vm.plays[155];
  assert.deepEqual({ ...vm.readout }, { state: "live", word: SCRUB.live, title: "", head: last.head, label: last.label,
    text: last.text });
  assert.equal(vm.canEarlier, true);
  assert.equal(vm.canLive, false);
});

test("drives: every drawn drive as a seq range with its team, the caller's or not, and its slot fractions", () => {
  const vm = finalVm();
  assert.equal(vm.drives.length, 21);
  const first = vm.drives[0];
  assert.deepEqual([first.idx, first.team, first.caller, first.first, first.last], [1, "DAL", true, 1, 13]);
  assert.equal(first.from, 0);
  assert.equal(first.to, Number((13 / 183).toFixed(5)));
  const second = vm.drives[1];
  assert.deepEqual([second.idx, second.team, second.caller, second.first, second.last], [2, "TB", false, 14, 36]);
  assert.deepEqual(vm.drives.map((d) => d.team).slice(0, 4), ["DAL", "TB", "DAL", "TB"]);
  assert.equal(vm.drives.every((d, i) => i === 0 || d.from >= vm.drives[i - 1].to), true, "drives never overlap");
});

test("marks: each score in the scoring team's tone, each turnover, and each new quarter", () => {
  const vm = finalVm();
  const of = (kind) => vm.marks.filter((m) => m.kind === kind);
  assert.deepEqual(of("score").map((m) => [m.seq, m.team, m.caller]),
    [[12, "DAL", true], [35, "TB", false], [87, "DAL", true], [96, "TB", false], [111, "TB", false],
      [123, "TB", false], [159, "DAL", true]]);
  assert.deepEqual(of("turnover").map((m) => m.seq), [104, 113, 176]);
  assert.deepEqual(of("quarter").map((m) => [m.seq, m.text]), [[34, "Q2"], [94, "Q3"], [136, "Q4"]]);
  assert.equal(vm.marks.every((m) => m.at > 0 && m.at < 1), true);
  assert.equal(new Set(vm.marks.map((m) => m.key)).size, vm.marks.length, "keys are unique");
  assert.equal(of("score")[0].at, Number((11.5 / 183).toFixed(5)), "a mark sits at its slot's center");
});

test("a watch: the strip runs to the session's total, and nothing past the field is on it (DC E5)", () => {
  const vm = watchVm();
  assert.equal(vm.session, true);
  assert.equal(vm.total, 183);
  assert.equal(vm.lastSeq, 104);
  assert.equal(vm.headAt, Number((104 / 183).toFixed(5)));
  assert.equal(vm.knobAt, vm.headAt);
  assert.equal(vm.drives.at(-1).last, 104);
  assert.equal(vm.readout.title, WATCH.start, "during a session the board names the mode when it shows nothing else");
  assert.equal(vm.marks.some((m) => m.seq > 104), false, "no score from the unplayed part of the game");
  assert.deepEqual(vm.marks.filter((m) => m.kind === "score").map((m) => m.seq), [12, 35, 87, 96]);
});

test("a watch the field has not caught up with: the strip ends at the drawn row, not the server's", () => {
  const vm = watchVm(null, 100);
  assert.equal(vm.lastSeq, 100);
  assert.equal(vm.liveSeq, 100);
  assert.equal(vm.plays.at(-1).seq, 100);
});

test("review: the knob moves to the reviewed play and the LIVE key wakes up", () => {
  const vm = finalVm(12);
  assert.equal(vm.reviewing, true);
  assert.equal(vm.reviewSeq, 12);
  assert.equal(vm.knobSeq, 12);
  assert.equal(vm.knobAt, Number((11.5 / 183).toFixed(5)));
  assert.equal(vm.value.now, 12, "rows 1 to 12 are all plays");
  assert.equal(vm.value.max, 156);
  assert.equal(vm.readout.state, "review");
  assert.equal(vm.readout.word, SCRUB.review);
  assert.equal(vm.readout.text, describePlay(rowBySeq(FINAL(), 12)));
  assert.equal(vm.readout.head, "Q1 10:51 · DAL");
  assert.equal(vm.readout.label, playLabel(rowBySeq(FINAL(), 12)));
  assert.match(vm.value.text, new RegExp(`^${SCRUB.review}: Q1 10:51, DAL, `));
  assert.equal(vm.canLive, true);
  assert.equal(vm.canEarlier, true);
});

test("review on the first play: nothing earlier", () => {
  const vm = finalVm(1);
  assert.equal(vm.value.now, 1);
  assert.equal(vm.canEarlier, false);
});

test("a review cursor that is not a drawn play keeps review on, with the knob on the play before it", () => {
  const vm = finalVm(13);
  assert.equal(vm.reviewing, true);
  assert.equal(vm.knobSeq, 12);
  assert.equal(vm.canLive, true);
});

test("empty: a watch that has drawn nothing yet shows an unlit strip and no knob", () => {
  const vm = scrubVm(makePv({ tl: tlOf(AT104(), 0), version: watching({ idx: 0 }) }));
  assert.equal(vm.available, true);
  assert.equal(vm.empty, true);
  assert.equal(vm.total, 183);
  assert.deepEqual([vm.plays.length, vm.drives.length, vm.marks.length], [0, 0, 0]);
  assert.equal(vm.knobSeq, null);
  assert.equal(vm.headAt, 0);
  assert.deepEqual({ ...vm.readout }, { state: "empty", word: "", title: WATCH.start, head: "", label: SCRUB.none,
    text: SCRUB.none });
  assert.deepEqual({ ...vm.value }, { now: 0, max: 0, text: SCRUB.none });
  assert.equal(vm.canEarlier, false);
  assert.equal(vm.canLive, false);
});

test("no timeline at all (boot, an old server): nothing to show", () => {
  const vm = scrubVm(makePv({}));
  assert.equal(vm.available, false);
  assert.equal(vm.empty, true);
  assert.equal(scrubVm(null).available, false);
  assert.equal(scrubVm(makePv({ tl: tlOf(AT104(), 0) })).available, false, "no rows and no session");
});

test("the view model is frozen and never mutates its (frozen) input", () => {
  assert.ok(isDeepFrozen(finalVm(12)));
  assert.ok(isDeepFrozen(watchVm()));
  assert.ok(isDeepFrozen(scrubVm(makePv({}))));
});

test("seqAtFraction: the nearest play to the slot under the pointer; past the newest drawn row, live (null)", () => {
  const fin = finalVm();
  assert.equal(seqAtFraction(fin, 0), 1);
  assert.equal(seqAtFraction(fin, -3), 1, "clamped");
  assert.equal(seqAtFraction(fin, 11.5 / 183), 12);
  assert.equal(seqAtFraction(fin, 12.5 / 183), 12, "row 13 is a timeout: the play before wins a tie");
  assert.equal(seqAtFraction(fin, 1), 182, "the end of the game is admin: the last kneel");
  assert.equal(seqAtFraction(fin, 7), 182, "clamped");
  const w = watchVm();
  assert.equal(seqAtFraction(w, 103.5 / 183), 104);
  assert.equal(seqAtFraction(w, 0.9), null, "the unplayed part of the strip is the LIVE detent");
  assert.equal(seqAtFraction(scrubVm(makePv({ tl: tlOf(AT104(), 0), version: watching() })), 0.5), null);
  assert.equal(seqAtFraction(fin, Number.NaN), null);
});

test("stepFrom: Left reviews the newest play, then earlier ones; Right walks back to live, never past it", () => {
  assert.equal(stepFrom(finalVm(), -1), 182);
  assert.equal(stepFrom(finalVm(12), -1), 11);
  assert.equal(stepFrom(finalVm(1), -1), 1, "the first play holds");
  assert.equal(stepFrom(finalVm(12), 1), 14, "the timeout at 13 is skipped");
  assert.equal(stepFrom(finalVm(182), 1), null, "past the newest play: live");
  assert.equal(stepFrom(finalVm(), 1), null, "live stays live: the scrub never steps the server");
  assert.equal(stepFrom(finalVm(12), 0), 12);
});

test("stepFrom by drive: PageUp to this drive's first play, then the drive before; PageDown to the next, then live", () => {
  const by = { byDrive: true };
  assert.equal(stepFrom(finalVm(20), -1, by), 14);
  assert.equal(stepFrom(finalVm(14), -1, by), 1);
  assert.equal(stepFrom(finalVm(1), -1, by), 1);
  assert.equal(stepFrom(finalVm(14), 1, by), 37);
  assert.equal(stepFrom(finalVm(181), 1, by), null, "the last drive: live");
  assert.equal(stepFrom(finalVm(), -1, by), 177, "from live: the newest drive's first play");
  assert.equal(stepFrom(finalVm(), 1, by), null);
});

test("edges: Home and End through stepFrom's limits", () => {
  assert.equal(stepFrom(finalVm(50), -Infinity), 1);
  assert.equal(stepFrom(finalVm(50), Infinity), null);
  const empty = scrubVm(makePv({ tl: tlOf(AT104(), 0), version: watching() }));
  assert.equal(stepFrom(empty, -1), null);
  assert.equal(stepFrom(empty, -1, { byDrive: true }), null);
});

test("copy: the scrub's words live in copy.js (v1.4, W5)", () => {
  assert.ok(Object.isFrozen(SCRUB));
  assert.equal(SCRUB.label, "Replay");
  assert.equal(SCRUB.track, "Review a play");
  assert.equal(SCRUB.live, "Live");
  assert.equal(SCRUB.review, "Review");
  assert.equal(SCRUB.none, "No plays yet");
  assert.equal(SCRUB.play("Q2 8:41", "DAL", "Deep pass left · +21"), "Q2 8:41 · DAL · Deep pass left · +21");
  assert.equal(SCRUB.play("", "DAL", "Kneel · −1"), "DAL · Kneel · −1");
});

test("without team colors (manual mode, DC D) the caller is the offense of any caller snap", () => {
  const body = FINAL();
  const tl = tlOf({ ...body, teams: null, drives: [] });
  const vm = scrubVm(makePv({ tl }));
  assert.deepEqual(vm.drives.slice(0, 2).map((d) => [d.team, d.caller]), [["DAL", true], ["TB", false]]);
  assert.equal(vm.marks.find((m) => m.kind === "score" && m.seq === 12).caller, true);
});
