// The flag panel (FI 1.6, 2.5; ui-architecture.md 2.6, 5.1, 4.3 flag mode; G25; checklist #63 to #77; owner A7).
// DOM side, text only (G27). Mounted on #flagPanel (its own `flags` region, so a world can hang it in a booth):
// the title and Close (Esc), the note about the current pick (recomputed on every render, G25), the defense and
// offense columns of coded fouls (each a key cap with its flag-mode letter and summary), Other on each team with the
// "automatic 1st down" box, Offsetting (W) and the hint. Every foul button applies its code through actions; the
// panel is the Form for the automatic 1st down box. Lists are keyed, so the buttons survive renders and focus.
import { el, reconcile, setAttr, setHidden, setText } from "./dom.js";
import { act, keyCap, setKeyCap } from "./input-kit.js";

const OTHER_CODES = Object.freeze({ def: "OTHER_D", off: "OTHER_O" });
const COLUMNS = Object.freeze(["def", "off"]);
const TITLE_ID = "flagTitle";

function penButton(apply, code, spec) {
  return keyCap({ ...spec, cls: ["sc-flag"], data: { pen: code }, on: { click: () => apply(code) } });
}

function buildColumn(against, apply, otherFirst) {
  const heading = el("h3", { cls: "sc-flag-heading" });
  const list = el("ul", { cls: "sc-flag-list" });
  const other = penButton(apply, OTHER_CODES[against], { name: "" });
  const extras = against === "def" ? [other, otherFirst] : [other];
  const node = el("section", { cls: "sc-flag-col", data: { against } },
    [heading, list, el("div", { cls: "sc-flag-other" }, extras)]);
  return { node, heading, list, other };
}

function buildAutoFirst() {
  const box = el("input", { id: "otherFirst", attrs: { type: "checkbox" } });
  const text = el("span", { cls: "sc-check-label" });
  return { box, text, node: el("label", { cls: "sc-check", data: { check: "otherFirst" } }, [box, text]) };
}

function buildPanel(apply, onClose) {
  const title = el("h2", { id: TITLE_ID, cls: "sc-flag-title" });
  const close = el("button", { id: "flagClose", cls: "sc-flag-close",
    attrs: { type: "button", "aria-keyshortcuts": "Escape" }, on: { click: onClose } });
  const note = el("p", { id: "flagNote", cls: "sc-flag-note", attrs: { "aria-live": "polite" } });
  const auto = buildAutoFirst();
  const cols = Object.fromEntries(COLUMNS.map((against) => [against, buildColumn(against, apply, auto.node)]));
  const offset = penButton(apply, "OFFSET", { name: "" });
  const hint = el("p", { cls: "sc-flag-hint" });
  const nodes = [el("div", { cls: "sc-flag-head" }, [title, close]), note,
    el("div", { cls: "sc-flag-cols" }, COLUMNS.map((a) => cols[a].node)),
    el("div", { cls: "sc-flag-offset" }, [offset]), hint];
  return { nodes, title, close, note, auto, cols, offset, hint };
}

function renderColumn(col, heading, fouls, apply) {
  setText(col.heading, heading);
  reconcile(col.list, fouls ?? [], {
    key: (foul) => foul.code,
    create: (foul) => el("li", { cls: "sc-flag-row" },
      [penButton(apply, foul.code, { key: foul.key, name: foul.label })]),
    update: (li, foul) => setKeyCap(li.firstChild, { key: foul.key, name: foul.label, hint: foul.summary }),
  });
}

function render(p, vm, apply) {
  setText(p.title, vm.title);
  setText(p.close, vm.close);
  setText(p.note, vm.note);
  setText(p.hint, vm.hint);
  setText(p.auto.text, vm.autoFirst);
  renderColumn(p.cols.def, vm.headings?.def ?? "", vm.def, apply);
  renderColumn(p.cols.off, vm.headings?.off ?? "", vm.off, apply);
  setKeyCap(p.cols.def.other, { name: vm.otherD, hint: vm.otherSummary });
  setKeyCap(p.cols.off.other, { name: vm.otherO, hint: vm.otherSummary });
  const offset = vm.offset ?? { key: "", label: "", summary: "" };
  setKeyCap(p.offset, { key: offset.key, name: offset.label, hint: offset.summary });
  setAttr(p.offset, "aria-keyshortcuts", offset.key || null);
}

/**
 * @param {HTMLElement} root  #flagPanel
 * @param {{ actions: object }} ctx
 * @returns {{ update(vm: object | null): void, destroy(): void, form: object }}
 */
export function mount(root, ctx) {
  const apply = (code) => act(() => ctx.actions.applyFlag(code));
  const panel = buildPanel(apply, () => act(() => ctx.actions.closeFlag()));
  for (const node of panel.nodes) root.appendChild(node);
  setAttr(root, "role", "region");
  setAttr(root, "aria-labelledby", TITLE_ID);
  return {
    form: {
      readAutoFirst: () => Boolean(panel.auto.box.checked),
      writeAutoFirst: (on) => { panel.auto.box.checked = Boolean(on); },
    },
    update(vm) {
      setHidden(root, vm?.hidden !== false);
      if (vm?.hidden === false || (vm && vm.def?.length)) render(panel, vm, apply);
    },
    destroy() {
      for (const node of panel.nodes) node.remove();
    },
  };
}
