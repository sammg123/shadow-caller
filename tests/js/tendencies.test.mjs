// ui/tendencies.js (ui-architecture 2.6, FI 3.8; owner A8): his pass-run terms as a forest plot in a deliberate
// order (G14), the play-type mix vs expected, and the held-out check (#114, #115).
import assert from "node:assert/strict";
import test from "node:test";
import { tendenciesVm } from "../../static/js/model/vm-tendencies.js";
import { mount } from "../../static/js/ui/tendencies.js";
import { all, fakeCtx, inDoc, makePv, one, patch, regionRoot, state, text } from "./game-surfaces-harness.mjs";

const vmOf = (presented = state.final()) => tendenciesVm(makePv({ presented }));
const term = (root, key) => one(root, `[data-term="${key}"]`);
const num = (node, attr) => Number(node.getAttribute(attr));

function setup(doc) {
  const root = regionRoot(doc, { id: "rg-tendencies" });
  const { ctx } = fakeCtx();
  return { root, tend: mount(root, ctx) };
}

test("#profTitle and #profArea; the title is generic until the profile arrives (#6)", () => inDoc((doc) => {
  const { root, tend } = setup(doc);
  tend.update(tendenciesVm(makePv()));
  assert.equal(text(one(root, "#profTitle")), "His tendencies");
  assert.ok(one(root, "#profArea"));
  assert.equal(all(root, "[data-term]").length, 0);
  tend.update(vmOf());
  assert.equal(text(one(root, "#profTitle")), "Schottenheimer's tendencies");
}));

test("9 rows in the G14 order, habits then memory, filled exactly when the interval excludes zero (#114)", () => inDoc((doc) => {
  const { root, tend } = setup(doc);
  tend.update(vmOf());
  const rows = all(root, "[data-term]");
  assert.deepEqual(rows.map((r) => r.getAttribute("data-term")), ["early_down", "third_long", "trailing9", "red_zone", "dq",
    "last", "last_fail", "explosive_prev", "sack_prev"]);
  assert.deepEqual(rows.filter((r) => r.getAttribute("data-sure") === "true").map((r) => r.getAttribute("data-term")),
    ["early_down", "dq", "last", "explosive_prev"]);
  assert.deepEqual(rows.map((r) => r.getAttribute("data-sign")), ["run", "run", "pass", "pass", "pass", "run", "pass", "run", "run"]);
  assert.equal(text(one(term(root, "dq"), ".sc-tend-label")), "Value gap (what's been working)");
  assert.deepEqual(all(root, ".sc-tend-ghead").map(text), ["His habits", "In-game memory"]);
  assert.equal(text(one(term(root, "early_down"), ".sc-tend-sr")), "leans run, 90% interval excludes zero");
  assert.equal(text(one(term(root, "red_zone"), ".sc-tend-sr")), "leans pass, 90% interval includes zero");
}));

test("each row draws its interval and estimate on the -1.2 to 1.2 axis, with zero in the middle", () => inDoc((doc) => {
  const { root, tend } = setup(doc);
  tend.update(vmOf());
  const row = term(root, "early_down");
  const ci = one(row, ".sc-tend-ci");
  assert.ok(Math.abs(num(ci, "x1") - 13.25) < 0.01 && Math.abs(num(ci, "x2") - 38.9) < 0.01);
  assert.ok(Math.abs(num(one(row, ".sc-tend-dot"), "x1") - 25.25) < 0.01);
  assert.equal(num(one(row, ".sc-tend-zero"), "x1"), 50);
  assert.deepEqual(all(one(root, ".sc-tend-axis"), "span").map(text), ["more run", "more pass"]);
  assert.equal(one(root, ".sc-tend-terms").getAttribute("aria-label"), "His pass-run tendency terms with 90 percent intervals");
}));

test("the note, then the mix with his % and exp. X% in family order, then the held-out check (#114, #115)", () => inDoc((doc) => {
  const { root, tend } = setup(doc);
  tend.update(vmOf());
  assert.equal(text(one(root, ".sc-tend-note")), "1,351 snaps, 21 games (2025–2026). Filled dots: 90% interval excludes zero.");
  const mix = all(one(root, ".sc-tend-mix"), "tr");
  assert.deepEqual(mix.map((tr) => all(tr, "th").concat(all(tr, "td")).map(text)), [
    ["Run", "34%", "exp. 34%"], ["Dropback pass", "43%", "exp. 45%"], ["Play-action", "15%", "exp. 12%"],
    ["Screen", "3%", "exp. 4%"], ["RPO", "5%", "exp. 5%"]]);
  assert.equal(text(one(root, ".sc-tend-heldout")), "Held-out check: his top pick for the specific play was right 38% "
    + "of the time; the actual play was in his top 3 66% of the time (1,270 snaps).");
}));

test("a profile without the play-type model hides the mix and the held-out line; destroy removes it all", () => inDoc((doc) => {
  const { root, tend } = setup(doc);
  tend.update(vmOf(patch(state.final(), { profile: { ...state.final().profile, granular: null } })));
  assert.deepEqual([one(root, ".sc-tend-mixblock").hidden, one(root, ".sc-tend-heldout").hidden], [true, true]);
  const kept = term(root, "dq");
  tend.update(vmOf());
  assert.equal(term(root, "dq"), kept);
  assert.equal(one(root, ".sc-tend-mixblock").hidden, false);
  tend.destroy();
  assert.equal(root.childNodes.length, 0);
}));
