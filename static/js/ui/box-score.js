// Box score (ui-architecture.md 2.6, 5.4; owner A8). Renders boxVm as a table: a column per team (away first), a
// row per stat in the order of a TV stat card. The VM prefers ESPN's own box score when the server sends it (never
// mid-game or in Watch mode) and otherwise counts it from the plays drawn so far; the source line says which.
// Rows and team columns are reconciled by key, so a new play only rewrites the cells that changed. Text only (G27).
import { el, reconcile, setData, setHidden, setText } from "./dom.js";

const ROW_CELLS = new WeakMap();
const CORNER = Object.freeze({ corner: true });     // the empty top-left cell, first in the header row

function createRow() {
  const label = el("th", { attrs: { scope: "row" } });
  const tr = el("tr", { cls: "sc-box-row" }, [label]);
  ROW_CELLS.set(tr, { label, values: [] });
  return tr;
}

/** Keep exactly n value cells after the label (a game shows two columns; a hand-entered one shows one). */
function fitCells(tr, cells, n) {
  while (cells.length < n) cells.push(tr.appendChild(el("td", { data: { num: true } })));
  while (cells.length > n) tr.removeChild(cells.pop());
}

function updateRow(tr, row, teams) {
  const parts = ROW_CELLS.get(tr);
  setText(parts.label, row.label);
  fitCells(tr, parts.values, teams.length);
  parts.values.forEach((td, i) => {
    setText(td, row.values[i] ?? "");
    setData(td, "team", teams[i]);
  });
}

const headKey = (item) => (item === CORNER ? "corner" : `team:${item}`);

function createHead(item) {
  return item === CORNER ? el("td", { cls: "sc-box-corner" }) : el("th", { attrs: { scope: "col" } });
}

function updateHead(cell, item) {
  if (item === CORNER) return;
  setText(cell, item);
  setData(cell, "team", item);
}

/**
 * @param {HTMLElement} root  #rg-box
 * @param {{ copy: object }} ctx
 * @returns {{ update(vm: object): void, destroy(): void }}
 */
export function mount(root, ctx) {
  const copy = ctx.copy.BOX;
  const title = el("h2", { cls: "sc-panel-title", text: copy.heading });
  const empty = el("p", { cls: "sc-box-empty", text: copy.empty });
  const headRow = el("tr");
  const body = el("tbody");
  const table = el("table", { cls: "sc-box", data: { testid: "box-score" } },
    [el("caption", { cls: "sr-only", text: copy.heading }), el("thead", {}, [headRow]), body]);
  const source = el("p", { cls: "sc-box-source" });
  const box = el("div", { cls: "sc-boxscore" }, [title, empty, el("div", { cls: "sc-box-scroll" }, [table]), source]);
  root.appendChild(box);
  return {
    update(vm) {
      setText(title, vm.heading);
      setHidden(table, !vm.available);
      setHidden(empty, vm.available);
      setText(empty, vm.emptyText || copy.empty);
      setData(table, "source", vm.source);
      setText(source, vm.sourceText);
      setHidden(source, !vm.sourceText);
      reconcile(headRow, [CORNER, ...vm.teams], { key: headKey, create: createHead, update: updateHead });
      reconcile(body, vm.rows, { key: (r) => r.label, create: createRow, update: (tr, r) => updateRow(tr, r, vm.teams) });
    },
    destroy() {
      box.remove();
    },
  };
}
