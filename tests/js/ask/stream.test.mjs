// static/js/ask/stream.js: the analyst's two calls (docs/design/analyst.md section 5). askAnalyst POSTs a question,
// hands each tool and delta event to onEvent as it arrives and resolves with how the answer ended (done, an error the
// page can show, or aborted); it never rejects. fetchStatus reads GET /api/ask/status. Every case of the contract:
// the stream, a malformed line, a cut stream, an error after deltas, 400 and 429 JSON bodies, other refusals, a
// network failure, an abort (before, during, through the page's signal) and a stall.
import assert from "node:assert/strict";
import test from "node:test";
import { ASK_PATH, STALL_MS, STATUS_PATH, askAnalyst, fetchStatus, normalizeStatus }
  from "../../../static/js/ask/stream.js";
import { fakeTimers, fetchStub, flush, jsonResponse, line, statusBody, streamResponse } from "./helpers.mjs";

const BODY = Object.freeze({ question: "How has he done on third down?", history: [] });
const DONE = { type: "done", text: "Third down: 4 of 6 in his top 3.", cites: [{ seq: 31, ref: "Q2 3:10" }] };

function ask(replies, opts = {}) {
  const { fetchImpl, calls } = fetchStub(replies);
  const events = [];
  const timers = opts.timers ?? fakeTimers();
  const pending = askAnalyst({ fetchImpl, body: BODY, timers, onEvent: (e) => events.push(e), ...opts });
  return { pending, events, calls, timers };
}

test("the question goes out as JSON to /api/ask, asking for NDJSON, never cached", async () => {
  const { pending, calls } = ask([streamResponse({ chunks: [line(DONE)] }).response]);
  await pending;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, ASK_PATH);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.equal(calls[0].init.headers.Accept, "application/x-ndjson");
  assert.deepEqual(calls[0].body, BODY);
  assert.ok(calls[0].init.signal, "the request can be aborted");
});

test("tool and delta events reach onEvent as they arrive; done resolves with the text and the cites", async () => {
  const chunks = [line({ type: "tool", name: "list_plays", label: "Looking through the plays" }),
    line({ type: "delta", text: "Third down: " }), line({ type: "delta", text: "4 of 6." }), line(DONE)];
  const { pending, events, timers } = ask([streamResponse({ chunks }).response]);
  const outcome = await pending;
  assert.deepEqual(events.map((e) => e.type), ["tool", "delta", "delta"]);
  assert.deepEqual(outcome, { type: "done", text: DONE.text, cites: DONE.cites, malformed: 0 });
  assert.equal(timers.pending.size, 0, "the stall timer is cleared");
});

test("a malformed line is skipped and counted; the answer still lands", async () => {
  const { pending } = ask([streamResponse({ chunks: [line({ type: "delta", text: "A" }), "<html>\n", line(DONE)] })
    .response]);
  const outcome = await pending;
  assert.equal(outcome.type, "done");
  assert.equal(outcome.malformed, 1);
});

test("an error event after some deltas ends the answer with the server's own words, worth asking again", async () => {
  const message = "The analyst took too long to answer. Try a shorter or narrower question.";
  const { pending, events } = ask([streamResponse({ chunks: [line({ type: "delta", text: "So far" }),
    line({ type: "error", message })] }).response]);
  const outcome = await pending;
  assert.deepEqual(events, [{ type: "delta", text: "So far" }]);
  assert.deepEqual(outcome, { type: "error", reason: "server", message, retry: true, malformed: 0 });
});

test("a stream cut with no done is an error that says the answer stopped", async () => {
  const { pending } = ask([streamResponse({ chunks: [line({ type: "delta", text: "Half" })] }).response]);
  const outcome = await pending;
  assert.equal(outcome.type, "error");
  assert.equal(outcome.reason, "cut");
  assert.equal(outcome.retry, true);
  assert.match(outcome.message, /stopped before it finished/);
});

