import test from "node:test";
import assert from "node:assert/strict";
import { reviewVm } from "../../static/js/model/vm-review.js";
import { makePv, timeline, tlOf, isDeepFrozen } from "./model-fixtures.mjs";

const pvAt = (seq) => makePv({ tl: tlOf(timeline.final()), view: { review: { seq } } });

test("at the live edge there is no review", () => {
  assert.deepEqual({ ...reviewVm(pvAt(null)) }, { active: false, seq: null, text: "" });
});

test("reviewing a snap names the moment and the way back", () => {
  const vm = reviewVm(pvAt(104));
  assert.deepEqual([vm.active, vm.seq], [true, 104]);
  assert.equal(vm.text, "Reviewing DAL, Q3 10:51, 3rd & 3 at TB 27. Esc returns to live.");
});

test("kickoffs have no down, so the kind names them", () => {
  assert.equal(reviewVm(pvAt(1)).text, "Reviewing DAL, Q1 15:00, kickoff. Esc returns to live.");
});

test("a seq the screen has not drawn still reads sensibly", () => {
  assert.equal(reviewVm(makePv({ view: { review: { seq: 7 } } })).text, "Reviewing play 7. Esc returns to live.");
  assert.ok(isDeepFrozen(reviewVm(pvAt(104))));
});
