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

// ---------------------------------------------------------------- G3-6: the next call queued behind the play's words
const call = (text = "NEXT CALL · INSIDE RUN (A/B GAP) 24%") => msg(text, { kind: "call" });
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

test("G3-6: the next call waits for the play's words to dwell, then steps in; the grade still joins the words", async () => {
  let clock = 0;
  const r = createRibbons(THREE, { doc: stubDoc(), instant: () => true, now: () => clock });
  r.show("A", msg("DAL · INSIDE RUN (UP THE MIDDLE) · +4"));
  clock = 10;
  r.queue("A", call(), 60);
  assert.equal(r.message("A").kind, "play", "the play's words first");
  r.revise("A", msg("DAL · INSIDE RUN (UP THE MIDDLE) · +4 · TOP PICK"));
  assert.equal(r.message("A").parts[0].text, "DAL · INSIDE RUN (UP THE MIDDLE) · +4 · TOP PICK", "the grade joins");
  r.queue("A", call(), 60);
  await wait(120);
  assert.equal(r.message("A").kind, "call", "then the next call");
  r.dispose();
});

test("G3-6: a call steps in at once over the idle board or after the dwell; the same call twice is one step", () => {
  let clock = 0;
  const doc = stubDoc();
  const r = createRibbons(THREE, { doc, now: () => clock });
  r.show("A", { kind: undefined, parts: [{ text: "SHADOW PLAY-CALLER", tone: "warm" }], logos: [], holdMs: 0 });
  r.queue("A", call(), 2000);
  assert.equal(r.message("A").kind, "call", "nothing to dwell on: at once");
  for (let i = 0; i < 6; i += 1) r.update(83);
  const drawn = doc.texts.length;
  r.queue("A", call(), 2000);
  assert.equal(doc.texts.length, drawn, "the same call again changes nothing");
  r.show("A", msg("DAL · SHORT PASS LEFT · +8"));
  clock = 5000;
  r.queue("A", call(), 2000);
  assert.equal(r.message("A").kind, "call", "the words have dwelt long enough already");
  r.dispose();
});

test("G3-6: a held moment keeps its hold and the call follows it; a play that starts drops a call still queued", async () => {
  const r = createRibbons(THREE, { doc: stubDoc(), instant: () => true, now: () => 0 });
  r.show("A", msg("TOUCHDOWN COWBOYS", { kind: "td", holdMs: 40 }), msg("DAL · INSIDE RUN · TD"));
  r.queue("A", call(), 2000);
  r.revise("A", msg("DAL · INSIDE RUN · TD · TOP PICK"));
  assert.equal(r.message("A").kind, "td", "the moment holds");
  await wait(80);
  assert.equal(r.message("A").kind, "call", "the call, not the words, follows the touchdown");
  r.show("A", msg("DAL · SHORT PASS LEFT · +8"));
  r.queue("A", call("NEXT CALL · SCREEN 31%"), 40);
  r.drop("A");
  await wait(80);
  assert.equal(r.message("A").kind, "play", "dropped: the snap came first");
  r.queue("A", call(), 0);
  r.show("A", msg("DAL · SCREEN · +6"));
  assert.equal(r.message("A").parts[0].text, "DAL · SCREEN · +6", "a play's words replace a call");
  r.dispose();
});
