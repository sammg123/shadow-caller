// The shadow plays before a caller snap (A5 part 2; docs/design/play-drawing.md 4, binding; ui-architecture 14.4
// `ghosts`, 16.3, 16.5). The top 2 most likely plays of his model (shadows.js buildShadowPlays), in the same shape
// language as real plays and from the line of scrimmage: a pass an arc, a run a flat line, the screen a short arc to the
// flat. They read as shadows: dashed, translucent (50% for #1, 35% for #2), tinted by look.ghost, and they grow out of
// the line of scrimmage over look.motion.ghostInMs. The text sits underneath each one ("1 · Deep shot (20+) · 31%"),
// laid out in the view's own label metrics (play-label.labelMetrics through the camera the rig is settling on) so it
// never covers other text, a stroke or the dimmed previous play's words; it is laid out again when the camera mode,
// the canvas or the safe area changes. Hover or focus on a play in the prediction panel lights its shadow (and draws
// one for a play outside the top 2). At a caller snap they fade (look.ghost.afterSnapOpacity) and their text goes.
// Only the caller's offense gets them: the conductor only sends a call on his drives.
// play-drawing.md 4b (binding): each is a thin dashed line in its rank's colour (shadow-style.js: #1 amber, #2 warm
// white), its plate tagged "NEXT 1 · ..." with a tab in that colour; the previous play turns steel with a "LAST"
// plate (player.js); and on a css2d field every plate is placed in screen space (presnap-words.js): beside its own
// stroke, off the ball, the strokes and each other, a leader line when it had to move.
//   createGhostLayer(stage) -> { show(set), highlight(leaf), fade(k, ms), relayout(), clear(), clarity(), dispose() }
import * as THREE from "three";
import { FIELD, toWorld } from "./coords.js";
import {
  buildArt, fieldLabel, playEnv, removeLabel, setLabelOpacity, setLabelVisible, toggleLabelClass,
} from "./play-art.js";
import { labelMetrics } from "./play-label.js";
import { chipSpot } from "./play-style.js";
import { clarityOf, placePresnap } from "./presnap-words.js";
import { shadowInputOf } from "./shadow-input.js";
import { shadowParts, shadowScale } from "./shadow-style.js";
import { SHADOW_COUNT, buildShadowPlays } from "./shadows.js";
import { poseGap } from "./stage-math.js";
import { EASE } from "./timing.js";

const SAMPLE = "2 · Inside run (A/B gap) · 22%";   // the label model's sample: one shadow line
const PLATE_GAP_PX = 4;                                // between stacked plates (play-label LABEL_PX)
const GONE = 1e-3;
/** The text waits until the camera is this close (yards, or degrees of lens) to the view it is settling on: laid out
 * for that view, it would overlap while the camera is still far from it (after a rebuild it glides in from the whole
 * field). */
const SETTLE = 1.5;

const layerOf = (stage, name) => stage.layers?.[name] ?? null;
/** A shadow's text: its rank, and its family (G3-1: a world tints the dashed edge and the rank as the stroke). */
const classOf = (s) => `sc-shadow-label rank-${s.rank ?? "x"}${s.family ? ` family-${s.family}` : ""}`;

// ---------------------------------------------------------------- the view (label metrics)
function viewKey(stage) {
  const s = stage.rig?.size?.() ?? {};
  const view = stage.cams?.lens?.()?.view;
  const offset = view ? [view.fullWidth, view.fullHeight, view.offsetX, view.offsetY].map(Math.round).join(",") : "";
  return `${stage.cams?.activeMode?.() ?? ""}|${s.width}x${s.height}|${offset}`;
}

/** The camera the rig is settling on (its goal pose), so the text is laid out for the view it will land in. */
function goalCamera(g) {
  const base = g.stage.cams?.camera;
  if (!base?.isCamera) return null;
  g.scratch ??= base.clone();
  const cam = g.scratch.copy(base);
  const pose = g.stage.cams.goalPose?.();
  if (pose?.position && pose?.target && pose?.up) {
    cam.position.set(pose.position.x, pose.position.y, pose.position.z);
    cam.up.set(pose.up.x, pose.up.y, pose.up.z);
    cam.lookAt(pose.target.x, pose.target.y, pose.target.z);
    if (Number.isFinite(pose.fov)) cam.fov = pose.fov;
  }
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  return cam;
}

