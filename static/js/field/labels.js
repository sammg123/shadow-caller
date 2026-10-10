// The field's label layer (ui-architecture 2.5 labels.js, 6.1 "at most 12 live labels"; three-recipe 8.3, 10.7;
// owner A5). look.labels.renderer picks how text reaches the field:
//   css2d   DOM labels over the canvas (CSS2DRenderer): crisp at any DPR, styled by the world's CSS classes
//   decal   text painted flat on the turf near its spot, upright from the home-side camera ("projected lettering")
//   sprite  text on a billboard that always faces the camera
//   none    no labels
// Text is set with textContent or drawn with fillText, never parsed as HTML (G27). Each label's element is
// <div class="sc-field-label"><span class="{look.labels.className} {cls}">text</span></div>: CSS2DRenderer owns the
// outer element's transform, so a world offsets or animates the inner span (recipe pitfall 21). Canvas labels read
// their font and colors from the same classes through a hidden probe element. v1.4 (G3-8): after each render a plate
// that would run off the side of the field is moved back inside it (its inner span's `translate`, PLATE_PAD from the
// edge), so the words on a phone are never cut; one that fits stays centered on its spot.
// play-drawing.md 4b: a plate can carry its role and a second line, opts.words = { tag, body, sub }:
// <span class="sc-label-tag">NEXT 1</span><span class="sc-label-sep"> · </span><span class="sc-label-body">...</span>
// (+ sep and <span class="sc-label-sub">TOP PICK · 19%</span>), every part text only; handle.setWords changes them.
// handle.place({ dx, dy, leader }) moves the plate off its spot by a pixel offset (presnap-words.js solves it in screen
// space), with a thin leader line (<i class="sc-label-leader">) from the spot to the plate's nearest edge.
import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { toWorld } from "./coords.js";
import { disposeTree } from "./dispose.js";
import { LAYERS } from "./materials.js";

export const MAX_LABELS = 12;
/** A plate kept inside the field sits at least this far (px) from its side edges. */
export const PLATE_PAD = 6;

const CLASS_RE = /^-?[A-Za-z_][\w-]*$/;
const MAX_TEXT = 80;
const CANVAS_TEXT_PX = 96;
const CANVAS_PAD = 0.35;
const DEFAULT_HEIGHT_YD = 2.5;

const cleanClasses = (list) => list.join(" ").split(/\s+/).filter((c) => CLASS_RE.test(c)).join(" ");
const viewProjection = new THREE.Matrix4();
const anchor = new THREE.Vector3();

/**
 * How far (px) to move a plate `w` wide, centered at `x`, so it sits inside a field `width` wide, PLATE_PAD from its
 * edges: 0 when it fits where it is (or is wider than the field, or not laid out).
 */
export function plateShift(x, w, width, pad = PLATE_PAD) {
  if (!(w > 0) || !(width > 0) || w > width - 2 * pad) return 0;
  const left = x - w / 2;
  const right = x + w / 2;
  if (left < pad) return pad - left;
  if (right > width - pad) return width - pad - right;
  return 0;
}

/** After a css2d render: each plate moved inside the field where its spot would cut it (G3-8). */
function keepInside(L, camera) {
  if (!L.size || !camera?.projectionMatrix) return;
  viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  for (const h of L.live) {
    const el = h.element;
    if (!el?.style || h.object.visible === false) continue;
    anchor.setFromMatrixPosition(h.object.matrixWorld).applyMatrix4(viewProjection);
    const x = (anchor.x + 1) * (L.size.width / 2);
    const off = h.offset ?? { dx: 0, dy: 0 };
    const dx = off.dx + plateShift(x + off.dx, el.offsetWidth, L.size.width);
    const moved = Math.abs(dx) >= 0.5 || Math.abs(off.dy) >= 0.5;
    const value = moved ? `${Math.round(dx)}px ${Math.round(off.dy)}px` : "";
    if ((el.style.translate ?? "") !== value) el.style.translate = value;
  }
}
const cleanText = (text) => String(text ?? "").replace(/[\u0000-\u001f]/g, " ").slice(0, MAX_TEXT);
const worldOf = (pt) => {
  const w = toWorld(pt.x, pt.y, pt.h ?? 0);
  return new THREE.Vector3(w.x, w.y, w.z);
};

