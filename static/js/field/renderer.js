// The WebGL renderer and its render-on-demand loop (ui-architecture 2.5 renderer.js, 6.1; three-recipe 2, 10.1,
// 10.4, 10.5, 10.9; owner A5). r185 specifics: antialias + outputBufferType HalfFloatType (4x MSAA on an HDR target,
// tone mapping and sRGB applied once at the end), PCFShadowMap (PCFSoftShadowMap is deprecated) with shadow maps
// updated only when asked, THREE.Timer (Clock is deprecated), renderer.info counted per frame (autoReset off, or the
// effects' own render would report one draw call). The canvas's own buffer has neither MSAA nor depth (leanContext;
// G7-4: it only takes the output copy). MSAA stays on at 2x too: without it the line of scrimmage, the line to gain
// and the far yard-number arrows stair-step. The loop runs only while an updater says it is busy or after
// requestRender(), then stops: 0 frames while nothing changes. DPR is min(device, 2) and no more than a 4K frame,
// governed by frame time (stage-math DPR: down when the GPU falls behind, back up once it has headroom again), or
// pinned by ?dpr=. A resize burst (a window drag, the fullscreen transition) gives the camera
// each new size at once and the drawing buffer one reallocation when it ends (CSS scales the old one meanwhile).
// warmUp compiles every program as the frame will draw it (into the output pass's target) and holds frames back until
// it is done, so the first frame never compiles a shader on the main thread (G7-2).
// Context loss stops the loop and reports "contextlost" (the conductor swaps in the 2D field). The loop is our own
// requestAnimationFrame chain, not renderer.setAnimationLoop: r185's WebGLAnimation schedules the next frame after
// its callback returns, so stopping it from inside a frame leaves a rAF chain running forever (and each restart
// adds another), which would burn CPU between snaps with nothing to draw.
// The functions below share one rig context `r` = { renderer, win, tier, emit, timer, canvas, st }.
import * as THREE from "three";
import { DPR, dprFloor, dprOverride, governDpr, initialGovernor, needsRealloc, pickDpr } from "./stage-math.js";

const TONE = Object.freeze({ none: THREE.NoToneMapping, aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping });
const MAX_DT_MS = 50;
const AFTER_BUSY_FRAMES = 1;
const CPU_SAMPLES = 120;      // frame CPU times kept for debugState (updaters + draw submit, ms)
const RESIZE_SETTLE_MS = 120;
const HOLD_MAX_MS = 12000;    // the longest the warm-up holds frames back (a driver that never reports ready)

/** Quality tiers (three-recipe 10.4): a software rasterizer gets "low": DPR 1, no MSAA, no shadows, no bloom. */
export const TIERS = Object.freeze({
  high: Object.freeze({ maxDpr: DPR.CAP, msaa: true, shadows: true, bloom: true }),
  low: Object.freeze({ maxDpr: 1, msaa: false, shadows: false, bloom: false }),
});

const defaultFactory = (params) => new THREE.WebGLRenderer(params);

/**
 * The canvas's own drawing buffer, without MSAA or depth: with tone mapping on, every frame draws into the output
 * pass's HDR target (which keeps its MSAA and depth) and reaches the canvas as one full-screen triangle, so a
 * multisampled, depth-tested canvas buffer is memory with nothing to do (about 32 bytes a pixel: 165 MB at 1440x900
 * at 2x). Null, and three makes its own, when the scene would draw straight into the canvas (no tone mapping).
 */
function leanContext(canvas, look, capture) {
  if (look.renderer.toneMapping === "none" || typeof canvas.getContext !== "function") return null;
  try {
    return canvas.getContext("webgl2", { alpha: true, depth: false, stencil: false, antialias: false,
      premultipliedAlpha: true, preserveDrawingBuffer: capture, powerPreference: "high-performance" });
  } catch {
    return null;
  }
}

function makeRenderer(canvas, look, t, { capture, factory }) {
  const context = leanContext(canvas, look, capture);
  const renderer = factory({ canvas, ...(context ? { context } : {}), outputBufferType: THREE.HalfFloatType,
    powerPreference: "high-performance", antialias: t.msaa && look.renderer.antialias !== "none",
    preserveDrawingBuffer: capture, alpha: false, stencil: false });
  renderer.toneMapping = TONE[look.renderer.toneMapping] ?? THREE.NeutralToneMapping;
  renderer.toneMappingExposure = look.renderer.exposure;
  renderer.setClearColor(look.renderer.clear, look.renderer.clearAlpha);
  renderer.shadowMap.enabled = t.shadows && look.renderer.shadows !== "off";
  renderer.shadowMap.type = look.renderer.shadows === "vsm" ? THREE.VSMShadowMap : THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.info.autoReset = false;
  return renderer;
}

