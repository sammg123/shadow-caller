// The card's history (restructure-v2.md section 3; DOM side, text only, G27: ESPN's words are external data):
// PREVIOUS PLAY (his most recent call in the field's words, the verdict, and what the board predicted when his call
// was something else; ESPN's own text on its tooltip) and LAST 6 (his last six calls as glyphs and his night so far).
// Folded in from the last-play panel and the board's recap face: ui/prediction.js mounts them above and below NEXT
// CALL, each under its painted plate (.sc-face-head). Neither lights a shadow on the field: the shadows are the next
// call's. World hooks: .sc-prev[data-enter="a" | "b"] (flips on every new previous play, so a world's entrance
// replays), .sc-prev-play[data-lead="td | int | fumble | turnover"], .sc-prev-verdict[data-verdict][data-rank],
// .sc-prev-predicted[data-family], .sc-recent-dot[data-verdict][data-rank] (the rank on a top-3 hit only),
// .sc-recent-count[data-tally] and .sc-recent-note (how his calls split once a flag has wiped one out).
import { el, reconcile, setAttr, setData, setHidden, setText } from "./dom.js";

const SEPARATOR = " · ";

/**
 * A new key flips node[data-enter] between "a" and "b", so a world's entrance replays on every new item; the same
 * key (a background render, a hover) changes nothing.
 * @param {HTMLElement} node
 * @param {{ key: unknown, phase: "a" | "b" }} enter  the last state
 * @param {unknown} key
 * @returns {{ key: unknown, phase: "a" | "b" }} the new state
 */
export function entranceOf(node, enter, key) {
  if (key === enter.key) return enter;
  const phase = enter.phase === "a" ? "b" : "a";
  setData(node, "enter", phase);
  return { key, phase };
}

/** A section's painted plate: its caption, then " · Snap 34" when it names a snap. */
export function facePlate() {
  const title = el("span", { cls: "sc-face-title" });
  const sep = el("span", { cls: "sc-face-sep", attrs: { "aria-hidden": "true" } });
  const snap = el("span", { cls: "sc-face-snap" });
  const kicker = el("p", { cls: "sc-face-kicker" }, [title, sep, snap]);
  return { node: el("header", { cls: "sc-face-head" }, [kicker]), kicker, title, sep, snap };
}

/** The plate's words; with no snap there is no separator either, so the caption reads whole. */
export function renderPlate(plate, title, snapText = "") {
  setText(plate.title, title);
  setText(plate.sep, snapText ? SEPARATOR : "");
  setText(plate.snap, snapText);
}

// ---------------------------------------------------------------- PREVIOUS PLAY
export function buildPrevious() {
  const head = facePlate();
  const label = el("span", { cls: "sc-prev-label" });
  const play = el("p", { cls: "sc-prev-play" },
    [el("span", { cls: "sc-prev-glyph", attrs: { "aria-hidden": "true" } }), label]);
  const verdict = el("p", { cls: "sc-prev-verdict" });
  const guess = { label: el("span", { cls: "sc-prev-predlabel" }), name: el("span", { cls: "sc-prev-predname" }),
    pct: el("span", { cls: ["sc-prev-predpct", "sc-num"] }) };
  const predicted = el("p", { cls: "sc-prev-predicted" }, [guess.label, " ", guess.name, " ", guess.pct]);
  const body = el("div", { cls: "sc-prev-body" }, [play, verdict, predicted]);
  return { node: el("section", { cls: "sc-prev" }, [head.node, body]), head, play, label, verdict, predicted, guess,
    enter: { key: null, phase: "b" } };
}

function renderPredicted(view, guess) {
  setHidden(view.predicted, !guess);
  setData(view.predicted, "family", guess?.family ?? null);
  setText(view.guess.label, guess?.label ?? "");
  setText(view.guess.name, guess?.name ?? "");
  setText(view.guess.pct, guess?.pct ?? "");
}

/** @param {object | null} prev  predictionVm(pv).previous; null hides the section (no placeholder) */
export function renderPrevious(view, prev) {
  setHidden(view.node, !prev);
  if (!prev) return;
  renderPlate(view.head, prev.plate, prev.snap.text);
  setData(view.play, "lead", prev.lead?.kind ?? null);
  setAttr(view.play, "title", prev.espn || null);
  setText(view.label, prev.label);
  setData(view.verdict, "verdict", prev.verdict.key);
  setData(view.verdict, "rank", prev.verdict.rank ?? null);
  setText(view.verdict, prev.verdict.text);
  setHidden(view.verdict, !prev.verdict.text);
  renderPredicted(view, prev.predicted);
  view.enter = entranceOf(view.node, view.enter, prev.seq);
}

// ---------------------------------------------------------------- LAST 6
export function buildRecent() {
  const head = facePlate();
  const label = el("span", { cls: "sc-recent-label", attrs: { "aria-hidden": "true" } });
  const glyphs = el("span", { cls: "sc-recent-glyphs", attrs: { role: "img" } });
  const row = el("p", { cls: "sc-recent-row" }, [label, glyphs]);
  const tally = el("p", { cls: "sc-recent-tally" });
  const note = el("p", { cls: "sc-recent-note" });
  return { node: el("section", { cls: "sc-recent" },
    [head.node, el("div", { cls: "sc-recent-body" }, [row, tally, note])]), head, row, label, glyphs, tally, note };
}

function renderTally(node, tally) {
  reconcile(node, tally, {
    key: (t) => t.id,
    create: () => el("span", { cls: "sc-recent-count" }, [el("span", { cls: "sc-recent-sep" }),
      el("span", { cls: "sc-recent-countlabel" }), " ", el("b", { cls: "sc-recent-countvalue" })]),
    update: (span, t, i) => {
      setData(span, "tally", t.id);
      setText(span.querySelector(".sc-recent-sep"), i === 0 ? "" : SEPARATOR);
      setText(span.querySelector(".sc-recent-countlabel"), t.label);
      setText(span.querySelector(".sc-recent-countvalue"), t.value);
    },
  });
}

/** @param {object | null} recent  predictionVm(pv).recent; null hides the section */
export function renderRecent(view, recent) {
  setHidden(view.node, !recent);
  if (!recent) return;
  renderPlate(view.head, recent.plate);
  setText(view.label, recent.label);
  setAttr(view.glyphs, "aria-label", recent.aria || null);
  reconcile(view.glyphs, recent.items, {
    key: (_, i) => i,
    create: () => el("span", { cls: "sc-recent-dot" }),
    update: (dot, item) => {
      setData(dot, "verdict", item.key);
      setData(dot, "rank", item.key === "top3" ? item.rank : null);
    },
  });
  setHidden(view.row, recent.items.length === 0);
  renderTally(view.tally, recent.tally);
  setHidden(view.tally, recent.tally.length === 0);
  setText(view.note, recent.note ?? "");
  setHidden(view.note, !recent.note);
}
