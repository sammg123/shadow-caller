// model/vm-log.js: a logged call's own words, which the card's PREVIOUS PLAY reads when the field has not drawn its
// row (the play log itself moved to the Model Report's calls table, restructure-v2.md 6).
import test from "node:test";
import assert from "node:assert/strict";
import { actualText } from "../../static/js/model/vm-log.js";
import { state } from "./model-fixtures.mjs";

test("the logged name, then the touchdown and the turnover (FI 3.9)", () => {
  const last = state.final().log[0];
  assert.equal(actualText(last), "Short (0–9 air yds), turnover");
  assert.equal(actualText({ ...last, turnover: false, td: true }), "Short (0–9 air yds), TD");
  assert.equal(actualText({ ...last, turnover: false }), "Short (0–9 air yds)");
});

test("a call a flag wiped out keeps its logged words (#108)", () => {
  const wiped = state.final().log.filter((r) => r.nullified);
  assert.equal(wiped.length, 4);
  assert.ok(wiped.every((r) => actualText(r).includes("(no play")));
});

test("a pass with no type, legacy calls and a row with no name (#80)", () => {
  const base = state.tilt().log[0];
  assert.equal(actualText({ ...base, name: "Pass", call: "P", turnover: true }), "Pass, turnover");
  assert.equal(actualText({ ...base, name: null, call: "R", td: true }), "Run, TD");
  assert.equal(actualText({ ...base, name: null, call: "SC", td: false }), "Scramble");
  assert.equal(actualText({ seq: 1 }), "");
});
