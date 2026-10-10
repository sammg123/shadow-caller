/**
 * What the 2D engine shows and how it changes (ui-architecture.md 2.5, 3.4 and 16.5; owner A6). DOM side. The engine
 * (fallback-2d.js) owns the state `s` and its lifecycle; this module runs the parts the conductor drives: plays
 * (animated through fallback-player.js on the frame loop, or drawn at once), the situation, the shadow plays before
 * a caller snap (docs/design/play-drawing.md 4: deferred while a play runs, the last call wins; gone when the next
 * play draws, while the previous play stays dimmed until then), review, verdicts and relabels, and the camera: the
 * Drive view (the default) frames the snap with his shadows large enough to read and takes in a play's whole extent
 * while it draws, easing between frames over look.cameras.moveMs; Top shows the whole field.
 * Frames are requested only while something moves; every change counts one painted frame and emits "frame".
 */
import { deepFreeze } from "../core/domain.js";
import { verdictOf } from "../model/verdict.js";
import { setAttr } from "../ui/dom.js";
import { FIELD } from "./coords.js";
import {
  APRON_YD, driveFrame, layoutPlane, lerpBox, r2, sceneContext, strokesBox, unionBox, viewBoxFor,
} from "./fallback-draw.js";
import { shadowInput } from "./fallback-ghosts.js";
import {
  clearStage, labelPxOf, renderField, renderGhosts, renderPlays, renderSituation, viewDrawing,
} from "./fallback-layers.js";
import { foldPlays, restingBall, retireLast } from "./fallback-plays.js";
import { liftOf } from "./fallback-steps.js";
import { readInsets } from "./fallback-svg.js";
import { buildDrawing, situationFromRow } from "./paths.js";
import { LABEL_GAP_YD } from "./grammar.js";
import { buildShadowPlays } from "./shadows.js";
import { EASE, normalDurationMs, planDrawing } from "./timing.js";

const VERDICT_KEYS = new Set(["top1", "top3", "miss", "none"]);
/** The 2D field's cameras, V in this order: the drive around the ball (the default), the whole field from above. */
export const CAMERA_MODES = deepFreeze([{ id: "drive", label: "Drive" }, { id: "top", label: "Top" }]);
/** The whole field with its apron, as a camera box (layoutPlane fits it exactly as it fits no box). */
const WHOLE = deepFreeze({ x0: FIELD.X_MIN - APRON_YD, x1: FIELD.X_MAX + APRON_YD, y0: -APRON_YD,
  y1: FIELD.WIDTH + APRON_YD });

// ---------------------------------------------------------------- events and frames
export function emit(s, event, payload) {
  for (const fn of [...(s.listeners.get(event) ?? [])]) {
    try {
      fn(payload);
    } catch (err) {
      s.env.onError(err);
    }
  }
}

export function failed(s, err) {
  s.env.onError(err);
  emit(s, "error", err);
}

export function painted(s) {
  s.frames += 1;
  emit(s, "frame", { frames: s.frames });
}

export function requestFrame(s) {
  if (s.rafId !== null || s.disposed || !s.visible) return;
  s.rafId = s.env.raf((now) => onFrame(s, now));
}

/** One frame: the camera eases on, every running play advances; a play that reaches its end lands. */
export function onFrame(s, now) {
  s.rafId = null;
  if (s.disposed) return;
  const t = Number.isFinite(now) ? now : s.env.now();
  let running = stepCamera(s, t);
  for (const name of ["live", "review"]) {
    if (!s.players[name].active()) continue;
    if (s.players[name].tick(t)) running = true;
    else settleStage(s, name, true);
  }
  painted(s);
  if (running) requestFrame(s);
}

// ---------------------------------------------------------------- the camera (Drive or Top)
/**
 * The layouts for the camera's box: the whole field, which the static field is drawn in once (fallback-layers
 * renderField; `s.fieldCtx`), and the view the moving layers draw in one unit a pixel (`s.ctx`). The static field
 * shows the view through its viewBox (fallback-draw viewBoxFor), so a camera move never draws it again.
 */
