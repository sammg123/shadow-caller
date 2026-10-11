// Helpers for the analyst chat's node tests (static/js/ask/; docs/design/analyst-ui.md): NDJSON responses streamed
// chunk by chunk from a real ReadableStream, JSON responses, fake timers that fire on demand, and a flush that lets
// pending promise work run.

export const enc = (text) => new TextEncoder().encode(text);

const bytes = (chunk) => (typeof chunk === "string" ? enc(chunk) : chunk);

/** One NDJSON line for an event object. */
export const line = (event) => `${JSON.stringify(event)}\n`;

/**
 * A Response whose body streams `chunks` (strings or byte arrays), one chunk per read. end: "close" (the stream ends
 * after them), "error" (the connection drops after them) or "hang" (it waits for more). push, close and fail drive it
 * further by hand.
 */
export function streamResponse({ status = 200, chunks = [], end = "close",
  headers = { "Content-Type": "application/x-ndjson" } } = {}) {
  const queue = chunks.map(bytes);
  let ending = end;
  let wake = null;
  const poke = () => {
    const resume = wake;
    wake = null;
    resume?.();
  };
  const stream = new ReadableStream({
    async pull(ctl) {
      while (!queue.length && ending === "hang") await new Promise((resolve) => { wake = resolve; });
      if (queue.length) ctl.enqueue(queue.shift());
      else if (ending === "error") ctl.error(new TypeError("network connection was lost"));
      else ctl.close();
    },
  }, { highWaterMark: 0 });
  return {
    response: new Response(stream, { status, headers }),
    push: (chunk) => {
      queue.push(bytes(chunk));
      poke();
    },
    close: () => {
      ending = "close";
      poke();
    },
    fail: () => {
      ending = "error";
      poke();
    },
  };
}

export function jsonResponse(status, body) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body),
    { status, headers: { "Content-Type": "application/json" } });
}

/** Timers that only fire when the test says so. */
export function fakeTimers() {
  let next = 1;
  const pending = new Map();
  return {
    pending,
    setTimeout(fn, ms) {
      const id = next;
      next += 1;
      pending.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    /** Run every pending timer (each once), oldest first; returns how many ran. */
    fireAll() {
      const due = [...pending.entries()];
      for (const [id] of due) pending.delete(id);
      for (const [, t] of due) t.fn();
      return due.length;
    },
    /** Run the pending timers set for exactly `ms`. */
    fire(ms) {
      const due = [...pending.entries()].filter(([, t]) => t.ms === ms);
      for (const [id] of due) pending.delete(id);
      for (const [, t] of due) t.fn();
      return due.length;
    },
  };
}

/** Let promise callbacks and stream reads settle. */
export async function flush(rounds = 8) {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

/** A fetch stub: answers each call with the next item of `replies` (a Response, an Error to throw, or a function of
 * (url, init) returning either); records every call. */
export function fetchStub(replies) {
  const calls = [];
  const queue = [...replies];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
    const reply = queue.length > 1 ? queue.shift() : queue[0];
    const value = typeof reply === "function" ? reply(url, init) : reply;
    if (value instanceof Error) throw value;
    return value;
  };
  return { fetchImpl, calls };
}

/** A status body as GET /api/ask/status answers it. */
export function statusBody(over = {}) {
  return { ready: true, ollama: true, model: "gpt-oss:20b", installed: true, warm: true, busy: false, message: null,
    ...over };
}
