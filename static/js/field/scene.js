// The WebGL field engine (ui-architecture 2.5 Engine, 5.3 hooks, 6.1 budget; three-recipe; owner A5). The HUD and
// the conductor talk to the field only through this facade; it never computes probabilities, formats copy of its
// own or reads the store. It owns timing (plans from field/timing.js, fitted to the conductor's durationMs),
// tokens, the play promise, ghost deferral while a play runs, review, world moments, events and the #field hooks;
// stage.js builds and draws the scene, and layers.js draws plays, ghosts, overlays and residue.
//
//   createEngine(host, look, { reducedMotion, capture, world, tier, hooks }) -> Promise<Engine>
//   (node tests also pass createStage and layerFactories: a stage without WebGL, and spies for the layers)
//   rejects with EngineInitError when WebGL2 is missing or the renderer can't start (main.js then uses 2D).
// Extras beyond the 2.5 interface: setGameFrame's optional 4th argument `game` (timeline `game`: kickoff, light),
// events "warning" (a non-fatal problem: a world prop or pass failed) and "resize", setAmbient(value) and
// setSafeArea(insets | null). debugState().ready is true once the first frame after the latest setGameFrame is
// drawn (the field host mirrors it into data-scene-ready); hooks: true writes the 5.3 hooks itself (standalone).
import { buildDrawing, situationFromRow } from "./paths.js";
import { fitPlan, planDrawing } from "./timing.js";
import { animStateOf, debugRecord, ghostLeaves, hookValues, hostAttrs, NO_HOOKS } from "./engine-state.js";
import { LAYER_FACTORIES, createLayers } from "./layers.js";
import { createBus, runMoment } from "./moments.js";
import { bindPage, createStage, makeCanvas } from "./stage.js";
import { gpuName, hasWebGL2, isSoftwareGpu } from "./webgl-support.js";

export class EngineInitError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "EngineInitError";
    this.cause = cause;
  }
}

/** G2-9: the first frame's shader compile gets up to 10 s (G7-2 warms every program); past that the field starts. */
const WARM_UP_MS = 10_000;
/** The last few warnings, for debugState (nothing in the page listens before createEngine returns). */
const WARNINGS_KEPT = 5;
const message = (err) => (err && typeof err.message === "string" ? err.message : String(err));

// ---------------------------------------------------------------- hooks and anim state
/** data-ghosts: the shadow plays drawn (v1.4: his top 2, none once the ball is snapped), else the call's leaves. */
const ghostsShown = (c) => c.layers.ghosts.shown?.() ?? ghostLeaves(c.st.ghostSet);
/** v1.4 (W6): the ball in flight (field yards, a copy) or null, for the e2e line-of-scrimmage check. */
const ballOf = (c) => { const b = c.st.playing?.job.ball?.(); return b ? { x: b.x, y: b.y, h: b.h } : null; };

function animState(c) {
  return animStateOf({ rebuilding: c.st.rebuilding, playing: Boolean(c.st.playing), reviewing: c.st.review !== null });
}

/** Standalone use only (opts.hooks): in the app the field host (A9, 12) composes the 5.3 hooks from debugState. */
function writeHooks(c) {
  if (c.st.disposed || !c.hooks) return;
  const attrs = hostAttrs({ ready: c.st.sceneReady, animState: animState(c), playingSeq: c.st.playing?.seq ?? null,
    camera: c.stage.cams.mode(), frames: c.stage.rig.frames(), ghosts: ghostsShown(c),
    highlight: c.st.highlight, reviewSeq: c.st.review, hooks: c.st.hooks });
  for (const [name, value] of Object.entries(attrs)) {
    if (c.st.written[name] === value) continue;
    c.st.written[name] = value;
    if (value === null) c.host.removeAttribute(name);
    else c.host.setAttribute(name, value);
  }
}

function changed(c) {
  const state = animState(c);
  const seq = c.st.playing?.seq ?? null;
  if (state !== c.st.lastAnim.state || seq !== c.st.lastAnim.seq) {
    c.st.lastAnim = { state, seq };
    c.bus.emit("anim", { state, seq });
  }
  writeHooks(c);
}

