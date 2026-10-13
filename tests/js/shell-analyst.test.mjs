// shell/analyst.js: the analyst's Ask slide-out on the GameCast (restructure-v2.md 11; analyst-ui.md 4). The drawer
// mounts in #rg-ask by dynamic import; the top bar's Ask key shows once the status says the server has an analyst
// (plain when it can answer, "Not ready" with the reason when it can't); a press opens the drawer (a double-click
// opens it once); a cite seeks the GameCast to that play (actions.seek, POST /api/watch/seek {"idx": seq}); the drawer
// opening or closing re-reads the field's insets. Runs on the fake DOM.
import assert from "node:assert/strict";
import test from "node:test";
import { STATUS_RECHECK_MS, mountAnalyst } from "../../static/js/shell/analyst.js";
import { mount as mountKeys } from "../../static/js/ui/view-keys.js";
import { Copy, chromePage, click, recordingActions } from "./chrome-ctx.mjs";
import { withDocument } from "./fake-dom.mjs";
import { fakeTimers, flush, jsonResponse, statusBody } from "./ask/helpers.mjs";

const NOT_READY = "The analyst needs Ollama running with gpt-oss:20b. Start Ollama, then ask again.";

/** fetch for the status route: each call answers the next body (the last one repeats); null answers 404. */
function statusFetch(bodies) {
  const queue = [...bodies];
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const body = queue.length > 1 ? queue.shift() : queue[0];
    return body === null ? jsonResponse(404, { error: "Not Found" }) : jsonResponse(200, body);
  };
  return { fetchImpl, calls };
}

async function setup({ bodies = [statusBody()], load } = {}) {
  const doc = chromePage([["header", "rg-masthead"], ["div", "rg-ask"]]);
  const { actions, calls } = recordingActions();
  withDocument(doc, () => mountKeys(doc.getElementById("rg-masthead"),
    Object.freeze({ actions, engine: () => null, copy: Copy, reportHref: "/report", settingsId: null })));
  const notices = [];
  const insets = [];
  const rt = { engine: { setSafeArea: (v) => insets.push(v) } };
  const timers = fakeTimers();
  const fetch = statusFetch(bodies);
  const handle = await withDocument(doc, () => mountAnalyst(doc, { actions, rt,
    notices: { show: (id, text) => notices.push([id, text]) }, fetchImpl: fetch.fetchImpl, timers, now: () => 0,
    ...(load ? { load } : {}) }));
  await withDocument(doc, () => flush());
  const key = doc.querySelector('[data-testid="ask"]');
  return { doc, actions, calls, notices, insets, timers, fetch, handle, key, run: (fn) => withDocument(doc, fn) };
}

const keyValue = (key) => key.querySelector(".sc-key-value").textContent;

test("the drawer mounts in #rg-ask, closed; the Ask key shows once the analyst says it can answer", async () => {
  const t = await setup();
  const drawer = t.doc.getElementById("rg-ask").querySelector(".sc-ask");
  assert.ok(drawer, "the drawer is in its host");
  assert.equal(drawer.hidden, true);
  assert.equal(t.key.hidden, false);
  assert.equal(t.key.getAttribute("data-status"), "ready");
  assert.equal(keyValue(t.key), "");
  assert.equal(t.key.getAttribute("title"), "Ask the analyst about the game, his calls or the model");
  assert.deepEqual([t.key.getAttribute("aria-controls"), t.key.getAttribute("aria-expanded")], ["sc-ask", "false"]);
  assert.equal(t.timers.pending.size, 0, "ready: nothing more to check while the drawer is closed");
});

test("not ready: the key still shows, says so in words and gives the reason; a press opens the drawer", async () => {
  const t = await setup({ bodies: [statusBody({ ready: false, ollama: false, message: NOT_READY })] });
  assert.equal(t.key.hidden, false);
  assert.equal(t.key.getAttribute("data-status"), "down");
  assert.equal(keyValue(t.key), "Not ready");
  assert.equal(t.key.getAttribute("title"), NOT_READY);
  await t.run(async () => {
    click(t.key);
    await flush();
  });
  const drawer = t.doc.querySelector(".sc-ask");
  assert.equal(drawer.hidden, false);
  assert.equal(t.key.getAttribute("aria-expanded"), "true");
  assert.equal(drawer.querySelector(".sc-ask-note").textContent, NOT_READY, "the drawer says what to do");
});

test("while it can't answer, the key checks again every so often and lights once it can", async () => {
  const t = await setup({ bodies: [statusBody({ ready: false, message: NOT_READY }), statusBody()] });
  const recheck = [...t.timers.pending.values()].filter((p) => p.ms === STATUS_RECHECK_MS);
  assert.equal(recheck.length, 1);
  t.timers.fire(STATUS_RECHECK_MS);
  await t.run(() => flush());
  assert.equal(t.key.getAttribute("data-status"), "ready");
  assert.equal(keyValue(t.key), "");
  assert.equal([...t.timers.pending.values()].filter((p) => p.ms === STATUS_RECHECK_MS).length, 0);
});

test("a server with no analyst keeps the key hidden; a drawer that won't load leaves a notice", async () => {
  const none = await setup({ bodies: [null] });
  assert.equal(none.key.hidden, true);
  const broken = await setup({ load: () => Promise.reject(new Error("no module")) });
  assert.equal(broken.key.hidden, true);
  assert.equal(broken.doc.querySelector(".sc-ask"), null);
  assert.deepEqual(broken.notices.map(([id]) => id), ["ask"]);
  assert.match(broken.notices[0][1], /no module/);
});

test("a cite seeks the GameCast to that play; anything but a play's number does nothing", async () => {
  const t = await setup();
  const root = t.doc.querySelector(".sc-ask");
  root.dispatchEvent({ type: "sc:ask-cite", detail: { seq: 104, ref: "Q3 2:52" } });
  for (const detail of [{ seq: -1 }, { seq: 2.5 }, { seq: "104" }, null]) root.dispatchEvent({ type: "sc:ask-cite", detail });
  assert.deepEqual(t.calls, [["seek", 104]]);
});

test("the drawer opening or closing re-reads the field's insets, so the camera keeps the play clear of it", async () => {
  const t = await setup();
  await t.run(async () => {
    click(t.key);
    await flush();
    click(t.key);
    await flush();
  });
  assert.deepEqual(t.insets, [null, null]);
});

test("a double-click on the Ask key opens the drawer once, never opens and shuts it", async () => {
  const t = await setup();
  await t.run(async () => {
    t.key.dispatchEvent({ type: "click", detail: 1 });
    t.key.dispatchEvent({ type: "click", detail: 2 });
    await flush();
  });
  assert.equal(t.doc.querySelector(".sc-ask").hidden, false);
});

test("closing the drawer reads the status again, so the key keeps up", async () => {
  const t = await setup({ bodies: [statusBody(), statusBody(), statusBody({ ready: false, message: NOT_READY })] });
  await t.run(async () => {
    click(t.key);
    await flush();
    click(t.key);
    await flush();
  });
  assert.equal(t.key.getAttribute("data-status"), "down");
  assert.equal(keyValue(t.key), "Not ready");
  t.handle.destroy();
  assert.equal(t.doc.querySelector(".sc-ask"), null);
  assert.equal(t.timers.pending.size, 0, "destroy stops the checks");
});
