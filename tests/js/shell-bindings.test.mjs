// shell/bindings.js (ui-architecture.md 9.1; owner A0): the component table main.js mounts and binds.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { presentedView } from "../../static/js/core/present.js";
import { initialState, reducer } from "../../static/js/core/reducer.js";
import { COMPONENTS, SHELL_IDS, inputModeDeps, retryCountdown } from "../../static/js/shell/bindings.js";
import { NOW, state as states, timeline as timelines } from "./model-fixtures.mjs";

const INDEX = readFileSync(new URL("../../static/index.html", import.meta.url), "utf8");

/** A real store state: the replayed game's timeline drawn, then a state fixture presented. */
function realState(body) {
  let s = initialState();
  s = reducer(s, { type: "timeline/loaded", resp: timelines.final(), origin: "poll", hidden: false, reducedMotion: true, now: NOW });
  s = reducer(s, { type: "anim/rebuilt", token: s.anim.token, now: NOW });
  s = reducer(s, { type: "state/loaded", body, origin: "poll", reqSeq: 0, now: NOW });
  return reducer(s, { type: "tick", now: NOW + 5000 });
}

test("the table mounts every component of 9.1, in order", () => {
  assert.deepEqual(COMPONENTS.map((c) => c.name), ["boot-screen", "conn-banner", "toast", "masthead", "feed-bar",
    "scoreboard", "situation-strip", "field-host", "review-banner", "watch-transport", "prediction", "entry-pad",
    "last-play", "shorthand", "flag-panel", "play-feed", "drive-chart", "win-prob", "scorecard", "box-score",
    "tendencies", "play-log"]);
  assert.ok(Object.isFrozen(COMPONENTS) && COMPONENTS.every(Object.isFrozen));
});

test("every entry has a root in index.html, a label, a loader, a select and deps", () => {
  for (const c of COMPONENTS) {
    const id = /^#([\w-]+)$/.exec(c.root)?.[1];
    const mount = /^\[data-mount="([\w-]+)"\]$/.exec(c.root)?.[1];
    assert.ok(id ? INDEX.includes(`id="${id}"`) : INDEX.includes(`data-mount="${mount}"`), `${c.name}: ${c.root}`);
    assert.equal(typeof c.label, "string");
    assert.ok(c.label.length > 2, c.name);
    for (const fn of ["load", "select", "deps"]) assert.equal(typeof c[fn], "function", `${c.name}.${fn}`);
    assert.match(c.region, /^[a-z]+$/);
  }
  assert.deepEqual(COMPONENTS.filter((c) => c.fallback).map((c) => [c.name, c.fallback]),
    [["boot-screen", "boot"], ["toast", "toast"]]);
});

test("on the replayed game every binding's deps are a list and its view model builds", () => {
  for (const body of [states.final(), states.drive(), states.feedOn()]) {
    const s = realState(body);
    assert.ok(s.presented, "the fixture state is presented");
    const env = { now: NOW + 5000, extras: { cameraModes: [{ id: "sideline", label: "Sideline" }] } };
    const pv = { ...presentedView(s, env.now), ...env.extras };
    for (const c of COMPONENTS) {
      assert.ok(Array.isArray(c.deps(s, env)), c.name);
      c.select(pv);
    }
  }
});

test("view models also build before anything has loaded (boot)", () => {
  const s = initialState();
  const env = { now: NOW, extras: {} };
  const pv = presentedView(s, NOW);
  for (const c of COMPONENTS) {
    assert.ok(Array.isArray(c.deps(s, env)), c.name);
    c.select(pv);
  }
});

test("deps ignore what a view does not read: a version poll alone does not re-render the play log", () => {
  const s = realState(states.final());
  const env = { now: NOW, extras: {} };
  const log = COMPONENTS.find((c) => c.name === "play-log");
  const feed = COMPONENTS.find((c) => c.name === "feed-bar");
  const polled = reducer(s, { type: "version/loaded", body: { version: 1, feed: { on: false } }, now: NOW + 1 });
  const same = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  assert.ok(same(log.deps(s, env), log.deps(polled, env)));
  assert.equal(same(feed.deps(s, env), feed.deps(polled, env)), false);
});

test("inputModeDeps changes only with the watch state or the feed switch", () => {
  const s = realState(states.final());
  const a = inputModeDeps(s);
  const polled = reducer(s, { type: "version/loaded", body: { version: 1, feed: { on: false }, watch: null }, now: NOW + 1 });
  assert.deepEqual(inputModeDeps(polled), a);
  const on = reducer(s, { type: "version/loaded", body: { version: 1, feed: { on: true } }, now: NOW + 2 });
  assert.notDeepEqual(inputModeDeps(on), a);
});

test("the retry countdown dep is the seconds the text shows, and 0 while no retry is pending", () => {
  const idle = initialState();
  assert.equal(retryCountdown(idle, { now: NOW }), 0);
  const failing = reducer(idle, { type: "conn/failed", now: NOW, error: "x", retryAt: NOW + 4000 });
  assert.deepEqual([0, 1, 1001, 3999, 4000, 9000].map((dt) => retryCountdown(failing, { now: NOW + dt })), [4, 4, 3, 1, 0, 0]);
  const conn = COMPONENTS.find((c) => c.name === "conn-banner");
  assert.notEqual(conn.deps(failing, { now: NOW, extras: {} })[1], conn.deps(failing, { now: NOW + 1001, extras: {} })[1]);
});

test("SHELL_IDS are exactly the ids index.html provides", () => {
  const ids = [...INDEX.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1]).filter((id) => id !== "world-css");
  assert.deepEqual([...SHELL_IDS].sort(), ids.sort());
});

// v1.2 (A8, additive): the play feed, drive chart and play log mark the reviewed play, so they follow the cursor.
test("the play feed, the drive chart and the play log re-render when the review cursor moves; the box does not", () => {
  const s = realState(states.final());
  const env = { now: NOW, extras: {} };
  const reviewed = reducer(s, { type: "review/set", seq: 104 });
  const same = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  for (const name of ["play-feed", "drive-chart", "play-log"]) {
    const c = COMPONENTS.find((x) => x.name === name);
    assert.equal(same(c.deps(s, env), c.deps(reviewed, env)), false, name);
  }
  const box = COMPONENTS.find((c) => c.name === "box-score");
  assert.ok(same(box.deps(s, env), box.deps(reviewed, env)));
});
