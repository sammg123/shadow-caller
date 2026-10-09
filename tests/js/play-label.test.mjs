// field/play-label.js: the words drawn on the field for every play (docs/design/play-drawing.md section 3, binding),
// and the label model every field label is laid out with (a view's metrics, label boxes, the strokes to keep clear of).
import assert from "node:assert/strict";
import test from "node:test";

import { CAMERA_PRESETS, frameSituation, poseFor, projectToNdc } from "../../static/js/field/camera-plan.js";
import {
  LABEL_METRICS, LABEL_SEP, MINUS, labelBox, labelFootprint, labelMetrics, placeLabelText, playLabel,
  resolveLabelMetrics,
} from "../../static/js/field/play-label.js";
import { allRows, frozenCopy, manualRow, rowBySeq } from "./field-rows.mjs";

const bySeq = rowBySeq;

/** A real Dallas row with Sam's retag applied the way state.log copies it onto the cached row (DC B7). */
const retagged = (seq, family, leaf, patch = {}) => {
  const row = bySeq(seq);
  return { ...row, ...patch, pred: { ...row.pred, family, leaf, retagged: true } };
};

test("every example in play-drawing.md section 3 comes out exactly, from the real TB at DAL rows", () => {
  const table = [
    [2, "Short pass middle · incomplete"],                 // the first DAL snap
    [3, "Short pass middle · +8"],
    [7, "Deep pass middle · +21"],
    [101, "Short pass left · +27"],
    [159, "Deep pass left · TD"],                          // D.Prescott to G.Pickens, 18: ESPN's word, not the leaf
    [104, "Pass intercepted · short middle"],
    [5, "Inside run (up the middle) · +4"],
    [41, "Inside run (left guard) · −2"],
    [95, "Off-tackle left · +72"],                         // TB, B.Irving
    [28, "Outside run right · +2"],
    [96, "Outside run left · TD"],
    [114, "Sack · −11"],
    [17, "QB scramble right · +5"],
    [181, "Kneel · −1"],
    [43, "Punt · 53 yds · out of bounds"],
    [87, "FG 41 yds · good"],
    [161, "Kickoff · touchback"],
    [1, "Kickoff · return to DAL 30"],
    [8, "No play · defensive offside on TB"],
    [65, "Flag · false start on TB · −5"],
  ];
  for (const [seq, want] of table) assert.equal(playLabel(bySeq(seq)), want, `row ${seq}`);
});

test("losses carry the true minus sign (U+2212), and the separator is a spaced middle dot", () => {
  assert.equal(MINUS, "−");
  assert.equal(LABEL_SEP, " · ");
  assert.ok(playLabel(bySeq(114)).endsWith(`${MINUS}11`));
  assert.ok(!playLabel(bySeq(41)).includes("-"), "never the hyphen-minus");
});

test("a retag wins on Dallas plays: play-action, screen, RPO handoff and RPO throw (DC B7)", () => {
  assert.equal(playLabel(retagged(7, "pa", "pa_deep")), "Play-action deep pass middle · +21");
  assert.equal(playLabel(retagged(7, "pa", "pa_deep", { geo: { ...bySeq(7).geo, lat: "left" } })),
    "Play-action deep pass left · +21");
  assert.equal(playLabel(retagged(168, "screen", "screen")), "Screen · +6");
  assert.equal(playLabel(retagged(5, "rpo", "rpo_run")), "RPO handoff · +4");
  assert.equal(playLabel(retagged(100, "rpo", "rpo_throw")), "RPO throw · +9");
  assert.equal(playLabel(retagged(104, "pa", "pa_short")), "Play-action pass intercepted · short middle");
  assert.equal(playLabel(retagged(2, "screen", "screen")), "Screen · incomplete");
  assert.equal(playLabel(retagged(104, "rpo", "rpo_throw")), "RPO throw · INT");
});

test("a run retagged to another gap reads as the retag; an untouched run keeps ESPN's gap words", () => {
  assert.equal(playLabel(retagged(38, "run", "run_edge_left")), "Outside run left · +5", "ESPN said left tackle");
  assert.equal(playLabel(retagged(38, "run", "run_ot_left")), "Off-tackle left · +5", "the same leaf as ESPN's gap");
  assert.equal(playLabel(retagged(41, "run", "run_inside")), "Inside run (left guard) · −2");
  assert.equal(playLabel(bySeq(38)), "Off-tackle left · +5");
});

test("an untagged Dallas pass keeps ESPN's depth word even when the leaf's bucket differs", () => {
  assert.equal(bySeq(159).pred.leaf, "dropback_mid");
  assert.equal(playLabel(bySeq(159)), "Deep pass left · TD");
  assert.equal(bySeq(151).call.leaf, "dropback_mid");
  assert.equal(playLabel(bySeq(151)), "Short pass left · +15");
});

