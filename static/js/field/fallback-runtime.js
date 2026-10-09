/**
 * What the 2D engine shows and how it changes (ui-architecture.md 2.5 and 3.4; owner A6). DOM side. The engine
 * (fallback-2d.js) owns the state `s` and its lifecycle; this module runs the parts the conductor drives: plays
 * (animated through fallback-player.js on the frame loop, or drawn at once), the situation, the prediction zones
 * (deferred while a play runs: the last call wins; faint after a caller snap), review, verdicts and relabels.
 * Frames are requested only while something moves; every change counts one painted frame and emits "frame".
 */
import { verdictOf } from "../model/verdict.js";
import { setAttr } from "../ui/dom.js";
import { clearStage, renderField, renderGhosts, renderPlays, renderSituation } from "./fallback-layers.js";
import { foldPlays, restingBall, retireLast } from "./fallback-plays.js";
import { buildDrawing, situationFromRow } from "./paths.js";
import { normalDurationMs, planDrawing } from "./timing.js";

const VERDICT_KEYS = new Set(["top1", "top3", "miss", "none"]);

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

/** One frame: advance every running play; a play that reaches its end lands. */
export function onFrame(s, now) {
  s.rafId = null;
  if (s.disposed) return;
  const t = Number.isFinite(now) ? now : s.env.now();
  let running = false;
  for (const name of ["live", "review"]) {
    if (!s.players[name].active()) continue;
    if (s.players[name].tick(t)) running = true;
    else settleStage(s, name, true);
  }
  painted(s);
  if (running) requestFrame(s);
}

// ---------------------------------------------------------------- drawing the state
export function drawLive(s) {
  const stage = s.surface.live;
  const playing = s.players.live.active();
  renderPlays(s, stage, s.plays, { exclude: playing?.entry ?? null, dim: s.dim });
  renderGhosts(s, stage, s.ghosts);
  renderSituation(s, stage, s.situation, s.ball, { withBall: !playing });
}

export function drawReview(s) {
  const r = s.review;
  if (!r) return;
  const stage = s.surface.review;
  const playing = s.players.review.active();
  renderPlays(s, stage, { last: r.entry, residue: [] }, { exclude: playing?.entry ?? null });
  renderGhosts(s, stage, r.ghosts ? { set: r.ghosts, phase: "presnap" } : null);
  renderSituation(s, stage, r.sit, null, { withBall: !playing });
}

/** Everything, after a new frame, layout or look: the field, both stages, and any running play rebuilt. */
export function renderAll(s) {
  renderField(s);
  clearStage(s.surface.live);
  clearStage(s.surface.review);
  drawLive(s);
  drawReview(s);
  s.players.live.rebuild(s.ctx);
  s.players.review.rebuild(s.ctx);
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

function begin(s, row, entry) {
  if (row.offense_is_caller && s.ghosts?.set) s.ghosts = { ...s.ghosts, phase: "aftersnap" };
  s.plays = foldPlays(s.plays, entry, s.look);
  s.drawnSeq = Math.max(s.drawnSeq, Number.isInteger(entry.seq) ? entry.seq : 0);
  s.dim = false;
}

function startPlay(s, row, opts, resolve) {
  const token = opts?.token ?? 0;
  settleStage(s, "live", true);
  const entry = entryOf(row);
  begin(s, row, entry);
  if (!animates(s, opts?.durationMs, entry) || s.review) {
    if (entry.drawing.steps.length) s.ball = restOf(s, entry);
    drawLive(s);
    painted(s);
    resolve({ seq: entry.seq, token, completed: true });
    flushPending(s);
    return;
  }
  s.liveJob = { resolve, token };
  s.players.live.start({ entry, ctx: s.ctx, stage: s.surface.live, durationMs: opts.durationMs });
  drawLive(s);
  emit(s, "anim", { seq: entry.seq, state: "playing" });
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
  if (rest) s.ball = restOf(s, rest);
  s.dim = false;
  drawLive(s);
  painted(s);
}

// ---------------------------------------------------------------- situation, ghosts, review
const validSituation = (sit) => (sit && typeof sit === "object" && Number.isFinite(sit.ballX) ? sit : null);

export function showSituation(s, sit) {
  s.situation = validSituation(sit);
  s.ball = null;
  renderSituation(s, s.surface.live, s.situation, null, { withBall: !s.players.live.active() });
  painted(s);
}

export function showGhosts(s, set) {
  const next = set && Array.isArray(set.shapes) && set.shapes.length ? set : null;
  if (s.players.live.active()) {
    s.pending = next;
    return;
  }
  if (next && s.ghosts?.set?.key === next.key && s.ghosts.phase === "presnap") return;
  s.ghosts = next ? { set: next, phase: "presnap" } : null;
  if (next && s.look.lastPlay.keep === "until-presnap") s.plays = retireLast(s.plays, s.look);
  else if (next) s.dim = true;
  drawLive(s);
  painted(s);
}

export function highlightGhost(s, leaf) {
  s.highlight = typeof leaf === "string" && leaf ? leaf : null;
  if (s.review) drawReview(s);
  else renderGhosts(s, s.surface.live, s.ghosts);
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
  s.review = { entry, sit: situationFromRow(row), ghosts: Array.isArray(ghosts?.shapes) ? ghosts : null };
  setAttr(s.surface.live.root, "display", "none");
  setAttr(s.surface.review.root, "display", null);
  clearStage(s.surface.review);
  const motion = animates(s, 1, entry);
  if (motion) {
    s.players.review.start({ entry, ctx: s.ctx, stage: s.surface.review,
      durationMs: normalDurationMs(entry.drawing, s.look.motion) });
  }
  drawReview(s);
  emit(s, "anim", { seq: entry.seq, state: "reviewing" });
  painted(s);
  if (motion) requestFrame(s);
}

// ---------------------------------------------------------------- labels
export function refreshLabels(s, rows) {
  const bySeq = new Map((Array.isArray(rows) ? rows : []).filter((r) => Number.isInteger(r?.seq)).map((r) => [r.seq, r]));
  if (!bySeq.size) return;
  const swap = (e) => {
    const row = e ? bySeq.get(e.seq) : undefined;
    return row ? { ...e, row, verdict: e.verdict ? verdictOf(row.pred).key : null } : e;
  };
  s.plays = { last: swap(s.plays.last), residue: s.plays.residue.map(swap) };
  if (s.review && bySeq.has(s.review.entry.seq)) {
    const row = bySeq.get(s.review.entry.seq);
    s.review = { ...s.review, entry: { ...s.review.entry, row, verdict: verdictOf(row.pred).key } };
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
