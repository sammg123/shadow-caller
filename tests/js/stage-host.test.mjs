// The stage's page side (package A5): the day look for an afternoon kickoff, the canvas in its host, page bindings
// (size, tab visibility, room lights) and the field font. The renderer itself needs WebGL and is checked in the browser.
import assert from "node:assert/strict";
import test from "node:test";
import { lookWith } from "./three-env.mjs";

const { lookForGame, makeCanvas, bindPage } = await import("../../static/js/field/stage.js");
const { fieldFont, loadFont } = await import("../../static/js/field/decals.js");

test("an afternoon game merges look.world.day over the night look; a bad day look keeps the night", async () => {
  const base = await lookWith({ world: { day: { environment: { background: "#a9c4df", fog: null }, renderer: { exposure: 1.2 } } } });
  const day = lookForGame(base, { light: "day" });
  assert.equal(day.problem, null);
  assert.equal(day.look.environment.background, "#a9c4df");
  assert.equal(day.look.renderer.exposure, 1.2);
  assert.equal(lookForGame(base, { light: "night" }).look, base);
  assert.equal(lookForGame(base, null).look, base, "unknown counts as night");
  const broken = await lookWith({ world: { day: { renderer: { exposure: -1 } } } });
  const res = lookForGame(broken, { light: "day" });
  assert.equal(res.look, broken);
  assert.match(res.problem.message, /exposure/);
  assert.equal(lookForGame(await lookWith(), { light: "day" }).look.id, "neutral", "no day look: unchanged");
});

function fakePage({ position = "static" } = {}) {
  const added = [];
  const listeners = {};
  const win = { addEventListener: (t, f) => { listeners[`win:${t}`] = f; }, removeEventListener: (t) => { delete listeners[`win:${t}`]; },
    getComputedStyle: () => ({ position, getPropertyValue: () => "\"Big Shoulders Display\", sans-serif" }) };
  const doc = {
    defaultView: win, visibilityState: "visible", listeners,
    documentElement: { getAttribute: () => "room" },
    addEventListener: (t, f) => { listeners[t] = f; }, removeEventListener: (t) => { delete listeners[t]; },
    createElement: (tag) => ({ tag, attrs: {}, style: {}, setAttribute(k, v) { this.attrs[k] = v; } }),
  };
  const host = { ownerDocument: doc, clientWidth: 1200, clientHeight: 0, style: {}, appendChild: (n) => added.push(n) };
  return { doc, host, added, listeners };
}

test("the canvas goes inside its host, hidden from assistive tech, and a static host becomes positioned", () => {
  const { doc, host, added } = fakePage();
  const canvas = makeCanvas(doc, host);
  assert.equal(added[0], canvas);
  assert.equal(canvas.attrs["data-testid"], "field-canvas");
  assert.equal(canvas.attrs["aria-hidden"], "true");
  assert.equal(host.style.position, "relative");
  const positioned = fakePage({ position: "absolute" });
  makeCanvas(positioned.doc, positioned.host);
  assert.equal(positioned.host.style.position, undefined, "a positioned host is left alone");
});

test("page bindings: size (a host with no height gets 16:9), visibility and room lights; unbinding removes them", () => {
  const { doc, host, listeners } = fakePage();
  const calls = [];
  const engine = { resize: (w, h) => calls.push(["resize", w, h]), setVisible: (v) => calls.push(["visible", v]),
    setAmbient: (a) => calls.push(["ambient", a]) };
  const off = bindPage({ doc, host }, engine);
  assert.deepEqual(calls, [["resize", 1200, 675], ["ambient", "room"], ["visible", true]]);
  doc.visibilityState = "hidden";
  listeners.visibilitychange();
  assert.deepEqual(calls.at(-1), ["visible", false]);
  listeners["win:resize"]();
  assert.deepEqual(calls.at(-1), ["resize", 1200, 675]);
  for (const fn of off) fn();
  assert.equal(listeners.visibilitychange, undefined);
  assert.equal(listeners["win:resize"], undefined);
});

test("field glyphs use the world's display font, and never wait forever for it", async () => {
  const { doc } = fakePage();
  assert.equal(fieldFont(doc), "\"Big Shoulders Display\", sans-serif");
  assert.match(fieldFont(null), /Arial Narrow/);
  const weird = { defaultView: { getComputedStyle: () => ({ getPropertyValue: () => "x;}{evil" }) }, documentElement: {} };
  assert.match(fieldFont(weird), /Arial Narrow/, "anything that is not a font stack falls back");
  assert.equal(await loadFont({}, "x"), false, "no FontFaceSet: nothing to wait for");
  const never = { fonts: { load: () => new Promise(() => {}) } };
  assert.equal(await loadFont(never, "x", { timeoutMs: 5, setTimer: (fn, ms) => setTimeout(fn, ms) }), false);
  const ready = { fonts: { load: async () => [{}] } };
  assert.equal(await loadFont(ready, "x", { setTimer: () => 0 }), true);
});
