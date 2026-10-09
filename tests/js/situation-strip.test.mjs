// ui/situation-strip.js (owner A7): the editable situation (FI 1.8, 2.3, 3.4; ui-architecture.md 4.5, 4.6 G1 G2 G3;
// checklist #9 to #26). The actions stub stands in for core/actions.commitStrip and friends; their own rules
// (core/strip.js) are tested in strip.test.mjs, so here the component's side of each rule is pinned.
import assert from "node:assert/strict";
import test from "node:test";
import { situationVm } from "../../static/js/model/vm-situation.js";
import { makePv, patch, readFixture, state } from "./model-fixtures.mjs";
import { fire, focusIn, hasClass, inDoc, mountWith, settle, shellDocument, typeInto } from "./ui-input-harness.mjs";

const load = () => import("../../static/js/ui/situation-strip.js");
const fresh = () => readFixture("state_fresh.json");
const drive = () => readFixture("state_drive_d25.json");
const FIELDS = ["iQtr", "iClock", "iOff", "iOpp", "iDown", "iTogo", "iYard"];

async function setup(results = {}) {
  const { doc, byId } = shellDocument([{ tag: "section", id: "rg-situation" }]);
  const mod = await load();
  const sent = { commitStrip: () => Promise.resolve({ sent: true, ok: true }), flipSide: () => Promise.resolve({ ok: true }),
    endDrive: () => Promise.resolve(), ...results };
  return { doc, byId, root: byId("rg-situation"), ...mountWith(doc, mod, byId("rg-situation"), { results: sent }) };
}

const vmOf = (presented, view = {}) => situationVm(makePv({ presented, view }));

test("mount creates every strip hook of 5.1", async () => {
  const { byId } = await setup();
  for (const id of [...FIELDS, "clockEst", "lOff", "lOpp", "iSide", "sideTxt", "driveInfo", "endRow"]) assert.ok(byId(id), id);
  for (const id of FIELDS) {
    assert.equal(byId(id).localName, "input", id);
    assert.equal(byId(id).getAttribute("type"), "text", `${id} is a text input, so shortcuts never fire in it (#49)`);
  }
  assert.equal(byId("iSide").localName, "button");
  assert.equal(byId("iSide").getAttribute("type"), "button");
});

test("a fresh game shows Q1 15:00, 0 and 0, 1st & 10, DAL 25; est. and the end row are hidden (#4, #5)", async () => {
  const { doc, root, byId, component } = await setup();
  inDoc(doc, () => component.update(vmOf(fresh())));
  assert.deepEqual(FIELDS.map((id) => byId(id).value), ["1", "15:00", "0", "0", "1", "10", "25"]);
  assert.equal(byId("sideTxt").textContent, "DAL");
  assert.equal(hasClass(byId("iSide"), "opp"), false);
  assert.equal(byId("iSide").getAttribute("data-side"), "own");
  assert.equal(byId("iSide").getAttribute("title"), "Ball on DAL's own side. Click to switch.");
  assert.equal(byId("clockEst").hidden, true);
  assert.equal(byId("endRow").hidden, true);
  assert.equal(byId("driveInfo").textContent, "DAL off the field. Type where they get the ball in Ball on.");
  assert.equal(byId("driveInfo").getAttribute("data-cue"), "true");
  assert.equal(byId("lOff").textContent, "DAL");
  assert.equal(byId("lOpp").textContent, "TB");
  assert.equal(byId("iOff").getAttribute("aria-label"), "DAL score");
  assert.match(root.querySelector(".sc-strip-note").textContent, /^Click any number and type; Enter or Tab saves\./);
});

test("with a drive: drive info, the end-of-drive keys, To go G and the opponent's side (#17, #18)", async () => {
  const { doc, root, byId, component } = await setup();
  inDoc(doc, () => component.update(vmOf(drive())));
  assert.equal(byId("driveInfo").textContent, "Drive 1, snap 1 of the game");
  assert.equal(byId("driveInfo").getAttribute("data-cue"), "false");
  assert.equal(byId("endRow").hidden, false);
  const ends = [...root.querySelectorAll("[data-end]")];
  assert.deepEqual(ends.map((b) => [b.getAttribute("data-end"), b.textContent]),
    [["punt", "Punt"], ["fg", "FG good"], ["fg_miss", "FG missed"], ["half", "Half over"]]);
  const goal = patch(drive(), { sit: { ...drive().sit, yardline_100: 6, togo: 6 } });
  inDoc(doc, () => component.update(vmOf(goal)));
  assert.equal(byId("iTogo").value, "G");
  assert.equal(byId("iYard").value, "6");
  assert.equal(byId("sideTxt").textContent, "TB");
  assert.ok(hasClass(byId("iSide"), "opp"));
  assert.equal(byId("iSide").getAttribute("data-side"), "opp");
});

test("est. shows when the clock is estimated (#26)", async () => {
  const { doc, byId, component } = await setup();
  inDoc(doc, () => component.update(vmOf(patch(fresh(), { sit: { ...fresh().sit, clock_estimated: true } }))));
  assert.equal(byId("clockEst").hidden, false);
  assert.equal(byId("clockEst").textContent, "est.");
  assert.equal(byId("clockEst").getAttribute("title"), "Estimated from snaps; type the real clock");
});

