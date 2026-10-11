// ui/play-feed.js (ui-architecture 2.6, 5.4; owner A8): every play, both teams, newest first, grouped by drive;
// the caller's snaps carry the call and its verdict. Read only: the top LED ticker (restructure-v2.md 1).
import assert from "node:assert/strict";
import test from "node:test";
import { playsVm } from "../../static/js/model/vm-plays.js";
import { mount } from "../../static/js/ui/play-feed.js";
import { all, click, fakeCtx, inDoc, makePv, one, patch, regionRoot, state, text, timeline, tlOf } from "./game-surfaces-harness.mjs";

const vmOf = (drawn = 183, extra = {}) => playsVm(makePv({ presented: state.final(), tl: tlOf(timeline.final(), drawn), ...extra }));
const row = (root, seq) => one(root, `[data-seq="${seq}"]`);
const data = (node, key) => node.getAttribute(`data-${key}`);

function setup(doc) {
  const root = regionRoot(doc, { id: "rg-plays" });
  const { ctx, calls } = fakeCtx();
  return { root, calls, feed: mount(root, ctx) };
}

test("the whole game: 183 rows in an ol labelled Plays, newest first, 64 caller snaps (5.4, DC G1)", () => inDoc((doc) => {
  const { root, feed } = setup(doc);
  feed.update(vmOf());
  const list = one(root, '[data-testid="play-feed"]');
  assert.deepEqual([list.tagName, list.getAttribute("aria-label")], ["OL", "Plays"]);
  const rows = all(root, '[data-testid="play-row"]');
  assert.equal(rows.length, 183);
  assert.deepEqual(rows.slice(0, 3).map((r) => data(r, "seq")), ["183", "182", "181"]);
  assert.equal(rows.filter((r) => data(r, "caller") === "true").length, 64);
  const count = (v) => rows.filter((r) => data(r, "verdict") === v).length;
  assert.deepEqual([count("top1"), count("top3"), count("miss")], [32, 15, 12]);
  assert.equal(text(one(root, ".sc-panel-title")), "Plays");
}));

test("the first DAL snap: every 5.4 hook, its words, its call and the verdict", () => inDoc((doc) => {
  const { root, feed } = setup(doc);
  feed.update(vmOf());
  const r = row(root, 2);
  assert.deepEqual(["seq", "id", "kind", "team", "caller", "verdict", "nullified", "retagged", "scoring"].map((k) => data(r, k)),
    ["2", "40187298068", "play", "DAL", "true", "top3", "false", "false", "false"]);
  assert.equal(text(one(r, ".sc-pf-time")), "Q1 14:54");
  assert.equal(text(one(r, ".sc-pf-sit")), "1st & 10 at DAL 30");
  assert.equal(text(one(r, ".sc-pf-result")), "INC");
  assert.equal(text(one(r, ".sc-pf-text")), "D.Prescott pass incomplete short middle to B.Spann-Ford (C.Rozeboom).");
  assert.equal(text(one(r, ".sc-pf-verdict")), "In his top 3");
  assert.equal(text(one(r, ".sc-pf-callname")), "Short (0–9 air yds), incomplete");
  assert.equal(one(r, ".sc-pf-call").hidden, false);
  assert.equal(one(row(root, 17), ".sc-pf-call").hidden, true, "opponent snaps carry no call");
}));

test("rows are read only: nothing to press, nothing in the tab order (restructure-v2.md 1)", () => inDoc((doc) => {
  const { root, feed, calls } = setup(doc);
  feed.update(vmOf());
  assert.equal(root.querySelector("button"), null);
  assert.equal(root.querySelector("[tabindex]"), null);
  click(one(row(root, 104), ".sc-pf-btn"));
  assert.deepEqual(calls, []);
  assert.equal(data(row(root, 13), "kind"), "admin");
}));

test("rows group by drive, newest drive first, each headed by its team, result and summary", () => inDoc((doc) => {
  const { root, feed } = setup(doc);
  feed.update(vmOf());
  const groups = all(root, ".sc-pf-group");
  assert.equal(groups.length, 21);
  assert.deepEqual([data(groups[0], "drive"), data(groups[0], "team")], ["21", "TB"]);
  assert.equal(text(one(groups[0], ".sc-pf-gresult")), "END OF GAME");
  const first = groups[groups.length - 1];
  assert.equal(text(one(first, ".sc-pf-gsum")), "9 plays, 70 yds, 4:09");
  assert.equal(all(first, '[data-testid="play-row"]').length, 13);
}));