export function relayout(s) {
  const insets = s.insetsOverride ?? readInsets(s.host, s.env.getStyle);
  const size = { width: s.size?.width, height: s.size?.height, insets };
  const top = layoutPlane(size);
  const view = s.cam.box ? layoutPlane({ ...size, frame: s.cam.box }) : top;
  s.fieldCtx = sceneContext({ look: s.look, layout: top, ...s.frame, ids: s.ids });
  s.ctx = view === top ? s.fieldCtx : sceneContext({ look: s.look, layout: view, ...s.frame, ids: s.ids,
    paints: s.fieldCtx.paints });
  s.specs = new WeakMap();
  setAttr(s.surface.base, "viewBox", viewBoxFor(top, view));
  setAttr(s.surface.svg, "viewBox", `0 0 ${r2(view.width)} ${r2(view.height)}`);
  s.surface.svg.style.setProperty("--sc-fb-in", `${s.look.motion.ghostInMs}ms`);
}

/** Steps as the 2D field draws them: an arc bows up the screen by its height times its lift (fallback-steps). */
const strokesOf = (steps) => steps.map((st) => (st.t === "mark" ? { from: st.at, to: st.at }
  : { from: st.from, to: st.to, apex: st.t === "arc" ? (st.apex + st.endH) * liftOf(st) : 0 }));

/** A play as the camera must show it: its strokes and where its words can go (their spot, and a line's worth either
 * side of the end of the play they sit beside: this view lays them out again, paths.placePlayLabel). */
function playStrokes(drawing) {
  const words = drawing.label?.at ? drawing.label : null;
  const end = words?.anchor ?? words?.at;
  const room = words ? [{ from: words.at, to: words.at },
    { from: { x: end.x, y: end.y - LABEL_GAP_YD }, to: { x: end.x, y: end.y + LABEL_GAP_YD } }] : [];
  return [...strokesOf(drawing.steps), ...room];
}

/** A shadow request's strokes, the hovered play's too (their shapes never depend on the view; their words, laid out
 * in it, do). */
function shadowStrokes(input, hover = null) {
  if (!input) return [];
  const shown = buildShadowPlays(input.source, input.situation, { leafNames: input.leafNames ?? undefined,
    leafOrder: input.leafOrder, hover });
  return strokesOf(shown.flatMap((sp) => sp.drawing.steps));
}

/** Where the camera looks now: Top the whole field; the Drive view a review's snap, its shadows and its play; live,
 * the snap and his shadows (a hovered play's too, so a deep shot he hovers is seen whole); while a play draws,
 * whatever it already shows grown to take in the whole play (a play that fits moves nothing); else the field. */
function targetBox(s) {
  if (s.camera === "top") return WHOLE;
  if (s.review) {
    const r = s.review;
    return unionBox(driveFrame(r.sit, shadowStrokes(r.ghosts, s.highlight)), strokesBox(playStrokes(r.entry.drawing)))
      ?? WHOLE;
  }
  const playing = s.players.live.active();
  if (playing) {
    const shown = s.cam.tween?.to ?? s.cam.box ?? driveFrame(s.situation, []);
    return unionBox(shown, strokesBox(playStrokes(playing.entry.drawing))) ?? WHOLE;
  }
  return driveFrame(s.situation, shadowStrokes(s.ghosts?.input ?? null, s.highlight)) ?? WHOLE;
}

const sameBox = (a, b) => Boolean(a && b) && ["x0", "x1", "y0", "y1"].every((k) => Math.abs(a[k] - b[k]) < 1e-6);

/** The moving layers drawn again for a new camera box, patched in place; the static field only re-aimed. */
function reframe(s) {
  relayout(s);
  drawLive(s);
  drawReview(s);
  s.players.live.rebuild(s.ctx, labelPxOf(s));
  s.players.review.rebuild(s.ctx, labelPxOf(s));
}

