// The game picker's DOM side (static/js/picker/picker.js; docs/design/game-picker.md 3): the trigger and its panel,
// the week list, the chosen game's sides, the pasted link, and the keyboard: Escape closes it, Up and Down walk the
// games, and no page shortcut fires while focus is inside it. Labels are text, never HTML. Runs on the fake DOM.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { attachKeyboard } from "../../../static/js/core/keyboard.js";
import { initialState, reducer } from "../../../static/js/core/reducer.js";
import { createStore } from "../../../static/js/core/store.js";
import { mountPicker } from "../../../static/js/picker/picker.js";
import { createDocument } from "../fake-dom.mjs";
import { stateBody } from "../fixtures.mjs";

const SCHOTT = { name: "Brian Schottenheimer", role: "HC", model: true };
const team = (abbr, name, short, score = null, caller = null) => ({ abbr, nflverse: abbr, name, short, score, caller });
const game = (over = {}) => ({
  event_id: "401872980", season: 2026, season_type: 2, week: 5, game_id: "2026_05_TB_DAL",
  kickoff: "2026-10-09T00:15:00Z", time_valid: true, neutral: false, status: "post", detail: "Final", completed: true,
  clock: null, period: null, away: team("TB", "Tampa Bay Buccaneers", "Buccaneers", 24),
  home: team("DAL", "Dallas Cowboys", "Cowboys", 16, SCHOTT), ...over,
});
const HOSTILE = game({ event_id: "401872981", status: "pre", detail: "Sun", completed: false,
  away: team("PHI", "<img src=x onerror=alert(1)>", "<b>Eagles</b>"), home: team("JAX", "Jacksonville Jaguars", "Jaguars"),
  kickoff: "2026-10-11T13:30:00Z" });
const DATA = { season: 2026, current: "2-5", offline: false, weeks: [
  { key: "2-5", season_type: 2, week: 5, label: "Week 5", detail: "Oct 7-13", current: true, stale: false, error: null,
    games: [game(), HOSTILE] },
  { key: "2-6", season_type: 2, week: 6, label: "Week 6", detail: "Oct 14-20", current: false, stale: false,
    error: null, games: [game({ event_id: "401873001", week: 6 })] }] };

let doc;
beforeEach(() => {
  doc = createDocument();
  globalThis.document = doc;
});
afterEach(() => {
  delete globalThis.document;
});

