// ui/masthead.js (owner A9; ui-architecture.md 2.6, 5.1, 5.4; FI 3.1, #1): title, game, who is modelled, the game
// keys (Undo, Export CSV, Reset) and the view keys (camera V, booth B, scorecard G).
import assert from "node:assert/strict";
import test from "node:test";
import { mount } from "../../static/js/ui/masthead.js";
import { mastheadVm } from "../../static/js/model/vm-masthead.js";
import { chromeCtx, chromePage, click } from "./chrome-ctx.mjs";
import { withDocument } from "./fake-dom.mjs";
import { makePv, state } from "./model-fixtures.mjs";

function setup() {
  const doc = chromePage([["header", "rg-masthead"]]);
  const { ctx, calls } = chromeCtx();
  const root = doc.getElementById("rg-masthead");
  const component = withDocument(doc, () => mount(root, ctx));
  return { doc, root, ctx, calls, component, find: (sel) => root.querySelector(sel) };
}

const vmOf = (over = {}) => mastheadVm(makePv({ presented: state.final(), ...over }));

test("mount builds the masthead once, inside its root only", () => {
  const { doc, root, find } = setup();
  assert.equal(find("h1").textContent, "Shadow Play-Caller");
  for (const sel of ["#gameLabel", "#whoLabel", "#undoBtn", "#resetBtn", "[data-testid=\"camera-mode\"]",
    "[data-testid=\"booth-toggle\"]", "[data-testid=\"scorecard-toggle\"]"]) {
    assert.ok(find(sel), `${sel} is created`);
  }
  const link = find("a");
  assert.equal(link.getAttribute("href"), "/api/export.csv");
  assert.equal(link.textContent, "Export CSV");
  assert.equal(doc.getElementById("outsider").textContent, "not yours");
  assert.equal(root.querySelectorAll("h1").length, 1);
});

test("#1: the game label and who is modelled come from the presented state", () => {
  const { component, find } = setup();
  component.update(vmOf());
  assert.equal(find("#gameLabel").textContent, state.final().game.label);
  assert.equal(find("#whoLabel").textContent, `Modelling ${state.final().profile.caller} (DAL offense)`);
});

test("the keys say what they do and which key does it", () => {
  const { find } = setup();
  const undo = find("#undoBtn");
  assert.equal(undo.getAttribute("title"), "Undo (U)");
  assert.equal(undo.getAttribute("aria-keyshortcuts"), "U");
  assert.equal(undo.getAttribute("type"), "button");
  assert.match(undo.textContent, /Undo/);
  assert.match(find("#resetBtn").textContent, /Reset game/);
  const cam = find("[data-testid=\"camera-mode\"]");
  assert.equal(cam.getAttribute("title"), "Change the camera (V)");
  assert.equal(cam.getAttribute("aria-keyshortcuts"), "V");
  assert.equal(find("[data-testid=\"booth-toggle\"]").getAttribute("aria-keyshortcuts"), "B");
  assert.equal(find("[data-testid=\"scorecard-toggle\"]").getAttribute("aria-keyshortcuts"), "G");
  assert.equal(find("[data-testid=\"scorecard-toggle\"]").getAttribute("aria-controls"), "rg-score");
});

test("the camera key names the mode; booth and scorecard keys report aria-expanded", () => {
  const { component, find } = setup();
  const modes = [{ id: "wide", label: "Wide" }, { id: "tight", label: "Tight" }];
  component.update(mastheadVm(makePv({ presented: state.final(), view: { camera: "tight", booth: { open: true },
    scorecardOpen: false }, cameraModes: modes })));
  const cam = find("[data-testid=\"camera-mode\"]");
  assert.equal(cam.getAttribute("data-camera"), "tight");
  assert.match(cam.textContent, /Tight/);
  assert.equal(find("[data-testid=\"booth-toggle\"]").getAttribute("aria-expanded"), "true");
  assert.equal(find("[data-testid=\"scorecard-toggle\"]").getAttribute("aria-expanded"), "false");
  component.update(mastheadVm(makePv({ presented: state.final(), view: { camera: "wide", booth: { open: false },
    scorecardOpen: true }, cameraModes: modes })));
  assert.equal(cam.getAttribute("data-camera"), "wide");
  assert.match(cam.textContent, /Wide/);
  assert.equal(find("[data-testid=\"booth-toggle\"]").getAttribute("aria-expanded"), "false");
  assert.equal(find("[data-testid=\"scorecard-toggle\"]").getAttribute("aria-expanded"), "true");
});

test("without a camera yet the camera key has no mode", () => {
  const { component, find } = setup();
  component.update(mastheadVm(makePv({ presented: state.final() })));
  const cam = find("[data-testid=\"camera-mode\"]");
  assert.equal(cam.hasAttribute("data-camera"), false);
  assert.equal(cam.querySelector(".sc-key-value").textContent, "");
});

test("every key calls its action and nothing else", () => {
  const { find, calls } = setup();
  click(find("#undoBtn"));
  click(find("#resetBtn"));
  click(find("[data-testid=\"camera-mode\"]"));
  click(find("[data-testid=\"booth-toggle\"]"));
  click(find("[data-testid=\"scorecard-toggle\"]"));
  assert.deepEqual(calls, [["undo"], ["reset"], ["cycleCamera"], ["toggleBooth"], ["toggleScorecard"]]);
});

test("a render that changes nothing writes nothing", () => {
  const { doc, component } = setup();
  component.update(vmOf());
  const writes = doc.writes;
  component.update(vmOf());
  assert.equal(doc.writes, writes);
});

test("labels are text, never markup (G27)", () => {
  const { component, find } = setup();
  const presented = { ...state.final(), game: { ...state.final().game, label: "<b>Bucs</b> at Cowboys" } };
  component.update(mastheadVm(makePv({ presented })));
  assert.equal(find("#gameLabel").textContent, "<b>Bucs</b> at Cowboys");
  assert.equal(find("#gameLabel").children.length, 0);
});

test("destroy takes the masthead out of its root", () => {
  const { root, component } = setup();
  component.destroy();
  assert.equal(root.children.length, 0);
});
