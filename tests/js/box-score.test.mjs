// ui/box-score.js (ui-architecture 2.6, 5.4; owner A8): team stats as a table, away team first; ESPN's own box score
// when the server sends it, else the one counted from the plays on the field.
import assert from "node:assert/strict";
import test from "node:test";
import { boxVm } from "../../static/js/model/vm-box.js";
import { mount } from "../../static/js/ui/box-score.js";
import { all, fakeCtx, inDoc, makePv, one, regionRoot, state, text, timeline, tlOf } from "./game-surfaces-harness.mjs";

const vmOf = (tl = tlOf(timeline.final())) => boxVm(makePv({ presented: state.final(), tl }));
const rowOf = (root, label) => all(root, "tr").find((tr) => tr.firstChild && text(tr.firstChild) === label);

function setup(doc) {
  const root = regionRoot(doc, { id: "rg-box" });
  const { ctx } = fakeCtx();
  return { root, box: mount(root, ctx) };
}

test("a table with a column per team, away first, and DAL 366 / TB 419 total yards (5.4, DC C4)", () => inDoc((doc) => {
  const { root, box } = setup(doc);
  box.update(vmOf());
  const table = one(root, '[data-testid="box-score"]');
  assert.equal(table.tagName, "TABLE");
  assert.deepEqual(all(root, "th").filter((th) => th.hasAttribute("data-team")).map((th) => [th.getAttribute("data-team"), text(th)]),
    [["TB", "TB"], ["DAL", "DAL"]]);
  assert.equal(all(one(root, "tbody"), "tr").length, 18);
  const yards = rowOf(root, "Total yards");
  assert.deepEqual(all(yards, "td").map(text), ["419", "366"]);
  assert.equal(yards.firstChild.getAttribute("scope"), "row");
  assert.equal(text(one(root, ".sc-panel-title")), "Team stats");
}));

test("the source line says which box is showing", () => inDoc((doc) => {
  const { root, box } = setup(doc);
  box.update(vmOf());
  assert.deepEqual([one(root, '[data-testid="box-score"]').getAttribute("data-source"), text(one(root, ".sc-box-source"))],
    ["derived", "Counted from the plays on the field"]);
  const body = timeline.final();
  box.update(vmOf({ ...tlOf(body), boxEspn: body.box }));
  assert.deepEqual([one(root, '[data-testid="box-score"]').getAttribute("data-source"), text(one(root, ".sc-box-source"))],
    ["espn", "ESPN box score"]);
}));

test("rows are kept across updates; mid-game values update in place", () => inDoc((doc) => {
  const { root, box } = setup(doc);
  box.update(vmOf(tlOf(timeline.at104())));
  const yards = rowOf(root, "Total yards");
  assert.deepEqual(all(yards, "td").map(text), ["241", "187"]);
  box.update(vmOf());
  assert.equal(rowOf(root, "Total yards"), yards);
  assert.deepEqual(all(yards, "td").map(text), ["419", "366"]);
}));

test("no box yet: the table hides behind an empty line; destroy removes it all", () => inDoc((doc) => {
  const { root, box } = setup(doc);
  box.update(boxVm(makePv()));
  assert.equal(one(root, '[data-testid="box-score"]').hidden, true);
  const empty = one(root, ".sc-box-empty");
  assert.deepEqual([empty.hidden, text(empty)], [false, "Team stats appear after the first play."]);
  box.update(vmOf());
  assert.deepEqual([one(root, '[data-testid="box-score"]').hidden, empty.hidden], [false, true]);
  box.destroy();
  assert.equal(root.childNodes.length, 0);
}));
