/**
 * Draws the 2D engine's state into its SVG layers (ui-architecture.md 6.2 and 16.5, owner A6). DOM side. The engine
 * (fallback-2d.js) owns the state `s`; these functions read it and write only the layers they are given: the static
 * field, the situation (lines, down and distance, ball), the shadow plays before a caller snap with their words
 * (docs/design/play-drawing.md 4), and the drawn plays (residue, the last play with its words and verdict chip).
 * Lists are keyed (ui/dom.js reconcile), so a shadow or a label that stays keeps its element and fades between
 * opacities instead of popping; a new one grows out of the line of scrimmage (shadows) or fades in (words).
 */
import { clear, reconcile, setAttr, setClass } from "../ui/dom.js";
import { bowlNodes } from "./fallback-bowl.js";
import { TAG_PAD, fieldNodes, situationNodes, tagNode, tagSize } from "./fallback-draw.js";
import { shadowLayer, shadowPlaysFor } from "./fallback-ghosts.js";
import { playNode, playSpec } from "./fallback-plays.js";
import { buildNode, declutter, fitTags, renderInto } from "./fallback-svg.js";

const BALL_PARTS = Object.freeze(["ball", "ball-shadow", "ball-halo"]);
/** The previous play's words while his shadows show: dimmed with it, still readable (4.5:1 on either world's plate). */
const LABEL_DIM = 0.65;
/** Measured on this text: what the shadows' words look like (a rank, a name, a percentage). */
const PROBE_TEXT = "1 · Inside run (A/B gap) · 27%";
const LINE_GAP_PX = 4;
const ids = new WeakMap();
/** A pending fade-out removal per stage. */
const fades = new WeakMap();
let nextId = 0;

/** Keep a stage's labels apart and on screen, inside the area the HUD leaves free. */
function settleTags(s, stage) {
  const { free } = s.ctx.layout;
  declutter(stage, { top: free.y, bottom: free.y + free.h, left: free.x, right: free.x + free.w });
}

/** A stable key per drawn entry (seqs can repeat across a replay; objects never do). */
function idOf(entry) {
  if (!ids.has(entry)) ids.set(entry, (nextId += 1));
  return ids.get(entry);
}

/** The entry's 2D spec for the current layout (cached until the layout or look changes). */
export function specOf(s, entry) {
  if (!s.specs.has(entry)) s.specs.set(entry, playSpec(entry.drawing, entry.row, s.ctx, { verdict: entry.verdict }));
  return s.specs.get(entry);
}

/** The static field: ground, the bowl (night looks), turf, end zones, paint, posts, the light on the turf. */
export function renderField(s) {
  const bowl = bowlNodes(s.ctx);
  renderInto(s.surface.field, fieldNodes(s.ctx, { under: bowl.under, over: bowl.over }));
}

/** Empty every layer of a stage (a new layout rebuilds them). */
export function clearStage(stage) {
  for (const key of ["residue", "ghosts", "lines", "last", "play", "ball", "tagSit", "tagGhost", "tagPlay"]) {
    clear(stage[key]);
  }
}

/** Lines, the down and distance, and (unless a play is moving it) the ball. */
export function renderSituation(s, stage, sit, ball, { withBall = true } = {}) {
  const nodes = situationNodes(sit, s.ctx, { ball });
  const of = (parts) => nodes.filter((n) => parts.includes(n.attrs?.["data-part"]));
  renderInto(stage.lines, of(["los", "ltg"]));
  renderInto(stage.tagSit, of(["down-tag"]));
  fitTags(stage.tagSit);
  settleTags(s, stage);
  if (withBall) renderInto(stage.ball, of(BALL_PARTS));
}

// ---------------------------------------------------------------- keyed lists with fades
function setOpacity(s, el, opacity) {
  const before = Number(el.getAttribute("data-opacity"));
  const ms = Number.isFinite(before) && opacity < before ? s.look.motion.ghostOutMs : s.look.motion.ghostInMs;
  el.style.setProperty("opacity", String(opacity));
  el.style.setProperty("transition", s.reduced ? "none" : `opacity ${ms}ms ease`);
  setAttr(el, "data-opacity", opacity);
}

/** A new element arrives: a shadow grows out of the line of scrimmage (`origin`), words fade in. */
function enter(s, el, item) {
  if (!s.reduced) {
    setClass(el, item.origin ? "sc-fb-grow" : "sc-fb-in", true);
    if (item.origin) {
      el.style.setProperty("transform-box", "view-box");
      el.style.setProperty("transform-origin", `${item.origin.px}px ${item.origin.py}px`);
    }
  }
  if (item.opacity !== undefined) setOpacity(s, el, item.opacity);
  return el;
}

/** New contents for a kept element; its class stays, so a running entrance isn't cut short. */
function refill(el, spec) {
  clear(el);
  for (const child of spec.children ?? []) el.appendChild(buildNode(child));
  for (const [name, value] of Object.entries(spec.attrs ?? {})) if (name !== "class") setAttr(el, name, value);
}

