// The video board (restructure-v2.md section 3; FI 3.5; ui-architecture.md 2.6, 4.6 G18; checklist #29 to #36, #122).
// DOM side, text only (G27). One card, every section at once, top to bottom: PREVIOUS PLAY (ui/last-play.js), NEXT
// CALL, LAST 6 (ui/last-play.js). NEXT CALL is one of three faces in #heroArea[data-kind]: "call" (the top pick with
// its share and the tilt pill, the then-line with #2 and #3, the pass/run split against the league, five families
// with their league shares and hot arrows, the 14 specific plays, the why lines and the legend), "offfield" (who has
// the ball while he doesn't, or when his call comes) and "final" (the score in digit windows and the link to the full
// scorecard in the Model Report, where the top bar's key goes; Sam: no Shadow v League numbers on this screen). The
// pointer over a play, a then-line item,
// the top pick or a family row (its top play), and focus on a play, light that play's shadow on the field
// (actions.hoverLeaf, which the conductor turns into engine.highlightGhost); a play is shown, never picked (no user
// input into the game). Lists are keyed, so a background render never moves focus (G18, FI 4.3). World hooks
// (ui-architecture.md 11.3): .sc-call[data-enter] (flips "a"/"b" on every new call, so a world's entrance replays),
// .sc-call[data-fourth], data-family, data-top-leaf and data-hot on families, data-highlighted on plays, and the bar
// shares as custom properties (--sc-share, --sc-league-share: "0%" to "100%"). The board speaks one sentence per
// change in one live region outside the sections (.sc-board-spoken), so a face that appears is still heard.
import { familyOf } from "../core/domain.js";
import { el, reconcile, setAttr, setClass, setData, setHidden, setText } from "./dom.js";
import { act, setPct } from "./input-kit.js";
import { keycap } from "./keycap.js";
import { buildPrevious, buildRecent, entranceOf, facePlate, renderPlate, renderPrevious, renderRecent }
  from "./last-play.js";

const PILL_CLASSES = Object.freeze(["tiltpass", "tiltrun", "leanpass", "leanrun", "noedge"]);
const HOT = Object.freeze(["up", "down"]);
const THEN_SEPARATOR = " · ";
const KINDS = Object.freeze(["offfield", "call", "final"]);
const GHOST_SCORE = "88";

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
    /** Keyboard focus on a play button (G18); a click focuses it too, so its shadow stays lit until focus moves. */
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

// ---------------------------------------------------------------- NEXT CALL off the field: who has the ball
function buildOffField() {
  const head = facePlate();
  const heading = el("h2", { cls: "sc-offfield-heading" });
  const body = el("p", { cls: "sc-offfield-body" });
  return { node: el("div", { cls: "sc-offfield" }, [head.node, heading, body]), head, heading, body };
}

function renderOffField(view, vm) {
  renderPlate(view.head, vm.plate);
  setText(view.heading, vm.heading);
  setHidden(view.heading, !vm.heading);
  setText(view.body, vm.body);
  setHidden(view.body, !vm.body);
}

// ---------------------------------------------------------------- NEXT CALL: the call, building
function buildTop() {
  const name = el("h2", { cls: "sc-call-name" });
  const pct = el("p", { cls: ["sc-call-pct", "sc-num"] });
  const pill = el("span", { cls: "pill" });
  const figure = el("div", { cls: "sc-call-figure" }, [pct, pill]);
  const node = el("div", { cls: "sc-call-top" }, [name, figure]);
  return { node, name, pct, pill };
}

