// The Model Report's switch between two play-callers' sections (restructure-v2.md 11 decision 4), and the way a cite
// or a drive button reaches one call (docs/design/analyst-ui.md 5). With both callers tracked the ribbon's who line is
// the switch; a press re-renders his boards (night, scorecard, hit rate, surprises, tendencies, memory, every call) at
// once while the win probability, the drives and the team stats stay the game's; a cite of the other caller's call
// switches to him first, then brings the row into view and lights it. With one caller nothing changes. The real
// bindings, mounted with shell/mount.js and rendered by ui/scheduler.js on the fake DOM, so a board that forgot the
// viewer's pick in its deps would fail here.
import assert from "node:assert/strict";
import test from "node:test";
import { REPORT_COMPONENTS } from "../../../static/js/report/bindings.js";
import { citeTarget } from "../../../static/js/report/model/cite.js";
import { REPORT_DRIVES_COPY } from "../../../static/js/report/model/drives.js";
import { headVm } from "../../../static/js/report/model/vm-head.js";
import { createMoves, createSideChoice } from "../../../static/js/report/moves.js";
import { mount as mountHead } from "../../../static/js/report/ui/head.js";
import { CITED_MS, callRow, createRevealer, driveItem } from "../../../static/js/report/ui/reveal.js";
import { loadModules, mountComponents } from "../../../static/js/shell/mount.js";
import { createScheduler } from "../../../static/js/ui/scheduler.js";
import { bothState, bothTimeline, callsOf } from "../both-sides.mjs";
import { createDocument, withDocument } from "../fake-dom.mjs";
import { all, fakeCtx, inDoc, makePv, one, regionRoot, state, text, timeline, tlOf }
  from "../game-surfaces-harness.mjs";

const bothPv = (sideChoice = null) => makePv({ presented: bothState(), tl: tlOf(bothTimeline()), sideChoice });
const onePv = () => makePv({ presented: state.final(), tl: tlOf(timeline.final()) });

// ---------------------------------------------------------------- the ribbon
test("the ribbon with two callers: no who line, the switch instead, the first named pressed until a pick", () => {
  const vm = headVm(bothPv());
  assert.equal(vm.who, "");
  assert.equal(vm.sides.shown, true);
  assert.deepEqual(vm.sides.keys.map((k) => [k.team, k.name, k.pressed]),
    [["TB", "Robinson", true], ["DAL", "Schottenheimer", false]]);
  assert.deepEqual(headVm(bothPv("DAL")).sides.keys.map((k) => k.pressed), [false, true]);
  const one = headVm(onePv());
  assert.deepEqual([one.who, one.sides.shown, one.sides.keys.length], ["Shadowing Schottenheimer · DAL", false, 0]);
});

