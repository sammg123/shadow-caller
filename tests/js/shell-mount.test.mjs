// shell/notices.js and shell/mount.js (ui-architecture.md 9.1; owner A0): defensive mounting with visible notices.
import assert from "node:assert/strict";
import test from "node:test";
import { fallbackBoot, fallbackToast, loadModules, mountComponents } from "../../static/js/shell/mount.js";
import { createNotices } from "../../static/js/shell/notices.js";
import { createDocument, withDocument } from "./fake-dom.mjs";

function page() {
  const doc = createDocument();
  for (const id of ["rg-masthead", "rg-feed", "toast", "sc-notices"]) {
    const node = doc.createElement("div");
    node.setAttribute("id", id);
    doc.body.appendChild(node);
  }
  return doc;
}

const spec = (name, root, load, extra = {}) => Object.freeze({ name, region: name, root, label: `The ${name}`, load,
  select: (pv) => pv, deps: () => [], ...extra });

const okModule = (calls) => async () => ({ mount: (root, ctx) => { calls.push([root.id, Boolean(ctx.actions)]);
  return { update() {}, destroy() {} }; } });

test("loadModules starts every import at once and keeps the table order", async () => {
  const order = [];
  const specs = [spec("a", "#x", async () => { await null; order.push("a"); return { mount: 1 }; }),
    spec("b", "#y", async () => { order.push("b"); throw new Error("404"); })];
  const settled = await loadModules(specs);
  assert.deepEqual(settled.map((r) => r.status), ["fulfilled", "rejected"]);
  assert.deepEqual(order, ["b", "a"], "imports run in parallel");
});

test("mountComponents mounts in order and binds each component", () => withDocument(page(), async () => {
  const doc = globalThis.document;
  const calls = [];
  const specs = [spec("masthead", "#rg-masthead", okModule(calls)), spec("feed", "#rg-feed", okModule(calls))];
  const { bindings, failed } = mountComponents(specs, await loadModules(specs),
    { doc, ctx: { actions: {} }, notices: createNotices(doc) });
  assert.deepEqual(calls, [["rg-masthead", true], ["rg-feed", true]]);
  assert.deepEqual(bindings.map((b) => b.name), ["masthead", "feed"]);
  assert.deepEqual(failed, []);
}));

test("a module that fails to load, has no mount, or throws in mount leaves a visible notice; boot goes on", () => withDocument(page(), async () => {
  const doc = globalThis.document;
  const calls = [];
  const specs = [
    spec("masthead", "#rg-masthead", async () => { throw new TypeError("Failed to fetch dynamically imported module"); }),
    spec("feed", "#rg-feed", async () => ({ notMount: true })),
    spec("toast", "#toast", async () => ({ mount: () => { throw new Error("boom"); } }), { fallback: "toast" }),
    spec("gone", "#nowhere", okModule(calls)),
  ];
  const notices = createNotices(doc);
  const { bindings, failed } = mountComponents(specs, await loadModules(specs),
    { doc, ctx: { actions: {} }, notices });
  assert.deepEqual(failed, ["masthead", "feed", "toast", "gone"]);
  const inline = [...doc.querySelectorAll("[data-testid=\"region-notice\"]")];
  assert.deepEqual(inline.map((n) => n.getAttribute("data-region")), ["masthead", "feed"]);
  assert.match(inline[0].textContent, /The masthead didn't load\./);
  assert.match(inline[0].textContent, /Failed to fetch/);
  const tray = doc.getElementById("sc-notices");
  assert.match(tray.textContent, /didn't load: The masthead, The feed, The toast and The gone/);
  assert.equal(bindings.length, 1, "the toast falls back to a text-only toast");
  assert.equal(bindings[0].name, "toast");
}));

test("notices: one entry per id, replaced in place, dismissable, errors toned", () => withDocument(page(), () => {
  const doc = globalThis.document;
  const notices = createNotices(doc);
  notices.show("world", "The Under the Lights look didn't load.");
  notices.show("world", "The Under the Lights look didn't load, again.");
  const tray = doc.getElementById("sc-notices");
  assert.equal(tray.children.length, 1);
  assert.match(tray.textContent, /again/);
  notices.componentError({ name: "play-feed", label: "Play feed" }, new Error("bad row"));
  const err = tray.querySelector("[data-notice=\"error:play-feed\"]");
  assert.equal(err.getAttribute("data-tone"), "error");
  assert.match(err.textContent, /Play feed hit a problem: bad row/);
  tray.querySelector("[data-notice=\"world\"]").querySelector("button").dispatchEvent({ type: "click" });
  assert.equal(notices.has("world"), false);
  for (let i = 0; i < 6; i += 1) notices.bug(new Error(`bug ${i}`));
  assert.equal(tray.querySelectorAll("[data-tone=\"error\"]").length, 1 + 3, "at most three bug notices");
}));

test("fallbackToast shows the toast text with the legacy classes and tone", () => withDocument(page(), () => {
  const node = globalThis.document.getElementById("toast");
  const toast = fallbackToast(node);
  toast.update({ id: 1, text: "Drive 1 started.", err: false });
  assert.equal(node.textContent, "Drive 1 started.");
  assert.equal(node.getAttribute("class"), "show");
  assert.equal(node.getAttribute("data-tone"), "info");
  toast.update({ id: 2, text: "Down must be 1 to 4", err: true });
  assert.equal(node.getAttribute("class"), "show err");
  toast.update(null);
  assert.equal(node.getAttribute("class"), null);
}));

test("fallbackBoot drives the static placeholder from the boot view model", () => withDocument(page(), () => {
  const doc = globalThis.document;
  const holder = doc.createElement("div");
  const text = doc.createElement("p");
  text.setAttribute("class", "sc-boot-static-text");
  holder.appendChild(text);
  const boot = fallbackBoot(holder);
  boot.update({ phase: "failed", hidden: false, heading: "Can't reach the app server", text: "Retrying in 4 s." });
  assert.equal(text.textContent, "Can't reach the app server. Retrying in 4 s.");
  assert.equal(holder.getAttribute("data-phase"), "failed");
  boot.update({ phase: "ready", hidden: true, heading: "", text: "" });
  assert.equal(holder.hidden, true);
}));

test("a component that removes part of the shell is named in a notice", () => withDocument(page(), async () => {
  const doc = globalThis.document;
  const greedy = spec("feed", "#rg-feed", async () => ({ mount: () => {
    doc.getElementById("rg-masthead").remove();
    return { update() {}, destroy() {} };
  } }));
  const notices = createNotices(doc);
  mountComponents([greedy], await loadModules([greedy]),
    { doc, ctx: { actions: {} }, notices, shellIds: ["rg-masthead", "rg-feed", "toast"] });
  assert.match(doc.getElementById("sc-notices").textContent, /The feed hit a problem: it removed #rg-masthead from the page/);
}));
