// ui/keycap.js (owner A9, ui-architecture.md v1.2 section 9.6): key caps and lamps shared by the chrome components.
import assert from "node:assert/strict";
import test from "node:test";
import { keycap, lamp, setKeyName, setKeyValue } from "../../static/js/ui/keycap.js";
import { createDocument, withDocument } from "./fake-dom.mjs";

const inDoc = (fn) => withDocument(createDocument(), () => fn(globalThis.document));

test("keycap builds a button with the key printed on its cap, its name and an optional value", () => inDoc(() => {
  let clicks = 0;
  const k = keycap({ cap: "V", name: "Camera", value: "Sideline", shortcut: "V", title: "Change the camera (V)",
    id: "camBtn", cls: "sc-masthead-key", data: { testid: "camera-mode" }, on: { click: () => { clicks += 1; } } });
  assert.equal(k.node.tagName, "BUTTON");
  assert.equal(k.node.getAttribute("type"), "button");
  assert.equal(k.node.getAttribute("class"), "sc-key sc-masthead-key");
  assert.equal(k.node.id, "camBtn");
  assert.equal(k.node.getAttribute("aria-keyshortcuts"), "V");
  assert.equal(k.node.getAttribute("title"), "Change the camera (V)");
  assert.equal(k.node.getAttribute("data-testid"), "camera-mode");
  assert.equal(k.cap.getAttribute("aria-hidden"), "true", "the cap is decoration: the name is the accessible label");
  assert.equal(k.cap.getAttribute("class"), "sc-key-cap");
  assert.equal(k.name.getAttribute("class"), "sc-key-name");
  assert.equal(k.value.getAttribute("class"), "sc-key-value");
  assert.equal(k.node.textContent, "VCameraSideline");
  k.node.dispatchEvent({ type: "click" });
  assert.equal(clicks, 1);
}));

test("keycap without a cap or a value leaves those parts out; a link keeps its href and gets no type", () => inDoc(() => {
  const k = keycap({ tag: "a", name: "Export CSV", attrs: { href: "/api/export.csv", download: "shadow_caller_log.csv" } });
  assert.equal(k.node.tagName, "A");
  assert.equal(k.node.hasAttribute("type"), false);
  assert.equal(k.node.getAttribute("href"), "/api/export.csv");
  assert.equal(k.cap, null);
  assert.equal(k.value, null);
  assert.equal(k.node.textContent, "Export CSV");
  assert.equal(k.node.hasAttribute("aria-keyshortcuts"), false);
}));

test("setKeyName and setKeyValue change only the text that changed", () => inDoc((doc) => {
  const k = keycap({ cap: "V", name: "Camera", value: "" });
  setKeyValue(k, "Endzone");
  assert.equal(k.value.textContent, "Endzone");
  const writes = doc.writes;
  setKeyValue(k, "Endzone");
  setKeyName(k, "Camera");
  assert.equal(doc.writes, writes, "no write when the text is already there");
  setKeyName(k, "View");
  assert.equal(k.name.textContent, "View");
  setKeyValue(keycap({ name: "x" }), "ignored without a value part");
}));

test("lamp is a decorative span a world lights through data-lamp", () => inDoc(() => {
  const l = lamp("sc-feed-lamp");
  assert.equal(l.tagName, "SPAN");
  assert.equal(l.getAttribute("class"), "sc-lamp sc-feed-lamp");
  assert.equal(l.getAttribute("aria-hidden"), "true");
  assert.equal(lamp().getAttribute("class"), "sc-lamp");
}));
