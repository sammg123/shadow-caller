// ui/scrub.js (owner W5; ui-architecture.md v1.4, 19; DESIGN.md Watch transport): the replay scrub. It shares the
// transport's region (#rg-transport) and appends after it; review only: every move goes through actions.reviewAt,
// actions.review(-1) or actions.exitReview, never a watch step.
import assert from "node:assert/strict";
import test from "node:test";
import { mount } from "../../static/js/ui/scrub.js";
import { scrubVm } from "../../static/js/model/vm-scrub.js";
import { chromeCtx, chromePage, click, keydown } from "./chrome-ctx.mjs";
import { withDocument } from "./fake-dom.mjs";
import { makePv, timeline, tlOf } from "./model-fixtures.mjs";

const watching = (over = {}) => ({ watch: { state: "playing", event_id: "401872980", speed: 10, idx: 104, total: 183,
  next_at: null, error: null, ...over } });
const finalVm = (seq = null) => scrubVm(makePv({ tl: tlOf(timeline.final()), view: { review: { seq } } }));
const watchVm = (drawn = 104, seq = null) => scrubVm(makePv({ tl: tlOf(timeline.at104(), drawn), version: watching(),
  view: { review: { seq } } }));

function setup() {
  const doc = chromePage([["section", "rg-transport"]]);
  const root = doc.getElementById("rg-transport");
  const transport = doc.createElement("div");
  transport.setAttribute("data-testid", "watch");
  root.appendChild(transport);
  const { ctx, calls } = chromeCtx();
  const component = withDocument(doc, () => mount(root, ctx));
  const find = (sel) => root.querySelector(sel);
  const all = (sel) => [...root.querySelectorAll(sel)];
  const track = find("[data-testid=\"scrub-track\"]");
  track.getBoundingClientRect = () => ({ left: 100, top: 0, width: 183, height: 40, right: 283, bottom: 40 });
  const render = (vm) => withDocument(doc, () => component.update(vm));
  return { doc, root, transport, calls, component, find, all, track, render };
}

/** A pointer event at slot `slot` of a 183-slot strip that starts at x 100 (the slot's center). */
function pointer(node, type, slot, { button = 0, pointerId = 7 } = {}) {
  const evt = { type, button, pointerId, clientX: 100 + slot - 0.5, prevented: false };
  evt.preventDefault = () => { evt.prevented = true; };
  node.dispatchEvent(evt);
  return evt;
}

const style = (node, name) => node.style.getPropertyValue(name);

test("mount appends the scrub after the transport, inside its root, with every hook", () => {
  const { doc, root, transport, find, track } = setup();
  const box = find("[data-testid=\"scrub\"]");
  assert.ok(box);
  assert.equal(root.firstChild, transport, "the transport stays first");
  assert.equal(transport.nextSibling, box);
  assert.deepEqual([...box.children].map((n) => n.getAttribute("class").split(" ").at(-1)),
    ["sc-scrub-readout", "sc-scrub-earlier", "sc-scrub-track", "sc-scrub-live"], "DOM order is the tab and reading order");
  assert.equal(box.getAttribute("role"), "group");
  assert.equal(box.getAttribute("aria-label"), "Replay");
  assert.equal(track.getAttribute("role"), "slider");
  assert.equal(track.getAttribute("tabindex"), "0");
  assert.equal(track.getAttribute("aria-label"), "Review a play");
  assert.equal(track.getAttribute("aria-orientation"), "horizontal");
  assert.equal(doc.getElementById("outsider").textContent, "not yours");
});

test("the keys print the keyboard key that does the same thing (←, Esc) and name what they do", () => {
  const { find } = setup();
  const earlier = find("[data-scrub=\"earlier\"]");
  const live = find("[data-scrub=\"live\"]");
  assert.equal(earlier.querySelector(".sc-key-cap").textContent, "←");
  assert.equal(earlier.querySelector(".sc-key-name").textContent, "Earlier play");
  assert.equal(earlier.getAttribute("aria-keyshortcuts"), "ArrowLeft");
  assert.equal(live.querySelector(".sc-key-cap").textContent, "Esc");
  assert.equal(live.querySelector(".sc-key-name").textContent, "Live");
  // G5-12 (WCAG 2.5.3, axe label-content-name-mismatch): the name is the visible word, the cap is aria-hidden, and
  // the description says what the key does and which key does it
  assert.equal(live.getAttribute("aria-label"), null, "named by its visible word");
  assert.equal(live.getAttribute("title"), "Back to live (Esc)");
  assert.equal(earlier.getAttribute("aria-label"), null);
  assert.equal(earlier.getAttribute("title"), "Earlier play (Left)");
  assert.equal(live.getAttribute("aria-keyshortcuts"), "Escape");
  assert.ok(live.querySelector(".sc-lamp"), "a tally lamp beside the word");
});

