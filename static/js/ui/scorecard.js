// Tonight's scorecard (ui-architecture.md 2.6, FI 3.7; owner A8). Renders scorecardVm: first SHADOW v LEAGUE, the
// pairs the model and the league baseline both compute (never a league top-pick or tilt count), each with a lamp on
// the side that leads; then the FI groups (specific play, play type, pass vs run), each value with its label, log
// loss styled better or worse (.better/.worse and data-tone, #111); then the note. Before the first logged snap it
// shows the empty line only. data-pair and data-leader let a world hang chosen pairs on its scoreboard band, and
// data-expanded follows the G toggle (the full stat board). Text only (G27).
// v1.5 (G4-3): the SHADOW v LEAGUE caption sits on a plate (.sc-card-plate) with the basis said once under it
// (.sc-card-basisline, "his model v league baseline · 59 snaps"); .sc-card-pairs[data-basis-shared] says whether every
// pair counts those snaps, so the per-pair counts can step aside.
import { el, reconcile, setClass, setData, setHidden, setText } from "./dom.js";

const PAIR_PARTS = new WeakMap();
const GROUP_PARTS = new WeakMap();
const KPI_PARTS = new WeakMap();
const TONES = Object.freeze(["better", "worse"]);

/** The unlit pattern behind an LED number: every digit becomes an 8 ("0.421" -> "8.888"). */
const ghostOf = (value) => String(value ?? "").replace(/\d/g, "8");

function sideNode(caption) {
  const full = el("span", { cls: ["sc-card-num", "sc-digits", "sc-num", "sc-card-full"] });
  const brief = el("span", { cls: ["sc-card-num", "sc-digits", "sc-num", "sc-card-brief"], attrs: { "aria-hidden": "true" } });
  const node = el("span", { cls: "sc-card-side" }, [el("span", { cls: "sc-card-sidecap", text: caption }), full, brief,
    el("span", { cls: "sc-card-lamp", attrs: { "aria-hidden": "true" } })]);
  return { node, full, brief };
}

function createPair(copy) {
  const label = el("span", { cls: "sc-card-plabel" });
  const shadow = sideNode(copy.shadow);
  const league = sideNode(copy.leagueSide);
  const basis = el("span", { cls: "sc-card-basis" });
  const leadText = el("span", { cls: ["sr-only", "sc-card-leadtext"] });
  setData(shadow.node, "side", "shadow");
  setData(league.node, "side", "league");
  const li = el("li", { cls: "sc-card-pair" }, [label, shadow.node,
    el("span", { cls: "sc-card-vs", text: copy.versus, attrs: { "aria-hidden": "true" } }), league.node, basis, leadText]);
  PAIR_PARTS.set(li, { label, shadow, league, basis, leadText });
  return li;
}

function updateSide(side, value, lead) {
  setText(side.full, value.text);
  setData(side.full, "ghost", ghostOf(value.text));
  setText(side.brief, value.brief);
  setData(side.brief, "ghost", ghostOf(value.brief));
  setData(side.node, "lead", lead);
}

function updatePair(li, pair, copy) {
  const p = PAIR_PARTS.get(li);
  setData(li, "pair", pair.id);
  setData(li, "leader", pair.leader);
  setData(li, "better", pair.better);
  setText(p.label, pair.label);
  updateSide(p.shadow, pair.shadow, pair.leader === "shadow");
  updateSide(p.league, pair.league, pair.leader === "league");
  setText(p.basis, pair.basis);
  setText(p.leadText, copy.leads[pair.leader] ?? "");
}

function createKpi() {
  const label = el("dt", { cls: "sc-kpi-label" });
  const value = el("dd", { cls: "sc-kpi-value", data: { num: true } });
  const node = el("div", { cls: "sc-kpi" }, [label, value]);
  KPI_PARTS.set(node, { label, value });
  return node;
}

function updateKpi(node, kpi) {
  const p = KPI_PARTS.get(node);
  setText(p.label, kpi.label);
  setText(p.value, kpi.value);
  setData(p.value, "tone", kpi.tone || null);
  for (const tone of TONES) setClass(p.value, tone, kpi.tone === tone);   // legacy hooks (5.1)
}

function createGroup() {
  const title = el("h3", { cls: "sc-card-sub" });
  const kpis = el("dl", { cls: "sc-card-kpis" });
  const node = el("section", { cls: "sc-card-group" }, [title, kpis]);
  GROUP_PARTS.set(node, { title, kpis });
  return node;
}

function updateGroup(node, group) {
  const p = GROUP_PARTS.get(node);
  setData(node, "group", group.id);
  setText(p.title, group.title);
  reconcile(p.kpis, group.kpis, { key: (_, i) => i, create: createKpi, update: updateKpi });
}

function skeleton(copy) {
  const ui = {
    title: el("h2", { cls: "sc-panel-title", text: copy.heading }),
    empty: el("p", { cls: "sc-card-empty", text: copy.empty }),
    pairList: el("ol", { cls: "sc-card-pairlist" }),
    groups: el("div", { cls: "sc-card-groups" }),
    note: el("p", { cls: "sc-card-note" }),
    basisLine: el("p", { cls: "sc-card-basisline" }),
  };
  const plate = el("div", { cls: "sc-card-plate" }, [el("h3", { cls: "sc-card-sub", text: copy.pairsHeading }),
    ui.basisLine]);
  ui.pairs = el("section", { cls: "sc-card-pairs", attrs: { "aria-label": copy.pairsHeading } }, [plate,
    el("p", { cls: "sc-card-legend", text: copy.pairsLegend }), ui.pairList]);
  ui.box = el("div", { cls: "sc-scorecard" }, [ui.title, ui.empty, ui.pairs, ui.groups, ui.note]);
  return ui;
}

/**
 * @param {HTMLElement} root  #kpiArea (region score)
 * @param {{ copy: object }} ctx
 * @returns {{ update(vm: object): void, destroy(): void }}
 */
export function mount(root, ctx) {
  const copy = ctx.copy.SCORECARD;
  const ui = skeleton(copy);
  root.appendChild(ui.box);
  return {
    update(vm) {
      setText(ui.title, vm.heading);
      setData(ui.box, "expanded", vm.expanded);
      setData(ui.box, "empty", vm.empty);
      setText(ui.empty, vm.emptyText);
      setHidden(ui.empty, !vm.empty);
      setHidden(ui.pairs, vm.pairs.length === 0);
      setText(ui.basisLine, vm.basisLine);
      setData(ui.pairs, "basisShared", Boolean(vm.basisShared));
      reconcile(ui.pairList, vm.pairs, { key: (p) => p.id, create: () => createPair(copy),
        update: (node, p) => updatePair(node, p, copy) });
      reconcile(ui.groups, vm.groups, { key: (g) => g.id, create: createGroup, update: updateGroup });
      setText(ui.note, vm.note);
      setHidden(ui.note, !vm.note);
    },
    destroy() {
      ui.box.remove();
    },
  };
}
