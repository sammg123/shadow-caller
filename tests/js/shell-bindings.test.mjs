// shell/bindings.js (ui-architecture.md 9.1; owner A0): the component table main.js mounts and binds.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { presentedView } from "../../static/js/core/present.js";
import { initialState, reducer } from "../../static/js/core/reducer.js";
import { COMPONENTS, SHELL_IDS, retryCountdown } from "../../static/js/shell/bindings.js";
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

test("the home page mounts the GameCast and the prediction only (restructure-v2.md 1), in order", () => {
  assert.deepEqual(COMPONENTS.map((c) => c.name), ["boot-screen", "conn-banner", "toast", "masthead", "view-keys",
    "watch-transport", "play-feed", "scoreboard", "field-host", "prediction", "drive-chart", "win-prob"]);
  assert.ok(Object.isFrozen(COMPONENTS) && COMPONENTS.every(Object.isFrozen));
});

test("the top bar is three components in its reading order: the nameplate, the view keys, then the playback row", () => {
  const top = COMPONENTS.filter((c) => c.root === "#rg-masthead").map((c) => c.name);
  assert.deepEqual(top, ["masthead", "view-keys", "watch-transport"]);
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
    const env = { now: NOW + 5000, extras: { cameraModes: [{ id: "wide", label: "Wide" }] } };
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

test("deps ignore what a view does not read: a version poll re-renders the playback, never the drive chart", () => {
  const s = realState(states.final());
  const env = { now: NOW, extras: {} };
  const drives = COMPONENTS.find((c) => c.name === "drive-chart");
  const transport = COMPONENTS.find((c) => c.name === "watch-transport");
  const polled = reducer(s, { type: "version/loaded", body: { version: 1, feed: { on: false } }, now: NOW + 1 });
  const same = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  assert.ok(same(drives.deps(s, env), drives.deps(polled, env)));
  assert.equal(same(transport.deps(s, env), transport.deps(polled, env)), false);
});

test("a playback request in flight re-renders the playback and the loading board, not the field host", () => {
  const s = realState(states.final());
  const env = { now: NOW, extras: {} };
  const seeking = reducer(s, { type: "playback/start", kind: "open" });
  const same = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  for (const name of ["watch-transport", "boot-screen"]) {
    const c = COMPONENTS.find((x) => x.name === name);
    assert.equal(same(c.deps(s, env), c.deps(seeking, env)), false, name);
  }
  const field = COMPONENTS.find((c) => c.name === "field-host");
  assert.ok(same(field.deps(s, env), field.deps(seeking, env)));
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
