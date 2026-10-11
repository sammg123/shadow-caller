// HTTP client for every endpoint the UI calls (ui-architecture.md 2.2; DC C1, E1, E4; FI 2.1; owner A1).
// Pure*: no DOM; fetch and the timers are injected so node tests can stub them. Both are called bare: browsers
// throw "Illegal invocation" when fetch or setTimeout run as a method of another object.
// GETs resolve with the parsed JSON object. POSTs resolve { status, body } for 200, 400, 409 and 503 (400 bodies are
// the full state plus `error`; 409 and 503 bodies may hold only `error`); everything else rejects with ApiError.

export class ApiError extends Error {
  /** @param {"network" | "timeout" | "http" | "bad-json"} kind */
  constructor(kind, { status = null, path, detail = "" }) {
    super(`${kind}${status === null ? "" : ` ${status}`} on ${path}${detail ? `: ${detail}` : ""}`);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.path = path;
  }
}

/** Per-request timeouts in ms. A seek rebuilds the game from kickoff and Go Live applies every ESPN play so far, both
 * under the server's lock, hence the long POST timeout. */
export const TIMEOUTS = Object.freeze({ version: 4000, state: 8000, timeline: 8000, post: 30000 });

/** Every POST the page sends: playback only (restructure-v2.md 9). The manual-entry endpoints stay on the server for
 * compatibility, but the page never sends user input into the game (restructure-v2.md 1). */
export const ROUTES = Object.freeze({
  open: "/api/open", seek: "/api/watch/seek", back: "/api/watch/back", forward: "/api/watch/forward",
  golive: "/api/golive", pause: "/api/watch/pause", resume: "/api/watch/resume", speed: "/api/watch/speed",
});
export const POST_PATHS = Object.freeze(Object.values(ROUTES));
const POST_OK = Object.freeze([200, 400, 409, 503]);
const JSON_HEADERS = Object.freeze({ Accept: "application/json" });

const isObjectBody = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const errorDetail = (err) => (err && typeof err.message === "string" ? err.message : String(err));

function parseObject(text, path, status) {
  try {
    const body = JSON.parse(text);
    if (isObjectBody(body)) return body;
  } catch {
    // fall through to the ApiError below: the server sent something that is not JSON (an HTML error page)
  }
  throw new ApiError("bad-json", { status, path });
}

function readStatusError(path, res) {
  return new ApiError("http", { status: res.status, path });
}

/** One request with a timeout: resolves { status, text } or rejects with ApiError (network, timeout). */
async function request({ fetchImpl, setTimer, clearTimer }, path, init, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimer(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const timeout = new Promise((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(new ApiError("timeout", { path })), { once: true });
  });
  try {
    const pending = Promise.resolve().then(() => fetchImpl(path, { ...init, signal: controller.signal }));
    const res = await Promise.race([pending, timeout]);
    return { status: res.status, text: await Promise.race([res.text(), timeout]) };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(timedOut ? "timeout" : "network", { path, detail: errorDetail(err) });
  } finally {
    clearTimer(timer);
  }
}

async function getJson(deps, path, timeoutMs) {
  const res = await request(deps, path, { method: "GET", cache: "no-store", headers: JSON_HEADERS }, timeoutMs);
  if (res.status < 200 || res.status > 299) throw readStatusError(path, res);
  return parseObject(res.text, path, res.status);
}

async function sendPost(deps, path, body, timeoutMs) {
  const init = { method: "POST", cache: "no-store", headers: { ...JSON_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(body) };
  const res = await request(deps, path, init, timeoutMs);
  if (!POST_OK.includes(res.status)) throw readStatusError(path, res);
  return { status: res.status, body: parseObject(res.text, path, res.status) };
}

/**
 * @param {{ fetchImpl: typeof fetch, timeouts?: typeof TIMEOUTS,
 *           timers?: { setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout } }} deps
 */
export function createApi({ fetchImpl, timeouts = TIMEOUTS, timers = globalThis } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("createApi needs fetchImpl");
  const { setTimeout: setT, clearTimeout: clearT } = timers ?? {};
  if (typeof setT !== "function" || typeof clearT !== "function") {
    throw new TypeError("createApi needs timers with setTimeout and clearTimeout");
  }
  const deps = { fetchImpl: (url, init) => fetchImpl(url, init), setTimer: (fn, ms) => setT(fn, ms),
    clearTimer: (id) => clearT(id) };
  return {
    getVersion: () => getJson(deps, "/api/version", timeouts.version),
    getState: () => getJson(deps, "/api/state", timeouts.state),
    getWatch: () => getJson(deps, "/api/watch", timeouts.version),
    /** since: whole number >= 0; epoch: the cached epoch or null (the server then answers as since=0). */
    getTimeline(since, epoch) {
      if (!Number.isInteger(since) || since < 0) throw new TypeError("since must be a whole number >= 0");
      const query = epoch == null ? "" : `&epoch=${encodeURIComponent(epoch)}`;
      return getJson(deps, `/api/timeline?since=${since}${query}`, timeouts.timeline);
    },
    post(path, body) {
      if (!POST_PATHS.includes(path)) throw new TypeError(`not a POST endpoint: ${path}`);
      if (!isObjectBody(body)) throw new TypeError("POST body must be a plain object");
      return sendPost(deps, path, body, timeouts.post);
    },
  };
}
