// Drive chart (ui-architecture.md 2.6, 5.4; owner A8). Renders drivesVm: one row per drive, oldest first, each a
// bar on the 100-yard scale with the caller's own goal on the left, as on the field (DC A2): where the drive started,
// where it ended (a mark at the end), its team, ESPN's result and its summary. Each drive is a button that shows its
// first drawn play on the field (actions.reviewAt); the drive holding the reviewed play is pressed, and pressing it
// again goes back to live. Bars are SVG geometry with non-scaling strokes, so they stretch with the row.
// G5-9: #rg-drives[data-open="true"] while keyboard focus is inside the chart (a world that shows one drive unrolls
// it then, so Tab walks every drive); Escape rolls it up and keeps focus on the drive it still shows.
import { el, openWhileKeyboardInside, reconcile, setAttr, setData, setHidden, setText, svgEl } from "./dom.js";

const SCALE = 100;                 // field x 0 to 100, goal line to goal line (DC A1)
const TRACK_H = 12;
const BAR_Y = 3;
const BAR_H = 6;
const MIN_BAR = 0.8;               // a 0-yard drive still shows as a sliver
const YARD_STEP = 10;
const MIDFIELD = 50;
const PARTS = new WeakMap();

const browserTimers = Object.freeze({
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id),
});

const round2 = (v) => Math.round(v * 100) / 100;
const finite = (v) => typeof v === "number" && Number.isFinite(v);

function onDrivePress(li, actions) {
  const item = PARTS.get(li)?.item;
  if (!item) return;
  if (item.reviewing) actions.exitReview();
  else if (item.firstSeq !== null) actions.reviewAt(item.firstSeq);
}

function track() {
  const lines = [];
  for (let x = YARD_STEP; x < SCALE; x += YARD_STEP) {
    lines.push(svgEl("line", { class: x === MIDFIELD ? "sc-dc-mid" : "sc-dc-yard", x1: x, x2: x, y1: 0, y2: TRACK_H }));
  }
  const bar = svgEl("rect", { class: "sc-dc-bar", y: BAR_Y, height: BAR_H });
  const end = svgEl("line", { class: "sc-dc-end", y1: 1, y2: TRACK_H - 1 });
  const svg = svgEl("svg", { class: "sc-dc-track", viewBox: `0 0 ${SCALE} ${TRACK_H}`, preserveAspectRatio: "none",
    "aria-hidden": "true", focusable: "false" },
  [svgEl("rect", { class: "sc-dc-field", x: 0, y: 0, width: SCALE, height: TRACK_H }), ...lines, bar, end]);
  return { svg, bar, end };
}

function createDrive(ctx) {
  const team = el("span", { cls: "sc-dc-team" });
  const result = el("span", { cls: "sc-dc-result" });
  const summary = el("span", { cls: "sc-dc-summary" });
  const t = track();
  const btn = el("button", { cls: "sc-dc-btn", attrs: { type: "button" } },
    [el("span", { cls: "sc-dc-label" }, [team, result]), t.svg, summary]);
  const li = el("li", { cls: "sc-dc-item", data: { testid: "drive" } }, [btn]);
  btn.addEventListener("click", () => onDrivePress(li, ctx.actions));
  PARTS.set(li, { team, result, summary, btn, bar: t.bar, end: t.end, item: null });
  return li;
}

/** Bar geometry: x and width on the 0-100 scale, widened to a sliver when the drive covered no ground. */
function barBox(span) {
  if (!span || !finite(span.lo) || !finite(span.hi)) return null;
  const width = span.hi - span.lo;
  if (width >= MIN_BAR) return { x: round2(span.lo), width: round2(width) };
  const x = Math.min(SCALE - MIN_BAR, Math.max(0, span.lo - MIN_BAR / 2));
  return { x: round2(x), width: MIN_BAR };
}

function updateGeometry(p, item) {
  const box = barBox(item.span);
  setAttr(p.bar, "x", box ? box.x : null);
  setAttr(p.bar, "width", box ? box.width : null);
  setAttr(p.bar, "visibility", box ? null : "hidden");
  const endX = finite(item.x1) ? round2(item.x1) : null;
  setAttr(p.end, "x1", endX);
  setAttr(p.end, "x2", endX);
  setAttr(p.end, "visibility", endX === null ? "hidden" : null);
}

function updateDrive(li, item, copy) {
  const p = PARTS.get(li);
  PARTS.set(li, { ...p, item });                // the click handler reads the newest item
  for (const key of ["idx", "team", "caller", "dir", "complete", "current", "reviewing"]) setData(li, key, item[key]);
  setData(li, "result", item.complete ? item.result : null);
  setText(p.team, item.team);
  setText(p.result, item.complete ? item.resultText : copy.now);
  setText(p.summary, item.summary);
  updateGeometry(p, item);
  setAttr(p.btn, "disabled", item.firstSeq === null && !item.reviewing);
  setAttr(p.btn, "aria-pressed", item.reviewing ? "true" : "false");
  setAttr(p.btn, "title", item.reviewing ? copy.reviewing : copy.review);
}

/**
 * @param {HTMLElement} root  #rg-drives
 * @param {{ actions: object, copy: object, timers?: object }} ctx  timers: injected by tests
 * @returns {{ update(vm: object): void, destroy(): void }}
 */
export function mount(root, ctx) {
  const copy = ctx.copy.DRIVES;
  const title = el("h2", { cls: "sc-panel-title", text: copy.heading });
  const empty = el("p", { cls: "sc-dc-empty", text: copy.empty });
  const list = el("ol", { cls: "sc-dc-list", attrs: { "aria-label": copy.heading }, data: { testid: "drive-chart" } });
  const box = el("div", { cls: "sc-drives" }, [title, empty, list]);
  /** The drive a rolled-up chart shows: the current one, else the last (the world's rule, layout.css). */
  const shown = () => {
    const items = [...list.children];
    const at = items.find((li) => li.getAttribute("data-current") === "true") ?? items.at(-1);
    return at?.firstChild ?? null;
  };
  const stopOpen = openWhileKeyboardInside(root, { timers: ctx.timers ?? browserTimers, escapeTo: shown });
  root.appendChild(box);
  return {
    update(vm) {
      setText(title, vm.heading);
      setHidden(empty, vm.drives.length > 0);
      reconcile(list, vm.drives, { key: (d) => d.idx, create: () => createDrive(ctx),
        update: (node, d) => updateDrive(node, d, copy) });
    },
    destroy() {
      stopOpen();
      box.remove();
    },
  };
}
