// ui/watch-transport.js (owner A9; ui-architecture.md 2.6, 3.8, 4.3, 5.4; DC E1): Watch this game controls.
import assert from "node:assert/strict";
import test from "node:test";
import { mount } from "../../static/js/ui/watch-transport.js";
import { transportVm } from "../../static/js/model/vm-transport.js";
import { chromeCtx, chromePage, click } from "./chrome-ctx.mjs";
import { withDocument } from "./fake-dom.mjs";
import { makePv, state } from "./model-fixtures.mjs";

const BUTTONS = ["start", "play", "pause", "step", "stop", "back", "again"];

function setup() {
  const doc = chromePage([["section", "rg-transport"]]);
  const { ctx, calls } = chromeCtx();
  const root = doc.getElementById("rg-transport");
  const component = withDocument(doc, () => mount(root, ctx));
  const find = (sel) => root.querySelector(sel);
  const btn = (name) => find(`[data-watch="${name}"]`);
  const render = (watch, prefs = {}) => component.update(transportVm(makePv({ presented: state.final(),
    version: watch === undefined ? null : { watch }, prefs })));
  /** Buttons a person can see and press, in DOM order. */
  const usable = () => BUTTONS.filter((n) => !btn(n).hidden && !btn(n).hasAttribute("disabled"));
  return { doc, root, calls, component, find, btn, render, usable };
}

const watch = (over) => ({ state: "playing", event_id: "401872980", speed: 4, idx: 104, total: 183,
  next_at: 1791504012345, error: null, ...over });

test("mount builds the transport with every hook (5.4) inside its root", () => {
  const { doc, find, btn } = setup();
  const box = find("[data-testid=\"watch\"]");
  assert.ok(box);
  assert.equal(box.getAttribute("role"), "group");
  assert.equal(box.getAttribute("aria-label"), "Watch this game");
  for (const name of BUTTONS) assert.ok(btn(name), `[data-watch="${name}"]`);
  for (const s of ["1", "2", "4", "10"]) assert.ok(find(`[data-speed="${s}"]`), `[data-speed="${s}"]`);
  assert.ok(find("[data-testid=\"watch-progress\"]"));
  assert.ok(find("[data-testid=\"watch-error\"]"));
  assert.equal(doc.getElementById("outsider").textContent, "not yours");
});

test("keys print the keyboard key that does the same thing (DESIGN.md Watch transport)", () => {
  const { btn, find } = setup();
  assert.equal(btn("play").getAttribute("aria-keyshortcuts"), "Space");
  assert.equal(btn("pause").getAttribute("aria-keyshortcuts"), "Space");
  assert.equal(btn("step").getAttribute("aria-keyshortcuts"), "ArrowRight");
  assert.deepEqual(["1", "2", "4", "10"].map((s) => find(`[data-speed="${s}"]`).getAttribute("aria-keyshortcuts")),
    ["1", "2", "3", "4"]);
  const part = (speed, cls) => find(`[data-speed="${speed}"]`).querySelector(cls);   // the fake DOM has no descendant selectors
  assert.deepEqual(["1", "2", "4", "10"].map((s) => part(s, ".sc-key-cap").textContent), ["1", "2", "3", "4"]);
  assert.equal(part("10", ".sc-key-name").textContent, "10x");
});

test("an old server without watch hides the whole transport", () => {
  const { find, render } = setup();
  render(undefined);
  assert.equal(find("[data-testid=\"watch\"]").hidden, true);
});

