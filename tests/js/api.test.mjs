import assert from "node:assert/strict";
import test from "node:test";

import { ApiError, POST_PATHS, ROUTES, TIMEOUTS, createApi } from "../../static/js/core/api.js";
import { browserLike, browserTimers } from "./fixtures.mjs";

function response(status, body, { json = true } = {}) {
  const text = json ? JSON.stringify(body) : String(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text };
}

function stubFetch(handler) {
  const calls = [];
  const fetchImpl = (url, init = {}) => {
    calls.push({ url, init });
    return Promise.resolve(handler(url, init));
  };
  return { fetchImpl, calls };
}

function fakeTimers() {
  const pending = new Map();
  let next = 1;
  return {
    setTimeout: (fn, ms) => { const id = next++; pending.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => pending.delete(id),
    fireAll: () => { for (const [id, t] of [...pending]) { pending.delete(id); t.fn(); } },
    pending,
  };
}

const kindOf = async (p) => p.then(() => "resolved", (e) => (e instanceof ApiError ? `${e.kind}:${e.status}` : e.name));

test("the timeouts and the POST allowlist: playback only, never a manual-entry endpoint (restructure-v2.md 1, 9)", () => {
  assert.deepEqual({ ...TIMEOUTS }, { version: 4000, state: 8000, timeline: 8000, post: 30000 });
  assert.deepEqual([...POST_PATHS].sort(), ["/api/golive", "/api/open", "/api/watch/back", "/api/watch/forward",
    "/api/watch/pause", "/api/watch/resume", "/api/watch/seek", "/api/watch/speed"]);
  assert.equal(ROUTES.open, "/api/open");
  assert.equal(ROUTES.seek, "/api/watch/seek");
  assert.equal(ROUTES.golive, "/api/golive");
  for (const manual of ["/api/play", "/api/penalty", "/api/situation", "/api/command", "/api/undo", "/api/retag",
    "/api/reset", "/api/feed", "/api/feed/replay"]) {
    assert.ok(!POST_PATHS.includes(manual), `${manual}: the page never sends user input into the game`);
  }
});

test("Go Live's 503 (ESPN unreachable) resolves with its plain message, like a 409 (restructure-v2.md 9)", async () => {
  const { fetchImpl } = stubFetch(() => response(503, { error: "ESPN can't be reached right now." }));
  const api = createApi({ fetchImpl });
  assert.deepEqual(await api.post("/api/golive", {}), { status: 503, body: { error: "ESPN can't be reached right now." } });
});

test("GETs return the parsed body and never cache", async () => {
  const { fetchImpl, calls } = stubFetch(() => response(200, { version: 7 }));
  const api = createApi({ fetchImpl });
  assert.deepEqual(await api.getVersion(), { version: 7 });
  assert.deepEqual(await api.getState(), { version: 7 });
  assert.deepEqual(await api.getWatch(), { version: 7 });
  assert.deepEqual(calls.map((c) => c.url), ["/api/version", "/api/state", "/api/watch"]);
  assert.equal(calls[0].init.cache, "no-store");
  assert.ok(calls[0].init.signal, "every request can be aborted");
});

test("getTimeline builds since and the URI-encoded epoch, and validates since", async () => {
  const { fetchImpl, calls } = stubFetch(() => response(200, { n: 0 }));
  const api = createApi({ fetchImpl });
  await api.getTimeline(100, "k3v9-2");
  await api.getTimeline(0, null);
  await api.getTimeline(5, "a b&c");
  assert.deepEqual(calls.map((c) => c.url), ["/api/timeline?since=100&epoch=k3v9-2", "/api/timeline?since=0",
    "/api/timeline?since=5&epoch=a%20b%26c"]);
  for (const bad of [-1, 1.5, "3", Number.NaN, null]) assert.throws(() => api.getTimeline(bad, null), TypeError, String(bad));
  assert.equal(calls.length, 3, "invalid calls never reach the network");
});

test("post sends JSON and resolves 200, 400 and 409 with their bodies", async () => {
  const replies = { "/api/watch/seek": response(200, { message: "Seeked." }),
    "/api/watch/speed": response(400, { error: "Speed must be 0.5 to 10", sit: {} }),
    "/api/watch/back": response(409, { error: "Already at kickoff." }) };
  const { fetchImpl, calls } = stubFetch((url) => replies[url]);
  const api = createApi({ fetchImpl });
  assert.deepEqual(await api.post("/api/watch/seek", { idx: 3 }), { status: 200, body: { message: "Seeked." } });
  assert.deepEqual(await api.post("/api/watch/speed", { speed: 99 }),
    { status: 400, body: { error: "Speed must be 0.5 to 10", sit: {} } });
  assert.deepEqual(await api.post("/api/watch/back", {}), { status: 409, body: { error: "Already at kickoff." } });
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.equal(calls[0].init.body, '{"idx":3}');
});

test("an unknown POST path or a non-object body throws before any request", () => {
  const { fetchImpl, calls } = stubFetch(() => response(200, {}));
  const api = createApi({ fetchImpl });
  assert.throws(() => api.post("/api/nope", {}), TypeError);
  assert.throws(() => api.post("/api/open", null), TypeError);
  assert.throws(() => api.post("/api/open", [1]), TypeError);
  assert.equal(calls.length, 0);
});

test("an HTML 500, a 404, a bad JSON body or a JSON array reject with ApiError (#121)", async () => {
  const api = (r) => createApi({ fetchImpl: stubFetch(() => r).fetchImpl });
  assert.equal(await kindOf(api(response(500, "<html>boom</html>", { json: false })).post("/api/open", {})), "http:500");
  assert.equal(await kindOf(api(response(500, "<html>boom</html>", { json: false })).getState()), "http:500");
  assert.equal(await kindOf(api(response(404, { error: "x" })).getVersion()), "http:404");
  assert.equal(await kindOf(api(response(200, "Unexpected <", { json: false })).getState()), "bad-json:200");
  assert.equal(await kindOf(api(response(400, "<p>x</p>", { json: false })).post("/api/open", {})), "bad-json:400");
  assert.equal(await kindOf(api(response(200, [1, 2])).getVersion()), "bad-json:200");
  const err = await api(response(503, "down", { json: false })).getState().catch((e) => e);
  assert.equal(err.path, "/api/state");
  assert.match(err.message, /503/);
});

test("a network failure rejects with kind network", async () => {
  const api = createApi({ fetchImpl: () => Promise.reject(new TypeError("Failed to fetch")) });
  assert.equal(await kindOf(api.getVersion()), "network:null");
  const thrower = createApi({ fetchImpl: () => { throw new TypeError("sync failure"); } });
  assert.equal(await kindOf(thrower.post("/api/open", {})), "network:null");
});

test("a request past its timeout aborts and rejects with kind timeout", async () => {
  const timers = fakeTimers();
  let signal;
  const fetchImpl = (_url, init) => { signal = init.signal; return new Promise(() => {}); };
  const api = createApi({ fetchImpl, timers });
  const p = api.getVersion();
  assert.equal([...timers.pending.values()][0].ms, TIMEOUTS.version);
  timers.fireAll();
  assert.equal(await kindOf(p), "timeout:null");
  assert.equal(signal.aborted, true);
});

test("a finished request clears its timer", async () => {
  const timers = fakeTimers();
  const api = createApi({ fetchImpl: stubFetch(() => response(200, {})).fetchImpl, timers });
  await api.post("/api/open", {});
  assert.equal(timers.pending.size, 0);
  assert.throws(() => createApi({}), TypeError, "fetchImpl is required");
});

test("fetch and the timers are called bare (Chromium throws 'Illegal invocation' on method calls)", async () => {
  const timers = browserTimers(fakeTimers());
  const { fetchImpl, calls } = stubFetch(() => response(200, { version: 3 }));
  const api = createApi({ fetchImpl: browserLike(fetchImpl), timers });
  assert.deepEqual(await api.getVersion(), { version: 3 });
  assert.deepEqual(await api.post("/api/open", {}), { status: 200, body: { version: 3 } });
  assert.equal(calls.length, 2);
  assert.equal(timers.pending.size, 0, "each request cleared its timer");
});

test("createApi rejects timers without setTimeout and clearTimeout", () => {
  const { fetchImpl } = stubFetch(() => response(200, {}));
  assert.throws(() => createApi({ fetchImpl, timers: {} }), TypeError);
});
