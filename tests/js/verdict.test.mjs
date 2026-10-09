import test from "node:test";
import assert from "node:assert/strict";
import { verdictOf, verdictText } from "../../static/js/model/verdict.js";
import { timeline, rowBySeq, state } from "./model-fixtures.mjs";

const pred = (seq) => rowBySeq(timeline.final(), seq).pred;

test("a specific play ranked 3 is in his top 3 (first DAL snap, DC B2)", () => {
  assert.deepEqual({ ...verdictOf(pred(2)) }, { level: "leaf", rank: 3, top1: false, top3: true, key: "top3" });
});

test("rank 1 is the top pick and rank 11 is a miss", () => {
  assert.equal(verdictOf(pred(3)).key, "top1");
  assert.equal(verdictOf(pred(7)).key, "miss");
  assert.equal(verdictOf(pred(7)).rank, 11);
});

test("nullified snaps are still graded (the call still counts)", () => {
  assert.equal(verdictOf(pred(8)).key, "miss");
  assert.equal(verdictOf(pred(10)).key, "top3");
});

test("verdict counts over the replayed game equal the scorecard", () => {
  const metrics = state.final().metrics.granular;
  const keys = timeline.final().rows.filter((r) => r.pred).map((r) => verdictOf(r.pred).key);
  const count = (k) => keys.filter((x) => x === k).length;
  assert.equal(count("top1"), metrics.leaf_top1);
  assert.equal(count("top1") + count("top3"), metrics.leaf_top3);
  assert.equal(count("miss"), metrics.leaf_n - metrics.leaf_top3);
});

test("without a specific play the family decides, and only a hit counts", () => {
  const base = { ...pred(3), leaf: null, leaf_rank: null, leaf_p: null };
  assert.deepEqual({ ...verdictOf({ ...base, fam_top: "dropback", family: "dropback" }) },
    { level: "family", rank: null, top1: true, top3: true, key: "top1" });
  assert.equal(verdictOf({ ...base, fam_top: "run", family: "dropback" }).key, "miss");
  assert.equal(verdictOf({ ...base, fam_top: "run", family: "dropback" }).top3, false);
});

test("a pass with no type (shorthand I) is graded on pass versus run", () => {
  const base = { ...pred(3), leaf: null, leaf_rank: null, family: null, fam_top: "dropback", dropback: 1 };
  assert.equal(verdictOf({ ...base, p: 0.62 }).level, "passrun");
  assert.equal(verdictOf({ ...base, p: 0.62 }).key, "top1");
  assert.equal(verdictOf({ ...base, p: 0.4 }).key, "miss");
  assert.equal(verdictOf({ ...base, p: 0.4, dropback: 0 }).key, "top1");
});

test("no prediction, or nothing to grade, gives none", () => {
  assert.deepEqual({ ...verdictOf(null) }, { level: null, rank: null, top1: false, top3: false, key: "none" });
  assert.equal(verdictOf({ p: 0.5, dropback: null, family: null, leaf_rank: null }).key, "none");
  assert.ok(Object.isFrozen(verdictOf(pred(2))));
});

test("verdictText words for the play feed", () => {
  assert.equal(verdictText("top1"), "Top pick");
  assert.equal(verdictText("top3"), "In his top 3");
  assert.equal(verdictText("miss"), "Miss");
  assert.equal(verdictText("none"), "");
  assert.equal(verdictText("bogus"), "");
});