test("hidden until there is a game to scrub", () => {
  const { find, render } = setup();
  assert.equal(find("[data-testid=\"scrub\"]").hidden, true);
  render(scrubVm(makePv({})));
  assert.equal(find("[data-testid=\"scrub\"]").hidden, true);
  render(finalVm());
  assert.equal(find("[data-testid=\"scrub\"]").hidden, false);
});

test("a finished game: drives and marks as keyed items with their slot fractions, the knob at the live edge", () => {
  const { find, all, track, render } = setup();
  const vm = finalVm();
  render(vm);
  const drives = all(".sc-scrub-drive");
  assert.equal(drives.length, 21);
  assert.deepEqual([drives[0].getAttribute("data-team"), drives[0].getAttribute("data-caller")], ["DAL", "true"]);
  assert.deepEqual([drives[1].getAttribute("data-team"), drives[1].getAttribute("data-caller")], ["TB", "false"]);
  assert.equal(style(drives[0], "--sc-scrub-from"), "0");
  assert.equal(style(drives[0], "--sc-scrub-to"), String(vm.drives[0].to));
  const marks = all(".sc-scrub-mark");
  assert.equal(marks.length, 13);
  assert.deepEqual(marks.filter((m) => m.getAttribute("data-kind") === "quarter").map((m) => m.getAttribute("data-label")),
    ["Q2", "Q3", "Q4"]);
  assert.equal(style(marks[0], "--sc-scrub-at"), String(vm.marks[0].at));
  assert.equal(style(track, "--sc-scrub-knob"), "1");
  assert.equal(style(track, "--sc-scrub-head"), "1");
  assert.equal(track.getAttribute("aria-valuemin"), "1");
  assert.equal(track.getAttribute("aria-valuenow"), "156");
  assert.equal(track.getAttribute("aria-valuemax"), "156");
  assert.equal(track.getAttribute("aria-valuetext"), vm.value.text);
  assert.match(vm.value.text, /^Live: Q4 /);
  const box = find("[data-testid=\"scrub\"]");
  assert.equal(box.getAttribute("data-state"), "live");
  assert.equal(find("[data-scrub=\"live\"]").hasAttribute("disabled"), true, "already live");
  assert.equal(find(".sc-scrub-live-lamp").getAttribute("data-on"), "true", "the tally lamp is lit at the live edge");
  assert.equal(find("[data-scrub=\"earlier\"]").hasAttribute("disabled"), false);
  assert.equal(find(".sc-scrub-word").textContent, "Live");
  assert.equal(find(".sc-scrub-title").textContent, "", "no session, no mode name");
  assert.equal(find(".sc-scrub-head").textContent, vm.readout.head);
  assert.equal(find(".sc-scrub-label").textContent, vm.readout.label);
  assert.equal(find(".sc-scrub-knob").hidden, false);
});

test("review: the knob moves to the play, the LIVE key wakes up and its lamp goes out", () => {
  const { find, track, render } = setup();
  const vm = finalVm(12);
  render(vm);
  assert.equal(find("[data-testid=\"scrub\"]").getAttribute("data-state"), "review");
  assert.equal(style(track, "--sc-scrub-knob"), String(vm.knobAt));
  assert.equal(track.getAttribute("aria-valuenow"), "12");
  assert.equal(find("[data-scrub=\"live\"]").hasAttribute("disabled"), false);
  assert.equal(find(".sc-scrub-live-lamp").getAttribute("data-on"), "false");
  assert.equal(find(".sc-scrub-word").textContent, "Review");
});

test("a watch: the strip keeps its nodes as plays land (keyed), and only adds what is new", () => {
  const { doc, all, track, render } = setup();
  render(watchVm(97));
  const before = all(".sc-scrub-drive");
  assert.equal(before.length, 11);
  const moves = doc.moves;
  render(watchVm(104));
  const after = all(".sc-scrub-drive");
  assert.equal(after.length, 12);
  assert.deepEqual(after.slice(0, 11), before, "the drawn drives are the same nodes");
  assert.equal(doc.moves - moves, 2, "one new drive and one new mark (the interception) are inserted");
  assert.equal(style(track, "--sc-scrub-head"), String(watchVm(104).headAt));
});

