// Play feed (ui-architecture.md 2.6, 5.4; owner A8). Renders playsVm: every play drawn so far, both teams, newest
// first and grouped by drive under a header with the drive's team, result and summary. The caller's snaps carry the
// call and the verdict: top pick, in his top 3, or miss. Read only (restructure-v2.md 1): it is the top LED ticker,
// the newest play; a world may unroll the recent plays under the pointer. Rows are reconciled by seq, so new plays
// never rebuild old rows. Text only (G27): ESPN's play text goes in through textContent.
// v1.4 (W2; surface brief unresolved #7): ribbon paging. A world that sets the newest play on one line (Under the
// Lights' LED ribbon) cuts it at the face's edge; when the newest row's words overflow its own button, the row pages a
// screenful at a time, whole words only: --sc-page-x (px) shifts the words, --sc-page-cut (px) is the visible width of
// the page's whole words, data-page / data-pages count, and data-page-phase flips "a" / "b" so a world can step each
// page in. Each page holds PAGE_HOLD_MS; after the last page it returns to the first and rests. Where rows wrap (the
// neutral world, an unrolled feed) nothing overflows and nothing pages. ctx.timers and ctx.measureRibbon are for tests.
// G5-10: each row also carries its ribbon face (.sc-pf-face, aria-hidden): the field's words for the play and who had
// the ball, one page, which a one-line world shows instead of ESPN's text (that text stays in the row for assistive
// tech). No paging under reduced motion, none while the feed is unrolled; a re-render writes only rows that changed.
import { el, reconcile, setAttr, setData, setHidden, setText } from "./dom.js";

const ROW_PARTS = new WeakMap();
const GROUP_PARTS = new WeakMap();

export const PAGE_HOLD_MS = 2400;
const PAGE_EPS_PX = 1;
const browserTimers = Object.freeze({
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id),
});

/**
 * Pages for words at [left, right] px from the first word's edge in a face `width` px wide (pure): a page starts at
 * the first word that would not fit whole and ends at its last whole word. A word wider than the face is a page alone.
 * @param {Array<[number, number]>} spans
 * @param {number} width
 * @returns {Array<{ start: number, end: number }>}
 */
export function pagesFor(spans, width) {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const pages = [{ start: 0, end: 0 }];
  for (const [left, right] of sorted) {
    const page = pages[pages.length - 1];
    const fits = !(width > 0) || right - page.start <= width + PAGE_EPS_PX || left <= page.start;
    if (fits) pages[pages.length - 1] = { start: page.start, end: Math.max(page.end, right) };
    else pages.push({ start: left, end: right });
  }
  return pages;
}

/** The words of a row's button as px spans from its content edge, and the content width; null without layout. */
function measureWords(control) {
  const doc = control.ownerDocument;
  const view = doc?.defaultView;
  const hasLayout = Boolean(view?.NodeFilter) && typeof doc.createRange === "function"
    && typeof doc.createTreeWalker === "function";
  if (!hasLayout) return null;
  const style = view.getComputedStyle(control);
  const padStart = parseFloat(style.paddingLeft) || 0;
  const width = control.clientWidth - padStart - (parseFloat(style.paddingRight) || 0);
  if (control.scrollWidth <= control.clientWidth + PAGE_EPS_PX) return { width, spans: [] };
  const origin = control.getBoundingClientRect().left + padStart;
  const walker = doc.createTreeWalker(control, view.NodeFilter.SHOW_TEXT);
  const range = doc.createRange();
  const spans = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node.parentElement?.getBoundingClientRect().width > 1)) continue;   // a visually hidden name, not on the face
    for (const word of node.data.matchAll(/\S+/g)) {
      range.setStart(node, word.index);
      range.setEnd(node, word.index + word[0].length);
      const box = range.getBoundingClientRect();
      if (box.width > 0) spans.push([box.left - origin, box.right - origin]);
    }
  }
  return { width, spans };
}

/**
 * One row paged at a time. measure(control) gives { width, spans } (or null: no layout, one page); apply(control,
 * { page, pages, shift, cut, phase }) writes it. start(control) restarts on a new row and resets the old one.
 */
export function createPager({ timers, measure, apply, enabled = () => true }) {
  const s = { control: null, pages: [{ start: 0, end: 0 }], page: 0, phase: "b", timer: null };
  const stop = () => {
    if (s.timer !== null) timers.clearTimeout(s.timer);
    s.timer = null;
  };
  const show = (page, phase) => {
    const p = s.pages[page];
    const many = s.pages.length > 1;
    s.page = page;
    const shift = many && p.start ? -p.start : 0;
    apply(s.control, { page, pages: s.pages.length, shift, cut: many ? p.end - p.start : null, phase });
  };
  const tick = () => {
    s.timer = null;
    s.phase = s.phase === "a" ? "b" : "a";
    const next = s.page + 1 < s.pages.length ? s.page + 1 : 0;
    show(next, s.phase);
    if (next !== 0) s.timer = timers.setTimeout(tick, PAGE_HOLD_MS);
  };
  return {
    start(control) {
      stop();
      if (s.control && s.control !== control) {
        s.pages = [{ start: 0, end: 0 }];
        show(0, null);
      }
      s.control = control;
      s.pages = [{ start: 0, end: 0 }];
      show(0, null);
      if (!enabled()) return;                           // G5-10: reduced motion: one page, cut at the face's edge
      const m = measure(control);
      s.pages = m ? pagesFor(m.spans, m.width) : s.pages;
      s.phase = "b";
      show(0, null);
      if (s.pages.length > 1) s.timer = timers.setTimeout(tick, PAGE_HOLD_MS);
    },
    stop,
  };
}

