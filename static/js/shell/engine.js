// Starting the field engine (ui-architecture.md 3.1 step 3, 6.2, 9.5; owner A0). DOM side.
// The 2D fallback when ?scene=2d or there is no WebGL2; else field/scene.js createEngine, given ENGINE_TIMEOUT_MS
// to start. Any failure (a module that won't load, an EngineInitError, a timeout) falls back to 2D and keeps the
// reason for main.js to show. A WebGL engine that arrives after its timeout is disposed. The fallback module is
// preloaded so the conductor can swap it in synchronously when WebGL fails at run time. The three.js bundle is
// fetched only when WebGL2 exists. Loaders and timers are injectable for node tests; timers are called bare.

export const ENGINE_TIMEOUT_MS = 8000;

const DEFAULT_LOADERS = Object.freeze({
  support: () => import("../field/webgl-support.js"),
  scene: () => import("../field/scene.js"),
  fallback: () => import("../field/fallback-2d.js"),
});

const browserSetTimer = (fn, ms) => globalThis.setTimeout(fn, ms);
const browserClearTimer = (id) => globalThis.clearTimeout(id);

/** Remove a canvas or SVG a failed engine left in the field host (the legend and other children stay). */
function clearLeftovers(host) {
  if (typeof host?.querySelectorAll !== "function") return;
  for (const sel of ["[data-testid=\"field-canvas\"]", "[data-testid=\"field-svg\"]"]) {
    for (const node of host.querySelectorAll(sel)) node.remove();
  }
}

function disposeQuietly(engine) {
  try {
    engine?.dispose?.();
  } catch {
    // A late engine that cannot even dispose has nothing left on screen to clean up.
  }
}

/** Resolve with `promise`, or reject after `ms`; a value that arrives late goes to `onLate`. */
function withTimeout(promise, ms, { setTimer, clearTimer }, onLate) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimer(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`The 3D field took longer than ${Math.round(ms / 1000)} s to start.`));
    }, ms);
    Promise.resolve(promise).then((value) => {
      if (settled) { onLate(value); return; }
      settled = true;
      clearTimer(timer);
      resolve(value);
    }, (err) => {
      if (settled) return;
      settled = true;
      clearTimer(timer);
      reject(err);
    });
  });
}

// The functions below share one context `c` = { loaders, fb: { module, error, promise } }.
function preloadFallback(c) {
  c.fb.promise ??= Promise.resolve().then(() => c.loaders.fallback()).then((mod) => {
    c.fb.module = mod;
    return mod;
  }, (err) => {
    c.fb.error = err;
    return null;
  });
  return c.fb.promise;
}

/** The 2D engine, now (the module must be preloaded). Throws when it is not loaded or cannot start. */
function fallbackNow(c, host, look, opts) {
  if (typeof c.fb.module?.createFallbackEngine !== "function") {
    throw c.fb.error ?? new Error("The 2D field module is not loaded");
  }
  clearLeftovers(host);
  return c.fb.module.createFallbackEngine(host, look, opts);
}

async function fallbackResult(c, { host, look, reducedMotion }, reason, error) {
  await preloadFallback(c);
  try {
    return { engine: fallbackNow(c, host, look, { reducedMotion }), reason, error, fallbackError: null };
  } catch (fallbackError) {
    return { engine: null, reason, error: error ?? fallbackError, fallbackError };
  }
}

async function startWebGL(c, opts) {
  const { doc, host, look, reducedMotion, capture, world, timeoutMs = ENGINE_TIMEOUT_MS } = opts;
  const timers = { setTimer: opts.setTimer ?? browserSetTimer, clearTimer: opts.clearTimer ?? browserClearTimer };
  const support = await c.loaders.support();
  if (!support.hasWebGL2(doc)) return fallbackResult(c, opts, "no-webgl2", new Error("This browser has no WebGL2."));
  const sceneModule = await c.loaders.scene();
  // v1.2 (A5): the WorldModule rides along (props, moments, passes; 2.7), absent when the caller has none
  const engine = await withTimeout(sceneModule.createEngine(host, look, { reducedMotion, capture, world }), timeoutMs,
    timers, disposeQuietly);
  return { engine, reason: "webgl", error: null, fallbackError: null };
}

async function start(c, opts) {
  if (opts.scene === "2d") return fallbackResult(c, opts, "forced", null);
  try {
    return await startWebGL(c, opts);
  } catch (err) {
    return fallbackResult(c, opts, "failed", err);
  }
}

/**
 * @param {{ support: () => Promise<{ hasWebGL2(doc): boolean }>, scene: () => Promise<{ createEngine: Function }>,
 *   fallback: () => Promise<{ createFallbackEngine: Function }> }} [loaders]
 * @returns {{ start(opts: { doc: Document, host: Element, look: object, scene: "auto" | "2d", reducedMotion: boolean,
 *   capture: boolean, timeoutMs?: number, setTimer?: Function, clearTimer?: Function }): Promise<{ engine: object | null,
 *   reason: "webgl" | "forced" | "no-webgl2" | "failed", error: Error | null, fallbackError: Error | null }>,
 *   preloadFallback(): Promise<object | null>, fallbackNow(host, look, opts): object }}
 */
export function createEngineLoader(loaders = DEFAULT_LOADERS) {
  const c = { loaders, fb: { module: null, error: null, promise: null } };
  return {
    start: (opts) => start(c, opts),
    preloadFallback: () => preloadFallback(c),
    fallbackNow: (host, look, opts) => fallbackNow(c, host, look, opts),
  };
}
