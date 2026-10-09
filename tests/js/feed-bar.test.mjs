// ui/feed-bar.js (owner A9; ui-architecture.md 2.6, 4.5, 5.1, 5.4; FI 2.2, 3.2, #92 to #104, G12, G27).
import assert from "node:assert/strict";
import test from "node:test";
import { mount } from "../../static/js/ui/feed-bar.js";
import { feedVm } from "../../static/js/model/vm-feed.js";
import { chromeCtx, chromePage, click, keydown } from "./chrome-ctx.mjs";
import { withDocument } from "./fake-dom.mjs";
import { makePv, patch, state } from "./model-fixtures.mjs";

function setup() {
  const doc = chromePage([["section", "rg-feed"]]);
  const { ctx, calls } = chromeCtx();
  const root = doc.getElementById("rg-feed");
  const component = withDocument(doc, () => mount(root, ctx));
  const find = (sel) => root.querySelector(sel);
  const render = (pvOpts) => withDocument(doc, () => component.update(feedVm(makePv(pvOpts))));
  return { doc, root, calls, component, find, render };
}

const withFeed = (feed) => patch(state.final(), { feed: { ...state.final().feed, ...feed } });
const IDLE = { watch: { state: "idle", idx: 0, total: 0, speed: null } };

test("mount builds the bar with every legacy hook (5.1) inside its root", () => {
  const { doc, find } = setup();
  for (const sel of ["#feedBtn", "#feedBtnTxt", "#feedEvent", "#replayBtn", "[data-watch=\"start\"]", "#feedStatus",
    "[data-testid=\"bg-message\"]"]) {
    assert.ok(find(sel), `${sel} exists`);
  }
  assert.equal(find("#feedEvent").getAttribute("placeholder"), "today's game");
  assert.equal(find("#feedBtn").getAttribute("type"), "button");
  const bg = find("[data-testid=\"bg-message\"]");
  assert.equal(bg.getAttribute("role"), "status");
  assert.equal(bg.getAttribute("aria-live"), "polite");
  assert.equal(doc.getElementById("outsider").textContent, "not yours");
});

test("#feedEvent has a visible label, and the feed button names what it toggles", () => {
  const { find } = setup();
  const input = find("#feedEvent");
  const label = find("label");
  assert.equal(label.getAttribute("for"), "feedEvent");
  assert.equal(label.textContent, "ESPN game id");
  assert.equal(input.getAttribute("autocomplete"), "off");
  assert.equal(input.getAttribute("inputmode"), "numeric");
});

test("feed off: the off words, no live style, the off status line (FI 3.2)", () => {
  const { find, render } = setup();
  render({ presented: state.final(), version: IDLE });
  const btn = find("#feedBtn");
  assert.equal(find("#feedBtnTxt").textContent, "ESPN live: off");
  assert.equal(btn.getAttribute("data-feed-state"), "off");
  assert.equal(btn.hasAttribute("aria-pressed"), false, "its words say on or off, so it is not also a toggle");
  assert.equal(btn.className.split(" ").includes("on"), false);
  assert.equal(btn.className.split(" ").includes("err"), false);
  assert.equal(find("#feedStatus").textContent, "Off: enter plays by hand, or turn it on and plays log themselves.");
});

test("feed live: .on, and 'Updated ... · Last: END GAME' with the label in bold (#92, #94)", () => {
  const { find, render } = setup();
  render({ presented: state.feedOn() });
  const btn = find("#feedBtn");
  assert.equal(find("#feedBtnTxt").textContent, "ESPN live: on");
  assert.equal(btn.getAttribute("data-feed-state"), "live");
  assert.ok(btn.className.split(" ").includes("on"));
  const status = find("#feedStatus");
  assert.equal(status.textContent, "Updated 03:22:28 · Last: END GAME");
  assert.deepEqual([...status.querySelectorAll("strong")].map((n) => n.textContent), ["Last:"]);
});

test("feed retrying: .err and the error line (#101)", () => {
  const { find, render } = setup();
  render({ presented: withFeed({ on: true, state: "error", detail: "HTTP 404" }) });
  const btn = find("#feedBtn");
  assert.equal(find("#feedBtnTxt").textContent, "ESPN live: retrying");
  assert.equal(btn.getAttribute("data-feed-state"), "retrying");
  assert.ok(btn.className.split(" ").includes("err"));
  assert.ok(btn.className.split(" ").includes("on"), "a retrying feed is still on");
  assert.equal(find("#feedStatus").textContent, "Can't reach ESPN (HTTP 404). Still trying every few seconds.");
});

