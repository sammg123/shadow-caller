// shell/engine.js (ui-architecture.md 3.1 step 3, 6.2, 9.5; owner A0): the WebGL engine or the 2D fallback.
import assert from "node:assert/strict";
import test from "node:test";
import { ENGINE_TIMEOUT_MS, createEngineLoader } from "../../static/js/shell/engine.js";

/** field/scene.js waits this long at most for the shader warm-up on a cold start (G2-9, G7-2). */
const SCENE_WARM_UP_CAP_MS = 10_000;
import { createDocument } from "./fake-dom.mjs";

function fakeEngine(kind, log) {
  return { kind, dispose: () => log.push(`dispose ${kind}`), cameraModes: () => [{ id: kind === "2d" ? "top" : "sideline" }] };
}

function setup({ webgl2 = true, scene, fallback } = {}) {
  const log = [];
  const doc = createDocument();
  const host = doc.createElement("div");
  doc.body.appendChild(host);
  const loaders = {
    support: async () => { log.push("support"); return { hasWebGL2: () => webgl2 }; },
    scene: scene ?? (async () => ({ createEngine: async (h, look, opts) => { log.push(`webgl ${JSON.stringify(opts)}`);
      return fakeEngine("webgl", log); } })),
    fallback: fallback ?? (async () => ({ createFallbackEngine: (h, look, opts) => { log.push(`2d ${JSON.stringify(opts)}`);
      return fakeEngine("2d", log); } })),
  };
  const timers = [];
  const timing = { setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {} };
  return { log, doc, host, loader: createEngineLoader(loaders), timers, timing };
}

const base = (s, extra = {}) => ({ doc: s.doc, host: s.host, look: {}, reducedMotion: false, capture: false,
  timeoutMs: 8000, ...s.timing, ...extra });

test("?scene=2d uses the fallback without touching WebGL", async () => {
  const s = setup();
  const res = await s.loader.start(base(s, { scene: "2d", reducedMotion: true }));
  assert.equal(res.engine.kind, "2d");
  assert.equal(res.reason, "forced");
  assert.equal(res.error, null);
  assert.deepEqual(s.log, ['2d {"reducedMotion":true}']);
});

test("WebGL2 present: the scene engine is created with reducedMotion and capture", async () => {
  const s = setup();
  const res = await s.loader.start(base(s, { scene: "auto", capture: true }));
  assert.equal(res.engine.kind, "webgl");
  assert.equal(res.reason, "webgl");
  assert.deepEqual(s.log, ["support", 'webgl {"reducedMotion":false,"capture":true}']);
});

test("no WebGL2: the 2D field, with the reason", async () => {
  const s = setup({ webgl2: false });
  const res = await s.loader.start(base(s, { scene: "auto" }));
  assert.equal(res.engine.kind, "2d");
  assert.equal(res.reason, "no-webgl2");
  assert.match(res.error.message, /WebGL2/);
});

test("a failing scene engine falls back to 2D, keeps the error, and clears a leftover canvas", async () => {
  const s = setup({ scene: async () => ({ createEngine: async (host) => {
    const canvas = host.ownerDocument.createElement("canvas");
    canvas.setAttribute("data-testid", "field-canvas");
    host.appendChild(canvas);
    throw new Error("EngineInitError: no EXT_color_buffer_float");
  } }) });
  const res = await s.loader.start(base(s, { scene: "auto" }));
  assert.equal(res.engine.kind, "2d");
  assert.equal(res.reason, "failed");
  assert.match(res.error.message, /EXT_color_buffer_float/);
  assert.equal(s.host.querySelectorAll("[data-testid=\"field-canvas\"]").length, 0);
});

test("a scene module that fails to load also falls back", async () => {
  const s = setup({ scene: async () => { throw new TypeError("Failed to fetch dynamically imported module"); } });
  const res = await s.loader.start(base(s, { scene: "auto" }));
  assert.equal(res.engine.kind, "2d");
  assert.equal(res.reason, "failed");
});

test("a scene engine that takes too long is abandoned for 2D and disposed if it ever arrives", async () => {
  let resolveLate;
  const s = setup({ scene: async () => ({ createEngine: () => new Promise((r) => { resolveLate = r; }) }) });
  const pending = s.loader.start(base(s, { scene: "auto", timeoutMs: 50 }));
  while (!s.timers.length) await new Promise((r) => setImmediate(r));
  assert.equal(s.timers[0].ms, 50);
  s.timers[0].fn();
  const res = await pending;
  assert.equal(res.engine.kind, "2d");
  assert.match(res.error.message, /took longer than/);
  resolveLate(fakeEngine("webgl", s.log));
  await new Promise((r) => setImmediate(r));
  assert.ok(s.log.includes("dispose webgl"));
});

test("G7-2: a cold start still compiling its shaders at the warm-up cap is waited for, not swapped for 2D", async () => {
  const s = setup({ scene: async () => ({ createEngine: () => new Promise(() => {}) }) });
  const { timeoutMs, ...rest } = base(s, { scene: "auto" });
  assert.equal(timeoutMs, 8000, "the other tests pass their own");
  s.loader.start(rest);
  while (!s.timers.length) await new Promise((r) => setImmediate(r));
  assert.equal(s.timers[0].ms, ENGINE_TIMEOUT_MS);
  assert.ok(ENGINE_TIMEOUT_MS >= SCENE_WARM_UP_CAP_MS + 4000, "the warm-up cap, the stage's build and the modules' load");
});

test("when the fallback is missing too, there is no engine and the reason is kept", async () => {
  const s = setup({ webgl2: false, fallback: async () => { throw new Error("404 fallback-2d.js"); } });
  const res = await s.loader.start(base(s, { scene: "auto" }));
  assert.equal(res.engine, null);
  assert.match(res.error.message, /WebGL2/);
  assert.match(res.fallbackError.message, /404/);
});

test("fallbackNow creates the 2D engine synchronously once the module is preloaded", async () => {
  const s = setup();
  assert.throws(() => s.loader.fallbackNow(s.host, {}, { reducedMotion: false }), /not loaded/);
  await s.loader.preloadFallback();
  assert.equal(s.loader.fallbackNow(s.host, {}, { reducedMotion: false }).kind, "2d");
});
