// His night so far (DOM side, text only through ui/dom.js; restructure-v2.md section 6): the old recap's tally in
// digit windows over their unlit 8s, his last six marks, and the call track: one bar per call, oldest first, a socket
// of 12 cells lit from the bottom to the model's chance on the play he called (--cells), in its verdict's light, a gap
// where his drive changes, the quarter under the bar that starts it, and the number of a surprise over its bar. Each
// bar carries its words as a tooltip and for a screen reader; bars and marks are reconciled in place, so a live game
// only appends.
import { el, reconcile, setAttr, setData, setHidden, setText } from "../../ui/dom.js";
import { createBoard } from "./board.js";

const PARTS = new WeakMap();

/** A CSS custom property on a node's own style, written only when it changes (CSSOM: never a style attribute). */
function setVar(node, name, value) {
  const text = String(value);
  if (node.style.getPropertyValue(name) !== text) node.style.setProperty(name, text);
}

function createTally() {
  const label = el("dt", { cls: "rp-tally-label" });
  const num = el("span", { cls: ["rp-tally-num", "sc-digits", "sc-num"] });
  const of = el("span", { cls: "rp-tally-of" });
  const node = el("div", { cls: "rp-tally-item" }, [label, el("dd", { cls: "rp-tally-value" }, [num, " ", of])]);
  PARTS.set(node, { label, num, of });
  return node;
}

function updateTally(node, item) {
  const p = PARTS.get(node);
  setData(node, "tally", item.id);
  setText(p.label, item.label);
  setText(p.num, item.value);
  setData(p.num, "ghost", item.ghost);
  setText(p.of, item.of);
}

function createMark() {
  const glyph = el("span", { cls: "rp-mark-glyph", attrs: { "aria-hidden": "true" } });
  const words = el("span", { cls: "sr-only" });
  const node = el("li", { cls: "rp-mark" }, [glyph, words]);
  PARTS.set(node, { glyph, words });
  return node;
}

function updateMark(node, item) {
  const p = PARTS.get(node);
  setData(node, "verdict", item.key);
  setText(p.glyph, item.mark);
  setText(p.words, item.text);
}

function createBar() {
  const mark = el("span", { cls: "rp-bar-mark", attrs: { "aria-hidden": "true" } });
  const quarter = el("span", { cls: "rp-bar-q", attrs: { "aria-hidden": "true" } });
  const words = el("span", { cls: "sr-only" });
  const socket = el("span", { cls: "rp-bar-socket", attrs: { "aria-hidden": "true" } },
    [el("span", { cls: "rp-bar-fill" })]);
  const node = el("li", { cls: "rp-bar" }, [mark, socket, quarter, words]);
  PARTS.set(node, { mark, quarter, words });
  return node;
}

function updateBar(node, bar) {
  const p = PARTS.get(node);
  setData(node, "seq", bar.seq);
  setData(node, "verdict", bar.verdict);
  setData(node, "driveStart", bar.driveStart ? true : null);
  setData(node, "surprise", bar.surprise);
  setData(node, "quarter", bar.quarter);
  setVar(node, "--cells", bar.cells);
  setAttr(node, "title", bar.text);
  setText(p.mark, bar.surprise ?? "");
  setText(p.quarter, bar.quarter ?? "");
  setText(p.words, bar.text);
}

function createLegend() {
  const words = el("span", { cls: "rp-legend-text" });
  const node = el("li", {}, [el("span", { cls: "rp-swatch", attrs: { "aria-hidden": "true" } }), words]);
  PARTS.set(node, { words });
  return node;
}

function updateLegend(node, entry) {
  setData(node, "verdict", entry.key);
  setText(PARTS.get(node).words, entry.text);
}

function skeleton(face) {
  const ui = {
    empty: el("p", { cls: "rp-empty" }),
    tally: el("dl", { cls: "rp-tally" }),
    recentLabel: el("p", { cls: "rp-recent-label" }),
    recent: el("ol", { cls: "rp-recent-list" }),
    trackTitle: el("figcaption", { cls: "rp-track-title" }),
    bars: el("ol", { cls: "rp-track-bars" }),
    legend: el("ul", { cls: "rp-legend" }),
    legendNote: el("p", { cls: "rp-legend-note" }),
  };
  const recent = el("div", { cls: "rp-recent" }, [ui.recentLabel, ui.recent]);
  const track = el("figure", { cls: "rp-track" }, [ui.trackTitle, el("div", { cls: "rp-track-scroll" }, [ui.bars]),
    el("div", { cls: "rp-track-key" }, [ui.legend, ui.legendNote])]);
  ui.body = el("div", { cls: "rp-night-body" }, [el("div", { cls: "rp-night-top" }, [ui.tally, recent]), track]);
  face.appendChild(ui.empty);
  face.appendChild(ui.body);
  return ui;
}

/**
 * @param {HTMLElement} root  #rp-night
 * @returns {{ update(vm: ReturnType<import("../model/vm-night.js").nightVm>): void, destroy(): void }}
 */
export function mount(root) {
  const board = createBoard(root, { testid: "report-night" });
  const ui = skeleton(board.face);
  return {
    update(vm) {
      board.setPlate(vm.heading);
      setText(ui.empty, vm.emptyText);
      setHidden(ui.empty, !vm.empty);
      setHidden(ui.body, vm.empty);
      reconcile(ui.tally, vm.tally, { key: (t) => t.id, create: createTally, update: updateTally });
      setText(ui.recentLabel, vm.recent.label);
      reconcile(ui.recent, vm.recent.items, { key: (_, i) => i, create: createMark, update: updateMark });
      setText(ui.trackTitle, vm.track.title);
      setAttr(ui.bars, "aria-label", vm.track.ariaLabel);
      setVar(ui.bars, "--rp-calls", Math.max(1, vm.track.calls.length));
      setVar(ui.bars, "--rp-breaks", vm.track.breaks);
      reconcile(ui.bars, vm.track.calls, { key: (c) => c.key, create: createBar, update: updateBar });
      reconcile(ui.legend, vm.legend, { key: (l) => l.key, create: createLegend, update: updateLegend });
      setText(ui.legendNote, vm.legendNote);
    },
    destroy() {
      board.destroy();
    },
  };
}
