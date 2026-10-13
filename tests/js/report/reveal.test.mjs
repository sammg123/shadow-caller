// static/js/report/ui/reveal.js: the way to one call on the Model Report (a drive button, an analyst's cite;
// docs/design/analyst-ui.md 5). The call's row scrolls in under its drive's row, takes focus and is lit for a moment;
// a second reveal moves the light; a play with no row lights its drive on the drive chart. On the real calls board and
// drive chart, mounted on the fake DOM with the saved game.
import assert from "node:assert/strict";
import test from "node:test";
import { reportDrivesVm } from "../../../static/js/report/model/drives.js";
import { callsVm } from "../../../static/js/report/model/vm-calls.js";
import { framed } from "../../../static/js/report/ui/framed.js";
import { mount as mountCalls } from "../../../static/js/report/ui/calls.js";
import { CITED_MS, callRow, createRevealer, driveItem } from "../../../static/js/report/ui/reveal.js";
import * as DriveChart from "../../../static/js/ui/drive-chart.js";
import { fakeCtx, inDoc, makePv, regionRoot, state, timeline, tlOf } from "../game-surfaces-harness.mjs";

/** Timers the test runs by hand: fire(ms) runs whatever is due. */
function fakeTimers() {
  const due = new Map();
  let now = 0;
  let next = 1;
  return {
    setTimeout: (fn, ms) => { due.set(next, { fn, at: now + ms }); next += 1; return next - 1; },
    clearTimeout: (id) => { due.delete(id); },
    advance(ms) {
      now += ms;
      for (const [id, t] of [...due]) if (t.at <= now) { due.delete(id); t.fn(); }
    },
    pending: () => due.size,
  };
}

/** The calls board and the drive chart with the saved game; every node records its scrollIntoView calls. */
function page(doc) {
  const pv = makePv({ presented: state.final(), tl: tlOf(timeline.final()) });
  const calls = mountCalls(regionRoot(doc, { id: "rp-calls" }), fakeCtx().ctx);
  calls.update(callsVm(pv));
  const chart = framed(DriveChart, { plate: (vm) => vm.heading }).mount(regionRoot(doc, { id: "rp-drives" }),
    fakeCtx().ctx);
  chart.update(reportDrivesVm(pv));
  const scrolled = [];
  const watch = (node) => { node.scrollIntoView = (opts) => scrolled.push({ node, ...opts }); };
  for (const node of doc.querySelectorAll("tr")) watch(node);
  for (const node of doc.querySelectorAll("li")) watch(node);
  return { scrolled };
}

const calls = () => timeline.final().rows.filter((r) => r.offense_is_caller && r.pred);

test("callRow: the call's own row in the calls table, never a row elsewhere, null for anything else", () => inDoc((doc) => {
  page(doc);
  const [first, second] = calls();
  assert.equal(callRow(doc, first.seq).getAttribute("data-seq"), String(first.seq));
  assert.equal(callRow(doc, second.seq).localName, "tr");
  assert.equal(callRow(doc, 15), null, "an opponent's play has no row");
  assert.equal(callRow(doc, "2"), null, "a seq is a whole number");
  assert.equal(callRow(null, first.seq), null);
}));

test("a call that opens a drive scrolls in under its drive's row, takes focus and is lit for a moment", () => inDoc((doc) => {
  const { scrolled } = page(doc);
  const timers = fakeTimers();
  const reveal = createRevealer(doc, { motion: () => "full", timers });
  const first = calls()[0];
  assert.equal(reveal.show(first.seq), true);
  const row = callRow(doc, first.seq);
  assert.equal(scrolled.length, 1);
  assert.equal(scrolled[0].node.getAttribute("class"), "rp-drive-row", "its drive's row comes in with it");
  assert.deepEqual([scrolled[0].block, scrolled[0].behavior], ["start", "smooth"]);
  assert.equal(doc.activeElement, row, "focus on the row, so a screen reader reads it");
  assert.equal(row.getAttribute("data-cited"), "true");
  timers.advance(CITED_MS - 1);
  assert.equal(row.getAttribute("data-cited"), "true");
  timers.advance(1);
  assert.equal(row.hasAttribute("data-cited"), false, "the light goes out");
  assert.equal(timers.pending(), 0);
}));

test("a call in the middle of a drive scrolls to its own row; reduced motion jumps; a second reveal moves the light",
  () => inDoc((doc) => {
    const { scrolled } = page(doc);
    const timers = fakeTimers();
    const reveal = createRevealer(doc, { motion: () => "reduced", timers });
    const [first, second] = calls();
    assert.equal(first.drive, second.drive);
    reveal.show(first.seq);
    reveal.show(second.seq);
    assert.equal(scrolled[1].node, callRow(doc, second.seq));
    assert.equal(scrolled[1].behavior, "auto");
    assert.equal(callRow(doc, first.seq).hasAttribute("data-cited"), false, "one row lit at a time");
    assert.equal(callRow(doc, second.seq).getAttribute("data-cited"), "true");
    assert.equal(timers.pending(), 1, "the first light's timer is gone");
    reveal.destroy();
    assert.equal(callRow(doc, second.seq).hasAttribute("data-cited"), false);
    assert.equal(timers.pending(), 0);
  }));

test("a play with no row: show says so and touches nothing; its drive lights on the drive chart", () => inDoc((doc) => {
  const { scrolled } = page(doc);
  const timers = fakeTimers();
  const reveal = createRevealer(doc, { motion: () => "full", timers });
  const before = doc.activeElement;
  assert.equal(reveal.show(15), false);
  assert.deepEqual([scrolled.length, doc.activeElement, timers.pending()], [0, before, 0]);
  assert.equal(reveal.showDrive(2), true, "TB's drive, the one play 15 is in");
  const item = driveItem(doc, 2);
  assert.equal(item.getAttribute("data-team"), "TB");
  assert.deepEqual([scrolled[0].node, scrolled[0].block], [item, "center"]);
  assert.equal(item.getAttribute("data-cited"), "true");
  assert.equal(reveal.showDrive(999), false);
  timers.advance(CITED_MS);
  assert.equal(item.hasAttribute("data-cited"), false);
}));