test("a connection that drops mid-stream is a cut answer too", async () => {
  const { pending } = ask([streamResponse({ chunks: [line({ type: "delta", text: "Half" })], end: "error" }).response]);
  const outcome = await pending;
  assert.equal(outcome.reason, "cut");
});

test("400: the server's plain reason, not worth asking again as is", async () => {
  const { pending } = ask([jsonResponse(400, { error: "Ask in at most 500 characters." })]);
  assert.deepEqual(await pending, { type: "error", reason: "refused", message: "Ask in at most 500 characters.",
    retry: false });
});

test("429: the analyst is busy with another question; asking again later is fine", async () => {
  const busy = "The analyst is answering another question. Ask again when it's done.";
  const { pending } = ask([jsonResponse(429, { error: busy })]);
  assert.deepEqual(await pending, { type: "error", reason: "busy", message: busy, retry: true });
});

test("429 with no readable body still says busy", async () => {
  const { pending } = ask([jsonResponse(429, "<html>Too many</html>")]);
  const outcome = await pending;
  assert.equal(outcome.reason, "busy");
  assert.match(outcome.message, /answering another question/);
});

test("other refusals: 413 and 415 are the page's, 500 and 503 the server's, an HTML page has words too", async () => {
  const cases = [
    [jsonResponse(413, { error: "That request is too big." }), "refused", false, "That request is too big."],
    [jsonResponse(415, { error: "Send JSON (Content-Type: application/json)." }), "refused", false, null],
    [jsonResponse(500, { error: "Something went wrong in the analyst; the server log has the details." }),
      "server", true, "Something went wrong in the analyst; the server log has the details."],
    [jsonResponse(503, "<html>Service Unavailable</html>"), "server", true, null],
    [jsonResponse(404, { error: "Not Found" }), "missing", false, null],
  ];
  for (const [response, reason, retry, message] of cases) {
    const outcome = await ask([response]).pending;
    assert.equal(outcome.type, "error");
    assert.equal(outcome.reason, reason, `${response.status}`);
    assert.equal(outcome.retry, retry, `${response.status}`);
    if (message) assert.equal(outcome.message, message);
    assert.ok(outcome.message.length > 10, `${response.status} has words`);
    assert.doesNotMatch(outcome.message, /<html>/, "never an HTML page on screen");
  }
});

