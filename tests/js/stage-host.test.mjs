// The stage's page side (package A5): the day look for an afternoon kickoff, the canvas in its host, page bindings
// (size, tab visibility, room lights) and the field font. The renderer itself needs WebGL and is checked in the browser.
import assert from "node:assert/strict";
import test from "node:test";
import { lookWith } from "./three-env.mjs";

const { lookForGame, makeCanvas, bindPage, frameSwapper, afterFrames } = await import("../../static/js/field/stage.js");
const { fieldFont, loadFont } = await import("../../static/js/field/decals.js");

const FRAME = Object.freeze({ field: { home: "DAL", los: 25 }, teams: { DAL: { color: "#002a5c" }, TB: { color: "#bd1c36" } },
  teamOrder: ["TB", "DAL"], game: null });

/** A frame swapper whose builds are plain records and whose preparation the test finishes by hand. */
function swapperLog() {
  const log = [];
  const waits = [];
  const swapper = frameSwapper({
    build: (frame) => { const parts = { id: log.filter(([k]) => k === "build").length + 1, frame }; log.push(["build", parts.id]); return parts; },
    prepare: (parts) => new Promise((resolve) => { waits.push({ id: parts.id, resolve }); }),
    swap: (next, old) => log.push(["swap", next.id, old?.id ?? null]),
    drop: (parts) => log.push(["drop", parts.id]),
  });
  const finish = async (id) => { waits.find((w) => w.id === id).resolve(); await new Promise((r) => setImmediate(r)); };
  return { log, swapper, finish };
}

test("a new game frame is built hidden and swapped in once prepared; the old one goes after it (G7-6)", async () => {
  const { log, swapper, finish } = swapperLog();
  const first = swapper.set(FRAME);
  assert.deepEqual(log, [["build", 1]]);
  await finish(1);
  await first;
  assert.deepEqual(log.at(-1), ["swap", 1, null]);
  const next = swapper.set({ ...FRAME, game: { light: "day" } });
  assert.deepEqual(log.at(-1), ["build", 2], "the shown frame stays up while the next one is prepared");
  await finish(2);
  await next;
  assert.deepEqual(log.at(-1), ["swap", 2, 1], "the new field shows, then the old one is disposed");
});

test("the same frame again (a second rebuild for one watch start) builds nothing and resolves at once (G7-6)", async () => {
  const { log, swapper, finish } = swapperLog();
  const first = swapper.set(FRAME);
  const again = swapper.set(JSON.parse(JSON.stringify(FRAME)));
  assert.equal(again, first, "still on its way: the same promise");
  await finish(1);
  await first;
  const later = swapper.set(JSON.parse(JSON.stringify(FRAME)));
  await later;
  assert.deepEqual(log, [["build", 1], ["swap", 1, null]], "one build, one swap");
});

test("a frame replaced while it is prepared is dropped; the newest frame wins", async () => {
  const { log, swapper, finish } = swapperLog();
  const a = swapper.set(FRAME);
  const b = swapper.set({ ...FRAME, teamOrder: ["DAL", "TB"] });
  assert.deepEqual(log, [["build", 1], ["drop", 1], ["build", 2]]);
  await finish(1);
  await a;
  assert.equal(log.filter(([k]) => k === "swap").length, 0, "the dropped build never shows");
  await finish(2);
  await b;
  assert.deepEqual(log.at(-1), ["swap", 2, null]);
  swapper.set(FRAME);
  await swapper.set({ ...FRAME, teamOrder: ["DAL", "TB"] });
  assert.deepEqual(log.slice(-2), [["build", 3], ["drop", 3]], "back to the frame on show: nothing to swap");
  swapper.dispose();
  assert.deepEqual(log.at(-1), ["drop", 2], "dispose drops what is shown");
});

test("afterFrames: the old field goes once the new one has drawn a frame (its shadow pass too); dispose flushes", () => {
  const updaters = new Set();
  const rig = { keepAlive(fn) { updaters.add(fn); return () => updaters.delete(fn); } };
  const frame = () => [...updaters].map((fn) => fn(16));
  const log = [];
  afterFrames(rig, 1, () => log.push("dropped"));
  assert.deepEqual(frame(), [true], "the first frame draws with the old parts still alive (hidden)");
  assert.deepEqual(log, []);
  assert.deepEqual(frame(), [false]);
  assert.deepEqual(log, ["dropped"]);
  assert.equal(updaters.size, 0);
  const flush = afterFrames(rig, 1, () => log.push("flushed"));
  flush();
  flush();
  assert.deepEqual(log, ["dropped", "flushed"], "once, at once (the engine's dispose)");
  assert.equal(updaters.size, 0);
});

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
