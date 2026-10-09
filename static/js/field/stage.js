// The stage: everything the WebGL engine draws with (ui-architecture 2.5 and the v1.2 A5 note; owner A5). It builds
// the renderer rig, the scene graph (one root group per layer, in draw order), lights and post from the Look, the
// regulation field, the world's props (or the plain neutral surroundings), the camera rig, the situation paint,
// the label layer and the material kit, and draws a frame. scene.js (the Engine facade) owns every decision about
// what to show; layers (layers.js) receive this object as `stage`.
//   stage.setFrame(frame)   a new game frame { field, teams, teamOrder, game }: kit teams, field, props, day look
//   stage.resize(w, h)      canvas size, DPR, camera view and safe area (--sc-field-safe-* on the host)
import * as THREE from "three";
import * as coords from "./coords.js";
import { resolveLook } from "../theme/look-schema.js";
import { createCameraRig } from "./cameras.js";
import { disposeTree } from "./dispose.js";
import { buildField } from "./field-mesh.js";
import { createLabels } from "./labels.js";
import { buildLighting, exposureFor } from "./lighting.js";
import { createLines } from "./lines.js";
import { createKit } from "./materials.js";
import { buildPost } from "./post.js";
import { createRig } from "./renderer.js";
import { insetsFrom } from "./stage-math.js";
import { neutralProps } from "./structures.js";

/** Layer roots in draw order (transparent objects also sort by renderOrder, materials.js LAYERS). */
export const ROOTS = Object.freeze(["field", "props", "residue", "ghosts", "situation", "overlays", "plays", "labels"]);
const SAFE_VARS = Object.freeze({ top: "--sc-field-safe-top", right: "--sc-field-safe-right",
  bottom: "--sc-field-safe-bottom", left: "--sc-field-safe-left" });
const GLYPH_TIMEOUT_MS = 4000;
const FALLBACK_ASPECT = 9 / 16;

/** The look for a game: look.world.day merged over it when the backend says the game is played in daylight. */
export function lookForGame(base, game) {
  const day = game?.light === "day" ? base.world?.day : null;
  if (!day || typeof day !== "object" || Array.isArray(day)) return { look: base, problem: null };
  try {
    return { look: resolveLook(day, base), problem: null };
  } catch (err) {
    return { look: base, problem: err };
  }
}

function readInsets(host) {
  try {
    const cs = host.ownerDocument.defaultView.getComputedStyle(host);
    return insetsFrom(Object.fromEntries(Object.entries(SAFE_VARS).map(([k, v]) => [k, cs.getPropertyValue(v)])));
  } catch {
    return insetsFrom(null);
  }
}

function makeRoots(scene) {
  return Object.freeze(Object.fromEntries(ROOTS.map((name) => {
    const g = new THREE.Group();
    g.name = `root-${name}`;
    scene.add(g);
    return [name, g];
  })));
}

function insetRigOf(look) {
  const inset = look.cameras.inset;
  if (!inset) return null;
  const rig = createCameraRig(look);
  rig.setMode(inset.mode, { instant: true });
  return { rig, rect: inset.rect };
}

// The functions below share one stage context `s` (the stage object itself; s.st holds its private state).
function applyLook(s, next) {
  const { st, rig, scene } = s;
  st.lighting?.group.removeFromParent();
  st.lighting?.dispose();
  st.post?.dispose();
  st.lighting = buildLighting(next, { renderer: rig.renderer });
  st.lighting.apply(scene);
  scene.add(st.lighting.group);
  st.post = buildPost(rig.renderer, next, { scene, camera: s.cams.camera, passes: s.world?.passes ?? {},
    bloom: rig.tier() === "high" });
  for (const name of st.post?.missing ?? []) s.emit("warning", new Error(`No world pass called "${name}".`));
  rig.renderer.setClearColor(next.renderer.clear, next.renderer.clearAlpha);
  rig.setExposure(exposureFor(next, st.ambient));
  st.look = next;
}

function clearProps(s) {
  s.st.props?.remove?.();
  s.st.props?.dispose?.();
  s.st.props = null;
}

