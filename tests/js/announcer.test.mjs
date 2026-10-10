// ui/announcer.js (G2-6): what assistive tech hears as the game goes. A visually hidden log speaks each newly drawn
// play ("{time} {team}. {play words}, {result}. {verdict}.") and a status line speaks mode changes ("Camera: Tight",
// "Speed 4x", "Paused", "Flag mode. Press a foul letter or Esc", "Back to live"). The pure part (announcerVm,
// announce) is tested on real store states; the DOM part on the fake DOM.
import assert from "node:assert/strict";
import test from "node:test";
import { presentedView } from "../../static/js/core/present.js";
import { initialState, reducer } from "../../static/js/core/reducer.js";
import { createStore } from "../../static/js/core/store.js";
import { announce, announcerVm, mountAnnouncer, playLine } from "../../static/js/ui/announcer.js";
import { createDocument, withDocument } from "./fake-dom.mjs";
import { loadTimeline, stateBody, stubRows, timelineBody } from "./fixtures.mjs";

const TL = loadTimeline();
const CAMERAS = Object.freeze([{ id: "wide", label: "Wide" }, { id: "tight", label: "Tight" }, { id: "blimp", label: "Blimp" }]);

/** A store with a game on it: the timeline and the /api/state that points at it (presented once drawn). */
function game() {
  const store = createStore(reducer, initialState());
  let version = 0;
  const point = (n, epoch) => {
    version += 1;
    store.dispatch({ type: "state/loaded", body: stateBody({ version, timeline: { n, epoch, source: "espn", mode: "replay" } }),
      origin: "poll", reqSeq: 0, now: 1 });
  };
  const load = (rows, epoch = TL.body.epoch) => {
    store.dispatch({ type: "timeline/loaded", resp: timelineBody(TL.body, { rows, epoch }), origin: "poll", hidden: false,
      reducedMotion: true, now: 1 });
    point(rows.at(-1)?.seq ?? 0, epoch);
  };
  const append = (rows, since, epoch = TL.body.epoch) => {
    store.dispatch({ type: "timeline/loaded", resp: timelineBody(TL.body, { rows, since, reset: false }), origin: "poll",
      hidden: false, reducedMotion: true, now: 1 });
    point(rows.at(-1).seq, epoch);
  };
  const vm = () => announcerVm({ ...presentedView(store.getState(), 1), cameraModes: CAMERAS });
  return { store, load, append, vm };
}

/** Rows drawn as the conductor would draw them (instant: reduced motion), a rebuild confirmed first. */
function drawQueued(store) {
  const { anim } = store.getState();
  if (anim.rebuilding) store.dispatch({ type: "anim/rebuilt", token: anim.token, now: 1 });
  for (let s = store.getState(); s.anim.queue.length; s = store.getState()) {
    const seq = s.anim.queue[0].seq;
    store.dispatch({ type: "anim/started", seq, token: s.anim.token, durationMs: 0, now: 1 });
    store.dispatch({ type: "anim/done", seq, token: s.anim.token, now: 1 });
  }
}

test("playLine: time, team, the play's words and result, then the verdict on his snaps", () => {
  assert.equal(playLine(TL.row(2)), "Q1 14:54 DAL. Short pass middle, incomplete. In his top 3.");
  assert.equal(playLine(TL.row(7)), "Q1 12:41 DAL. Deep pass middle, +21. Miss.");
  assert.equal(playLine(TL.row(1)), "Q1 15:00 DAL. Kickoff, return to DAL 30.", "not his snap: no verdict");
  assert.equal(playLine({ seq: 9, kind: "admin" }), "", "nothing drawn, nothing said");
  assert.equal(playLine(null), "");
});

test("a newly drawn play is spoken once; the first state or another game says nothing", () => {
  const g = game();
  const empty = announce(null, g.vm()).vm;
  g.load(TL.rows(1, 6));
  drawQueued(g.store);
  assert.deepEqual(announce(empty, g.vm()).lines, [], "boot: the game so far is not read out");
  let prev = announce(null, g.vm()).vm;
  g.append(TL.rows(7, 7), 6);
  drawQueued(g.store);
  const step = announce(prev, g.vm());
  assert.deepEqual(step.lines, ["Q1 12:41 DAL. Deep pass middle, +21. Miss."]);
  prev = step.vm;
  assert.deepEqual(announce(prev, g.vm()).lines, [], "the same state again: nothing new");
  g.load(TL.rows(1, 20), "another-epoch");
  drawQueued(g.store);
  assert.deepEqual(announce(prev, g.vm()).lines, [], "a replay or a watch start: another game, read silently");
});

test("a fresh game's first play (the client's timeline reset from n 0) is spoken", () => {
  const g = game();
  g.load([]);
  drawQueued(g.store);
  const prev = announce(null, g.vm()).vm;
  assert.equal(prev.epoch, TL.body.epoch, "an empty game is still a game on screen");
  g.load(TL.rows(1, 2));
  drawQueued(g.store);
  assert.deepEqual(announce(prev, g.vm()).lines, [playLine(TL.row(1)), playLine(TL.row(2))]);
});

test("a burst of plays (a hidden tab coming back) speaks only the newest three", () => {
  const g = game();
  g.load(stubRows(1, 1));
  drawQueued(g.store);
  const prev = announce(null, g.vm()).vm;
  g.append(TL.rows(2, 8), 1);
  drawQueued(g.store);
  const { lines } = announce(prev, g.vm());
  assert.equal(lines.length, 3);
  assert.equal(lines[2], playLine(TL.row(8)));
});

