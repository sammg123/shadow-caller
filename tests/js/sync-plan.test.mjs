import assert from "node:assert/strict";
import test from "node:test";

import { BACKOFF, POLL_MS, connState, nextDelay, planTick, retryDelay } from "../../static/js/core/sync-plan.js";
import { loadJson } from "./fixtures.mjs";

const local = (over = {}) => ({ epoch: "k3v9-2", n: 104, version: 412, feedOn: false, feedState: "off", needsFull: false, ...over });
const ver = (over = {}) => ({ version: 412, epoch: "k3v9-2", timeline_n: 104,
  feed: { state: "off", on: false, last_poll: "21:13:07", last_play: "...", plays_logged: 36, skipped: null },
  watch: { state: "playing", idx: 104, total: 183, speed: 4, next_at: 1791504012345 }, ...over });

test("the DC E4 cadence and the backoff constants", () => {
  assert.deepEqual({ ...POLL_MS }, { playing: 250, normal: 1000, hidden: 5000 });
  assert.deepEqual({ ...BACKOFF }, { baseMs: 1000, factor: 2, maxMs: 15000, offlineAfter: 3 });
});

test("the version fixture is the DC E4 body", () => {
  const v = loadJson("version_watch_playing.json");
  assert.deepEqual(Object.keys(v).sort(), ["epoch", "feed", "timeline_n", "version", "watch"]);
  assert.equal(v.watch.state, "playing");
  assert.equal(nextDelay({ watchState: v.watch.state, hidden: false, failures: 0 }), 250);
});

test("planTick: a new epoch or a shrinking n refetches from 0; a bigger n appends (DC E4)", () => {
  assert.deepEqual(planTick(local(), ver({ epoch: "k3v9-3", timeline_n: 2 })).timeline, { since: 0, epoch: null });
  assert.deepEqual(planTick(local(), ver({ timeline_n: 101 })).timeline, { since: 0, epoch: null });
  assert.deepEqual(planTick(local(), ver({ timeline_n: 107 })).timeline, { since: 104, epoch: "k3v9-2" });
  assert.equal(planTick(local(), ver()).timeline, null);
  assert.deepEqual(planTick(local({ epoch: null, n: 0 }), ver()).timeline, { since: 0, epoch: null }, "first fetch");
  assert.deepEqual(planTick(local({ needsFull: true }), ver()).timeline, { since: 0, epoch: null }, "a gap refetches");
});

test("planTick: an old server without epoch never asks for the timeline", () => {
  const { epoch, timeline_n: _n, ...old } = ver();
  assert.equal(epoch, "k3v9-2");
  assert.equal(planTick(local(), old).timeline, null);
});

test("planTick.state: version, feed.on or feed.state changes refetch; last_poll alone does not (#95)", () => {
  assert.equal(planTick(local(), ver()).state, false);
  assert.equal(planTick(local(), ver({ feed: { ...ver().feed, last_poll: "21:13:11", last_play: "new" } })).state, false);
  assert.equal(planTick(local(), ver({ version: 413 })).state, true);
  assert.equal(planTick(local(), ver({ version: 411 })).state, true, "undo may lower it: compare with !==, never > (G8)");
  assert.equal(planTick(local(), ver({ version: 1 })).state, true, "reset restarts at 1");
  assert.equal(planTick(local(), ver({ feed: { ...ver().feed, on: true } })).state, true);
  assert.equal(planTick(local(), ver({ feed: { ...ver().feed, state: "error" } })).state, true);
  assert.equal(planTick(local({ version: undefined }), ver()).state, true, "no state yet");
  assert.equal(planTick(local(), ver({ feed: undefined })).state, false, "a missing feed is not a change");
});

test("planTick follows a realistic sequence of version bodies", () => {
  const seq = [
    [{ epoch: null, n: 0, version: undefined }, ver({ epoch: "a", timeline_n: 3, version: 5 }), { since: 0, epoch: null }, true],
    [{ epoch: "a", n: 3, version: 5 }, ver({ epoch: "a", timeline_n: 5, version: 7 }), { since: 3, epoch: "a" }, true],
    [{ epoch: "a", n: 5, version: 7 }, ver({ epoch: "a", timeline_n: 5, version: 7 }), null, false],
    [{ epoch: "a", n: 5, version: 7 }, ver({ epoch: "b", timeline_n: 0, version: 1 }), { since: 0, epoch: null }, true],
    [{ epoch: "b", n: 0, version: 1 }, ver({ epoch: "b", timeline_n: 0, version: 1 }), null, false],
  ];
  for (const [loc, v, timeline, state] of seq) {
    assert.deepEqual(planTick(local(loc), v), { timeline, state }, JSON.stringify(loc));
  }
});

test("nextDelay: backoff 1, 2, 4, 8, 15 s; hidden 5 s; playing 250 ms; else 1 s", () => {
  const d = (failures, extra = {}) => nextDelay({ watchState: "idle", hidden: false, failures, ...extra });
  assert.deepEqual([1, 2, 3, 4, 5, 9].map((f) => d(f)), [1000, 2000, 4000, 8000, 15000, 15000]);
  assert.equal(d(0), 1000);
  assert.equal(d(0, { hidden: true }), 5000);
  assert.equal(d(0, { watchState: "playing" }), 250);
  assert.equal(d(0, { watchState: "playing", hidden: true }), 5000, "a hidden tab never polls fast");
  assert.equal(d(1, { hidden: true }), 5000, "a hidden tab never retries faster than 5 s");
  assert.equal(d(5, { hidden: true }), 15000);
  assert.equal(retryDelay(0), 0);
  assert.equal(retryDelay(3), 4000);
});

test("connState: online, then retrying, then offline after 3 failures (G11)", () => {
  assert.deepEqual([0, 1, 2, 3, 10].map((failures) => connState({ failures })),
    ["online", "retrying", "retrying", "offline", "offline"]);
});
