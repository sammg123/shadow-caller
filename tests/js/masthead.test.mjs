// ui/masthead.js and ui/view-keys.js (restructure-v2.md 2): the top bar's nameplate, its current game, then the view
// keys: the camera (V), the Model Report link, the Ask key (hidden until phase 4) and the settings menu's key.
import assert from "node:assert/strict";
import test from "node:test";
import { mount } from "../../static/js/ui/masthead.js";
import { mount as mountKeys } from "../../static/js/ui/view-keys.js";
import { mastheadVm } from "../../static/js/model/vm-masthead.js";
import { viewKeysVm } from "../../static/js/model/vm-view-keys.js";
import { Copy, chromeCtx, chromePage, click, kids, recordingActions } from "./chrome-ctx.mjs";
import { withDocument } from "./fake-dom.mjs";
import { makePv, state, timeline, tlOf } from "./model-fixtures.mjs";

function setup() {
  const doc = chromePage([["header", "rg-masthead"]]);
  const { ctx, calls } = chromeCtx();
  const root = doc.getElementById("rg-masthead");
  const component = withDocument(doc, () => mount(root, ctx));
  return { doc, root, ctx, calls, component, find: (sel) => root.querySelector(sel) };
}

function keysSetup({ reportHref = "/report?world=neutral", settingsId = "sc-settings" } = {}) {
  const doc = chromePage([["header", "rg-masthead"]]);
  const { actions, calls } = recordingActions();
  const ctx = Object.freeze({ actions, engine: () => null, copy: Copy, reportHref, settingsId });
  const root = doc.getElementById("rg-masthead");
  const component = withDocument(doc, () => mountKeys(root, ctx));
  return { doc, root, calls, component, find: (sel) => root.querySelector(sel) };
}

const vmOf = (over = {}) => mastheadVm(makePv({ presented: state.final(), tl: tlOf(timeline.final()), ...over }));

test("the plate: the title once, who it shadows, and the current game", () => {
  const { doc, root, component, find } = setup();
  component.update(vmOf());
  assert.equal(find("h1").textContent, "Shadow Play-Caller");
  assert.equal(root.querySelectorAll("h1").length, 1);
  assert.equal(find("#whoLabel").textContent, "Shadowing Schottenheimer · DAL");
  assert.equal(find(".sc-masthead-plate").getAttribute("title"), "Modelling Brian Schottenheimer (DAL offense)");
  const game = find("[data-testid=\"game-label\"]");
  assert.equal(game.textContent, "TB at DAL");
  assert.equal(game.getAttribute("title"), state.final().game.label);
  assert.equal(game.getAttribute("aria-label"), null, "its words are its name");
  assert.equal(doc.getElementById("outsider").textContent, "not yours");
});

test("before the first state there is no tooltip and no game", () => {
  const { component, find } = setup();
  component.update(mastheadVm(makePv()));
  assert.equal(find(".sc-masthead-plate").hasAttribute("title"), false);
  assert.equal(find("[data-testid=\"game-label\"]").hidden, true);
});

test("a render that changes nothing writes nothing; labels are text, never markup (G27)", () => {
  const { doc, component, find } = setup();
  component.update(vmOf());
  const writes = doc.writes;
  component.update(vmOf());
  assert.equal(doc.writes, writes);
  const presented = { ...state.final(), game: { ...state.final().game, label: "<b>Bucs</b> at Cowboys" } };
  component.update(mastheadVm(makePv({ presented })));
  assert.equal(find("[data-testid=\"game-label\"]").getAttribute("title"), "<b>Bucs</b> at Cowboys");
  assert.equal(find("[data-testid=\"game-label\"]").children.length, 0);
});

test("destroy takes the plate out of its root", () => {
  const { root, component } = setup();
  component.destroy();
  assert.equal(kids(root).length, 0);
});

test("view keys, in order: the camera (V), the Model Report link, Ask (hidden until phase 4), Settings", () => {
  const { find } = keysSetup();
  const group = find(".sc-viewkeys");
  assert.deepEqual([group.getAttribute("role"), group.getAttribute("aria-label")], ["group", "View"]);
  const order = kids(group).map((n) => n.getAttribute("data-testid"));
  assert.deepEqual(order, ["camera-mode", "model-report", "ask", "settings-toggle"]);
  const camera = find("[data-testid=\"camera-mode\"]");
  assert.deepEqual([camera.getAttribute("aria-keyshortcuts"), camera.getAttribute("title")], ["V", "Wide or Blimp (V)"]);
  const report = find("[data-testid=\"model-report\"]");
  assert.deepEqual([report.localName, report.getAttribute("href"), report.querySelector(".sc-key-name").textContent],
    ["a", "/report?world=neutral", "Model Report"]);
  assert.equal(find("[data-testid=\"ask\"]").hidden, true);
  const settings = find("[data-testid=\"settings-toggle\"]");
  assert.deepEqual([settings.getAttribute("aria-controls"), settings.getAttribute("aria-expanded"), settings.hidden],
    ["sc-settings", "false", false]);
});

test("the camera key names the mode; the settings key says whether its menu is open", () => {
  const { component, find } = keysSetup();
  const modes = [{ id: "wide", label: "Wide" }, { id: "blimp", label: "Blimp" }];
  component.update(viewKeysVm(makePv({ view: { camera: "blimp", settingsOpen: true }, cameraModes: modes })));
  const camera = find("[data-testid=\"camera-mode\"]");
  assert.equal(camera.querySelector(".sc-key-value").textContent, "Blimp");
  assert.equal(camera.getAttribute("data-camera"), "blimp");
  assert.equal(find("[data-testid=\"settings-toggle\"]").getAttribute("aria-expanded"), "true");
});

test("every key calls its action and nothing else; the report is a plain link", () => {
  const { find, calls } = keysSetup();
  click(find("[data-testid=\"camera-mode\"]"));
  click(find("[data-testid=\"settings-toggle\"]"));
  click(find("[data-testid=\"model-report\"]"));
  assert.deepEqual(calls, [["cycleCamera"], ["toggleSettings"]]);
});

test("a world without settings shows no settings key; without a report address the link is /report", () => {
  const { find } = keysSetup({ reportHref: "", settingsId: null });
  assert.equal(find("[data-testid=\"settings-toggle\"]").hidden, true);
  assert.equal(find("[data-testid=\"settings-toggle\"]").hasAttribute("aria-controls"), false);
  assert.equal(find("[data-testid=\"model-report\"]").getAttribute("href"), "/report");
});
