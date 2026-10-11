// static/js/ask/ndjson.js: the NDJSON reader for POST /api/ask (docs/design/analyst.md section 5). One JSON event per
// line, read incrementally: a line split across chunks, several events in one chunk, a malformed line, CRLF, a
// character split across chunks, a last line with no newline, a stream cut with no done, an error after deltas, a
// stream that fails mid-read, events after the end, and an abort.
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCites, normalizeEvent, parseLine, readEvents, readText, splitLines }
  from "../../../static/js/ask/ndjson.js";
import { enc, line, streamResponse } from "./helpers.mjs";

const TOOL = { type: "tool", name: "list_plays", label: "Looking through the plays" };
const DONE = { type: "done", text: "He ran it on 3rd and 1.", cites: [{ seq: 104, ref: "Q3 10:51" }] };

async function read(chunks, opts = {}) {
  const events = [];
  const { response } = streamResponse({ chunks, end: opts.end ?? "close" });
  const result = await readEvents(response.body, { onEvent: (e) => events.push(e), ...opts });
  return { events, result };
}

test("splitLines keeps the unfinished tail for the next chunk and drops a CR before the newline", () => {
  assert.deepEqual(splitLines("", '{"a":1}\n{"b"'), { lines: ['{"a":1}'], rest: '{"b"' });
  assert.deepEqual(splitLines('{"b"', ':2}\r\n'), { lines: ['{"b":2}'], rest: "" });
  assert.deepEqual(splitLines("", "\n\n"), { lines: ["", ""], rest: "" });
  assert.deepEqual(splitLines("ab", "cd"), { lines: [], rest: "abcd" });
});

test("parseLine: an event, a blank line skipped, bad JSON or a non-object malformed, an unknown type skipped", () => {
  assert.deepEqual(parseLine(JSON.stringify(TOOL)), { kind: "event", event: TOOL });
  assert.deepEqual(parseLine("   "), { kind: "skip" });
  assert.deepEqual(parseLine("{not json"), { kind: "malformed" });
  assert.deepEqual(parseLine("42"), { kind: "malformed" });
  assert.deepEqual(parseLine('["delta"]'), { kind: "malformed" });
  assert.deepEqual(parseLine('{"type":"thinking","text":"x"}'), { kind: "skip" });
  assert.deepEqual(parseLine('{"text":"no type"}'), { kind: "skip" });
});

test("normalizeEvent checks each event's fields and caps what the screen shows", () => {
  assert.deepEqual(normalizeEvent({ type: "delta", text: "Hi" }), { type: "delta", text: "Hi" });
  assert.equal(normalizeEvent({ type: "delta", text: "" }), null, "an empty delta adds nothing");
  assert.equal(normalizeEvent({ type: "delta", text: 3 }), null);
  const tool = normalizeEvent({ type: "tool", name: "scorecard", label: "x".repeat(300) });
  assert.equal(tool.name, "scorecard");
  assert.ok(tool.label.length <= 80, "a tool label is capped");
  assert.equal(normalizeEvent({ type: "tool", name: "drives" }).label, "Looking it up", "a missing label has words");
  assert.deepEqual(normalizeEvent({ type: "done", text: " Fine. ", cites: "nope" }),
    { type: "done", text: "Fine.", cites: [] });
  assert.deepEqual(normalizeEvent({ type: "done" }), { type: "done", text: "", cites: [] });
  assert.equal(normalizeEvent({ type: "error", message: "Start Ollama." }).message, "Start Ollama.");
  assert.match(normalizeEvent({ type: "error" }).message, /went wrong in the analyst/, "a bare error still has words");
  assert.equal(normalizeEvent({ type: "nope" }), null);
  assert.equal(normalizeEvent(null), null);
});

test("normalizeCites keeps whole-number seqs with a text ref, once each, in order, at most 12", () => {
  const raw = [{ seq: 104, ref: "Q3 10:51" }, { seq: 104, ref: "Q3 10:51" }, { seq: "7", ref: "Q1 2:00" },
    { seq: -1, ref: "Q1 1:00" }, { seq: 2.5, ref: "Q1 1:00" }, { seq: 9 }, null, { seq: 12, ref: "  OT   4:10 " }];
  assert.deepEqual(normalizeCites(raw), [{ seq: 104, ref: "Q3 10:51" }, { seq: 12, ref: "OT 4:10" }]);
  const many = Array.from({ length: 20 }, (_, i) => ({ seq: i + 1, ref: `Q1 ${i}:00` }));
  assert.equal(normalizeCites(many).length, 12);
  assert.deepEqual(normalizeCites(undefined), []);
});