function probeStyle(doc, host, classes) {
  const probe = doc.createElement("span");
  probe.className = classes;
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  host.appendChild(probe);
  const cs = doc.defaultView.getComputedStyle(probe);
  const out = { family: cs.fontFamily || "sans-serif", weight: cs.fontWeight || "700", color: cs.color || "#ffffff",
    background: cs.backgroundColor || "rgba(0, 0, 0, 0)" };
  probe.remove();
  return out;
}

/** A canvas texture of one line of text in the probe's font and colors, and its width / height ratio. */
function textTexture(doc, text, style) {
  const font = `${style.weight} ${CANVAS_TEXT_PX}px ${style.family}`;
  const c = doc.createElement("canvas");
  const ctx = c.getContext("2d");
  ctx.font = font;
  const pad = CANVAS_TEXT_PX * CANVAS_PAD;
  c.width = Math.ceil(ctx.measureText(text).width + 2 * pad);
  c.height = Math.ceil(CANVAS_TEXT_PX * 1.3);
  ctx.fillStyle = style.background;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.font = font;
  ctx.fillStyle = style.color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, pad, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { tex, aspect: c.width / c.height };
}

function canvasObject(kind, doc, host, text, classes, opts) {
  const { tex, aspect } = textTexture(doc, text, probeStyle(doc, host, classes));
  const h = opts.heightYd ?? DEFAULT_HEIGHT_YD;
  if (kind === "sprite") {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
    sprite.scale.set(h * aspect, h, 1);
    sprite.center.set(0.5, 0);
    sprite.renderOrder = LAYERS.glow.order;
    return sprite;
  }
  const material = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false,
    polygonOffset: true, polygonOffsetFactor: LAYERS.graphic.factor, polygonOffsetUnits: LAYERS.graphic.units });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(h * aspect, h).rotateX(-Math.PI / 2), material);
  mesh.renderOrder = LAYERS.graphic.order;
  return mesh;
}

function makeLayer(doc, host) {
  const el = doc.createElement("div");
  el.className = "sc-field-labels";
  el.setAttribute("aria-hidden", "true");
  Object.assign(el.style, { position: "absolute", left: "0", top: "0", pointerEvents: "none" });
  host.appendChild(el);
  return new CSS2DRenderer({ element: el });
}

/** The plate's words: plain text, or (`words`) its tag, body and second line as text-only parts. */
function fillWords(doc, inner, text, words) {
  for (const child of [...(inner.children ?? [])]) child.remove?.();
  inner.textContent = "";
  if (!words || (!words.tag && !words.sub)) {
    inner.textContent = text;
    return;
  }
  const part = (cls, value) => {
    const el = doc.createElement("span");
    el.className = cls;
    el.textContent = cleanText(value);
    inner.appendChild(el);
  };
  if (words.tag) {
    part("sc-label-tag", words.tag);
    part("sc-label-sep", " · ");
  }
  part("sc-label-body", words.body ?? text);
  if (words.sub) {
    part("sc-label-sep", " · ");
    part("sc-label-sub", words.sub);
  }
}

function makeCss2d(doc, text, classes, words) {
  const outer = doc.createElement("div");
  outer.className = "sc-field-label";
  const leader = doc.createElement("i");
  leader.className = "sc-label-leader";
  leader.style.display = "none";
  outer.appendChild(leader);
  const inner = doc.createElement("span");
  inner.className = classes;
  fillWords(doc, inner, text, words);
  outer.appendChild(inner);
  const object = new CSS2DObject(outer);
  object.center.set(0.5, 1);
  return { object, element: inner, leader };
}

/** A thin line from the plate's spot (the outer element's center) to `to` (px from the spot); null hides it. */
function drawLeader(leader, to) {
  if (!leader?.style) return;
  const len = to ? Math.hypot(to.x, to.y) : 0;
  if (!(len >= 1)) {
    leader.style.display = "none";
    return;
  }
  Object.assign(leader.style, { display: "", width: `${Math.round(len)}px`,
    transform: `rotate(${Math.atan2(to.y, to.x).toFixed(4)}rad)` });
}