test("mode changes speak on the status line: camera, speed, pause and play, flag mode, back to live", () => {
  const base = { epoch: "e", drawnThrough: 0, rows: [], camera: "Wide", watch: { state: "playing", speed: 2 },
    flag: false, reviewing: false };
  const say = (change, from = base) => announce(from, { ...from, ...change }).status;
  assert.equal(say({ camera: "Tight" }), "Camera: Tight");
  assert.equal(say({ watch: { state: "playing", speed: 4 } }), "Speed 4x");
  assert.equal(say({ watch: { state: "paused", speed: 2 } }), "Paused");
  assert.equal(say({ watch: { state: "playing", speed: 2 } }, { ...base, watch: { state: "paused", speed: 2 } }), "Playing");
  assert.equal(say({ flag: true }), "Flag mode. Press a foul letter or Esc");
  assert.equal(say({ reviewing: false }, { ...base, reviewing: true }), "Back to live");
  assert.equal(say({ reviewing: true }), null, "entering a review: the review banner speaks for itself");
  assert.equal(say({}), null);
  assert.equal(say({ camera: "Tight", flag: true }), "Camera: Tight. Flag mode. Press a foul letter or Esc");
  assert.equal(announce(null, base).status, null, "the first state is not a change");
  assert.equal(say({ watch: { state: "idle", speed: null } }), null, "a watch that ends is the transport's to say");
});

test("announcerVm reads the store: the camera's label, the watch session, flag mode and the review", () => {
  const g = game();
  g.load(TL.rows(1, 3));
  g.store.dispatch({ type: "camera/set", id: "tight" });
  g.store.dispatch({ type: "version/loaded", body: { version: 1, epoch: TL.body.epoch, timeline_n: 3,
    watch: { state: "paused", speed: 4 }, feed: { on: false } }, now: 1 });
  g.store.dispatch({ type: "review/set", seq: 2 });
  const vm = g.vm();
  assert.equal(vm.camera, "Tight");
  assert.deepEqual(vm.watch, { state: "paused", speed: 4 });
  assert.equal(vm.reviewing, true);
  assert.equal(vm.flag, false);
  assert.equal(vm.drawnThrough, 3);
  assert.ok(Object.isFrozen(vm));
});

test("the DOM: a polite log gets one line per play, the status line its words; destroy removes both", () => {
  const doc = createDocument();
  const announcer = withDocument(doc, () => mountAnnouncer(doc));
  const log = doc.querySelector('[data-testid="announcer-log"]');
  const status = doc.querySelector('[data-testid="announcer-status"]');
  assert.deepEqual([log.getAttribute("role"), log.getAttribute("aria-live"), log.getAttribute("aria-relevant")],
    ["log", "polite", "additions"]);
  assert.deepEqual([status.getAttribute("role"), status.getAttribute("aria-live")], ["status", "polite"]);
  assert.deepEqual([log.getAttribute("class"), status.getAttribute("class")], ["sr-only", "sr-only"], "heard, not seen");
  const base = { epoch: "e", drawnThrough: 1, rows: [TL.row(1)], camera: "Wide", watch: null, flag: false, reviewing: false };
  withDocument(doc, () => {
    announcer.update(base);
    announcer.update({ ...base, drawnThrough: 2, rows: [TL.row(1), TL.row(2)], camera: "Tight" });
  });
  assert.deepEqual([...log.childNodes].map((n) => n.textContent), [playLine(TL.row(2))]);
  assert.equal(status.textContent.trim(), "Camera: Tight");
  withDocument(doc, () => {
    announcer.update({ ...base, drawnThrough: 2, rows: [TL.row(1), TL.row(2)], camera: "Wide" });
    announcer.update({ ...base, drawnThrough: 2, rows: [TL.row(1), TL.row(2)], camera: "Tight" });
  });
  assert.equal(status.textContent.trim(), "Camera: Tight");
  const reviewing = { ...base, drawnThrough: 2, rows: [TL.row(1), TL.row(2)], camera: "Tight", reviewing: true };
  withDocument(doc, () => {
    announcer.update(reviewing);
    announcer.update({ ...reviewing, reviewing: false });
  });
  const first = status.textContent;
  withDocument(doc, () => {
    announcer.update(reviewing);
    announcer.update({ ...reviewing, reviewing: false });
  });
  assert.equal(status.textContent.trim(), "Back to live");
  assert.notEqual(status.textContent, first, "the same words again still change the node, so they are heard again");
  withDocument(doc, () => announcer.destroy());
  assert.equal(doc.querySelector('[data-testid="announcer-log"]'), null);
  assert.equal(doc.querySelector('[data-testid="announcer-status"]'), null);
});

test("the log keeps the last 20 lines", () => {
  const doc = createDocument();
  const announcer = withDocument(doc, () => mountAnnouncer(doc));
  const rows = TL.rows(1, 60);
  withDocument(doc, () => {
    announcer.update({ epoch: "e", drawnThrough: 1, rows: rows.slice(0, 1), camera: null, watch: null, flag: false,
      reviewing: false });
    for (let n = 2; n <= 60; n += 1) {
      announcer.update({ epoch: "e", drawnThrough: n, rows: rows.slice(0, n), camera: null, watch: null, flag: false,
        reviewing: false });
    }
  });
  const log = doc.querySelector('[data-testid="announcer-log"]');
  assert.equal(log.childNodes.length, 20);
  assert.equal(log.lastChild.textContent, playLine(rows.filter((r) => playLine(r)).at(-1)));
});
