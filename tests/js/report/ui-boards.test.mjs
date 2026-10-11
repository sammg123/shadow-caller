// static/js/report/ui/{hit-rate, surprises, memory}.js: the three analysis boards render their view models as text and
// LED parts (cells, lamps, numbered windows), keep their rows across updates, and show the plain empty line before his
// first snap.
import assert from "node:assert/strict";
import test from "node:test";
import { hitRateVm } from "../../../static/js/report/model/vm-hit-rate.js";
import { memoryVm } from "../../../static/js/report/model/vm-memory.js";
import { surprisesVm } from "../../../static/js/report/model/vm-surprises.js";
import { mount as mountHits } from "../../../static/js/report/ui/hit-rate.js";
import { mount as mountMemory } from "../../../static/js/report/ui/memory.js";
import { mount as mountSurprises } from "../../../static/js/report/ui/surprises.js";
import { all, fakeCtx, inDoc, makePv, one, patch, regionRoot, state, text, timeline, tlOf }
  from "../game-surfaces-harness.mjs";

const finalPv = () => makePv({ presented: state.final(), tl: tlOf(timeline.final()) });
const emptyPv = () => makePv({ presented: state.tilt(), tl: tlOf(timeline.final(), 1) });

test("hit rate: a table row per bucket with its counts, its cells and a lamp on the leader", () => inDoc((doc) => {
  const root = regionRoot(doc, { id: "rp-situations" });
  const board = mountHits(root, fakeCtx().ctx);
  board.update(hitRateVm(finalPv()));
  assert.equal(text(one(root, ".rp-plate")), "Hit rate by down and distance");
  const table = one(root, '[data-testid="report-hit-rate"]');
  assert.deepEqual(all(one(table, "thead"), "th").map(text), ["Situation", "Calls", "Top pick", "In his top 3",
    "League top 3"]);
  const rows = all(one(table, "tbody"), "tr");
  assert.equal(rows.length, 8);
  const first = rows[0];
  assert.deepEqual([first.getAttribute("data-bucket"), first.getAttribute("data-lead")], ["1st", "league"]);
  assert.deepEqual(all(first, "td").map((td) => text(one(td, ".rp-n"))), ["29", "12", "17", "19"]);
  assert.equal(all(first, ".rp-cell").length, 29);
  assert.deepEqual(all(first, ".rp-cell").slice(11, 13).map((c) => c.getAttribute("data-verdict")), ["top1", "top3"]);
  assert.equal(one(first, ".rp-cells").getAttribute("aria-label"),
    "1st down: 12 top picks and 17 in his top 3, of 29 calls");
  assert.equal(text(one(first, ".rp-lead")), "League leads");
  const foot = one(table, "tfoot");
  assert.deepEqual(all(foot, ".rp-n").map(text), ["59", "32", "47", "48"]);
  assert.match(text(one(root, ".rp-note")), /^Counted on the specific play/);
}));

test("hit rate before his first snap: the buckets stay, empty, under the plain line", () => inDoc((doc) => {
  const root = regionRoot(doc, { id: "rp-situations" });
  const board = mountHits(root, fakeCtx().ctx);
  board.update(hitRateVm(emptyPv()));
  assert.deepEqual([one(root, ".rp-empty").hidden, text(one(root, ".rp-empty"))],
    [false, "No calls yet: his first snap hasn't happened."]);
  assert.equal(all(root, ".rp-cell").length, 0);
  board.update(hitRateVm(finalPv()));
  assert.equal(one(root, ".rp-empty").hidden, true);
}));

test("surprises: a numbered window per surprise, when and where, what he called, the model's pick", () => inDoc((doc) => {
  const root = regionRoot(doc, { id: "rp-surprises" });
  const board = mountSurprises(root, fakeCtx().ctx);
  board.update(surprisesVm(finalPv()));
  assert.equal(text(one(root, ".rp-plate")), "His biggest surprises");
  const items = all(root, ".rp-surprise");
  assert.equal(items.length, 5);
  const top = items[0];
  assert.deepEqual([text(one(top, ".rp-rank")), one(top, ".rp-rank").getAttribute("data-ghost")], ["1", "8"]);
  assert.equal(text(one(top, ".rp-surprise-when")), "Snap 47 · Q4 5:35 · 1st & 10 at TB 18");
  assert.deepEqual(["called", "pct", "rank"].map((part) => text(one(top, `.rp-surprise-${part}`))),
    ["Deep shot (20+), incomplete", "0.5%", "#13 of 14"]);
  assert.deepEqual([text(one(top, ".rp-surprise-pick")), text(one(top, ".rp-surprise-pickpct"))],
    ["Short (0–9 air yds)", "45%"]);
  assert.deepEqual(all(top, ".rp-label").map(text), ["He called", "Model's pick"]);
  assert.equal(top.getAttribute("data-seq"), "158");
}));

