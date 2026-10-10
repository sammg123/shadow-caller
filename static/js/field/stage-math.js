/**
 * Numbers behind the 3D stage (ui-architecture 6.1; three-recipe 6.3, 10.4): the device pixel ratio and its
 * frame-time governor, the ?dpr= override, when a resize reallocates the drawing buffer, whether two game frames are
 * the same, the HUD safe area as a camera view offset plus fit margins, camera pose easing, and the alpha bleed that
 * keeps logo decals free of dark fringes. Pure: no DOM, no three.js, no clock.
 *
 *   Pose = { position: {x, y, z}, target: {x, y, z}, fov }   (three.js world space, vertical fov in degrees)
 */
import { deepFreeze } from "../core/domain.js";
import { isFiniteNum } from "./grammar.js";

/**
 * The pixel ratio and its governor (6.1, G7-3). Down: a window of WINDOW animated frames averaging over SLOW_MS
 * (each frame's time less the engine's own CPU in the frame before it, so a play being built is not the GPU running
 * out) steps down STEP, to FLOOR (WIDE_FLOOR for a viewport WIDE_PX wide or more). Up: RECOVER_MS of animated frames
 * at the display's own pace (under FAST_MS, or within FAST_SLACK of the shortest frame seen: a 60 Hz TV never shows
 * a frame under 12 ms) step back up STEP. Every step waits out COOLDOWN_MS; a step down within FLIP_MS of a step up
 * is a flip, and after MAX_FLIPS the ratio stays down for the session. OVERRIDE bounds ?dpr=; SNAP_PX is the resize
 * a canvas takes by CSS scaling instead of a new drawing buffer.
 */
export const DPR = deepFreeze({ CAP: 2, MAX_PIXELS: 3840 * 2160, FLOOR: 1, WIDE_FLOOR: 0.75, WIDE_PX: 3840, STEP: 0.25,
  SLOW_MS: 22, WINDOW: 30, FAST_MS: 12, FAST_SLACK: 1.25, MIN_REFRESH_MS: 4, RECOVER_MS: 5000, COOLDOWN_MS: 2000,
  FLIP_MS: 10000, MAX_FLIPS: 3, OVERRIDE: { min: 0.5, max: 3 }, SNAP_PX: 2 });

/** Fit margins as fractions of the view (camera-plan's defaults), applied inside the free area. */
export const BASE_MARGINS = deepFreeze({ left: 0.04, right: 0.04, top: 0.06, bottom: 0.06 });

const MAX_INSET_PX = 100000;
const SETTLED_GAP = 1e-3;
const BLEED_PASSES = 6;

/** min(devicePixelRatio, maxDpr, and whatever keeps the frame under maxPixels); 1 for bad input. */
export function pickDpr({ deviceDpr, width, height, maxDpr = DPR.CAP, maxPixels = DPR.MAX_PIXELS }) {
  const device = isFiniteNum(deviceDpr) && deviceDpr > 0 ? deviceDpr : 1;
  const area = isFiniteNum(width) && isFiniteNum(height) && width > 0 && height > 0 ? width * height : 0;
  const pixelCap = area > 0 ? Math.sqrt(maxPixels / area) : Infinity;
  return Math.min(device, maxDpr, pixelCap);
}

/** The lowest pixel ratio the governor steps to: DPR.WIDE_FLOOR for a viewport DPR.WIDE_PX wide or more, else 1. */
export function dprFloor(width) {
  return isFiniteNum(width) && width >= DPR.WIDE_PX ? DPR.WIDE_FLOOR : DPR.FLOOR;
}

/** ?dpr=<n> from a location's search string: n clamped to DPR.OVERRIDE, or null when absent or not a number > 0. */
export function dprOverride(search) {
  let raw = null;
  try {
    raw = new URLSearchParams(typeof search === "string" ? search : "").get("dpr");
  } catch {
    return null;
  }
  const n = raw === null || raw.trim() === "" ? Number.NaN : Number(raw);
  if (!isFiniteNum(n) || n <= 0) return null;
  return Math.min(DPR.OVERRIDE.max, Math.max(DPR.OVERRIDE.min, n));
}

