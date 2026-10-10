/**
 * The 2D field's words before a caller snap, placed in screen space (docs/design/play-drawing.md 4b, binding; the
 * same layout as the 3D field, presnap-layout.js): his predictions' plates beside their own strokes, the previous
 * play's LAST plate at its start or along its path, none on the ball, a stroke, the down and distance, the field's
 * legend or another plate, a thin leader when a plate had to move. DOM side: it fits each tagged plate to its measured
 * words (fallback-plates.js layout), then moves it there (its group's transform) and pins its box (data-box) so
 * fallback-svg declutter keeps the other tags clear of it. The last layout's choices are kept while still clear, so
 * the words hold still while the Drive view eases.
 */
import { setAttr } from "../ui/dom.js";
import { FIELD } from "./coords.js";
import { plateLayout } from "./fallback-plates.js";
import { shownHeight } from "./fallback-steps.js";
import { measureText } from "./fallback-svg.js";
import { LAST_ID, nextId, presnapLayout, strokeDots } from "./presnap-layout.js";
import { resolvePlayLook } from "./play-style.js";
import { rankColor } from "./shadow-style.js";

const C = FIELD.CENTER_Y;
/** Half widths (px) of the strokes the words keep clear of: a prediction's thin line, the previous play's. */
const WIDTHS = Object.freeze({ shadow: 1.5, last: 4 });
const EDGE_BOXES = Object.freeze([".sc-field-legend", ".sc-field-key"]);

const sizeOf = (tag, el) => {
  if (!el) return null;
  const m = measureText(tag, el);
  return { w: m.width, h: m.height };
};

function setRect(el, r) {
  if (!el) return;
  for (const k of ["x", "y", "width", "height"]) setAttr(el, k, r ? r[k] : 0);
}

function setSpot(el, p) {
  if (!el || !p) return;
  setAttr(el, "x", p.x);
  setAttr(el, "y", p.y);
}

/** Fit every tagged plate under `root` to its measured words: its rects and texts around the group's origin. */
export function fitPlates(root) {
  for (const tag of root.querySelectorAll(".sc-fb-plate")) {
    const part = (role) => tag.querySelector(`[data-role="${role}"]`);
    const body = sizeOf(tag, part("body"));
    if (!body) continue;
    const box = plateLayout({ tab: sizeOf(tag, part("tab-text")), body, sub: sizeOf(tag, part("sub")) });
    setRect(part("plate"), box.plate);
    setRect(part("tab"), box.tab);
    setSpot(part("tab-text"), box.tabText);
    setSpot(part("body"), box.body);
    setSpot(part("sub"), box.sub);
    setAttr(tag, "data-w", box.w);
    setAttr(tag, "data-h", box.h);
  }
}

/** The 2D view's projection: field yards to its pixels, a height drawn as the step's lift (fallback-steps). */
const projectorOf = (ctx) => (p, step) => {
  const q = ctx.pt(p.x, p.y, step ? shownHeight(step, p.h ?? 0) : (p.h ?? 0));
  return { x: q.px, y: q.py };
};

/** Boxes the plates keep clear of: the down and distance (its tag's rect), the legend and the style key. */
function obstacles(stage, host) {
  const tags = [...stage.tagSit.querySelectorAll(".sc-fb-tag")].map((t) => t.querySelector("rect")).filter(Boolean)
    .map((r) => {
      const [x, y, w, h] = ["x", "y", "width", "height"].map((k) => Number(r.getAttribute(k)) || 0);
      return { x0: x, y0: y, x1: x + w, y1: y + h };
    }).filter((b) => b.x1 > b.x0);
  const origin = host?.getBoundingClientRect?.();
  const edge = origin ? EDGE_BOXES.map((sel) => host.querySelector?.(sel)).filter(Boolean)
    .map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0)
    .map((r) => ({ x0: r.left - origin.left, y0: r.top - origin.top, x1: r.right - origin.left,
      y1: r.bottom - origin.top })) : [];
  return [...tags, ...edge];
}

/** The plates to place: each shadow's (its data-leaf) and the LAST plate, with their fitted sizes. */
function platesOf(stage) {
  const size = (el) => ({ w: Number(el.getAttribute("data-w")) || 0, h: Number(el.getAttribute("data-h")) || 0 });
  const next = [...stage.tagGhost.querySelectorAll("[data-leaf]")]
    .filter((el) => el.hasAttribute("data-plate") && el.style?.getPropertyValue?.("opacity") !== "0");
  const last = stage.tagPlay.querySelector('[data-plate="last"]');
  const els = new Map([...next.map((el) => [nextId(el.getAttribute("data-leaf")), el]),
    ...(last ? [[LAST_ID, last]] : [])]);
  return { els, sizes: Object.fromEntries([...els].map(([id, el]) => [id, size(el)])) };
}

