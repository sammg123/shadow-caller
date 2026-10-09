// ui/flag-panel.js (owner A7): the penalty menu (FI 1.6, 2.5; G25; checklist #64 to #75).
import assert from "node:assert/strict";
import test from "node:test";
import { flagsVm } from "../../static/js/model/vm-flags.js";
import { makePv, state } from "./model-fixtures.mjs";
import { findAll, fire, hasClass, inDoc, mountWith, shellDocument } from "./ui-input-harness.mjs";

const load = () => import("../../static/js/ui/flag-panel.js");

async function setup() {
  const { doc, byId } = shellDocument([{ tag: "section", id: "rg-flags", children: [
    { tag: "div", id: "flagPanel", attrs: { hidden: "" } }] }]);
  const mod = await load();
  return { doc, byId, root: byId("flagPanel"), ...mountWith(doc, mod, byId("flagPanel")) };
}

const OPEN = { flag: { open: true, gen: 1 } };
const vmOf = (presented, view = OPEN, extra = {}) => flagsVm(makePv({ presented, view, ...extra }));
const pens = (node) => findAll(node, (n) => n.hasAttribute("data-pen"));

test("closed, the panel stays hidden; open, it shows both columns of 8 coded fouls (#64)", async () => {
  const { doc, root, component } = await setup();
  inDoc(doc, () => component.update(vmOf(state.tilt(), { flag: { open: false, gen: 0 } })));
  assert.equal(root.hidden, true);
  inDoc(doc, () => component.update(vmOf(state.tilt())));
  assert.equal(root.hidden, false);
  const [def, off] = findAll(root, (n) => hasClass(n, "sc-flag-col"));
  assert.equal(def.getAttribute("data-against"), "def");
  assert.equal(def.querySelector(".sc-flag-heading").textContent, "On TB (defense)");
  assert.equal(off.querySelector(".sc-flag-heading").textContent, "On DAL (offense)");
  const coded = (col) => pens(col).filter((b) => !b.getAttribute("data-pen").startsWith("OTHER"));
  assert.deepEqual(coded(def).map((b) => b.getAttribute("data-pen")),
    ["OFFSIDE", "DH", "IC", "DPI", "RTP", "URD", "FM", "12D"]);
  assert.deepEqual(coded(def).map((b) => b.querySelector(".sc-key-cap").textContent), ["O", "H", "C", "D", "R", "U", "M", "Z"]);
  assert.deepEqual(coded(off).map((b) => b.getAttribute("data-pen")), ["FS", "DOG", "ILF", "OH", "OPI", "IBB", "IG", "URO"]);
  const dh = root.querySelector("[data-pen=\"DH\"]");
  assert.equal(dh.querySelector(".sc-key-name").textContent, "Defensive holding");
  assert.equal(dh.querySelector(".sc-key-hint").textContent, "5 yds, auto 1st");
  assert.equal(dh.getAttribute("aria-keyshortcuts"), "H");
  assert.equal(dh.localName, "button");
});

test("Offsetting (W), Other on TB with the automatic 1st down box, and Other on DAL (#64)", async () => {
  const { doc, root, byId, component } = await setup();
  inDoc(doc, () => component.update(vmOf(state.tilt())));
  const offset = root.querySelector("[data-pen=\"OFFSET\"]");
  assert.equal(offset.querySelector(".sc-key-cap").textContent, "W");
  assert.equal(offset.querySelector(".sc-key-name").textContent, "Offsetting");
  assert.equal(offset.querySelector(".sc-key-hint").textContent, "replay the down");
  const otherD = root.querySelector("[data-pen=\"OTHER_D\"]");
  const otherO = root.querySelector("[data-pen=\"OTHER_O\"]");
  assert.equal(otherD.querySelector(".sc-key-name").textContent, "Other on TB");
  assert.equal(otherO.querySelector(".sc-key-name").textContent, "Other on DAL");
  assert.equal(otherD.querySelector(".sc-key-hint").textContent, "yards from the Yards box");
  assert.equal(byId("otherFirst").getAttribute("type"), "checkbox");
  assert.match(root.textContent, /automatic 1st down/);
  assert.equal(byId("flagClose").textContent, "Close (Esc)");
  assert.equal(root.querySelector(".sc-flag-title").textContent, "Flag.");
  assert.match(root.querySelector(".sc-flag-hint").textContent, /^Flag on the play you picked/);
});

test("the note follows the current pick on every render (#65, G25)", async () => {
  const { doc, byId, component } = await setup();
  inDoc(doc, () => component.update(vmOf(state.tilt())));
  assert.equal(byId("flagNote").textContent, "No play picked: the flag just moves the ball.");
  inDoc(doc, () => component.update(vmOf(state.tilt(), { ...OPEN, pick: { k: "A", i: 1, out: null } })));
  assert.equal(byId("flagNote").textContent,
    "Your pick (PA intermediate (10–19)) is wiped out but still scored as his call. Pre-snap fouls ignore it.");
  inDoc(doc, () => component.update(vmOf(state.tilt(), { ...OPEN, pick: { k: "P", i: 0, out: null } })));
  assert.match(byId("flagNote").textContent, /^Your pick \(Short \(0–9 air yds\)\)/);
});

test("each foul button applies its code; Close closes (#66, #68)", async () => {
  const { doc, root, byId, component, named } = await setup();
  inDoc(doc, () => component.update(vmOf(state.tilt())));
  fire(root.querySelector("[data-pen=\"DH\"]"), "click");
  fire(root.querySelector("[data-pen=\"OTHER_D\"]"), "click");
  fire(root.querySelector("[data-pen=\"OFFSET\"]"), "click");
  fire(byId("flagClose"), "click");
  assert.deepEqual(named("applyFlag"), [["DH"], ["OTHER_D"], ["OFFSET"]]);
  assert.deepEqual(named("closeFlag"), [[]]);
});

test("the Form's automatic 1st down reads and writes the box (#72)", async () => {
  const { doc, byId, component } = await setup();
  const form = component.form ?? component;
  inDoc(doc, () => {
    assert.equal(form.readAutoFirst(), false);
    form.writeAutoFirst(true);
    assert.equal(form.readAutoFirst(), true);
    assert.equal(byId("otherFirst").checked, true);
    form.writeAutoFirst(false);
    assert.equal(byId("otherFirst").checked, false);
  });
});

test("the feed hides an open panel; buttons stay put across renders (#93, FI 4.3)", async () => {
  const { doc, root, component } = await setup();
  inDoc(doc, () => component.update(vmOf(state.tilt())));
  const dh = root.querySelector("[data-pen=\"DH\"]");
  inDoc(doc, () => component.update(vmOf(state.feedOn())));
  assert.equal(root.hidden, true);
  inDoc(doc, () => component.update(vmOf(state.tilt(), { ...OPEN, pick: { k: "J", i: 0, out: null } })));
  assert.equal(root.querySelector("[data-pen=\"DH\"]"), dh);
  assert.equal(root.getAttribute("role"), "region");
});

test("before the first state the panel is hidden and nothing throws", async () => {
  const { doc, root, component } = await setup();
  inDoc(doc, () => component.update(flagsVm(makePv())));
  assert.equal(root.hidden, true);
  component.destroy();
});