/** The world's props (or the plain neutral surroundings); a prop that throws is a warning, never fatal. */
function buildProps(s, frame) {
  clearProps(s);
  const make = typeof s.world?.props === "function" ? s.world.props : neutralProps;
  const ctx = { THREE, coords, field: frame?.field ?? null, teams: frame?.teams ?? null, look: s.st.look,
    kickoff: frame?.game?.kickoff ?? null, light: frame?.game?.light ?? "night", paint: (abbr) => s.kit.paint(abbr),
    ambient: s.st.ambient, requestRender: () => s.rig.requestRender() };
  try {
    const made = make(ctx);
    if (!made?.object) return;
    s.roots.props.add(made.object);
    const remove = typeof made.update === "function" ? s.rig.keepAlive((dt) => made.update(dt) === true) : null;
    s.st.props = { ...made, remove };
  } catch (err) {
    s.emit("warning", err);
  }
}

function drawInset(s) {
  const { rect, rig: inset } = s.st.inset;
  const { width, height } = s.rig.size();
  const [w, h] = [rect[2] * width, rect[3] * height];
  const [x, y] = [rect[0] * width, height - rect[1] * height - h];
  const r = s.rig.renderer;
  r.setScissorTest(true);
  r.setViewport(x, y, w, h);
  r.setScissor(x, y, w, h);
  r.render(s.scene, inset.camera);
  r.setScissorTest(false);
  r.setViewport(0, 0, width, height);
}

function draw(s) {
  s.rig.renderer.render(s.scene, s.cams.camera);
  if (s.st.inset) drawInset(s);
  s.labels.render(s.scene, s.cams.camera);
}

/** A new game frame; resolves when the field's glyphs are in (or after GLYPH_TIMEOUT_MS). */
function setFrame(s, frame) {
  const { st, rig } = s;
  st.frame = frame;
  const { look: next, problem } = lookForGame(st.base, frame?.game);
  if (problem) s.emit("warning", problem);
  if (next !== st.look || !st.lighting) applyLook(s, next);
  s.kit.setTeams(frame?.teams ?? {});
  st.field?.dispose();
  st.field = buildField(st.look, frame, { doc: s.doc, maxAnisotropy: rig.renderer.capabilities.getMaxAnisotropy() });
  s.roots.field.add(st.field.group);
  buildProps(s, frame);
  rig.updateShadows();
  const timeout = new Promise((resolve) => { s.doc.defaultView.setTimeout(resolve, GLYPH_TIMEOUT_MS); });
  return Promise.race([st.field.ready, timeout]).then(() => {
    rig.updateShadows();
    rig.requestRender();
  });
}

/** Apply the canvas size and the safe area (explicit insets from setSafeArea win over --sc-field-safe-*). */
function applyView(s) {
  const size = s.rig.size();
  s.cams.setView({ ...size, insets: s.st.insets ?? readInsets(s.host) });
  const inset = s.st.inset;
  inset?.rig.setView({ width: size.width * inset.rect[2], height: size.height * inset.rect[3] });
  s.labels.setSize(size.width, size.height);
  s.kit.setDpr(s.rig.dpr());
  s.rig.requestRender();
}

function resize(s, width, height) {
  if (!s.rig.setSize(width, height)) return false;
  applyView(s);
  return true;
}

function setSafeArea(s, insets) {
  s.st.insets = insets ? insetsFrom(Object.fromEntries(["top", "right", "bottom", "left"]
    .map((k) => [k, Number.isFinite(insets[k]) ? `${insets[k]}px` : "0px"]))) : null;
  applyView(s);
  return true;
}

function disposeStage(s) {
  clearProps(s);
  s.st.field?.dispose();
  s.st.post?.dispose();
  s.st.lighting?.dispose();
  s.lines.dispose();
  s.labels.dispose();
  for (const root of Object.values(s.roots)) disposeTree(root);
  s.kit.dispose();
  s.cams.dispose();
  s.rig.dispose();
}