function keyed(s, parent, items) {
  reconcile(parent, items, {
    key: (item) => item.key,
    create: (item) => enter(s, buildNode(item.node), item),
    update: (el, item) => {
      refill(el, item.node);
      if (item.opacity !== undefined) setOpacity(s, el, item.opacity);
    },
  });
}

function cancelFade(s, stage) {
  if (!fades.has(stage)) return;
  s.env.clearTimer(fades.get(stage));
  fades.delete(stage);
}

/** Cancel every pending fade-out (dispose). */
export function cancelFades(s) {
  cancelFade(s, s.surface.live);
  cancelFade(s, s.surface.review);
}

function fadeOut(s, stage) {
  const kids = [...stage.ghosts.childNodes, ...stage.tagGhost.childNodes];
  if (s.reduced || !kids.length) {
    clear(stage.ghosts);
    clear(stage.tagGhost);
    return;
  }
  for (const el of kids) setOpacity(s, el, 0);
  fades.set(stage, s.env.setTimer(() => {
    fades.delete(stage);
    clear(stage.ghosts);
    clear(stage.tagGhost);
  }, s.look.motion.ghostOutMs));
}

// ---------------------------------------------------------------- the shadow plays
/**
 * The size of the shadows' words as this world draws them ({ charPx, linePx, padPx }), measured on a hidden probe,
 * so their layout (shadows.js) keeps text off text in the world's own font; null where nothing is laid out (a hidden
 * host, node tests): the label model's defaults then.
 */
function measureLabelPx(s, stage) {
  const probe = buildNode(tagNode({ at: { px: 0, py: 0 }, text: PROBE_TEXT, size: tagSize(s.ctx, "s"), part: "probe" }));
  setAttr(probe, "visibility", "hidden");
  stage.tagGhost.appendChild(probe);
  try {
    const box = probe.querySelector("text").getBBox();
    if (!(box?.width > 0) || !(box.height > 0)) return null;
    return { charPx: box.width / PROBE_TEXT.length, linePx: box.height + 2 * TAG_PAD.padY + LINE_GAP_PX,
      padPx: 2 * TAG_PAD.padX };
  } catch {
    return null;   // no layout engine here (getBBox missing or the host hidden): the defaults stand
  } finally {
    probe.remove();
  }
}

/**
 * The shadow plays before a caller snap and their words. `ghosts` is { input } (a fallback-ghosts shadow request) or
 * null (they fade out); `avoid` is what the words must keep clear of (the previous play's drawing).
 */
export function renderGhosts(s, stage, ghosts, { avoid = [] } = {}) {
  cancelFade(s, stage);
  if (!ghosts?.input) {
    fadeOut(s, stage);
    return;
  }
  const shadows = shadowPlaysFor(ghosts.input, s.ctx, { hover: s.highlight, avoid,
    labelPx: measureLabelPx(s, stage) });
  const layer = shadowLayer(shadows, s.ctx);
  keyed(s, stage.ghosts, layer.zones);
  keyed(s, stage.tagGhost, layer.labels);
  fitTags(stage.tagGhost);
  settleTags(s, stage);
}

// ---------------------------------------------------------------- plays
/** The last play's words (dimmed while the next call is up, still on the field) and its verdict chip (gone then). */
function playTags(entry, spec, dim) {
  if (!spec?.label) return [];
  const label = { ...spec.label.node, attrs: { ...spec.label.node.attrs, opacity: dim ? LABEL_DIM : 1 } };
  const chip = !dim && spec.verdictNode ? [{ key: `${idOf(entry)}:verdict`, node: spec.verdictNode }] : [];
  return [{ key: `${idOf(entry)}:label`, node: label }, ...chip];
}

/**
 * Residue (look.residue.opacity), the last play (dimmed to look.lastPlay.dimOpacity once the next call is up, its
 * words with it) and its verdict chip, which retires then. `exclude` is the entry a player is animating on this
 * stage, drawn there instead; its words arrive when it lands.
 */
export function renderPlays(s, stage, plays, { exclude = null, dim = false } = {}) {
  const residueOpacity = s.look.residue.opacity;
  reconcile(stage.residue, plays.residue, {
    key: idOf,
    create: (entry) => buildNode(playNode(specOf(s, entry), residueOpacity)),
    update: () => {},
  });
  const animating = (entry) => Boolean(exclude) && (entry === exclude || entry.seq === exclude.seq);
  const last = plays.last && !animating(plays.last) ? plays.last : null;
  const spec = last ? specOf(s, last) : null;
  renderInto(stage.last, spec ? [playNode(spec, dim ? s.look.lastPlay.dimOpacity : 1)] : []);
  keyed(s, stage.tagPlay, last ? playTags(last, spec, dim) : []);
  fitTags(stage.tagPlay);
  settleTags(s, stage);
}