const flush = async () => {
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

function fakeTimers() {
  const pending = new Map();
  let next = 1;
  return {
    setTimeout: (fn, ms) => { pending.set(next, { fn, ms }); next += 1; return next - 1; },
    clearTimeout: (id) => { pending.delete(id); },
    pending,
    run() { const due = [...pending.entries()]; pending.clear(); for (const [, t] of due) t.fn(); },
  };
}

function setup({ resolve = async () => game({ event_id: "401873001", week: 6 }), games = async () => DATA,
  callers = async () => ({ callers: [] }) } = {}) {
  const host = doc.body.appendChild(doc.createElement("div"));
  const calls = { games: 0, callers: 0, resolve: [], selected: [] };
  const api = {
    games: async () => { calls.games += 1; return games(); },
    callers: async () => { calls.callers += 1; return callers(); },
    resolve: async (ref) => { calls.resolve.push(ref); return resolve(ref); },
  };
  const timers = fakeTimers();
  const picker = mountPicker(host, { api, onSelect: (s) => calls.selected.push(s), timers, label: "TB at DAL",
    timeZone: "America/New_York" });
  const q = (sel) => host.querySelector(sel);
  const qa = (sel) => [...host.querySelectorAll(sel)];
  const click = (node) => node.dispatchEvent({ type: "click", preventDefault() {} });
  return { host, picker, calls, timers, q, qa, click };
}

/** A keydown as the document's listeners hear it (the fake DOM doesn't bubble): target is where focus was. */
function docKey(target, name, over = {}) {
  const evt = { type: "keydown", key: name, target, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false,
    isComposing: false, keyCode: 0, repeat: false, defaultPrevented: false, ...over };
  evt.preventDefault = () => { evt.defaultPrevented = true; };
  for (const fn of doc.listeners.get("keydown") ?? []) fn(evt);
  return evt;
}

function key(panel, target, name) {
  const seen = { prevented: false, stopped: false };
  panel.dispatchEvent({ type: "keydown", key: name, target, preventDefault() { seen.prevented = true; },
    stopPropagation() { seen.stopped = true; } });
  return seen;
}

test("closed: a trigger naming the game, its panel hidden and labelled", () => {
  const { q } = setup();
  const trigger = q(".sc-picker-trigger");
  const panel = q(".sc-picker-panel");
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(trigger.getAttribute("aria-haspopup"), "dialog");
  assert.equal(trigger.getAttribute("aria-controls"), panel.id);
  assert.equal(trigger.textContent, "GameTB at DAL");
  assert.equal(panel.hidden, true);
  assert.equal(panel.getAttribute("role"), "dialog");
  assert.equal(doc.getElementById(panel.getAttribute("aria-labelledby")).textContent, "Pick a game");
});

test("opening loads the season, lists this week's games and puts focus in the panel", async () => {
  const { q, qa, click, calls, host } = setup();
  click(q(".sc-picker-trigger"));
  await flush();
  assert.equal(calls.games, 1);
  assert.equal(q(".sc-picker-panel").hidden, false);
  assert.equal(q(".sc-picker-trigger").getAttribute("aria-expanded"), "true");
  assert.equal(host.querySelector(".sc-picker").getAttribute("data-open"), "true");
  const weeks = qa(".sc-picker-week");
  assert.deepEqual(weeks.map((w) => [w.getAttribute("data-key"), w.hasAttribute("open")]), [["2-5", true],
    ["2-6", false]]);
  const rows = qa(".sc-picker-game");
  assert.deepEqual(rows.map((r) => r.getAttribute("data-kind")), ["final", "upcoming", "final"]);
  assert.equal(rows[0].getAttribute("aria-label"), "Tampa Bay Buccaneers 24 at Dallas Cowboys 16. Final.");
  assert.ok(q(".sc-picker-panel").contains(doc.activeElement), "focus is inside the panel");
});

test("ESPN's text stays text: a hostile team name never becomes markup", async () => {
  const { q, qa, click } = setup();
  click(q(".sc-picker-trigger"));
  await flush();
  assert.equal(qa("img").length, 0);
  assert.equal(qa("b").length, 0);
  const options = qa("option").map((o) => o.textContent);
  assert.ok(options.includes("<img src=x onerror=alert(1)>"), "the name is shown as the characters it is");
});

test("Escape closes it, is spent there and hands focus back to the trigger", async () => {
  const { q, click } = setup();
  click(q(".sc-picker-trigger"));
  await flush();
  const panel = q(".sc-picker-panel");
  const seen = key(panel, q(".sc-picker-game"), "Escape");
  assert.deepEqual(seen, { prevented: true, stopped: true }, "the page's Escape (Go Live) never sees it");
  assert.equal(panel.hidden, true);
  assert.equal(doc.activeElement, q(".sc-picker-trigger"));
});

test("no page shortcut fires inside the picker: its keys stop at the panel", async () => {
  const { q, click } = setup();
  click(q(".sc-picker-trigger"));
  await flush();
  const panel = q(".sc-picker-panel");
  for (const [target, name] of [[q(".sc-picker-input"), "V"], [q(".sc-picker-input"), " "], [q(".sc-picker-select"), "2"],
    [q(".sc-picker-game"), "ArrowRight"], [q(".sc-picker-game"), "V"]]) {
    const seen = key(panel, target, name);
    assert.deepEqual(seen, { prevented: false, stopped: true }, name);
  }
});

test("Up and Down walk the games", async () => {
  const { q, qa, click } = setup();
  click(q(".sc-picker-trigger"));
  await flush();
  const panel = q(".sc-picker-panel");
  const rows = qa(".sc-picker-game");
  rows[0].focus();
  assert.equal(key(panel, rows[0], "ArrowDown").prevented, true);
  assert.equal(doc.activeElement, rows[1]);
  key(panel, rows[1], "ArrowUp");
  assert.equal(doc.activeElement, rows[0]);
  key(panel, rows[0], "ArrowUp");
  assert.equal(doc.activeElement, rows[0], "the first game stays put");
});

test("picking a game shows its sides; Open sends the selection and closes", async () => {
  const { q, qa, click, calls } = setup();
  click(q(".sc-picker-trigger"));
  await flush();
  click(qa(".sc-picker-game")[0]);
  assert.equal(q(".sc-picker-chosen").hidden, false);
  assert.equal(q(".sc-picker-list").hidden, true);
  assert.equal(q(".sc-picker-chosen-title").textContent, "Buccaneers at Cowboys");
  assert.equal(doc.activeElement, q(".sc-picker-chosen-title"));
  const radios = qa("input").filter((i) => i.getAttribute("type") === "radio");
  assert.deepEqual(radios.map((r) => [r.getAttribute("value"), r.checked, r.disabled]), [["TB", false, true],
    ["DAL", true, false]]);
  const callers = qa(".sc-picker-side-caller");
  assert.deepEqual(callers.map((c) => [c.textContent, c.hidden]), [["", true], ["Brian Schottenheimer (HC)", false]],
    "a side with no play-caller on file shows only its note");
  const both = qa("input").find((i) => i.getAttribute("type") === "checkbox");
  assert.deepEqual([both.checked, both.disabled], [false, true]);
  click(q(".sc-picker-go"));
  assert.deepEqual(calls.selected, [{ event_id: "401872980", sides: ["DAL"] }]);
  assert.equal(q(".sc-picker-panel").hidden, true);
});

const BOTH_READY = game({ away: team("TB", "Tampa Bay Buccaneers", "Buccaneers", 24,
  { name: "Zac Robinson", role: "OC", model: true }) });
const BOTH_DATA = { ...DATA, weeks: [{ ...DATA.weeks[0], games: [BOTH_READY] }] };

test("Track both sides selects both sides: both radios checked, each in its own group, and Open sends both", async () => {
  const { q, qa, click, calls } = setup({ games: async () => BOTH_DATA });
  click(q(".sc-picker-trigger"));
  await flush();
  click(qa(".sc-picker-game")[0]);
  const radios = () => qa("input").filter((i) => i.getAttribute("type") === "radio");
  assert.deepEqual(radios().map((r) => [r.getAttribute("value"), r.checked, r.getAttribute("name")]),
    [["TB", false, "sc-picker-side"], ["DAL", true, "sc-picker-side"]], "one side: one group, the home side");
  const both = qa("input").find((i) => i.getAttribute("type") === "checkbox");
  both.checked = true;
  both.dispatchEvent({ type: "change" });
  assert.deepEqual(radios().map((r) => [r.getAttribute("value"), r.checked, r.disabled, r.getAttribute("name")]),
    [["TB", true, true, "sc-picker-side-TB"], ["DAL", true, true, "sc-picker-side-DAL"]],
    "both lit: two groups, so a browser keeps both checked");
  click(q(".sc-picker-go"));
  assert.deepEqual(calls.selected, [{ event_id: "401872980", sides: ["TB", "DAL"] }]);
});

test("unticking both goes back to one side in one group", async () => {
  const { q, qa, click } = setup({ games: async () => BOTH_DATA });
  click(q(".sc-picker-trigger"));
  await flush();
  click(qa(".sc-picker-game")[0]);
  const both = qa("input").find((i) => i.getAttribute("type") === "checkbox");
  for (const on of [true, false]) {
    both.checked = on;
    both.dispatchEvent({ type: "change" });
  }
  const radios = qa("input").filter((i) => i.getAttribute("type") === "radio");
  assert.deepEqual(radios.map((r) => [r.checked, r.disabled, r.getAttribute("name")]),
    [[false, false, "sc-picker-side"], [true, false, "sc-picker-side"]]);
});

// restructure-v2.md 11 item 5: the picker is modal: no page shortcut fires while it is open (core/keyboard.js stands
// down while a [data-sc-layer="modal"] is up), and Escape from anywhere closes it, never Go Live.
/**
 * The browser's radio groups, which the fake DOM lacks (HTML's rule): a radio of a named group that becomes checked,
 * or joins a group while checked, unchecks every other radio of that group in the document. Installed on the inputs
 * the picker makes from here on.
 */
function radioGroups() {
  const make = doc.createElement;
  const radios = new Set();
  const group = (r) => (r.getAttribute("type") === "radio" ? r.getAttribute("name") : null);
  const others = (r) => [...radios].filter((o) => o !== r && o.isConnected && group(o) !== null && group(o) === group(r));
  doc.createElement = (tag) => {
    const node = make(tag);
    if (tag !== "input") return node;
    let on = false;
    radios.add(node);
    Object.defineProperty(node, "checked", {
      get: () => on,
      set: (v) => {
        on = Boolean(v);
        if (on) for (const o of others(node)) o.checked = false;
      },
    });
    const setAttribute = node.setAttribute.bind(node);
    node.setAttribute = (name, value) => {
      setAttribute(name, value);
      if (String(name).toLowerCase() === "name" && on) for (const o of others(node)) o.checked = false;
    };
    return node;
  };
}

async function chooseBothReady() {
  radioGroups();
  const t = setup({ games: async () => BOTH_DATA });
  t.click(t.q(".sc-picker-trigger"));
  await flush();
  t.click(t.qa(".sc-picker-game")[0]);
  const radios = () => t.qa("input").filter((i) => i.getAttribute("type") === "radio");
  const both = t.qa("input").find((i) => i.getAttribute("type") === "checkbox");
  const tick = (on) => {
    both.checked = on;
    both.dispatchEvent({ type: "change" });
  };
  const lit = () => radios().filter((r) => r.checked).map((r) => r.getAttribute("value"));
  return { ...t, radios, tick, lit };
}

// restructure-v2.md 11 item 5, as a browser keeps radio groups: both sides stay lit while both are tracked, and turning
// it off leaves exactly the one side the panel holds, whichever side that is.
test("in a browser's radio groups, Track both sides lights both and turning it off leaves the chosen side", async () => {
  const t = await chooseBothReady();
  assert.deepEqual(t.lit(), ["DAL"], "one side: the home side");
  t.tick(true);
  assert.deepEqual(t.lit(), ["TB", "DAL"], "both lit at once");
  t.tick(false);
  assert.deepEqual(t.lit(), ["DAL"]);
  t.click(t.q(".sc-picker-go"));
  assert.deepEqual(t.calls.selected, [{ event_id: "401872980", sides: ["DAL"] }]);
});

test("in a browser's radio groups, the away side chosen first stays the one lit after both", async () => {
  const t = await chooseBothReady();
  const tb = t.radios().find((r) => r.getAttribute("value") === "TB");
  tb.checked = true;
  tb.dispatchEvent({ type: "change" });
  assert.deepEqual(t.lit(), ["TB"]);
  t.tick(true);
  assert.deepEqual(t.lit(), ["TB", "DAL"]);
  t.tick(false);
  assert.deepEqual(t.lit(), ["TB"], "the side that leaves the pair goes dark before it rejoins the group");
  t.click(t.q(".sc-picker-go"));
  assert.deepEqual(t.calls.selected, [{ event_id: "401872980", sides: ["TB"] }]);
});

// restructure-v2.md 11 item 5: the picker is modal, so it never stays open behind a control that has focus.
test("focus moving to a control outside the open picker closes it and stays where it went", async () => {
  const { q, click } = setup();
  const outside = doc.body.appendChild(doc.createElement("button"));
  click(q(".sc-picker-trigger"));
  await flush();
  for (const fn of doc.listeners.get("focusin") ?? []) fn({ type: "focusin", target: q(".sc-picker-select") });
  assert.equal(q(".sc-picker-panel").hidden, false, "focus inside the picker keeps it open");
  outside.focus();
  for (const fn of doc.listeners.get("focusin") ?? []) fn({ type: "focusin", target: outside });
  assert.equal(q(".sc-picker-panel").hidden, true);
  assert.equal(q(".sc-picker-panel").getAttribute("data-sc-layer"), null, "no longer a modal layer");
  assert.equal(doc.activeElement, outside, "closing never pulls focus back");
  assert.deepEqual(doc.listeners.get("focusin"), [], "closed, it stops listening");
});

test("open, the panel is a modal layer; closed, it is not", async () => {
  const { q, click } = setup();
  const panel = q(".sc-picker-panel");
  assert.equal(panel.getAttribute("data-sc-layer"), null);
  click(q(".sc-picker-trigger"));
  await flush();
  assert.equal(panel.getAttribute("data-sc-layer"), "modal");
  click(q(".sc-picker-close"));
  assert.equal(panel.getAttribute("data-sc-layer"), null);
});

test("Escape from the page while it is open closes it and is spent there; closed, Escape is the page's", async () => {
  const { q, click } = setup();
  click(q(".sc-picker-trigger"));
  await flush();
  const evt = docKey(doc.body, "Escape");
  assert.equal(evt.defaultPrevented, true, "the page's Escape (Go Live) never sees it");
  assert.equal(q(".sc-picker-panel").hidden, true);
  assert.equal(doc.activeElement, q(".sc-picker-trigger"));
  assert.equal(docKey(doc.body, "Escape").defaultPrevented, false, "closed: Escape is the page's again");
  assert.equal(docKey(doc.body, "Escape", { shiftKey: true }).defaultPrevented, false);
});

test("the page's keyboard sends nothing while the picker is open, from its key or the page", async () => {
  const { q, click } = setup();
  const sent = [];
  const actions = new Proxy({}, { get: (_t, name) => (...args) => { sent.push([name, ...args]); } });
  const store = createStore(reducer, initialState());
  store.dispatch({ type: "state/loaded", body: stateBody({ watch: { state: "paused" } }), origin: "poll", reqSeq: 0,
    now: 0 });
  const detach = attachKeyboard(doc, { store, actions });
  click(q(".sc-picker-trigger"));
  await flush();
  for (const [target, key] of [[q(".sc-picker-trigger"), "ArrowLeft"], [doc.body, " "], [doc.body, "v"],
    [doc.body, "3"], [q(".sc-picker-trigger"), "ArrowRight"]]) docKey(target, key);
  assert.deepEqual(sent, []);
  docKey(doc.body, "Escape");
  assert.deepEqual(sent, [], "Escape closed the picker; it never went live");
  assert.equal(q(".sc-picker-panel").hidden, true);
  docKey(doc.body, "ArrowLeft");
  assert.deepEqual(sent, [["stepBack"]], "closed: the page's keys are back");
  detach();
});

test("setLabel sets the game's words and their tooltip on the label node it hands out", () => {
  const { q, picker } = setup();
  picker.setLabel("TB at DAL · Final", "Buccaneers at Cowboys, Week 5, Thu Oct 8");
  assert.equal(picker.labelNode, q(".sc-picker-trigger").querySelector(".sc-key-value"));
  assert.equal(picker.labelNode.textContent, "TB at DAL · Final");
  assert.equal(picker.labelNode.getAttribute("title"), "Buccaneers at Cowboys, Week 5, Thu Oct 8");
  picker.setLabel("DAL at WSH");
  assert.equal(picker.labelNode.getAttribute("title"), null, "no tooltip when none is given");
});

// restructure-v2.md 11 decision 1: the season and the models' index load together; the index only adds what it knows.
test("opening loads the models' index beside the season; a side it says has no model is off, with its reason", async () => {
  const reason = "Only 4 games (264 snaps) in the data; a model needs at least 5 games and 200 snaps.";
  const tb = game({ away: team("TB", "Tampa Bay Buccaneers", "Buccaneers", 24, { name: "Zac Robinson", role: "OC",
    model: true }) });
  const { q, qa, click, calls } = setup({ games: async () => ({ ...DATA, weeks: [{ ...DATA.weeks[0], games: [tb] }] }),
    callers: async () => ({ callers: [{ name: "Zac Robinson", status: "skipped", reason }] }) });
  click(q(".sc-picker-trigger"));
  await flush();
  assert.deepEqual([calls.games, calls.callers], [1, 1]);
  click(qa(".sc-picker-game")[0]);
  const notes = qa(".sc-picker-side-note").map((n) => n.textContent);
  assert.deepEqual(notes, [reason, "Model ready."]);
  const radios = qa("input").filter((i) => i.getAttribute("type") === "radio");
  assert.deepEqual(radios.map((r) => r.disabled), [true, false]);
});

test("an index that can't be read never stops the season from listing", async () => {
  const { q, qa, click } = setup({ callers: async () => { throw new Error("404"); } });
  click(q(".sc-picker-trigger"));
  await flush();
  assert.equal(qa(".sc-picker-game").length, 3);
  assert.equal(q(".sc-picker-status").hidden, true, "no error shown for the index");
});

test("back returns to the list with focus on the game it came from", async () => {
  const { q, qa, click } = setup();
  click(q(".sc-picker-trigger"));
  await flush();
  click(qa(".sc-picker-game")[0]);
  click(q(".sc-picker-back"));
  assert.equal(q(".sc-picker-list").hidden, false);
  assert.equal(doc.activeElement, qa(".sc-picker-game")[0]);
});

test("the team filter narrows the list", async () => {
  const { q, qa, click } = setup();
  click(q(".sc-picker-trigger"));
  await flush();
  const select = q(".sc-picker-select");
  select.value = "PHI";
  select.dispatchEvent({ type: "change" });
  assert.deepEqual(qa(".sc-picker-game").map((r) => r.getAttribute("data-event")), ["401872981"]);
});

test("a pasted link finds its game; a refusal shows the reason beside the field", async () => {
  let answer = async () => { throw Object.assign(new Error("That address isn't on espn.com."), { status: 400 }); };
  const { q, click, calls } = setup({ resolve: (ref) => answer(ref) });
  click(q(".sc-picker-trigger"));
  await flush();
  const input = q(".sc-picker-input");
  assert.equal(doc.getElementById("sc-picker-ref-help").textContent,
    "Open the game on espn.com. The number after gameId/ in the address is the game id.");
  input.value = "evil.example/gameId/1";
  input.dispatchEvent({ type: "input" });
  q(".sc-picker-ref").dispatchEvent({ type: "submit", preventDefault() {} });
  await flush();
  assert.deepEqual(calls.resolve, ["evil.example/gameId/1"]);
  assert.equal(q(".sc-picker-error").textContent, "That address isn't on espn.com.");
  assert.equal(q(".sc-picker-error").hidden, false);
  assert.equal(input.getAttribute("aria-invalid"), "true");
  assert.ok(input.getAttribute("aria-describedby").includes("sc-picker-ref-error"));
  answer = async () => game({ event_id: "401873001", week: 6 });
  input.value = "401873001";
  input.dispatchEvent({ type: "input" });
  assert.equal(input.getAttribute("aria-invalid"), null, "typing clears the old reason");
  q(".sc-picker-ref").dispatchEvent({ type: "submit", preventDefault() {} });
  await flush();
  assert.equal(q(".sc-picker-chosen").hidden, false);
  assert.equal(q(".sc-picker-chosen-sub").textContent, "Week 6 · Final · TB 24, DAL 16");
});

test("a failed load says so with a retry; while open the list refreshes, and closing stops it", async () => {
  let fail = true;
  const { q, click, calls, timers } = setup({ games: async () => {
    if (fail) throw new Error("Can't reach the app server.");
    return DATA;
  } });
  click(q(".sc-picker-trigger"));
  await flush();
  assert.equal(q(".sc-picker-status-text").textContent, "Can't reach the app server.");
  assert.equal(q(".sc-picker-status").getAttribute("data-tone"), "error");
  assert.equal(q(".sc-picker-retry").hidden, false);
  fail = false;
  click(q(".sc-picker-retry"));
  await flush();
  assert.equal(q(".sc-picker-retry").hidden, true);
  assert.equal(calls.games, 2);
  timers.run();
  await flush();
  assert.equal(calls.games, 3, "a refresh while open");
  click(q(".sc-picker-close"));
  assert.equal(timers.pending.size, 0, "closed: no refresh pending");
});

test("a click outside closes it; destroy takes it all away", async () => {
  const { q, click, picker, host } = setup();
  click(q(".sc-picker-trigger"));
  await flush();
  for (const fn of doc.listeners.get("pointerdown") ?? []) fn({ target: doc.body });
  assert.equal(q(".sc-picker-panel").hidden, true);
  picker.setLabel("DAL at WSH");
  assert.equal(q(".sc-picker-trigger").textContent, "GameDAL at WSH");
  picker.destroy();
  assert.equal(host.childNodes.length, 0);
  assert.equal((doc.listeners.get("pointerdown") ?? []).length, 0);
});