// The functions below share one context `L` = { spec, host, doc, kind, group, live, counter, layer }.
function removeLabel(L, handle) {
  const i = L.live.indexOf(handle);
  if (i < 0) return;
  L.live.splice(i, 1);
  disposeTree(handle.object);
}

function addLabel(L, pt, text, cls, opts) {
  if (L.kind === "none" || !pt) return null;
  if (L.live.length >= MAX_LABELS) removeLabel(L, L.live[0]);
  const classes = cleanClasses([L.spec.className, cls]);
  const words = cleanText(text);
  const made = L.kind === "css2d" ? makeCss2d(L.doc, words, classes, opts.words)
    : { object: canvasObject(L.kind, L.doc, L.host, words, classes, opts), element: null, leader: null };
  made.object.position.copy(worldOf(pt));
  L.counter += 1;
  made.object.name = `label-${L.counter}`;
  L.group.add(made.object);
  const handle = { id: L.counter, kind: L.kind, object: made.object, element: made.element, offset: null,
    move(next) { made.object.position.copy(worldOf(next)); }, remove() { removeLabel(L, handle); },
    /** New words, text only ({ tag, body, sub } or plain `text`); css2d labels only. */
    setWords(next, plain = "") {
      if (made.element) fillWords(L.doc, made.element, cleanText(plain || next?.body || ""), next);
    },
    /** The plate's size in px as the page lays it out ({ w, h }), or null (no page): a label not drawn yet is put in
     * the layer (where the next render puts it anyway) and a hidden one shown for the measure, so a layout made before
     * the first frame still knows each plate's true size (css2d). */
    size() {
      const el = made.element;
      const outer = made.object.element;
      if (!el || !outer || !L.layer?.domElement) return null;
      if (outer.parentNode !== L.layer.domElement) L.layer.domElement.appendChild(outer);
      const hidden = outer.style.display === "none";
      if (hidden) outer.style.display = "";
      const out = { w: el.offsetWidth ?? 0, h: el.offsetHeight ?? 0 };
      if (hidden) outer.style.display = "none";
      return out.w > 0 && out.h > 0 ? out : null;
    },
    /** Off its spot by a pixel offset, with a leader to `leader` (px from the spot) or none (css2d). */
    place({ dx = 0, dy = 0, leader = null } = {}) {
      handle.offset = Number.isFinite(dx) && Number.isFinite(dy) ? { dx, dy } : null;
      const el = made.element;
      if (el?.style) el.style.translate = handle.offset ? `${Math.round(dx)}px ${Math.round(dy)}px` : "";
      drawLeader(made.leader, handle.offset ? leader : null);
    } };
  L.live.push(handle);
  return handle;
}

/**
 * @param {{ renderer: "css2d" | "decal" | "sprite" | "none", className: string }} spec  look.labels
 * @param {HTMLElement} host  the #field host the engine draws in
 */
export function createLabels(spec, host, { doc = host?.ownerDocument ?? null } = {}) {
  const group = new THREE.Group();
  group.name = "labels";
  const kind = doc ? spec.renderer : "none";
  const L = { spec, host, doc, kind, group, live: [], counter: 0, layer: kind === "css2d" ? makeLayer(doc, host) : null };
  const clear = () => { for (const h of [...L.live]) removeLabel(L, h); };
  return {
    group, kind,
    add: (pt, text, cls = "", opts = {}) => addLabel(L, pt, text, cls, opts),
    remove: (handle) => removeLabel(L, handle),
    count: () => L.live.length,
    clear,
    render(scene, camera) {
      if (!L.layer) return;
      L.layer.render(scene, camera);
      keepInside(L, camera);
    },
    setSize(w, h) {
      L.size = { width: w, height: h };
      L.layer?.setSize(w, h);
    },
    dispose() {
      clear();
      L.layer?.domElement.remove();
      L.layer = null;
      group.removeFromParent();
    },
  };
}