test("← reviews an earlier play and LIVE returns to live; a disabled key never reaches an action", () => {
  const { find, calls, render } = setup();
  render(finalVm());
  click(find("[data-scrub=\"live\"]"));
  click(find("[data-scrub=\"earlier\"]"));
  assert.deepEqual(calls, [["review", -1]]);
  render(finalVm(12));
  click(find("[data-scrub=\"live\"]"));
  assert.deepEqual(calls.at(-1), ["exitReview"]);
  render(finalVm(1));
  click(find("[data-scrub=\"earlier\"]"));
  assert.equal(calls.length, 2, "nothing is earlier than the first play");
});

test("keys on the strip step through plays and drives with reviewAt, and never step the server", () => {
  const { calls, track, render } = setup();
  render(finalVm());
  assert.equal(keydown(track, "ArrowLeft").prevented, true);
  assert.deepEqual(calls.at(-1), ["reviewAt", 182]);
  keydown(track, "ArrowRight");
  assert.equal(calls.length, 1, "live stays live");
  render(finalVm(12));
  keydown(track, "ArrowRight");
  assert.deepEqual(calls.at(-1), ["reviewAt", 14]);
  keydown(track, "ArrowDown");
  assert.deepEqual(calls.at(-1), ["reviewAt", 11]);
  keydown(track, "Home");
  assert.deepEqual(calls.at(-1), ["reviewAt", 1]);
  keydown(track, "End");
  assert.deepEqual(calls.at(-1), ["reviewAt", null]);
  render(finalVm(20));
  keydown(track, "PageUp");
  assert.deepEqual(calls.at(-1), ["reviewAt", 14]);
  keydown(track, "PageDown");
  assert.deepEqual(calls.at(-1), ["reviewAt", 37]);
  assert.equal(calls.some(([name]) => ["review", "watchStep"].includes(name)), false);
});

test("keys on the strip: Space plays or pauses; Esc, 1 to 4 and every other key pass through to the page (G5-12)", () => {
  const { calls, track, render } = setup();
  render(finalVm(12));
  assert.equal(keydown(track, " ").prevented, true);
  assert.deepEqual(calls.at(-1), ["watchToggle"]);
  const n = calls.length;
  // core/keymap.js runs these for a focused slider as anywhere else (Esc leaves review, 1 to 4 set the speed, B, G,
  // V and the retag keys), so the strip must not run them a second time
  for (const key of ["Escape", "3", "4", "b", "g", "v", "a", "Tab"]) {
    assert.equal(keydown(track, key).prevented, false, key);
  }
  track.dispatchEvent({ type: "keydown", key: "ArrowLeft", ctrlKey: true, preventDefault() {} });
  track.dispatchEvent({ type: "keydown", key: " ", repeat: true, preventDefault() {} });
  assert.equal(calls.length, n);
});

test("pointer: press and drag review the play under the pointer; the unplayed part of the strip is live", () => {
  const { find, calls, track, render } = setup();
  render(watchVm());
  const down = pointer(track, "pointerdown", 12);
  assert.equal(down.prevented, true, "keeps keyboard focus where it was, so the shortcuts keep working");
  assert.deepEqual(calls.at(-1), ["reviewAt", 12]);
  render(watchVm(104, 12));
  pointer(track, "pointermove", 12);
  assert.equal(calls.length, 1, "the same play is not asked for twice");
  pointer(track, "pointermove", 13);
  assert.deepEqual(calls.at(-1), ["reviewAt", 12], "a timeout snaps to the play before it");
  assert.equal(calls.length, 1);
  pointer(track, "pointermove", 20);
  assert.deepEqual(calls.at(-1), ["reviewAt", 20]);
  pointer(track, "pointermove", 150);
  assert.deepEqual(calls.at(-1), ["reviewAt", null], "past the field's newest row: live");
  assert.equal(find("[data-testid=\"scrub\"]").getAttribute("data-dragging"), "true");
  pointer(track, "pointerup", 150);
  assert.equal(find("[data-testid=\"scrub\"]").getAttribute("data-dragging"), "false");
  const n = calls.length;
  pointer(track, "pointermove", 30);
  assert.equal(calls.length, n, "hovering asks for nothing");
  pointer(track, "pointerdown", 40, { button: 2 });
  assert.equal(calls.length, n, "only the main button scrubs");
});

