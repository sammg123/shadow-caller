// ui/watch-transport.js and ui/progress-bar.js (restructure-v2.md 2 and 5): the top bar's playback.
import assert from "node:assert/strict";
import test from "node:test";
import { mount } from "../../static/js/ui/watch-transport.js";
import { transportVm } from "../../static/js/model/vm-transport.js";
import { chromeCtx, chromePage, click, kids } from "./chrome-ctx.mjs";
import { withDocument } from "./fake-dom.mjs";
import { makePv, state } from "./model-fixtures.mjs";

const MARKS = [{ idx: 0, kind: "drive", team: "TB", label: "TB drive 1" },
  { idx: 6, kind: "drive", team: "DAL", label: "DAL drive 1" }, { idx: 46, kind: "quarter", team: "", label: "Q2" },
  { idx: 120, kind: "drive", team: "DAL", label: "DAL drive 7" }];
const watch = (over) => ({ state: "paused", event_id: "401872980", speed: 4, idx: 104, total: 183, next_at: null,
  error: null, ...over });

function setup() {
  const doc = chromePage([["header", "rg-masthead"]]);
  const { ctx, calls } = chromeCtx();
  const root = doc.getElementById("rg-masthead");
  const component = withDocument(doc, () => mount(root, ctx));
  const find = (sel) => root.querySelector(sel);
  const key = (name) => find(`[data-transport="${name}"]`);
  const track = find("[data-testid=\"progress\"]");
  const render = (w, { view, prefs } = {}) => withDocument(doc, () => component.update(transportVm(makePv({
    version: w === undefined ? null : { watch: w }, presented: { ...state.final(), watch: { ...(w ?? {}), marks: MARKS } },
    view, prefs }))));
  return { doc, root, calls, component, find, key, track, render };
}

const press = (node, key, extra = {}) => {
  const evt = { type: "keydown", key, prevented: false, ...extra };
  evt.preventDefault = () => { evt.prevented = true; };
  node.dispatchEvent(evt);
  return evt;
};

test("the top bar's playback: back, Play, forward, the four speeds, the progress bar, Reset and Go Live, in order", () => {
  const { doc, find, key, track } = setup();
  const box = find("[data-testid=\"transport\"]");
  assert.equal(box.getAttribute("role"), "group");
  assert.equal(box.getAttribute("aria-label"), "Playback");
  const order = [];
  const walk = (n) => { for (const c of kids(n)) { const t = c.getAttribute("data-transport") ?? c.getAttribute("data-testid"); if (t) order.push(t); walk(c); } };
  walk(box);
  assert.deepEqual(order.filter((t) => ["back", "play", "forward", "progress", "reset", "live"].includes(t)),
    ["back", "play", "forward", "progress", "reset", "live"]);
  assert.deepEqual(["1", "2", "4", "10"].map((s) => find(`[data-speed="${s}"]`).getAttribute("aria-keyshortcuts")),
    ["1", "2", "3", "4"]);
  assert.deepEqual(["back", "play", "forward", "live"].map((n) => key(n).getAttribute("aria-keyshortcuts")),
    ["ArrowLeft", "Space", "ArrowRight", "Escape"]);
  assert.equal(key("back").querySelector(".sc-key-name").textContent, "Back");
  assert.equal(key("forward").querySelector(".sc-key-name").textContent, "Forward");
  assert.equal(key("reset").querySelector(".sc-key-name").textContent, "Reset");
  assert.equal(key("live").querySelector(".sc-key-name").textContent, "Go Live");
  assert.equal(key("back").getAttribute("title"), "One play back (Left arrow)");
  assert.deepEqual([track.getAttribute("role"), track.getAttribute("tabindex"), track.getAttribute("aria-label")],
    ["slider", "0", "Game progress"]);
  assert.equal(find("[data-testid=\"watch-error\"]").hidden, true);
  assert.equal(doc.getElementById("outsider").textContent, "not yours");
});

test("paused at 104 of 183: the bar, its count and the keys follow the vm", () => {
  const { find, key, track, render } = setup();
  render(watch());
  assert.equal(find("[data-testid=\"transport\"]").getAttribute("data-state"), "paused");
  assert.deepEqual(["aria-valuemin", "aria-valuemax", "aria-valuenow", "aria-valuetext"].map((a) => track.getAttribute(a)),
    ["0", "183", "104", "Play 104 of 183"]);
  assert.equal(find("[data-testid=\"progress-count\"]").textContent, "104 / 183");
  assert.equal(track.style.getPropertyValue("--sc-at"), String(Number((104 / 183).toFixed(5))));
  assert.equal(key("play").querySelector(".sc-key-name").textContent, "Play");
  for (const name of ["back", "play", "forward", "reset", "live"]) assert.equal(key(name).hasAttribute("disabled"), false, name);
  assert.equal(find("[data-speed=\"4\"]").getAttribute("aria-pressed"), "true");
  assert.equal(find("[data-speed=\"10\"]").getAttribute("aria-pressed"), "false");
});

test("the drive ticks are on the bar, each at its play, the caller's marked", () => {
  const { find, render } = setup();
  render(watch());
  const marks = kids(find(".sc-progress-marks"));
  assert.deepEqual(marks.map((m) => [m.getAttribute("data-kind"), m.getAttribute("data-team"), m.getAttribute("data-caller"),
    m.style.getPropertyValue("--sc-at")]), [["drive", "TB", "false", "0"],
    ["drive", "DAL", "true", String(Number((6 / 183).toFixed(5)))], ["quarter", null, null, String(Number((46 / 183).toFixed(5)))],
    ["drive", "DAL", "true", String(Number((120 / 183).toFixed(5)))]]);
  assert.equal(marks[1].getAttribute("title"), "DAL drive 1");
});