function moment(c, name, ...args) {
  runMoment({ stage: c.stage, reduced: c.st.reduced, alive: () => !c.st.disposed, warn: (err) => c.bus.emit("warning", err) },
    name, ...args);
}

// ---------------------------------------------------------------- situation and ghosts
/** What the camera frames: the call on the field, plus, while Left or Right replays a row, that whole play (G2-2). */
function viewOf(c, sit) {
  return { situation: sit, ghosts: c.st.ghostSet, reviewDrawing: c.st.review === null ? null : c.st.reviewDrawing };
}

function paintSituation(c, sit) {
  const instant = c.st.reduced || !c.stage.visible();
  c.stage.lines.set(sit, { instant });
  c.layers.overlays.situation?.(sit);
  c.stage.view(viewOf(c, sit), { instant: c.st.reduced });
  c.st.hooks = sit || c.stage.frame ? hookValues(sit, c.stage.frame?.field) : { ...NO_HOOKS, ariaLabel: null };
  const poss = sit?.poss ?? null;
  if (poss && c.st.poss && poss !== c.st.poss) moment(c, "possession", poss);
  if (poss) c.st.poss = poss;
  c.stage.requestRender();
}

function paintGhosts(c, set) {
  c.st.ghostSet = set ?? null;
  if (set) c.layers.ghosts.show(set);
  else c.layers.ghosts.clear();
  if (c.st.highlight) c.layers.ghosts.highlight?.(c.st.highlight);
  const sit = c.st.review === null ? c.st.live.situation : c.st.reviewSituation;
  c.stage.view(viewOf(c, sit), { instant: c.st.reduced });
  c.stage.requestRender();
}

function showGhostsNow(c, set) {
  c.st.live.ghosts = set ?? null;
  if (c.st.review !== null) return;
  paintGhosts(c, set);
  if (set) moment(c, "presnap", set);
  changed(c);
}

// ---------------------------------------------------------------- plays (3.4)
function drawingOf(c, row) {
  try {
    return buildDrawing(row);
  } catch (err) {
    c.bus.emit("warning", err);
    return null;
  }
}

function endPlay(c, completed) {
  const p = c.st.playing;
  if (!p) return;
  c.st.playing = null;
  p.stop?.();
  c.stage.cams.follow(null);
  c.stage.lines.setBallVisible(true);
  c.stage.lines.placeBall(p.drawing.ballEnd?.x ?? null);
  moment(c, "landed", p.row, { completed });          // v1.4 (W1): any animated play is down (ui-architecture 21)
  p.resolve({ seq: p.row.seq, token: p.token, completed });
  if (c.st.deferred !== undefined) {
    const set = c.st.deferred;
    c.st.deferred = undefined;
    showGhostsNow(c, set);
  }
  c.stage.requestRender();
  changed(c);
}

function playStep(c, dtMs) {
  const p = c.st.playing;
  if (!p) return false;
  p.t += dtMs;
  let drawing = false;
  try {
    drawing = p.job.update(Math.min(p.t, p.plan.totalMs)) === true;
    c.stage.cams.follow(p.job.ball?.() ?? null);
  } catch (err) {
    endPlay(c, false);
    c.bus.emit("error", err);
    return false;
  }
  if (p.t < p.plan.totalMs || drawing) return true;
  endPlay(c, true);
  return false;
}

/** Start the player's job now (a throw reaches playRow's catch), then wait for it on the render loop. */
function animate(c, row, drawing, { durationMs, token }) {
  const plan = fitPlan(planDrawing(drawing, c.stage.look.motion), durationMs);
  const job = c.layers.player.start(drawing, plan, row);
  return new Promise((resolve) => {
    c.st.playing = { seq: row.seq, row, drawing, token, job, plan, t: 0, resolve, stop: null };
    if (row.offense_is_caller) {
      c.layers.ghosts.fade?.(c.stage.look.ghost.afterSnapOpacity, c.stage.look.motion.ghostOutMs);
      moment(c, "snap", row);
    }
    moment(c, "play", row, { durationMs: plan.totalMs });   // v1.4 (W1): any animated play starts (ui-architecture 21)
    c.st.playing.stop = c.stage.keepAlive((dt) => playStep(c, dt));
    changed(c);
  });
}

