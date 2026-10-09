// ui/input-kit.js (owner A7, ui-architecture.md 9.6): key caps, select-on-focus, bar geometry, safe action calls.
import assert from "node:assert/strict";
import test from "node:test";
import { createDocument } from "./fake-dom.mjs";
import { fakeTimers, fire, hasClass, inDoc, settle } from "./ui-input-harness.mjs";

const kit = () => import("../../static/js/ui/input-kit.js");

test("keyCap builds a button with the key window, the name and an optional hint", async () => {
  const { keyCap, setKeyCap } = await kit();
  const doc = createDocument();
  inDoc(doc, () => {
    const clicks = [];
    const key = keyCap({ key: "J", name: "Left", hint: "JJ: outside edge", cls: ["key"], data: { k: "J" },
      attrs: { "aria-pressed": "false" }, on: { click: () => clicks.push(1) } });
    assert.equal(key.localName, "button");
    assert.equal(key.getAttribute("type"), "button");
    assert.ok(hasClass(key, "sc-key") && hasClass(key, "key"));
    assert.equal(key.getAttribute("data-k"), "J");
    assert.equal(key.getAttribute("aria-pressed"), "false");
    assert.equal(key.querySelector(".sc-key-cap").textContent, "J");
    assert.equal(key.querySelector(".sc-key-cap").getAttribute("aria-hidden"), "true", "the cap is decoration");
    assert.equal(key.getAttribute("aria-keyshortcuts"), "J");
    assert.equal(key.querySelector(".sc-key-name").textContent, "Left");
    assert.equal(key.querySelector(".sc-key-hint").textContent, "JJ: outside edge");
    fire(key, "click");
    assert.deepEqual(clicks, [1]);
    const plain = keyCap({ key: "N", name: "Screen" });
    assert.equal(plain.querySelector(".sc-key-hint").hidden, true, "an empty hint is hidden, never a blank gap");
    setKeyCap(plain, { key: "N", name: "Screen", hint: "now with a hint" });
    assert.equal(plain.querySelector(".sc-key-hint").hidden, false);
    assert.equal(plain.textContent, "NScreennow with a hint");
  });
});

test("keyCap without a key letter leaves the window out (mouse-only buttons)", async () => {
  const { keyCap } = await kit();
  const doc = createDocument();
  inDoc(doc, () => {
    const other = keyCap({ key: "", name: "Other on TB", hint: "yards from the Yards box" });
    assert.equal(other.querySelector(".sc-key-cap").hidden, true);
    assert.equal(other.querySelector(".sc-key-name").textContent, "Other on TB");
  });
});

test("selectOnFocus selects now and again after the click that focused it, unless typing began", async () => {
  const { selectOnFocus } = await kit();
  const doc = createDocument();
  inDoc(doc, () => {
    const timers = fakeTimers();
    const input = doc.body.appendChild(doc.createElement("input"));
    let selects = 0;
    input.select = () => { selects += 1; };
    let pristine = true;
    selectOnFocus(input, { pristine: () => pristine, later: (fn) => timers.setTimeout(fn, 0) });
    input.focus();
    fire(input, "focus");
    assert.equal(selects, 1);
    timers.runAll();
    assert.equal(selects, 2, "the deferred select survives the caret a click places");
    fire(input, "focus");
    pristine = false;
    timers.runAll();
    assert.equal(selects, 3, "typing started: the deferred select is skipped");
    input.blur();
    fire(input, "focus");
    pristine = true;
    timers.runAll();
    assert.equal(selects, 4, "no deferred select once focus has moved on");
  });
});

test("selectOnFocus never re-selects what was typed after the focus (a fast typist's first digit survives)",
  async () => {
    const { selectOnFocus } = await kit();
    const doc = createDocument();
    inDoc(doc, () => {
      const timers = fakeTimers();
      const input = doc.body.appendChild(doc.createElement("input"));
      let selects = 0;
      input.select = () => { selects += 1; };
      selectOnFocus(input, { later: (fn) => timers.setTimeout(fn, 0) });
      input.focus();
      fire(input, "focus");
      input.value = "1";
      fire(input, "input");
      timers.runAll();
      assert.equal(selects, 1, "only the select at focus time");
      fire(input, "focus");
      timers.runAll();
      assert.equal(selects, 3, "a new focus starts clean");
    });
  });

test("setPct writes a clamped percentage custom property and removes it for non-numbers", async () => {
  const { setPct } = await kit();
  const doc = createDocument();
  inDoc(doc, () => {
    const node = doc.createElement("span");
    setPct(node, "--sc-share", 47.52);
    assert.equal(node.style.getPropertyValue("--sc-share"), "47.52%");
    setPct(node, "--sc-share", 140);
    assert.equal(node.style.getPropertyValue("--sc-share"), "100%");
    setPct(node, "--sc-share", -3);
    assert.equal(node.style.getPropertyValue("--sc-share"), "0%");
    setPct(node, "--sc-share", Number.NaN);
    assert.equal(node.style.getPropertyValue("--sc-share"), "");
    setPct(node, "--sc-share", null);
    assert.equal(node.style.getPropertyValue("--sc-share"), "");
  });
});

test("act runs an action, resolves its result, and reports a throw or a rejection instead of throwing", async () => {
  const { act } = await kit();
  const reported = [];
  const before = globalThis.reportError;
  globalThis.reportError = (err) => reported.push(err.message);
  try {
    assert.equal(await act(() => 7), 7);
    assert.equal(await act(async () => 8), 8);
    assert.equal(await act(() => { throw new Error("sync boom"); }), undefined);
    assert.equal(await act(async () => { throw new Error("async boom"); }), undefined);
    assert.equal(await act(() => undefined), undefined);
    await settle();
    assert.deepEqual(reported, ["sync boom", "async boom"]);
  } finally {
    globalThis.reportError = before;
  }
});

test("isFocused reads the node's own document", async () => {
  const { isFocused } = await kit();
  const doc = createDocument();
  inDoc(doc, () => {
    const input = doc.body.appendChild(doc.createElement("input"));
    assert.equal(isFocused(input), false);
    input.focus();
    assert.equal(isFocused(input), true);
    assert.equal(isFocused(null), false);
  });
});