test("hover shows which play is under the pointer, on the readout and as a ghost knob, and nothing else", () => {
  const { find, track, render } = setup();
  const vm = watchVm();
  render(vm);
  pointer(track, "pointermove", 35);
  const readout = find(".sc-scrub-readout");
  assert.equal(readout.getAttribute("data-show"), "hover");
  const play = vm.plays.find((p) => p.seq === 35);
  assert.deepEqual([find(".sc-scrub-head").textContent, find(".sc-scrub-label").textContent], [play.head, play.label]);
  assert.equal(find(".sc-scrub-word").textContent, "");
  assert.equal(find(".sc-scrub-ghost").hidden, false);
  assert.equal(style(track, "--sc-scrub-hover"), String(Number((34.5 / 183).toFixed(5))));
  render(watchVm());
  assert.equal(readout.getAttribute("data-show"), "hover", "a render while hovering keeps the preview");
  pointer(track, "pointermove", 160);
  assert.equal(readout.getAttribute("data-show"), "live", "over the unplayed part: the live readout");
  assert.equal(find(".sc-scrub-ghost").hidden, true);
  pointer(track, "pointermove", 35);
  track.dispatchEvent({ type: "pointerleave" });
  assert.equal(readout.getAttribute("data-show"), "live");
  assert.equal(find(".sc-scrub-label").textContent, vm.readout.label);
  assert.equal(find(".sc-scrub-ghost").hidden, true);
});

test("an empty watch: an unlit strip, no knob, nothing to step to", () => {
  const { find, calls, track, render } = setup();
  render(scrubVm(makePv({ tl: tlOf(timeline.at104(), 0), version: watching({ idx: 0 }) })));
  assert.equal(find("[data-testid=\"scrub\"]").hidden, false);
  assert.equal(find("[data-testid=\"scrub\"]").getAttribute("data-state"), "empty");
  assert.equal(find(".sc-scrub-knob").hidden, true);
  assert.equal(find("[data-scrub=\"earlier\"]").hasAttribute("disabled"), true);
  assert.equal(track.getAttribute("aria-disabled"), "true");
  assert.equal(track.getAttribute("aria-valuetext"), "No plays yet");
  assert.equal(find(".sc-scrub-label").textContent, "No plays yet");
  assert.equal(find(".sc-scrub-head").textContent, "");
  assert.equal(find(".sc-scrub-title").textContent, "Watch this game", "a session names its mode on the board");
  pointer(track, "pointerdown", 10);
  keydown(track, "ArrowLeft");
  assert.deepEqual(calls, []);
});

test("a strip that cannot be measured (hidden, zero width) asks for nothing", () => {
  const { calls, track, render } = setup();
  render(finalVm());
  track.getBoundingClientRect = () => ({ left: 0, width: 0 });
  pointer(track, "pointerdown", 10);
  pointer(track, "pointermove", 10);
  assert.deepEqual(calls, []);
});

test("destroy removes only the scrub", () => {
  const { root, transport, component, find } = setup();
  component.destroy();
  assert.equal(find("[data-testid=\"scrub\"]"), null);
  assert.equal(root.firstChild, transport);
});

test("a key pressed from the keyboard that the new state disables hands focus to the strip", () => {
  const { doc, find, calls, track, render } = setup();
  render(finalVm(12));
  const live = find("[data-scrub=\"live\"]");
  live.focus();
  live.dispatchEvent({ type: "click", detail: 0 });
  assert.deepEqual(calls.at(-1), ["exitReview"]);
  render(finalVm());
  assert.equal(doc.activeElement, track, "Tab keeps its place");
  const earlier = find("[data-scrub=\"earlier\"]");
  render(finalVm(12));
  earlier.focus();
  earlier.dispatchEvent({ type: "click", detail: 1 });
  render(finalVm(1));
  assert.equal(doc.activeElement, earlier, "a mouse click leaves focus alone");
});

test("after a drag the board shows the play on the field, not the play hovered before the press", () => {
  const { find, track, render } = setup();
  render(watchVm());
  pointer(track, "pointermove", 35);
  assert.equal(find(".sc-scrub-readout").getAttribute("data-show"), "hover");
  pointer(track, "pointerdown", 12);
  render(watchVm(104, 12));
  pointer(track, "pointerup", 12);
  assert.equal(find(".sc-scrub-readout").getAttribute("data-show"), "review");
  assert.equal(find(".sc-scrub-word").textContent, "Review");
});
