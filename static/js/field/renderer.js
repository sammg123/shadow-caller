// The WebGL renderer and its render-on-demand loop (ui-architecture 2.5 renderer.js, 6.1; three-recipe 2, 10.1,
// 10.4, 10.5, 10.9; owner A5). r185 specifics: antialias + outputBufferType HalfFloatType (4x MSAA on an HDR target,
// tone mapping and sRGB applied once at the end), PCFShadowMap (PCFSoftShadowMap is deprecated) with shadow maps
// updated only when asked, THREE.Timer (Clock is deprecated), renderer.info counted per frame (autoReset off, or
// the effects' own render would report one draw call). The loop runs only while an updater says it is busy or
// after requestRender(), then stops: 0 frames while nothing changes. DPR is min(device, 2) and no more than a 4K
// frame; when animated frames average over 22 ms it steps down by 0.25 to a floor of 1 and stays there.
// Context loss stops the loop and reports "contextlost" (the conductor swaps in the 2D field). The loop is our own
// requestAnimationFrame chain, not renderer.setAnimationLoop: r185's WebGLAnimation schedules the next frame after
// its callback returns, so stopping it from inside a frame leaves a rAF chain running forever (and each restart
// adds another), which would burn CPU between snaps with nothing to draw.
// The functions below share one rig context `r` = { renderer, win, tier, emit, timer, canvas, st }.
import * as THREE from "three";
import { DPR, governDpr, initialGovernor, pickDpr } from "./stage-math.js";

const TONE = Object.freeze({ none: THREE.NoToneMapping, aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping });
const MAX_DT_MS = 50;
const AFTER_BUSY_FRAMES = 1;
const CPU_SAMPLES = 120;      // frame CPU times kept for debugState (updaters + draw submit, ms)

/** Quality tiers (three-recipe 10.4): a software rasterizer gets "low": DPR 1, no MSAA, no shadows, no bloom. */
export const TIERS = Object.freeze({
  high: Object.freeze({ maxDpr: DPR.CAP, msaa: true, shadows: true, bloom: true }),
  low: Object.freeze({ maxDpr: 1, msaa: false, shadows: false, bloom: false }),
});

function makeRenderer(canvas, look, t, capture) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: t.msaa && look.renderer.antialias !== "none",
    outputBufferType: THREE.HalfFloatType, powerPreference: "high-performance", preserveDrawingBuffer: capture,
    alpha: false, stencil: false });
  renderer.toneMapping = TONE[look.renderer.toneMapping] ?? THREE.NeutralToneMapping;
  renderer.toneMappingExposure = look.renderer.exposure;
  renderer.setClearColor(look.renderer.clear, look.renderer.clearAlpha);
  renderer.shadowMap.enabled = t.shadows && look.renderer.shadows !== "off";
  renderer.shadowMap.type = look.renderer.shadows === "vsm" ? THREE.VSMShadowMap : THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.info.autoReset = false;
  return renderer;
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

function govern(r, dtMs, busy) {
  if (!(busy && r.st.prevBusy)) return;
  const next = governDpr(r.st.gov, dtMs);
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
  r.st.cpu = r.st.cpu.length >= CPU_SAMPLES ? [...r.st.cpu.slice(1), ms] : [...r.st.cpu, ms];
}

function frame(r, time) {
  const startMs = r.win.performance.now();
  r.timer.update(time);
  const dtMs = Math.min(r.timer.getDelta() * 1000, MAX_DT_MS);
  const busy = runUpdaters(r, dtMs);
  if (r.st.lost) {
    stop(r);
    return;
  }
  if (!draw(r)) return;
  recordCpu(r, startMs);
  r.st.frames += 1;
  govern(r, dtMs, busy);
  r.st.prevBusy = busy;
  r.emit("frame", r.st.frames);
  if (busy) r.st.needs = Math.max(r.st.needs, AFTER_BUSY_FRAMES);
  r.st.needs -= 1;
  if (r.st.needs <= 0 && !busy) stop(r);
}

function requestRender(r, frames = 1) {
  if (!r.st.visible || r.st.lost) {
    r.st.pending = true;
    return;
  }
  r.st.needs = Math.max(r.st.needs, frames);
  if (r.st.running) return;
  r.st.running = true;
  r.timer.reset();
  schedule(r);
}

// ---------------------------------------------------------------- size, visibility, context
function applySize(r) {
  const { width, height } = r.st.size;
  const dpr = Math.min(pickDpr({ deviceDpr: r.win.devicePixelRatio, width, height, maxDpr: r.tier.maxDpr }), r.st.gov.dpr);
  r.renderer.setPixelRatio(dpr);
  r.renderer.setSize(width, height, false);
  r.emit("resize", { width, height, dpr });
  requestRender(r);
}

function setSize(r, width, height) {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  if (r.st.sized && w === r.st.size.width && h === r.st.size.height) return false;
  r.st.size = { width: w, height: h };
  r.st.sized = true;
  applySize(r);
  return true;
}

function setVisible(r, on) {
  r.st.visible = Boolean(on);
  if (!r.st.visible) stop(r);
  else if (r.st.pending) {
    r.st.pending = false;
    requestRender(r);
  }
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
  r.st.updaters.clear();
  unbind();
  r.timer.dispose();
  r.renderer.setEffects?.(null);
  r.renderer.dispose();
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} look  a resolved Look (renderer)
 * @param {{ capture?: boolean, tier?: "high" | "low", win?: Window, emit?: (event: string, payload?: unknown) => void }} [opts]
 */
export function createRig(canvas, look, { capture = false, tier = "high", win = globalThis, emit = () => {} } = {}) {
  const t = TIERS[tier] ?? TIERS.high;
  const timer = new THREE.Timer();
  if (win.document) timer.connect(win.document);
  const st = { running: false, rafId: null, needs: 0, frames: 0, visible: true, lost: false, pending: false,
    prevBusy: false, draw: null, size: { width: 1, height: 1 }, sized: false, gov: initialGovernor(t.maxDpr),
    updaters: new Set(), cpu: [] };
  const r = { renderer: makeRenderer(canvas, look, t, capture), win, tier: t, emit, timer, canvas, st };
  const unbind = bindContext(r);
  return {
    renderer: r.renderer,
    requestRender: (frames) => requestRender(r, frames),
    /** fn(dtMs) returns true while it still needs frames; returns a remover. */
    keepAlive(fn) {
      st.updaters.add(fn);
      requestRender(r);
      return () => st.updaters.delete(fn);
    },
    setDraw(fn) { st.draw = fn; },
    setSize: (width, height) => setSize(r, width, height),
    size: () => ({ ...st.size }),
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
    /** Compile every material before the first play (recipe 2: KHR_parallel_shader_compile; skipped without it). */
    warmUp: (scene, camera) => (r.renderer.extensions.has("KHR_parallel_shader_compile")
      ? r.renderer.compileAsync(scene, camera) : Promise.resolve()),
    dispose: () => dispose(r, unbind),
  };
}