test("TB plays read the same way; no gain and losses after the catch are ESPN's words", () => {
  assert.equal(playLabel(bySeq(116)), "Deep pass left · +21");
  assert.equal(playLabel(bySeq(35)), "Short pass right · TD");
  assert.equal(playLabel(bySeq(120)), "Short pass left · −5");
  assert.equal(playLabel(bySeq(122)), "Short pass right · no gain");
  assert.equal(playLabel(bySeq(9)), "Inside run (up the middle) · no gain");
  assert.equal(playLabel(bySeq(99)), "Inside run (right guard) · −2");
  assert.equal(playLabel(bySeq(62)), "Off-tackle right · +11");
  assert.equal(playLabel(bySeq(78)), "Deep pass left · incomplete");
  assert.equal(playLabel(bySeq(20)), "QB scramble up the middle · +6");
  assert.equal(playLabel(bySeq(66)), "QB scramble left · +1");
  assert.equal(playLabel(bySeq(176)), "Pass intercepted · short middle");
});

test("rows typed by hand use the engine's leaf names", () => {
  const base = manualRow();
  assert.equal(playLabel(base), "Play-action short pass · +8");
  const with_ = (call, result = {}) => ({ ...base, call: { ...base.call, ...call }, result: { ...base.result, ...result } });
  assert.equal(playLabel(with_({ family: "dropback", leaf: "dropback_mid", depth: "mid" }, { yards: 12 })),
    "Intermediate pass · +12");
  assert.equal(playLabel(with_({ family: "dropback", leaf: "dropback_deep", depth: "deep", outcome: "incomplete" },
    { yards: 0 })), "Deep pass · incomplete");
  assert.equal(playLabel(with_({ family: "dropback", leaf: null, depth: null, outcome: "incomplete" }, { yards: 0 })),
    "Pass · incomplete");
  assert.equal(playLabel(with_({ family: "screen", leaf: "screen", depth: null }, { yards: 6 })), "Screen · +6");
  assert.equal(playLabel(with_({ family: "rpo", leaf: "rpo_run", depth: null }, { yards: 4 })), "RPO handoff · +4");
  assert.equal(playLabel(with_({ family: "rpo", leaf: "rpo_throw", depth: null }, { yards: 9 })), "RPO throw · +9");
  const run = (leaf) => ({ ...with_({ family: "run", leaf, depth: null }, { yards: 3 }),
    geo: { ...base.geo, lat: "left", gap: null } });
  assert.equal(playLabel(run("run_inside")), "Inside run · +3");
  assert.equal(playLabel(run("run_ot_left")), "Off-tackle left · +3");
  assert.equal(playLabel(run("run_edge_left")), "Outside run left · +3");
  assert.equal(playLabel(run("run_ot_right")), "Off-tackle right · +3");
  assert.equal(playLabel(run("run_edge_right")), "Outside run right · +3");
  assert.equal(playLabel(run(null)), "Run · +3");
  assert.equal(playLabel({ ...base, result: { ...base.result, nullified: true, penalty: { code: "OH" } } }),
    "No play · flag", "a typed flag has no foul words to show");
});

test("results: TD, safety, a lost fumble, a pick-six, and a turnover returned for a score", () => {
  const run = bySeq(95);
  const lost = { ...run, result: { ...run.result, yards: 10, turnover: true, turnover_kind: "fumble" } };
  assert.equal(playLabel(lost), "Off-tackle left · fumble lost");
  const scoop = { ...lost, scoring: { team: "DAL", type: "TD", pts: 7, pat: "kick_good" } };
  assert.equal(playLabel(scoop), "Off-tackle left · fumble lost · returned for TD");
  const sack = bySeq(114);
  assert.equal(playLabel({ ...sack, result: { ...sack.result, yards: -5, safety: true } }), "Sack · safety");
  const pick = bySeq(104);
  assert.equal(playLabel({ ...pick, scoring: { team: "TB", type: "TD", pts: 7, pat: "kick_good" } }),
    "Pass intercepted · short middle · returned for TD");
});