function buildHead() {
  const label = el("span", { cls: "sc-call-label" });
  const sep = el("span", { cls: "sc-call-sep", attrs: { "aria-hidden": "true" }, text: THEN_SEPARATOR });
  const snap = el("span", { cls: "sc-call-snap" });
  const kicker = el("p", { cls: "sc-call-kicker" }, [label, sep, snap]);
  return { node: el("header", { cls: "sc-call-head" }, [kicker]), kicker, label, sep, snap };
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

// ---------------------------------------------------------------- NEXT CALL: the call, rendering
function renderTop(view, vm) {
  const call = vm.call ?? { leaf: null, name: "", pct: "" };
  setText(view.head.label, vm.heading);
  setText(view.head.snap, vm.snap?.text ?? "");
  setHidden(view.head.sep, !vm.snap?.text);
  setData(view.node, "fourth", Boolean(vm.fourth?.on));                 // v1.5 (G4-4)
  setAttr(view.head.kicker, "title", vm.fourth?.on ? vm.fourth.title : null);
  setData(view.top.node, "leaf", call.leaf);
  setData(view.top.node, "family", call.leaf ? familyOf(call.leaf) : null);
  setText(view.top.name, call.name);
  setText(view.top.pct, call.pct);
  setPill(view.top.pill, vm.flag);
}

/** #2 and #3 with their shares, each its own item (a world may stack them one to a row). */
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
      setData(node, "family", familyOf(item.leaf));
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

/** A play: a button whose focus (and so a click) lights its shadow on the field; it logs nothing. */
function createLeaf(hover, leafTitle) {
  const button = el("button", { cls: "leaf", attrs: { type: "button", title: leafTitle } },
    [el("span", { cls: "sc-leaf-name" }), hotNode(), el("span", { cls: ["sc-leaf-pct", "sc-num"] }),
      el("span", { cls: "sc-leaf-bar", attrs: { "aria-hidden": "true" } }, [el("span", { cls: "sc-leaf-fill" })])]);
  hover.bindFocus(button);
  return el("li", { cls: "sc-leaf-row" }, [button]);
}

function updateLeaf(li, leaf, leafTitle) {
  const button = li.firstChild;
  setData(button, "leaf", leaf.key);
  setData(button, "family", familyOf(leaf.key));
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

function updateFamily(node, fam, { hover, leafTitle }) {
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
    create: () => createLeaf(hover, leafTitle),
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

function renderCall(view, vm, hover) {
  renderTop(view, vm);
  renderThen(view, vm);
  renderSplit(view.split, vm.split);
  reconcile(view.fams, vm.families ?? [], {
    key: (fam) => fam.key,
    create: createFamily,
    update: (node, fam) => updateFamily(node, fam, { hover, leafTitle: vm.leafTitle }),
  });
  renderWhy(view.why, vm.why);
  setText(view.legend, vm.legend);
  // A new call (another snap, another top pick or share) replays a world's entrance; a hover is not a new call.
  view.enter = entranceOf(view.node, view.enter, [vm.snap?.n ?? "", vm.call?.leaf ?? "", vm.call?.pct ?? ""].join("|"));
}

// ---------------------------------------------------------------- NEXT CALL at the final whistle: FINAL
/** @param {string | null} reportHref  the top bar's Model Report address (main.js keeps the page's world on it) */
function buildFinal(reportHref) {
  const head = facePlate();
  const score = el("ol", { cls: "sc-final-score" });
  const link = keycap({ tag: "a", cls: "sc-final-key" });
  const body = el("div", { cls: "sc-final-body" }, [score, link.node]);
  return { node: el("article", { cls: "sc-final" }, [head.node, body]), head, score, link, reportHref };
}

function renderScore(list, teams) {
  reconcile(list, teams ?? [], {
    key: (t) => t.abbr,
    create: () => el("li", { cls: "sc-final-team" }, [el("span", { cls: "sc-final-abbr" }), " ",
      el("span", { cls: ["sc-digits", "sc-num", "sc-final-num"], data: { ghost: GHOST_SCORE } },
        [el("span", { cls: "sc-digits-value" })])]),
    update: (li, t) => {
      setData(li, "team", t.abbr);
      setData(li, "caller", Boolean(t.caller));
      setText(li.querySelector(".sc-final-abbr"), t.abbr);
      setText(li.querySelector(".sc-digits-value"), t.score);
    },
  });
}

function renderFinal(view, vm) {
  renderPlate(view.head, vm.plate);
  renderScore(view.score, vm.teams);
  setText(view.link.name, vm.link?.text ?? "");
  setAttr(view.link.node, "href", view.reportHref ?? vm.link?.href ?? null);
  setAttr(view.link.node, "title", vm.link?.title ?? null);
}

/**
 * @param {HTMLElement} root  #heroArea
 * @param {{ actions: object, reportHref?: string }} ctx
 * @returns {{ update(vm: object | null): void, destroy(): void }}
 */
export function mount(root, ctx) {
  const hover = createHover(ctx.actions);
  const previous = buildPrevious();
  const reportHref = typeof ctx.reportHref === "string" && ctx.reportHref ? ctx.reportHref : null;
  const faces = { offfield: buildOffField(), call: buildCall(hover), final: buildFinal(reportHref) };
  const recent = buildRecent();
  // One live region for the whole board, never hidden, so the sentence of a face that just appeared is heard (a live
  // region inside a hidden face says nothing); the faces' figures stay quiet.
  const spoken = el("p", { cls: ["sr-only", "sc-board-spoken"], attrs: { "aria-live": "polite", "aria-atomic": "true" } });
  const sections = [previous.node, ...Object.values(faces).map((face) => face.node), recent.node];
  for (const node of sections) {
    setHidden(node, true);
    root.appendChild(node);
  }
  root.appendChild(spoken);
  setData(root, "kind", "empty");
  return {
    update(vm) {
      const kind = KINDS.includes(vm?.kind) ? vm.kind : "empty";
      setData(root, "kind", kind);
      for (const [name, face] of Object.entries(faces)) setHidden(face.node, name !== kind);
      if (kind !== "call") hover.reset();
      if (kind === "offfield") renderOffField(faces.offfield, vm.next);
      if (kind === "call") renderCall(faces.call, vm.next, hover);
      if (kind === "final") renderFinal(faces.final, vm.next);
      renderPrevious(previous, kind === "empty" ? null : vm.previous ?? null);
      renderRecent(recent, kind === "empty" ? null : vm.recent ?? null);
      setText(spoken, typeof vm?.spoken === "string" ? vm.spoken : "");
    },
    destroy() {
      hover.reset();
      for (const node of [...sections, spoken]) node.remove();
    },
  };
}
