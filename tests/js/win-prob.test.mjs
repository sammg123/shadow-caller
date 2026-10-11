// ui/win-prob.js (ui-architecture 2.6, 5.4; owner A8): ESPN's win probability on the caller's side, as a line over
// the game clock with the 50% line, quarter marks, scores and turnovers.
import assert from "node:assert/strict";
import test from "node:test";
import { wpVm } from "../../static/js/model/vm-wp.js";
import { mount } from "../../static/js/ui/win-prob.js";
import { all, fakeCtx, inDoc, makePv, one, patch, regionRoot, state, text, timeline, tlOf } from "./game-surfaces-harness.mjs";

const vmOf = (body = timeline.final()) => wpVm(makePv({ presented: state.final(), tl: tlOf(body) }));
const pairsIn = (d) => d.trim().split(/[ML]/).filter(Boolean).map((p) => p.trim().split(/[ ,]+/).map(Number));

function setup(doc) {
  const root = regionRoot(doc, { id: "rg-wp" });
  const { ctx } = fakeCtx();
  return { root, wp: mount(root, ctx) };
}

test("the final: DAL at 0%, with the 5.4 hooks (data-available, data-wp-caller, aria-label)", () => inDoc((doc) => {
  const { root, wp } = setup(doc);
  wp.update(vmOf());
  const chart = one(root, '[data-testid="wp-chart"]');
  assert.deepEqual(["data-available", "data-wp-caller", "role", "aria-label"].map((a) => chart.getAttribute(a)),
    ["true", "0", "img", "DAL win probability 0%"]);
  assert.equal(text(one(root, ".sc-wp-team")), "DAL");
  assert.equal(text(one(root, ".sc-wp-value")), "0%");
  assert.equal(text(one(root, ".sc-panel-title")), "Win probability");
}));

test("after the interception DAL is at 63% (DC G16)", () => inDoc((doc) => {
  const { root, wp } = setup(doc);
  wp.update(vmOf(timeline.at104()));
  const chart = one(root, '[data-testid="wp-chart"]');
  assert.equal(chart.getAttribute("data-wp-caller"), "0.6324");
  assert.equal(chart.getAttribute("aria-label"), "DAL win probability 63%");
  assert.equal(text(one(root, ".sc-wp-value")), "63%");
}));

test("the line starts at ESPN's opening value, then one point per play; areas split at 50%", () => inDoc((doc) => {
  const { root, wp } = setup(doc);
  wp.update(vmOf());
  const svg = one(root, "svg");
  const [, , w, h] = svg.getAttribute("viewbox").split(" ").map(Number);
  const pts = pairsIn(one(root, ".sc-wp-line").getAttribute("d"));
  assert.equal(pts.length, 184, "the opening value plus 183 plays");
  assert.deepEqual(pts[0], [0, Math.round((1 - 0.8619) * h * 100) / 100]);
  assert.deepEqual(pts.at(-1), [w, h], "0% at the final whistle (t 3600 of 3600)");
  const clips = all(root, ".sc-wp-clip").map((c) => c.getAttribute("id"));
  assert.equal(clips.length, 2);
  const areas = all(root, ".sc-wp-area");
  assert.deepEqual(areas.map((a) => a.getAttribute("clip-path")), clips.map((id) => `url(#${id})`));
  const even = one(root, ".sc-wp-even");
  assert.deepEqual([even.getAttribute("y1"), even.getAttribute("y2")], [String(h / 2), String(h / 2)]);
}));

test("scores and turnovers are marked on the line; quarters are labelled", () => inDoc((doc) => {
  const { root, wp } = setup(doc);
  wp.update(vmOf());
  const marks = all(root, ".sc-wp-mark");
  assert.equal(marks.length, 10);
  assert.deepEqual(marks.filter((m) => m.getAttribute("data-kind") === "turnover").map((m) => m.getAttribute("data-team")),
    ["DAL", "DAL", "DAL"]);
  assert.deepEqual(all(root, ".sc-wp-q").length, 3, "lines at the end of Q1, Q2, Q3");
  const axis = all(one(root, ".sc-wp-axis"), "span").filter((s) => !s.hidden);
  assert.deepEqual(axis.map(text), ["Q1", "Q2", "Q3", "Q4"], "no overtime in this game");
}));

test("at kickoff, before ESPN's first number, the note says when the line appears", () => inDoc((doc) => {
  const { root, wp } = setup(doc);
  const kickoff = { ...tlOf(patch(timeline.final(), { rows: [], wp_start: null })), source: "log" };   // no play yet
  wp.update(wpVm(makePv({ presented: state.tilt(), tl: kickoff })));
  const chart = one(root, '[data-testid="wp-chart"]');
  assert.deepEqual([chart.getAttribute("data-available"), chart.hasAttribute("data-wp-caller"), chart.hasAttribute("role")],
    ["false", false, false]);
  const note = one(root, ".sc-wp-note");
  assert.deepEqual([note.hidden, text(note)], [false, "Win probability appears after the first play."]);
  assert.equal(one(root, ".sc-wp-plot").hidden, true);
}));

test("before the first play with no opening value: a waiting line, then the chart; destroy removes it", () => inDoc((doc) => {
  const { root, wp } = setup(doc);
  const body = timeline.final();
  wp.update(wpVm(makePv({ tl: { ...tlOf(patch(body, { wp_start: null, rows: [] })), source: "espn" } })));
  assert.equal(text(one(root, ".sc-wp-note")), "The line starts with the first play.");
  assert.equal(one(root, ".sc-wp-line").getAttribute("d"), null);
  const svg = one(root, "svg");
  wp.update(vmOf());
  assert.equal(one(root, "svg"), svg, "the chart is built once");
  assert.equal(one(root, ".sc-wp-note").hidden, true);
  wp.destroy();
  assert.equal(root.childNodes.length, 0);
}));