test("kicks read like ESPN: returns to a spot, fair catches, the distance, good or no good", () => {
  assert.equal(playLabel(bySeq(14)), "Kickoff · return to TB 27");
  assert.equal(playLabel(bySeq(113)), "Kickoff · fumble lost");
  assert.equal(playLabel(bySeq(94)), "Kickoff · return to TB 26 · flag: offensive holding on TB");
  assert.equal(playLabel(bySeq(56)), "Punt · 37 yds · fair catch");
  assert.equal(playLabel(bySeq(74)), "Punt · 46 yds · return to TB 48");
  assert.equal(playLabel(bySeq(48)), "Punt · 41 yds · downed · flag: offensive holding on DAL");
  assert.equal(playLabel(bySeq(123)), "FG 41 yds · good");
  const fg = bySeq(87);
  assert.equal(playLabel({ ...fg, kind: "fg_miss", kick: { ...fg.kick, good: false }, scoring: null }),
    "FG 41 yds · no good");
  assert.equal(playLabel({ ...fg, kind: "fg_miss", kick: { ...fg.kick, good: false, blocked: true }, scoring: null }),
    "FG 41 yds · blocked");
  const punt = bySeq(43);
  assert.equal(playLabel({ ...punt, kick: { ...punt.kick, blocked: true, oob: false, dist: null } }), "Punt · blocked");
  assert.equal(playLabel({ ...punt, kick: { ...punt.kick, oob: false, touchback: true } }), "Punt · 53 yds · touchback");
  const ko = bySeq(1);
  assert.equal(playLabel({ ...ko, scoring: { team: "DAL", type: "TD", pts: 7, pat: "kick_good" },
    geo: { ...ko.geo, x_end: 100, x_next: null }, kick: { ...ko.kick, ret_end_x: 100 } }), "Kickoff · returned for TD");
  assert.equal(playLabel({ ...ko, kick: { ...ko.kick, ret_end_x: null, ret_yards: null } }), "Kickoff · 62 yds");
});

test("flags: a no-play names the foul, a pre-snap flag adds its signed yards, a flag on a play that stands follows it", () => {
  assert.equal(playLabel(bySeq(10)), "No play · defensive pass interference on TB");
  assert.equal(playLabel(bySeq(24)), "No play · defensive holding on DAL");
  assert.equal(playLabel(bySeq(34)), "Flag · neutral zone infraction on DAL · +5", "on the defense: TB gains");
  assert.equal(playLabel(bySeq(83)), "Flag · neutral zone infraction on TB · +5");
  assert.equal(playLabel(bySeq(67)), "Flag · delay of game on TB · −5");
  assert.equal(playLabel(bySeq(58)), "Inside run (up the middle) · +2 · flag: face mask on DAL");
  const declined = bySeq(58);
  assert.equal(playLabel({ ...declined, result: { ...declined.result,
    penalty: { ...declined.result.penalty, status: "declined" } } }), "Inside run (up the middle) · +2");
});

test("every row of the game: admin rows have no label, every other row reads cleanly", () => {
  for (const row of allRows()) {
    const text = playLabel(row);
    if (row.kind === "admin") {
      assert.equal(text, "", row.seq);
      continue;
    }
    assert.ok(text.length > 0, `row ${row.seq} has a label`);
    assert.ok(!/undefined|null|NaN|\bnull\b/.test(text), `row ${row.seq}: ${text}`);
    assert.ok(!/ · $|^ · |  /.test(text), `row ${row.seq} is tidy: "${text}"`);
    assert.ok(text.length <= 64, `row ${row.seq} fits on the field: ${text.length}`);
  }
});

test("spikes, odd rows and junk", () => {
  const kneel = bySeq(181);
  assert.equal(playLabel({ ...kneel, kind: "spike", result: { ...kneel.result, yards: 0 } }), "Spike · clock stopped");
  assert.equal(playLabel({ ...kneel, kind: "other", result: { ...kneel.result, yards: -3 } }), "Play · −3");
  assert.equal(playLabel({ ...kneel, kind: "kneel", result: { ...kneel.result, yards: 0 } }), "Kneel · no gain");
  assert.equal(playLabel(null), "");
  assert.equal(playLabel({ kind: "admin" }), "");
  assert.equal(playLabel({ kind: "play" }), "Play");
  const odd = bySeq(3);
  assert.equal(playLabel({ ...odd, geo: { ...odd.geo, lat: "__proto__" }, call: { ...odd.call, depth: "toString" } }),
    "Short pass · +8", "server strings never reach a lookup's prototype");
});

test("playLabel never mutates its row", () => {
  for (const seq of [2, 8, 65, 104, 113, 159]) {
    const frozen = frozenCopy(bySeq(seq));
    assert.equal(playLabel(frozen), playLabel(bySeq(seq)));
  }
});

// ---------------------------------------------------------------- the label model
const C = 26.667;
const EPS = 1e-6;
const SIT = Object.freeze({ ballX: 30, ltgX: 40, dir: 1, poss: "DAL", kind: "snap" });
const near = (a, b, tol, label = "") => assert.ok(Math.abs(a - b) <= tol, `${label} ${a} != ${b}`);

