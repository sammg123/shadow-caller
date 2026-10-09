// The next call (FI 3.5; ui-architecture.md 2.6, 4.6 G18 and G24; checklist #29 to #37, #122; owner A7). DOM side,
// text only (G27). Two faces in #heroArea: off the field (the mode's copy) and the call: the top pick with its share
// and the tilt pill, the then-line, the pass/run split against the league, five families with their league shares
// and hot arrows, the 14 specific plays as buttons, the why lines and the legend. A click on a play picks it; the
// pointer over a play, a then-line item, the top pick or a family row (its top play), and focus on a play, light that
// play's zone on the field (actions.hoverLeaf, which the conductor turns into engine.highlightGhost). Lists are keyed,
// so a background render never moves focus (G18, FI 4.3). World hooks (ui-architecture.md 11.3): #heroArea[data-kind],
// .sc-call[data-enter] (flips "a"/"b" on every new call, so a world's entrance replays), data-family, data-top-leaf
// and data-hot on families, data-picked and data-highlighted on plays, and the bar shares as custom properties
// (--sc-share, --sc-league-share: "0%" to "100%").
import { familyOf } from "../core/domain.js";
import { clear, el, reconcile, setAttr, setClass, setData, setHidden, setText } from "./dom.js";
import { act, setPct } from "./input-kit.js";

const PILL_CLASSES = Object.freeze(["tiltpass", "tiltrun", "leanpass", "leanrun", "noedge"]);
const HOT = Object.freeze(["up", "down"]);
const THEN_SEPARATOR = " · ";

// ---------------------------------------------------------------- hover and focus -> actions.hoverLeaf
/** The play a node under the pointer stands for: the nearest data-leaf (a play, a then-line item, the top pick),
 * else the family row's top play (data-top-leaf); null outside them. */
function playUnder(node, stop) {
  for (let n = node; n && n !== stop; n = n.parentNode) {
    if (n.nodeType !== 1) continue;
    const leaf = n.getAttribute("data-leaf") || n.getAttribute("data-top-leaf");
    if (leaf) return leaf;
  }
  return null;
}

/** One lit play at a time: the pointer wins over focus, and focus comes back when the pointer leaves. */
function createHover(actions) {
  const s = { pointer: null, focus: null, sent: null };
  const sync = () => {
    const want = s.pointer ?? s.focus;
    if (want === s.sent) return;
    s.sent = want;
    act(() => actions.hoverLeaf(want));
  };
  return {
    /** Pointer: one delegated listener on the call, so nested rows resolve to whatever is under the pointer. */
    watch(area) {
      area.addEventListener("pointerover", (e) => { s.pointer = playUnder(e.target, area); sync(); });
      area.addEventListener("pointerleave", () => { s.pointer = null; sync(); });
    },
    /** Keyboard focus on a play button (G18). */
    bindFocus(button) {
      const leafOf = () => button.getAttribute("data-leaf") || null;
      button.addEventListener("focus", () => { s.focus = leafOf(); sync(); });
      button.addEventListener("blur", () => { if (s.focus === leafOf()) s.focus = null; sync(); });
    },
    reset() {
      s.pointer = null;
      s.focus = null;
      sync();
    },
  };
}

// ---------------------------------------------------------------- small pieces
function hotNode() {
  return el("span", { cls: "sc-hot" });
}

/** The ▲ or ▼ beside a family or a play (#34): only hot items carry .up/.down, a title and the glyph. */
function setHot(node, item) {
  const hot = HOT.includes(item.hot) ? item.hot : "";
  for (const h of HOT) setClass(node, h, h === hot);
  setData(node, "hot", hot || null);
  setAttr(node, "title", hot ? item.hotTitle : null);
  setAttr(node, "role", hot ? "img" : null);
  setAttr(node, "aria-label", hot ? item.hotTitle : null);
  setText(node, hot ? item.hotGlyph : "");
  setHidden(node, !hot);
}

function setPill(pill, flag) {
  for (const c of PILL_CLASSES) setClass(pill, c, c === flag.cls);
  setText(pill, flag.text);
  setAttr(pill, "title", flag.title);
  setData(pill, "flag", flag.cls || null);
  setData(pill, "tilt", flag.kind || null);
  setData(pill, "side", flag.side ?? null);
}

// ---------------------------------------------------------------- the off-field face
function buildOffField() {
  const heading = el("h2", { cls: "sc-offfield-heading" });
  const body = el("p", { cls: "sc-offfield-body" });
  return { node: el("div", { cls: "sc-offfield" }, [heading, body]), heading, body, key: null };
}

function renderOffField(view, vm) {
  setText(view.heading, vm.heading);
  const parts = Array.isArray(vm.body) ? vm.body : [];
  const key = JSON.stringify(parts);
  if (key === view.key) return;
  view.key = key;
  clear(view.body);
  for (const part of parts) {
    view.body.appendChild(part.strong ? el("strong", { text: part.text }) : el("span", { text: part.text }));
  }
}