test("idle: start and the speed chosen beforehand; session keys are hidden and disabled", () => {
  const { find, btn, render, usable } = setup();
  render({ state: "idle", idx: 0, total: 0, speed: null }, { watchSpeed: 2 });
  const box = find("[data-testid=\"watch\"]");
  assert.equal(box.hidden, false);
  assert.equal(box.getAttribute("data-watch-state"), "idle");
  assert.equal(box.getAttribute("data-active"), "false");
  assert.deepEqual(usable(), ["start"]);
  for (const name of ["play", "pause", "step", "stop", "back", "again"]) {
    assert.equal(btn(name).hidden, true, `${name} hidden`);
    assert.equal(btn(name).hasAttribute("disabled"), true, `${name} disabled`);
  }
  assert.equal(find("[data-speed=\"2\"]").getAttribute("aria-pressed"), "true");
  assert.equal(find("[data-speed=\"4\"]").getAttribute("aria-pressed"), "false");
  assert.equal(find("[data-testid=\"watch-progress\"]").hidden, true);
});

test("playing: pause and stop; step waits for a pause; progress reads idx / total", () => {
  const { find, btn, render, usable } = setup();
  render(watch());
  const box = find("[data-testid=\"watch\"]");
  assert.equal(box.getAttribute("data-watch-state"), "playing");
  assert.equal(box.getAttribute("data-active"), "true");
  assert.deepEqual(usable(), ["pause", "stop"]);
  assert.equal(btn("step").hidden, false, "step stays in view, disabled");
  assert.equal(btn("step").hasAttribute("disabled"), true);
  assert.equal(btn("play").hidden, true);
  assert.equal(btn("start").hidden, true);
  const progress = find("[data-testid=\"watch-progress\"]");
  assert.equal(progress.hidden, false);
  assert.equal(progress.textContent, "104 / 183");
  assert.equal(find("[data-speed=\"4\"]").getAttribute("aria-pressed"), "true");
});

test("paused: play, step and stop", () => {
  const { btn, render, usable } = setup();
  render(watch({ state: "paused", speed: 10 }));
  assert.deepEqual(usable(), ["play", "step", "stop"]);
  assert.equal(btn("pause").hidden, true);
});

test("done: Back to my game and Watch again", () => {
  const { find, render, usable } = setup();
  render(watch({ state: "done", idx: 183, next_at: null }));
  assert.deepEqual(usable(), ["back", "again"]);
  assert.equal(find("[data-testid=\"watch-progress\"]").textContent, "183 / 183");
});

test("error: the server's text beside a lamp, and Stop puts the game back", () => {
  const { find, render, usable } = setup();
  render(watch({ state: "error", error: "The app restarted during a watch." }));
  const err = find("[data-testid=\"watch-error\"]");
  assert.equal(err.hidden, false);
  assert.match(err.textContent, /The app restarted during a watch\./);
  assert.ok(usable().includes("stop"));
  render(watch());
  assert.equal(err.hidden, true);
});

test("every key calls its action", () => {
  const { find, btn, render, calls } = setup();
  render(watch({ state: "paused" }));
  click(btn("play"));
  click(btn("step"));
  click(btn("stop"));
  render(watch());
  click(btn("pause"));
  render(watch({ state: "done" }));
  click(btn("back"));
  click(btn("again"));
  render({ state: "idle", idx: 0, total: 0, speed: null });
  click(btn("start"));
  click(find("[data-speed=\"10\"]"));
  click(find("[data-speed=\"1\"]"));
  assert.deepEqual(calls, [["watchToggle"], ["watchStep"], ["watchStop"], ["watchToggle"], ["watchStop"],
    ["watchStart", ""], ["watchStart", ""], ["watchSpeed", 10], ["watchSpeed", 1]]);
});

