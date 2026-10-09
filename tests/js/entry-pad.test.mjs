// ui/entry-pad.js (owner A7): the manual pad, the chosen line and the Form it implements (FI 1.3 to 1.5, 2.4, 3.6;
// ui-architecture.md 2.6, 9.1; checklist #5, #37 to #47, #59, #60, #93).
import assert from "node:assert/strict";
import test from "node:test";
import { entryVm } from "../../static/js/model/vm-entry.js";
import { makePv, state } from "./model-fixtures.mjs";
import { findAll, fire, focusIn, hasClass, inDoc, mountWith, shellDocument } from "./ui-input-harness.mjs";

const load = () => import("../../static/js/ui/entry-pad.js");

async function setup(results) {
  const { doc, byId } = shellDocument([{ tag: "section", id: "entry", attrs: { "data-region": "entry" }, children: [
    { tag: "div", id: "lastPlay", attrs: { hidden: "" } }, { tag: "div", id: "manualEntry" },
    { tag: "div", attrs: { class: "short", "data-mount": "shorthand" } }, { tag: "p", id: "entryHint" },
  ] }]);
  const mod = await load();
  return { doc, byId, root: byId("entry"), ...mountWith(doc, mod, byId("entry"), { results }) };
}

const vmOf = (presented, view = {}, extra = {}) => entryVm(makePv({ presented, view, ...extra }));
const KEY_ORDER = ["J", "K", "L", "P", "A", "N", "O"];

test("mount fills #manualEntry and keeps the other #entry children (9.1: never clears #entry)", async () => {
  const { byId, root } = await setup();
  assert.ok(byId("lastPlay") && byId("manualEntry") && byId("entryHint"));
  assert.ok(root.querySelector("[data-mount=\"shorthand\"]"), "the shorthand root survives");
  assert.deepEqual(findAll(root, (n) => n.hasAttribute("data-k")).map((n) => n.getAttribute("data-k")), KEY_ORDER);
  assert.deepEqual(findAll(root, (n) => n.hasAttribute("data-out")).map((n) => n.getAttribute("data-out")),
    ["incomplete", "sack", "scramble"]);
  for (const id of ["flagBtn", "chosen", "yards", "fTD", "fTO", "logBtn"]) assert.ok(byId(id), id);
  assert.equal(byId("yards").value, "0");
  assert.equal(byId("fTD").getAttribute("type"), "checkbox");
  assert.equal(byId("fTO").getAttribute("type"), "checkbox");
  for (const key of findAll(root, (n) => n.hasAttribute("data-k") || n.hasAttribute("data-out"))) {
    assert.ok(hasClass(key, "key"), "legacy .key hook");
    assert.equal(key.localName, "button");
  }
});

test("key texts follow FI 3.6: letter, name, hint", async () => {
  const { root, byId } = await setup();
  const j = root.querySelector("[data-k=\"J\"]");
  assert.equal(j.querySelector(".sc-key-cap").textContent, "J");
  assert.equal(j.querySelector(".sc-key-name").textContent, "Left");
  assert.equal(j.querySelector(".sc-key-hint").textContent, "JJ: outside edge");
  assert.equal(root.querySelector("[data-out=\"sack\"]").querySelector(".sc-key-name").textContent, "Sack");
  assert.equal(byId("flagBtn").querySelector(".sc-key-cap").textContent, "X");
  assert.equal(byId("flagBtn").querySelector(".sc-key-name").textContent, "Flag");
  assert.equal(byId("logBtn").textContent, "Log play");
  assert.equal(root.querySelector(".sc-pad-title").textContent, "What did he call?");
});

test("off the field the pad is dimmed, nothing is picked and Log play is disabled (#5, #59)", async () => {
  const { doc, root, byId, component } = await setup();
  inDoc(doc, () => component.update(vmOf(state.final())));
  assert.equal(root.getAttribute("data-dim"), "true");
  assert.equal(root.getAttribute("data-entry-mode"), "manual");
  assert.equal(byId("manualEntry").hidden, false);
  assert.ok(byId("logBtn").hasAttribute("disabled"));
  assert.equal(byId("chosen").querySelector(".sc-chosen-name").textContent, "Pick the play");
  assert.equal(byId("chosen").getAttribute("data-placeholder"), "true");
  assert.equal(byId("entryHint").textContent.startsWith("Press the play key (tap again to cycle)"), true);
});

test("a pick lights its key (R lights K) and the chosen line shows the name and the tap hint (#38, #39, #41)",
  async () => {
    const { doc, root, byId, component } = await setup();
    inDoc(doc, () => component.update(vmOf(state.tilt(), { pick: { k: "P", i: 0, out: null } })));
    const on = () => findAll(root, (n) => n.hasAttribute("data-k") && hasClass(n, "on")).map((n) => n.getAttribute("data-k"));
    assert.deepEqual(on(), ["P"]);
    assert.equal(root.querySelector("[data-k=\"P\"]").getAttribute("aria-pressed"), "true");
    assert.equal(root.querySelector("[data-k=\"J\"]").getAttribute("aria-pressed"), "false");
    assert.equal(byId("chosen").textContent, "Short (0–9 air yds) tap P for Intermediate (10–19)");
    assert.equal(byId("chosen").getAttribute("data-placeholder"), "false");
    assert.equal(root.getAttribute("data-dim"), "false");
    assert.equal(byId("logBtn").hasAttribute("disabled"), false);
    inDoc(doc, () => component.update(vmOf(state.tilt(), { pick: { k: "R", i: 0, out: null } })));
    assert.deepEqual(on(), ["K"]);
    assert.equal(byId("chosen").textContent, "Inside run (A/B gap)");
    assert.equal(byId("chosen").querySelector(".sc-chosen-hint").hidden, true);
  });

