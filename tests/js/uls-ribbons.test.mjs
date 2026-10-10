// Under the Lights: the LED fascia ribbons' stepping (owner W1; DESIGN.md motion grammar "LED steps (12 fps)": a new
// message steps in from the right in 5 frames of 83 ms and holds; a moment holds, then steps back). A stub canvas
// records what is drawn, so the timing and the words are checked without a browser.
import assert from "node:assert/strict";
import test from "node:test";
import { loadThree } from "./three-env.mjs";

const THREE = await loadThree();
const { createRibbons, LED } = await import("../../static/js/theme/worlds/under-the-lights/stadium/ribbons.js");

/** A document whose canvases record fillText and drawImage calls. */
function stubDoc() {
  const texts = [];
  const doc = {
    texts,
    fonts: { load: () => Promise.resolve([]) },
    defaultView: { getComputedStyle: () => ({ getPropertyValue: () => "\"Big Shoulders Text\", sans-serif" }) },
    documentElement: {},
    createElement: () => {
      const ctx = { font: "", fillStyle: "", textBaseline: "", fillRect() {}, drawImage() {},
        fillText: (t) => texts.push(t), measureText: (t) => ({ width: t.length * 9 }) };
      return { width: 0, height: 0, getContext: () => ctx };
    },
  };
  return doc;
}

const msg = (text, extra = {}) => ({ kind: "play", parts: [{ text, tone: "warm" }], logos: [], holdMs: 0, ...extra });

test("a message steps in over 5 frames of 83 ms, then the board is at rest (no frames)", () => {
  const doc = stubDoc();
  let renders = 0;
  const r = createRibbons(THREE, { doc, requestRender: () => { renders += 1; } });
  r.show("A", msg("DAL · SHORT PASS MIDDLE · +8"));
  assert.ok(doc.texts.includes("DAL · SHORT PASS MIDDLE · +8"));
  assert.ok(renders >= 1);
  const busy = [];
  for (let i = 0; i < 6; i += 1) busy.push(r.update(LED.cols ? 83 : 0));
  assert.deepEqual(busy, [true, true, true, true, false, false]);
  assert.equal(r.message("A").parts[0].text, "DAL · SHORT PASS MIDDLE · +8");
  r.dispose();
});

test("a held moment steps back to what follows it; a revision during the hold changes that, not the moment", async () => {
  const doc = stubDoc();
  const r = createRibbons(THREE, { doc, instant: () => true });
  r.show("A", msg("TOUCHDOWN COWBOYS", { kind: "td", holdMs: 30 }), msg("DAL · INSIDE RUN · TD"));
  assert.equal(r.message("A").kind, "td");
  r.revise("A", msg("DAL · INSIDE RUN · TD · TOP PICK"));
  assert.equal(r.message("A").kind, "td", "the moment holds");
  await new Promise((resolve) => { setTimeout(resolve, 60); });
  assert.equal(r.message("A").parts[0].text, "DAL · INSIDE RUN · TD · TOP PICK");
  r.revise("B", msg("BUCCANEERS AT COWBOYS"));
  assert.equal(r.message("B").parts[0].text, "BUCCANEERS AT COWBOYS", "at rest, a revision redraws in place");
  r.dispose();
});

test("without a document the boards stay dark and every call is a quiet no-op", () => {
  const r = createRibbons(THREE, {});
  assert.equal(r.mesh.name, "uls-ribbons");
  r.show("A", msg("X"));
  r.revise("A", msg("Y"));
  assert.equal(r.update(16), false);
  assert.equal(r.message("A"), null);
  r.dispose();
});