function playRow(c, row, { durationMs = 0, token = null } = {}) {
  if (!row || !Number.isFinite(row.seq) || c.st.disposed) {
    return Promise.resolve({ seq: row?.seq ?? null, token, completed: false });
  }
  finishNow(c);
  const drawing = drawingOf(c, row);
  if (!drawing) return Promise.resolve({ seq: row.seq, token, completed: false });
  if (!(durationMs > 0) || c.st.reduced || !c.stage.visible() || !drawing.steps.length) {
    c.layers.player.placeAll?.([{ row, drawing }]);
    moment(c, "placed", [row]);
    c.stage.requestRender();
    return Promise.resolve({ seq: row.seq, token, completed: true });
  }
  try {
    return animate(c, row, drawing, { durationMs, token });
  } catch (err) {
    c.bus.emit("error", err);
    return Promise.resolve({ seq: row.seq, token, completed: false });
  }
}

function finishNow(c) {
  const p = c.st.playing;
  if (!p) return;
  try {
    p.job.finish();
  } catch (err) {
    c.bus.emit("warning", err);
  }
  endPlay(c, true);
}

// ---------------------------------------------------------------- frame, review
function setGameFrame(c, field, teams, teamOrder, game = null) {
  if (c.st.disposed) return;
  finishNow(c);
  const ok = field && typeof field === "object" && teams && typeof teams === "object";
  const frame = ok ? { field, teams, teamOrder: Array.isArray(teamOrder) ? teamOrder : [], game } : null;
  const token = c.st.frameToken + 1;
  Object.assign(c.st, { frameToken: token, rebuilding: true, sceneReady: false, gate: null, review: null,
    reviewDrawing: null, ghostSet: null, highlight: null, deferred: undefined, poss: null,
    live: { situation: null, ghosts: null } });
  for (const layer of Object.values(c.layers)) layer.clear?.();
  c.stage.setFrame(frame).then(() => {
    if (token !== c.st.frameToken || c.st.disposed) return;
    c.st.gate = frame ? token : null;
    if (!frame) c.st.rebuilding = false;
    c.stage.requestRender();
  }, (err) => c.bus.emit("error", err));
  paintSituation(c, null);
  changed(c);
}

function afterFrame(c) {
  if (c.st.gate !== null && c.st.gate === c.st.frameToken) {
    c.st.gate = null;
    c.st.rebuilding = false;
    c.st.sceneReady = true;
    if (!c.st.ready) {
      c.st.ready = true;
      c.resolveReady();
    }
    c.bus.emit("ready");
  }
  changed(c);
}

/**
 * Before the first game frame: a bare field (neutral end zones), so the canvas is never empty. Not "ready". Resolves
 * once the bare field is built and on (createEngine waits for it, so a game frame set right away, as when a restored
 * field takes over mid-game (G2-4), never replaces a field still being prepared).
 */
function bareField(c) {
  const on = c.stage.setFrame(null).then(() => c.stage.requestRender(), (err) => c.bus.emit("error", err));
  paintSituation(c, null);
  return on;
}

function showReview(c, row, ghosts) {
  if (!row) {
    if (c.st.review === null) return;
    c.st.review = null;
    c.st.reviewDrawing = null;
    c.layers.player.review?.(null);
    paintGhosts(c, c.st.live.ghosts);
    paintSituation(c, c.st.live.situation);
    changed(c);
    return;
  }
  finishNow(c);
  const drawing = drawingOf(c, row);
  c.st.review = row.seq;
  c.st.reviewSituation = situationFromRow(row);
  c.st.reviewDrawing = drawing;
  c.layers.player.review?.(drawing ? { row, drawing } : null);
  paintGhosts(c, ghosts ?? null);
  paintSituation(c, c.st.reviewSituation);
  changed(c);
}

// ---------------------------------------------------------------- the facade
function showSituation(c, sit) {
  c.st.live.situation = sit ?? null;
  if (c.st.review !== null) return;
  paintSituation(c, c.st.live.situation);
  changed(c);
}

function showGhosts(c, set) {
  if (c.st.playing) c.st.deferred = set ?? null;
  else showGhostsNow(c, set);
}

