// The marks' glyphs (A5 part 2; play-drawing.md 2): the catch dot, the incompletion X, INT and TD, the flag, a sack's
// burst, the field goal's check, the kick marks. Each glyph is two alpha masks drawn once on a canvas, white on black
// (decals.js does the same for the numerals): its core, and its edge as a ring around the core that never overlaps it,
// so a dimmed mark fades evenly. The materials color them (play-style.js: the team's light core and edge, or a tone),
// so one mask serves every team. Letters wait for nothing: they use the world's display font when the page has it
// (decals.fieldFont; the field's own glyphs load it first) and are drawn with fillText only.
//   createGlyphs({ doc, maxAnisotropy }) -> { mask(glyph, layer, text?) -> Texture | null, aspect(glyph, text?), dispose() }
import * as THREE from "three";
import { fieldFont } from "./decals.js";
import { markShared } from "./dispose.js";

const S = 128;
const TEXT_W = 256;
const EDGE_PAD = 0.075;          // the edge ring's thickness, a fraction of the glyph
const TEXT_PX = 78;
const PLATE = Object.freeze({ pad: 10, radius: 18 });

const roundPath = (ctx) => { ctx.lineJoin = "round"; ctx.lineCap = "round"; };

/** Each glyph: draw(ctx) traces its path; `stroke` is its line width when the shape is a line, else it is filled. */
const SHAPES = Object.freeze({
  dot: { draw: (c) => c.arc(S / 2, S / 2, S * 0.3, 0, Math.PI * 2) },
  ring: { stroke: S * 0.11, draw: (c) => c.arc(S / 2, S / 2, S * 0.3, 0, Math.PI * 2) },
  x: { stroke: S * 0.13, draw: (c) => { c.moveTo(S * 0.24, S * 0.24); c.lineTo(S * 0.76, S * 0.76);
    c.moveTo(S * 0.76, S * 0.24); c.lineTo(S * 0.24, S * 0.76); } },
  check: { stroke: S * 0.13, draw: (c) => { c.moveTo(S * 0.2, S * 0.52); c.lineTo(S * 0.42, S * 0.74);
    c.lineTo(S * 0.8, S * 0.28); } },
  square: { draw: (c) => c.rect(S * 0.27, S * 0.27, S * 0.46, S * 0.46) },
  diamond: { draw: (c) => { c.moveTo(S / 2, S * 0.18); c.lineTo(S * 0.82, S / 2); c.lineTo(S / 2, S * 0.82);
    c.lineTo(S * 0.18, S / 2); c.closePath(); } },
  bar: { draw: (c) => c.rect(S * 0.18, S * 0.41, S * 0.64, S * 0.18) },
  arrow: { draw: (c) => { c.moveTo(S * 0.5, S * 0.16); c.lineTo(S * 0.8, S * 0.5); c.lineTo(S * 0.6, S * 0.5);
    c.lineTo(S * 0.6, S * 0.82); c.lineTo(S * 0.4, S * 0.82); c.lineTo(S * 0.4, S * 0.5); c.lineTo(S * 0.2, S * 0.5);
    c.closePath(); } },
  flag: { draw: (c) => { c.moveTo(S * 0.3, S * 0.86); c.lineTo(S * 0.3, S * 0.14); c.lineTo(S * 0.8, S * 0.3);
    c.lineTo(S * 0.38, S * 0.48); c.lineTo(S * 0.38, S * 0.86); c.closePath(); } },
  burst: { draw: (c) => {
    for (let i = 0; i < 16; i += 1) {
      const r = (i % 2 === 0 ? 0.36 : 0.16) * S;
      const a = (Math.PI * i) / 8;
      const [x, y] = [S / 2 + r * Math.cos(a), S / 2 + r * Math.sin(a)];
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.closePath();
  } },
});

function trace(ctx, shape, extra = 0) {
  ctx.beginPath();
  roundPath(ctx);
  shape.draw(ctx);
  if (shape.stroke) {
    ctx.lineWidth = shape.stroke + extra;
    ctx.stroke();
    return;
  }
  ctx.fill();
  if (extra > 0) {
    ctx.lineWidth = extra;
    ctx.stroke();
  }
}

function paintShape(ctx, shape, layer) {
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#fff";
  if (layer === "core") {
    trace(ctx, shape);
    return;
  }
  trace(ctx, shape, EDGE_PAD * S * 2);
  ctx.globalCompositeOperation = "destination-out";
  trace(ctx, shape, -1);
  ctx.globalCompositeOperation = "source-over";
}

function paintText(ctx, text, layer, font) {
  ctx.font = `800 ${TEXT_PX}px ${font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  const w = Math.min(TEXT_W - 2 * PLATE.pad, ctx.measureText(text).width + 2 * PLATE.radius);
  if (layer === "edge") {
    ctx.beginPath();
    ctx.roundRect((TEXT_W - w) / 2, PLATE.pad, w, S - 2 * PLATE.pad, PLATE.radius);
    ctx.fill();
    ctx.globalCompositeOperation = "destination-out";
  }
  ctx.fillText(text, TEXT_W / 2, S / 2 + 4, TEXT_W - 2 * PLATE.pad - PLATE.radius);
  ctx.globalCompositeOperation = "source-over";
}

/** A white-on-black canvas: transparent black around the shape would drag dark fringes into the mipmaps. */
function maskCanvas(doc, glyph, layer, text, font) {
  const c = doc.createElement("canvas");
  c.width = glyph === "text" ? TEXT_W : S;
  c.height = S;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, c.width, c.height);
  if (glyph === "text") paintText(ctx, String(text ?? ""), layer, font);
  else paintShape(ctx, SHAPES[glyph] ?? SHAPES.square, layer);
  return c;
}

function toTexture(canvas, maxAnisotropy) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return markShared(tex);
}

/**
 * The glyph cache of one layer. Without a document (node tests) there are no masks: marks draw as plain squares.
 * @param {{ doc?: Document | null, maxAnisotropy?: number }} [opts]
 */
export function createGlyphs({ doc = null, maxAnisotropy = 4 } = {}) {
  const cache = new Map();
  let font = null;
  const make = (glyph, layer, text) => {
    font ??= fieldFont(doc);
    const canvas = maskCanvas(doc, glyph, layer, text, font);
    return canvas ? toTexture(canvas, maxAnisotropy) : null;
  };
  return {
    mask(glyph, layer, text = null) {
      if (!doc?.createElement) return null;
      const key = `${glyph}|${layer}|${glyph === "text" ? text : ""}`;
      if (!cache.has(key)) cache.set(key, make(glyph, layer, text));
      return cache.get(key);
    },
    aspect: (glyph) => (glyph === "text" ? TEXT_W / S : 1),
    count: () => cache.size,
    dispose() {
      for (const tex of cache.values()) tex?.dispose();
      cache.clear();
    },
  };
}
