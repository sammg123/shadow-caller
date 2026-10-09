/**
 * The 2D field engine (ui-architecture.md 2.5 Engine, 6.2 and 16.5; owner A6): the whole Engine interface on one SVG
 * (svg[data-testid="field-svg"]), top-down through coords.toPlane, the caller's end zone on the left. Used when
 * there is no WebGL2, with ?scene=2d, when the WebGL engine fails to start, and when it fails at run time (the
 * conductor swaps this in). It draws the same facts as the 3D field from the same pure geometry, in Sam's grammar
 * (docs/design/play-drawing.md): every play from the line of scrimmage (field/paths.js: a pass an arc, an
 * incompletion an arc and an X, a run a straight line on the turf) with its words on the field, his top 2 plays as
 * dashed, translucent shadow plays before his snap (field/shadows.js), the situation, residue per look, and the
 * active look's colors and styles, so it reads as the same world seen from straight above.
 *
 * DOM side. Animation runs only while a play draws (render on demand: no frames while idle). Every public call is
 * guarded: a failure is reported (opts.onError, else globalThis.reportError) and emitted as "error", and playRow
 * never rejects. Clocks, frames and timers are injectable for node tests and called bare.
 */
import { deepFreeze } from "../core/domain.js";
import { resolveLook } from "../theme/look-schema.js";
import { NEUTRAL_LOOK } from "../theme/neutral-look.js";
import { setAttr } from "../ui/dom.js";
import { r2, layoutPlane, sceneContext } from "./fallback-draw.js";
import { shownLeaves } from "./fallback-ghosts.js";
import { cancelFades } from "./fallback-layers.js";
import { PLAYS_EMPTY } from "./fallback-plays.js";
import { createPlayer } from "./fallback-player.js";
import {
  drawRowsInstant, emit, exitReview, failed, finishNow, highlightGhost, markVerdict, painted, playRow,
  refreshLabels, renderAll, settleStage, showGhosts, showReview, showSituation,
} from "./fallback-runtime.js";
import { createSurface, measureHost, readInsets } from "./fallback-svg.js";

/** The fallback's one camera mode: the whole field from straight above. */
export const CAMERA_MODES = deepFreeze([{ id: "top", label: "Top" }]);
const EVENTS = new Set(["ready", "anim", "camera", "frame", "error", "contextlost", "contextrestored"]);
const READY_FALLBACK_MS = 120;
const SAME_SIZE_PX = 0.5;
let instances = 0;

function envOf(opts) {
  const g = globalThis;
  const report = (err) => (typeof g.reportError === "function" ? g.reportError(err) : undefined);
  return {
    raf: opts.raf ?? ((fn) => g.requestAnimationFrame(fn)),
    cancelRaf: opts.cancelRaf ?? ((id) => g.cancelAnimationFrame(id)),
    now: opts.now ?? (() => g.performance.now()),
    setTimer: opts.setTimeout ?? ((fn, ms) => g.setTimeout(fn, ms)),
    clearTimer: opts.clearTimeout ?? ((id) => g.clearTimeout(id)),
    getStyle: opts.getComputedStyle ?? (typeof g.getComputedStyle === "function" ? (el) => g.getComputedStyle(el) : null),
    Observer: opts.ResizeObserver ?? g.ResizeObserver ?? null,
    dpr: () => (Number.isFinite(g.devicePixelRatio) ? g.devicePixelRatio : 1),
    onError: typeof opts.onError === "function" ? opts.onError : report,
  };
}

function lookOf(look, onError) {
  try {
    return resolveLook(look ?? {});
  } catch (err) {
    onError(err);
    return NEUTRAL_LOOK;
  }
}

/** The look for a game: look.world.day merged over it for a day kickoff (timeline `game.light`), like field/stage.js. */
function lookForGame(base, game, onError) {
  const day = game?.light === "day" ? base.world?.day : null;
  if (!day || typeof day !== "object" || Array.isArray(day)) return base;
  try {
    return resolveLook(day, base);
  } catch (err) {
    onError(err);
    return base;
  }
}

