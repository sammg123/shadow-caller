import assert from "node:assert/strict";
import test from "node:test";

import { drawableSeqs, stepReview } from "../../static/js/core/review.js";
import { deepFreeze, loadTimeline } from "./fixtures.mjs";

const ROWS = deepFreeze([1, 2, 3, 4, 5, 6, 7, 8].map((seq) => ({ seq, kind: seq === 5 ? "admin" : "play" })));
const at = (reviewSeq, watchState = "idle", drawnThrough = 7) => ({ reviewSeq, rows: ROWS, drawnThrough, watchState });

test("drawableSeqs skips admin rows and rows not drawn yet", () => {
  assert.deepEqual(drawableSeqs(ROWS, 7), [1, 2, 3, 4, 6, 7]);
  assert.deepEqual(drawableSeqs(ROWS, 0), []);
  const { rows } = loadTimeline();
  const real = rows(100, 108);
  assert.deepEqual(drawableSeqs(real, 108), [100, 101, 102, 103, 104, 106, 107, 108], "row 105 is a timeout");
});

test("Left walks back from the live edge and stops at the first row", () => {
  assert.deepEqual(stepReview(at(null), -1), { reviewSeq: 7, effect: null });
  assert.deepEqual(stepReview(at(7), -1), { reviewSeq: 6, effect: null });
  assert.deepEqual(stepReview(at(6), -1), { reviewSeq: 4, effect: null }, "the timeout is skipped");
  assert.deepEqual(stepReview(at(1), -1), { reviewSeq: 1, effect: null });
});

test("Right walks forward and returns to live past the newest row", () => {
  assert.deepEqual(stepReview(at(4), 1), { reviewSeq: 6, effect: null });
  assert.deepEqual(stepReview(at(7), 1), { reviewSeq: null, effect: null });
});

test("Right at the live edge steps the watch: paused steps, playing pauses then steps, else nothing", () => {
  assert.deepEqual(stepReview(at(null, "paused"), 1), { reviewSeq: null, effect: "server-step" });
  assert.deepEqual(stepReview(at(null, "playing"), 1), { reviewSeq: null, effect: "pause-then-step" });
  for (const ws of ["idle", "done", "stopped", "error", undefined]) {
    assert.deepEqual(stepReview(at(null, ws), 1), { reviewSeq: null, effect: null }, String(ws));
  }
});

test("a reviewed seq that is not drawable still steps to its neighbours; no rows means no review", () => {
  assert.deepEqual(stepReview(at(5), -1), { reviewSeq: 4, effect: null });
  assert.deepEqual(stepReview(at(5), 1), { reviewSeq: 6, effect: null });
  assert.deepEqual(stepReview(at(null, "idle", 0), -1), { reviewSeq: null, effect: null });
  assert.deepEqual(stepReview(at(3), 0), { reviewSeq: 3, effect: null }, "a bad delta changes nothing");
});
