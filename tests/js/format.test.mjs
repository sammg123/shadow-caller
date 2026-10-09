import test from "node:test";
import assert from "node:assert/strict";
import {
  DASH, pct, pct1, ord, signed1, fixed, intText, spotText, downDistance, situationText, clockText, qtrText,
  signedInt, resultText, capitalize, freezeDeep,
} from "../../static/js/model/format.js";
import { timeline, rowBySeq, isDeepFrozen } from "./model-fixtures.mjs";

const row = (seq) => rowBySeq(timeline.final(), seq);

test("pct rounds to whole percents and shows a dash for missing numbers", () => {
  assert.equal(pct(0.4562), "46%");
  assert.equal(pct(0.847457627118644), "85%");
  assert.equal(pct(1), "100%");
  assert.equal(pct(0), "0%");
  assert.equal(pct(null), DASH);
  assert.equal(pct(Number.NaN), DASH);
  assert.equal(DASH, "—");
});

test("pct1 keeps one decimal under 10% and never prints 10.0%", () => {
  assert.equal(pct1(0.14), "14%");
  assert.equal(pct1(0.04938049286708704), "4.9%");
  assert.equal(pct1(0.001), "0.1%");
  assert.equal(pct1(0), "0.0%");
  assert.equal(pct1(0.0996), "10%");
  assert.equal(pct1(undefined), DASH);
});

test("ord gives the down ordinal and nothing for unknown downs", () => {
  assert.deepEqual([1, 2, 3, 4].map(ord), ["1st", "2nd", "3rd", "4th"]);
  assert.equal(ord(0), "");
  assert.equal(ord(5), "");
  assert.equal(ord(null), "");
});

test("signed1 always shows one decimal (G23)", () => {
  assert.equal(signed1(16.5), "+16.5");
  assert.equal(signed1(10), "+10.0");
  assert.equal(signed1(-4.9), "-4.9");
  assert.equal(signed1(0), "+0.0");
  assert.equal(signed1(-0.04), "+0.0");
  assert.equal(signed1(null), "");
});

test("fixed prints a set number of decimals", () => {
  assert.equal(fixed(0.42141910755796, 3), "0.421");
  assert.equal(fixed(1.618005365640994, 2), "1.62");
  assert.equal(fixed(null, 2), DASH);
});

test("intText groups thousands without depending on the locale", () => {
  assert.equal(intText(1351), "1,351");
  assert.equal(intText(1270), "1,270");
  assert.equal(intText(21), "21");
  assert.equal(intText(1234567), "1,234,567");
  assert.equal(intText(-1351), "-1,351");
  assert.equal(intText("x"), DASH);
});

test("spotText names the side of the field like the play log", () => {
  assert.equal(spotText(70, "DAL", "TB"), "DAL 30");
  assert.equal(spotText(8, "DAL", "TB"), "TB 8");
  assert.equal(spotText(50, "DAL", "TB"), "50");
  assert.equal(spotText(null, "DAL", "TB"), "");
});

test("downDistance says Goal when the distance reaches the goal line (G16)", () => {
  assert.equal(downDistance(1, 10, 75), "1st & 10");
  assert.equal(downDistance(1, 8, 8), "1st & Goal");
  assert.equal(downDistance(2, 4, 4), "2nd & Goal");
  assert.equal(downDistance(null, 10, 75), "");
  assert.equal(situationText(1, 10, 75, "DAL", "TB"), "1st & 10 at DAL 25");
  assert.equal(situationText(1, 8, 8, "DAL", "TB"), "1st & Goal at TB 8");
  assert.equal(situationText(null, 8, 8, "DAL", "TB"), "");
});

test("clockText formats game seconds and passes M:SS strings through", () => {
  assert.equal(clockText(900), "15:00");
  assert.equal(clockText(0), "0:00");
  assert.equal(clockText(53), "0:53");
  assert.equal(clockText(866), "14:26");
  assert.equal(clockText("14:54"), "14:54");
  assert.equal(clockText("abc"), "");
  assert.equal(clockText(null), "");
});

test("qtrText names quarters and overtime", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(qtrText), ["Q1", "Q2", "Q3", "Q4", "OT", "2OT"]);
  assert.equal(qtrText(null), "");
});

test("signedInt signs gains and losses", () => {
  assert.equal(signedInt(8), "+8");
  assert.equal(signedInt(-11), "-11");
  assert.equal(signedInt(0), "0");
  assert.equal(signedInt(null), "");
});

test("resultText reads real rows of the saved game", () => {
  assert.equal(resultText(row(2)), "INC");
  assert.equal(resultText(row(3)), "+8");
  assert.equal(resultText(row(114)), "-11");
  assert.equal(resultText(row(8)), "FLAG");
  assert.equal(resultText(row(34)), "FLAG");
  assert.equal(resultText(row(12)), "TD");
  assert.equal(resultText(row(104)), "INT");
  assert.equal(resultText(row(113)), "FUMBLE");
  assert.equal(resultText(row(43)), "PUNT 53");
  assert.equal(resultText(row(87)), "FG 41 GOOD");
  assert.equal(resultText(row(161)), "TOUCHBACK");
  assert.equal(resultText(row(1)), "KICKOFF 62");
  assert.equal(resultText(row(13)), "");
  assert.equal(resultText(row(181)), "-1");
});

test("resultText covers misses, safeties, return scores and hand-entered turnovers", () => {
  const base = row(87);
  assert.equal(resultText({ ...base, kind: "fg_miss", scoring: null, kick: { ...base.kick, good: false } }), "FG MISSED");
  const play = row(3);
  assert.equal(resultText({ ...play, result: { ...play.result, safety: true } }), "SAFETY");
  assert.equal(resultText({ ...row(104), scoring: { team: "TB", type: "TD", pts: 7 } }), "INT TD");
  assert.equal(resultText({ ...play, result: { ...play.result, turnover: true, turnover_kind: null } }), "TURNOVER");
  assert.equal(resultText({ ...play, result: { ...play.result, yards: 0 } }), "0");
  assert.equal(resultText({ ...row(1), scoring: { team: "DAL", type: "TD", pts: 7 } }), "TD");
  assert.equal(resultText({ ...row(43), result: { ...row(43).result, turnover: true } }), "FUMBLE");
  assert.equal(resultText({ ...row(43), kick: { ...row(43).kick, dist: null } }), "PUNT");
  assert.equal(resultText({ ...play, kind: "spike" }), "SPIKE");
  assert.equal(resultText(null), "");
});

test("resultText gives text for every row and nothing for admin rows", () => {
  for (const r of timeline.final().rows) {
    const text = resultText(r);
    assert.equal(typeof text, "string");
    assert.equal(text === "", r.kind === "admin", `seq ${r.seq} ${r.kind}`);
  }
});

test("capitalize lifts the first letter only", () => {
  assert.equal(capitalize("no edge"), "No edge");
  assert.equal(capitalize("lean run"), "Lean run");
  assert.equal(capitalize("TILT PASS"), "TILT PASS");
  assert.equal(capitalize(""), "");
  assert.equal(capitalize(null), "");
});

test("freezeDeep freezes nested objects and returns its argument", () => {
  const value = { a: [{ b: 1 }], c: { d: "x" } };
  assert.equal(freezeDeep(value), value);
  assert.ok(isDeepFrozen(value));
});