function highlightGhost(c, leaf) {
  c.st.highlight = typeof leaf === "string" && leaf ? leaf : null;
  c.layers.ghosts.highlight?.(c.st.highlight);
  c.stage.requestRender();
  changed(c);
}

/** The field redrawn at once (a rebuild: a jump, a page load): the world's placed moment gets every row on it. */
function drawRowsInstant(c, rows) {
  const list = (Array.isArray(rows) ? rows : []).filter((row) => Number.isFinite(row?.seq));
  const items = list.map((row) => ({ row, drawing: drawingOf(c, row) })).filter((item) => item.drawing);
  c.layers.player.placeAll?.(items);
  moment(c, "placed", list);
  c.stage.requestRender();
}

/**
 * The caller's play is graded: the player puts the chip under the play's words, then (G2-7) the chip takes the
 * conductor's words for what was graded ("In his top 3 · #2 Intermediate · 39%"), and the shadows' words make room.
 */
function markVerdict(c, v) {
  c.layers.player.verdict?.(v);
  if (typeof v?.text === "string" && v.text) {
    c.layers.overlays.retext?.("live", v.seq, v.text);
    c.layers.ghosts.relayout?.();
  }
  moment(c, "verdict", v);
}

function refreshLabels(c, rows) {
  c.layers.player.relabel?.(rows);
  c.layers.residue.relabel?.(rows);
  c.stage.requestRender();
}

function setCamera(c, modeId, instant) {
  if (!c.stage.cams.setMode(modeId, { instant: instant || c.st.reduced })) return;
  c.stage.requestRender();
  c.bus.emit("camera", modeId);
  changed(c);
}

function setReducedMotion(c, on) {
  c.st.reduced = Boolean(on);
  c.stage.setReducedMotion(on);
  if (on) finishNow(c);
}

function debugState(c) {
  const s = c.stage;
  const info = s.rig.info();
  return debugRecord({ ready: c.st.sceneReady, frames: s.rig.frames(), animState: animState(c),
    playingSeq: c.st.playing?.seq ?? null, ghosts: ghostsShown(c), highlight: c.st.highlight,
    camera: s.cams.mode(), situation: c.st.review === null ? c.st.live.situation : c.st.reviewSituation, info,
    dpr: s.rig.dpr(), extra: { tier: c.tier, gpu: c.gpu, ball: ballOf(c), shot: s.cams.activeMode(), pose: s.cams.pose(),
      lens: s.cams.lens(), reviewSeq: c.st.review, running: s.rig.running(), programs: info.programs, cpuMs: info.cpuMs,
      warnings: [...c.st.warnings], clarity: c.layers.ghosts.clarity?.() ?? null } });
}

/** G2-9: a warning is kept (debugState().warnings) as well as emitted, so one raised before anyone listens is seen. */
function keepWarning(c, err) {
  c.st.warnings = [...c.st.warnings, message(err)].slice(-WARNINGS_KEPT);
}

/**
 * G2-4: a lost context is a pause, not a failure. The conductor swaps in the 2D field and disposes this engine, but
 * the canvas keeps one listener for the browser's restore, so "contextrestored" still goes out and a fresh WebGL field
 * takes over. While the engine lives, renderer.js reports the restore itself; the watch then stays quiet.
 */
function watchRestore(c) {
  if (c.st.restoreWatched) return;
  c.st.restoreWatched = true;
  c.canvas.addEventListener("webglcontextrestored", () => {
    c.st.restoreWatched = false;
    if (c.st.disposed) c.bus.emit("contextrestored");
  }, { once: true });
}