/** Point the camera where it should look now: an ease over look.cameras.moveMs, or a cut (reduced motion, a hidden
 * page, nothing framed yet, `cut`). */
export function aimCamera(s, { cut = false } = {}) {
  const to = targetBox(s);
  if (sameBox(to, s.cam.tween?.to ?? s.cam.box)) return;
  const ms = s.look.cameras.moveMs;
  if (cut || s.reduced || !s.visible || !(ms > 0) || !s.cam.box) {
    s.cam = { box: to, tween: null };
    reframe(s);
    return;
  }
  s.cam = { box: s.cam.box, tween: { from: s.cam.box, to, ms, start: null } };
  requestFrame(s);
}

/** The camera's ease at frame time `t` (done at once under reduced motion); true while it still moves. */
function stepCamera(s, t) {
  const tw = s.cam.tween;
  if (!tw) return false;
  const start = tw.start ?? t;
  const u = s.reduced ? 1 : Math.min(1, Math.max(0, (t - start) / tw.ms));
  const ease = EASE[s.look.cameras.ease] ?? EASE.inOutCubic;
  s.cam = { box: lerpBox(tw.from, tw.to, ease(u)), tween: u < 1 ? { ...tw, start } : null };
  reframe(s);
  return u < 1;
}

/** A camera move cut short where it was going (the page came back from hidden: no frames ran meanwhile). */
export function settleCamera(s) {
  if (!s.cam.tween) return;
  s.cam = { box: s.cam.tween.to, tween: null };
  reframe(s);
  painted(s);
}

/** V: the Drive view or the whole field (an id the 2D field has; anything else is ignored). */
export function setCamera(s, id) {
  if (!CAMERA_MODES.some((m) => m.id === id)) return;
  s.camera = id;
  emit(s, "camera", { id });
  aimCamera(s);
  painted(s);
}

// ---------------------------------------------------------------- drawing the state
/** What the live shadows' words keep clear of: the previous play, still on the field (dimmed) before the snap, with
 * its words where this view draws them. */
const liveAvoid = (s) => (s.plays.last ? [viewDrawing(s, s.plays.last)] : []);

function drawLiveGhosts(s) {
  renderGhosts(s, s.surface.live, s.ghosts, { avoid: liveAvoid(s) });
}

export function drawLive(s) {
  const stage = s.surface.live;
  const playing = s.players.live.active();
  renderPlays(s, stage, s.plays, { exclude: playing?.entry ?? null, dim: s.dim });
  drawLiveGhosts(s);
  renderSituation(s, stage, s.situation, s.ball, { withBall: !playing });
}

/** A past row replayed: the real play with its words, and the shadows of what he predicted before it. */
export function drawReview(s) {
  const r = s.review;
  if (!r) return;
  const stage = s.surface.review;
  const playing = s.players.review.active();
  renderPlays(s, stage, { last: r.entry, residue: [] }, { exclude: playing?.entry ?? null });
  renderGhosts(s, stage, r.ghosts ? { input: r.ghosts } : null, { avoid: [viewDrawing(s, r.entry)] });
  renderSituation(s, stage, r.sit, null, { withBall: !playing });
}

/** Everything, after a new frame, layout or look: the field, both stages, and any running play rebuilt. */
export function renderAll(s) {
  renderField(s);
  clearStage(s.surface.live);
  clearStage(s.surface.review);
  drawLive(s);
  drawReview(s);
  s.players.live.rebuild(s.ctx, labelPxOf(s));
  s.players.review.rebuild(s.ctx, labelPxOf(s));
}

// ---------------------------------------------------------------- plays
function entryOf(row) {
  if (!row || typeof row !== "object") throw new TypeError("playRow needs a timeline row");
  return Object.freeze({ seq: row.seq, drive: row.drive ?? null, row, drawing: buildDrawing(row), verdict: null });
}