// ---------------------------------------------------------------- the call face: building
function buildTop() {
  const name = el("h2", { cls: "sc-call-name" });
  const pct = el("p", { cls: ["sc-call-pct", "sc-num"] });
  const pill = el("span", { cls: "pill" });
  const figure = el("div", { cls: "sc-call-figure" }, [pct, pill]);
  const node = el("div", { cls: "sc-call-top", attrs: { "aria-live": "polite", "aria-atomic": "true" } },
    [name, figure]);
  return { node, name, pct, pill };
}

function buildHead() {
  const label = el("span", { cls: "sc-call-label" });
  const sep = el("span", { cls: "sc-call-sep", attrs: { "aria-hidden": "true" }, text: THEN_SEPARATOR });
  const snap = el("span", { cls: "sc-call-snap" });
  return { node: el("header", { cls: "sc-call-head" }, [el("p", { cls: "sc-call-kicker" }, [label, sep, snap])]),
    label, sep, snap };
}

function buildSplit() {
  const pass = el("span", { cls: "sc-split-pass" });
  const mark = el("span", { cls: "lgmark" });
  const bar = el("div", { cls: "sc-split-bar", attrs: { role: "img" } }, [pass, mark]);
  const labels = ["pass", "league", "run"].map((side) => el("span", { data: { side } }));
  const node = el("div", { cls: "sc-split" }, [bar, el("p", { cls: "sc-split-labels" }, labels)]);
  return { node, bar, mark, labels };
}

function buildCall(hover) {
  const head = buildHead();
  const top = buildTop();
  const lead = el("span", { cls: "sc-then-lead" });
  const items = el("span", { cls: "sc-then-items" });
  const then = el("p", { cls: "sc-then" }, [lead, " ", items]);
  const split = buildSplit();
  const fams = el("div", { cls: "sc-fams" });
  const why = el("ul", { cls: "why" });
  const legend = el("p", { cls: "sc-legend" });
  const more = el("div", { cls: "sc-call-more" }, [why, legend]);
  const node = el("article", { cls: "sc-call" }, [head.node, top.node, then, split.node, fams, more]);
  hover.watch(node);
  return { node, head, top, then, lead, items, split, fams, why, legend, enter: { key: null, phase: "b" } };
}

// ---------------------------------------------------------------- the call face: rendering
function renderTop(view, vm) {
  const call = vm.call ?? { leaf: null, name: "", pct: "" };
  setText(view.head.label, vm.heading);
  setText(view.head.snap, vm.snap?.text ?? "");
  setHidden(view.head.sep, !vm.snap?.text);
  setData(view.top.node, "leaf", call.leaf);
  setData(view.top.node, "family", call.leaf ? familyOf(call.leaf) : null);
  setText(view.top.name, call.name);
  setText(view.top.pct, call.pct);
  setPill(view.top.pill, vm.flag);
}

function renderThen(view, vm) {
  const items = vm.thenLine?.items ?? [];
  setText(view.lead, vm.thenLine?.lead ?? "");
  setHidden(view.then, items.length === 0);
  reconcile(view.items, items, {
    key: (item) => item.leaf,
    create: () => el("span", { cls: "sc-then-item" }, [el("span", { cls: "sc-then-sep" }),
      el("b", { cls: "sc-then-name" }), " ", el("span", { cls: ["sc-then-pct", "sc-num"] })]),
    update: (node, item, i) => {
      setData(node, "leaf", item.leaf);
      setText(node.querySelector(".sc-then-sep"), i === 0 ? "" : THEN_SEPARATOR);
      setText(node.querySelector(".sc-then-name"), item.name);
      setText(node.querySelector(".sc-then-pct"), item.pct);
    },
  });
}

function renderSplit(view, split) {
  const [pass, league, run] = split.labels;
  setPct(view.bar, "--sc-share", split.pass);
  setPct(view.bar, "--sc-league-share", split.league);
  setAttr(view.bar, "aria-label", `${split.ariaLabel}: ${split.labels.join(", ")}`);
  setAttr(view.mark, "title", split.leagueTitle);
  setText(view.labels[0], pass);
  setText(view.labels[1], league);
  setText(view.labels[2], run);
}

function createLeaf(ctx, hover, leafTitle) {
  const button = el("button", {
    cls: "leaf", attrs: { type: "button", "aria-pressed": "false", title: leafTitle },
    on: { click: () => act(() => ctx.actions.pickLeaf(button.getAttribute("data-leaf"))) },
  }, [el("span", { cls: "sc-leaf-name" }), hotNode(), el("span", { cls: ["sc-leaf-pct", "sc-num"] }),
    el("span", { cls: "sc-leaf-bar", attrs: { "aria-hidden": "true" } }, [el("span", { cls: "sc-leaf-fill" })])]);
  hover.bindFocus(button);
  return el("li", { cls: "sc-leaf-row" }, [button]);
}