/** The world's shadow-label plate in px (its CSS), measured once per canvas size: one character, one line, padding. */
function labelPx(g, size) {
  const key = `${size.width}x${size.height}`;
  if (g.px?.key === key) return g.px.value;
  const { doc, host } = g.stage;
  let value = {};
  if (doc?.createElement && host?.appendChild) {
    const outer = doc.createElement("div");
    outer.className = "sc-field-label";
    Object.assign(outer.style, { position: "absolute", left: "0", top: "0", visibility: "hidden" });
    const span = doc.createElement("span");
    span.className = `${g.stage.look.labels.className} sc-shadow-label rank-1`;
    span.textContent = SAMPLE;
    outer.appendChild(span);
    (host.querySelector?.(".sc-field-labels") ?? host).appendChild(outer);
    const box = span.getBoundingClientRect?.();
    const cs = doc.defaultView?.getComputedStyle?.(span);
    const pad = ["paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth"]
      .reduce((sum, k) => sum + (Number.parseFloat(cs?.[k]) || 0), 0);
    if (box?.width > pad && box?.height > 0) {
      value = { charPx: (box.width - pad) / SAMPLE.length, linePx: box.height + PLATE_GAP_PX, padPx: pad };
    }
    outer.remove();
  }
  g.px = { key, value };
  return value;
}

/** The view's label metrics at the line of scrimmage, or undefined (the default cameras) without a real view. */
function viewMetrics(g) {
  if (g.stage.labels?.kind !== "css2d") return undefined;
  const cam = goalCamera(g);
  const size = g.stage.rig?.size?.();
  if (!cam || !(size?.width > 1 && size?.height > 1)) return undefined;
  const v = new THREE.Vector3();
  const project = (p) => {
    const w = toWorld(p.x, p.y, p.h ?? 0);
    v.set(w.x, w.y, w.z).project(cam);
    return { x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height };
  };
  return labelMetrics(project, { x: g.st.input.situation.ballX, y: FIELD.CENTER_Y }, labelPx(g, size));
}

/** The camera has (nearly) landed where the text is laid out for; true for a rig that cannot say. */
function settled(stage) {
  const cams = stage.cams;
  if (typeof cams?.pose !== "function" || typeof cams?.goalPose !== "function") return true;
  return poseGap(cams.pose(), cams.goalPose()) <= SETTLE;
}

// ---------------------------------------------------------------- the shadows
const reviewing = (g) => layerOf(g.stage, "player")?.isLive?.() === false;

/** What the text must not cover: the play on display (or the one under review), its words and its verdict chip. */
function avoidOf(g, metrics) {
  const slot = reviewing(g) ? "review" : "live";
  const drawing = slot === "review" ? layerOf(g.stage, "residue")?.reviewDrawing?.()
    : layerOf(g.stage, "player")?.lastDrawing?.();
  const chip = layerOf(g.stage, "overlays")?.chip?.(slot);
  return [drawing, chip?.label ? { text: chip.text, at: chipSpot(chip.label, metrics) } : null].filter(Boolean);
}

/** A prediction's plate: its tag ("NEXT 1") on a tab, then its words (play-drawing.md 4b). */
const wordsOf = (s) => ({ tag: s.label.tag, body: s.label.body ?? s.label.text });

function placeText(g, item, s) {
  if (!g.stage.look.ghost.labels || !s.label?.at) {
    item.label = removeLabel(g.stage, item.label);
    return;
  }
  const same = item.label?.element && item.text === s.label.text;
  if (same) item.label.move?.({ x: s.label.at.x, y: s.label.at.y, h: 0 });
  else if (item.label?.element) {
    item.label.setWords?.(wordsOf(s), s.label.text);
    item.label.move?.({ x: s.label.at.x, y: s.label.at.y, h: 0 });
  } else {
    removeLabel(g.stage, item.label);
    item.label = fieldLabel(g.stage, s.label.at, s.label.text, classOf(s));
    item.label?.setWords?.(wordsOf(s), s.label.text);
  }
  item.label?.place?.({ dx: 0, dy: 0, leader: null });
  item.text = s.label.text;
  item.label?.element?.setAttribute?.("class", `${g.stage.look.labels.className} ${classOf(s)}`);
}