/** post.js hands its passes to renderer.setEffects; the rig keeps the list (the warm-up compiles them too). */
function trackEffects(r) {
  const setEffects = typeof r.renderer.setEffects === "function" ? r.renderer.setEffects.bind(r.renderer) : null;
  if (!setEffects) return;
  r.renderer.setEffects = (effects) => {
    r.st.effects = Array.isArray(effects) ? [...effects] : [];
    return setEffects(effects);
  };
}

// ---------------------------------------------------------------- the loop
function stop(r) {
  if (r.st.rafId !== null) r.win.cancelAnimationFrame(r.st.rafId);
  r.st.rafId = null;
  r.st.running = false;
  r.st.prevBusy = false;
}

function schedule(r) {
  if (r.st.rafId === null) r.st.rafId = r.win.requestAnimationFrame((time) => tick(r, time));
}

function tick(r, time) {
  r.st.rafId = null;
  frame(r, time);
  if (r.st.running) schedule(r);
}

function runUpdaters(r, dtMs) {
  let busy = false;
  for (const fn of [...r.st.updaters]) {
    try {
      busy = fn(dtMs) === true || busy;
    } catch (err) {
      r.st.updaters.delete(fn);
      r.emit("error", err);
    }
  }
  return busy;
}

function govern(r, dtMs, busy, prevCpuMs) {
  if (r.st.override !== null || !(busy && r.st.prevBusy)) return;
  const next = governDpr(r.st.gov, dtMs, { cpuMs: prevCpuMs, floor: dprFloor(r.st.size.width), ceiling: ceilingOf(r) });
  const stepped = next.dpr !== r.st.gov.dpr;
  r.st.gov = next;
  if (stepped) applySize(r);
}

function draw(r) {
  r.renderer.info.reset();
  try {
    r.st.draw?.();
    return true;
  } catch (err) {
    stop(r);
    r.emit("error", err);
    return false;
  }
}

function recordCpu(r, startMs) {
  const ms = r.win.performance.now() - startMs;
  r.st.lastCpu = ms;
  r.st.cpu = r.st.cpu.length >= CPU_SAMPLES ? [...r.st.cpu.slice(1), ms] : [...r.st.cpu, ms];
}

function frame(r, time) {
  if (r.st.holds > 0) {
    stop(r);
    r.st.pending = true;
    return;
  }
  const startMs = r.win.performance.now();
  r.timer.update(time);
  const dtMs = Math.min(r.timer.getDelta() * 1000, MAX_DT_MS);
  const busy = runUpdaters(r, dtMs);
  if (r.st.lost) {
    stop(r);
    return;
  }
  if (!draw(r)) return;
  const prevCpu = r.st.lastCpu;
  recordCpu(r, startMs);
  r.st.frames += 1;
  govern(r, dtMs, busy, prevCpu);
  r.st.prevBusy = busy;
  r.emit("frame", r.st.frames);
  if (busy) r.st.needs = Math.max(r.st.needs, AFTER_BUSY_FRAMES);
  r.st.needs -= 1;
  if (r.st.needs <= 0 && !busy) stop(r);
}

function requestRender(r, frames = 1) {
  if (!r.st.visible || r.st.lost || r.st.holds > 0) {
    r.st.pending = true;
    return;
  }
  r.st.needs = Math.max(r.st.needs, frames);
  if (r.st.running) return;
  r.st.running = true;
  r.timer.reset();
  schedule(r);
}

/** A frame asked for while hidden, lost or held: draw it now. */
function resume(r) {
  if (!r.st.pending) return;
  r.st.pending = false;
  requestRender(r);
}

// ---------------------------------------------------------------- size, pixel ratio, visibility, context
/** The best pixel ratio for this canvas now: the device's, the tier's cap and a 4K frame of pixels. */
function ceilingOf(r) {
  const { width, height } = r.st.size;
  return pickDpr({ deviceDpr: r.win.devicePixelRatio, width, height, maxDpr: r.tier.maxDpr });
}

function dprNow(r) {
  const { width, height } = r.st.size;
  if (r.st.override !== null) return pickDpr({ deviceDpr: r.st.override, width, height, maxDpr: DPR.OVERRIDE.max });
  return Math.min(ceilingOf(r), Math.max(dprFloor(width), r.st.gov.dpr));
}

function applySize(r) {
  const { width, height } = r.st.size;
  const dpr = dprNow(r);
  // the ratio without a reallocation of its own (setPixelRatio would resize every target once more)
  if (r.renderer.getPixelRatio() !== dpr) r.renderer.setDrawingBufferSize(width, height, dpr);
  r.renderer.setSize(width, height, false);
  r.emit("resize", { width, height, dpr });
  requestRender(r);
}

