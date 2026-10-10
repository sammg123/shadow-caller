// ui/toast.js (owner A9; ui-architecture.md 2.6, 5.1; FI 4.5, #117, #118, #121, G27): the toast.
import assert from "node:assert/strict";
import test from "node:test";
import { mount } from "../../static/js/ui/toast.js";
import { chromeCtx, chromePage } from "./chrome-ctx.mjs";
import { withDocument } from "./fake-dom.mjs";

function setup() {
  const doc = chromePage([["div", "toast"]]);
  const root = doc.getElementById("toast");
  root.setAttribute("class", "toast");
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  const { ctx, calls } = chromeCtx();
  const mounted = withDocument(doc, () => mount(root, ctx));
  // el() reads globalThis.document when it creates a node, so every call runs inside this test's document.
  const component = { update: (t) => withDocument(doc, () => mounted.update(t)), destroy: () => mounted.destroy() };
  const text = () => root.querySelector(".sc-toast-text");
  const classes = () => root.className.split(" ");
  return { doc, root, component, text, classes, calls };
}

test("mount keeps the shell's live region and its legacy class", () => {
  const { root, classes } = setup();
  assert.equal(root.getAttribute("role"), "status");
  assert.equal(root.getAttribute("aria-live"), "polite");
  assert.ok(classes().includes("toast"));
  assert.ok(classes().includes("sc-toast"));
  assert.ok(root.querySelector(".sc-lamp"), "a lamp says info or error beside the words");
});

test("a message shows with .show and data-tone info (FI 4.5)", () => {
  const { root, component, text, classes } = setup();
  component.update({ id: 1, text: "Logged.", err: false });
  assert.equal(text().textContent, "Logged.");
  assert.ok(classes().includes("show"));
  assert.equal(classes().includes("err"), false);
  assert.equal(root.getAttribute("data-tone"), "info");
});

test("an error toast is .err and data-tone error (#117, #121)", () => {
  const { root, component, classes } = setup();
  component.update({ id: 2, text: "Can't reach the app server. Nothing was saved.", err: true });
  assert.ok(classes().includes("show"));
  assert.ok(classes().includes("err"));
  assert.equal(root.getAttribute("data-tone"), "error");
});

test("hiding keeps the text in the DOM (FI 4.5) and drops .show", () => {
  const { root, component, text, classes } = setup();
  component.update({ id: 3, text: "First down.", err: false });
  component.update(null);
  assert.equal(classes().includes("show"), false);
  assert.equal(classes().includes("err"), false);
  assert.equal(text().textContent, "First down.");
  assert.equal(root.hasAttribute("data-tone"), false);
});

test("#118: a new toast replaces the previous one; the same words again are a new line, so they are announced", () => {
  const { root, component, text } = setup();
  component.update({ id: 4, text: "Nothing to undo.", err: false });
  const first = text();
  component.update({ id: 5, text: "Nothing to undo.", err: false });
  assert.notEqual(text(), first, "a new id is a new node in the live region");
  assert.equal(root.querySelectorAll(".sc-toast-text").length, 1);
  component.update({ id: 6, text: "Undid the last action.", err: false });
  assert.equal(text().textContent, "Undid the last action.");
  const same = text();
  component.update({ id: 6, text: "Undid the last action.", err: false });
  assert.equal(text(), same, "the same toast rendered again stays the same node");
});

test("server text stays text (G27)", () => {
  const { component, text } = setup();
  component.update({ id: 7, text: "<img src=x onerror=alert(1)>", err: true });
  assert.equal(text().textContent, "<img src=x onerror=alert(1)>");
  assert.equal(text().children.length, 0);
});

test("destroy leaves the shell's #toast in place and empty", () => {
  const { root, component } = setup();
  component.update({ id: 8, text: "x", err: false });
  component.destroy();
  assert.equal(root.children.length, 0);
  assert.equal(root.getAttribute("role"), "status");
});

test("G5-13: an error is an alert with a Dismiss key (Esc) that keeps it while the pointer or focus is on it", () => {
  const { root, component, calls } = setup();
  const dismiss = root.querySelector(".sc-toast-dismiss");
  assert.ok(dismiss, "a Dismiss key in the toast");
  assert.equal(dismiss.localName, "button");
  assert.equal(dismiss.getAttribute("aria-label"), "Dismiss (Esc)");
  assert.equal(dismiss.getAttribute("aria-keyshortcuts"), "Escape");
  assert.equal(dismiss.textContent, "", "its key is drawn by CSS: the toast's words are only the message");
  assert.equal(dismiss.hidden, true, "no key without an error");
  component.update({ id: 4, text: "Clock like 8:41 or 841, got 'zz'", err: true });
  assert.deepEqual([root.getAttribute("role"), root.getAttribute("aria-live")], ["alert", "assertive"]);
  assert.equal(dismiss.hidden, false);
  assert.equal(root.textContent, "Clock like 8:41 or 841, got 'zz'");
  for (const type of ["pointerenter", "focusin", "pointerleave", "focusout"]) root.dispatchEvent({ type });
  dismiss.dispatchEvent({ type: "click", preventDefault() {} });
  assert.deepEqual(calls.filter((c) => /Toast$/.test(c[0])),
    [["holdToast", 4], ["holdToast", 4], ["releaseToast", 4], ["releaseToast", 4], ["dismissToast", 4]]);
  component.update({ id: 5, text: "Logged.", err: false });
  assert.deepEqual([root.getAttribute("role"), root.getAttribute("aria-live")], ["status", "polite"]);
  assert.equal(dismiss.hidden, true);
  for (const type of ["pointerenter", "focusin"]) root.dispatchEvent({ type });
  assert.equal(calls.filter((c) => c[0] === "holdToast").length, 2, "an info toast just goes");
  component.update(null);
  assert.deepEqual([root.getAttribute("role"), root.getAttribute("aria-live")], ["status", "polite"]);
});
