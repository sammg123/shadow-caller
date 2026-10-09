/**
 * SVG plumbing for the 2D field (ui-architecture.md 6.2, owner A6). DOM side: turns the pure node specs of
 * fallback-draw/-ghosts/-plays into SVG elements through ui/dom.js (text only through textContent, attribute writes
 * guarded), sizes the tags' panels to their text, reads the optional safe-area insets, and builds the surface: one
 * <svg data-testid="field-svg"> with the static field layer and two stages (live and review) of identical layers.
 */
import { clear, setAttr, svgEl } from "../ui/dom.js";

/** The live stage, back to front: residue, the lines, the last play, the play drawing now, the ball, the shadow plays
 * (over the ball they come out of before a snap), then every word. */
export const STAGE_LAYERS = Object.freeze(["residue", "lines", "last", "play", "ball", "ghosts", "tags"]);
/** The review stage: the same layers, with what he predicted under the play that happened. */
export const REVIEW_LAYERS = Object.freeze(["residue", "lines", "ghosts", "last", "play", "ball", "tags"]);
/** Tag groups inside a stage's tags layer: the down and distance, the shadow plays' words, the play's words. */
export const TAG_GROUPS = Object.freeze(["tagSit", "tagGhost", "tagPlay"]);
/**
 * Optional custom properties a world sets on #field (or an ancestor), in px ("456px"), so the field clears the HUD
 * that covers its edges. The WebGL engine reads the same names (field/stage.js SAFE_VARS).
 */
export const INSET_PROPS = Object.freeze({ top: "--sc-field-safe-top", right: "--sc-field-safe-right",
  bottom: "--sc-field-safe-bottom", left: "--sc-field-safe-left" });
const TEXT_EM = 0.6;
const FALLBACK_FONT_PX = 14;
const PX_RE = /^\s*(\d+(?:\.\d+)?)px\s*$/;
/** Which tags keep their spot when labels collide: the play's own words, the down and distance, then the shadows'. */
const TAG_PRIORITY = Object.freeze(["tagPlay", "tagSit", "tagGhost"]);
const SPREAD = Object.freeze({ gap: 2, tries: 6 });

/** Entrances (never under reduced motion: the engine adds no class then): words fade in; a shadow play grows out of
 * the line of scrimmage (its transform-origin, set per element), fading up to its own opacity. */
const SHEET = [
  "svg[data-sc-fb] .sc-fb-in { animation: sc-fb-in var(--sc-fb-in, 300ms) ease-out both; }",
  "svg[data-sc-fb] .sc-fb-grow { animation: sc-fb-grow var(--sc-fb-in, 300ms) cubic-bezier(0.2, 0.7, 0.2, 1) both; }",
  "@keyframes sc-fb-in { from { opacity: 0; } }",
  "@keyframes sc-fb-grow { from { opacity: 0; transform: scale(0.15); } }",
].join("\n");

/** Set every attribute of a patch (null removes it). */
export function applyAttrs(el, attrs) {
  for (const [name, value] of Object.entries(attrs ?? {})) setAttr(el, name, value);
}

/** An element from a node spec, children and text included. */
export function buildNode(spec) {
  const el = svgEl(spec.tag, spec.attrs ?? {});
  if (spec.text !== undefined) el.textContent = spec.text;
  for (const child of spec.children ?? []) el.appendChild(buildNode(child));
  return el;
}

/** Replace a layer's children with the built specs. */
export function renderInto(layer, specs) {
  clear(layer);
  for (const spec of specs) layer.appendChild(buildNode(spec));
  return layer;
}

function textBox(text) {
  try {
    const box = text.getBBox();
    if (box && box.width > 0 && box.height > 0) return box;
  } catch {
    // Not rendered (a hidden host, or no layout engine): estimated from the text below.
  }
  const size = Number.parseFloat(text.getAttribute("font-size")) || FALLBACK_FONT_PX;
  const width = (text.textContent ?? "").length * size * TEXT_EM;
  const x = Number(text.getAttribute("x")) || 0;
  const y = Number(text.getAttribute("y")) || 0;
  const anchor = text.getAttribute("text-anchor");
  const left = anchor === "end" ? x - width : anchor === "middle" ? x - width / 2 : x;
  return { x: left, y: y - size / 2, width, height: size };
}

/** Size every tag panel under `root` to its text plus the tag's padding. */
export function fitTags(root) {
  for (const tag of root.querySelectorAll(".sc-fb-tag")) {
    const rect = tag.querySelector("rect");
    const text = tag.querySelector("text");
    if (!rect || !text) continue;
    const box = textBox(text);
    const padX = Number(tag.getAttribute("data-pad-x")) || 0;
    const padY = Number(tag.getAttribute("data-pad-y")) || 0;
    applyAttrs(rect, { x: Math.round(box.x - padX), y: Math.round(box.y - padY),
      width: Math.round(box.width + 2 * padX), height: Math.round(box.height + 2 * padY) });
  }
}

function stage(svg, name, order) {
  const root = svgEl("g", { "data-layer": name });
  const group = (layer) => svgEl("g", { "data-layer": `${name}-${layer}` });
  const layers = Object.fromEntries(order.map((layer) => [layer, group(layer)]));
  for (const layer of order) root.appendChild(layers[layer]);
  const tags = Object.fromEntries(TAG_GROUPS.map((g) => [g, svgEl("g", { "data-layer": `${name}-${g}` })]));
  for (const g of TAG_GROUPS) layers.tags.appendChild(tags[g]);
  svg.appendChild(root);
  return { root, ...layers, ...tags };
}