/** A camera-plan view as a renderer would hand it over: field point -> screen pixels (y down). */
function viewOf(modeId, [w, h], sit = SIT) {
  const mode = CAMERA_PRESETS.find((m) => m.id === modeId);
  const pose = poseFor(frameSituation(sit), mode, { aspect: w / h });
  return (p) => {
    const n = projectToNdc(p, pose, w / h);
    return { x: ((n.x + 1) / 2) * w, y: ((1 - n.y) / 2) * h };
  };
}

test("the label model's default is the sideline cameras' view; every field is checked", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(LABEL_METRICS)),
    { charYd: 0.8, lineYd: 3.5, padYd: 0, down: { x: 0, y: -1 }, lifts: [2, 2.4, 3.1] });
  assert.ok(Object.isFrozen(LABEL_METRICS) && Object.isFrozen(LABEL_METRICS.down) && Object.isFrozen(LABEL_METRICS.lifts));
  assert.deepEqual(resolveLabelMetrics(null), resolveLabelMetrics(LABEL_METRICS));
  const odd = resolveLabelMetrics({ charYd: -1, lineYd: Number.NaN, padYd: -2, down: { x: 0.5, y: 0.5 },
    lifts: ["2", -1] });
  assert.deepEqual(JSON.parse(JSON.stringify(odd)), JSON.parse(JSON.stringify(LABEL_METRICS)), "bad fields: defaults");
  const endZone = resolveLabelMetrics({ charYd: 0.26, lineYd: 1.8, down: { x: -1, y: 0 }, lifts: [2.05] });
  assert.deepEqual([endZone.charYd, endZone.lineYd, endZone.down, [...endZone.lifts]],
    [0.26, 1.8, { x: -1, y: 0 }, [2.05]]);
});

test("labelMetrics measures a renderer's view: broadcast, the end zone (text across the field), a phone", () => {
  const view = viewOf("broadcast", [1440, 900]);
  const broadcast = labelMetrics(view, { x: 30, y: C });
  assert.deepEqual(broadcast.down, { x: 0, y: -1 }, "down the screen is toward the near sideline");
  near(broadcast.charYd, 7.2 / 27, 0.03, "7.2 px a character");
  const depthPx = view({ x: 30, y: C, h: 0 }).y - view({ x: 30, y: C + 1, h: 0 }).y;
  near(broadcast.lineYd * depthPx, 26, 1e-6, "a 22 px plate and 4 px between lines, in yards of foreshortened depth");
  near(broadcast.lifts[0], 2.3, 0.15, "a yard of height reads as about 2.3 yards of depth there");
  near(broadcast.padYd, 12 / 27, 0.05, "the plate's 12 px of padding");
  const endZone = labelMetrics(viewOf("endzone", [1440, 900]), { x: 30, y: C });
  assert.deepEqual(endZone.down, { x: -1, y: 0 }, "behind the offense, down the screen is back toward the camera");
  near(endZone.charYd, 7.2 / 27.3, 0.03, "text runs across the field");
  const away = labelMetrics(viewOf("endzone", [1440, 900], { ...SIT, ballX: 70, dir: -1 }), { x: 70, y: C });
  assert.deepEqual(away.down, { x: 1, y: 0 });
  const phone = labelMetrics(viewOf("broadcast", [390, 844]), { x: 30, y: C }, { charPx: 7.2, linePx: 22 });
  assert.ok(phone.lineYd > 5, `a phone's line is ${phone.lineYd} yards deep`);
  assert.ok(Object.isFrozen(phone));
  assert.equal(labelMetrics(null, { x: 30, y: C }), LABEL_METRICS);
  assert.equal(labelMetrics(() => ({ x: 5, y: 5 }), { x: 30, y: C }), LABEL_METRICS, "a degenerate view");
  assert.equal(labelMetrics(() => ({ x: Number.NaN, y: 0 }), { x: 30, y: C }), LABEL_METRICS);
  assert.equal(labelMetrics(viewOf("broadcast", [1440, 900]), { x: "30", y: C }), LABEL_METRICS);
});

