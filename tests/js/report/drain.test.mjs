// The Model Report has no field to draw on (static/js/report/drain.js): every timeline row counts as drawn as soon as
// it arrives, through the store's own anim events, so the app's presentation gating (core/present.js) shows each new
// state at once and the report follows a game live with the app's own sync.
import assert from "node:assert/strict";
import test from "node:test";
import { reducer, initialState } from "../../../static/js/core/reducer.js";
import { createStore } from "../../../static/js/core/store.js";
import { attachDrain, nextDrainEvent } from "../../../static/js/report/drain.js";
import { loadJson, timelineBody } from "../fixtures.mjs";

const NOW = 1791504000000;
const tl = () => loadJson("timeline_tb_dal.json");
const finalState = () => loadJson("state_tb_dal_final.json");

test("the next event: finish a rebuild, land the playing row, start the queue's head, else nothing", () => {
  assert.deepEqual(nextDrainEvent({ token: 3, rebuilding: true, playing: null, queue: [] }),
    { type: "anim/rebuilt", token: 3 });
  assert.deepEqual(nextDrainEvent({ token: 3, rebuilding: false, playing: { seq: 9 }, queue: [] }),
    { type: "anim/done", seq: 9, token: 3 });
  assert.deepEqual(nextDrainEvent({ token: 3, rebuilding: false, playing: null, queue: [{ seq: 10 }, { seq: 11 }] }),
    { type: "anim/started", seq: 10, token: 3, durationMs: 0 });
  assert.equal(nextDrainEvent({ token: 3, rebuilding: false, playing: null, queue: [] }), null);
});

test("a whole game arrives: every row counts as drawn and the state is presented at once", () => {
  const store = createStore(reducer, initialState());
  const detach = attachDrain(store, () => NOW);
  const body = tl();
  store.dispatch({ type: "timeline/loaded", resp: timelineBody(body, { rows: body.rows }), origin: "poll", now: NOW });
  const server = { ...finalState(), timeline: { epoch: body.epoch, n: body.n, source: "espn" } };
  store.dispatch({ type: "state/loaded", body: server, origin: "poll", reqSeq: 0, now: NOW });
  const s = store.getState();
  assert.equal(s.anim.drawnThrough, 183);
  assert.equal(s.anim.rebuilding, false);
  assert.equal(s.presented, s.server, "presented without waiting for a field");
  detach();
});

test("rows that arrive later (a live game) are drawn and presented as they come", () => {
  const store = createStore(reducer, initialState());
  attachDrain(store, () => NOW);
  const body = tl();
  store.dispatch({ type: "timeline/loaded", resp: timelineBody(body, { rows: body.rows.slice(0, 100), n: 100 }),
    origin: "poll", now: NOW });
  assert.equal(store.getState().anim.drawnThrough, 100);
  store.dispatch({ type: "timeline/loaded", origin: "poll", now: NOW,
    resp: timelineBody(body, { since: 100, rows: body.rows.slice(100, 104), n: 104 }) });
  const s = store.getState();
  assert.deepEqual([s.anim.drawnThrough, s.anim.queue.length, s.anim.playing], [104, 0, null]);
});

test("attaching drains what is already waiting, and detaching stops it", () => {
  const store = createStore(reducer, initialState());
  const body = tl();
  store.dispatch({ type: "timeline/loaded", resp: timelineBody(body, { rows: body.rows.slice(0, 50), n: 50 }),
    origin: "poll", now: NOW });
  store.dispatch({ type: "timeline/loaded", origin: "poll", now: NOW,
    resp: timelineBody(body, { since: 50, rows: body.rows.slice(50, 60), n: 60 }) });
  assert.equal(store.getState().anim.queue.length, 10, "nothing drains without the report's drain");
  const detach = attachDrain(store, () => NOW);
  assert.equal(store.getState().anim.drawnThrough, 60);
  detach();
  store.dispatch({ type: "timeline/loaded", origin: "poll", now: NOW,
    resp: timelineBody(body, { since: 60, rows: body.rows.slice(60, 62), n: 62 }) });
  assert.equal(store.getState().anim.queue.length, 2);
});
