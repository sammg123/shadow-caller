// ui/review-banner.js (owner A9; ui-architecture.md 2.2 review, 2.6, 5.4, 9.1): which past play the field shows.
import assert from "node:assert/strict";
import test from "node:test";
import { mount } from "../../static/js/ui/review-banner.js";
import { reviewVm } from "../../static/js/model/vm-review.js";
import { chromeCtx, chromePage, click } from "./chrome-ctx.mjs";
import { withDocument } from "./fake-dom.mjs";
import { makePv, timeline, tlOf } from "./model-fixtures.mjs";

function setup() {
  const doc = chromePage([["section", "rg-field"]]);
  const root = doc.getElementById("rg-field");
  const field = doc.createElement("div");
  field.setAttribute("id", "field");
  root.appendChild(field);
  const { ctx, calls } = chromeCtx();
  const component = withDocument(doc, () => mount(root, ctx));
  const find = (sel) => root.querySelector(sel);
  const render = (seq) => withDocument(doc, () => component.update(reviewVm(makePv({ tl: tlOf(timeline.final()),
    view: { review: { seq } } }))));
  return { doc, root, field, calls, component, find, render };
}

test("mount appends the banner after the field host's #field and leaves it alone (9.1)", () => {
  const { root, field, find } = setup();
  const banner = find("[data-testid=\"review\"]");
  assert.ok(banner);
  assert.equal(root.children[0], field);
  assert.equal(root.children[1], banner);
  assert.equal(banner.hidden, true);
});

test("reviewing a play: the banner names it and carries its seq", () => {
  const { find, render } = setup();
  render(45);
  const banner = find("[data-testid=\"review\"]");
  const vm = reviewVm(makePv({ tl: tlOf(timeline.final()), view: { review: { seq: 45 } } }));
  assert.equal(banner.hidden, false);
  assert.equal(banner.getAttribute("data-seq"), "45");
  assert.equal(find(".sc-review-text").textContent, vm.text);
  assert.match(vm.text, /^Reviewing .*Esc returns to live\.$/);
});

test("a polite line beside the banner speaks each reviewed play, and goes quiet back at live", () => {
  const { find, render } = setup();
  const live = find("[aria-live=\"polite\"]");
  assert.ok(live, "the live line exists before review starts, so the first step is heard");
  assert.equal(live.textContent, "");
  assert.equal(find("[data-testid=\"review\"]").hasAttribute("role"), false, "the keys are not read as news");
  render(45);
  assert.equal(live.textContent, find(".sc-review-text").textContent);
  render(44);
  assert.match(live.textContent, /^Reviewing /);
  render(null);
  assert.equal(live.textContent, "");
});

test("its keys step earlier, later, and back to live, with the keyboard keys on their caps", () => {
  const { find, render, calls } = setup();
  render(45);
  const earlier = find("[data-review=\"earlier\"]");
  const later = find("[data-review=\"later\"]");
  const live = find("[data-review=\"live\"]");
  assert.equal(earlier.getAttribute("aria-keyshortcuts"), "ArrowLeft");
  assert.equal(later.getAttribute("aria-keyshortcuts"), "ArrowRight");
  assert.equal(live.getAttribute("aria-keyshortcuts"), "Escape");
  click(earlier);
  click(later);
  click(live);
  assert.deepEqual(calls, [["review", -1], ["review", 1], ["exitReview"]]);
});

test("back at the live edge the banner hides and drops its seq", () => {
  const { find, render } = setup();
  render(45);
  render(null);
  const banner = find("[data-testid=\"review\"]");
  assert.equal(banner.hidden, true);
  assert.equal(banner.hasAttribute("data-seq"), false);
});

test("a render that changes nothing writes nothing", () => {
  const { doc, render } = setup();
  render(45);
  const writes = doc.writes;
  render(45);
  assert.equal(doc.writes, writes);
});

test("destroy removes only the banner", () => {
  const { root, field, component } = setup();
  component.destroy();
  assert.deepEqual([...root.children], [field]);
});
