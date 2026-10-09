// Glyphs painted on the turf (three-recipe 4.4 to 4.6, pitfalls 5 to 10; owner A5): the numeral atlas and its
// merged mesh, the end-zone wordmarks and the midfield logo. Paint is white on opaque black used as an alphaMap
// (a transparent canvas would drag black into mipmapped edges); the logo keeps real alpha through an alpha bleed
// and an ImageData upload. Canvas text waits for the world's display font (--sc-font-display), or the fallback
// would be baked into the atlas for the whole session. Text is only ever drawn with fillText and strokeText.
import * as THREE from "three";
import { ATLAS, numeralQuads } from "./field-spec.js";
import { LAYERS } from "./materials.js";
import { bleedAlpha } from "./stage-math.js";

const FALLBACK_FONT = "\"Arial Narrow\", \"Helvetica Neue\", Arial, sans-serif";
const WEIGHT = 800;
const FONT_TIMEOUT_MS = 2500;
const GLYPH_PAD = 0.06;
const WORDMARK = Object.freeze({ w: 2048, h: 384, stroke: 30, tracking: 0.06, fill: 0.9 });
const LOGO_PX = 512;
const LOGO_BLEED = 8;

/** The world's display font stack from the page (--sc-font-display), or a condensed system fallback. */
export function fieldFont(doc) {
  try {
    const value = doc?.defaultView?.getComputedStyle?.(doc.documentElement)?.getPropertyValue?.("--sc-font-display");
    const family = typeof value === "string" ? value.trim() : "";
    return /^[\w\s"',.-]+$/.test(family) && family ? family : FALLBACK_FONT;
  } catch {
    return FALLBACK_FONT;
  }
}

/** Wait (at most FONT_TIMEOUT_MS) for the font, so canvas text is drawn in it. Never rejects. */
export async function loadFont(doc, family, { timeoutMs = FONT_TIMEOUT_MS, setTimer } = {}) {
  const fonts = doc?.fonts;
  if (!fonts?.load) return false;
  const timer = setTimer ?? ((fn, ms) => doc.defaultView?.setTimeout?.(fn, ms));
  const timeout = new Promise((resolve) => { timer(() => resolve(false), timeoutMs); });
  const loaded = fonts.load(`${WEIGHT} 200px ${family}`).then((list) => list.length > 0, () => false);
  return Promise.race([loaded, timeout]);
}

/** Mipmaps, trilinear filtering and full anisotropy (the far side is seen at 70 to 80 degrees). */
export function tuneTexture(tex, maxAnisotropy, { srgb = false } = {}) {
  tex.anisotropy = maxAnisotropy;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function canvasOf(doc, w, h) {
  const c = doc.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  return { c, ctx };
}

function drawFittedGlyph(ctx, char, x, y, w, h, font) {
  ctx.save();
  ctx.font = `${WEIGHT} 400px ${font}`;
  const m = ctx.measureText(char);
  const gw = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
  const gh = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  if (gw > 0 && gh > 0) {
    ctx.translate(x + w * GLYPH_PAD, y + h * GLYPH_PAD);
    ctx.scale((w * (1 - 2 * GLYPH_PAD)) / gw, (h * (1 - 2 * GLYPH_PAD)) / gh);
    ctx.fillText(char, m.actualBoundingBoxLeft, m.actualBoundingBoxAscent);
  }
  ctx.restore();
}

/** Digits 0 to 5 stretched to fill a 4 by 6 ft block each (how field numerals look), plus a solid arrow cell. */
export function numeralAtlas(doc, font, maxAnisotropy) {
  const { c, ctx } = canvasOf(doc, ATLAS.width, ATLAS.height);
  ctx.fillStyle = "#fff";
  for (let d = 0; d <= 5; d += 1) drawFittedGlyph(ctx, String(d), d * ATLAS.cellW, 0, ATLAS.cellW, ATLAS.cellH, font);
  ctx.fillRect(ATLAS.whiteCell * ATLAS.cellW + 16, 16, ATLAS.cellW - 32, ATLAS.cellH - 32);
  return tuneTexture(new THREE.CanvasTexture(c), maxAnisotropy);
}

/** Paint on the turf: lit like the grass (same roughness), an alpha mask, polygon offset over the turf. */
export function paintMaterial(look, color, alphaMap, layer = LAYERS.decal) {
  return new THREE.MeshStandardMaterial({ color, alphaMap, transparent: true, opacity: look.field.paintOpacity,
    depthWrite: false, fog: false, roughness: look.field.roughness, metalness: look.field.metalness, polygonOffset: true,
    polygonOffsetFactor: layer.factor, polygonOffsetUnits: layer.units });
}

/** Every numeral and arrow as one mesh (one draw call). */
export function numeralMesh(L, material) {
  const { positions, uvs, indices } = numeralQuads(L);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, material);
  mesh.name = "numerals";
  mesh.renderOrder = LAYERS.decal.order;
  mesh.receiveShadow = true;
  return mesh;
}

/** A flat decal whose texture "up" points along `up` and whose text runs along `right` (unit vectors). */
export function groundDecal({ width, height, center, right, up }, material) {
  const g = new THREE.PlaneGeometry(width, height);
  const r = new THREE.Vector3(...right);
  const u = new THREE.Vector3(...up);
  g.applyMatrix4(new THREE.Matrix4().makeBasis(r, u, new THREE.Vector3().crossVectors(r, u)));
  const mesh = new THREE.Mesh(g, material);
  mesh.position.set(center[0], 0, center[2]);
  mesh.renderOrder = LAYERS.decal.order;
  mesh.receiveShadow = true;
  return mesh;
}

/** Two masks for a wordmark, its outline and its fill, so any two colors work without fringes. */
export function wordmarkMasks(doc, text, font, maxAnisotropy) {
  const make = (mode) => {
    const { c, ctx } = canvasOf(doc, WORDMARK.w, WORDMARK.h);
    ctx.font = `${WEIGHT} ${Math.round(WORDMARK.h * 0.78)}px ${font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.letterSpacing = `${Math.round(WORDMARK.h * WORDMARK.tracking)}px`;
    const fit = Math.min(1, (WORDMARK.w * WORDMARK.fill) / Math.max(1, ctx.measureText(text).width));
    ctx.translate(WORDMARK.w / 2, WORDMARK.h / 2 + WORDMARK.h * 0.04);
    ctx.scale(fit, 1);
    ctx.lineJoin = "round";
    ctx.lineWidth = WORDMARK.stroke / fit;
    ctx.strokeStyle = "#fff";
    ctx.fillStyle = "#fff";
    if (mode === "outline") ctx.strokeText(text, 0, 0);
    ctx.fillText(text, 0, 0);
    return tuneTexture(new THREE.CanvasTexture(c), maxAnisotropy);
  };
  return { outline: make("outline"), fill: make("fill") };
}

/**
 * The team logo for the midfield decal, from the app's own logo proxy (DC C2): drawn, alpha-bled and uploaded as
 * ImageData so its edges keep their color. Resolves null when it can't load (the field reads fine without it).
 */
export async function logoTexture(doc, url, maxAnisotropy) {
  try {
    const img = new (doc.defaultView.Image)();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    const c = doc.createElement("canvas");
    c.width = LOGO_PX;
    c.height = LOGO_PX;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, LOGO_PX, LOGO_PX);
    const data = ctx.getImageData(0, 0, LOGO_PX, LOGO_PX);
    const bled = new (doc.defaultView.ImageData)(bleedAlpha(data.data, LOGO_PX, LOGO_PX, LOGO_BLEED), LOGO_PX, LOGO_PX);
    return tuneTexture(new THREE.Texture(bled), maxAnisotropy, { srgb: true });
  } catch {
    return null;
  }
}
