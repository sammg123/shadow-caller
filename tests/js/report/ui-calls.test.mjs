// static/js/report/ui/calls.js: every call v the model as one table, oldest first, a header row for each of his drives,
// each call's model top 3 with chances (the one he called marked in words), what he called, rank and verdict.
// Text only: a hostile name from the server lands as text.
import assert from "node:assert/strict";
import test from "node:test";
import { callsVm } from "../../../static/js/report/model/vm-calls.js";
import { mount } from "../../../static/js/report/ui/calls.js";
import { all, fakeCtx, inDoc, makePv, one, patch, regionRoot, state, text, timeline, tlOf }
  from "../game-surfaces-harness.mjs";

const vmOf = (tl = tlOf(timeline.final())) => callsVm(makePv({ presented: state.final(), tl }));
const callRows = (root) => all(root, "tr").filter((tr) => tr.getAttribute("data-seq"));
const cells = (tr) => all(tr, "td").map(text);

function setup(doc) {
  const root = regionRoot(doc, { id: "rp-calls" });
  return { root, board: mount(root, fakeCtx().ctx) };
}

test("a table with the seven columns, 59 calls and a row for each of his 9 drives", () => inDoc((doc) => {
  const { root, board } = setup(doc);
  board.update(vmOf());
  const table = one(root, '[data-testid="report-calls"]');
  assert.equal(table.tagName, "TABLE");
  assert.deepEqual(all(one(table, "thead"), "th").map(text), ["#", "Time", "Situation", "His top 3", "He called", "Rank",
    "Verdict"]);
  assert.equal(callRows(root).length, 59);
  const drives = all(root, "tr").filter((tr) => tr.getAttribute("data-drive") && !tr.getAttribute("data-seq"));
  assert.equal(drives.length, 9);
  assert.deepEqual([text(drives[0]), one(drives[0], "th").getAttribute("colspan")],
    ["DAL TD · 9 plays, 70 yds, 4:09", "7"]);
  assert.equal(text(one(root, ".rp-plate")), "Every call v the model");
  assert.equal(text(one(root, ".rp-count")), "59 calls");
}));

test("one call: snap, time, situation, the top 3 with the called one marked, called, rank, verdict", () => inDoc((doc) => {
  const { root, board } = setup(doc);
  board.update(vmOf());
  const first = callRows(root)[0];
  assert.deepEqual([first.getAttribute("data-seq"), first.getAttribute("data-verdict")], ["2", "top3"]);
  const tds = all(first, "td");
  assert.deepEqual([text(tds[0]), text(tds[1]), text(tds[2]), text(tds[5])], ["1", "Q1 14:54", "1st & 10 at DAL 30", "3"]);
  const top3 = all(tds[3], "li");
  assert.deepEqual(top3.map((li) => [text(one(li, ".rp-top3-name")), text(one(li, ".rp-top3-pct")),
    li.getAttribute("data-called")]), [["Inside run (A/B gap)", "27%", "false"], ["PA short (0–9)", "16%", "false"],
    ["Short (0–9 air yds)", "14%", "true"]]);
  assert.equal(text(one(top3[2], ".sr-only")), "He called this");
  assert.deepEqual([text(one(tds[4], ".rp-called")), text(one(tds[4], ".rp-called-pct"))],
    ["Short (0–9 air yds), incomplete", "14%"]);
  assert.equal(text(one(tds[6], ".rp-verdict-text")), "In his top 3");
  assert.equal(first.getAttribute("tabindex"), "-1", "the drive chart can bring a call into view and focus");
}));

test("a play a flag wiped out: no snap number, the no-play mark, still graded", () => inDoc((doc) => {
  const { root, board } = setup(doc);
  board.update(vmOf());
  const wiped = callRows(root).find((tr) => tr.getAttribute("data-seq") === "8");
  assert.equal(wiped.getAttribute("data-nullified"), "true");
  assert.equal(cells(wiped)[0], "");
  assert.equal(one(wiped, ".rp-noplay").hidden, false);
  assert.equal(text(one(wiped, ".rp-noplay")), "No play");
  assert.equal(one(callRows(root)[0], ".rp-noplay").hidden, true);
}));

test("rows are kept across updates; a live game appends its new calls", () => inDoc((doc) => {
  const { root, board } = setup(doc);
  board.update(vmOf(tlOf(timeline.final(), 104)));
  const kept = callRows(root)[0];
  const before = callRows(root).length;
  board.update(vmOf());
  assert.equal(callRows(root)[0], kept);
  assert.equal(callRows(root).length, 59);
  assert.ok(before < 59);
}));

test("no calls yet: the empty line, no table", () => inDoc((doc) => {
  const { root, board } = setup(doc);
  board.update(callsVm(makePv({ presented: state.tilt(), tl: tlOf(timeline.final(), 1) })));
  assert.equal(one(root, '[data-testid="report-calls"]').hidden, true);
  assert.deepEqual([one(root, ".rp-empty").hidden, text(one(root, ".rp-empty"))],
    [false, "No calls yet: his first snap hasn't happened."]);
}));

test("a hostile play name from the server is text, never markup", () => inDoc((doc) => {
  const { root, board } = setup(doc);
  const body = timeline.final();
  const evil = "<img src=x onerror=alert(1)>";
  const rows = body.rows.map((r) => (r.seq === 3 ? { ...r, pred: { ...r.pred, name: evil } } : r));
  board.update(vmOf(tlOf(patch(body, { rows }))));
  const row = callRows(root).find((tr) => tr.getAttribute("data-seq") === "3");
  assert.equal(text(one(row, ".rp-called")), evil);
  assert.equal(all(root, "img").length, 0);
}));
