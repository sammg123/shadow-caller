// ui/masthead.js and ui/view-keys.js (restructure-v2.md 2 and 11): the top bar's nameplate, its current game (the game
// picker's key once its module loaded), then the view keys: the camera (V), the Model Report link, the Ask key (hidden
// until the analyst's drawer mounts: shell/analyst.js) and the settings menu's key.
import assert from "node:assert/strict";
import test from "node:test";
import * as Picker from "../../static/js/picker/picker.js";
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

// ---------------------------------------------------------------- restructure-v2.md 11: the game picker in the label
const GAMES = { season: 2026, current: "2-5", offline: true, weeks: [{ key: "2-5", season_type: 2, week: 5,
  label: "Week 5", detail: "Oct 7-13", current: true, stale: false, error: null, games: [{
    event_id: "401872980", season: 2026, season_type: 2, week: 5, game_id: "2026_05_TB_DAL",
    kickoff: "2026-10-09T00:15:00Z", time_valid: true, neutral: false, status: "post", detail: "Final",
    completed: true, clock: null, period: null,
    away: { abbr: "TB", nflverse: "TB", name: "Tampa Bay Buccaneers", short: "Buccaneers", score: 24,
      caller: { name: "Zac Robinson", role: "OC", model: true } },
    home: { abbr: "DAL", nflverse: "DAL", name: "Dallas Cowboys", short: "Cowboys", score: 16,
      caller: { name: "Brian Schottenheimer", role: "HC", model: true } } }] }] };

/** The real picker module, its HTTP client and timers swapped for the test's (the page's own come by default). */
function pickerModule(extra = {}) {
  const timers = { setTimeout: () => 0, clearTimeout: () => {} };
  const api = { games: async () => GAMES, resolve: async () => { throw new Error("not in this test"); } };
  return { mountPicker: (host, opts) => Picker.mountPicker(host, { ...opts, api, timers, timeZone: "UTC", ...extra }) };
}

function pickerSetup(picker = pickerModule()) {
  const doc = chromePage([["header", "rg-masthead"]]);
  const { actions, calls } = recordingActions();
  const shown = [];
  const notices = { show: (id, text) => shown.push([id, text]) };
  const ctx = Object.freeze({ actions, engine: () => null, copy: Copy, picker, notices });
  const root = doc.getElementById("rg-masthead");
  const component = withDocument(doc, () => mount(root, ctx));
  const find = (sel) => root.querySelector(sel);
  return { doc, root, calls, shown, component, find, run: (fn) => withDocument(doc, fn) };
}

const flush = async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setImmediate(r)); };

test("with the picker loaded, the game's words are its key: #gameLabel and its tooltip ride on the key", () => {
  const { component, find, root } = pickerSetup();
  const slot = find("[data-testid=\"game-slot\"]");
  assert.equal(slot.parentNode, root, "the slot sits in the top bar after the plate");
  const trigger = find(".sc-picker-trigger");
  assert.ok(slot.contains(trigger));
  assert.equal(root.querySelectorAll("#gameLabel").length, 1, "one #gameLabel");
  const label = find("#gameLabel");
  assert.ok(trigger.contains(label), "the words are the key's value");
  assert.equal(label.getAttribute("data-testid"), "game-label");
  component.update(vmOf({ version: { watch: { state: "done", game: { status: "post", detail: "Final" } } } }));
  assert.equal(label.textContent, "TB at DAL · Final");
  assert.equal(label.getAttribute("title"), state.final().game.label);
  assert.equal(find("#whoLabel").textContent, "Shadowing Schottenheimer · DAL");
});

test("choosing a game and both sides in the picker asks the page to open them (actions.selectGame)", async () => {
  const t = pickerSetup();
  await t.run(async () => {
    click(t.find(".sc-picker-trigger"));
    await flush();
    click(t.find(".sc-picker-game"));
    const both = [...t.root.querySelectorAll("input")].find((i) => i.getAttribute("type") === "checkbox");
    both.checked = true;
    both.dispatchEvent({ type: "change" });
    click(t.find(".sc-picker-go"));
  });
  assert.deepEqual(t.calls, [["selectGame", { event_id: "401872980", sides: ["TB", "DAL"] }]]);
  assert.equal(t.find(".sc-picker-panel").hidden, true, "the picker closes; the label follows the new track");
});

test("both callers tracked: the plate names both; the key keeps the game's words", () => {
  const { component, find } = pickerSetup();
  const tracked = [{ team: "TB", caller: "Zac Robinson", slug: "zac-robinson" },
    { team: "DAL", caller: "Brian Schottenheimer", slug: "brian-schottenheimer" }];
  component.update(mastheadVm(makePv({ presented: { ...state.final(), tracked }, tl: tlOf(timeline.final()) })));
  assert.equal(find("#whoLabel").textContent, "Shadowing Robinson · TB and Schottenheimer · DAL");
  assert.equal(find(".sc-masthead-plate").getAttribute("data-sides"), "2", "a hook to give two names room");
  assert.equal(find("#gameLabel").textContent, "TB at DAL");
});

test("a picker that fails to mount leaves the plain words and a notice; the plate stays", () => {
  const broken = { mountPicker: () => { throw new Error("boom"); } };
  const { component, find, shown, root } = pickerSetup(broken);
  component.update(vmOf());
  assert.equal(find(".sc-picker"), null);
  assert.equal(find("#gameLabel").textContent, "TB at DAL");
  assert.equal(find("#gameLabel").localName, "p");
  assert.equal(root.querySelectorAll("#gameLabel").length, 1);
  assert.deepEqual(shown.map(([id]) => id), ["picker"]);
  assert.match(shown[0][1], /boom/);
  assert.equal(find("h1").textContent, "Shadow Play-Caller");
});

test("destroy takes the picker out with the plate", () => {
  const { component, root } = pickerSetup();
  component.destroy();
  assert.equal(kids(root).length, 0);
});
