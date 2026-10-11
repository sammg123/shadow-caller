// The game picker's DOM side (static/js/picker/picker.js; docs/design/game-picker.md 3): the trigger and its panel,
// the week list, the chosen game's sides, the pasted link, and the keyboard: Escape closes it, Up and Down walk the
// games, and no page shortcut fires while focus is inside it. Labels are text, never HTML. Runs on the fake DOM.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { mountPicker } from "../../../static/js/picker/picker.js";
import { createDocument } from "../fake-dom.mjs";

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

function setup({ resolve = async () => game({ event_id: "401873001", week: 6 }), games = async () => DATA } = {}) {
  const host = doc.body.appendChild(doc.createElement("div"));
  const calls = { games: 0, resolve: [], selected: [] };
  const api = {
    games: async () => { calls.games += 1; return games(); },
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