test("the switch on the ribbon: a group of two keys, his team in the window, a press asks for his sections", () =>
  inDoc((doc) => {
    const root = regionRoot(doc, { id: "rp-head-live", tag: "div" });
    const { ctx, calls } = fakeCtx();
    const head = mountHead(root, ctx);
    head.update(headVm(bothPv()));
    assert.equal(one(root, ".rp-who").hidden, true);
    const group = one(root, ".rp-sides");
    assert.deepEqual([group.hidden, group.getAttribute("role"), group.getAttribute("aria-label")],
      [false, "group", "Whose calls the report shows"]);
    assert.equal(text(one(group, ".rp-sides-label")), "Shadowing");
    const keys = all(group, ".rp-side-key");
    assert.deepEqual(keys.map((k) => [k.localName, k.getAttribute("type"), text(one(k, ".rp-side-team")),
      text(one(k, ".sc-key-name")), k.getAttribute("aria-pressed")]),
    [["button", "button", "TB", "Robinson", "true"], ["button", "button", "DAL", "Schottenheimer", "false"]]);
    assert.deepEqual(keys.map((k) => k.textContent), ["TB Robinson", "DAL Schottenheimer"],
      "two words to a screen reader, never \"TBRobinson\"");
    assert.match(keys[1].getAttribute("title"), /^Show Brian Schottenheimer's calls \(DAL offense\)\. /);
    keys[1].focus();
    keys[1].dispatchEvent({ type: "click" });
    assert.deepEqual(calls, [["showSide", "DAL"]]);
    head.update(headVm(bothPv("DAL")));
    assert.deepEqual(all(group, ".rp-side-key"), keys, "the same keys, so focus stays on the one pressed");
    assert.equal(doc.activeElement, keys[1]);
    assert.deepEqual(keys.map((k) => k.getAttribute("aria-pressed")), ["false", "true"]);
  }));

test("one caller: the who line as before and no switch", () => inDoc((doc) => {
  const root = regionRoot(doc, { id: "rp-head-live", tag: "div" });
  const head = mountHead(root, fakeCtx().ctx);
  head.update(headVm(onePv()));
  assert.deepEqual([one(root, ".rp-who").hidden, text(one(root, ".rp-who"))], [false, "Shadowing Schottenheimer · DAL"]);
  assert.deepEqual([one(root, ".rp-sides").hidden, all(root, ".rp-side-key").length], [true, 0]);
}));

// ---------------------------------------------------------------- where a cite goes
test("citeTarget: his call (switching when it is the other caller's), else the play's drive, else nowhere", () => {
  assert.deepEqual({ ...citeTarget(bothPv(), 120) }, { seq: 120, side: null, drive: 15 }, "TB's call, TB shown");
  assert.deepEqual({ ...citeTarget(bothPv(), 104) }, { seq: 104, side: "DAL", drive: 12 }, "DAL's call: switch");
  assert.deepEqual({ ...citeTarget(bothPv("DAL"), 104) }, { seq: 104, side: null, drive: 12 });
  assert.deepEqual({ ...citeTarget(bothPv("DAL"), 113) }, { seq: 113, side: null, drive: 14 }, "a kickoff: its drive");
  assert.deepEqual({ ...citeTarget(onePv(), 15) }, { seq: 15, side: null, drive: 2 }, "one caller, TB's play");
  assert.deepEqual({ ...citeTarget(bothPv(), 9999) }, { seq: 9999, side: null, drive: null }, "not drawn yet");
  assert.deepEqual({ ...citeTarget(makePv(), 3) }, { seq: 3, side: null, drive: null }, "before the first state");
});

test("the side choice: null until a pick, a pick counts once, nothing but a team name is a pick", () => {
  const choice = createSideChoice();
  assert.equal(choice.get(), null);
  assert.equal(choice.set("DAL"), true);
  assert.equal(choice.set("DAL"), false);
  for (const bad of ["", null, 7, undefined]) assert.equal(choice.set(bad), false);
  assert.equal(choice.get(), "DAL");
});

// ---------------------------------------------------------------- the page: real bindings, scheduler and moves
const BOARDS = ["head", "night", "surprises", "calls", "drive-chart", "box-score"];
const ROOTS = [["div", "rp-live", { "data-mount": "head" }], ["section", "rp-night"], ["section", "rp-surprises"],
  ["section", "rp-calls"], ["section", "rp-drives"], ["section", "rp-box"]];

function fakeTimers() {
  const due = new Map();
  let next = 1;
  return {
    setTimeout: (fn, ms) => { due.set(next, { fn, ms }); next += 1; return next - 1; },
    clearTimeout: (id) => { due.delete(id); },
    runAll() { for (const [id, t] of [...due]) { due.delete(id); t.fn(); } },
  };
}

/** The report's boards on a fake document, rendered by the real scheduler from one presented state and timeline. */
async function reportPage(presented, body) {
  const doc = createDocument();
  for (const [tag, id, attrs = {}] of ROOTS) {
    const node = doc.createElement(tag);
    node.setAttribute("id", id);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    const plate = doc.createElement("h2");
    plate.setAttribute("class", "rp-plate");
    if (tag === "section") node.appendChild(plate);
    doc.body.appendChild(node);
  }
  const specs = REPORT_COMPONENTS.filter((s) => BOARDS.includes(s.name));
  const settled = await loadModules(specs);
  const timers = fakeTimers();
  const holder = {};
  const tl = tlOf(body);
  const moves = createMoves({ reveal: createRevealer(doc, { motion: () => "reduced", timers }),
    view: () => ({ presented, tl }), render: () => holder.scheduler.flush() });
  const actions = Object.freeze({ reviewAt: moves.revealCall, showSide: moves.showSide, retryNow() {} });
  const notices = { regionFailed: (_, spec, err) => { throw new Error(`${spec.name}: ${err.message}`); },
    componentError: (spec, err) => { throw new Error(`${spec.name}: ${err.message}`); } };
  const storeState = { presented, timeline: body, anim: { drawnThrough: body.n }, version: null,
    conn: { retryAt: null }, boot: { phase: "ready" } };
  const base = makePv({ presented, tl });
  withDocument(doc, () => {
    const ctx = Object.freeze({ actions, engine: () => null, copy: REPORT_DRIVES_COPY });
    const { bindings } = mountComponents(specs, settled, { doc, ctx, notices });
    holder.scheduler = createScheduler({ getState: () => storeState, subscribe: () => () => {} }, bindings,
      { raf: () => 0, now: () => 0, view: () => base, extras: moves.extras, onError: (err) => { throw err; } });
    holder.scheduler.start();
  });
  const act = (fn) => withDocument(doc, fn);
  const plate = (id) => text(one(doc.getElementById(id), ".rp-plate"));
  const rows = () => all(doc.getElementById("rp-calls"), "tr").filter((tr) => tr.hasAttribute("data-seq"))
    .map((tr) => Number(tr.getAttribute("data-seq")));
  const key = (team) => all(doc, ".rp-side-key").find((k) => k.getAttribute("data-team") === team);
  return { doc, moves, timers, act, plate, rows, key };
}

const seqsOf = (team) => bothTimeline().rows.filter((r) => r.offense_is_caller && r.pred && r.team === team)
  .map((r) => r.seq);

test("pressing the other caller's key switches every board of his, at once; the game's boards stay", async () => {
  const p = await reportPage(bothState(), bothTimeline());
  assert.deepEqual(p.rows(), seqsOf("TB"), "the first caller named (away) until a pick");
  assert.deepEqual([p.plate("rp-night"), p.plate("rp-calls"), p.plate("rp-surprises")],
    ["Robinson so far", "Robinson's calls v the model", "Robinson's biggest surprises"]);
  const box = text(p.doc.getElementById("rp-box"));
  const drives = all(p.doc.getElementById("rp-drives"), ".sc-dc-item").length;
  p.act(() => p.key("DAL").dispatchEvent({ type: "click" }));
  assert.deepEqual(p.rows(), seqsOf("DAL"));
  assert.equal(p.rows().length, callsOf(bothState(), "DAL").length);
  assert.deepEqual([p.plate("rp-night"), p.plate("rp-calls"), p.plate("rp-surprises")],
    ["Schottenheimer so far", "Schottenheimer's calls v the model", "Schottenheimer's biggest surprises"]);
  assert.deepEqual([p.key("TB").getAttribute("aria-pressed"), p.key("DAL").getAttribute("aria-pressed")],
    ["false", "true"]);
  assert.equal(text(p.doc.getElementById("rp-box")), box, "team stats: the whole game's");
  assert.equal(all(p.doc.getElementById("rp-drives"), ".sc-dc-item").length, drives, "drives: the whole game's");
});

test("a cite of the other caller's call switches to him, then brings the row into view and lights it", async () => {
  const p = await reportPage(bothState(), bothTimeline());
  assert.equal(p.act(() => p.moves.revealCall(104)), true);
  assert.deepEqual(p.rows(), seqsOf("DAL"), "DAL's sections now");
  const row = callRow(p.doc, 104);
  assert.deepEqual([p.doc.activeElement, row.getAttribute("data-cited")], [row, "true"]);
  assert.equal(p.key("DAL").getAttribute("aria-pressed"), "true", "the switch says so");
  p.act(() => p.timers.runAll());
  assert.equal(row.hasAttribute("data-cited"), false, "lit briefly");
  assert.equal(p.act(() => p.moves.revealCall(120)), true, "and back to TB for his");
  assert.equal(callRow(p.doc, 120).getAttribute("data-cited"), "true");
  assert.equal(p.act(() => p.moves.revealCall(113)), true, "a kickoff: nobody's call");
  assert.equal(driveItem(p.doc, 14).getAttribute("data-cited"), "true", "its drive lights on the drive chart");
  assert.deepEqual(p.rows(), seqsOf("TB"), "no switch for a play that is nobody's call");
});

test("a drive button of the other caller's drive opens his calls there", async () => {
  const p = await reportPage(bothState(), bothTimeline());
  const dalDrive = one(driveItem(p.doc, 12), "button");
  assert.equal(dalDrive.disabled ?? dalDrive.hasAttribute("disabled"), false);
  p.act(() => dalDrive.dispatchEvent({ type: "click" }));
  const first = seqsOf("DAL").find((seq) => bothTimeline().rows.find((r) => r.seq === seq).drive === 12);
  assert.equal(p.doc.activeElement, callRow(p.doc, first));
  assert.equal(p.key("DAL").getAttribute("aria-pressed"), "true");
});

test("one caller: no switch, his calls as before; a cite of the opponent's play lights its drive", async () => {
  const p = await reportPage(state.final(), timeline.final());
  assert.equal(all(p.doc, ".rp-side-key").length, 0);
  assert.equal(p.plate("rp-calls"), "Every call v the model");
  const calls = timeline.final().rows.filter((r) => r.offense_is_caller && r.pred).map((r) => r.seq);
  assert.deepEqual(p.rows(), calls);
  assert.equal(p.act(() => p.moves.revealCall(calls[3])), true);
  assert.equal(p.doc.activeElement, callRow(p.doc, calls[3]));
  assert.equal(p.act(() => p.moves.revealCall(15)), true);
  assert.equal(driveItem(p.doc, 2).getAttribute("data-cited"), "true");
  assert.equal(p.act(() => p.moves.revealCall(9999)), false, "a play the page hasn't drawn: nowhere");
});