function makeEngine(c) {
  const s = c.stage;
  return {
    kind: "webgl",
    ready: c.ready,
    on: (event, fn) => c.bus.on(event, fn),
    setGameFrame: (field, teams, teamOrder, game) => setGameFrame(c, field, teams, teamOrder, game),
    showSituation: (sit) => showSituation(c, sit),
    showGhosts: (set) => showGhosts(c, set),
    clearGhosts: () => showGhosts(c, null),
    highlightGhost: (leaf) => highlightGhost(c, leaf),
    playRow: (row, opts) => playRow(c, row, opts),
    drawRowsInstant: (rows) => drawRowsInstant(c, rows),
    finishNow: () => finishNow(c),
    showReview: (row, ghosts) => showReview(c, row, ghosts),
    refreshLabels: (rows) => refreshLabels(c, rows),
    markVerdict: (v) => markVerdict(c, v),
    setCamera: (modeId, { instant = false } = {}) => setCamera(c, modeId, instant),
    cameraModes: () => s.cams.modes(),
    resize(width, height) { if (s.resize(width, height)) changed(c); },
    setVisible(on) {
      if (!on) finishNow(c);
      s.rig.setVisible(on);
    },
    setReducedMotion: (on) => setReducedMotion(c, on),
    setAmbient: (value) => s.setAmbient(value),
    setSafeArea(insets) { if (s.setSafeArea(insets)) changed(c); },
    debugState: () => debugState(c),
    dispose: () => dispose(c),
  };
}

function dispose(c) {
  if (c.st.disposed) return;
  finishNow(c);
  c.st.disposed = true;
  for (const off of c.unbind) off();
  for (const layer of Object.values(c.layers)) layer.dispose?.();
  c.stage.dispose();
  c.canvas.remove();
  for (const name of Object.keys(c.st.written)) if (name !== "aria-label") c.host.removeAttribute(name);
}

// ---------------------------------------------------------------- creation
/**
 * @param {HTMLElement} host  the #field element (the engine adds its canvas and label layer inside it)
 * @param {object} look  a resolved Look
 * @param {{ reducedMotion?: boolean, capture?: boolean, world?: object | null, tier?: "high" | "low" }} [opts]
 * @returns {Promise<object>} the Engine (ui-architecture 2.5)
 */
export async function createEngine(host, look, opts = {}) {
  const doc = host?.ownerDocument;
  if (!doc?.defaultView || !hasWebGL2(doc)) throw new EngineInitError("This browser has no WebGL2.");
  const gpu = gpuName(doc);
  const tier = opts.tier === "low" || opts.tier === "high" ? opts.tier : isSoftwareGpu(gpu) ? "low" : "high";
  const canvas = makeCanvas(doc, host);
  const bus = createBus();
  const makeStage = typeof opts.createStage === "function" ? opts.createStage : createStage;   // test seam (node)
  let stage;
  try {
    stage = makeStage({ host, canvas, look, world: opts.world ?? null, capture: Boolean(opts.capture), tier,
      reducedMotion: Boolean(opts.reducedMotion), emit: (e, p) => bus.emit(e, p) });
  } catch (err) {
    canvas.remove();
    throw new EngineInitError(`The 3D field couldn't start (${message(err)}).`, err);
  }
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  const st = { ready: false, sceneReady: false, rebuilding: false, frameToken: 0, gate: null, review: null,
    reviewSituation: null, reviewDrawing: null, live: { situation: null, ghosts: null }, ghostSet: null,
    highlight: null, deferred: undefined, playing: null, poss: null, hooks: { ...NO_HOOKS, ariaLabel: null },
    written: {}, lastAnim: { state: null, seq: null }, reduced: Boolean(opts.reducedMotion), disposed: false,
    warnings: [], restoreWatched: false };
  const c = { doc, host, canvas, stage, bus, st, tier, gpu, ready, resolveReady, unbind: [], layers: null,
    hooks: opts.hooks === true };
  c.layers = createLayers(stage, opts.layerFactories ?? LAYER_FACTORIES);
  stage.layers = c.layers;
  bus.on("frame", () => afterFrame(c));
  bus.on("warning", (err) => keepWarning(c, err));
  bus.on("contextlost", () => watchRestore(c));
  const engine = makeEngine(c);
  c.unbind = bindPage(c, engine);
  const bare = bareField(c);
  const warmUp = Promise.resolve().then(() => stage.rig.warmUp(stage.scene, stage.cams.camera));
  await Promise.race([Promise.all([warmUp.catch((err) => bus.emit("warning", err)), bare]),
    new Promise((resolve) => { doc.defaultView.setTimeout(resolve, WARM_UP_MS); })]);
  return engine;
}
