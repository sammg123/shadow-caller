import test from "node:test";
import assert from "node:assert/strict";
import { lastPlayVm, retagButtons } from "../../static/js/model/vm-last-play.js";
import { makePv, state, patch, isDeepFrozen } from "./model-fixtures.mjs";

const buttons = (vm) => vm.buttons.map((b) => [b.key, b.label, b.tone, b.current]);
const feedOnWith = (log) => patch(state.feedOn(), { log });

test("hidden while plays are entered by hand", () => {
  assert.equal(lastPlayVm(makePv({ presented: state.final() })).hidden, true);
  assert.equal(lastPlayVm(makePv()).hidden, true);
});

test("feed on: the last ESPN play with its retag keys (#96)", () => {
  const vm = lastPlayVm(makePv({ presented: state.feedOn() }));
  assert.deepEqual([vm.hidden, vm.kind, vm.heading, vm.name, vm.yardsText],
    [false, "play", "Last play from ESPN", "Short (0–9 air yds), turnover", "0 yds"]);
  assert.equal(vm.text, state.feedOn().log[0].feed_text);
  assert.deepEqual(buttons(vm), [
    ["A", "Play-action", "pass", false], ["N", "Screen", "pass", false], ["O", "RPO, thrown", "pass", false],
    ["P", "Plain dropback", "pass", true],
  ]);
});

test("waiting for the first play (#100)", () => {
  const vm = lastPlayVm(makePv({ presented: feedOnWith([]) }));
  assert.deepEqual([vm.kind, vm.heading, vm.text], ["waiting", "Waiting for the first DAL play",
    "Plays appear here a few seconds after ESPN posts them."]);
  assert.deepEqual([...vm.buttons], []);
});

test("shows the row a retag edits: newest standing row of any source (G19)", () => {
  const log = state.feedOn().log;
  const typed = { ...log[0], seq: 60, source: "manual", feed_text: null, name: "Inside run (A/B gap)", family: "run",
    leaf: "run_inside", dropback: 0, turnover: false, td: true, yards: 4 };
  const vm = lastPlayVm(makePv({ presented: feedOnWith([typed, ...log]) }));
  assert.deepEqual([vm.heading, vm.name, vm.yardsText, vm.text],
    ["Last play (entered by hand)", "Inside run (A/B gap), TD", "4 yds", ""]);
  const skipped = lastPlayVm(makePv({ presented: feedOnWith([{ ...log[0], nullified: true }, ...log.slice(1)]) }));
  assert.equal(skipped.name, log[1].name);
});

test("retagged rows say so (#97)", () => {
  const log = state.feedOn().log;
  const vm = lastPlayVm(makePv({ presented: feedOnWith([{ ...log[0], retagged: true, family: "pa",
    name: "PA short (0–9)", turnover: false }, ...log.slice(1)]) }));
  assert.equal(vm.yardsText, "0 yds · retagged");
  assert.deepEqual(vm.buttons.filter((b) => b.current).map((b) => b.key), ["A"]);
});

test("run rows offer O, J, K, L and only O can be current", () => {
  const run = { dropback: 0, family: "run" };
  assert.deepEqual(retagButtons(run).map((b) => [b.key, b.label, b.tone, b.current]), [
    ["O", "RPO, handed off", "rpo", false], ["J", "Left (again: edge)", "run", false], ["K", "Inside", "run", false],
    ["L", "Right (again: edge)", "run", false],
  ]);
  assert.equal(retagButtons({ dropback: 0, family: "rpo" })[0].current, true);
  assert.deepEqual([...retagButtons(null)], []);
});

test("during a watch the panel shows even with the feed off", () => {
  const vm = lastPlayVm(makePv({ presented: state.final(), version: { watch: { state: "paused" } } }));
  assert.deepEqual([vm.hidden, vm.heading], [false, "Last play from ESPN"]);
  assert.ok(isDeepFrozen(vm));
});
