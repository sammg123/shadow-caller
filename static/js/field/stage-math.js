/**
 * Numbers behind the 3D stage (ui-architecture 6.1; three-recipe 6.3, 10.4): the device pixel ratio and its
 * frame-time governor, the HUD safe area as a camera view offset plus fit margins, camera pose easing, and the
 * alpha bleed that keeps logo decals free of dark fringes. Pure: no DOM, no three.js, no clock.
 *
 *   Pose = { position: {x, y, z}, target: {x, y, z}, fov }   (three.js world space, vertical fov in degrees)
 */
import { deepFreeze } from "../core/domain.js";
import { isFiniteNum } from "./grammar.js";

export const DPR = deepFreeze({ CAP: 2, MAX_PIXELS: 3840 * 2160, FLOOR: 1, STEP: 0.25, SLOW_MS: 22, WINDOW: 30 });

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

/** Governor state: the current DPR and the frame times of the window being filled. */
export function initialGovernor(dpr) {
  return deepFreeze({ dpr, samples: [] });
}

/**
 * One animated frame's time in. When a window of DPR.WINDOW frames averages over DPR.SLOW_MS, the DPR steps down
 * by DPR.STEP to a floor of DPR.FLOOR, and stays there for the session (6.1: never back up, no flapping).
 */
export function governDpr(state, frameMs) {
  if (!isFiniteNum(frameMs) || frameMs <= 0) return state;
  const samples = [...state.samples, frameMs];
  if (samples.length < DPR.WINDOW) return deepFreeze({ dpr: state.dpr, samples });
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const dpr = mean > DPR.SLOW_MS ? Math.max(Math.min(DPR.FLOOR, state.dpr), state.dpr - DPR.STEP) : state.dpr;
  return deepFreeze({ dpr, samples: [] });
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