test("labelFootprint: lines on the turf, an arc's flight lifted up the screen by its height, marks where they sit", () => {
  const line = { t: "ground", role: "run", from: { x: 30, y: C }, to: { x: 34, y: C } };
  assert.deepEqual(labelFootprint([line]).map((p) => p.x), [30, 31, 32, 33, 34]);
  const arc = { t: "arc", role: "pass", from: { x: 30, y: C }, to: { x: 40, y: C }, apex: 2, endH: 0 };
  const lifted = labelFootprint([arc], { ...LABEL_METRICS, lifts: [2] });
  near(Math.max(...lifted.map((p) => p.y)), C + 4, EPS, "the apex, 2 yards up, reads 4 yards deeper");
  assert.ok(lifted.every((p) => p.y >= C - EPS), "never below its own track");
  const behind = labelFootprint([arc], { ...LABEL_METRICS, down: { x: -1, y: 0 }, lifts: [2] });
  assert.ok(behind.some((p) => Math.abs(p.x - 39) < EPS && Math.abs(p.y - C) < EPS),
    "from behind the offense, the apex (at 35, 2 up) reads 4 yards downfield");
  assert.ok(behind.every((p) => Math.abs(p.y - C) < EPS && p.x >= 30 - EPS));
  const x = labelFootprint([{ t: "mark", role: "incomplete", at: { x: 35, y: C } }]);
  assert.equal(x.length, 9, "a mark is a glyph about a line tall and three characters wide, not a point");
  near(Math.max(...x.map((p) => p.y)) - C, 3.5 / 2, EPS);
  near(Math.max(...x.map((p) => p.x)) - 35, 1.5 * 0.8, EPS);
  assert.deepEqual(labelFootprint([{ t: "ground" }, { t: "arc", from: { x: 1, y: 1 } }, null, { t: "mark" }]), []);
  assert.deepEqual(labelFootprint("junk"), []);
});

test("labelFootprint samples a steep flight finely enough that no label box slips between two samples", () => {
  const thrown = { t: "arc", role: "pass", from: { x: 73, y: C }, to: { x: 78, y: 14.667 }, apex: 2.34, endH: 0 };
  const view = { charYd: 0.23, lineYd: 1.8, padYd: 0.38, down: { x: 0, y: -1 }, lifts: [2.38] };
  const label = { text: "1 · Short (0–9 air yds) · 44%", at: { x: 76, y: 15.63 } };
  const box = labelBox(label, view);
  const inside = labelFootprint([thrown], view).filter((p) => Math.abs(p.x - box.u) < box.hw
    && Math.abs(-p.y - box.v) < box.hh);
  assert.ok(inside.length > 0, "the throw drops into its X through this label (TB at DAL #84, then #85's shadows)");
});

test("placeLabelText: the first candidate clear of labels and strokes, whole on the field", () => {
  const text = "Short pass middle · incomplete";
  const far = { x: 35, y: C + 5 };
  const nearSide = { x: 35, y: C - 5 };
  assert.deepEqual(placeLabelText(text, [far, nearSide]), far);
  assert.deepEqual(placeLabelText(text, [far, nearSide], { points: [{ x: 33, y: C + 4 }] }), nearSide);
  const other = { text: "1 · Inside run (A/B gap) · 27%", at: { x: 33, y: C - 5.5 } };
  assert.deepEqual(placeLabelText(text, [nearSide, far], { boxes: [labelBox(other)] }), far);
  assert.deepEqual(placeLabelText(text, [far], { points: [{ x: 35, y: C + 5 }] }), far, "nothing clear: the first");
  assert.deepEqual(placeLabelText(text, [nearSide, far], { boxes: [labelBox(other)], points: [{ x: 35, y: C + 5 },
    { x: 35, y: C - 5 }] }), far, "nothing clear: never on other text, even over a stroke");
  assert.equal(placeLabelText(text, [far], { points: [{ x: 35, y: C + 5 }], strict: true }), null, "strict: clear or none");
  const half = (text.length * 0.8) / 2;
  assert.deepEqual(placeLabelText(text, [{ x: 108, y: C - 5 }]), { x: 110 - half, y: C - 5 }, "slides inside");
  assert.deepEqual(placeLabelText(text, [{ x: 35, y: -3 }, nearSide]), nearSide, "off the field: skipped");
  assert.deepEqual(placeLabelText(text, [{ x: 35, y: -3 }]), { x: 35, y: 1 }, "or clamped onto it");
  const endZone = { charYd: 0.26, lineYd: 1.8, padYd: 0.4, down: { x: -1, y: 0 }, lifts: [2] };
  const box = labelBox({ text, at: { x: 28, y: C } }, endZone);
  near(box.hw, (text.length * 0.26 + 0.4) / 2, EPS, "an end-zone label runs across the field");
  near(box.hh, 0.9, EPS);
  assert.deepEqual(placeLabelText(text, [{ x: 28, y: C }, { x: 26, y: C }],
    { points: [{ x: 28, y: C + 3 }], metrics: endZone }), { x: 26, y: C });
});