/** The requested size becomes the drawing buffer's, unless it is within a few pixels of it (CSS scaling covers it). */
function settleSize(r) {
  if (!needsRealloc(r.st.sized ? r.st.size : null, r.st.view)) return;
  r.st.size = { ...r.st.view };
  r.st.sized = true;
  applySize(r);
}

/** The canvas's CSS size: the first one at once, later ones once a burst of them has settled. */
function setSize(r, width, height) {
  const next = { width: Math.max(1, Math.floor(width)), height: Math.max(1, Math.floor(height)) };
  const view = r.st.view;
  if (view && next.width === view.width && next.height === view.height) return false;
  r.st.view = next;
  if (!r.st.sized) {
    settleSize(r);
    return true;
  }
  if (r.st.resizeTimer !== null) r.win.clearTimeout(r.st.resizeTimer);
  r.st.resizeTimer = r.win.setTimeout(() => {
    r.st.resizeTimer = null;
    settleSize(r);
  }, RESIZE_SETTLE_MS);
  requestRender(r);
  return true;
}

function setVisible(r, on) {
  r.st.visible = Boolean(on);
  if (!r.st.visible) stop(r);
  else resume(r);
}

function bindContext(r) {
  const onLost = () => {
    r.st.lost = true;
    stop(r);
    r.emit("contextlost");
  };
  const onRestored = () => {
    r.st.lost = false;
    r.renderer.shadowMap.needsUpdate = true;
    r.emit("contextrestored");
    requestRender(r);
  };
  r.canvas.addEventListener("webglcontextlost", onLost);
  r.canvas.addEventListener("webglcontextrestored", onRestored);
  return () => {
    r.canvas.removeEventListener("webglcontextlost", onLost);
    r.canvas.removeEventListener("webglcontextrestored", onRestored);
  };
}

// ---------------------------------------------------------------- compiling programs ahead of the frame
/**
 * The materials a post pass keeps on itself (UnrealBloomPass: its high pass, blurs, composite and blend; a ShaderPass:
 * its material), each once. A pass that keeps them out of reach is compiled by the warm-up's empty frame instead.
 */
export function passMaterials(pass) {
  const out = new Set();
  for (const value of Object.values(pass ?? {})) {
    for (const v of Array.isArray(value) ? value : [value]) if (v?.isMaterial) out.add(v);
  }
  return [...out];
}

/**
 * The target programs are compiled against. three keys a program by where it draws: with tone mapping or a pass, the
 * frame draws into the output pass's HDR target (tone mapping off, linear color), so compiling against the canvas
 * (renderer.compileAsync's default) would build a second, unused set and leave the real one to the first frame.
 */
function compileTarget(r) {
  if (r.renderer.toneMapping === THREE.NoToneMapping && !r.st.effects.length) return null;
  r.st.compileTarget ??= new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  return r.st.compileTarget;
}

function compileAgainst(r, target, scene, camera) {
  const prev = r.renderer.getRenderTarget();
  r.renderer.setRenderTarget(target);
  try {
    return Promise.resolve(r.renderer.compileAsync(scene, camera));
  } finally {
    r.renderer.setRenderTarget(prev);
  }
}

