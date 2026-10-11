// His biggest surprises (DOM side, text only through ui/dom.js): a numbered list, lowest chance first. Each surprise
// carries its number in a digit window (the number its bar wears on the night board's track), when and where it came,
// what he called with the model's chance on it and its rank, and the model's own pick with its chance.
import { el, reconcile, setData, setHidden, setText } from "../../ui/dom.js";
import { createBoard } from "./board.js";

const PARTS = new WeakMap();
const RANK_GHOST = "8";

function line(cls, labelNode, nodes) {
  return el("p", { cls }, [labelNode, " ", ...nodes.flatMap((n, i) => (i ? [" ", n] : [n]))]);
}

function createItem() {
  const p = {
    rank: el("span", { cls: ["rp-rank", "sc-digits", "sc-num"], data: { ghost: RANK_GHOST } }),
    when: el("p", { cls: "rp-surprise-when" }),
    calledLabel: el("span", { cls: "rp-label" }),
    called: el("span", { cls: "rp-surprise-called" }),
    pct: el("span", { cls: ["rp-surprise-pct", "sc-num"] }),
    calledRank: el("span", { cls: "rp-surprise-rank" }),
    pickLabel: el("span", { cls: "rp-label" }),
    pick: el("span", { cls: "rp-surprise-pick" }),
    pickPct: el("span", { cls: ["rp-surprise-pickpct", "sc-num"] }),
  };
  const body = el("div", { cls: "rp-surprise-body" }, [p.when,
    line("rp-surprise-line", p.calledLabel, [p.called, p.pct, p.calledRank]),
    line("rp-surprise-line rp-surprise-model", p.pickLabel, [p.pick, p.pickPct])]);
  const li = el("li", { cls: "rp-surprise" }, [p.rank, body]);
  PARTS.set(li, p);
  return li;
}

function updateItem(li, row, labels) {
  const p = PARTS.get(li);
  setData(li, "seq", row.seq);
  setData(li, "nullified", row.nullified);
  setText(p.rank, String(row.rank));
  setText(p.when, row.when);
  setText(p.calledLabel, labels.called);
  setText(p.called, row.called);
  setText(p.pct, row.calledPct);
  setText(p.calledRank, row.rankText);
  setText(p.pickLabel, labels.modelPick);
  setText(p.pick, row.modelPick);
  setText(p.pickPct, row.modelPct);
}

/**
 * @param {HTMLElement} root  #rp-surprises
 * @returns {{ update(vm: ReturnType<import("../model/vm-surprises.js").surprisesVm>): void, destroy(): void }}
 */
export function mount(root) {
  const board = createBoard(root, { testid: "report-surprises" });
  const sub = el("p", { cls: "rp-sub" });
  const empty = el("p", { cls: "rp-empty" });
  const list = el("ol", { cls: "rp-surprises" });
  [sub, empty, list].forEach((node) => board.face.appendChild(node));
  return {
    update(vm) {
      board.setPlate(vm.heading);
      setText(sub, vm.sub);
      setText(empty, vm.emptyText);
      setHidden(empty, !vm.empty);
      reconcile(list, vm.rows, { key: (r) => r.key, create: createItem,
        update: (li, r) => updateItem(li, r, vm.labels) });
    },
    destroy() {
      board.destroy();
    },
  };
}