test("an outcome lights its key and resolves the chosen line (#42, #43)", async () => {
  const { doc, root, byId, component } = await setup();
  inDoc(doc, () => component.update(vmOf(state.tilt(), { pick: { k: "O", i: 1, out: "sack" } })));
  assert.ok(hasClass(root.querySelector("[data-out=\"sack\"]"), "on"));
  assert.equal(root.querySelector("[data-out=\"sack\"]").getAttribute("aria-pressed"), "true");
  assert.equal(hasClass(root.querySelector("[data-out=\"incomplete\"]"), "on"), false);
  assert.equal(byId("chosen").textContent, "RPO, sack");
});

test("buttons call the actions: tap, outcome, flag toggle, log (#60)", async () => {
  const { root, byId, named } = await setup();
  fire(root.querySelector("[data-k=\"J\"]"), "click");
  fire(root.querySelector("[data-k=\"J\"]"), "click");
  fire(root.querySelector("[data-out=\"incomplete\"]"), "click");
  fire(byId("flagBtn"), "click");
  fire(byId("logBtn"), "click");
  assert.deepEqual(named("tap"), [["J"], ["J"]]);
  assert.deepEqual(named("outcome"), [["incomplete"]]);
  assert.deepEqual(named("toggleFlag"), [[]]);
  assert.deepEqual(named("logPlay"), [[]]);
});

test("the flag key shows the panel's state: .on and aria-expanded (5.1)", async () => {
  const { doc, byId, component } = await setup();
  inDoc(doc, () => component.update(vmOf(state.tilt(), { flag: { open: true, gen: 1 } })));
  assert.ok(hasClass(byId("flagBtn"), "on"));
  assert.equal(byId("flagBtn").getAttribute("aria-expanded"), "true");
  assert.equal(byId("flagBtn").getAttribute("aria-controls"), "flagPanel");
  inDoc(doc, () => component.update(vmOf(state.tilt(), { flag: { open: false, gen: 1 } })));
  assert.equal(hasClass(byId("flagBtn"), "on"), false);
  assert.equal(byId("flagBtn").getAttribute("aria-expanded"), "false");
});

test("the Form: Yards, Touchdown and Turnover read and write; focusYards focuses and selects once", async () => {
  const { doc, byId, component } = await setup();
  const form = component.form ?? component;
  const yards = byId("yards");
  let selects = 0;
  yards.select = () => { selects += 1; };
  inDoc(doc, () => {
    form.writeYards("12");
    assert.equal(form.readYards(), "12");
    form.writeTD(true);
    form.writeTO(true);
    assert.deepEqual([form.readTD(), form.readTO(), byId("fTD").checked, byId("fTO").checked], [true, true, true, true]);
    form.writeTD(false);
    assert.equal(form.readTD(), false);
    form.focusYards();
    assert.equal(doc.activeElement, yards);
    const after = selects;
    assert.ok(after >= 1, "focus selects the value");
    form.focusYards();
    assert.equal(selects, after, "already focused: the caret is left alone (FI 4.6)");
    form.writeYards("0");
    assert.equal(selects, after + 1, "a write while focused selects, so the next digit replaces it");
  });
});

test("Yards selects its value on focus (FI 1.8)", async () => {
  const { doc, byId } = await setup();
  const yards = byId("yards");
  let selects = 0;
  yards.select = () => { selects += 1; };
  inDoc(doc, () => focusIn(yards));
  assert.ok(selects >= 1);
});

test("feed and watch hide the pad, undim and switch the hint (#93)", async () => {
  const { doc, root, byId, component } = await setup();
  inDoc(doc, () => component.update(vmOf(state.feedOn())));
  assert.equal(byId("manualEntry").hidden, true);
  assert.equal(root.getAttribute("data-dim"), "false");
  assert.equal(root.getAttribute("data-entry-mode"), "feed");
  assert.match(byId("entryHint").textContent, /^ESPN logs each play/);
  inDoc(doc, () => component.update(vmOf(state.final(), {}, { version: { watch: { state: "paused" } } })));
  assert.equal(root.getAttribute("data-entry-mode"), "watch");
  assert.match(byId("entryHint").textContent, /^Plays log themselves/);
});

test("mounting where #manualEntry is missing fails loudly (the shell shows a notice)", async () => {
  const mod = await load();
  const { doc, byId } = shellDocument([{ tag: "section", id: "entry" }]);
  assert.throws(() => mountWith(doc, mod, byId("entry")), /#manualEntry/);
});

test("the pad renders before the first state and destroy is safe", async () => {
  const { doc, byId, component } = await setup();
  inDoc(doc, () => component.update(entryVm(makePv())));
  assert.ok(byId("logBtn").hasAttribute("disabled"));
  component.destroy();
});