test("a skipped play shows in the status line (#102); ESPN text stays text (G27)", () => {
  const { find, render } = setup();
  render({ presented: withFeed({ on: true, state: "live", last_poll: "21:00:00", last_play: "<b>x</b>",
    skipped: "J.Daniels pass (no spot)" }) });
  const status = find("#feedStatus");
  assert.equal(status.textContent, "Updated 21:00:00 · Last: <b>x</b> · Skipped, enter it by hand: J.Daniels pass (no spot)");
  assert.deepEqual([...status.querySelectorAll("strong")].map((n) => n.textContent),
    ["Last:", "Skipped, enter it by hand:"]);
});

test("the id box shows the feed's event id, but never while it has focus (#104)", () => {
  const { doc, find, render } = setup();
  render({ presented: state.final() });
  const input = find("#feedEvent");
  assert.equal(input.value, "401872980");
  input.focus();
  input.value = "4018";
  render({ presented: withFeed({ event_id: "999" }) });
  assert.equal(input.value, "4018", "a render never overwrites what is being typed");
  input.blur();
  render({ presented: withFeed({ event_id: "999" }) });
  assert.equal(input.value, "999");
  assert.equal(doc.activeElement, doc.body);
});

test("text typed in the id box survives later renders until the server's own id changes (FI 5.17)", () => {
  const { find, render } = setup();
  render({ presented: state.final() });
  const input = find("#feedEvent");
  input.focus();
  input.value = "40187";
  input.blur();
  render({ presented: state.final(), version: IDLE });
  render({ presented: withFeed({ last_poll: "21:00:01" }) });
  assert.equal(input.value, "40187", "a poll that changes nothing about the id leaves the typed text alone");
  render({ presented: withFeed({ event_id: "401872981" }) });
  assert.equal(input.value, "401872981", "a new game on the server shows its id");
});

test("Enter in the id box only blurs it (#104); other keys pass", () => {
  const { doc, find, calls } = setup();
  const input = find("#feedEvent");
  input.focus();
  const enter = keydown(input, "Enter");
  assert.equal(enter.prevented, true);
  assert.equal(doc.activeElement, doc.body);
  assert.deepEqual(calls, []);
  input.focus();
  assert.equal(keydown(input, "7").prevented, false);
  assert.equal(doc.activeElement, input);
});

test("the feed, replay and watch buttons call their actions with the id box text", () => {
  const { find, calls, render } = setup();
  render({ presented: state.final(), version: IDLE });
  const input = find("#feedEvent");
  click(find("#feedBtn"));
  input.value = "  401872980 ";
  click(find("#replayBtn"));
  input.value = "";
  click(find("[data-watch=\"start\"]"));
  assert.deepEqual(calls, [["feedToggle", "401872980"], ["replay", "  401872980 "], ["watchStart", ""]]);
});

test("Watch this game shows only when the server can start one", () => {
  const { find, render } = setup();
  render({ presented: state.final() });
  assert.equal(find("[data-watch=\"start\"]").hidden, true, "an old server without watch: no button");
  render({ presented: state.final(), version: IDLE });
  assert.equal(find("[data-watch=\"start\"]").hidden, false);
  render({ presented: state.final(), version: { watch: { state: "playing", idx: 3, total: 183, speed: 4 } } });
  assert.equal(find("[data-watch=\"start\"]").hidden, true, "not while a watch plays");
});

test("G12: a background message shows in its polite region, a new message is a new line", () => {
  const { find, render } = setup();
  render({ presented: state.final() });
  const bg = find("[data-testid=\"bg-message\"]");
  assert.equal(bg.textContent, "");
  assert.equal(bg.getAttribute("data-empty"), "true");
  render({ presented: state.final(), view: { bgMessage: { text: "No play: defensive offside on TB.", at: 1 } } });
  assert.equal(bg.textContent, "No play: defensive offside on TB.");
  assert.equal(bg.getAttribute("data-empty"), "false");
  const first = bg.firstElementChild ?? bg.children[0];
  render({ presented: state.final(), view: { bgMessage: { text: "Turnover. Waiting for the next Dallas drive.", at: 2 } } });
  assert.equal(bg.textContent, "Turnover. Waiting for the next Dallas drive.");
  assert.notEqual(bg.children[0], first, "a new message steps in as a new line");
  assert.equal(bg.children.length, 1);
});

test("a render that changes nothing writes nothing", () => {
  const { doc, render } = setup();
  render({ presented: state.feedOn() });
  const writes = doc.writes;
  render({ presented: state.feedOn() });
  assert.equal(doc.writes, writes);
});

test("destroy takes the bar out of its root", () => {
  const { root, component } = setup();
  component.destroy();
  assert.equal(root.children.length, 0);
});