test("G5-7: focusTransport puts focus on Pause once the started watch shows it, unless someone is typing", () => {
  const { doc, btn, render, component } = setup();
  const watchBtn = doc.createElement("button");
  doc.body.appendChild(watchBtn);
  render(watch({ state: "idle" }));
  watchBtn.focus();                                           // "Watch this game" in the drawer, by keyboard
  withDocument(doc, () => component.form.focusTransport());
  assert.equal(doc.activeElement, watchBtn, "Pause isn't shown yet: wait for the render that shows it");
  watchBtn.remove();                                          // the drawer closes: focus falls to the body
  render(watch());
  assert.equal(doc.activeElement, btn("pause"), "the start's control is gone: Pause has focus");
  btn("pause").blur?.();
  render(watch());
  assert.notEqual(doc.activeElement, btn("pause"), "once only");

  const handedBack = setup();
  const boothKey = handedBack.doc.createElement("button");
  handedBack.doc.body.appendChild(boothKey);
  handedBack.render(watch({ state: "idle" }));
  withDocument(handedBack.doc, () => handedBack.component.form.focusTransport());
  boothKey.focus();                                           // the closing booth gives focus back to its B key
  handedBack.render(watch());
  assert.equal(handedBack.doc.activeElement, handedBack.btn("pause"), "the started game's Pause still wins");

  const typingNow = setup();
  const box = typingNow.doc.createElement("input");
  box.setAttribute("type", "text");
  typingNow.doc.body.appendChild(box);
  typingNow.render(watch({ state: "idle" }));
  withDocument(typingNow.doc, () => typingNow.component.form.focusTransport());
  box.focus();                                                // someone typing meanwhile
  typingNow.render(watch());
  assert.equal(typingNow.doc.activeElement, box, "a box being typed in is never left");

  const failed = setup();
  failed.render(watch({ state: "idle" }));
  withDocument(failed.doc, () => failed.component.form.focusTransport());
  failed.render(watch({ state: "error", error: "ESPN didn't answer." }));
  failed.render(watch());
  assert.notEqual(failed.doc.activeElement, failed.btn("pause"), "a start that failed leaves nothing pending");
});

test("G5-7: a Pause key not laid out yet (its region hidden while the page turns to Watch) gets focus once it is", () => {
  const doc = chromePage([["section", "rg-transport"]]);
  const { ctx } = chromeCtx();
  const pending = [];
  const timers = { setTimeout: (fn) => { pending.push(fn); return pending.length; }, clearTimeout: () => {} };
  const root = doc.getElementById("rg-transport");
  const component = withDocument(doc, () => mount(root, { ...ctx, timers }));
  const pause = root.querySelector('[data-watch="pause"]');
  let shown = false;
  pause.getClientRects = () => (shown ? [{ width: 80, height: 40 }] : []);
  withDocument(doc, () => component.form.focusTransport());
  component.update(transportVm(makePv({ presented: state.final(), version: { watch: watch() } })));
  assert.notEqual(doc.activeElement, pause, "display: none until #app[data-mode] says watch");
  assert.ok(pending.length >= 1, "it tries again shortly");
  shown = true;
  pending.splice(0).forEach((fn) => fn());
  assert.equal(doc.activeElement, pause);
  pending.splice(0).forEach((fn) => fn());
  assert.equal(pending.length, 0, "done: no more tries");
});

test("a focused key that the new state hides hands focus to its counterpart (Pause to Play and back)", () => {
  const { doc, btn, render } = setup();
  render(watch());
  btn("pause").focus();
  render(watch({ state: "paused" }));
  assert.equal(doc.activeElement, btn("play"), "keyboard users keep their place after Space or Enter on Pause");
  render(watch());
  assert.equal(doc.activeElement, btn("pause"));
  btn("stop").focus();
  render({ state: "idle", idx: 0, total: 0, speed: null });
  assert.equal(doc.activeElement, btn("start"), "Stop gives way to Start");
  doc.body.focus?.();
  render(watch());
  assert.notEqual(doc.activeElement, btn("pause"), "focus outside the transport is never pulled in");
});

test("a disabled or hidden key does nothing when clicked", () => {
  const { btn, render, calls } = setup();
  render(watch());
  click(btn("step"));
  click(btn("play"));
  assert.deepEqual(calls, []);
});

test("a render that changes nothing writes nothing", () => {
  const { doc, render } = setup();
  render(watch());
  const writes = doc.writes;
  render(watch());
  assert.equal(doc.writes, writes);
});

test("destroy takes the transport out of its root", () => {
  const { root, component } = setup();
  component.destroy();
  assert.equal(root.children.length, 0);
});
