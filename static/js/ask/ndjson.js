// The NDJSON reader for POST /api/ask (docs/design/analyst.md section 5; docs/design/analyst-ui.md). Pure*: no DOM; it
// reads a body it is handed. One JSON object per line: {"type":"tool","name","label"} while a tool runs,
// {"type":"delta","text"} pieces of the answer, then exactly one {"type":"done","text","cites"} or
// {"type":"error","message"}. Read incrementally: a line can be split across chunks (and a character across two),
// a chunk can hold several lines, a malformed line is counted and skipped, and the first done or error ends the read.
// Every string an event carries is checked and capped here; the page shows them as text, never as markup.
import { ASK } from "./copy.js";

const TEXT_MAX = 20000;      // one delta or a done's text (the model stops at 2,048 tokens)
const LABEL_MAX = 80;        // a tool's label ("Looking through the plays")
const NAME_MAX = 60;         // a tool's name
const MESSAGE_MAX = 300;     // an error's message
const REF_MAX = 16;          // a cite's ref ("2OT 10:51")
export const CITES_MAX = 12;

const SKIP = Object.freeze({ kind: "skip" });
const MALFORMED = Object.freeze({ kind: "malformed" });
const ABORTED = Object.freeze({ aborted: true });
const TERMINAL = new Set(["done", "error"]);

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const noop = () => {};

/** Trimmed text of at most `max` characters; "" when it isn't text. */
function textOf(value, max) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  return text.length > max ? text.slice(0, max).trimEnd() : text;
}

/**
 * The complete lines in `rest + chunk` and the unfinished tail to carry into the next chunk. A CR before the newline
 * is dropped (CRLF), blank lines are kept for parseLine to skip.
 * @param {string} rest
 * @param {string} chunk
 * @returns {{ lines: string[], rest: string }}
 */
export function splitLines(rest, chunk) {
  const parts = `${rest}${chunk}`.split("\n");
  const tail = parts.pop();
  return { lines: parts.map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l)), rest: tail };
}

/**
 * [{seq, ref}] as the page can trust them: whole-number seqs (0 or more) with a text ref, once per seq, in the order
 * the answer first named them, at most CITES_MAX.
 * @param {unknown} raw
 * @returns {ReadonlyArray<{ seq: number, ref: string }>}
 */
export function normalizeCites(raw) {
  if (!Array.isArray(raw)) return Object.freeze([]);
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    if (out.length >= CITES_MAX) break;
    if (!isObject(item) || !Number.isInteger(item.seq) || item.seq < 0 || seen.has(item.seq)) continue;
    const ref = textOf(item.ref, REF_MAX * 4).replace(/\s+/g, " ").slice(0, REF_MAX);
    if (!ref) continue;
    seen.add(item.seq);
    out.push(Object.freeze({ seq: item.seq, ref }));
  }
  return Object.freeze(out);
}

const EVENTS = Object.freeze({
  tool: (v) => ({ type: "tool", name: textOf(v.name, NAME_MAX),
    label: textOf(v.label, LABEL_MAX) || ASK.toolFallback }),
  delta: (v) => (typeof v.text === "string" && v.text !== ""
    ? { type: "delta", text: v.text.slice(0, TEXT_MAX) } : null),
  done: (v) => ({ type: "done", text: textOf(v.text, TEXT_MAX), cites: normalizeCites(v.cites) }),
  error: (v) => ({ type: "error", message: textOf(v.message, MESSAGE_MAX) || ASK.errors.fault }),
});

/**
 * One wire event, checked: its fields are the contract's and capped, or null for anything else (an unknown type, a
 * delta with no text).
 * @param {unknown} value
 * @returns {{ type: "tool" | "delta" | "done" | "error" } | null}
 */
export function normalizeEvent(value) {
  if (!isObject(value) || typeof value.type !== "string" || !Object.hasOwn(EVENTS, value.type)) return null;
  const event = EVENTS[value.type](value);
  return event ? Object.freeze(event) : null;
}

/**
 * One line: { kind: "event", event }, { kind: "skip" } (blank, an unknown type, an empty delta) or
 * { kind: "malformed" } (not JSON, or JSON that isn't an object).
 * @param {string} line
 */
export function parseLine(line) {
  const text = typeof line === "string" ? line.trim() : "";
  if (!text) return SKIP;
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return MALFORMED;
  }
  if (!isObject(value)) return MALFORMED;
  const event = normalizeEvent(value);
  return event ? { kind: "event", event } : SKIP;
}

/** Hand each line's tool and delta events to onEvent; returns the first done or error, or null. */
function deliver(lines, onEvent, tally) {
  for (const line of lines) {
    const parsed = parseLine(line);
    if (parsed.kind === "malformed") tally.malformed += 1;
    if (parsed.kind !== "event") continue;
    if (TERMINAL.has(parsed.event.type)) return parsed.event;
    onEvent(parsed.event);
  }
  return null;
}

/** A promise that resolves ABORTED when `signal` aborts (never, without one), and its cleanup. */
function abortWatch(signal) {
  if (!signal) return { promise: new Promise(noop), dispose: noop };
  let onAbort = noop;
  const promise = new Promise((resolve) => {
    onAbort = () => resolve(ABORTED);
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  return { promise, dispose: () => signal.removeEventListener("abort", onAbort) };
}

function cancelQuietly(reader) {
  try {
    Promise.resolve(reader.cancel()).catch(noop);
  } catch {
    // a reader that can't be cancelled is already done with
  }
}

/**
 * Read an NDJSON body (a ReadableStream of bytes) as it arrives. onEvent hears each tool and delta event; onChunk hears
 * every chunk (the caller's stall timer). Resolves { terminal: the done or error event, or null when the stream ended
 * without one, malformed: lines skipped, failure?: the read error, aborted?: true }; never rejects.
 * @param {ReadableStream<Uint8Array>} body
 * @param {{ onEvent?: (event: object) => void, onChunk?: () => void, signal?: AbortSignal | null }} [opts]
 */
export async function readEvents(body, { onEvent = noop, onChunk = noop, signal = null } = {}) {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  const tally = { malformed: 0 };
  const stop = abortWatch(signal);
  let rest = "";
  try {
    for (;;) {
      if (signal?.aborted) return { terminal: null, malformed: tally.malformed, aborted: true };
      const step = await Promise.race([reader.read(), stop.promise]);
      if (step === ABORTED) return { terminal: null, malformed: tally.malformed, aborted: true };
      if (step.done) break;
      onChunk();
      const split = splitLines(rest, decoder.decode(step.value, { stream: true }));
      rest = split.rest;
      const terminal = deliver(split.lines, onEvent, tally);
      if (terminal) return { terminal, malformed: tally.malformed };
    }
    const terminal = deliver([`${rest}${decoder.decode()}`], onEvent, tally);
    return { terminal, malformed: tally.malformed };
  } catch (failure) {
    // the connection dropped (or onEvent threw: the panel reports its own errors before they get here)
    if (signal?.aborted) return { terminal: null, malformed: tally.malformed, aborted: true };
    return { terminal: null, malformed: tally.malformed, failure };
  } finally {
    stop.dispose();
    cancelQuietly(reader);
  }
}

/**
 * The same for a body read whole (a browser that can't stream a response body).
 * @param {string} text
 * @param {{ onEvent?: (event: object) => void }} [opts]
 */
export function readText(text, { onEvent = noop } = {}) {
  const tally = { malformed: 0 };
  const terminal = deliver(String(text ?? "").split("\n"), onEvent, tally);
  return { terminal, malformed: tally.malformed };
}