/** Governor state: the governed DPR, its ceiling, the slow window being filled and the step-up bookkeeping. */
export function initialGovernor(dpr) {
  return deepFreeze({ dpr, max: dpr, samples: [], fastMs: 0, coolMs: 0, sinceUpMs: Infinity, flips: 0,
    refreshMs: null });
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** A step taken: a fresh window, the cooldown, and (down soon after an up) one more flip. */
function stepped(s, dpr, up) {
  const flip = !up && s.sinceUpMs < DPR.FLIP_MS;
  return deepFreeze({ ...s, dpr, samples: [], fastMs: 0, coolMs: DPR.COOLDOWN_MS, sinceUpMs: up ? 0 : Infinity,
    flips: s.flips + (flip ? 1 : 0) });
}

/**
 * One animated frame in (its interval, ms). `cpuMs` is the engine's own CPU time in the frame before it; `floor` and
 * `ceiling` bound the ratio now (dprFloor of the viewport; the device, tier and pixel cap). Returns a new state; the
 * ratio steps down 0.25 when the GPU falls behind and back up 0.25 once it has had headroom for a while (DPR).
 * @param {object} state  initialGovernor or a previous result
 * @param {number} frameMs
 * @param {{ cpuMs?: number, floor?: number, ceiling?: number }} [opts]
 */
export function governDpr(state, frameMs, { cpuMs = 0, floor = DPR.FLOOR, ceiling = state.max } = {}) {
  if (!isFiniteNum(frameMs) || frameMs <= 0) return state;
  const work = Math.max(0, frameMs - (isFiniteNum(cpuMs) && cpuMs > 0 ? cpuMs : 0));
  const refreshMs = Math.max(DPR.MIN_REFRESH_MS, Math.min(state.refreshMs ?? Infinity, frameMs));
  const s = { ...state, refreshMs, sinceUpMs: state.sinceUpMs + frameMs };
  if (state.coolMs > 0) return deepFreeze({ ...s, coolMs: state.coolMs - frameMs, samples: [], fastMs: 0 });
  const cur = Math.min(ceiling, Math.max(floor, state.dpr));
  const samples = [...state.samples, work];
  if (samples.length >= DPR.WINDOW && mean(samples) > DPR.SLOW_MS && cur > floor) {
    return stepped(s, Math.max(floor, cur - DPR.STEP), false);
  }
  const fast = work <= Math.max(DPR.FAST_MS, refreshMs * DPR.FAST_SLACK);
  const fastMs = fast ? state.fastMs + frameMs : 0;
  if (fastMs >= DPR.RECOVER_MS && cur < ceiling && state.flips < DPR.MAX_FLIPS) {
    return stepped(s, Math.min(ceiling, cur + DPR.STEP), true);
  }
  return deepFreeze({ ...s, samples: samples.length >= DPR.WINDOW ? [] : samples, fastMs });
}

/** Whether a canvas resized from `cur` to `next` (CSS px) needs a new drawing buffer: past DPR.SNAP_PX either way. */
export function needsRealloc(cur, next, snapPx = DPR.SNAP_PX) {
  if (!cur) return true;
  return Math.abs(next.width - cur.width) > snapPx || Math.abs(next.height - cur.height) > snapPx;
}

/** Deep equality of JSON data (two fetches of the same game frame are equal; arrays and objects never are). */
function sameData(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && sameData(a[k], b[k]));
}

/** Whether two game frames ({ field, teams, teamOrder, game } or null) are the same: nothing to rebuild. */
export function sameFrame(a, b) {
  return sameData(a ?? null, b ?? null);
}

const clampInset = (v, max) => (isFiniteNum(v) ? Math.min(max, Math.max(0, v)) : 0);

/** CSS lengths ("44px") from the field host's --sc-field-safe-* properties as pixels; anything else is 0. */
export function insetsFrom(css) {
  const px = (v) => {
    const m = typeof v === "string" ? /^\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)px\s*$/i.exec(v) : null;
    return m ? clampInset(Number(m[1]), MAX_INSET_PX) : 0;
  };
  return { top: px(css?.top), right: px(css?.right), bottom: px(css?.bottom), left: px(css?.left) };
}