function applyPage(control, p) {
  const li = control.parentNode;
  const many = p.pages > 1;
  if (li) {
    setData(li, "pages", many ? p.pages : null);
    setData(li, "page", many ? p.page : null);
    setData(li, "pagePhase", many ? p.phase : null);
  }
  for (const [name, px] of [["--sc-page-x", p.shift], ["--sc-page-cut", p.cut]]) {
    if (many && Number.isFinite(px)) control.style.setProperty(name, `${Math.round(px)}px`);
    else control.style.removeProperty(name);
  }
}

function rowParts(copy) {
  return {
    face: el("span", { cls: "sc-pf-face", attrs: { "aria-hidden": "true" } }),
    time: el("span", { cls: ["sc-pf-time", "sc-num"] }),
    team: el("span", { cls: "sc-pf-team" }),
    sit: el("span", { cls: "sc-pf-sit" }),
    noPlay: el("span", { cls: "sc-pf-noplay", text: copy.noPlay }),
    result: el("span", { cls: ["sc-pf-result", "sc-num"] }),
    text: el("span", { cls: "sc-pf-text" }),
    verdict: el("span", { cls: "sc-pf-verdict" }),
    callName: el("span", { cls: "sc-pf-callname" }),
    retagged: el("span", { cls: "sc-pf-retagged", text: copy.retagged }),
  };
}

function createRow(ctx) {
  const p = rowParts(ctx.copy.PLAYS);
  const call = el("span", { cls: "sc-pf-call" }, [p.verdict, p.callName, p.retagged]);
  const inner = [el("span", { cls: "sc-pf-meta" }, [p.time, p.team, p.sit, p.noPlay]), p.result, p.text, call, p.face];
  const control = el("div", { cls: "sc-pf-btn" }, inner);
  const li = el("li", { cls: "sc-pf-row", data: { testid: "play-row" } }, [control]);
  ROW_PARTS.set(li, { ...p, call, control, item: null });
  return li;
}

const TURNOVER_WORDS = Object.freeze(["INT", "FUMBLE", "TURNOVER"]);

/**
 * v1.4 (W2): the kind of a row's result word (format.resultText's vocabulary), a hook for a world's result glyphs:
 * "td" (any touchdown, a return included), "turnover", "flag", "inc", else null.
 * @param {unknown} word
 * @returns {"td" | "turnover" | "flag" | "inc" | null}
 */
export function resultKind(word) {
  const text = typeof word === "string" ? word.trim() : "";
  if (/(^|\s)TD$/.test(text)) return "td";
  if (TURNOVER_WORDS.includes(text)) return "turnover";
  if (text === "FLAG") return "flag";
  return text === "INC" ? "inc" : null;
}

const ROW_KEYS = Object.freeze(["seq", "id", "kind", "team", "caller", "verdict", "nullified", "retagged", "scoring",
  "result", "time", "situation", "text", "verdictText", "call", "face"]);
/** G5-10: the row shows exactly what it showed: nothing to write (183 rows are reconciled on every update). */
const sameRow = (a, b) => Boolean(a) && ROW_KEYS.every((k) => a[k] === b[k]);

function updateRow(li, item, newest) {
  const p = ROW_PARTS.get(li);
  const isNewest = item.seq === newest;
  if (p.shown === isNewest && sameRow(p.item, item)) return;
  ROW_PARTS.set(li, { ...p, item, shown: isNewest });
  for (const key of ["seq", "id", "kind", "team", "caller", "verdict", "nullified", "retagged", "scoring"]) {
    setData(li, key, item[key]);
  }
  setData(li, "result", resultKind(item.result));
  setData(li, "newest", isNewest);
  setText(p.time, item.time);
  setText(p.team, item.team);
  setText(p.sit, item.situation);
  setHidden(p.noPlay, !item.nullified);
  setText(p.result, item.result);
  setText(p.text, item.text);
  setHidden(p.call, !item.verdictText && !item.call);
  setText(p.verdict, item.verdictText);
  setText(p.callName, item.call);
  setHidden(p.callName, !item.call || item.call === item.text);   // hand-entered rows already read as the call
  setHidden(p.retagged, !item.retagged);
  setText(p.face, item.face || item.text || "");
}