test("a line split across chunks arrives whole", async () => {
  const text = line({ type: "delta", text: "He ran it." });
  const { events, result } = await read([text.slice(0, 9), text.slice(9, 20), text.slice(20), line(DONE)]);
  assert.deepEqual(events, [{ type: "delta", text: "He ran it." }]);
  assert.equal(result.terminal.type, "done");
});

test("several events in one chunk arrive in order, and the reader stops at done", async () => {
  const late = { type: "delta", text: "late" };
  const chunk = [TOOL, { type: "delta", text: "A" }, { type: "delta", text: "B" }, DONE, late].map(line).join("");
  const seen = [];
  const { events, result } = await read([chunk], { onChunk: () => seen.push("chunk") });
  assert.deepEqual(events.map((e) => e.type), ["tool", "delta", "delta"], "nothing after done reaches the page");
  assert.deepEqual(result.terminal, { type: "done", text: DONE.text, cites: DONE.cites });
  assert.equal(result.malformed, 0);
  assert.deepEqual(seen, ["chunk"], "onChunk hears every chunk (the stall timer re-arms on it)");
});

test("a malformed line is counted and skipped; the answer still ends with done", async () => {
  const { events, result } = await read([line({ type: "delta", text: "A" }), "{oops\n", "\n", line(DONE)]);
  assert.deepEqual(events, [{ type: "delta", text: "A" }]);
  assert.equal(result.terminal.type, "done");
  assert.equal(result.malformed, 1);
});

test("CRLF line endings and a last line with no newline both count", async () => {
  const { events, result } = await read([`${JSON.stringify({ type: "delta", text: "A" })}\r\n`, JSON.stringify(DONE)]);
  assert.deepEqual(events, [{ type: "delta", text: "A" }]);
  assert.equal(result.terminal.type, "done");
});

test("a character split across two chunks decodes once whole", async () => {
  const bytes = enc(line({ type: "delta", text: "Dak’s pass, é" }));
  const cut = bytes.indexOf(0xe2) + 1;          // inside the three bytes of the curly apostrophe
  const { events } = await read([bytes.slice(0, cut), bytes.slice(cut), line(DONE)]);
  assert.deepEqual(events, [{ type: "delta", text: "Dak’s pass, é" }]);
});

test("a stream cut with no done or error ends with no terminal event (the caller says it was cut)", async () => {
  const { events, result } = await read([line(TOOL), line({ type: "delta", text: "Half an ans" })]);
  assert.equal(events.length, 2);
  assert.equal(result.terminal, null);
  assert.equal(result.failure, undefined);
});

test("an error after some deltas is the terminal event; the deltas came first", async () => {
  const error = { type: "error", message: "The analyst took too long to answer. Try a shorter or narrower question." };
  const { events, result } = await read([line({ type: "delta", text: "So far he" }), line(error)]);
  assert.deepEqual(events, [{ type: "delta", text: "So far he" }]);
  assert.deepEqual(result.terminal, error);
});

test("a stream that fails mid-read reports the failure after the events it delivered", async () => {
  const { events, result } = await read([line({ type: "delta", text: "A" })], { end: "error" });
  assert.deepEqual(events, [{ type: "delta", text: "A" }]);
  assert.equal(result.terminal, null);
  assert.ok(result.failure instanceof Error);
});

test("an abort stops a stream that is still open, at once", async () => {
  const ctl = new AbortController();
  const stream = streamResponse({ chunks: [line({ type: "delta", text: "A" })], end: "hang" });
  const events = [];
  const pending = readEvents(stream.response.body, { onEvent: (e) => { events.push(e); ctl.abort(); },
    signal: ctl.signal });
  const result = await pending;
  assert.equal(result.aborted, true);
  assert.equal(result.terminal, null);
  assert.deepEqual(events, [{ type: "delta", text: "A" }]);
});

test("an abort before the first read returns at once", async () => {
  const ctl = new AbortController();
  ctl.abort();
  const stream = streamResponse({ chunks: [line(DONE)], end: "hang" });
  const result = await readEvents(stream.response.body, { signal: ctl.signal });
  assert.equal(result.aborted, true);
});

test("readText reads a whole body at once (a browser with no streaming body)", () => {
  const events = [];
  const result = readText([line(TOOL), "junk\n", line({ type: "delta", text: "A" }), line(DONE)].join(""),
    { onEvent: (e) => events.push(e) });
  assert.deepEqual(events.map((e) => e.type), ["tool", "delta"]);
  assert.equal(result.terminal.type, "done");
  assert.equal(result.malformed, 1);
  assert.equal(readText("", {}).terminal, null);
});
