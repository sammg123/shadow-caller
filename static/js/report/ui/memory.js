// The in-game memory effects that fired (DOM side, text only through ui/dom.js): the summary (tilts that came true,
// when memory switches on), then each snap that tilted or carries memory parts: the tilt as an amber tag, when and
// where, what his habits and the in-game memory did to his pass chance, the parts when the row has them, what he
// called, and whether the tilt came true beside its lamp. Rows are reconciled in place.
import { el, reconcile, setData, setHidden, setText } from "../../ui/dom.js";
import { createBoard } from "./board.js";

const PARTS = new WeakMap();

function labelled(cls) {
  const label = el("span", { cls: "rp-label" });
  const value = el("span", { cls: ["rp-value", "sc-num"] });
  return { node: el("span", { cls }, [label, " ", value]), label, value };
}

function createSummary() {
  const item = labelled("rp-summary-item");
  PARTS.set(item.node, item);
  return item.node;
}

function updateSummary(node, item) {
  const p = PARTS.get(node);
  setData(node, "summary", item.id);
  setText(p.label, item.label);
  setText(p.value, item.value);
}

function createPart() {
  const part = labelled("rp-part");
  PARTS.set(part.node, part);
  return part.node;
}

function updatePart(node, part) {
  const p = PARTS.get(node);
  setText(p.label, part.term);
  setText(p.value, part.pts);
}

function createRow() {
  const p = {
    tilt: el("span", { cls: "rp-tilt" }),
    when: el("span", { cls: "rp-memory-when" }),
    habits: labelled("rp-pull"),
    memory: labelled("rp-pull"),
    parts: el("p", { cls: "rp-parts" }),
    calledLabel: el("span", { cls: "rp-label" }),
    called: el("span", { cls: "rp-memory-name" }),
    side: el("span", { cls: "rp-memory-side" }),
    outcome: el("span", { cls: "rp-outcome" }),
    outcomeLamp: el("span", { cls: ["sc-lamp", "rp-outcome-lamp"], attrs: { "aria-hidden": "true" } }),
  };
  p.calledLine = el("span", { cls: "rp-memory-called" }, [p.calledLabel, " ", p.called, " ", p.side]);
  const li = el("li", { cls: "rp-memory-row" }, [
    el("p", { cls: "rp-memory-head" }, [p.tilt, " ", p.when]),
    el("p", { cls: "rp-pulls" }, [p.habits.node, " ", p.memory.node]),
    p.parts,
    el("p", { cls: "rp-memory-foot" }, [p.calledLine, " ", p.outcomeLamp, p.outcome]),
  ]);
  PARTS.set(li, p);
  return li;
}

function updateRow(li, row, labels) {
  const p = PARTS.get(li);
  setData(li, "seq", row.seq);
  setData(li, "tilt", row.tilt);
  setData(li, "outcome", row.outcome);
  setText(p.tilt, row.flagText);
  setHidden(p.tilt, !row.flagText);
  setText(p.when, row.when);
  setText(p.habits.label, labels.habits);
  setText(p.habits.value, row.habitsText);
  setText(p.memory.label, labels.memory);
  setText(p.memory.value, row.memoryText);
  reconcile(p.parts, row.parts, { key: (_, i) => i, create: createPart, update: updatePart });
  setHidden(p.parts, row.parts.length === 0);
  setText(p.calledLabel, labels.called);
  setText(p.called, row.called);
  setText(p.side, row.calledSideText ? `(${row.calledSideText})` : "");
  setText(p.outcome, row.outcomeText);
  setHidden(p.outcomeLamp, !row.outcomeText);
}

/**
 * @param {HTMLElement} root  #rp-memory
 * @returns {{ update(vm: ReturnType<import("../model/vm-memory.js").memoryVm>): void, destroy(): void }}
 */
export function mount(root) {
  const board = createBoard(root, { testid: "report-memory" });
  const sub = el("p", { cls: "rp-sub" });
  const summary = el("p", { cls: "rp-summary" });
  const empty = el("p", { cls: "rp-empty" });
  const list = el("ol", { cls: "rp-memory" });
  [sub, summary, empty, list].forEach((node) => board.face.appendChild(node));
  return {
    update(vm) {
      board.setPlate(vm.heading);
      setText(sub, vm.sub);
      reconcile(summary, vm.summary, { key: (s) => s.id, create: createSummary, update: updateSummary });
      setText(empty, vm.emptyText);
      setHidden(empty, !vm.empty);
      reconcile(list, vm.rows, { key: (r) => r.key, create: createRow,
        update: (li, r) => updateRow(li, r, vm.labels) });
    },
    destroy() {
      board.destroy();
    },
  };
}