function updateLeaf(li, leaf, leafTitle) {
  const button = li.firstChild;
  setData(button, "leaf", leaf.key);
  setData(button, "family", familyOf(leaf.key));
  setAttr(button, "aria-pressed", leaf.picked ? "true" : "false");
  setData(button, "picked", Boolean(leaf.picked));
  setData(button, "highlighted", Boolean(leaf.highlighted));
  setAttr(button, "title", leafTitle);
  setPct(button, "--sc-share", leaf.barPct);
  setText(button.querySelector(".sc-leaf-name"), leaf.name);
  setHot(button.querySelector(".sc-hot"), leaf);
  setText(button.querySelector(".sc-leaf-pct"), leaf.pct1);
}

function createFamily() {
  const head = el("h3", { cls: "sc-fam-head" }, [el("span", { cls: "sc-fam-name" }), hotNode()]);
  const bar = el("div", { cls: "sc-fam-bar", attrs: { "aria-hidden": "true" } },
    [el("span", { cls: "sc-fam-fill" }), el("span", { cls: "sc-fam-tick" })]);
  return el("section", { cls: "fam" }, [head, el("p", { cls: ["sc-fam-pct", "sc-num"] }), bar,
    el("p", { cls: "sc-fam-league" }), el("ul", { cls: "sc-leaves" })]);
}

function updateFamily(node, fam, { ctx, hover, leafTitle }) {
  setData(node, "family", fam.key);
  setData(node, "topLeaf", fam.leaves?.[0]?.key ?? null);   // a family row lights its most likely play
  setData(node, "hot", HOT.includes(fam.hot) ? fam.hot : null);
  setText(node.querySelector(".sc-fam-name"), fam.name);
  setHot(node.querySelector(".sc-hot"), fam);   // the family's own arrow comes first, before any play's
  setText(node.querySelector(".sc-fam-pct"), fam.pct);
  const bar = node.querySelector(".sc-fam-bar");
  setPct(bar, "--sc-share", fam.barPct);
  setPct(bar, "--sc-league-share", fam.leagueBarPct);
  setHidden(node.querySelector(".sc-fam-tick"), !Number.isFinite(fam.leagueBarPct));
  setText(node.querySelector(".sc-fam-league"), fam.leagueText);
  reconcile(node.querySelector(".sc-leaves"), fam.leaves ?? [], {
    key: (leaf) => leaf.key,
    create: () => createLeaf(ctx, hover, leafTitle),
    update: (li, leaf) => updateLeaf(li, leaf, leafTitle),
  });
}

function renderWhy(list, why) {
  reconcile(list, why ?? [], {
    key: (_, i) => i,
    create: () => el("li", { cls: "sc-why-item" }, [el("span", { cls: ["sc-why-pts", "sc-num"] }), " ",
      el("span", { cls: "sc-why-text" })]),
    update: (node, item) => {
      setData(node, "kind", item.kind);
      setData(node, "sign", item.sign);
      setText(node.querySelector(".sc-why-pts"), item.pts);
      setText(node.querySelector(".sc-why-text"), item.text);
    },
  });
}

/** A new call (another snap, another top pick or share) flips data-enter so a world's entrance replays. */
function markEntrance(view, vm) {
  const key = [vm.snap?.n ?? "", vm.call?.leaf ?? "", vm.call?.pct ?? ""].join("|");
  if (key === view.enter.key) return;
  view.enter.key = key;
  view.enter.phase = view.enter.phase === "a" ? "b" : "a";
  setData(view.node, "enter", view.enter.phase);
}

function renderCall(view, vm, deps) {
  renderTop(view, vm);
  renderThen(view, vm);
  renderSplit(view.split, vm.split);
  reconcile(view.fams, vm.families ?? [], {
    key: (fam) => fam.key,
    create: createFamily,
    update: (node, fam) => updateFamily(node, fam, { ...deps, leafTitle: vm.leafTitle }),
  });
  renderWhy(view.why, vm.why);
  setText(view.legend, vm.legend);
  markEntrance(view, vm);
}

/**
 * @param {HTMLElement} root  #heroArea
 * @param {{ actions: object }} ctx
 * @returns {{ update(vm: object | null): void, destroy(): void }}
 */
export function mount(root, ctx) {
  const hover = createHover(ctx.actions);
  const off = buildOffField();
  const call = buildCall(hover);
  setHidden(off.node, true);
  setHidden(call.node, true);
  root.appendChild(off.node);
  root.appendChild(call.node);
  setData(root, "kind", "empty");
  return {
    update(vm) {
      const kind = vm?.kind === "call" || vm?.kind === "offfield" ? vm.kind : "empty";
      setData(root, "kind", kind);
      setHidden(off.node, kind !== "offfield");
      setHidden(call.node, kind !== "call");
      if (kind !== "call") hover.reset();
      if (kind === "offfield") renderOffField(off, vm);
      if (kind === "call") renderCall(call, vm, { ctx, hover });
    },
    destroy() {
      hover.reset();
      off.node.remove();
      call.node.remove();
    },
  };
}