function applyOpacity(g) {
  const items = [...g.st.items.values()];
  const hovering = items.some((it) => it.shadow.hovered);
  const dim = g.env?.plays.dimOthers ?? 1;
  for (const it of items) {
    const muted = hovering && !it.shadow.hovered;
    it.art.setOpacity(g.st.k * (muted ? dim : 1));
    setLabelOpacity(it.label, g.st.labelK);
    setLabelVisible(it.label, !g.st.waiting);
    toggleLabelClass(it.label, "is-hovered", it.shadow.hovered);
    toggleLabelClass(it.label, "is-muted", muted);
  }
}

const growU = (g) => (g.st.grow ? EASE.outCubic(Math.min(1, g.st.grow.t / g.st.grow.ms)) : 1);

/** The view's width scale for the thin strokes (shadow-style.js: about 2.5 px at 1440x900). */
const scaleOf = (g) => Math.round(shadowScale(g.stage.rig?.size?.()?.height) * 100) / 100;

/** Build what changed: a shadow keeps its meshes while its shape, lane, rank and the view's scale stay; every label
 * is placed again. */
function sync(g, shadows) {
  const env = g.env ?? playEnv(g.stage);
  const scale = scaleOf(g);
  const next = new Map();
  for (const s of shadows) {
    const key = `${s.key}|${s.stack}|${s.lane}|${s.hovered}|${scale}`;
    let item = g.st.items.get(s.leaf);
    if (!item || item.key !== key) {
      item?.art.dispose();
      const art = buildArt(shadowParts(s, g.stage.look, env, { scale }));
      g.root.add(art.group);
      art.revealAll(growU(g));
      item = { key, art, label: item?.label ?? null, text: item?.text ?? null };
    }
    item.shadow = s;
    placeText(g, item, s);
    next.set(s.leaf, item);
  }
  for (const [leaf, item] of g.st.items) {
    if (next.has(leaf)) continue;
    item.art.dispose();
    removeLabel(g.stage, item.label);
  }
  g.st.items = next;
  applyOpacity(g);
}

function layout(g) {
  const { input } = g.st;
  if (!input) return;
  g.env = playEnv(g.stage);
  const metrics = viewMetrics(g);
  let shadows = [];
  try {
    shadows = buildShadowPlays(input.source, input.situation, { hover: g.st.hover, avoid: avoidOf(g, metrics), metrics,
      ...(input.leafNames ? { leafNames: input.leafNames } : {}), ...(input.leafOrder ? { leafOrder: input.leafOrder } : {}) });
  } catch (err) {
    g.stage.emit?.("warning", err);
  }
  g.st.waiting = !settled(g.stage);
  sync(g, shadows);
  g.st.shadows = shadows;
  if (viewKey(g.stage) !== g.st.view) g.st.keep = {};   // another view: its own spots (kept ones only hold one still)
  g.st.layout = g.stage.labels?.kind === "css2d" ? placeWords(g, shadows) : null;
  g.st.view = viewKey(g.stage);
  g.stage.requestRender();
}

/** 4b: every pre-snap plate in screen space; the previous play's LAST plate too while it is the play on display. */
function placeWords(g, shadows) {
  try {
    const review = reviewing(g);
    const last = review ? null : layerOf(g.stage, "player")?.lastPlate?.({ fresh: true }) ?? null;
    const avoid = review ? [layerOf(g.stage, "residue")?.reviewDrawing?.()].filter(Boolean) : [];
    return placePresnap(g, shadows, last, { avoid });
  } catch (err) {
    g.stage.emit?.("warning", err);
    return null;
  }
}

function clearItems(g) {
  for (const item of g.st.items.values()) {
    item.art.dispose();
    removeLabel(g.stage, item.label);
  }
  g.st.items = new Map();
}

/** The caller: a call comes only on his snaps (DC A1 `field`: left_team is always the caller, attacking +x). */
function callerOf(g, set) {
  const field = g.stage.frame?.field;
  return (set?.dir === -1 ? field?.right_team : field?.left_team) ?? null;
}