/** The passes' own materials on a full-screen triangle (position and uv, as their FullScreenQuad draws them). */
function passScene(r) {
  const materials = r.st.effects.flatMap(passMaterials);
  if (!materials.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
  const group = new THREE.Group();
  for (const material of materials) group.add(new THREE.Mesh(geometry, material));
  return { group, dispose: () => geometry.dispose() };
}

/** Compile `scene` as the frame will draw it, without holding frames back (a stage swap: the old field shows). */
function compile(r, scene, camera) {
  if (r.st.lost) return Promise.resolve();
  return compileAgainst(r, compileTarget(r), scene, camera);
}

/** Hold frames back; returns the release (once; a no-op after HOLD_MAX_MS released every hold of its time). */
function hold(r) {
  const gen = r.st.holdGen;
  r.st.holds += 1;
  if (r.st.holdTimer === null) {
    r.st.holdTimer = r.win.setTimeout(() => {
      r.st.holdTimer = null;
      r.st.holds = 0;
      r.st.holdGen += 1;
      resume(r);
    }, HOLD_MAX_MS);
  }
  let released = false;
  return () => {
    if (released || gen !== r.st.holdGen) return;
    released = true;
    r.st.holds -= 1;
    if (r.st.holds > 0) return;
    r.win.clearTimeout(r.st.holdTimer);
    r.st.holdTimer = null;
    resume(r);
  };
}

/**
 * Before the first frame: the scene's programs, then the passes' (each batch compiled in parallel where the driver
 * can, KHR_parallel_shader_compile, yielding while it works), then one empty frame that links the output pass and any
 * pass whose materials are out of reach. Frames wait until it is done (or HOLD_MAX_MS).
 */
async function warmUp(r, scene, camera) {
  const release = hold(r);
  try {
    await compile(r, scene, camera);
    const passes = passScene(r);
    if (passes) {
      try {
        await compileAgainst(r, compileTarget(r), passes.group, camera);
      } finally {
        passes.dispose();
      }
    }
    if (!r.st.lost) r.renderer.render(r.st.empty, camera);
  } finally {
    release();
  }
}

// ---------------------------------------------------------------- debug, dispose
/** p50, p95 and max of the recent frames' CPU time (ms), or null before any frame. */
function cpuStats(samples) {
  if (!samples.length) return null;
  const d = [...samples].sort((a, b) => a - b);
  const q = (k) => Math.round(d[Math.min(d.length - 1, Math.floor(d.length * k))] * 100) / 100;
  return { p50: q(0.5), p95: q(0.95), max: q(1), n: d.length };
}

function info(r) {
  const i = r.renderer.info;
  return { render: { ...i.render }, memory: { ...i.memory }, programs: i.programs?.length ?? 0, cpuMs: cpuStats(r.st.cpu) };
}

function dispose(r, unbind) {
  stop(r);
  for (const id of [r.st.resizeTimer, r.st.holdTimer]) if (id !== null) r.win.clearTimeout(id);
  r.st.updaters.clear();
  unbind();
  r.timer.dispose();
  r.st.compileTarget?.dispose();
  r.renderer.setEffects?.(null);
  r.renderer.dispose();
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} look  a resolved Look (renderer)
 * @param {{ capture?: boolean, tier?: "high" | "low", win?: Window, emit?: (event: string, payload?: unknown) => void,
 *   makeRenderer?: (params: object) => THREE.WebGLRenderer }} [opts]  makeRenderer: a test seam (node has no WebGL)
 */
export function createRig(canvas, look, { capture = false, tier = "high", win = globalThis, emit = () => {},
  makeRenderer: factory = defaultFactory } = {}) {
  const t = TIERS[tier] ?? TIERS.high;
  const override = dprOverride(win.location?.search);
  const timer = new THREE.Timer();
  if (win.document) timer.connect(win.document);
  const st = { running: false, rafId: null, needs: 0, frames: 0, visible: true, lost: false, pending: false,
    prevBusy: false, draw: null, size: { width: 1, height: 1 }, view: null, sized: false, resizeTimer: null,
    gov: initialGovernor(t.maxDpr), override, updaters: new Set(), cpu: [], lastCpu: 0, effects: [], holds: 0,
    holdGen: 0, holdTimer: null, compileTarget: null, empty: new THREE.Scene() };
  const renderer = makeRenderer(canvas, look, t, { capture, factory });
  const r = { renderer, win, tier: t, emit, timer, canvas, st };
  trackEffects(r);
  const unbind = bindContext(r);
  return {
    renderer,
    requestRender: (frames) => requestRender(r, frames),
    /** fn(dtMs) returns true while it still needs frames; returns a remover. */
    keepAlive(fn) {
      st.updaters.add(fn);
      requestRender(r);
      return () => st.updaters.delete(fn);
    },
    setDraw(fn) { st.draw = fn; },
    /** The canvas's CSS size; true when it changed (the drawing buffer follows once a resize burst settles). */
    setSize: (width, height) => setSize(r, width, height),
    /** The drawing buffer's size (CSS px). */
    size: () => ({ ...st.size }),
    /** The size the canvas shows at: the camera and the labels frame this one. */
    viewSize: () => ({ ...(st.view ?? st.size) }),
    setVisible: (on) => setVisible(r, on),
    visible: () => st.visible,
    setExposure(value) {
      r.renderer.toneMappingExposure = value;
      requestRender(r);
    },
    updateShadows() {
      r.renderer.shadowMap.needsUpdate = true;
      requestRender(r);
    },
    frames: () => st.frames,
    running: () => st.running,
    lost: () => st.lost,
    dpr: () => r.renderer.getPixelRatio(),
    tier: () => tier,
    info: () => info(r),
    /** Compile every program before the first frame and hold frames until it is done (recipe 2; G7-2). */
    warmUp: (scene, camera) => warmUp(r, scene, camera),
    /** Compile what a scene holds as the frame will draw it; frames go on (the stage's hidden swap). */
    compile: (scene, camera) => compile(r, scene, camera),
    dispose: () => dispose(r, unbind),
  };
}