test("memory: the tilt in words, the pull of habits and memory, the call and whether it came true", () => inDoc((doc) => {
  const root = regionRoot(doc, { id: "rp-memory" });
  const board = mountMemory(root, fakeCtx().ctx);
  board.update(memoryVm(finalPv()));
  assert.equal(text(one(root, ".rp-plate")), "In-game memory");
  assert.deepEqual(all(root, ".rp-summary-item").map(text),
    ["Tilts that came true 1 of 2", "Memory switches on after snap 15."]);
  const rows = all(root, ".rp-memory-row");
  assert.equal(rows.length, 2);
  const [missed, hit] = rows;
  assert.equal(text(one(missed, ".rp-tilt")), "Tilts run");
  assert.equal(text(one(missed, ".rp-memory-when")), "Snap 24 · Q2 1:23 · 1st & 10 at TB 39");
  assert.deepEqual(all(missed, ".rp-pull").map(text), ["His habits -0.4 pts", "In-game memory -19.0 pts"]);
  assert.equal(text(one(missed, ".rp-memory-called")), "He called Short (0–9 air yds) (pass)");
  assert.deepEqual([missed.getAttribute("data-outcome"), text(one(missed, ".rp-outcome"))], ["missed", "Didn't come true"]);
  assert.deepEqual([hit.getAttribute("data-outcome"), text(one(hit, ".rp-outcome"))], ["true", "Came true"]);
  assert.equal(all(root, ".rp-part").length, 0);
}));

test("memory: a row's memory parts are listed with their points; a row with none hides the list", () => inDoc((doc) => {
  const body = timeline.final();
  const parts = [{ term: "Repeat last call (stickiness)", pts: 9.9 }, { term: "After a sack", pts: -2.04 }];
  const rows = body.rows.map((r) => (r.seq === 85 ? { ...r, pred: { ...r.pred, memory_parts: parts } } : r));
  const root = regionRoot(doc, { id: "rp-memory" });
  const board = mountMemory(root, fakeCtx().ctx);
  board.update(memoryVm(makePv({ presented: state.final(), tl: tlOf(patch(body, { rows })) })));
  const row = all(root, ".rp-memory-row").find((li) => li.getAttribute("data-seq") === "85");
  assert.deepEqual(all(row, ".rp-part").map(text), ["Repeat last call (stickiness) +9.9", "After a sack -2.0"]);
  assert.deepEqual([one(row, ".rp-tilt").hidden, one(row, ".rp-outcome-lamp").hidden], [true, true]);
  const tilted = all(root, ".rp-memory-row").find((li) => li.getAttribute("data-seq") === "82");
  assert.equal(one(tilted, ".rp-parts").hidden, true);
}));

test("memory and surprises before his first snap: the plain lines", () => inDoc((doc) => {
  const mem = regionRoot(doc, { id: "rp-memory" });
  const memBoard = mountMemory(mem, fakeCtx().ctx);
  memBoard.update(memoryVm(emptyPv()));
  assert.equal(text(one(mem, ".rp-empty")), "No calls yet: his first snap hasn't happened.");
  assert.equal(all(mem, ".rp-memory-row").length, 0);
  const sur = regionRoot(doc, { id: "rp-surprises" });
  const surBoard = mountSurprises(sur, fakeCtx().ctx);
  surBoard.update(surprisesVm(emptyPv()));
  assert.equal(text(one(sur, ".rp-empty")), "No calls yet: his first snap hasn't happened.");
  memBoard.destroy();
  surBoard.destroy();
  assert.equal(all(mem, ".rp-empty").length + all(sur, ".rp-empty").length, 0);
}));