function show(g, set) {
  const input = shadowInputOf(set, { live: layerOf(g.stage, "overlays")?.current?.() ?? null, poss: callerOf(g, set) });
  if (!input) {
    clear(g);
    return;
  }
  if (g.st.phase === "presnap" && input.key && g.st.input?.key === input.key) return;
  clearItems(g);
  Object.assign(g.st, { input, phase: "presnap", k: 1, labelK: 1, fade: null, keep: {} });
  if (!reviewing(g)) layerOf(g.stage, "player")?.dimLast?.();
  const ms = g.stage.look.motion.ghostInMs;
  g.st.grow = g.stage.reducedMotion() || !(ms > 0) ? null : { t: 0, ms };
  layout(g);
  g.st.view = "";                    // the camera re-aims at this call next: lay the text out again on that frame
}

function endFade(g) {
  const to = g.st.fade?.to ?? g.st.k;
  g.st.fade = null;
  for (const item of g.st.items.values()) item.label = removeLabel(g.stage, item.label);
  if (to <= GONE) clearItems(g);
}

function fade(g, k, ms) {
  if (g.st.phase !== "presnap") return;
  g.st.phase = "snapped";
  const to = Math.min(1, Math.max(0, Number.isFinite(k) ? k : 0));
  g.st.fade = { from: g.st.k, to, t: 0, ms };
  if (g.stage.reducedMotion() || !(ms > 0)) {
    Object.assign(g.st, { k: to, labelK: 0 });
    applyOpacity(g);
    endFade(g);
  }
  g.stage.requestRender();
}

function tick(g, dtMs) {
  const dt = Math.max(0, dtMs);
  let busy = false;
  if (g.st.grow) {
    g.st.grow.t += dt;
    const u = growU(g);
    for (const item of g.st.items.values()) item.art.revealAll(u);
    if (u >= 1) g.st.grow = null;
    else busy = true;
  }
  const f = g.st.fade;
  if (f) {
    f.t += dt;
    const u = Math.min(1, f.t / f.ms);
    Object.assign(g.st, { k: f.from + (f.to - f.from) * EASE.outCubic(u), labelK: 1 - u });
    applyOpacity(g);
    if (u >= 1) endFade(g);
    else busy = true;
  }
  const landed = g.st.waiting && settled(g.stage);
  if (g.st.phase === "presnap" && g.st.input && (landed || viewKey(g.stage) !== g.st.view)) layout(g);
  return busy;
}

function clear(g) {
  clearItems(g);
  Object.assign(g.st, { input: null, phase: "none", grow: null, fade: null, k: 1, labelK: 1, shadows: [],
    layout: null, keep: {} });
  g.stage.requestRender();
}

/** The ghost layer (scene.js LAYER_FACTORIES). */
export function createGhostLayer(stage) {
  const root = new THREE.Group();
  root.name = "shadow-plays";
  stage.roots.ghosts.add(root);
  const g = { stage, root, scratch: null, px: null, env: null,
    st: { input: null, hover: null, phase: "none", items: new Map(), grow: null, fade: null, k: 1, labelK: 1, view: "",
      waiting: false, shadows: [], layout: null, keep: {} } };
  g.goalCamera = () => goalCamera(g);
  const stopTick = stage.keepAlive((dt) => tick(g, dt));
  return {
    show: (set) => show(g, set),
    highlight(leaf) {
      const next = typeof leaf === "string" && leaf ? leaf : null;
      if (next === g.st.hover) return;
      g.st.hover = next;
      if (g.st.phase === "presnap") layout(g);
    },
    fade: (k, ms) => fade(g, k, ms),
    relayout() {
      if (g.st.phase === "presnap") layout(g);
    },
    clear: () => clear(g),
    /** The #field data-ghosts hook, as the 2D field reports it: his top plays drawn, in rank order (a hovered play
     * outside them aside), until the snap; then none. */
    shown: () => (g.st.phase !== "presnap" ? [] : [...g.st.items.values()].map((it) => it.shadow)
      .filter((sp) => !sp.hovered || (sp.rank !== null && sp.rank <= SHADOW_COUNT)).map((sp) => sp.leaf)),
    /** 4b: what the e2e clarity test measures (presnap-words clarityOf), or null without a call up. */
    clarity: () => (g.st.phase === "presnap" ? clarityOf(g, g.st.shadows, g.st.layout,
      reviewing(g) ? null : layerOf(stage, "player")?.lastPlate?.() ?? null) : null),
    dispose() {
      clear(g);
      stopTick?.();
      root.removeFromParent();
    },
  };
}
