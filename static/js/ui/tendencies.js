// His tendencies (ui-architecture.md 2.6, FI 3.8; owner A8). Renders tendenciesVm under #profTitle and #profArea:
// the pass-run terms as a forest plot, habits then in-game memory in a fixed order (G14), each row its label, the
// 90% interval and the estimate on the -1.2 to 1.2 axis (zero in the middle; "more run" left, "more pass" right),
// filled when the interval excludes zero (data-sure, #114) and hollow otherwise; then the play-type mix against what
// the league would call (#115) and the held-out check. Rows are SVG geometry with non-scaling strokes; the dot is a
// zero-length round-capped line, so it stays round however the row stretches. Text only (G27).
import { el, reconcile, setAttr, setData, setHidden, setText, svgEl } from "./dom.js";

const SCALE = 100;
const ROW_H = 10;
const MID = ROW_H / 2;
const ROW_PARTS = new WeakMap();
const MIX_PARTS = new WeakMap();

const at = (fraction) => Math.round(Math.max(0, Math.min(1, fraction)) * SCALE * 100) / 100;
const hline = (cls) => svgEl("line", { class: cls, y1: MID, y2: MID });

function createTerm() {
  const zero = svgEl("line", { class: "sc-tend-zero", y1: 0, y2: ROW_H });
  const ci = hline("sc-tend-ci");
  const dot = hline("sc-tend-dot");
  const hole = hline("sc-tend-hole");
  const svg = svgEl("svg", { class: "sc-tend-svg", viewBox: `0 0 ${SCALE} ${ROW_H}`, preserveAspectRatio: "none",
    "aria-hidden": "true", focusable: "false" }, [zero, ci, dot, hole]);
  const label = el("span", { cls: "sc-tend-label" });
  const sr = el("span", { cls: ["sr-only", "sc-tend-sr"] });
  const li = el("li", { cls: "sc-tend-row" }, [label, svg, sr]);
  ROW_PARTS.set(li, { label, sr, zero, ci, dot, hole });
  return li;
}

function setX(line, x1, x2 = x1) {
  setAttr(line, "x1", x1);
  setAttr(line, "x2", x2);
}

function updateTerm(li, row, axis, copy) {
  const p = ROW_PARTS.get(li);
  setData(li, "term", row.key);
  setData(li, "group", row.group || null);
  setData(li, "sure", row.sure);
  setData(li, "sign", row.sign);
  setText(p.label, row.label);
  setText(p.sr, `${copy.leans[row.sign] ?? ""}, ${row.sure ? copy.sure : copy.unsure}`);
  setX(p.zero, at(axis.zero));
  setX(p.ci, at(row.pos.lo), at(row.pos.hi));
  setX(p.dot, at(row.pos.est));
  setX(p.hole, at(row.pos.est));
  setAttr(p.hole, "visibility", row.sure ? "hidden" : null);
}

function createHead() {
  return el("li", { cls: "sc-tend-ghead", attrs: { "aria-hidden": "true" } });
}

/** Rows with a caption before the first row of each known group (habits, memory). */
function listItems(rows, groups) {
  const items = [];
  rows.forEach((row, i) => {
    if (groups[row.group] && (i === 0 || rows[i - 1].group !== row.group)) items.push({ head: row.group });
    items.push({ row });
  });
  return items;
}

function createMixRow() {
  const name = el("th", { attrs: { scope: "row" } });
  const his = el("td", { cls: "sc-tend-his", data: { num: true } });
  const exp = el("td", { cls: "sc-tend-exp", data: { num: true } });
  const tr = el("tr", {}, [name, his, exp]);
  MIX_PARTS.set(tr, { name, his, exp });
  return tr;
}

function updateMixRow(tr, m) {
  const p = MIX_PARTS.get(tr);
  setData(tr, "family", m.key);
  setText(p.name, m.name);
  setText(p.his, m.his);
  setText(p.exp, m.exp);
}

function skeleton(copy) {
  const ui = {
    title: el("h2", { id: "profTitle", cls: "sc-panel-title", text: copy.fallbackTitle }),
    termsHeading: el("h3", { cls: "sc-tend-sub" }),
    terms: el("ul", { cls: "sc-tend-terms" }),
    axisRun: el("span", { cls: "sc-tend-run" }),
    axisPass: el("span", { cls: "sc-tend-pass" }),
    note: el("p", { cls: "sc-tend-note" }),
    mixHeading: el("h3", { cls: "sc-tend-sub" }),
    mixBody: el("tbody"),
    heldOut: el("p", { cls: "sc-tend-heldout" }),
  };
  const axis = el("div", { cls: "sc-tend-axis", attrs: { "aria-hidden": "true" } }, [ui.axisRun, ui.axisPass]);
  ui.mixBlock = el("div", { cls: "sc-tend-mixblock" },
    [ui.mixHeading, el("table", { cls: "sc-tend-mix" }, [ui.mixBody])]);
  ui.plot = el("div", { cls: "sc-tend-plot" }, [ui.termsHeading, ui.terms, axis, ui.note]);
  ui.area = el("div", { id: "profArea", cls: "sc-tend" }, [ui.plot, ui.mixBlock, ui.heldOut]);
  ui.box = el("div", { cls: "sc-tendencies" }, [ui.title, ui.area]);
  return ui;
}

/**
 * @param {HTMLElement} root  #rg-tendencies
 * @param {{ copy: object }} ctx
 * @returns {{ update(vm: object): void, destroy(): void }}
 */
export function mount(root, ctx) {
  const copy = ctx.copy.TENDENCIES;
  const ui = skeleton(copy);
  root.appendChild(ui.box);
  return {
    update(vm) {
      setText(ui.title, vm.title);
      setText(ui.termsHeading, vm.termsHeading);
      setAttr(ui.terms, "aria-label", vm.axis.ariaLabel);
      setText(ui.axisRun, vm.axis.left);
      setText(ui.axisPass, vm.axis.right);
      setHidden(ui.plot, vm.rows.length === 0);
      reconcile(ui.terms, listItems(vm.rows, copy.groups), {
        key: (item) => (item.head ? `head:${item.head}` : `term:${item.row.key}`),
        create: (item) => (item.head ? createHead() : createTerm()),
        update: (node, item) => (item.head ? setText(node, copy.groups[item.head]) : updateTerm(node, item.row, vm.axis, copy)),
      });
      setText(ui.note, vm.note);
      setText(ui.mixHeading, vm.mixHeading);
      setHidden(ui.mixBlock, vm.mix.length === 0);
      reconcile(ui.mixBody, vm.mix, { key: (m) => m.key, create: createMixRow, update: updateMixRow });
      setText(ui.heldOut, vm.heldOut);
      setHidden(ui.heldOut, !vm.heldOut);
    },
    destroy() {
      ui.box.remove();
    },
  };
}
