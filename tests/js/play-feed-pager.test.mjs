// Ribbon paging in ui/play-feed.js (v1.4, W2; surface brief unresolved #7; DESIGN.md "Ribbon boards"): a newest play
// whose words overflow its own box pages a screenful at a time, whole words only, each page held PAGE_HOLD_MS; after
// the last page it returns to the first and rests. Where rows wrap (the neutral world, an unrolled feed) nothing
// overflows and nothing pages.
import assert from "node:assert/strict";
import test from "node:test";
import { playsVm } from "../../static/js/model/vm-plays.js";
import { PAGE_HOLD_MS, createPager, mount, pagesFor, resultKind } from "../../static/js/ui/play-feed.js";
import { fakeCtx, inDoc, makePv, one, regionRoot, state, timeline, tlOf } from "./game-surfaces-harness.mjs";

/** Fake timers: setTimeout records; run() fires the pending callback due first (shortest delay, then the oldest). */
function fakeTimers() {
  let next = 1;
  const pending = new Map();
  return {
    setTimeout: (fn, ms) => { const id = next++; pending.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => { pending.delete(id); },
    run() {
      const [id, t] = [...pending.entries()].sort((a, b) => a[1].ms - b[1].ms || a[0] - b[0])[0] ?? [];
      if (id === undefined) return null;
      pending.delete(id);
      t.fn();
      return t.ms;
    },
    get size() { return pending.size; },
  };
}

const words = (...spans) => spans;

test("pagesFor: words that fit make one page; no width or no words is one page", () => {
  assert.deepEqual(pagesFor(words([0, 40], [50, 90]), 100), [{ start: 0, end: 90 }]);
  assert.deepEqual(pagesFor([], 100), [{ start: 0, end: 0 }]);
  assert.deepEqual(pagesFor(words([0, 40]), 0), [{ start: 0, end: 40 }]);
  assert.deepEqual(pagesFor(words([0, 40]), Number.NaN), [{ start: 0, end: 40 }]);
});

test("pagesFor: a page starts at the first word that would not fit whole, and ends at its last whole word", () => {
  const spans = words([0, 30], [35, 70], [75, 120], [125, 160], [165, 250], [255, 270]);
  assert.deepEqual(pagesFor(spans, 100), [
    { start: 0, end: 70 },
    { start: 75, end: 160 },
    { start: 165, end: 250 },
    { start: 255, end: 270 },
  ]);
});

test("pagesFor: a word wider than the face takes a page of its own (cut, never shrunk)", () => {
  assert.deepEqual(pagesFor(words([0, 20], [25, 180], [185, 200]), 100), [
    { start: 0, end: 20 },
    { start: 25, end: 180 },
    { start: 185, end: 200 },
  ]);
});

test("pagesFor: spans arrive in any order and a 1 px rounding never adds a page", () => {
  assert.deepEqual(pagesFor(words([50, 100.6], [0, 40]), 100), [{ start: 0, end: 100.6 }]);
});

test("the pager holds each page, steps through them once, then rests on the first", () => {
  const timers = fakeTimers();
  const applied = [];
  const pager = createPager({
    timers,
    measure: () => ({ width: 100, spans: words([0, 60], [70, 150], [160, 230]) }),
    apply: (_control, p) => applied.push({ ...p }),
  });
  pager.start("row");
  assert.deepEqual(applied.at(-1), { page: 0, pages: 3, shift: 0, cut: 60, phase: null });
  assert.equal(timers.run(), PAGE_HOLD_MS);
  assert.deepEqual(applied.at(-1), { page: 1, pages: 3, shift: -70, cut: 80, phase: "a" });
  assert.equal(timers.run(), PAGE_HOLD_MS);
  assert.deepEqual(applied.at(-1), { page: 2, pages: 3, shift: -160, cut: 70, phase: "b" });
  assert.equal(timers.run(), PAGE_HOLD_MS);
  assert.deepEqual(applied.at(-1), { page: 0, pages: 3, shift: 0, cut: 60, phase: "a" });
  assert.equal(timers.size, 0, "rests on the first page");
});

test("a message that fits never pages; a new message stops the old one and resets it", () => {
  const timers = fakeTimers();
  const applied = [];
  let spans = words([0, 50], [60, 90]);
  const pager = createPager({ timers, measure: () => ({ width: 100, spans }), apply: (c, p) => applied.push([c, p]) });
  pager.start("a");
  assert.equal(timers.size, 0);
  assert.deepEqual(applied.at(-1), ["a", { page: 0, pages: 1, shift: 0, cut: null, phase: null }]);
  spans = words([0, 80], [90, 170]);
  pager.start("b");
  assert.equal(timers.size, 1);
  pager.start("c");
  assert.equal(timers.size, 1, "the old row's timer is gone");
  assert.ok(applied.some(([c, p]) => c === "b" && p.pages === 1 && p.shift === 0), "the old row is reset");
  pager.stop();
  assert.equal(timers.size, 0);
});

test("no layout (node, a hidden tab) means one page and no timer", () => {
  const timers = fakeTimers();
  const applied = [];
  const pager = createPager({ timers, measure: () => null, apply: (_c, p) => applied.push(p) });
  pager.start("row");
  assert.equal(timers.size, 0);
  assert.equal(applied.at(-1).pages, 1);
});

test("resultKind: the result word's kind for a world's glyphs (td, turnover, flag, inc), else null", () => {
  const kinds = ["TD", "INT TD", "FUMBLE TD", "INT", "FUMBLE", "TURNOVER", "FLAG", "INC", "+8", "−11", "FG 41 GOOD",
    "PUNT 53", "SAFETY", "", null, 7].map(resultKind);
  assert.deepEqual(kinds, ["td", "td", "td", "turnover", "turnover", "turnover", "flag", "inc", null, null, null, null,
    null, null, null, null]);
});

test("every row carries data-result from its word: the first DAL snap is an incompletion, a pick is a turnover", () =>
  inDoc((doc) => {
    const root = regionRoot(doc, { id: "rg-plays" });
    const { ctx } = fakeCtx();
    const feed = mount(root, { ...ctx, timers: fakeTimers(), measureRibbon: () => null });
    feed.update(playsVm(makePv({ presented: state.final(), tl: tlOf(timeline.final(), 183) })));
    const rows = [...root.querySelectorAll('[data-testid="play-row"]')];
    const of = (seq) => rows.find((r) => r.getAttribute("data-seq") === String(seq));
    assert.equal(of(2).getAttribute("data-result"), "inc");
    const count = (kind) => rows.filter((r) => r.getAttribute("data-result") === kind).length;
    assert.ok(count("turnover") >= 1 && count("td") >= 1 && count("flag") >= 1, JSON.stringify(
      ["td", "turnover", "flag", "inc"].map((k) => [k, count(k)])));
    assert.equal(rows.filter((r) => r.getAttribute("data-kind") === "admin" && r.hasAttribute("data-result")).length, 0);
  }));

test("leaving an unrolled feed measures the newest play again, once the pointer or focus has gone", () => inDoc((doc) => {
  const root = regionRoot(doc, { id: "rg-plays" });
  const { ctx } = fakeCtx();
  const timers = fakeTimers();
  let width = 1000;   // unrolled: the row wraps, so nothing overflows
  const measure = () => ({ width, spans: words([0, 60], [70, 150]) });
  const feed = mount(root, { ...ctx, timers, measureRibbon: measure });
  feed.update(playsVm(makePv({ presented: state.final(), tl: tlOf(timeline.final(), 100) })));
  const newest = one(root, '[data-seq="100"]');
  assert.equal(newest.getAttribute("data-pages"), null);
  width = 100;        // back on the ribbon: one line, cut at the face
  root.dispatchEvent({ type: "pointerleave" });
  assert.equal(newest.getAttribute("data-pages"), null, "not while the event is still being handled");
  timers.run();
  assert.equal(newest.getAttribute("data-pages"), "2");
  root.dispatchEvent({ type: "focusout" });
  timers.run();
  assert.equal(newest.getAttribute("data-page"), "0", "a settle starts the message over");
  feed.destroy();
  root.dispatchEvent({ type: "pointerleave" });
  assert.equal(timers.size, 0, "a destroyed feed no longer listens");
}));

test("the play feed pages its newest row only, and restarts only when a newer play arrives", () => inDoc((doc) => {
  const root = regionRoot(doc, { id: "rg-plays" });
  const { ctx } = fakeCtx();
  const timers = fakeTimers();
  const measured = [];
  const measure = (control) => {
    measured.push(control.parentNode.getAttribute("data-seq"));
    return { width: 100, spans: words([0, 60], [70, 150]) };
  };
  const feed = mount(root, { ...ctx, timers, measureRibbon: measure });
  const vmAt = (drawn) => playsVm(makePv({ presented: state.final(), tl: tlOf(timeline.final(), drawn) }));
  feed.update(vmAt(100));
  feed.update(vmAt(100));
  assert.deepEqual(measured, ["100"], "a re-render of the same newest play keeps its pages");
  const newest = one(root, '[data-seq="100"]');
  assert.deepEqual([newest.getAttribute("data-page"), newest.getAttribute("data-pages")], ["0", "2"]);
  timers.run();
  assert.equal(newest.getAttribute("data-page"), "1");
  assert.equal(newest.firstChild.style.getPropertyValue("--sc-page-x"), "-70px");
  feed.update(vmAt(101));
  assert.deepEqual(measured, ["100", "101"]);
  assert.equal(newest.getAttribute("data-page"), null, "the old row is reset");
  assert.equal(newest.firstChild.style.getPropertyValue("--sc-page-x"), "");
  feed.destroy();
  assert.equal(timers.size, 0);
}));

test("G5-10: under reduced motion the newest play never pages (one page, cut at the face's edge)", () => inDoc((doc) => {
  doc.documentElement.setAttribute("data-motion", "reduced");
  const root = regionRoot(doc, { id: "rg-plays" });
  const { ctx } = fakeCtx();
  const timers = fakeTimers();
  const feed = mount(root, { ...ctx, timers, measureRibbon: () => ({ width: 100, spans: words([0, 60], [70, 150]) }) });
  feed.update(playsVm(makePv({ presented: state.final(), tl: tlOf(timeline.final(), 100) })));
  assert.equal(one(root, '[data-seq="100"]').getAttribute("data-pages"), null);
  assert.equal(timers.size, 0, "no page timer");
  feed.destroy();
}));

test("G5-10: paging holds while the feed is unrolled (pointer or keyboard) and starts over once it rolls back up", () => inDoc((doc) => {
  const root = regionRoot(doc, { id: "rg-plays" });
  const { ctx } = fakeCtx();
  const timers = fakeTimers();
  const feed = mount(root, { ...ctx, timers, measureRibbon: () => ({ width: 100, spans: words([0, 60], [70, 150]) }) });
  feed.update(playsVm(makePv({ presented: state.final(), tl: tlOf(timeline.final(), 100) })));
  const newest = one(root, '[data-seq="100"]');
  assert.equal(newest.getAttribute("data-pages"), "2");
  root.dispatchEvent({ type: "pointerenter" });
  assert.equal(timers.size, 0, "unrolled: no page turns under the pointer");
  root.dispatchEvent({ type: "pointerleave" });
  timers.run();
  assert.deepEqual([newest.getAttribute("data-page"), newest.getAttribute("data-pages")], ["0", "2"]);
  feed.destroy();
  assert.equal(timers.size, 0);
}));
