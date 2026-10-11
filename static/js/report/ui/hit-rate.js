// Hit rate by down and distance (DOM side, text only through ui/dom.js): a table, a row per bucket (1st; 2nd and 3rd
// short, medium, long; 4th) and the total under them. The Calls cell shows the bucket's calls as LED cells (top picks,
// then the rest of his top 3, then misses) beside the count; his top 3 and the league's each carry a lamp, lit on the
// side that leads, with the leader said in words for a screen reader. Rows are reconciled in place.
import { el, reconcile, setAttr, setData, setHidden, setText } from "../../ui/dom.js";
import { createBoard } from "./board.js";

const PARTS = new WeakMap();
const lamp = () => el("span", { cls: ["sc-lamp", "rp-lamp"], attrs: { "aria-hidden": "true" } });

function numberCell({ cells = false, lit = false } = {}) {
  const n = el("span", { cls: ["rp-n", "sc-num"] });
  const strip = cells ? el("span", { cls: "rp-cells", attrs: { role: "img" } }) : null;
  const light = lit ? lamp() : null;
  return { td: el("td", { data: { num: true } }, [strip, n, light]), n, strip, light };
}

function createCell() {
  return el("span", { cls: "rp-cell" });
}

function updateCell(node, verdict) {
  setData(node, "verdict", verdict);
}

function createRow(kind) {
  const label = el("span", { cls: "rp-hits-label" });
  const hint = el("span", { cls: "rp-hits-hint" });
  const lead = el("span", { cls: ["rp-lead", "sr-only"] });
  const th = el("th", { attrs: { scope: "row" } }, [label, " ", hint, " ", lead]);
  const calls = numberCell({ cells: kind === "row" });
  const top1 = numberCell();
  const top3 = numberCell({ lit: true });
  const league3 = numberCell({ lit: true });
  const tr = el("tr", { cls: kind === "row" ? "rp-hits-row" : "rp-hits-total" },
    [th, calls.td, top1.td, top3.td, league3.td]);
  PARTS.set(tr, { label, hint, lead, calls, top1, top3, league3 });
  return tr;
}

function updateRow(tr, row) {
  const p = PARTS.get(tr);
  setData(tr, "bucket", row.key ?? null);
  setData(tr, "lead", row.lead);
  setText(p.label, row.label);
  setText(p.hint, row.hint ?? "");
  setText(p.lead, row.leadText);
  setText(p.calls.n, String(row.calls));
  setText(p.top1.n, String(row.top1));
  setText(p.top3.n, String(row.top3));
  setText(p.league3.n, String(row.league3));
  setData(p.top3.light, "lit", row.lead === "shadow");
  setData(p.league3.light, "lit", row.lead === "league");
  if (p.calls.strip) {
    setAttr(p.calls.strip, "aria-label", row.cellsLabel);
    reconcile(p.calls.strip, row.cells, { key: (_, i) => i, create: createCell, update: updateCell });
  }
}

function skeleton(face) {
  const ui = {
    empty: el("p", { cls: "rp-empty" }),
    head: el("tr"),
    body: el("tbody"),
    total: createRow("total"),
    note: el("p", { cls: "rp-note" }),
    srCaption: el("caption", { cls: "sr-only" }),
  };
  ui.table = el("table", { cls: "rp-hits", data: { testid: "report-hit-rate" } },
    [ui.srCaption, el("thead", {}, [ui.head]), ui.body, el("tfoot", {}, [ui.total])]);
  [ui.empty, el("div", { cls: "rp-scroll" }, [ui.table]), ui.note].forEach((node) => face.appendChild(node));
  return ui;
}

/**
 * @param {HTMLElement} root  #rp-situations
 * @returns {{ update(vm: ReturnType<import("../model/vm-hit-rate.js").hitRateVm>): void, destroy(): void }}
 */
export function mount(root) {
  const board = createBoard(root);
  const ui = skeleton(board.face);
  return {
    update(vm) {
      board.setPlate(vm.heading);
      setText(ui.srCaption, vm.heading);
      setText(ui.empty, vm.emptyText);
      setHidden(ui.empty, !vm.empty);
      reconcile(ui.head, vm.columns, { key: (_, i) => i, create: () => el("th", { attrs: { scope: "col" } }),
        update: (th, name) => setText(th, name) });
      reconcile(ui.body, vm.rows, { key: (r) => r.key, create: () => createRow("row"), update: updateRow });
      updateRow(ui.total, vm.total);
      setText(ui.note, vm.note);
    },
    destroy() {
      board.destroy();
    },
  };
}