/** Lay one axis out: the window [offset, offset + size] in a virtual frame `full` centered on the free area. */
function axis(size, lo, hi) {
  const a = clampInset(lo, size);
  const b = clampInset(hi, Math.max(0, size - a - 1));
  const center = (a + size - b) / 2;
  const offset = center < size / 2 ? size - 2 * center : 0;
  const full = center < size / 2 ? 2 * (size - center) : 2 * center;
  return { full, offset, free: Math.max(1, size - a - b) };
}

/**
 * The camera's virtual frame for a canvas whose edges are covered by HUD panels (`insets` in px): a frame large
 * enough that the free area sits at its optical center (PerspectiveCamera.setViewOffset(fullWidth, fullHeight,
 * offsetX, offsetY, width, height)), the camera aspect to use, and fit margins that keep a fitted frame inside the
 * free area (BASE_MARGINS of the free area on each side).
 */
export function safeView({ width, height, insets = {} }) {
  const w = isFiniteNum(width) && width > 0 ? width : 1;
  const h = isFiniteNum(height) && height > 0 ? height : 1;
  const x = axis(w, insets.left, insets.right);
  const y = axis(h, insets.top, insets.bottom);
  const fx = x.free / x.full;
  const fy = y.free / y.full;
  const sideX = (1 - fx) / 2;
  const sideY = (1 - fy) / 2;
  return deepFreeze({
    fullWidth: x.full, fullHeight: y.full, offsetX: x.offset, offsetY: y.offset, aspect: x.full / y.full,
    shifted: x.full !== w || y.full !== h,
    margins: { left: sideX + BASE_MARGINS.left * fx, right: sideX + BASE_MARGINS.right * fx,
      top: sideY + BASE_MARGINS.top * fy, bottom: sideY + BASE_MARGINS.bottom * fy },
  });
}

const lerp = (a, b, u) => a + (b - a) * u;
const lerp3 = (a, b, u) => ({ x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), z: lerp(a.z, b.z, u) });
const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** A pose between `a` (u = 0) and `b` (u = 1): position, target and fov move together. */
export function lerpPose(a, b, u) {
  return { position: lerp3(a.position, b.position, u), target: lerp3(a.target, b.target, u), fov: lerp(a.fov, b.fov, u) };
}

/** How far apart two poses are (yards of position and target, degrees of fov). */
export function poseGap(a, b) {
  return Math.max(dist3(a.position, b.position), dist3(a.target, b.target), Math.abs(a.fov - b.fov));
}

/**
 * Frame-rate independent damping toward `goal` (Driscoll; THREE.MathUtils.damp): k = 1 - exp(-lambda * dt). Snaps
 * the last thousandth of a yard so the render loop can stop.
 */
export function dampPose(cur, goal, lambda, dtMs) {
  const k = 1 - Math.exp(-lambda * Math.max(0, dtMs) / 1000);
  const next = lerpPose(cur, goal, k);
  const moving = poseGap(next, goal) > SETTLED_GAP;
  return { pose: moving ? next : lerpPose(goal, goal, 0), moving };
}

/**
 * RGBA pixels with each fully transparent pixel given the average color of its opaque (or already bled)
 * neighbours, alpha untouched: mipmaps of a logo then never drag black into its edge (recipe 4.6). Returns a copy.
 */
export function bleedAlpha(data, width, height, passes = BLEED_PASSES) {
  const out = new Uint8ClampedArray(data);
  const filled = new Uint8Array(width * height).map((_, i) => (out[i * 4 + 3] > 0 ? 1 : 0));
  for (let pass = 0; pass < passes; pass += 1) {
    const newly = [];
    for (let i = 0; i < width * height; i += 1) {
      if (filled[i]) continue;
      const rgb = neighbourMean(out, filled, i, width, height);
      if (rgb) newly.push([i, rgb]);
    }
    if (!newly.length) break;
    for (const [i, rgb] of newly) {
      out.set(rgb, i * 4);
      filled[i] = 1;
    }
  }
  return out;
}

function neighbourMean(px, filled, i, width, height) {
  const x = i % width;
  const y = (i - x) / width;
  const sum = [0, 0, 0];
  let n = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= width || yy >= height || !filled[yy * width + xx]) continue;
      const j = (yy * width + xx) * 4;
      sum[0] += px[j];
      sum[1] += px[j + 1];
      sum[2] += px[j + 2];
      n += 1;
    }
  }
  return n ? sum.map((s) => s / n) : null;
}