test("a network failure says the app server can't be reached", async () => {
  const { pending } = ask([new TypeError("Failed to fetch")]);
  const outcome = await pending;
  assert.equal(outcome.type, "error");
  assert.equal(outcome.reason, "network");
  assert.equal(outcome.retry, true);
  assert.match(outcome.message, /Can't reach the app server/);
});

test("aborting before the request goes out sends nothing", async () => {
  const ctl = new AbortController();
  ctl.abort();
  const { pending, calls } = ask([streamResponse({ chunks: [line(DONE)] }).response], { signal: ctl.signal });
  assert.deepEqual(await pending, { type: "aborted" });
  assert.equal(calls.length, 0);
});

test("aborting mid-answer (the panel closed, the page left) stops the read and resolves aborted", async () => {
  const ctl = new AbortController();
  const stream = streamResponse({ chunks: [line({ type: "delta", text: "A" })], end: "hang" });
  const { pending, events, calls, timers } = ask([stream.response], { signal: ctl.signal });
  await flush();
  assert.equal(events.length, 1);
  ctl.abort();
  assert.deepEqual(await pending, { type: "aborted" });
  assert.equal(calls[0].init.signal.aborted, true, "the fetch itself is aborted");
  assert.equal(timers.pending.size, 0);
});

test("aborting while the request is still on its way resolves aborted even when fetch ignores the signal", async () => {
  const ctl = new AbortController();
  const { pending } = ask([() => new Promise(() => {})], { signal: ctl.signal });
  await flush();
  ctl.abort();
  assert.deepEqual(await pending, { type: "aborted" });
});

test("a stream that goes quiet past the stall time is stopped and says so; each chunk re-arms the timer", async () => {
  const stream = streamResponse({ chunks: [line({ type: "delta", text: "A" })], end: "hang" });
  const { pending, timers } = ask([stream.response]);
  await flush();
  assert.equal(timers.pending.size, 1);
  const armed = [...timers.pending.values()][0];
  assert.equal(armed.ms, STALL_MS);
  stream.push(line({ type: "delta", text: "B" }));
  await flush();
  assert.equal(timers.pending.size, 1, "re-armed, not stacked");
  timers.fireAll();
  const outcome = await pending;
  assert.equal(outcome.type, "error");
  assert.equal(outcome.reason, "stall");
  assert.equal(outcome.retry, true);
});

test("a stall before the server answers at all is a stall too", async () => {
  const { pending, timers } = ask([() => new Promise(() => {})]);
  await flush();
  timers.fireAll();
  assert.equal((await pending).reason, "stall");
});

test("a body the browser can't stream is read whole", async () => {
  const text = async () => [line({ type: "delta", text: "A" }), line(DONE)].join("");
  const response = { status: 200, body: null, text };
  const { pending, events } = ask([response]);
  const outcome = await pending;
  assert.equal(outcome.type, "done");
  assert.deepEqual(events, [{ type: "delta", text: "A" }]);
});

test("askAnalyst needs fetch and timers", async () => {
  await assert.rejects(() => askAnalyst({ body: BODY, timers: fakeTimers() }), TypeError);
  await assert.rejects(() => askAnalyst({ fetchImpl: async () => null, body: BODY }), TypeError);
});

// ---------------------------------------------------------------- GET /api/ask/status
test("normalizeStatus keeps the contract's fields as booleans, text and null", () => {
  assert.deepEqual(normalizeStatus(statusBody({ warm: false })), { ready: true, ollama: true, installed: true,
    warm: false, busy: false, model: "gpt-oss:20b", message: null });
  const down = normalizeStatus({ ready: false, ollama: false, installed: "yes", warm: 1, busy: null, model: 7,
    message: "The analyst needs Ollama running with gpt-oss:20b. Start Ollama, then ask again." });
  assert.equal(down.ready, false);
  assert.equal(down.installed, false, "only true is true");
  assert.equal(down.warm, false);
  assert.equal(down.model, "");
  assert.match(down.message, /Start Ollama/);
  assert.equal(normalizeStatus(null), null);
  assert.equal(normalizeStatus([1]), null);
  assert.ok(normalizeStatus({ ready: true, message: "x".repeat(900) }).message.length <= 300);
});

test("fetchStatus reads the status, uncached", async () => {
  const { fetchImpl, calls } = fetchStub([jsonResponse(200, statusBody({ busy: true }))]);
  const result = await fetchStatus({ fetchImpl, timers: fakeTimers() });
  assert.equal(calls[0].url, STATUS_PATH);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(result.ok, true);
  assert.equal(result.status.busy, true);
});

test("fetchStatus never throws: offline, no analyst on this server, a bad body, a timeout", async () => {
  const offline = await fetchStatus({ fetchImpl: fetchStub([new TypeError("Failed to fetch")]).fetchImpl,
    timers: fakeTimers() });
  assert.equal(offline.ok, false);
  assert.equal(offline.code, "offline");
  assert.match(offline.message, /Can't reach the app server/);
  const missing = await fetchStatus({ fetchImpl: fetchStub([jsonResponse(404, { error: "Not Found" })]).fetchImpl,
    timers: fakeTimers() });
  assert.equal(missing.code, "missing");
  assert.match(missing.message, /no analyst/i);
  const bad = await fetchStatus({ fetchImpl: fetchStub([jsonResponse(200, "[]")]).fetchImpl, timers: fakeTimers() });
  assert.equal(bad.code, "offline");
  const timers = fakeTimers();
  const pending = fetchStatus({ fetchImpl: fetchStub([() => new Promise(() => {})]).fetchImpl, timers });
  await flush();
  timers.fireAll();
  assert.equal((await pending).code, "offline");
});
