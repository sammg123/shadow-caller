// ui/input-kit.js (owner A7, ui-architecture.md 9.6): bar geometry and safe action calls (the inputs it once served are
// gone: the page takes no user input into the game, restructure-v2.md 1).
import assert from "node:assert/strict";
import test from "node:test";
import { createDocument } from "./fake-dom.mjs";
import { inDoc, settle } from "./ui-input-harness.mjs";

const kit = () => import("../../static/js/ui/input-kit.js");

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
