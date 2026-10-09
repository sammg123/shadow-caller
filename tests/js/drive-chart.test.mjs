// ui/drive-chart.js (ui-architecture 2.6, 5.4; owner A8): one bar per drive on the 100-yard scale, caller's goal
// on the left as on the field; each drive is a button that shows its first play on the field.
import assert from "node:assert/strict";
import test from "node:test";
import { drivesVm } from "../../static/js/model/vm-drives.js";
import { mount } from "../../static/js/ui/drive-chart.js";
import { all, click, fakeCtx, inDoc, makePv, one, patch, regionRoot, state, text, timeline, tlOf } from "./game-surfaces-harness.mjs";

const vmOf = (extra = {}, body = timeline.final()) => drivesVm(makePv({ presented: state.final(), tl: tlOf(body), ...extra }));
const drive = (root, idx) => one(root, `[data-idx="${idx}"]`);
const data = (node, key) => node.getAttribute(`data-${key}`);
const bar = (root, idx) => one(drive(root, idx), ".sc-dc-bar");

function setup(doc) {
  const root = regionRoot(doc, { id: "rg-drives" });
  const { ctx, calls } = fakeCtx();
  return { root, calls, chart: mount(root, ctx) };
}

test("21 drives in order with ESPN's results and the 5.4 hooks (DC G17)", () => inDoc((doc) => {
  const { root, chart } = setup(doc);
  chart.update(vmOf());
  const list = one(root, '[data-testid="drive-chart"]');
  assert.equal(list.tagName, "OL");
  const drives = all(root, '[data-testid="drive"]');
  assert.equal(drives.length, 21);
  assert.deepEqual(drives.map((d) => data(d, "result")), ["TD", "TD", "PUNT", "PUNT", "PUNT", "PUNT", "PUNT", "PUNT", "FG",
    "END OF HALF", "TD", "INT", "TD", "FUMBLE", "FG", "DOWNS", "DOWNS", "TD", "PUNT", "INT", "END OF GAME"]);
  assert.deepEqual(["idx", "team", "caller", "complete", "dir"].map((k) => data(drives[0], k)), ["1", "DAL", "true", "true", "1"]);
  assert.deepEqual(["team", "caller", "dir"].map((k) => data(drives[1], k)), ["TB", "false", "-1"]);
  assert.equal(text(one(root, ".sc-panel-title")), "Drives");
}));

test("bars run from start to end on the 100-yard scale; a 0-yard drive still shows a sliver", () => inDoc((doc) => {
  const { root, chart } = setup(doc);
  chart.update(vmOf());
  assert.deepEqual([bar(root, 1).getAttribute("x"), bar(root, 1).getAttribute("width")], ["30", "70"]);
  assert.deepEqual([bar(root, 2).getAttribute("x"), bar(root, 2).getAttribute("width")], ["0", "73"]);
  assert.equal(one(drive(root, 1), ".sc-dc-end").getAttribute("x1"), "100", "DAL scored at the TB goal line");
  assert.equal(one(drive(root, 2), ".sc-dc-end").getAttribute("x1"), "0");
  const sliver = Number(bar(root, 14).getAttribute("width"));
  assert.ok(sliver > 0 && sliver <= 1, "drive 14 (fumble, 0 yards) is a sliver");
  assert.equal(text(one(drive(root, 1), ".sc-dc-team")), "DAL");
  assert.equal(text(one(drive(root, 1), ".sc-dc-result")), "TD");
  assert.equal(text(one(drive(root, 1), ".sc-dc-summary")), "9 plays, 70 yds, 4:09");
}));

test("a drive is a button that shows its first play; the reviewed drive is pressed and goes back to live", () => inDoc((doc) => {
  const { root, chart, calls } = setup(doc);
  chart.update(vmOf());
  click(one(drive(root, 2), "button"));
  assert.deepEqual(calls, [["reviewAt", 14]]);
  chart.update(vmOf({ view: { review: { seq: 104 } } }));
  const reviewed = drive(root, 12);
  assert.deepEqual([data(reviewed, "reviewing"), one(reviewed, "button").getAttribute("aria-pressed")], ["true", "true"]);
  click(one(reviewed, "button"));
  assert.deepEqual(calls.at(-1), ["exitReview"]);
}));

test("a drive still going is marked current and says Now; one with nothing drawn yet can't be shown", () => inDoc((doc) => {
  const { root, chart } = setup(doc);
  const body = timeline.final();
  const drives = body.drives.map((d) => (d.idx === 21 ? { ...d, complete: false, result: null, result_text: null, end: null } : d));
  chart.update(drivesVm(makePv({ tl: tlOf(patch(body, { drives }), 176) })));
  const live = drive(root, 21);
  assert.deepEqual([data(live, "current"), data(live, "complete"), live.hasAttribute("data-result")], ["true", "false", false]);
  assert.equal(text(one(live, ".sc-dc-result")), "Now");
  assert.equal(one(live, "button").hasAttribute("disabled"), true, "rows 177+ aren't drawn yet");
}));

test("updates keep the drive nodes; before any drive an empty line; destroy removes it all", () => inDoc((doc) => {
  const { root, chart } = setup(doc);
  chart.update(drivesVm(makePv()));
  assert.equal(one(root, ".sc-dc-empty").hidden, false);
  chart.update(vmOf());
  const kept = drive(root, 3);
  chart.update(vmOf({ view: { review: { seq: 40 } } }));
  assert.equal(drive(root, 3), kept);
  assert.equal(one(root, ".sc-dc-empty").hidden, true);
  chart.destroy();
  assert.equal(root.childNodes.length, 0);
}));
