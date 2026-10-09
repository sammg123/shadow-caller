// The live play (A5 part 2; docs/design/play-drawing.md, binding; ui-architecture 14.4 `player`). Every play starts on
// the line of scrimmage: a pass flies a true 3D arc (its tracer grows with the ball, a dashed ground track under it,
// the ball's head and trail on top) to the catch, where a dot lands and the yards after the catch grow along the turf;
// an incompletion's arc ends in an X; a run, a scramble, a sack, a kneel, a return or the penalty walk is a straight
// flat line that grows from where it starts to where it ended, with an arrowhead; kicks fly their true length; a
// no-play draws dimmed and dashed under its flag. When the last step lands, the play's words go up beside its end
// ("Deep pass left · +21"). The play on display stays until the next one draws: dimmed once the next call is up
// (look.lastPlay), then handed to residue.js (look.residue). The facade (scene.js) owns timing and the resting ball.
//   createPlayer(stage) -> { start(drawing, plan, row) -> job, placeAll(items), review(item), relabel(rows),
//     verdict(v), clear(), dispose(), and for the other action layers: lastDrawing(), dimLast(), isLive() }
import {
  buildArt, drawingOrNull, fieldLabel, playEnv, removeLabel, setLabelOpacity, setLabelVisible, toggleLabelClass,
  warmUpPrograms,
} from "./play-art.js";
import { createFlight } from "./play-ball.js";
import { createGlyphs } from "./play-glyphs.js";
import { carriersOf, playParts } from "./play-style.js";
import { EASE } from "./timing.js";

const VERDICTS = new Set(["top1", "top3", "miss"]);
const layerOf = (stage, name) => stage.layers?.[name] ?? null;
const labelClass = (drawing) => `sc-play-label${drawing.label?.approx ? " is-approx" : ""}`;

// The functions below share one player context `p` = { stage, glyphs, flight, st: { last, job, live, dim } }.
function entryOf(p, drawing, row) {
  const art = buildArt(playParts(drawing, row, p.stage.look, playEnv(p.stage)), { glyphs: p.glyphs });
  art.group.visible = p.st.live;
  p.stage.roots.plays.add(art.group);
  return { seq: row?.seq ?? drawing.seq ?? null, row, drawing, drive: row?.drive ?? null, art, label: null,
    dimmed: false };
}

/** Dimmed words: muted ink by CSS (css2d), or the canvas label's own opacity (sprite, decal: no classes to style). */
function dimWords(p, entry) {
  toggleLabelClass(entry.label, "is-dim", entry.dimmed);
  if (entry.label && !entry.label.element) setLabelOpacity(entry.label, entry.dimmed ? p.stage.look.lastPlay.dimOpacity : 1);
}

function showLabel(p, entry) {
  if (entry.label || !p.stage.look.labels.result || !entry.drawing.label) return;
  entry.label = fieldLabel(p.stage, entry.drawing.label.at, entry.drawing.label.text, labelClass(entry.drawing));
  dimWords(p, entry);
  setLabelVisible(entry.label, p.st.live);
}

function drop(p, entry) {
  if (!entry) return;
  entry.label = removeLabel(p.stage, entry.label);
  entry.art.dispose();
  layerOf(p.stage, "overlays")?.clearVerdict?.("live");
}

/** The play on display leaves: to residue per look.residue, relative to the drive now in force. */
function retire(p, drive) {
  const prev = p.st.last;
  p.st.last = null;
  p.st.dim = null;
  if (!prev) return;
  layerOf(p.stage, "residue")?.addMany?.([{ drawing: prev.drawing, row: prev.row }], { drive });
  drop(p, prev);
}

function finishJob(p) {
  p.st.job?.finish();
  p.st.job = null;
}

function makeJob(p, entry, plan) {
  const { drawing } = entry;
  const labelAt = Math.max(0, ...plan.steps.map((s) => s.endMs));
  const job = {
    update(tMs) {
      if (p.st.job !== job) return false;
      const t = Math.min(plan.totalMs, Math.max(0, tMs));
      entry.art.show(plan, t, drawing);
      if (p.st.live) p.flight.update(t);
      if (t >= labelAt) showLabel(p, entry);
      if (tMs < plan.totalMs) return true;
      entry.art.complete();
      p.flight.hide();
      p.st.job = null;
      return false;
    },
    ball: () => (p.st.job === job ? p.flight.current() : null),
    finish: () => { job.update(plan.totalMs); },
    dispose() {
      if (p.st.job !== job) return;
      p.flight.hide();
      p.st.job = null;
    },
  };
  return job;
}

function start(p, drawing, plan, row) {
  finishJob(p);
  retire(p, row?.drive ?? null);
  const entry = entryOf(p, drawing, row);
  p.st.last = entry;
  p.flight.start(drawing, plan, { teams: carriersOf(row ?? {}, drawing), env: playEnv(p.stage) });
  p.stage.lines.setBallVisible(false);
  const job = makeJob(p, entry, plan);
  p.st.job = job;
  job.update(0);
  return job;
}

