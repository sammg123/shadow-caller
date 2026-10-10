// The pre-snap scene of a real Dallas snap, for the screen-space layout tests (play-drawing.md 4b): his top 2 as
// ShadowPlays, the previous play's Drawing, the resting ball, and a projection through the Under the Lights wide
// camera (the default pre-snap camera) as the 3D field poses it for that snap, at a window size with the world's HUD
// insets, measured on the page (--sc-field-safe-*). No three.js: camera-plan's own pose and projection.
import { framePresetFor, frameSituation, poseFor, projectToNdc } from "../../static/js/field/camera-plan.js";
import { buildGhostSet, ghostInputFromPred } from "../../static/js/field/ghosts.js";
import { buildDrawing, situationFromRow } from "../../static/js/field/paths.js";
import { buildShadowPlays } from "../../static/js/field/shadows.js";
import { safeView } from "../../static/js/field/stage-math.js";
import { look as ULS_LOOK } from "../../static/js/theme/worlds/under-the-lights/look.js";
import { allRows, capture } from "./field-rows.mjs";

/** Under the Lights HUD insets per window, px (measured: getComputedStyle(#field) --sc-field-safe-*). */
export const ULS_INSETS = Object.freeze({
  "1440x900": { top: 44, right: 456, bottom: 184, left: 0 },
  "1920x1080": { top: 56, right: 624, bottom: 240, left: 0 },
  "1512x982": { top: 45.8, right: 481.2, bottom: 192.4, left: 0 },
  "1728x1117": { top: 51.2, right: 556.8, bottom: 217.6, left: 0 },
});

/** A plate's size estimated from its words (Big Shoulders Text in caps: about 7 px a character at 1440x900, 22 px
 * fonts at 1920 are 1.375 times that), a tab, padding, and a second line for a verdict. */
export function plateSize(words, size) {
  const k = size.width >= 1900 ? 1.375 : size.width >= 1700 ? 1.2 : size.width >= 1500 ? 1.05 : 1;
  const chars = [words.tag, words.body].filter(Boolean).join(" ").length;
  const subChars = words.sub ? words.sub.length : 0;
  return { w: Math.round((Math.max(chars, subChars * 0.9) * 7.1 + 22) * k), h: Math.round((words.sub ? 46 : 27) * k) };
}

const WIDE = ULS_LOOK.cameras.modes.find((m) => m.id === "wide");

/** The camera's projection for a snap: field yards to canvas px (y down), through the view offset of the HUD. */
export function wideProjector(sit, ghosts, size) {
  const insets = ULS_INSETS[`${size.width}x${size.height}`] ?? {};
  const view = safeView({ width: size.width, height: size.height, insets });
  const frame = frameSituation(sit, { preset: framePresetFor(WIDE), ghosts });
  const pose = poseFor(frame, WIDE, { aspect: view.aspect, margins: view.margins });
  const project = (p) => {
    const ndc = projectToNdc({ x: p.x, y: p.y, h: p.h ?? 0 }, pose, view.aspect);
    if (!(ndc.depth > 0)) return null;
    return { x: ((ndc.x + 1) / 2) * view.fullWidth - view.offsetX, y: ((1 - ndc.y) / 2) * view.fullHeight - view.offsetY };
  };
  const bounds = { x0: insets.left ?? 0, y0: insets.top ?? 0, x1: size.width - (insets.right ?? 0),
    y1: size.height - (insets.bottom ?? 0) };
  return { project, bounds };
}

/** The play the field shows before row index i: the last row before it that draws something. */
export function previousDrawing(rows, i) {
  const prev = rows.slice(0, i).reverse().find((r) => r.kind !== "admin");
  return prev ? buildDrawing(prev) : null;
}

/** Every Dallas pre-snap of the capture: { row, i, sit, shadows, last, ghosts }; the shadows built as both engines
 * build them, with the previous play on the field (its stroke, where it lies in their way, moves their lanes). */
export function dallasPresnaps() {
  const rows = allRows();
  const meta = capture().meta;
  return rows.map((row, i) => ({ row, i })).filter(({ row }) => row.pred?.dist).map(({ row, i }) => {
    const sit = situationFromRow(row);
    const ghosts = buildGhostSet(ghostInputFromPred(row.pred, meta.leaves, meta.families), sit);
    const last = previousDrawing(rows, i);
    return { row, i, sit, ghosts, shadows: buildShadowPlays(row.pred, sit, { avoid: last ? [last] : [] }), last };
  });
}
