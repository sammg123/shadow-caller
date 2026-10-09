// ui/shorthand.js (owner A7): the shorthand bar (FI 2.6, 1.8; checklist #78 to #84).
import assert from "node:assert/strict";
import test from "node:test";
import { fire, inDoc, mountWith, settle, shellDocument } from "./ui-input-harness.mjs";

const load = () => import("../../static/js/ui/shorthand.js");

async function setup(runShorthand = () => Promise.resolve({ ok: true })) {
  const { doc, byId } = shellDocument([{ tag: "section", id: "entry", children: [
    { tag: "div", id: "short", attrs: { class: "short", "data-mount": "shorthand" } }] }]);
  const mod = await load();
  const root = byId("short");
  return { doc, byId, root, ...mountWith(doc, mod, root, { results: { runShorthand } }) };
}

test("mount builds the bar: #cmd with its placeholder and label, #cmdBtn Run (#84)", async () => {
  const { doc, byId, component } = await setup();
  const cmd = byId("cmd");
  assert.equal(cmd.localName, "input");
  assert.equal(cmd.getAttribute("type"), "text");
  assert.match(cmd.getAttribute("placeholder"), /^Shorthand: JJ 6 \| 2&4 D44/);
  assert.equal(cmd.getAttribute("aria-label"), "Shorthand command");
  assert.equal(byId("cmdBtn").textContent, "Run");
  assert.equal(byId("cmdBtn").getAttribute("type"), "button");
  inDoc(doc, () => component.update(null));
  component.destroy();
});

test("Enter runs the line and clears the box when it worked; never logs the pick (#78, #84)", async () => {
  const { byId, named } = await setup();
  const cmd = byId("cmd");
  cmd.value = "JJ 6 | 2&4 D44";
  assert.equal(fire(cmd, "keydown", { key: "Enter" }), true);
  await settle();
  assert.deepEqual(named("runShorthand"), [["JJ 6 | 2&4 D44"]]);
  assert.deepEqual(named("logPlay"), []);
  assert.equal(cmd.value, "");
});

test("the Run button does the same; a refused line stays in the box (#83)", async () => {
  const { byId, named } = await setup(() => Promise.resolve({ ok: false }));
  const cmd = byId("cmd");
  cmd.value = "KK 3";
  fire(byId("cmdBtn"), "click");
  await settle();
  assert.deepEqual(named("runShorthand"), [["KK 3"]]);
  assert.equal(cmd.value, "KK 3");
});

test("an empty box sends nothing; other keys are left to the input", async () => {
  const { byId, named } = await setup();
  const cmd = byId("cmd");
  cmd.value = "   ";
  fire(cmd, "keydown", { key: "Enter" });
  assert.equal(fire(cmd, "keydown", { key: "J" }), false);
  await settle();
  assert.deepEqual(named("runShorthand"), []);
});

test("a repeated Enter on a line in flight is ignored; a new line typed meanwhile still runs (#82)", async () => {
  const pending = [];
  const { byId, named } = await setup(() => new Promise((resolve) => { pending.push(() => resolve({ ok: true })); }));
  const cmd = byId("cmd");
  cmd.value = "new D25";
  fire(cmd, "keydown", { key: "Enter" });
  fire(cmd, "keydown", { key: "Enter" });
  assert.equal(byId("cmdBtn").getAttribute("aria-busy"), "true");
  cmd.value = "punt";
  fire(cmd, "keydown", { key: "Enter" });
  assert.deepEqual(named("runShorthand"), [["new D25"], ["punt"]], "the actions queue keeps them in order");
  pending[0]();
  await settle();
  assert.equal(cmd.value, "punt", "the first answer never wipes a newer line");
  assert.equal(byId("cmdBtn").getAttribute("aria-busy"), "true", "busy while a line is still out");
  pending[1]();
  await settle();
  assert.equal(cmd.value, "");
  assert.equal(byId("cmdBtn").hasAttribute("aria-busy"), false);
});