test("typed text then Enter commits once, blurs, and does not focus Yards off the field (#9, G2)", async () => {
  const { doc, byId, component, named, formCalls } = await setup();
  inDoc(doc, () => component.update(vmOf(fresh())));
  const yard = byId("iYard");
  inDoc(doc, () => {
    focusIn(yard);
    typeInto(yard, "25");
    assert.equal(fire(yard, "keydown", { key: "Enter" }), true, "Enter is the strip's own key");
  });
  await settle();
  assert.deepEqual(named("commitStrip"), [["iYard", "25", true]]);
  assert.notEqual(doc.activeElement, yard, "Enter blurs the field");
  assert.deepEqual(formCalls.filter((c) => c[0] === "focusYards"), [], "no drive was active before the save");
});

test("with a drive active, Enter in an edited field focuses Yards (#21)", async () => {
  const { doc, byId, component, named, formCalls } = await setup();
  inDoc(doc, () => component.update(vmOf(drive())));
  const down = byId("iDown");
  inDoc(doc, () => {
    focusIn(down);
    typeInto(down, "2");
    fire(down, "keydown", { key: "Enter" });
  });
  await settle();
  assert.deepEqual(named("commitStrip"), [["iDown", "2", true]]);
  assert.deepEqual(formCalls.filter((c) => c[0] === "focusYards").length, 1);
});

test("Enter in a field nobody typed in sends nothing and blurs (G2 needs an input event)", async () => {
  const { doc, byId, component, named } = await setup();
  inDoc(doc, () => component.update(vmOf(fresh())));
  const qtr = byId("iQtr");
  inDoc(doc, () => {
    focusIn(qtr);
    fire(qtr, "keydown", { key: "Enter" });
  });
  await settle();
  assert.deepEqual(named("commitStrip"), []);
  assert.notEqual(doc.activeElement, qtr);
});

test("blur after typing commits like Enter (Tab out, #20); a blur without typing sends nothing", async () => {
  const { doc, byId, component, named } = await setup();
  inDoc(doc, () => component.update(vmOf(fresh())));
  const clock = byId("iClock");
  inDoc(doc, () => {
    focusIn(clock);
    typeInto(clock, "841");
    clock.blur();
    fire(clock, "blur");
  });
  await settle();
  assert.deepEqual(named("commitStrip"), [["iClock", "841", true]]);
  inDoc(doc, () => {
    focusIn(byId("iQtr"));
    byId("iQtr").blur();
    fire(byId("iQtr"), "blur");
  });
  await settle();
  assert.equal(named("commitStrip").length, 1);
});

test("Escape after typing restores the server value with no request and blurs (#22, G1)", async () => {
  const { doc, byId, component, named } = await setup();
  inDoc(doc, () => component.update(vmOf(fresh())));
  const togo = byId("iTogo");
  inDoc(doc, () => {
    focusIn(togo);
    typeInto(togo, "7");
    assert.equal(fire(togo, "keydown", { key: "Escape" }), true);
    fire(togo, "blur");
  });
  await settle();
  assert.equal(togo.value, "10");
  assert.deepEqual(named("commitStrip"), []);
  assert.notEqual(doc.activeElement, togo);
});

test("Escape without typing shows the server value too (#23, G1: never blanks the field)", async () => {
  const { doc, byId, component, named } = await setup();
  inDoc(doc, () => component.update(vmOf(fresh())));
  const qtr = byId("iQtr");
  inDoc(doc, () => {
    focusIn(qtr);
    fire(qtr, "keydown", { key: "Escape" });
  });
  await settle();
  assert.equal(qtr.value, "1");
  assert.deepEqual(named("commitStrip"), []);
});

test("a rejected value stays with the invalid style; Escape brings the server value back and clears it (#14, #23)",
  async () => {
    const { doc, byId, component, named } = await setup();
    const clock = byId("iClock");
    inDoc(doc, () => component.update(vmOf(fresh(), { stripRejected: { iClock: "16:00" } })));
    assert.equal(clock.value, "16:00");
    assert.ok(hasClass(clock, "bad"));
    assert.equal(clock.getAttribute("aria-invalid"), "true");
    inDoc(doc, () => {
      focusIn(clock);
      fire(clock, "keydown", { key: "Escape" });
    });
    await settle();
    assert.equal(clock.value, "15:00");
    assert.equal(hasClass(clock, "bad"), false);
    assert.equal(clock.hasAttribute("aria-invalid"), false);
    assert.deepEqual(named("commitStrip"), [["iClock", "15:00", false]], "an unedited commit only clears the rejection");
    inDoc(doc, () => component.update(vmOf(fresh())));
    assert.equal(clock.value, "15:00");
  });

