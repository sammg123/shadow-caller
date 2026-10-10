// Under the Lights: the LED fascia ribbons in the bowl (DESIGN.md "two LED fascia ribbons on the front edges of the
// decks, diegetic copies of the HUD ribbons (warm white and amber on LED black, FrontSide only, stepping at the same
// 12 fps)"; owner W1). One mesh, one LED material, one small canvas: ribbon A on the field wall all the way round
// (the newest play, as the HUD's upper ribbon has it) and ribbon B on the upper deck's front (the game, both logos).
// A new message steps in from the right in 5 frames of 83 ms while the old one steps out left; a touchdown, a
// turnover or a flag holds for a moment and steps back. Text is drawn with fillText only, in the world's text face.
import { ringPoint } from "./builder.js";
import { RINGS, deckRanges } from "./bowl.js";
import { TONES } from "./messages.js";
import { ledMaterial } from "../shaders/led.js";

export const LED = Object.freeze({ cols: 1024, rows: 24, font: 700, fontPx: 19, padPx: 18, logoPx: 20, gapPx: 46 });
const ROWS = Object.freeze({ B: 0, A: LED.rows });          // canvas rows (top half B, bottom half A; flipY maps them)
const STEP = Object.freeze({ ms: 83, count: 5 });
const FALLBACK_FONT = "\"Arial Narrow\", Arial, sans-serif";
const BLACK = "#000000";

/** A ribbon's quads along one ring between heights y0 and y1, facing the field; u in panels, v in its atlas half. */
function ribbonQuads(out, { a, b, y0, y1, t0, t1, v0, v1, segments }) {
  const panelYd = LED.cols * ((y1 - y0) / LED.rows);
  let u = 0;
  let prev = ringPoint(t0, a, b);
  for (let i = 1; i <= segments; i += 1) {
    const p = ringPoint(t0 + ((t1 - t0) * i) / segments, a, b);
    const u1 = u + Math.hypot(p[0] - prev[0], p[1] - prev[1]) / panelYd;
    const base = out.pos.length / 3;
    out.pos.push(prev[0], y0, prev[1], p[0], y0, p[1], p[0], y1, p[1], prev[0], y1, prev[1]);
    out.uv.push(u, v0, u1, v0, u1, v1, u, v1);
    out.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    prev = p;
    u = u1;
  }
}

/** Both ribbons' geometry (A on the field wall, B on the upper deck fascia). */
export function ribbonGeometry(THREE) {
  const out = { pos: [], uv: [], idx: [] };
  const { lower, upper, ribbonA: ra, ribbonB: rb } = RINGS;
  const [u0, u1] = deckRanges().upper;
  ribbonQuads(out, { a: lower.a - ra.inset, b: lower.b - ra.inset, y0: ra.y0, y1: ra.y1, t0: 0, t1: Math.PI * 2,
    v0: 0, v1: 0.5, segments: RINGS.segments });
  ribbonQuads(out, { a: upper.a - rb.inset, b: upper.b - rb.inset, y0: rb.y0, y1: rb.y1, t0: u0, t1: u1, v0: 0.5,
    v1: 1, segments: Math.round(RINGS.segments * ((u1 - u0) / (Math.PI * 2))) });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(out.pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(out.uv, 2));
  g.setIndex(out.idx);
  g.computeBoundingSphere();
  return g;
}

