// ui/last-play.js (owner A7): the row a retag edits and its retag keys (FI 1.7, 2.8, 3.6; G19; checklist #96, #97,
// #100, #103; DESIGN.md desk: the retag keys light for 8 s after each caller play).
import assert from "node:assert/strict";
import test from "node:test";
import { lastPlayVm } from "../../static/js/model/vm-last-play.js";
import { makePv, patch, state } from "./model-fixtures.mjs";
import { fakeTimers, findAll, fire, hasClass, inDoc, mountWith, shellDocument } from "./ui-input-harness.mjs";

const load = () => import("../../static/js/ui/last-play.js");

async function setup() {
  const { doc, byId } = shellDocument([{ tag: "section", id: "entry", children: [
    { tag: "div", id: "lastPlay", attrs: { hidden: "" } }] }]);
  const timers = fakeTimers();
  const mod = await load();
  return { doc, byId, timers, root: byId("lastPlay"), ...mountWith(doc, mod, byId("lastPlay"), { timers }) };
}

const vmOf = (presented, extra = {}) => lastPlayVm(makePv({ presented, ...extra }));
const retags = (root) => findAll(root, (n) => n.hasAttribute("data-retag"));

test("feed on: heading, play, yards, ESPN's text and the pass retag keys with P current (#96)", async () => {
  const { doc, root, component } = await setup();
  const presented = state.feedOn();
  inDoc(doc, () => component.update(vmOf(presented)));
  assert.equal(root.hidden, false);
  assert.equal(root.getAttribute("data-kind"), "play");
  assert.equal(root.querySelector(".sc-last-heading").textContent, "Last play from ESPN");
  assert.equal(root.querySelector(".sc-last-name").textContent, "Short (0–9 air yds), turnover");
  assert.equal(root.querySelector(".sc-last-yards").textContent, "0 yds");
  assert.equal(root.querySelector(".sc-last-text").textContent, presented.log[0].feed_text);
  const keys = retags(root);
  assert.deepEqual(keys.map((b) => b.getAttribute("data-retag")), ["A", "N", "O", "P"]);
  assert.deepEqual(keys.map((b) => b.querySelector(".sc-key-name").textContent),
    ["Play-action", "Screen", "RPO, thrown", "Plain dropback"]);
  assert.deepEqual(keys.filter((b) => hasClass(b, "cur")).map((b) => b.getAttribute("data-retag")), ["P"]);
  assert.equal(root.querySelector("[data-retag=\"P\"]").getAttribute("aria-current"), "true");
  assert.equal(root.querySelector("[data-retag=\"A\"]").hasAttribute("aria-current"), false);
  assert.equal(root.querySelector("[data-retag=\"A\"]").getAttribute("data-tone"), "pass");
});

test("a retag key retags; during a playing watch it asks to pause first (DC E2.8)", async () => {
  const { doc, root, component, named } = await setup();
  inDoc(doc, () => component.update(vmOf(state.feedOn())));
  fire(root.querySelector("[data-retag=\"A\"]"), "click");
  inDoc(doc, () => component.update(vmOf(state.final(), { version: { watch: { state: "playing" } } })));
  fire(root.querySelector("[data-retag=\"N\"]"), "click");
  assert.deepEqual(named("retag"), [["A", { pauseFirst: false }], ["N", { pauseFirst: true }]]);
});

test("a run row offers O J K L, a retagged row says so (#97)", async () => {
  const { doc, root, component } = await setup();
  const base = state.feedOn();
  const row = { ...base.log[0], dropback: 0, family: "run", leaf: "run_inside", name: "Inside run (A/B gap)", yards: 3,
    retagged: true, turnover: false };
  inDoc(doc, () => component.update(vmOf(patch(base, { log: [row, ...base.log.slice(1)] }))));
  assert.deepEqual(retags(root).map((b) => b.getAttribute("data-retag")), ["O", "J", "K", "L"]);
  assert.equal(retags(root).filter((b) => hasClass(b, "cur")).length, 0, "J, K and L are never current");
  assert.equal(root.querySelector(".sc-last-yards").textContent, "3 yds · retagged");
  assert.equal(root.querySelector("[data-retag=\"O\"]").getAttribute("data-tone"), "rpo");
});

test("waiting for the first play: heading and text only (#100)", async () => {
  const { doc, root, component } = await setup();
  inDoc(doc, () => component.update(vmOf(patch(state.feedOn(), { log: [] }))));
  assert.equal(root.getAttribute("data-kind"), "waiting");
  assert.equal(root.querySelector(".sc-last-heading").textContent, "Waiting for the first DAL play");
  assert.equal(root.querySelector(".sc-last-text").textContent, "Plays appear here a few seconds after ESPN posts them.");
  assert.equal(root.querySelector(".sc-last-name").hidden, true);
  assert.equal(retags(root).length, 0);
});

test("manual entry hides the panel (#103)", async () => {
  const { doc, root, component } = await setup();
  inDoc(doc, () => component.update(vmOf(state.feedOn())));
  inDoc(doc, () => component.update(vmOf(state.final())));
  assert.equal(root.hidden, true);
});

test("a new caller play lights the retag keys for 8 s; the first render and a re-render do not", async () => {
  const { doc, root, timers, component } = await setup();
  const base = state.feedOn();
  inDoc(doc, () => component.update(vmOf(base)));
  assert.equal(root.getAttribute("data-fresh"), "false", "a play already on screen at load is not news");
  inDoc(doc, () => component.update(vmOf(patch(base, { version: 99 }))));
  assert.equal(root.getAttribute("data-fresh"), "false");
  const next = { ...base.log[0], seq: 60 };
  inDoc(doc, () => component.update(vmOf(patch(base, { log: [next, ...base.log] }))));
  assert.equal(root.getAttribute("data-fresh"), "true");
  assert.equal(timers.size, 1);
  timers.runAll();
  assert.equal(root.getAttribute("data-fresh"), "false");
  inDoc(doc, () => component.update(vmOf(base)));
  assert.equal(root.getAttribute("data-fresh"), "false", "an undo back to an older play is not news");
  inDoc(doc, () => component.update(vmOf(patch(base, { log: [{ ...next, seq: 61 }, ...base.log] }))));
  assert.equal(root.getAttribute("data-fresh"), "true");
  component.destroy();
  assert.equal(timers.size, 0, "destroy clears the timer");
});

test("before the first state the panel is hidden and nothing throws", async () => {
  const { doc, root, component } = await setup();
  inDoc(doc, () => component.update(lastPlayVm(makePv())));
  assert.equal(root.hidden, true);
});
