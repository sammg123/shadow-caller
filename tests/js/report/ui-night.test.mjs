// static/js/report/ui/night.js: the night board renders nightVm as text and LED parts: the tally in digit windows over
// their unlit 8s, the last six marks, and the call track (one bar per call, its height in cells, its words for a screen
// reader and a tooltip), all reconciled in place as the game goes on.
import assert from "node:assert/strict";
import test from "node:test";
import { nightVm } from "../../../static/js/report/model/vm-night.js";
import { mount } from "../../../static/js/report/ui/night.js";
import { all, fakeCtx, inDoc, makePv, one, regionRoot, state, text, timeline, tlOf } from "../game-surfaces-harness.mjs";

const vmAt = (n) => nightVm(makePv({ presented: state.final(), tl: tlOf(timeline.final(), n) }));

function setup(doc) {
  const root = regionRoot(doc, { id: "rp-night" });
  root.appendChild(doc.createElement("h2")).setAttribute("class", "rp-plate");
  return { root, board: mount(root, fakeCtx().ctx) };
}

test("the plate takes the VM's heading; the tally sits in digit windows with their ghost", () => inDoc((doc) => {
  const { root, board } = setup(doc);
  board.update(vmAt(183));
  assert.equal(text(one(root, ".rp-plate")), "Schottenheimer so far");
  const nums = all(root, ".rp-tally-num");
  assert.deepEqual(nums.map((n) => [text(n), n.getAttribute("data-ghost")]), [["32", "88"], ["47", "88"]]);
  assert.deepEqual(all(root, ".rp-tally-label").map(text), ["Top pick", "In his top 3"]);
  assert.deepEqual(all(root, ".rp-tally-of").map(text), ["of 59 calls", "of 59 calls"]);
  assert.equal(all(root, ".rp-plate").length, 1, "the board's own plate is reused, never duplicated");
}));

test("the last six marks carry their verdict and their words", () => inDoc((doc) => {
  const { root, board } = setup(doc);
  board.update(vmAt(183));
  const marks = all(root, ".rp-mark");
  assert.deepEqual(marks.map((m) => m.getAttribute("data-verdict")), ["miss", "top1", "top3", "top1", "top1", "top1"]);
  assert.deepEqual(marks.map((m) => text(one(m, ".rp-mark-glyph"))), ["✗", "✓", "2", "✓", "✓", "✓"]);
  assert.equal(text(one(marks[2], ".sr-only")), "In his top 3, #2");
}));

test("the track: a bar per call with its cells, drive and quarter starts, surprise numbers, words", () => inDoc((doc) => {
  const { root, board } = setup(doc);
  board.update(vmAt(183));
  const bars = all(root, ".rp-bar");
  assert.equal(bars.length, 59);
  const first = bars[0];
  assert.deepEqual([first.getAttribute("data-verdict"), first.style.getPropertyValue("--cells"),
    first.getAttribute("data-drive-start"), text(one(first, ".rp-bar-q"))], ["top3", "3", "true", "Q1"]);
  const surprise = bars.find((b) => b.getAttribute("data-seq") === "158");
  assert.equal(text(one(surprise, ".rp-bar-mark")), "1");
  assert.equal(surprise.getAttribute("title"), "Snap 47, Q4 5:35: Miss. Deep shot (20+), incomplete: 0.5%.");
  assert.equal(text(one(surprise, ".sr-only")), surprise.getAttribute("title"));
  const list = one(root, ".rp-track-bars");
  assert.equal(list.getAttribute("aria-label").startsWith("Every call he made, in order."), true);
  assert.deepEqual([list.style.getPropertyValue("--rp-calls"), list.style.getPropertyValue("--rp-breaks")], ["59", "8"],
    "the counts the bars' width is sized from");
}));

test("new calls append in place: the bars already there are kept", () => inDoc((doc) => {
  const { root, board } = setup(doc);
  board.update(vmAt(50));
  const kept = all(root, ".rp-bar")[0];
  const before = all(root, ".rp-bar").length;
  board.update(vmAt(183));
  assert.equal(all(root, ".rp-bar")[0], kept);
  assert.ok(all(root, ".rp-bar").length > before);
}));

test("before his first snap the board shows only the empty line", () => inDoc((doc) => {
  const { root, board } = setup(doc);
  board.update(nightVm(makePv({ presented: state.tilt(), tl: tlOf(timeline.final(), 1) })));
  const empty = one(root, ".rp-empty");
  assert.deepEqual([empty.hidden, text(empty)], [false, "No calls yet: his first snap hasn't happened."]);
  assert.equal(one(root, ".rp-night-body").hidden, true);
  board.update(vmAt(183));
  assert.deepEqual([empty.hidden, one(root, ".rp-night-body").hidden], [true, false]);
}));

test("destroy takes the board's face away and leaves the plate", () => inDoc((doc) => {
  const { root, board } = setup(doc);
  board.update(vmAt(183));
  board.destroy();
  assert.equal(all(root, ".rp-bar").length, 0);
  assert.equal(all(root, ".rp-plate").length, 1);
}));
