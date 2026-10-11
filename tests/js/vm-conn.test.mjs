import test from "node:test";
import assert from "node:assert/strict";
import { makePv, NOW, isDeepFrozen } from "./model-fixtures.mjs";

const load = () => import("../../static/js/model/vm-conn.js");
const plain = (vm) => ({ ...vm });

test("online, retrying, then offline after three failures (G11)", async () => {
  const { connVm } = await load();
  assert.deepEqual(plain(connVm(makePv())), { state: "online", text: "", retryInS: null, retryLabel: "Retry now" });
  assert.deepEqual(plain(connVm(makePv({ conn: { failures: 1, retryAt: NOW + 1000 } }))),
    { state: "retrying", text: "Reconnecting…", retryInS: 1, retryLabel: "Retry now" });
  assert.deepEqual(plain(connVm(makePv({ conn: { failures: 3, retryAt: NOW + 4200 } }))),
    { state: "offline", text: "Can't reach the app server. Retrying in 5 s.", retryInS: 5, retryLabel: "Retry now" });
});

test("a retry that is due says so instead of counting down from zero", async () => {
  const { connVm } = await load();
  const vm = connVm(makePv({ conn: { failures: 4, retryAt: NOW - 50 } }));
  assert.deepEqual([vm.retryInS, vm.text], [0, "Can't reach the app server. Retrying now."]);
});

test("boot screens: loading, failed with a countdown, restart (#119, #120)", async () => {
  const { bootVm } = await load();
  const loading = bootVm(makePv({ boot: { phase: "loading", attempts: 1 } }));
  assert.deepEqual([loading.phase, loading.hidden, loading.heading], ["loading", false, "Loading the game…"]);
  const failed = bootVm(makePv({ boot: { phase: "failed", attempts: 2, error: "network" }, conn: { retryAt: NOW + 2500 } }));
  assert.deepEqual([failed.heading, failed.text, failed.retryLabel],
    ["Can't reach the app server", "Retrying in 3 s.", "Retry now"]);
  const restart = bootVm(makePv({ boot: { phase: "restart" } }));
  assert.equal(restart.heading, "Restart the server to finish the update");
  assert.equal(restart.body.map((s) => s.text).join(""),
    "In Terminal press Ctrl+C, run bash start.sh, then refresh this page. Your logged snaps are saved.");
  assert.deepEqual(restart.body.filter((s) => s.strong).map((s) => s.text), ["bash start.sh"]);
  const ready = bootVm(makePv());
  assert.deepEqual([ready.phase, ready.hidden], ["ready", true]);
  assert.ok(isDeepFrozen(restart));
});

test("restructure-v2.md 9: once the first state is in, the page opens the game; the board says loading until then", async () => {
  const { bootPhase, bootVm } = await load();
  const opening = bootVm(makePv({ view: { playback: { kind: "open", target: null } } }));
  assert.deepEqual([opening.phase, opening.hidden, opening.heading], ["loading", false, "Loading the game…"]);
  assert.equal(bootPhase({ phase: "ready" }, { kind: "open" }), "opening");
  assert.equal(bootPhase({ phase: "ready" }, { kind: "seek" }), "ready", "only the open holds the page");
  assert.equal(bootPhase({ phase: "failed" }, { kind: "open" }), "failed");
  assert.equal(bootPhase(null, null), "loading");
});