test("each key runs its action; a disabled key runs nothing", () => {
  const { calls, find, key, render } = setup();
  render(watch());
  for (const name of ["back", "play", "forward", "reset", "live"]) click(key(name));
  click(find("[data-speed=\"10\"]"));
  assert.deepEqual(calls, [["stepBack"], ["togglePlay"], ["stepForward"], ["reset"], ["goLive"], ["setSpeed", 10]]);
  calls.length = 0;
  render(watch({ state: "done", idx: 183 }));
  for (const name of ["play", "forward", "live"]) click(key(name));
  assert.deepEqual(calls, [], "at the final whistle there is nothing to play, step into or go live to");
});

test("playing, the key says Pause; at the final whistle Go Live's lamp is lit", () => {
  const { key, render } = setup();
  render(watch({ state: "playing" }));
  assert.equal(key("play").querySelector(".sc-key-name").textContent, "Pause");
  assert.equal(key("play").getAttribute("data-playing"), "true");
  render(watch({ state: "done", idx: 183 }));
  assert.equal(key("live").getAttribute("data-live"), "true");
  assert.equal(key("live").querySelector(".sc-lamp").getAttribute("data-on"), "true");
});

test("a click on the bar jumps to the play under it; a drag moves the knob and jumps once, where it is let go", () => {
  const { calls, find, track, render } = setup();
  render(watch());
  track.getBoundingClientRect = () => ({ left: 100, width: 366 });
  const pointer = (type, x) => track.dispatchEvent({ type, button: 0, clientX: x, pointerId: 1, preventDefault() {} });
  pointer("pointerdown", 100 + 183);
  pointer("pointerup", 100 + 183);
  assert.deepEqual(calls, [["seek", 92]]);
  calls.length = 0;
  pointer("pointerdown", 100);
  pointer("pointermove", 100 + 36.6);
  assert.equal(find("[data-testid=\"progress-count\"]").textContent, "18 / 183", "the count follows the drag");
  pointer("pointermove", 100 + 366);
  pointer("pointerup", 100 + 366);
  assert.deepEqual(calls, [["seek", 183]]);
  calls.length = 0;
  pointer("pointerdown", 150);
  track.dispatchEvent({ type: "pointercancel", pointerId: 1 });
  assert.deepEqual(calls, [], "a cancelled drag jumps nowhere");
});

test("the bar takes no pointer when the game can't seek (opening, live)", () => {
  const { calls, track, render } = setup();
  render(undefined, { view: { playback: { kind: "open", target: null } } });
  track.getBoundingClientRect = () => ({ left: 0, width: 300 });
  track.dispatchEvent({ type: "pointerdown", button: 0, clientX: 30, pointerId: 1, preventDefault() {} });
  track.dispatchEvent({ type: "pointerup", button: 0, clientX: 30, pointerId: 1 });
  assert.deepEqual(calls, []);
  assert.equal(track.getAttribute("aria-disabled"), "true");
});

test("the focused bar's own keys: a play back and forward, a drive back and forward, kickoff, Go Live, Space", () => {
  const { calls, track, render } = setup();
  render(watch({ idx: 60 }));
  const keys = ["ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", " "];
  const events = keys.map((k) => press(track, k));
  assert.deepEqual(calls, [["stepBack"], ["stepForward"], ["seek", 6], ["seek", 120], ["reset"], ["goLive"],
    ["togglePlay"]]);
  assert.ok(events.every((e) => e.prevented));
  calls.length = 0;
  assert.equal(press(track, "v").prevented, false, "V is the page's (core/keymap.js runs it)");
  press(track, "ArrowLeft", { ctrlKey: true });
  press(track, " ", { repeat: true });
  assert.deepEqual(calls, []);
});

test("a request in flight: the group says busy and the knob shows the seek's target", () => {
  const { find, track, render } = setup();
  render(watch(), { view: { playback: { kind: "seek", target: 20 } } });
  const box = find("[data-testid=\"transport\"]");
  assert.deepEqual([box.getAttribute("data-busy"), box.getAttribute("aria-busy")], ["true", "true"]);
  assert.equal(track.getAttribute("aria-valuenow"), "20");
  assert.equal(find("[data-testid=\"progress-count\"]").textContent, "104 / 183", "the count is where the game is");
  render(watch());
  assert.equal(box.hasAttribute("aria-busy"), false);
});

test("a focused key the state disables hands focus to the progress bar", () => {
  const { doc, key, track, render } = setup();
  render(watch({ idx: 182 }));
  key("forward").focus();
  render(watch({ state: "done", idx: 183 }));
  assert.equal(doc.activeElement, track);
});

test("an error shows the watch's own words beside its lamp", () => {
  const { find, render } = setup();
  render(watch({ state: "error", error: "The app restarted during a watch." }));
  assert.equal(find("[data-testid=\"watch-error\"]").hidden, false);
  assert.equal(find(".sc-transport-error-text").textContent, "The app restarted during a watch.");
});

test("destroy removes only what it added", () => {
  const { doc, root, component } = setup();
  component.destroy();
  assert.equal(kids(root).length, 0);
  assert.equal(doc.getElementById("outsider").textContent, "not yours");
});
