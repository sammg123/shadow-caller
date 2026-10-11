// Every call v the model (DOM side, text only through ui/dom.js; restructure-v2.md section 6): one table, oldest first,
// a header row for each of his drives, then each call: number, quarter and clock, situation, the model's top 3 with
// their chances (the one he called marked, in words too), what he called with its chance and a no-play mark when a
// flag wiped it out, its rank, the verdict in its light. Rows are reconciled by key, so a live game appends; each call
// row takes focus (tabindex -1) when the drive chart brings its drive into view.
import { el, reconcile, setData, setHidden, setText } from "../../ui/dom.js";
import { createBoard } from "./board.js";

const COLUMNS = 7;
const NUMERIC = Object.freeze([0, 5]);
const PARTS = new WeakMap();

function createDriveRow() {
  const cell = el("th", { attrs: { scope: "colgroup", colspan: String(COLUMNS) } });
  const tr = el("tr", { cls: "rp-drive-row" }, [cell]);
  PARTS.set(tr, { cell });
  return tr;
}

function updateDriveRow(tr, item) {
  setData(tr, "drive", item.drive);
  setData(tr, "result", item.result);
  setText(PARTS.get(tr).cell, item.text);
}

function createTop3Item() {
  const name = el("span", { cls: "rp-top3-name" });
  const pct = el("span", { cls: ["rp-top3-pct", "sc-num"] });
  const mark = el("span", { cls: "sr-only" });
  const li = el("li", {}, [name, " ", pct, " ", mark]);
  PARTS.set(li, { name, pct, mark });
  return li;
}

function updateTop3Item(li, entry, marks) {
  const p = PARTS.get(li);
  setData(li, "called", entry.called);
  setText(p.name, entry.name);
  setText(p.pct, entry.pct);
  setText(p.mark, entry.called ? marks.called : "");
}

/** The seven cells of a call row and the parts inside them that change. */
function callCells() {
  const parts = {
    top3: el("ol", { cls: "rp-top3" }),
    called: el("span", { cls: "rp-called" }),
    calledPct: el("span", { cls: ["rp-called-pct", "sc-num"] }),
    noPlay: el("span", { cls: "rp-noplay" }),
    verdict: el("span", { cls: "rp-verdict" }),
    verdictText: el("span", { cls: "rp-verdict-text" }),
  };
  parts.verdict.appendChild(el("span", { cls: "rp-verdict-glyph", attrs: { "aria-hidden": "true" } }));
  parts.verdict.appendChild(parts.verdictText);
  const inside = { 3: [parts.top3], 4: [parts.called, " ", parts.calledPct, " ", parts.noPlay], 6: [parts.verdict] };
  const tds = Array.from({ length: COLUMNS }, (_, i) => el("td", { data: NUMERIC.includes(i) ? { num: true } : {} },
    inside[i] ?? []));
  return { tds, parts };
}

function createCallRow() {
  const { tds, parts } = callCells();
  const tr = el("tr", { cls: "rp-call-row", attrs: { tabindex: "-1" } }, tds);
  PARTS.set(tr, { tds, ...parts });
  return tr;
}

function updateCallRow(tr, call, marks) {
  const p = PARTS.get(tr);
  setData(tr, "seq", call.seq);
  setData(tr, "drive", call.drive);
  setData(tr, "verdict", call.verdict);
  setData(tr, "nullified", call.nullified);
  [call.snap, call.time, call.situation].forEach((value, i) => setText(p.tds[i], value));
  setText(p.tds[5], call.rank);
  reconcile(p.top3, call.top3, { key: (t, i) => `${i}:${t.leaf}`, create: createTop3Item,
    update: (li, t) => updateTop3Item(li, t, marks) });
  setText(p.called, call.called);
  setText(p.calledPct, call.calledPct);
  setText(p.noPlay, marks.noPlay);
  setHidden(p.noPlay, !call.nullified);
  setData(p.verdict, "verdict", call.verdict);
  setText(p.verdictText, call.verdictText);
}

const isDrive = (item) => item.kind === "drive";

function skeleton(face) {
  const ui = {
    caption: el("p", { cls: "rp-sub" }),
    count: el("p", { cls: "rp-count" }),
    empty: el("p", { cls: "rp-empty" }),
    head: el("tr"),
    body: el("tbody"),
    srCaption: el("caption", { cls: "sr-only" }),
  };
  ui.table = el("table", { cls: "rp-calls", data: { testid: "report-calls" } },
    [ui.srCaption, el("thead", {}, [ui.head]), ui.body]);
  const head = el("div", { cls: "rp-board-head" }, [ui.caption, ui.count]);
  [head, ui.empty, el("div", { cls: "rp-scroll" }, [ui.table])].forEach((node) => face.appendChild(node));
  return ui;
}

/**
 * @param {HTMLElement} root  #rp-calls
 * @returns {{ update(vm: ReturnType<import("../model/vm-calls.js").callsVm>): void, destroy(): void }}
 */
export function mount(root) {
  const board = createBoard(root);
  const ui = skeleton(board.face);
  return {
    update(vm) {
      board.setPlate(vm.heading);
      setText(ui.caption, vm.caption);
      setText(ui.count, vm.countText);
      setText(ui.srCaption, vm.heading);
      setText(ui.empty, vm.emptyText);
      setHidden(ui.empty, !vm.empty);
      setHidden(ui.table, vm.empty);
      reconcile(ui.head, vm.columns, { key: (_, i) => i, create: () => el("th", { attrs: { scope: "col" } }),
        update: (th, name, i) => { setText(th, name); setData(th, "num", NUMERIC.includes(i) ? true : null); } });
      reconcile(ui.body, vm.items, { key: (item) => item.key,
        create: (item) => (isDrive(item) ? createDriveRow() : createCallRow()),
        update: (tr, item) => (isDrive(item) ? updateDriveRow(tr, item) : updateCallRow(tr, item, vm.marks)) });
    },
    destroy() {
      board.destroy();
    },
  };
}
