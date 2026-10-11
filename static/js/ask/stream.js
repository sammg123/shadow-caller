// The analyst's two calls (docs/design/analyst.md section 5; docs/design/analyst-ui.md). Pure*, like core/api.js: no
// DOM; fetch and the timers are injected (and called bare: browsers throw "Illegal invocation" otherwise).
//   askAnalyst  POST /api/ask {question, history}: hands each tool and delta event to onEvent as it arrives, then
//               resolves how the answer ended: {type: "done", text, cites}, {type: "error", reason, message, retry}
//               or {type: "aborted"}. It never rejects. An AbortSignal stops it (the panel closed, the page left); a
//               stream that sends nothing for STALL_MS is stopped as stalled.
//   fetchStatus GET /api/ask/status: {ok: true, status} or {ok: false, code, message}; never rejects.
import { ASK } from "./copy.js";
import { readEvents, readText } from "./ndjson.js";

export const ASK_PATH = "/api/ask";
export const STATUS_PATH = "/api/ask/status";
/** Longer than any answer the server allows (150 s), shorter than its gate's 240 s: a stream this quiet is gone. */
export const STALL_MS = 200000;
/** The server's own status check gives up on Ollama after 2 s. */
export const STATUS_TIMEOUT_MS = 6000;

const REFUSAL_TEXT_MAX = 4000;   // a refusal's body is read this far, at most
const ERROR_MAX = 300;
const MODEL_MAX = 60;
const ABORTED = Object.freeze({ type: "aborted" });
const ABORT = Symbol("aborted");
const noop = () => {};
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** What a refused POST means: whose fault, worth asking again, the words when the server sent none (or, `own`, the
 * panel's words always: a 404 means this server has no analyst route, whatever its page says). */
const REFUSALS = Object.freeze({
  400: { reason: "refused", retry: false, words: ASK.errors.refused },
  403: { reason: "refused", retry: false, words: ASK.errors.refused },
  404: { reason: "missing", retry: false, words: ASK.errors.missing, own: true },
  413: { reason: "refused", retry: false, words: ASK.errors.refused },
  415: { reason: "refused", retry: false, words: ASK.errors.refused },
  429: { reason: "busy", retry: true, words: ASK.errors.busy },
});

function checkDeps(fetchImpl, timers) {
  if (typeof fetchImpl !== "function") throw new TypeError("the analyst needs fetchImpl");
  if (typeof timers?.setTimeout !== "function" || typeof timers?.clearTimeout !== "function") {
    throw new TypeError("the analyst needs timers with setTimeout and clearTimeout");
  }
}

/** `promise`, or a rejection with ABORT as soon as `signal` aborts (a fetch stub may ignore its signal). */
function raceAbort(promise, signal) {
  if (signal.aborted) return Promise.reject(ABORT);
  let onAbort = noop;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(ABORT);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([promise, aborted]).finally(() => signal.removeEventListener("abort", onAbort));
}

/** The `error` a JSON refusal carries, as plain text, or "". */
function errorWords(text) {
  try {
    const body = JSON.parse(text);
    return isObject(body) && typeof body.error === "string" ? body.error.trim().slice(0, ERROR_MAX) : "";
  } catch {
    return "";   // an HTML page or nothing: the panel's own words stand in
  }
}

async function refusalOf(res, signal) {
  const text = await raceAbort(Promise.resolve(res.text()), signal).catch((err) => {
    if (err === ABORT) throw err;
    return "";
  });
  const known = REFUSALS[res.status];
  const plan = known ?? { reason: "server", retry: true, words: ASK.errors.server(res.status) };
  const said = plan.own ? "" : errorWords(String(text).slice(0, REFUSAL_TEXT_MAX));
  return Object.freeze({ type: "error", reason: plan.reason, message: said || plan.words, retry: plan.retry });
}

function errorOutcome(reason, message, extra = {}) {
  return Object.freeze({ type: "error", reason, message, retry: true, ...extra });
}

function outcomeOf(read, why) {
  if (read.aborted) return why.stalled ? errorOutcome("stall", ASK.errors.stall) : ABORTED;
  const { terminal, malformed } = read;
  if (terminal?.type === "done") {
    return Object.freeze({ type: "done", text: terminal.text, cites: terminal.cites, malformed });
  }
  if (terminal?.type === "error") return errorOutcome("server", terminal.message, { malformed });
  return errorOutcome("cut", ASK.errors.cut, { malformed });
}

function failureOf(err, signal, why) {
  if (err === ABORT || signal.aborted) return why.stalled ? errorOutcome("stall", ASK.errors.stall) : ABORTED;
  return errorOutcome("network", ASK.errors.network);
}

function send(fetchImpl, body, signal) {
  return fetchImpl(ASK_PATH, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/x-ndjson", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

/**
 * Ask one question. body is {question, history} (history.js requestBody builds it).
 * @param {{ fetchImpl: typeof fetch, body: { question: string, history: object[] }, timers: { setTimeout: Function,
 *   clearTimeout: Function }, signal?: AbortSignal | null, onEvent?: (event: object) => void, stallMs?: number }} opts
 * @returns {Promise<Readonly<{ type: "done", text: string, cites: object[] } |
 *   { type: "error", reason: string, message: string, retry: boolean } | { type: "aborted" }>>}
 */
export async function askAnalyst({ fetchImpl, body, timers, signal = null, onEvent = noop, stallMs = STALL_MS }) {
  checkDeps(fetchImpl, timers);
  if (signal?.aborted) return ABORTED;
  const ctl = new AbortController();
  const why = { stalled: false };
  const relay = () => ctl.abort();
  signal?.addEventListener("abort", relay, { once: true });
  let timer = null;
  const arm = () => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = timers.setTimeout(() => {
      why.stalled = true;
      ctl.abort();
    }, stallMs);
  };
  try {
    arm();
    const res = await raceAbort(Promise.resolve().then(() => send(fetchImpl, body, ctl.signal)), ctl.signal);
    if (res.status !== 200) return await refusalOf(res, ctl.signal);
    const read = res.body
      ? await readEvents(res.body, { onEvent, onChunk: arm, signal: ctl.signal })
      : readText(await raceAbort(Promise.resolve(res.text()), ctl.signal), { onEvent });
    return outcomeOf(read, why);
  } catch (err) {
    return failureOf(err, ctl.signal, why);
  } finally {
    if (timer !== null) timers.clearTimeout(timer);
    signal?.removeEventListener("abort", relay);
  }
}

/**
 * GET /api/ask/status's body as the page can trust it: booleans that are true only when the server said true, the
 * model's name, the plain reason when not ready. null for anything that isn't an object.
 * @param {unknown} body
 * @returns {Readonly<{ ready: boolean, ollama: boolean, installed: boolean, warm: boolean, busy: boolean,
 *   model: string, message: string | null }> | null}
 */
export function normalizeStatus(body) {
  if (!isObject(body)) return null;
  const flag = (key) => body[key] === true;
  const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  return Object.freeze({
    ready: flag("ready"), ollama: flag("ollama"), installed: flag("installed"), warm: flag("warm"), busy: flag("busy"),
    model: text(body.model, MODEL_MAX), message: text(body.message, ERROR_MAX) || null,
  });
}

const OFFLINE = Object.freeze({ ok: false, code: "offline", message: ASK.notes.offline });
const MISSING = Object.freeze({ ok: false, code: "missing", message: ASK.notes.missing });

/**
 * Is the analyst ready? Never rejects: an unreachable server, a missing route or a bad body are {ok: false}.
 * @param {{ fetchImpl: typeof fetch, timers: { setTimeout: Function, clearTimeout: Function }, timeoutMs?: number,
 *   signal?: AbortSignal | null }} opts
 */
export async function fetchStatus({ fetchImpl, timers, timeoutMs = STATUS_TIMEOUT_MS, signal = null }) {
  checkDeps(fetchImpl, timers);
  const ctl = new AbortController();
  const relay = () => ctl.abort();
  signal?.addEventListener("abort", relay, { once: true });
  const timer = timers.setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const init = { method: "GET", cache: "no-store", credentials: "same-origin",
      headers: { Accept: "application/json" }, signal: ctl.signal };
    const res = await raceAbort(Promise.resolve().then(() => fetchImpl(STATUS_PATH, init)), ctl.signal);
    if (res.status === 404) return MISSING;
    if (res.status !== 200) return OFFLINE;
    const status = normalizeStatus(JSON.parse(await raceAbort(Promise.resolve(res.text()), ctl.signal)));
    return status ? Object.freeze({ ok: true, status }) : OFFLINE;
  } catch {
    return OFFLINE;   // unreachable, timed out, aborted or not JSON: the panel says it can't reach the server
  } finally {
    timers.clearTimeout(timer);
    signal?.removeEventListener("abort", relay);
  }
}