function textFace(doc) {
  try {
    const v = doc?.defaultView?.getComputedStyle?.(doc.documentElement)?.getPropertyValue?.("--sc-font-text") ?? "";
    const family = v.trim();
    return /^[\w\s"',.-]+$/.test(family) && family ? family : FALLBACK_FONT;
  } catch {
    return FALLBACK_FONT;
  }
}

function canvasOf(doc, w, h) {
  const c = doc.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/** One message as a strip image: [logo] TEXT [logo], text in its tones; returns { canvas, width }. */
function stripOf(r, msg) {
  const c = canvasOf(r.doc, LED.cols, LED.rows);
  const ctx = c.getContext("2d");
  ctx.font = `${LED.font} ${LED.fontPx}px ${r.face}`;
  ctx.textBaseline = "middle";
  const logos = (msg.logos ?? []).map((url) => r.logos.get(url)).filter((img) => img?.complete && img.naturalWidth);
  let x = 0;
  const drawLogo = (img) => {
    ctx.drawImage(img, x, (LED.rows - LED.logoPx) / 2, LED.logoPx, LED.logoPx);
    x += LED.logoPx + LED.padPx / 2;
  };
  if (logos[0]) drawLogo(logos[0]);
  for (const part of msg.parts) {
    ctx.fillStyle = TONES[part.tone] ?? TONES.warm;
    ctx.fillText(part.text, x, LED.rows / 2 + 1);
    x += ctx.measureText(part.text).width;
  }
  if (logos[1] ?? (logos[0] && msg.kind === "td" ? logos[0] : null)) {
    x += LED.padPx / 2;
    drawLogo(logos[1] ?? logos[0]);
  }
  return { canvas: c, width: Math.max(1, Math.ceil(x)) };
}

/** A whole panel row (LED.cols wide): the strip repeated at even spacing, so the panel tiles round the bowl. */
function panelOf(r, msg) {
  const panel = canvasOf(r.doc, LED.cols, LED.rows);
  const ctx = panel.getContext("2d");
  ctx.fillStyle = BLACK;
  ctx.fillRect(0, 0, LED.cols, LED.rows);
  if (!msg) return panel;
  const strip = stripOf(r, msg);
  const n = Math.max(1, Math.floor(LED.cols / (strip.width + LED.gapPx)));
  const pitch = LED.cols / n;
  for (let i = 0; i < n; i += 1) ctx.drawImage(strip.canvas, Math.round(i * pitch + (pitch - strip.width) / 2), 0);
  return panel;
}

/** Draw one ribbon's row: the old panel stepped `k` of STEP.count frames out to the left, the new one in from the right. */
function paintRow(r, row, k) {
  const ctx = r.ctx;
  const y = ROWS[row.id];
  const shift = Math.round((LED.cols * k) / STEP.count);
  ctx.fillStyle = BLACK;
  ctx.fillRect(0, y, LED.cols, LED.rows);
  if (row.from && k < STEP.count) ctx.drawImage(row.from, -shift, y);
  if (row.to) ctx.drawImage(row.to, LED.cols - shift, y);
  r.texture.needsUpdate = true;
}

function startStep(r, row, msg) {
  row.from = row.to;
  row.to = panelOf(r, msg);
  row.msg = msg;
  row.step = r.instant() ? STEP.count : 0;
  row.t = 0;
  paintRow(r, row, row.step);
}

/** A message on ribbon "A" or "B"; with holdMs it steps back to `after` once the hold is over (a timer, no frames). */
function show(r, id, msg, after = null) {
  const row = r.rows[id];
  if (!msg) return;
  clearTimeout(row.timer);
  row.timer = null;
  row.after = null;
  startStep(r, row, msg);
  if (msg.holdMs > 0 && after) {
    row.after = after;
    row.timer = setTimeout(() => {
      row.timer = null;
      startStep(r, row, row.after);
      row.after = null;
      r.requestRender();
    }, msg.holdMs);
  }
  r.requestRender();
}

/** Change what a ribbon says without a second step: the message it steps back to during a hold, else the one on it
 * (mid-step or resting), redrawn where it is. */
function revise(r, id, msg) {
  const row = r.rows[id];
  if (!msg) return;
  if (row.timer) {
    row.after = msg;
    return;
  }
  row.msg = msg;
  row.to = panelOf(r, msg);
  paintRow(r, row, row.step);
  r.requestRender();
}

function step(r, dtMs) {
  let busy = false;
  for (const row of Object.values(r.rows)) {
    if (row.step >= STEP.count) continue;
    row.t += dtMs;
    const k = Math.min(STEP.count, Math.floor(row.t / STEP.ms));          // steps(5, jump-end): 415 ms
    if (k !== row.step) {
      row.step = k;
      paintRow(r, row, k);
    }
    busy = busy || row.step < STEP.count;
  }
  return busy;
}

/** Redraw what each ribbon shows now (after the font or a logo arrives): no stepping. */
function repaint(r) {
  for (const row of Object.values(r.rows)) {
    row.to = row.msg ? panelOf(r, row.msg) : row.to;
    row.from = null;
    row.step = STEP.count;
    paintRow(r, row, STEP.count);
  }
  r.requestRender();
}

function loadLogos(r, urls) {
  for (const url of urls) {
    if (r.logos.has(url) || !r.doc.defaultView?.Image) continue;
    const img = new r.doc.defaultView.Image();
    img.decoding = "async";
    img.onload = () => { if (!r.disposed) repaint(r); };
    img.src = url;
    r.logos.set(url, img);
  }
}

/**
 * The ribbons: one mesh with the LED material, and the messages on them. Without a document (node) the boards stay
 * dark and every call is a no-op, so the rest of the stadium still builds.
 * @param {object} THREE
 * @param {{ doc?: Document | null, requestRender?: () => void, instant?: () => boolean, logos?: string[] }} opts
 */
export function createRibbons(THREE, { doc = null, requestRender = () => {}, instant = () => false, logos = [] } = {}) {
  const canvas = doc?.createElement ? canvasOf(doc, LED.cols, LED.rows * 2) : null;
  const texture = canvas ? new THREE.CanvasTexture(canvas)
    : new THREE.DataTexture(new Uint8Array(LED.cols * LED.rows * 2 * 4), LED.cols, LED.rows * 2);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  const material = ledMaterial(THREE, { map: texture, cells: [LED.cols, LED.rows * 2], unlit: "#2a2622",
    panel: "#0f1114" });
  const mesh = new THREE.Mesh(ribbonGeometry(THREE), material);
  mesh.name = "uls-ribbons";
  const r = { doc, canvas, ctx: canvas?.getContext("2d") ?? null, texture, requestRender, instant, face: textFace(doc),
    logos: new Map(), disposed: false, rows: { A: { id: "A" }, B: { id: "B" } } };
  for (const row of Object.values(r.rows)) Object.assign(row, { from: null, to: null, msg: null, step: STEP.count, t: 0,
    timer: null, after: null });
  const live = Boolean(r.ctx);
  if (live) {
    loadLogos(r, logos);
    doc.fonts?.load?.(`${LED.font} ${LED.fontPx}px ${r.face}`).then(() => { if (!r.disposed) repaint(r); }, () => {});
  }
  return {
    mesh,
    show: (id, msg, after) => { if (live && !r.disposed) show(r, id, msg, after); },
    revise: (id, msg) => { if (live && !r.disposed) revise(r, id, msg); },
    update: (dtMs) => (live ? step(r, dtMs) : false),
    message: (id) => r.rows[id]?.msg ?? null,
    dispose() {
      r.disposed = true;
      for (const row of Object.values(r.rows)) clearTimeout(row.timer);
      mesh.geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}