const FILL_HOST = "position: absolute; inset: 0; width: 100%; height: 100%; display: block; will-change: transform";

function surfaceSvg(attrs) {
  return svgEl("svg", { "aria-hidden": "true", focusable: "false", preserveAspectRatio: "xMidYMid meet",
    style: FILL_HOST, ...attrs });
}

/**
 * The surface in `host`: two stacked SVGs that fill it, each on its own compositor layer (will-change), so a moving
 * ball never repaints the field under it. The static one holds the field layer (redrawn only on a new frame, layout
 * or look); svg[data-testid="field-svg"] on top holds <style> and the live and review stages (review hidden). Both
 * stay out of the accessibility tree: #field carries role="img" and the label.
 */
export function createSurface(host, doc) {
  const base = surfaceSvg({ "data-sc-fb-static": "" });
  const field = svgEl("g", { "data-layer": "field" });
  base.appendChild(field);
  const svg = surfaceSvg({ "data-testid": "field-svg", "data-sc-fb": "" });
  const sheet = svgEl("style", {});
  sheet.textContent = SHEET;
  svg.appendChild(sheet);
  const live = stage(svg, "live", STAGE_LAYERS);
  const review = stage(svg, "review", REVIEW_LAYERS);
  setAttr(review.root, "display", "none");
  const parent = host ?? doc.body;
  parent.appendChild(base);
  parent.appendChild(svg);
  return { base, svg, field, live, review };
}

/** The host's size in CSS pixels, or null when it has none yet. */
export function measureHost(host) {
  try {
    const box = host.getBoundingClientRect();
    if (box && box.width > 0 && box.height > 0) return { width: box.width, height: box.height };
  } catch {
    // A host without layout (detached or a test double): the caller keeps its default size.
  }
  return null;
}

/** The safe-area insets a world declares on the host through INSET_PROPS: "Npx" values only, 0 otherwise. */
export function readInsets(host, getStyle) {
  if (typeof getStyle !== "function") return {};
  try {
    const style = getStyle(host);
    return Object.fromEntries(Object.entries(INSET_PROPS).map(([side, prop]) => {
      const m = PX_RE.exec(String(style.getPropertyValue(prop) ?? ""));
      return [side, m ? Number(m[1]) : 0];
    }));
  } catch {
    return {};
  }
}

const hits = (a, b, gap) => a.x < b.x + b.width + gap && b.x < a.x + a.width + gap
  && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;

/** The x move that keeps a box inside [left, right]: none when it fits, centered when it is wider. */
function slideInto(x, width, left, right) {
  if (width >= right - left) return (left + right) / 2 - (x + width / 2);
  if (x < left) return left - x;
  return x + width > right ? right - (x + width) : 0;
}

/**
 * Pure: moves that keep boxes (in priority order) on screen and apart: each slides inside [left, right] (a long
 * label near an end zone), then tries a vertical move of 0, one step down, one up, two down, and so on, inside
 * [top, bottom]. A box with no free spot is hidden. Returns [{ dx, dy, hidden }].
 */
export function spreadBoxes(boxes, { top = -Infinity, bottom = Infinity, left = -Infinity, right = Infinity,
  gap = SPREAD.gap, tries = SPREAD.tries } = {}) {
  const placed = [];
  return boxes.map((raw) => {
    const dx = Number.isFinite(left) || Number.isFinite(right) ? slideInto(raw.x, raw.width, left, right) : 0;
    const b = { ...raw, x: raw.x + dx };
    const step = b.height + gap;
    const away = (k) => (k % 2 === 0 ? 1 : -1) * step * (Math.floor(k / 2) + 1);
    const options = [0, ...Array.from({ length: tries }, (_, k) => away(k))];
    const fits = (dy) => b.y + dy >= top && b.y + dy + b.height <= bottom
      && placed.every((p) => !hits({ ...b, y: b.y + dy }, p, gap));
    const dy = options.find(fits);
    if (dy === undefined) return { dx: 0, dy: 0, hidden: true };
    placed.push({ ...b, y: b.y + dy });
    return { dx, dy, hidden: false };
  });
}

function boxOfTag(tag) {
  const rect = tag.querySelector("rect");
  const n = (name) => Number(rect?.getAttribute(name)) || 0;
  return { x: n("x"), y: n("y"), width: n("width"), height: n("height") };
}

/** Move a stage's tags on screen and apart (fitTags first); tags fading out don't count. `bounds` is { top, bottom,
 * left?, right? } in px. */
export function declutter(stage, bounds) {
  const tags = TAG_PRIORITY.flatMap((group) => [...stage[group].querySelectorAll(".sc-fb-tag")])
    .filter((tag) => tag.style?.getPropertyValue?.("opacity") !== "0");
  for (const tag of tags) {
    setAttr(tag, "transform", null);
    setAttr(tag, "display", null);
  }
  spreadBoxes(tags.map(boxOfTag), bounds).forEach(({ dx, dy, hidden }, i) => {
    if (hidden) setAttr(tags[i], "display", "none");
    else if (dx || dy) setAttr(tags[i], "transform", `translate(${Math.round(dx)} ${Math.round(dy)})`);
  });
}
