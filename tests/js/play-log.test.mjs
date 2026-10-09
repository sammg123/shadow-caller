// ui/play-log.js (ui-architecture 2.6, FI 3.9; owner A8): every logged snap, newest first, never paginated, in the
// FI columns; nullified rows leave # empty (G15), goal to go reads Goal (G16), server text stays text (#123); each
// snap's name is a button that shows it on the field.
import assert from "node:assert/strict";
import test from "node:test";
import { logVm } from "../../static/js/model/vm-log.js";
import { mount } from "../../static/js/ui/play-log.js";
import { all, click, fakeCtx, inDoc, makePv, one, patch, regionRoot, state, text, timeline, tlOf } from "./game-surfaces-harness.mjs";

const vmOf = (presented = state.final(), extra = {}) => logVm(makePv({ presented, tl: tlOf(timeline.final()), ...extra }));
const row = (root, seq) => one(one(root, "tbody"), `[data-seq="${seq}"]`);
const cells = (tr) => all(tr, "td").map(text);

function setup(doc) {
  const root = regionRoot(doc, { tag: "div", id: "logArea" });
  const { ctx, calls } = fakeCtx();
  return { root, calls, log: mount(root, ctx) };
}

test("an empty log says so and shows no table (#6)", () => inDoc((doc) => {
  const { root, log } = setup(doc);
  log.update(logVm(makePv({ presented: patch(state.final(), { log: [] }) })));
  const empty = one(root, ".sc-log-empty");
  assert.deepEqual([empty.hidden, text(empty)], [false, "No snaps yet. Each logged play shows his top pick next to what he called."]);
  assert.equal(one(root, '[data-testid="play-log"]').hidden, true);
  assert.equal(text(one(root, ".sc-panel-title")), "Play log");
}));

test("the columns in order and every row, newest first (#112)", () => inDoc((doc) => {
  const { root, log } = setup(doc);
  log.update(vmOf());
  assert.deepEqual(all(one(root, "thead"), "th").map(text),
    ["#", "Time", "Situation", "His top pick", "Actual", "His % on it", "League %", "Rank", "Yds"]);
  const rows = all(one(root, "tbody"), "tr");
  assert.equal(rows.length, 59);
  assert.equal(rows[0].getAttribute("data-seq"), "59");
  assert.deepEqual(cells(rows[0]), ["55", "Q4 1:22", "2nd & 1 at TB 24", "Short (0–9 air yds) 39%",
    "Short (0–9 air yds), turnover", "39%", "43%", "1", "0"]);
}));

test("rank 1 is good, 2 and 3 plain, 4 and up bad, missing values a dash (#113)", () => inDoc((doc) => {
  const { root, log } = setup(doc);
  log.update(vmOf());
  const rank = (seq) => one(row(root, seq), ".sc-log-rank");
  assert.deepEqual([rank(59).getAttribute("class"), rank(59).getAttribute("data-tone")], ["sc-log-rank ok", "good"]);
  assert.deepEqual([rank(56).getAttribute("class"), rank(56).hasAttribute("data-tone")], ["sc-log-rank", false]);
  assert.deepEqual([rank(54).getAttribute("class"), rank(54).getAttribute("data-tone")], ["sc-log-rank no", "bad"]);
  const base = state.tilt().log[0];
  const bare = { ...base, leaf_rank: null, leaf_p: null, leaf_p_league: null, fam_p: null, fam_p_league: null };
  log.update(logVm(makePv({ presented: patch(state.final(), { log: [bare] }) })));
  assert.deepEqual(cells(all(one(root, "tbody"), "tr")[0]).slice(5, 8), ["—", "—", "—"]);
}));

test("nullified rows: empty #, Yds flag, no play in the name (G15, #108); goal to go reads Goal (G16)", () => inDoc((doc) => {
  const { root, log } = setup(doc);
  log.update(vmOf());
  const flagged = all(one(root, "tbody"), "tr").filter((tr) => tr.getAttribute("data-nullified") === "true");
  assert.equal(flagged.length, 4);
  assert.ok(flagged.every((tr) => cells(tr)[0] === "" && cells(tr)[8] === "flag" && cells(tr)[4].includes("(no play:")));
  assert.equal(cells(row(root, 7))[2], "1st & Goal at TB 8");
}));

test("server text stays text: <b>x</b> in a name shows as written (#123, G27)", () => inDoc((doc) => {
  const { root, log } = setup(doc);
  const final = state.final();
  log.update(vmOf(patch(final, { log: [{ ...final.log[0], name: "Run (no play: <b>x</b>)" }, ...final.log.slice(1)] })));
  const btn = one(row(root, 59), "button");
  assert.equal(btn.textContent, "Run (no play: <b>x</b>), turnover");
  assert.equal(btn.childNodes.length, 1);
}));

test("a snap's name is a button that shows it on the field; the reviewed one is pressed", () => inDoc((doc) => {
  const { root, log, calls } = setup(doc);
  log.update(vmOf());
  const btn = one(row(root, 59), "button");
  assert.deepEqual([btn.getAttribute("type"), btn.getAttribute("aria-pressed"), btn.hasAttribute("disabled")], ["button", "false", false]);
  click(btn);
  assert.deepEqual(calls, [["reviewAt", 176]]);
  log.update(vmOf(state.final(), { view: { review: { seq: 176 } } }));
  assert.deepEqual([row(root, 59).getAttribute("data-reviewing"), btn.getAttribute("aria-pressed")], ["true", "true"]);
  click(btn);
  assert.deepEqual(calls.at(-1), ["exitReview"]);
  assert.equal(row(root, 59).getAttribute("data-verdict"), "top1");
}));

test("a snap not drawn yet can't be shown; rows are kept across updates; destroy removes it all", () => inDoc((doc) => {
  const { root, log } = setup(doc);
  log.update(logVm(makePv({ presented: state.final(), tl: tlOf(timeline.final(), 100) })));
  const kept = row(root, 59);
  assert.equal(one(kept, "button").hasAttribute("disabled"), true);
  log.update(vmOf());
  assert.equal(row(root, 59), kept);
  assert.equal(one(kept, "button").hasAttribute("disabled"), false);
  log.destroy();
  assert.equal(root.childNodes.length, 0);
}));