const restOf = (s, entry) => restingBall(entry.drawing, planDrawing(entry.drawing, s.look.motion));
const animates = (s, durationMs, entry) => durationMs > 0 && s.visible && !s.reduced && entry.drawing.steps.length > 0;

function flushPending(s) {
  if (s.pending === undefined) return;
  const set = s.pending;
  s.pending = undefined;
  showGhosts(s, set);
}

/** End a stage's running play: it lands as a finished drawing; the live play's promise settles. */
export function settleStage(s, name, completed) {
  const job = s.players[name].finish();
  if (!job) return;
  if (name === "review") {
    drawReview(s);
    return;
  }
  s.ball = restingBall(job.entry.drawing, job.plan);
  drawLive(s);
  emit(s, "anim", { seq: job.entry.seq, state: "idle" });
  const waiting = s.liveJob;
  s.liveJob = null;
  waiting?.resolve({ seq: job.entry.seq, token: waiting.token, completed });
  flushPending(s);
}

/** A play that draws something: the shadows fade out (play-drawing.md 4) and it becomes the last play, solid. */
function drew(s) {
  s.ghosts = null;
  s.dim = false;
}

/** A row that draws nothing (a timeout) leaves the shadows for the snap still to come, and the previous play dimmed. */
function begin(s, entry) {
  if (entry.drawing.steps.length) drew(s);
  s.plays = foldPlays(s.plays, entry, s.look);
  s.drawnSeq = Math.max(s.drawnSeq, Number.isInteger(entry.seq) ? entry.seq : 0);
}

function startPlay(s, row, opts, resolve) {
  const token = opts?.token ?? 0;
  settleStage(s, "live", true);
  const entry = entryOf(row);
  begin(s, entry);
  if (!animates(s, opts?.durationMs, entry) || s.review) {
    if (entry.drawing.steps.length) s.ball = restOf(s, entry);
    drawLive(s);
    painted(s);
    resolve({ seq: entry.seq, token, completed: true });
    flushPending(s);
    return;
  }
  s.liveJob = { resolve, token };
  s.players.live.start({ entry, ctx: s.ctx, labelPx: labelPxOf(s), stage: s.surface.live, durationMs: opts.durationMs });
  drawLive(s);
  emit(s, "anim", { seq: entry.seq, state: "playing" });
  aimCamera(s);
  requestFrame(s);
}

export function playRow(s, row, opts) {
  const token = opts?.token ?? 0;
  const seq = Number.isInteger(row?.seq) ? row.seq : null;
  if (s.disposed) return Promise.resolve({ seq, token, completed: false });
  return new Promise((resolve) => {
    try {
      startPlay(s, row, opts, resolve);
    } catch (err) {
      failed(s, err);
      resolve({ seq, token, completed: false });
    }
  });
}

export function drawRowsInstant(s, rows) {
  settleStage(s, "live", true);
  let rest = null;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!Number.isInteger(row?.seq) || row.seq <= s.drawnSeq) continue;
    try {
      const entry = entryOf(row);
      s.plays = foldPlays(s.plays, entry, s.look);
      s.drawnSeq = row.seq;
      if (entry.drawing.steps.length) rest = entry;
    } catch (err) {
      s.env.onError(err);
    }
  }
  if (rest) {
    s.ball = restOf(s, rest);
    drew(s);
  }
  drawLive(s);
  painted(s);
}

// ---------------------------------------------------------------- situation, ghosts, review
const validSituation = (sit) => (sit && typeof sit === "object" && Number.isFinite(sit.ballX) ? sit : null);

export function showSituation(s, sit) {
  s.situation = validSituation(sit);
  s.ball = null;
  renderSituation(s, s.surface.live, s.situation, null, { withBall: !s.players.live.active() });
  aimCamera(s);
  painted(s);
}

