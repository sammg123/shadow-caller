// The game picker's HTTP client (static/js/picker/picker-api.js): GET /api/games and GET /api/games/resolve, with the
// server's own reason when it refuses, and plain words when the app server can't be reached. fetch and the timers are
// injected, as in core/api.js.
import assert from "node:assert/strict";
import test from "node:test";
import { PICKER_ROUTES, PickerError, pickerApi } from "../../../static/js/picker/picker-api.js";

function fakeFetch(answers) {
  const calls = [];
  const fetchImpl = async (path, init) => {
    calls.push({ path, init });
    const answer = typeof answers === "function" ? answers(path) : answers;
    if (answer instanceof Error) throw answer;
    return { status: answer.status, text: async () => answer.text };
  };
  return { fetchImpl, calls };
}

const timers = { setTimer: (fn, ms) => ({ fn, ms }), clearTimer: () => {} };
const api = (answers) => {
  const fake = fakeFetch(answers);
  return { ...fake, client: pickerApi({ fetchImpl: fake.fetchImpl, ...timers }) };
};

test("games: the season listing, asked for fresh every time", async () => {
  const { client, calls } = api({ status: 200, text: JSON.stringify({ season: 2026, weeks: [] }) });
  assert.deepEqual(await client.games(), { season: 2026, weeks: [] });
  assert.equal(calls[0].path, PICKER_ROUTES.games);
  assert.deepEqual([calls[0].init.method, calls[0].init.cache], ["GET", "no-store"]);
});

test("resolve: the ref goes in the query, encoded; the answer is the game", async () => {
  const ref = "https://www.espn.com/nfl/game/_/gameId/401872980?a=1&b=2";
  const { client, calls } = api({ status: 200, text: JSON.stringify({ game: { event_id: "401872980" } }) });
  assert.deepEqual(await client.resolve(`  ${ref} `), { event_id: "401872980" });
  assert.equal(calls[0].path, `${PICKER_ROUTES.resolve}?ref=${encodeURIComponent(ref)}`);
});

test("resolve: nothing typed never reaches the server", async () => {
  const { client, calls } = api({ status: 200, text: "{}" });
  await assert.rejects(client.resolve("   "), (err) => err instanceof PickerError
    && err.message === "Paste an ESPN game link or id first.");
  assert.equal(calls.length, 0);
});

test("a refusal carries the server's reason; anything else says what happened in plain words", async () => {
  const refused = api({ status: 400, text: JSON.stringify({ error: "That address isn't on espn.com." }) });
  await assert.rejects(refused.client.resolve("evil.example"), (err) => err.message === "That address isn't on espn.com."
    && err.status === 400);
  const missing = api({ status: 404, text: JSON.stringify({ error: "ESPN has no game with id 123." }) });
  await assert.rejects(missing.client.resolve("123"), { message: "ESPN has no game with id 123." });
  const html = api({ status: 502, text: "<html>bad gateway</html>" });
  await assert.rejects(html.client.games(), { message: "The app server answered 502." });
  const down = api(new TypeError("Failed to fetch"));
  await assert.rejects(down.client.games(), { message: "Can't reach the app server." });
  const notJson = api({ status: 200, text: "<html>" });
  await assert.rejects(notJson.client.games(), { message: "The app server's answer wasn't readable." });
  const noGame = api({ status: 200, text: JSON.stringify({ game: "x" }) });
  await assert.rejects(noGame.client.resolve("401872980"), { message: "The app server's answer wasn't readable." });
  const long = api({ status: 400, text: JSON.stringify({ error: "x".repeat(900) }) });
  await assert.rejects(long.client.resolve("1"), (err) => err.message.length <= 300);
});

test("a request that takes too long is aborted with a plain message", async () => {
  let fire = null;
  const fetchImpl = (path, init) => new Promise((_, reject) => {
    init.signal.addEventListener("abort", () => reject(new Error("aborted")));
  });
  const client = pickerApi({ fetchImpl, setTimer: (fn) => { fire = fn; return 1; }, clearTimer: () => {} });
  const pending = client.games();
  fire();
  await assert.rejects(pending, { message: "The schedule took too long to load. Try again." });
});