/** Move a plate to its spot: its group's translate, its leader (in the plate's own frame), its pinned box. */
function moveTo(el, l) {
  setAttr(el, "transform", `translate(${Math.round(l.center.x)} ${Math.round(l.center.y)})`);
  setAttr(el, "data-box", [l.box.x0, l.box.y0, l.box.x1, l.box.y1].map(Math.round).join(" "));
  const leader = el.querySelector('[data-role="leader"]');
  if (!leader) return;
  if (!l.leader) {
    setAttr(leader, "display", "none");
    return;
  }
  const [cx, cy] = [Math.round(l.center.x), Math.round(l.center.y)];
  for (const [k, v] of [["x1", l.leader.x1 - cx], ["y1", l.leader.y1 - cy], ["x2", l.leader.x2 - cx],
    ["y2", l.leader.y2 - cy]]) setAttr(leader, k, Math.round(v * 10) / 10);
  setAttr(leader, "display", null);
}

/**
 * Place the stage's pre-snap plates (fitted first) for `shadows` (ShadowPlays as this view lays them out) and the
 * previous play `last` ({ drawing } or null), in the layout `s.ctx`. `avoid`: Drawings whose strokes they keep off
 * (the play a review replays). Returns the layout (kept on the stage for the next call's choices and the hooks).
 */
export function placeWords(s, stage, shadows, { last = null, avoid = [], ballX = null } = {}) {
  fitPlates(stage.tagGhost);
  fitPlates(stage.tagPlay);
  const { els, sizes } = platesOf(stage);
  if (!els.size || !Number.isFinite(ballX)) return null;
  const free = s.ctx.layout.free;
  const layout = presnapLayout({ shadows, last, avoid, ball: { x: ballX, y: C }, project: projectorOf(s.ctx),
    plates: sizes, bounds: { x0: free.x, y0: free.y, x1: free.x + free.w, y1: free.y + free.h },
    boxes: obstacles(stage, s.host), widths: WIDTHS, keep: stage.presnapKeep ?? {}, hold: Boolean(s.cam?.tween) });
  for (const l of layout.labels) {
    const el = els.get(l.id);
    if (el) moveTo(el, l);
  }
  for (const [id, el] of els) {
    if (layout.labels.some((l) => l.id === id)) setAttr(el, "display", null);
    else {
      setAttr(el, "display", "none");          // its play is out of this view: no plate on the field
      setAttr(el, "data-box", "0 0 0 0");
    }
  }
  stage.presnapKeep = Object.fromEntries(layout.labels.map((l) => [l.id, l.choice]));
  stage.presnapView = { project: projectorOf(s.ctx), plays: resolvePlayLook(s.look), last };
  return layout;
}

const round = (v) => Math.round(v * 10) / 10;

/** What a stage shows before a snap (the #field hooks; the e2e clarity test reads them): the ball's footprint on
 * screen, each prediction's stroke in yards, the plates' choices. Null without a layout. */
export function clarityOf(stage) {
  const layout = stage?.presnap;
  const view = stage?.presnapView;
  if (!layout || !view) return null;
  const b = layout.ball;
  const dots = (steps) => strokeDots(steps, view.project).map(([x, y]) => [round(x), round(y)]);
  return {
    ball: b && { x0: round(b.x0), y0: round(b.y0), x1: round(b.x1), y1: round(b.y1) },
    shadows: (stage.shadows ?? []).map((sp) => ({ leaf: sp.leaf, rank: sp.rank, lane: sp.lane, hovered: sp.hovered,
      stroke: sp.drawing.steps[0], color: rankColor(sp.rank, view.plays), dashed: true, px: dots(sp.drawing.steps) })),
    last: view.last?.drawing ? { seq: view.last.drawing.seq, color: view.plays.last.core, dashed: false, tag: "LAST",
      px: dots(view.last.drawing.steps) } : null,
    plates: layout.labels.map((l) => ({ id: l.id, kind: l.kind, clear: l.clear, leader: Boolean(l.leader),
      choice: l.choice })),
  };
}
