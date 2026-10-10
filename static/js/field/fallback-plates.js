/**
 * The 2D field's tagged plates (docs/design/play-drawing.md 4b, binding; owner A6's field): a prediction's words
 * "NEXT 1 · Inside run (A/B gap) · 21%" with its tag on a tab in the prediction's colour, and the previous play's
 * "LAST · Short pass left · +11" with its verdict on a second line, in the same muted plate. Pure: node specs and the
 * plate's layout math; fallback-words.js measures the words and places the plate in screen space (the group's
 * transform). The plate is drawn around its group's origin, so placing it is one translate.
 *
 *   <g class="sc-fb-tag sc-fb-plate ..." data-plate="next-1">
 *     <line data-role="leader"/> <rect data-role="plate"/> <rect data-role="tab"/>
 *     <text data-role="tab-text">NEXT 1</text> <text data-role="body">...</text> <text data-role="sub">...</text>
 *   </g>
 */
import { r2, node, toneColor } from "./fallback-draw.js";

/** Pixels: the plate's padding, the tab's own padding, the gap after the tab, the gap before a second line. */
export const PLATE = Object.freeze({ padX: 6, padY: 3, tabPadX: 4, gapX: 6, subGap: 2, radius: 2 });

const TEXT_STYLE = "font-family: var(--sc-font-text); font-weight: var(--sc-weight-strong);"
  + " letter-spacing: var(--sc-tracking-label); text-transform: var(--sc-case-label)";

/** The " · " between the parts, for the text and not the eye (the tab and the line break separate them). */
const sep = () => node("text", { "data-role": "sep", x: 0, y: 0, visibility: "hidden", "font-size": 1 }, [], " · ");
const text = (role, words, fill, size) => node("text", { "data-role": role, "text-anchor": "start",
  "dominant-baseline": "central", style: `fill: ${fill}; font-size: var(--sc-size-${size}); ${TEXT_STYLE}` }, [], words);

/**
 * A tagged plate's spec: `tag` on a tab of colour `tab`, `body`, an optional `sub` line; `tone` the body's ink
 * (fallback-draw toneColor), `size` its type size token (s, xs). Built at the origin; fallback-words lays it out.
 */
export function plateNode({ tag = "", body = "", sub = "", tab = "#b9ad92", tone = "ink", size = "s", part,
  cls = "", role = "" }) {
  const kids = [
    node("line", { "data-role": "leader", x1: 0, y1: 0, x2: 0, y2: 0, stroke: tab, "stroke-width": 1,
      "stroke-opacity": 0.85, display: "none" }),
    node("rect", { "data-role": "plate", x: 0, y: 0, width: 0, height: 0, rx: PLATE.radius,
      style: "fill: var(--sc-surface-2); stroke: var(--sc-rule-strong); stroke-width: 1" }),
    ...(tag ? [node("rect", { "data-role": "tab", x: 0, y: 0, width: 0, height: 0, rx: 1, fill: tab }),
      text("tab-text", tag, "var(--sc-surface-2)", size), sep()] : []),
    text("body", body, toneColor(tone), size),
    ...(sub ? [sep(), text("sub", sub, "var(--sc-ink-muted)", "xs")] : []),
  ];
  return node("g", { class: `sc-fb-tag sc-fb-plate ${cls}`.trim(), "data-part": part, "data-plate": role,
    "data-tag": tag }, kids);
}

/**
 * Where each part of a plate goes around its origin, from its words' measured sizes ({ w, h } in px; tab and sub
 * optional): the plate centered on the origin, the tab inside its left end, the body after it, the sub line under.
 * @returns {{ w: number, h: number, plate: object, tab: object | null, tabText: object | null, body: object,
 *   sub: object | null }} rects { x, y, width, height } and text spots { x, y } (y: the line's middle)
 */
export function plateLayout({ tab = null, body, sub = null }) {
  const p = PLATE;
  const line = Math.max(body.h, tab?.h ?? 0);
  const tabW = tab ? tab.w + 2 * p.tabPadX : 0;
  const first = p.padX + (tab ? tabW + p.gapX : 0) + body.w + p.padX;
  const w = Math.max(first, sub ? p.padX + sub.w + p.padX : 0);
  const h = p.padY + line + (sub ? p.subGap + sub.h : 0) + p.padY;
  const [x0, y0] = [-w / 2, -h / 2];
  const mid = y0 + p.padY + line / 2;
  return {
    w: r2(w), h: r2(h),
    plate: { x: r2(x0), y: r2(y0), width: r2(w), height: r2(h) },
    tab: tab ? { x: r2(x0 + 2), y: r2(y0 + 2), width: r2(tabW + p.padX - 2), height: r2(line + 2 * p.padY - 4) } : null,
    tabText: tab ? { x: r2(x0 + p.padX + p.tabPadX - 2), y: r2(mid) } : null,
    body: { x: r2(x0 + p.padX + (tab ? tabW + p.gapX : 0)), y: r2(mid) },
    sub: sub ? { x: r2(x0 + p.padX), y: r2(y0 + p.padY + line + p.subGap + sub.h / 2) } : null,
  };
}