function createGroup() {
  const team = el("span", { cls: "sc-pf-gteam" });
  const result = el("span", { cls: "sc-pf-gresult" });
  const summary = el("span", { cls: "sc-pf-gsum" });
  const rows = el("ol", { cls: "sc-pf-rows" });
  const li = el("li", { cls: "sc-pf-group" }, [el("div", { cls: "sc-pf-ghead" }, [team, result, summary]), rows]);
  GROUP_PARTS.set(li, { team, result, summary, rows });
  return li;
}

/** A group's key: its drive and its oldest row, which never changes while newer rows join the group. */
const groupKey = (g) => `${g.idx}:${g.rows.length ? g.rows[g.rows.length - 1].seq : "-"}`;

function updateGroup(li, group, ctx, newest) {
  const p = GROUP_PARTS.get(li);
  const copy = ctx.copy.PLAYS;
  setData(li, "drive", group.idx);
  setData(li, "team", group.team);
  setData(li, "caller", group.caller);
  setData(li, "complete", group.complete);
  setText(p.team, group.team);
  setText(p.result, group.complete ? group.resultText : copy.inProgress);
  setText(p.summary, group.summary);
  reconcile(p.rows, group.rows, { key: (r) => r.seq, create: () => createRow(ctx),
    update: (node, r) => updateRow(node, r, newest) });
}

/** v1.4 (W2): page the newest row when another row becomes the newest (a re-render of the same row keeps its pages);
 * measure again once the fonts have loaded, since a fallback face sets the words at other widths. */
function pageNewest(list, newest, paged, pager) {
  const control = newest === null ? null : list.querySelector(`[data-seq="${newest}"]`)?.firstChild ?? null;
  if (control === paged.control) return;
  paged.control = control;
  paged.resize?.disconnect();
  paged.resize = null;
  if (!control) {
    pager.stop();
    return;
  }
  if (!paged.held()) pager.start(control);
  // G5-10: measure again whenever the face changes width (fonts landing, a resize), not only once
  const RO = list.ownerDocument?.defaultView?.ResizeObserver;
  if (typeof RO === "function") {
    let first = true;
    paged.resize = new RO(() => {
      if (first) { first = false; return; }               // the observer's first call is the size it starts at
      if (paged.control === control && control.isConnected && !paged.held()) pager.start(control);
    });
    paged.resize.observe(control);
  }
}

/** Reduced motion (the app's <html data-motion>, which follows the OS setting): the ribbon never pages. */
function motionOn(root) {
  return root.ownerDocument?.documentElement?.getAttribute?.("data-motion") !== "reduced";
}

/**
 * @param {HTMLElement} root  #rg-plays
 * @param {{ copy: object, timers?: object, measureRibbon?: Function }} ctx
 *   timers, measureRibbon: injected by tests (v1.4, W2); the page uses the browser's timers and layout
 * @returns {{ update(vm: object): void, destroy(): void }}
 */
export function mount(root, ctx) {
  const copy = ctx.copy.PLAYS;
  const title = el("h2", { cls: "sc-panel-title", text: copy.heading });
  const note = el("p", { cls: "sc-pf-unlinked", data: { testid: "unlinked-note" } });
  const empty = el("p", { cls: "sc-pf-empty", text: copy.empty });
  const list = el("ol", { cls: "sc-pf-feed", attrs: { "aria-label": copy.heading }, data: { testid: "play-feed" } });
  const box = el("div", { cls: "sc-plays" }, [title, note, empty, list]);
  const timers = ctx.timers ?? browserTimers;
  const pager = createPager({ timers, measure: ctx.measureRibbon ?? measureWords, apply: applyPage,
    enabled: () => motionOn(root) });
  const hover = { on: false };
  const paged = { control: null, resize: null, held: () => hover.on };
  // When the pointer leaves (a world may unroll the feed under it), measure the newest play again on the next task,
  // once the row is back on its one line. While it is unrolled, the face isn't shown: no page turns.
  const settleTimers = new Set();
  const settle = () => {
    const id = timers.setTimeout(() => {
      settleTimers.delete(id);
      if (paged.control?.isConnected && !paged.held()) pager.start(paged.control);
    }, 0);
    settleTimers.add(id);
  };
  const enter = () => {
    hover.on = true;
    pager.stop();
  };
  const leave = () => {
    hover.on = false;
    settle();
  };
  root.addEventListener("pointerenter", enter);
  root.addEventListener("pointerleave", leave);
  root.appendChild(box);
  return {
    update(vm) {
      setText(title, vm.heading);
      setAttr(list, "aria-label", vm.heading);
      setText(note, vm.unlinkedNote);
      setHidden(note, !vm.unlinkedNote);
      setHidden(empty, vm.rows.length > 0);
      const newest = vm.rows.length ? vm.rows[0].seq : null;
      reconcile(list, vm.groups, { key: groupKey, create: () => createGroup(),
        update: (node, g) => updateGroup(node, g, ctx, newest) });
      pageNewest(list, newest, paged, pager);
    },
    destroy() {
      root.removeEventListener("pointerenter", enter);
      root.removeEventListener("pointerleave", leave);
      for (const id of settleTimers) timers.clearTimeout(id);
      settleTimers.clear();
      paged.resize?.disconnect();
      pager.stop();
      box.remove();
    },
  };
}
