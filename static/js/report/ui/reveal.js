// Bring one of his calls into view in the calls table (DOM side, through ui/dom.js): the drive chart's buttons and the
// analyst's cites (docs/design/analyst-ui.md 3 and 5) both land here. The call's row scrolls in under its drive's row,
// takes focus (tabindex -1, so a screen reader reads it) and is lit for a moment (.rp-call-row[data-cited="true"]), so
// the eye finds it after the jump; a second reveal moves the light. A play with no row (an opponent's, a kick) lights
// its drive on the drive chart instead (report/model/cite.js). Smooth scrolling only with motion on.
// Hooks a world styles against: .rp-call-row[data-cited="true"], #rp-drives .sc-dc-item[data-cited="true"].
import { setData } from "../../ui/dom.js";

/** How long a revealed row stays lit. */
export const CITED_MS = 2400;

/** The call row of `seq` in the calls table (#rp-calls), or null when that play is not one of the shown calls. */
export function callRow(doc, seq) {
  const table = doc && doc.getElementById("rp-calls");
  if (!table || !Number.isInteger(seq)) return null;
  for (const node of table.querySelectorAll(`[data-seq="${seq}"]`)) {
    if (node.localName === "tr") return node;
  }
  return null;
}

/** The drive chart's item for drive `idx` (#rp-drives .sc-dc-item[data-idx]), or null. */
export function driveItem(doc, idx) {
  const chart = doc && doc.getElementById("rp-drives");
  if (!chart || !Number.isInteger(idx)) return null;
  for (const node of chart.querySelectorAll(`[data-idx="${idx}"]`)) {
    if ((node.getAttribute("class") ?? "").split(/\s+/).includes("sc-dc-item")) return node;
  }
  return null;
}

/** Where to scroll: the drive's row right above the call when it opens that drive, else the call's own row. */
function scrollTarget(row) {
  const siblings = row.parentNode ? [...row.parentNode.children] : [];
  const before = siblings[siblings.indexOf(row) - 1];
  const opensDrive = before && (before.getAttribute("class") ?? "").split(/\s+/).includes("rp-drive-row");
  return opensDrive ? before : row;
}

/**
 * @param {Document} doc
 * @param {{ motion: () => string, timers: { setTimeout: Function, clearTimeout: Function }, holdMs?: number }} opts
 *   motion: the page's motion pref ("reduced" scrolls at once)
 * @returns {{ show(seq: number): boolean, showDrive(idx: number): boolean, destroy(): void }} show: false when the
 *   call is not in the table; showDrive: false when the drive is not on the chart
 */
export function createRevealer(doc, { motion, timers, holdMs = CITED_MS }) {
  let lit = null;                                   // { node, timer }: the node lit now
  const unlight = () => {
    if (!lit) return;
    timers.clearTimeout(lit.timer);
    setData(lit.node, "cited", null);
    lit = null;
  };
  const light = (node, scrollTo, block) => {
    unlight();
    scrollTo.scrollIntoView?.({ block, behavior: motion() === "reduced" ? "auto" : "smooth" });
    setData(node, "cited", true);
    lit = { node, timer: timers.setTimeout(unlight, holdMs) };
  };
  return {
    show(seq) {
      const row = callRow(doc, seq);
      if (!row) return false;
      light(row, scrollTarget(row), "start");
      row.focus({ preventScroll: true });
      return true;
    },
    showDrive(idx) {
      const item = driveItem(doc, idx);
      if (!item) return false;
      light(item, item, "center");
      return true;
    },
    destroy: unlight,
  };
}
