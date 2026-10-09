// Play log (ui-architecture.md 2.6, FI 3.9; owner A8). Renders logVm under #logArea: one table, every logged snap,
// newest first, never paginated, in the FI columns (#112): #, Time, Situation, His top pick, Actual, His % on it,
// League %, Rank, Yds. Nullified rows leave # empty (G15), goal to go reads Goal (G16), the rank is styled good,
// plain or bad (.ok/.no and data-tone, #113), and every string is text (#123, G27). The Actual name is a button
// that shows the snap on the field (actions.reviewAt); the reviewed one is pressed and goes back to live.
import { el, reconcile, setAttr, setClass, setData, setHidden, setText } from "./dom.js";

const NUMERIC = Object.freeze([0, 5, 6, 7, 8]);        // #, His % on it, League %, Rank, Yds
const RANK_CLASS = Object.freeze({ good: "ok", bad: "no" });
const ROW_PARTS = new WeakMap();

function onActualPress(tr, actions) {
  const item = ROW_PARTS.get(tr)?.item;
  if (!item || item.tlSeq === null) return;
  if (item.reviewing) actions.exitReview();
  else actions.reviewAt(item.tlSeq);
}

const td = (i) => el("td", { data: NUMERIC.includes(i) ? { num: true } : {} });

function createRow(actions) {
  const cells = Array.from({ length: 9 }, (_, i) => td(i));
  const link = el("button", { cls: "sc-log-link", attrs: { type: "button" } });
  const rank = el("span", { cls: "sc-log-rank" });
  cells[4].appendChild(link);
  cells[7].appendChild(rank);
  const tr = el("tr", { cls: "sc-log-row" }, cells);
  link.addEventListener("click", () => onActualPress(tr, actions));
  ROW_PARTS.set(tr, { cells, link, rank, item: null });
  return tr;
}

function updateRank(rank, cell) {
  setText(rank, cell.text);
  setData(rank, "tone", cell.tone || null);
  for (const [tone, cls] of Object.entries(RANK_CLASS)) setClass(rank, cls, cell.tone === tone);
}

function updateRow(tr, row, copy) {
  const p = ROW_PARTS.get(tr);
  ROW_PARTS.set(tr, { ...p, item: row });       // the click handler reads the newest row
  setData(tr, "seq", row.seq);
  setData(tr, "nullified", row.nullified);
  setData(tr, "verdict", row.verdict);
  setData(tr, "reviewing", row.reviewing);
  setData(tr, "tlSeq", row.tlSeq);
  const plain = [row.snap, row.time, row.situation, row.topPick, null, row.hisP, row.lgP, null, row.yds];
  plain.forEach((value, i) => { if (value !== null) setText(p.cells[i], value); });
  setText(p.link, row.actual);
  setAttr(p.link, "disabled", row.tlSeq === null);
  setAttr(p.link, "aria-pressed", row.reviewing ? "true" : "false");
  setAttr(p.link, "title", row.reviewing ? copy.reviewing : copy.review);
  updateRank(p.rank, row.rank);
}

function headRow(columns) {
  return columns.map((name, i) => el("th", { attrs: { scope: "col" }, data: NUMERIC.includes(i) ? { num: true } : {},
    text: name }));
}

/**
 * @param {HTMLElement} root  #logArea (region log)
 * @param {{ actions: object, copy: object }} ctx
 * @returns {{ update(vm: object): void, destroy(): void }}
 */
export function mount(root, ctx) {
  const copy = ctx.copy.LOG;
  const linkCopy = ctx.copy.PLAYS;
  const title = el("h2", { cls: "sc-panel-title", text: copy.heading });
  const empty = el("p", { cls: "sc-log-empty", text: copy.empty });
  const head = el("tr", {}, headRow(copy.columns));
  const body = el("tbody");
  const table = el("table", { cls: "sc-log", data: { testid: "play-log" } },
    [el("caption", { cls: "sr-only", text: copy.heading }), el("thead", {}, [head]), body]);
  const box = el("div", { cls: "sc-playlog" }, [title, empty, el("div", { cls: "sc-log-scroll" }, [table])]);
  root.appendChild(box);
  return {
    update(vm) {
      setText(title, vm.heading);
      setText(empty, vm.emptyText);
      setHidden(empty, !vm.empty);
      setHidden(table, vm.empty);
      [...head.childNodes].forEach((th, i) => setText(th, vm.columns[i] ?? ""));
      reconcile(body, vm.rows, { key: (r) => r.seq, create: () => createRow(ctx.actions),
        update: (tr, r) => updateRow(tr, r, linkCopy) });
    },
    destroy() {
      box.remove();
    },
  };
}
