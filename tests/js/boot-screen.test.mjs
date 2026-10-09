// ui/boot-screen.js (owner A9; ui-architecture.md 2.6, 3.1, 5.4; FI 3.11; #119, #120): loading, failed, restart.
import assert from "node:assert/strict";
import test from "node:test";
import { mount } from "../../static/js/ui/boot-screen.js";
import { bootVm } from "../../static/js/model/vm-conn.js";
import { chromeCtx, chromePage, click } from "./chrome-ctx.mjs";
import { withDocument } from "./fake-dom.mjs";
import { NOW, makePv } from "./model-fixtures.mjs";

function setup() {
  const doc = chromePage([["div", "rg-boot"]]);
  const { ctx, calls } = chromeCtx();
  const root = doc.getElementById("rg-boot");
  const component = withDocument(doc, () => mount(root, ctx));
  const find = (sel) => root.querySelector(sel);
  const render = (boot, conn = {}, now = NOW) => withDocument(doc, () => component.update(bootVm(makePv({ boot, conn, now }))));
  return { doc, root, calls, component, find, render };
}

test("loading: the board says so, with the app's name and no retry key", () => {
  const { find, render } = setup();
  render({ phase: "loading" });
  const screen = find("[data-testid=\"boot\"]");
  assert.equal(screen.hidden, false);
  assert.equal(screen.getAttribute("data-phase"), "loading");
  assert.equal(find(".sc-boot-title").textContent, "Shadow Play-Caller");
  assert.equal(find(".sc-boot-heading").textContent, "Loading the game…");
  assert.equal(find("[data-testid=\"boot-retry\"]").hidden, true);
  assert.equal(screen.getAttribute("aria-busy"), "true");
});

test("#120: a failed first load says so, counts down and offers Retry now", () => {
  const { find, render, calls } = setup();
  render({ phase: "failed" }, { retryAt: NOW + 3000 });
  const screen = find("[data-testid=\"boot\"]");
  assert.equal(screen.getAttribute("data-phase"), "failed");
  assert.equal(screen.getAttribute("aria-busy"), "false");
  assert.equal(find(".sc-boot-heading").textContent, "Can't reach the app server");
  assert.equal(find(".sc-boot-text").textContent, "Retrying in 3 s.");
  const retry = find("[data-testid=\"boot-retry\"]");
  assert.equal(retry.hidden, false);
  click(retry);
  assert.deepEqual(calls, [["retryNow"]]);
});

test("#119: the restart screen tells Sam what to type, with the command in bold", () => {
  const { find, render } = setup();
  render({ phase: "restart" });
  assert.equal(find(".sc-boot-heading").textContent, "Restart the server to finish the update");
  const text = find(".sc-boot-text");
  assert.equal(text.textContent, "In Terminal press Ctrl+C, run bash start.sh, then refresh this page. Your logged snaps are saved.");
  assert.deepEqual([...text.querySelectorAll("strong")].map((n) => n.textContent), ["bash start.sh"]);
  assert.equal(find("[data-testid=\"boot-retry\"]").hidden, true);
});

test("the screen is announced once per phase, not on every countdown second", () => {
  const { root, render } = setup();
  const live = () => root.querySelector("[aria-live]");
  render({ phase: "failed" }, { retryAt: NOW + 3000 });
  assert.equal(live().textContent, "Can't reach the app server. Retrying in 3 s.");
  render({ phase: "failed" }, { retryAt: NOW + 3000 }, NOW + 1000);
  assert.equal(live().textContent, "Can't reach the app server. Retrying in 3 s.");
  render({ phase: "restart" });
  assert.match(live().textContent, /^Restart the server to finish the update\./);
});

test("ready: the screen goes away", () => {
  const { find, render } = setup();
  render({ phase: "loading" });
  render({ phase: "ready" });
  assert.equal(find("[data-testid=\"boot\"]").hidden, true);
  assert.equal(find("[data-testid=\"boot\"]").getAttribute("data-phase"), "ready");
});

test("a render that changes nothing writes nothing", () => {
  const { doc, render } = setup();
  render({ phase: "failed" }, { retryAt: NOW + 3000 });
  const writes = doc.writes;
  render({ phase: "failed" }, { retryAt: NOW + 3000 });
  assert.equal(doc.writes, writes);
});

test("destroy empties its root", () => {
  const { root, component } = setup();
  component.destroy();
  assert.equal(root.children.length, 0);
});