function createState(host, look, opts) {
  const env = envOf(opts);
  const base = lookOf(look, env.onError);
  let readyResolve = () => {};
  const ready = new Promise((resolve) => { readyResolve = resolve; });
  return {
    host, env, ready, readyResolve, ids: `scfb${(instances += 1)}`, baseLook: base, look: base,
    size: measureHost(host), insetsOverride: null, ctx: null, specs: new WeakMap(), surface: null, observer: null,
    frame: { field: null, teams: null, teamOrder: [] }, situation: null, ball: null,
    ghosts: null, pending: undefined, highlight: null,
    plays: PLAYS_EMPTY, drawnSeq: 0, dim: false, review: null, liveJob: null,
    players: { live: createPlayer(), review: createPlayer() },
    reduced: Boolean(opts.reducedMotion), visible: true, isReady: false, readyArmed: false, readyTimer: null,
    frames: 0, rafId: null, listeners: new Map(), disposed: false,
  };
}

function armReady(s) {
  if (s.isReady || s.readyArmed) return;
  s.readyArmed = true;
  const done = () => {
    if (s.isReady || s.disposed) return;
    s.isReady = true;
    if (s.readyTimer !== null) s.env.clearTimer(s.readyTimer);
    s.readyTimer = null;
    s.readyResolve();
    emit(s, "ready", { kind: "2d" });
  };
  s.readyTimer = s.env.setTimer(done, READY_FALLBACK_MS);
  try {
    s.env.raf(() => done());
  } catch (err) {
    s.env.onError(err);   // no frames here: the timer above still settles `ready`
  }
}

// ---------------------------------------------------------------- drawing the state
function relayout(s) {
  const insets = s.insetsOverride ?? readInsets(s.host, s.env.getStyle);
  const layout = layoutPlane({ width: s.size?.width, height: s.size?.height, insets });
  s.ctx = sceneContext({ look: s.look, layout, ...s.frame, ids: s.ids });
  s.specs = new WeakMap();
  const viewBox = `0 0 ${r2(layout.width)} ${r2(layout.height)}`;
  setAttr(s.surface.base, "viewBox", viewBox);
  setAttr(s.surface.svg, "viewBox", viewBox);
  s.surface.svg.style.setProperty("--sc-fb-in", `${s.look.motion.ghostInMs}ms`);
}

// ---------------------------------------------------------------- labels, frame, size, visibility
/** Extension (as in field/scene.js): an optional 4th argument `game`, the timeline's game facts (light, kickoff). */
function setGameFrame(s, field, teams, teamOrder, game = null) {
  settleStage(s, "live", true);
  exitReview(s);
  const obj = (v) => (v && typeof v === "object" ? v : null);
  s.look = lookForGame(s.baseLook, obj(game), s.env.onError);
  s.frame = { field: obj(field), teams: obj(teams), teamOrder: Array.isArray(teamOrder) ? [...teamOrder] : [] };
  Object.assign(s, { plays: PLAYS_EMPTY, drawnSeq: 0, situation: null, ball: null, ghosts: null, pending: undefined,
    dim: false });
  relayout(s);
  renderAll(s);
  painted(s);
  armReady(s);
}

function resize(s, width, height) {
  if (!(width > 0) || !(height > 0)) return;
  const same = s.size && Math.abs(s.size.width - width) < SAME_SIZE_PX && Math.abs(s.size.height - height) < SAME_SIZE_PX;
  if (same) return;
  s.size = { width, height };
  relayout(s);
  renderAll(s);
  painted(s);
}

/** Extension (13.3): HUD insets in px, overriding the --sc-field-safe-* properties; null returns to them. */
function setSafeArea(s, insets) {
  s.insetsOverride = insets && typeof insets === "object" ? { ...insets } : null;
  relayout(s);
  renderAll(s);
  painted(s);
}

function setVisible(s, visible) {
  s.visible = Boolean(visible);
  if (s.visible) return;
  finishNow(s);
  if (s.rafId !== null) s.env.cancelRaf(s.rafId);
  s.rafId = null;
}

function setReducedMotion(s, on) {
  s.reduced = Boolean(on);
  if (s.reduced) finishNow(s);
}

