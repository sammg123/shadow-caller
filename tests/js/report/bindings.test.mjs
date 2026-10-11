// The Model Report's component table (static/js/report/bindings.js): every board mounts somewhere report.html has,
// loads a module with mount() (the app's own boards in a report frame), renders a view model from the saved game, and
// names the deps that re-render it. Read the way shell/mount.js and ui/scheduler.js read it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { initialState } from "../../../static/js/core/reducer.js";
import { REPORT_COMPONENTS, REPORT_IDS, retryCountdown } from "../../../static/js/report/bindings.js";
import { makePv, state, timeline, tlOf } from "../model-fixtures.mjs";

const HTML = readFileSync(fileURLToPath(new URL("../../../static/report.html", import.meta.url)), "utf8");
const inPage = (selector) => {
  const id = /^#([\w-]+)$/.exec(selector);
  if (id) return HTML.includes(`id="${id[1]}"`);
  const attr = /^\[([\w-]+)="([^"]+)"\]$/.exec(selector);
  return Boolean(attr) && HTML.includes(`${attr[1]}="${attr[2]}"`);
};

test("every board mounts on a root report.html has, and every id the page promises is there", () => {
  assert.equal(REPORT_COMPONENTS.length, 13);
  for (const spec of REPORT_COMPONENTS) {
    for (const key of ["name", "region", "root", "label", "load", "select", "deps"]) {
      assert.ok(spec[key], `${spec.name}.${key}`);
    }
    assert.ok(inPage(spec.root), `${spec.name}: ${spec.root} is not in report.html`);
  }
  for (const id of REPORT_IDS) assert.ok(HTML.includes(`id="${id}"`), id);
  assert.deepEqual(REPORT_COMPONENTS.filter((s) => s.fallback).map((s) => s.name), ["boot-screen"]);
});

test("every board's module loads and can mount", async () => {
  const mods = await Promise.all(REPORT_COMPONENTS.map((spec) => spec.load()));
  mods.forEach((mod, i) => assert.equal(typeof mod.mount, "function", REPORT_COMPONENTS[i].name));
});

test("every board renders a view model from the saved game, and names its deps", () => {
  const pv = makePv({ presented: state.final(), tl: tlOf(timeline.final()) });
  const s = initialState();
  for (const spec of REPORT_COMPONENTS) {
    assert.ok(spec.select(pv), spec.name);
    assert.ok(Array.isArray(spec.deps(s, { now: 0, extras: {} })), spec.name);
  }
});

test("a retry countdown ticks in whole seconds, 0 while none is pending", () => {
  const conn = (retryAt) => ({ conn: { retryAt } });
  assert.equal(retryCountdown(conn(null), { now: 1000 }), 0);
  assert.equal(retryCountdown(conn(4000), { now: 1000 }), 3);
  assert.equal(retryCountdown(conn(4001), { now: 1000 }), 4);
  assert.equal(retryCountdown(conn(500), { now: 1000 }), 0);
});