test("a drive still going says so", () => inDoc((doc) => {
  const { root, feed } = setup(doc);
  const body = timeline.final();
  const drives = body.drives.map((d) => (d.idx === 21 ? { ...d, complete: false, result: null, result_text: null } : d));
  feed.update(playsVm(makePv({ presented: state.final(), tl: tlOf(patch(body, { drives })) })));
  const head = all(root, ".sc-pf-group")[0];
  assert.deepEqual([data(head, "complete"), text(one(head, ".sc-pf-gresult"))], ["false", "Drive in progress"]);
}));

test("nullified snaps say No play; scoring rows are marked; the newest row is marked", () => inDoc((doc) => {
  const { root, feed } = setup(doc);
  feed.update(vmOf());
  const wiped = row(root, 8);
  assert.deepEqual([data(wiped, "nullified"), text(one(wiped, ".sc-pf-result"))], ["true", "FLAG"]);
  assert.equal(one(wiped, ".sc-pf-noplay").hidden, false);
  assert.equal(one(row(root, 2), ".sc-pf-noplay").hidden, true);
  assert.equal(all(root, '[data-scoring="true"]').length, 7);
  assert.deepEqual(all(root, '[data-newest="true"]').map((r) => data(r, "seq")), ["183"]);
}));

test("new plays keep the rows already shown", () => inDoc((doc) => {
  const { root, feed } = setup(doc);
  feed.update(vmOf(104));
  const kept = row(root, 50);
  feed.update(vmOf(183));
  assert.equal(row(root, 50), kept);
  assert.equal(all(root, '[data-testid="play-row"]').length, 183);
}));

test("server text stays text (G27); the hand-entered note shows only when there is one", () => inDoc((doc) => {
  const { root, feed } = setup(doc);
  const body = timeline.final();
  const rows = body.rows.map((r) => (r.seq === 2 ? { ...r, text: "<b>x</b> pass" } : r));
  feed.update(playsVm(makePv({ presented: state.final(), tl: tlOf(patch(body, { rows, unlinked: [60] })) })));
  const t = one(row(root, 2), ".sc-pf-text");
  assert.equal(t.textContent, "<b>x</b> pass");
  assert.equal(t.childNodes.length, 1);
  const note = one(root, '[data-testid="unlinked-note"]');
  assert.deepEqual([note.hidden, text(note)], [false, "1 hand-entered play isn't on the field"]);
  feed.update(vmOf());
  assert.equal(note.hidden, true);
}));

test("before the first play: an empty line, no rows; destroy removes everything", () => inDoc((doc) => {
  const { root, feed } = setup(doc);
  feed.update(playsVm(makePv()));
  assert.equal(all(root, '[data-testid="play-row"]').length, 0);
  assert.equal(one(root, ".sc-pf-empty").hidden, false);
  feed.update(vmOf(10));
  assert.equal(one(root, ".sc-pf-empty").hidden, true);
  feed.destroy();
  assert.equal(root.childNodes.length, 0);
}));

test("a hand-entered row already reads as the call, so the call name is not repeated", () => inDoc((doc) => {
  const { root, feed } = setup(doc);
  const body = timeline.final();
  const rows = body.rows.map((r) => (r.seq === 2 ? { ...r, src: "log", text: r.pred.name } : r));
  feed.update(playsVm(makePv({ presented: state.final(), tl: tlOf(patch(body, { rows })) })));
  assert.equal(one(row(root, 2), ".sc-pf-callname").hidden, true);
  assert.equal(one(row(root, 2), ".sc-pf-verdict").textContent, "In his top 3");
  assert.equal(one(row(root, 3), ".sc-pf-callname").hidden, false);
}));

test("G5-10: each row carries the field's words as its ribbon face (decoration: ESPN's text stays for assistive tech)", () => inDoc((doc) => {
  const { root, feed } = setup(doc);
  feed.update(vmOf());
  const face = one(row(root, 3), ".sc-pf-face");
  assert.equal(text(face), "Short pass middle · J.Williams");
  assert.equal(face.getAttribute("aria-hidden"), "true");
  assert.match(text(one(row(root, 3), ".sc-pf-text")), /D\.Prescott pass short middle to J\.Williams/);
}));

test("G5-10: a re-render writes only rows that changed: the same game twice writes nothing", () => inDoc((doc) => {
  const { feed } = setup(doc);
  feed.update(vmOf(100));
  const before = doc.writes;
  feed.update(vmOf(100));
  assert.equal(doc.writes, before, "nothing changed, nothing written");
  feed.update(vmOf(101));
  assert.ok(doc.writes - before < 80, `a new play writes the new row, the old newest and its group only (${doc.writes - before} writes)`);
}));