function setCamera(s, id) {
  if (id === CAMERA_MODES[0].id) emit(s, "camera", { id });
}

/** The #field data-ghosts hook: the shadow plays on the field (his top 2, the hovered extra aside), in rank order. */
function visibleGhosts(s) {
  if (s.review) return shownLeaves(s.review.ghosts);
  return shownLeaves(s.ghosts?.input ?? null);
}

function debugState(s) {
  const playing = s.players.live.active();
  return {
    kind: "2d", ready: s.isReady, frames: s.frames,
    animState: s.review ? "reviewing" : playing ? "playing" : "idle", playingSeq: playing?.entry.seq ?? null,
    ghosts: visibleGhosts(s), highlight: s.highlight, camera: CAMERA_MODES[0].id, situation: s.situation,
    drawCalls: 0, triangles: 0, geometries: 0, textures: 0, dpr: s.env.dpr(),
  };
}

function dispose(s) {
  if (s.disposed) return;
  settleStage(s, "live", false);
  s.players.review.finish();
  s.disposed = true;
  if (s.rafId !== null) s.env.cancelRaf(s.rafId);
  if (s.readyTimer !== null) s.env.clearTimer(s.readyTimer);
  cancelFades(s);
  s.observer?.disconnect?.();
  s.surface.base.remove();
  s.surface.svg.remove();
  s.listeners.clear();
}

function on(s, event, fn) {
  if (!EVENTS.has(event) || typeof fn !== "function") return () => {};
  const set = s.listeners.get(event) ?? new Set();
  set.add(fn);
  s.listeners.set(event, set);
  return () => set.delete(fn);
}

function observe(s, guard) {
  if (typeof s.env.Observer !== "function") return;
  try {
    s.observer = new s.env.Observer((entries) => {
      const box = entries?.[0]?.contentRect;
      if (box) guard(resize)(box.width, box.height);
    });
    s.observer.observe(s.host);
  } catch (err) {
    s.env.onError(err);
  }
}

/**
 * @param {HTMLElement} host  the #field host; the engine adds its own SVG and removes it on dispose
 * @param {object} look  the resolved Look (a partial or invalid one is resolved over NEUTRAL_LOOK)
 * @param {{ reducedMotion?: boolean, onError?: Function, raf?: Function, cancelRaf?: Function, now?: Function,
 *   setTimeout?: Function, clearTimeout?: Function, getComputedStyle?: Function, ResizeObserver?: Function }} [opts]
 * @returns {object} an Engine (ui-architecture.md 2.5) with kind "2d", plus setSafeArea(insets)
 */
export function createFallbackEngine(host, look, opts = {}) {
  const s = createState(host, look, opts ?? {});
  s.surface = createSurface(host, host?.ownerDocument ?? globalThis.document);
  const guard = (fn) => (...args) => {
    if (s.disposed) return undefined;
    try {
      return fn(s, ...args);
    } catch (err) {
      failed(s, err);
      return undefined;
    }
  };
  try {
    relayout(s);
    renderAll(s);
  } catch (err) {
    s.surface.base.remove();   // a field that can't draw leaves nothing behind (shell/engine.js shows the notice)
    s.surface.svg.remove();
    throw err;
  }
  observe(s, guard);
  return Object.freeze({
    kind: "2d", ready: s.ready, on: (event, fn) => on(s, event, fn),
    setGameFrame: guard(setGameFrame), showSituation: guard(showSituation), showGhosts: guard(showGhosts),
    clearGhosts: guard((st) => showGhosts(st, null)), highlightGhost: guard(highlightGhost),
    playRow: (row, opts2) => playRow(s, row, opts2), drawRowsInstant: guard(drawRowsInstant),
    finishNow: guard(finishNow), showReview: guard(showReview), refreshLabels: guard(refreshLabels),
    markVerdict: guard(markVerdict), setCamera: guard(setCamera), cameraModes: () => CAMERA_MODES.map((m) => ({ ...m })),
    resize: guard(resize), setVisible: guard(setVisible), setReducedMotion: guard(setReducedMotion),
    setSafeArea: guard(setSafeArea), debugState: () => debugState(s), dispose: () => dispose(s),
  });
}