/**
 * His shadow plays for the next snap (fallback-ghosts shadowInput: a GhostSet from the conductor, ShadowPlays or a
 * { source, situation } request); null clears them. While a play runs the call waits (the last one wins).
 */
export function showGhosts(s, set) {
  if (s.players.live.active()) {
    s.pending = set ?? null;
    return;
  }
  const next = shadowInput(set, s.situation);
  if (next && s.ghosts?.input?.key === next.key) return;
  s.ghosts = next ? { input: next } : null;
  if (next && s.look.lastPlay.keep === "until-presnap") s.plays = retireLast(s.plays, s.look);
  else if (next) s.dim = true;
  drawLive(s);
  aimCamera(s);
  painted(s);
}

export function highlightGhost(s, leaf) {
  s.highlight = typeof leaf === "string" && leaf ? leaf : null;
  if (s.review) drawReview(s);
  else drawLiveGhosts(s);
  aimCamera(s);
  painted(s);
}

export function exitReview(s) {
  if (!s.review) return;
  s.players.review.finish();
  s.review = null;
  clearStage(s.surface.review);
  setAttr(s.surface.review.root, "display", "none");
  setAttr(s.surface.live.root, "display", null);
  emit(s, "anim", { seq: null, state: "idle" });
  aimCamera(s);
  painted(s);
}

export function showReview(s, row, ghosts) {
  if (!row) {
    exitReview(s);
    return;
  }
  settleStage(s, "live", true);
  s.players.review.finish();
  const entry = { ...entryOf(row), verdict: verdictOf(row.pred).key };
  const sit = situationFromRow(row);
  s.review = { entry, sit, ghosts: shadowInput(ghosts, sit) };
  setAttr(s.surface.live.root, "display", "none");
  setAttr(s.surface.review.root, "display", null);
  clearStage(s.surface.review);
  const motion = animates(s, 1, entry);
  if (motion) {
    s.players.review.start({ entry, ctx: s.ctx, labelPx: labelPxOf(s), stage: s.surface.review,
      durationMs: normalDurationMs(entry.drawing, s.look.motion) });
  }
  drawReview(s);
  emit(s, "anim", { seq: entry.seq, state: "reviewing" });
  aimCamera(s);
  painted(s);
  if (motion) requestFrame(s);
}

// ---------------------------------------------------------------- labels
/** The entry for an updated row: a retag renames the play ("Play-action deep pass left · +21"), so its drawing (and
 * so its words) is rebuilt; a row that no longer draws keeps the old drawing and is reported. */
function redrawn(s, entry, row) {
  try {
    return { ...entry, row, drawing: buildDrawing(row) };
  } catch (err) {
    s.env.onError(err);
    return { ...entry, row };
  }
}

export function refreshLabels(s, rows) {
  const bySeq = new Map((Array.isArray(rows) ? rows : []).filter((r) => Number.isInteger(r?.seq)).map((r) => [r.seq, r]));
  if (!bySeq.size) return;
  const swap = (e) => {
    const row = e ? bySeq.get(e.seq) : undefined;
    return row ? { ...redrawn(s, e, row), verdict: e.verdict ? verdictOf(row.pred).key : null } : e;
  };
  s.plays = { last: swap(s.plays.last), residue: s.plays.residue.map(swap) };
  if (s.review && bySeq.has(s.review.entry.seq)) {
    const row = bySeq.get(s.review.entry.seq);
    s.review = { ...s.review, entry: { ...redrawn(s, s.review.entry, row), verdict: verdictOf(row.pred).key } };
  }
  drawLive(s);
  drawReview(s);
  painted(s);
}

export function markVerdict(s, v) {
  const last = s.plays.last;
  if (!last || v?.seq !== last.seq || !VERDICT_KEYS.has(v.key)) return;
  s.plays = { ...s.plays, last: { ...last, verdict: v.key } };
  drawLive(s);
  painted(s);
}

export function finishNow(s) {
  settleStage(s, "live", true);
  settleStage(s, "review", true);
}