/** Instant rows (a rebuild, a catch-up, reduced motion): the last one with steps is the play on display. */
function placeAll(p, items) {
  const drawn = (Array.isArray(items) ? items : []).filter((it) => it?.drawing?.steps?.length);
  if (!drawn.length) return;
  finishJob(p);
  p.flight.hide();
  const last = drawn.at(-1);
  const before = [...(p.st.last ? [{ drawing: p.st.last.drawing, row: p.st.last.row }] : []), ...drawn.slice(0, -1)];
  drop(p, p.st.last);
  p.st.last = null;
  p.st.dim = null;
  layerOf(p.stage, "residue")?.addMany?.(before, { drive: last.row?.drive ?? null });
  const entry = entryOf(p, last.drawing, last.row);
  entry.art.complete();
  p.st.last = entry;
  showLabel(p, entry);
  p.stage.requestRender();
}

/** The next call is up (the ghost layer shows it): dim the play on display, or retire it (look.lastPlay). */
function dimLast(p) {
  const entry = p.st.last;
  if (!entry || entry.dimmed || p.st.job) return;
  const look = p.stage.look;
  if (look.lastPlay.keep === "until-presnap") {
    retire(p, entry.drive);
    p.stage.requestRender();
    return;
  }
  entry.dimmed = true;
  dimWords(p, entry);
  const ms = look.motion.ghostInMs;
  if (p.stage.reducedMotion() || !(ms > 0)) entry.art.setOpacity(look.lastPlay.dimOpacity);
  else p.st.dim = { entry, from: entry.art.opacity(), to: look.lastPlay.dimOpacity, t: 0, ms };
  p.stage.requestRender();
}

/** The boot warm-up's meshes leave once a few frames have drawn (compiled) them. */
const WARM_FRAMES = 3;

function tick(p, dtMs) {
  if (p.warm && (p.warm.frames += 1) > WARM_FRAMES) {
    p.warm.dispose();
    p.warm = null;
  }
  const d = p.st.dim;
  if (!d) return false;
  d.t += Math.max(0, dtMs);
  const u = Math.min(1, d.t / d.ms);
  d.entry.art.setOpacity(d.from + (d.to - d.from) * EASE.inOutCubic(u));
  if (u < 1) return true;
  p.st.dim = null;
  return false;
}

function setLive(p, on) {
  p.st.live = on;
  const entry = p.st.last;
  if (entry) {
    entry.art.group.visible = on;
    setLabelVisible(entry.label, on);
  }
  if (!on) p.flight.hide();
  layerOf(p.stage, "overlays")?.setVisible?.("live", on);
}

function relabel(p, rows) {
  const entry = p.st.last;
  const row = entry && (Array.isArray(rows) ? rows : []).find((r) => r?.seq === entry.seq);
  const drawing = row ? drawingOrNull(p.stage, row) : null;
  if (!drawing) return;
  entry.row = row;
  entry.drawing = drawing;
  if (entry.label) {
    entry.label = removeLabel(p.stage, entry.label);
    showLabel(p, entry);
  }
  const overlays = layerOf(p.stage, "overlays");
  if (overlays?.chip?.("live")?.seq === entry.seq) {
    overlays.relabel?.("live", { row, label: drawing.label });
  }
  layerOf(p.stage, "ghosts")?.relayout?.();
}

function verdict(p, v) {
  const entry = p.st.last;
  if (!entry || v?.seq !== entry.seq || !VERDICTS.has(v.key) || !entry.drawing.label) return;
  layerOf(p.stage, "overlays")?.verdict?.({ seq: v.seq, key: v.key, label: entry.drawing.label },
    { slot: "live", visible: p.st.live });
  layerOf(p.stage, "ghosts")?.relayout?.();
  p.stage.requestRender();
}

/** A new game frame (setGameFrame clears every layer, a review included, without a review(null)): live again. */
function clear(p) {
  finishJob(p);
  drop(p, p.st.last);
  p.st.last = null;
  p.st.dim = null;
  p.flight.hide();
  setLive(p, true);
  p.stage.requestRender();
}

/** The player layer (scene.js LAYER_FACTORIES). */
export function createPlayer(stage) {
  const maxAnisotropy = stage.renderer?.capabilities?.getMaxAnisotropy?.() ?? 4;
  const p = { stage, glyphs: createGlyphs({ doc: stage.doc ?? null, maxAnisotropy }), flight: createFlight(stage),
    st: { last: null, job: null, live: true, dim: null }, warm: { ...warmUpPrograms(), frames: 0 } };
  stage.roots.plays.add(p.warm.group);
  const stopTick = stage.keepAlive((dt) => tick(p, dt));
  return {
    start: (drawing, plan, row) => start(p, drawing, plan, row),
    placeAll: (items) => placeAll(p, items),
    review(item) {
      finishJob(p);
      setLive(p, !item);
      layerOf(stage, "residue")?.review?.(item ?? null);
      stage.requestRender();
    },
    relabel: (rows) => relabel(p, rows),
    verdict: (v) => verdict(p, v),
    clear: () => clear(p),
    dispose() {
      clear(p);
      stopTick?.();
      p.warm?.dispose();
      p.warm = null;
      p.flight.dispose();
      p.glyphs.dispose();
    },
    lastDrawing: () => p.st.last?.drawing ?? null,
    dimLast: () => dimLast(p),
    isLive: () => p.st.live,
    glyphs: p.glyphs,
  };
}