test("a rejection or a new value that came while the field had focus shows once it is left (FI 4.4, #25)",
  async () => {
    const { doc, byId, component, named } = await setup();
    inDoc(doc, () => component.update(vmOf(fresh())));
    const clock = byId("iClock");
    const qtr = byId("iQtr");
    inDoc(doc, () => {
      focusIn(clock);
      component.update(vmOf(fresh(), { stripRejected: { iClock: "16:00" } }));
      assert.equal(clock.value, "15:00", "the focused field is left alone");
      clock.blur();
      fire(clock, "blur");
      focusIn(qtr);
      component.update(vmOf(patch(fresh(), { sit: { ...fresh().sit, qtr: 2 } })));
      assert.equal(qtr.value, "1");
      qtr.blur();
      fire(qtr, "blur");
    });
    await settle();
    assert.equal(clock.value, "15:00", "a rejection nobody is looking at any more is let go");
    assert.deepEqual(named("commitStrip"), [["iClock", "15:00", false]]);
    assert.equal(qtr.value, "2", "the newer server value shows once the field is left");
  });

test("Enter that confirms an IME composition is not a save", async () => {
  const { doc, byId, component, named } = await setup();
  inDoc(doc, () => component.update(vmOf(fresh())));
  const yard = byId("iYard");
  inDoc(doc, () => {
    focusIn(yard);
    typeInto(yard, "20");
    assert.equal(fire(yard, "keydown", { key: "Enter", isComposing: true }), false);
  });
  await settle();
  assert.deepEqual(named("commitStrip"), []);
  assert.equal(doc.activeElement, yard);
});

test("Escape and Enter leave the field once: the blur they cause sends nothing more", async () => {
  const { doc, byId, component, named } = await setup();
  inDoc(doc, () => component.update(vmOf(fresh(), { stripRejected: { iClock: "16:00" } })));
  const clock = byId("iClock");
  clock.blur = function blurWithEvent() {
    if (doc.activeElement === this) doc.activeElement = doc.body;
    fire(this, "blur");
  };
  inDoc(doc, () => {
    focusIn(clock);
    fire(clock, "keydown", { key: "Escape" });
  });
  await settle();
  assert.deepEqual(named("commitStrip"), [["iClock", "15:00", false]], "one clear, not two");
  inDoc(doc, () => {
    focusIn(clock);
    typeInto(clock, "9:00");
    fire(clock, "keydown", { key: "Enter" });
  });
  await settle();
  assert.deepEqual(named("commitStrip").slice(1), [["iClock", "9:00", true]], "one save, not two");
});

test("an emptied field sends nothing and gets the server value back (#24)", async () => {
  const { doc, byId, component, named } = await setup({ commitStrip: () => Promise.resolve({ sent: false, ok: false }) });
  inDoc(doc, () => component.update(vmOf(fresh())));
  const off = byId("iOff");
  inDoc(doc, () => {
    focusIn(off);
    typeInto(off, "");
    fire(off, "keydown", { key: "Enter" });
  });
  await settle();
  assert.deepEqual(named("commitStrip"), [["iOff", "", true]]);
  assert.equal(off.value, "0");
});

test("a render never overwrites the field being typed in (#25, FI 4.3)", async () => {
  const { doc, byId, component } = await setup();
  inDoc(doc, () => component.update(vmOf(fresh())));
  const opp = byId("iOpp");
  inDoc(doc, () => {
    focusIn(opp);
    typeInto(opp, "1");
    component.update(vmOf(patch(fresh(), { sit: { ...fresh().sit, score_opp: 7, qtr: 2 } })));
  });
  assert.equal(opp.value, "1");
  assert.equal(byId("iQtr").value, "2", "the other fields still update");
});

test("the side chip flips the side with the typed number, then focuses and selects Ball on (#12, #18)", async () => {
  const { doc, byId, component, named } = await setup();
  inDoc(doc, () => component.update(vmOf(fresh())));
  const yard = byId("iYard");
  let selects = 0;
  yard.select = () => { selects += 1; };
  inDoc(doc, () => fire(byId("iSide"), "click"));
  await inDoc(doc, () => settle());
  assert.deepEqual(named("flipSide"), [["25"]]);
  assert.equal(doc.activeElement, yard);
  assert.ok(selects >= 1);
});

test("the end-of-drive keys call endDrive (#86, #87)", async () => {
  const { doc, root, component, named } = await setup();
  inDoc(doc, () => component.update(vmOf(drive())));
  for (const b of root.querySelectorAll("[data-end]")) fire(b, "click");
  await settle();
  assert.deepEqual(named("endDrive"), [["punt"], ["fg"], ["fg_miss"], ["half"]]);
});

test("the strip selects a field's whole value when it gets focus (FI 1.8)", async () => {
  const { doc, byId } = await setup();
  const qtr = byId("iQtr");
  let selects = 0;
  qtr.select = () => { selects += 1; };
  inDoc(doc, () => focusIn(qtr));
  assert.ok(selects >= 1);
});

test("scores are named by team for screen readers (G13); empty before the first state", async () => {
  const { doc, byId, component } = await setup();
  inDoc(doc, () => component.update(situationVm(makePv())));
  assert.equal(byId("iQtr").value, "");
  assert.equal(byId("endRow").hidden, true);
  inDoc(doc, () => component.update(vmOf(state.final())));
  assert.equal(byId("iOff").getAttribute("aria-label"), "DAL score");
  component.destroy();
});
