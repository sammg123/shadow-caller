// ui/conn-banner.js (owner A9; ui-architecture.md 2.6, 3.9, 5.4; G11, #116 to #121): the connection banner.
import assert from "node:assert/strict";
import test from "node:test";
import { mount } from "../../static/js/ui/conn-banner.js";
import { connVm } from "../../static/js/model/vm-conn.js";
import { chromeCtx, chromePage, click } from "./chrome-ctx.mjs";
import { withDocument } from "./fake-dom.mjs";
import { NOW, makePv } from "./model-fixtures.mjs";

function setup() {
  const doc = chromePage([["div", "rg-conn"]]);
  const { ctx, calls } = chromeCtx();
  const root = doc.getElementById("rg-conn");
  const component = withDocument(doc, () => mount(root, ctx));
  const find = (sel) => root.querySelector(sel);
  const render = (conn, now = NOW) => withDocument(doc, () => component.update(connVm(makePv({ conn, now }))));
  const live = () => root.querySelector("[aria-live]");
  return { doc, root, calls, component, find, render, live };
}

test("online: nothing shows; the polite region is in place and quiet", () => {
  const { find, render, live } = setup();
  render({ failures: 0 });
  const banner = find("[data-testid=\"conn\"]");
  assert.ok(banner);
  assert.equal(banner.hidden, true);
  assert.equal(banner.getAttribute("data-conn"), "online");
  assert.ok(live(), "the live region exists before anything is said");
  assert.equal(live().textContent, "");
});

test("one failure: the quiet 'Reconnecting…' line, no retry key (3.9)", () => {
  const { find, render, live } = setup();
  render({ failures: 1, retryAt: NOW + 2000 });
  const banner = find("[data-testid=\"conn\"]");
  assert.equal(banner.hidden, false);
  assert.equal(banner.getAttribute("data-conn"), "retrying");
  assert.equal(find(".sc-conn-text").textContent, "Reconnecting…");
  assert.equal(find("[data-testid=\"conn-retry\"]").hidden, true);
  assert.equal(live().textContent, "Reconnecting…");
});

test("three failures: offline, the countdown, and Retry now (G11)", () => {
  const { find, render, calls } = setup();
  render({ failures: 3, retryAt: NOW + 4000 });
  const banner = find("[data-testid=\"conn\"]");
  assert.equal(banner.getAttribute("data-conn"), "offline");
  assert.equal(find(".sc-conn-text").textContent, "Can't reach the app server. Retrying in 4 s.");
  const retry = find("[data-testid=\"conn-retry\"]");
  assert.equal(retry.hidden, false);
  assert.equal(retry.textContent, "Retry now");
  click(retry);
  assert.deepEqual(calls, [["retryNow"]]);
});

test("the countdown ticks on screen but is announced only when the state changes", () => {
  const { find, render, live } = setup();
  render({ failures: 3, retryAt: NOW + 4000 });
  assert.equal(live().textContent, "Can't reach the app server. Retrying in 4 s.");
  render({ failures: 3, retryAt: NOW + 4000 }, NOW + 1000);
  assert.equal(find(".sc-conn-text").textContent, "Can't reach the app server. Retrying in 3 s.");
  assert.equal(live().textContent, "Can't reach the app server. Retrying in 4 s.", "no chatter every second");
});

test("back online: the banner hides and the region goes quiet", () => {
  const { find, render, live } = setup();
  render({ failures: 4, retryAt: NOW + 8000 });
  render({ failures: 0 });
  assert.equal(find("[data-testid=\"conn\"]").hidden, true);
  assert.equal(find("[data-testid=\"conn\"]").getAttribute("data-conn"), "online");
  assert.equal(live().textContent, "");
});

test("a render that changes nothing writes nothing", () => {
  const { doc, render } = setup();
  render({ failures: 3, retryAt: NOW + 4000 });
  const writes = doc.writes;
  render({ failures: 3, retryAt: NOW + 4000 });
  assert.equal(doc.writes, writes);
});

test("destroy empties its root", () => {
  const { root, component } = setup();
  component.destroy();
  assert.equal(root.children.length, 0);
});
