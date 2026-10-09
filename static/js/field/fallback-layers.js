/**
 * Draws the 2D engine's state into its SVG layers (ui-architecture.md 6.2, owner A6). DOM side. The engine
 * (fallback-2d.js) owns the state `s`; these functions read it and write only the layers they are given: the static
 * field, the situation (lines, down and distance, ball), the prediction zones with their fades, and the drawn plays
 * (residue, the last play, its result label and verdict chip). Lists are keyed (ui/dom.js reconcile), so a zone
 * that stays keeps its element and fades between opacities instead of popping.
 */
import { clear, reconcile, setAttr, setClass } from "../ui/dom.js";
import { bowlNodes } from "./fallback-bowl.js";
import { fieldNodes, situationNodes } from "./fallback-draw.js";
import { ghostDefs, ghostLayer } from "./fallback-ghosts.js";
import { playNode, playSpec } from "./fallback-plays.js";
import { buildNode, declutter, fitTags, renderInto } from "./fallback-svg.js";

const BALL_PARTS = Object.freeze(["ball", "ball-shadow", "ball-halo"]);
const ids = new WeakMap();
/** A pending fade-out removal per stage. */
const fades = new WeakMap();
let nextId = 0;

/** Keep a stage's labels apart, inside the area the HUD leaves free. */
function settleTags(s, stage) {
  const { free } = s.ctx.layout;
  declutter(stage, { top: free.y, bottom: free.y + free.h });
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
  renderInto(s.surface.field, fieldNodes(s.ctx, { under: [...ghostDefs(s.ctx), ...bowl.under], over: bowl.over }));
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

// ---------------------------------------------------------------- ghosts
function setOpacity(s, el, opacity) {
  const before = Number(el.getAttribute("data-opacity"));
  const ms = Number.isFinite(before) && opacity < before ? s.look.motion.ghostOutMs : s.look.motion.ghostInMs;
  el.style.setProperty("opacity", String(opacity));
  el.style.setProperty("transition", s.reduced ? "none" : `opacity ${ms}ms ease`);
  setAttr(el, "data-opacity", opacity);
}

function enter(s, el, item, { scan }) {
  if (!s.reduced) {
    setClass(el, "sc-fb-in", true);
    if (scan) setClass(el, "sc-fb-scan", true);
  }
  setOpacity(s, el, item.opacity);
  return el;
}

/** New contents for a kept element; its class stays, so a running fade-in or scan isn't cut short. */
function refill(el, spec) {
  clear(el);
  for (const child of spec.children ?? []) el.appendChild(buildNode(child));
  for (const [name, value] of Object.entries(spec.attrs ?? {})) if (name !== "class") setAttr(el, name, value);
}

function keyed(s, parent, items, { scanTop }) {
  reconcile(parent, items, {
    key: (item) => item.key,
    create: (item) => enter(s, buildNode(item.node), item, { scan: scanTop && item.rank === 1 }),
    update: (el, item) => {
      refill(el, item.node);
      setOpacity(s, el, item.opacity);
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

/** The prediction zones and their labels; `ghosts` is { set, phase } or null (fades out). */
export function renderGhosts(s, stage, ghosts) {
  cancelFade(s, stage);
  if (!ghosts?.set) {
    fadeOut(s, stage);
    return;
  }
  const layer = ghostLayer(ghosts.set, s.ctx, { phase: ghosts.phase, highlight: s.highlight });
  const scanTop = s.look.ghost.style === "pixel";
  keyed(s, stage.ghosts, layer.zones, { scanTop });
  keyed(s, stage.tagGhost, layer.labels, { scanTop: false });
  fitTags(stage.tagGhost);
  settleTags(s, stage);
}

// ---------------------------------------------------------------- plays
/**
 * Residue (look.residue.opacity), the last play (dimmed to look.lastPlay.dimOpacity once the next call is up) and
 * its labels, which retire then: result words are transient, the next call owns the field. `exclude` is the entry a
 * player is animating on this stage, drawn there instead.
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
  renderInto(stage.tagPlay, spec && !dim ? [spec.label?.node, spec.verdictNode].filter(Boolean) : []);
  fitTags(stage.tagPlay);
  settleTags(s, stage);
}