function makeStage({ host, canvas, look, world, capture, tier, reducedMotion, emit }) {
  const doc = host.ownerDocument;
  const rig = createRig(canvas, look, { capture, tier, win: doc.defaultView, emit });
  const scene = new THREE.Scene();
  const roots = makeRoots(scene);
  const kit = createKit(look, { dpr: rig.dpr() });
  const st = { look, base: look, frame: null, field: null, props: null, lighting: null, post: null, ambient: "dark",
    reduced: Boolean(reducedMotion), inset: insetRigOf(look), insets: null };
  return {
    THREE, coords, doc, host, canvas, rig, renderer: rig.renderer, scene, roots, kit, world, emit, st,
    cams: createCameraRig(look, { reducedMotion }), labels: createLabels(look.labels, host, { doc }),
    lines: createLines(look, kit), layers: null,
    get look() { return st.look; },
    get frame() { return st.frame; },
    requestRender: (frames) => rig.requestRender(frames),
    keepAlive: (fn) => rig.keepAlive(fn),
    reducedMotion: () => st.reduced,
    visible: () => rig.visible(),
    lights: () => st.lighting?.named ?? {},
  };
}

/**
 * @param {{ host: HTMLElement, canvas: HTMLCanvasElement, look: object, world?: object | null, capture?: boolean,
 *   tier?: "high" | "low", reducedMotion?: boolean, emit: (event: string, payload?: unknown) => void }} opts
 */
export function createStage({ host, canvas, look, world = null, capture = false, tier = "high", reducedMotion = false,
  emit }) {
  const s = makeStage({ host, canvas, look, world, capture, tier, reducedMotion, emit });
  s.roots.situation.add(s.lines.group);
  s.roots.labels.add(s.labels.group);
  const inset = () => s.st.inset?.rig;
  Object.assign(s, {
    draw: () => draw(s),
    setFrame: (frame) => setFrame(s, frame),
    resize: (width, height) => resize(s, width, height),
    setSafeArea: (insets) => setSafeArea(s, insets),
    setAmbient(value) {
      s.st.ambient = value === "room" ? "room" : "dark";
      s.rig.setExposure(exposureFor(s.st.look, s.st.ambient));
    },
    setReducedMotion(on) {
      s.st.reduced = Boolean(on);
      s.cams.setReducedMotion(on);
      inset()?.setReducedMotion(on);
    },
    view(ctx, opts) {
      s.cams.view(ctx, opts);
      inset()?.view(ctx, opts);
    },
    dispose: () => disposeStage(s),
  });
  s.rig.setDraw(() => s.draw());
  s.rig.keepAlive((dt) => s.cams.step(dt));
  s.rig.keepAlive((dt) => s.lines.step(dt));
  if (s.st.inset) s.rig.keepAlive((dt) => s.st.inset.rig.step(dt));
  applyLook(s, look);
  return s;
}

/** The canvas the engine draws in, inside its host (which must be positioned for the label layer). */
export function makeCanvas(doc, host) {
  const canvas = doc.createElement("canvas");
  canvas.setAttribute("data-testid", "field-canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.className = "sc-field-canvas";
  Object.assign(canvas.style, { display: "block", width: "100%", height: "100%" });
  if (doc.defaultView.getComputedStyle(host).position === "static") host.style.position = "relative";
  host.appendChild(canvas);
  return canvas;
}

/** Keep the engine sized, visible and lit with the page: host size, tab visibility, <html data-ambient>. */
export function bindPage({ doc, host }, engine) {
  const win = doc.defaultView;
  const measure = () => engine.resize(host.clientWidth, host.clientHeight || Math.round(host.clientWidth * FALLBACK_ASPECT));
  const ro = typeof win.ResizeObserver === "function" ? new win.ResizeObserver(measure) : null;
  if (ro) ro.observe(host);
  else win.addEventListener("resize", measure);
  const onVisibility = () => engine.setVisible(doc.visibilityState !== "hidden");
  doc.addEventListener("visibilitychange", onVisibility);
  const root = doc.documentElement;
  const onAmbient = () => engine.setAmbient(root.getAttribute("data-ambient"));
  const mo = typeof win.MutationObserver === "function" ? new win.MutationObserver(onAmbient) : null;
  mo?.observe(root, { attributes: true, attributeFilter: ["data-ambient"] });
  measure();
  onAmbient();
  onVisibility();
  return [() => (ro ? ro.disconnect() : win.removeEventListener("resize", measure)),
    () => doc.removeEventListener("visibilitychange", onVisibility), () => mo?.disconnect()];
}
