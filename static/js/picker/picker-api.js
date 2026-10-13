// The game picker's HTTP client (docs/design/game-picker.md 2): GET /api/games and GET /api/games/resolve, and the
// models' index, GET /api/callers (restructure-v2.md 11 decision 1: who has a model, and why not). fetch and
// the timers are injected (core/api.js's rule: both are called bare, since a browser throws "Illegal invocation" when
// fetch or setTimeout run as a method of another object). A refusal carries the server's own reason; anything else
// says what happened in plain words. The pasted text only ever travels as an encoded query value.

export const PICKER_ROUTES = Object.freeze({ games: "/api/games", resolve: "/api/games/resolve",
  callers: "/api/callers" });
/** A cold listing fetches every week of the season from ESPN (the server waits at most 15 s for it). */
export const PICKER_TIMEOUT_MS = 20000;
const MESSAGE_MAX = 300;
const UNREADABLE = "The app server's answer wasn't readable.";
const UNREACHABLE = "Can't reach the app server.";
const GET = Object.freeze({ method: "GET", cache: "no-store", headers: Object.freeze({ Accept: "application/json" }) });

export class PickerError extends Error {
  /** @param {string} message @param {number | null} status the HTTP status, null when there was no answer */
  constructor(message, status = null) {
    super(message);
    this.name = "PickerError";
    this.status = status;
  }
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function parseObject(text) {
  try {
    const body = JSON.parse(text);
    return isObject(body) ? body : null;
  } catch {
    return null;   // not JSON (an HTML error page): the caller says so in words
  }
}

/** One GET with a timeout: the JSON object of a 2xx, else a PickerError with the server's reason or plain words. */
async function getObject({ fetchImpl, setTimer, clearTimer }, path, slow) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimer(() => { timedOut = true; controller.abort(); }, PICKER_TIMEOUT_MS);
  try {
    const res = await fetchImpl(path, { ...GET, signal: controller.signal });
    const body = parseObject(await res.text());
    if (res.status >= 200 && res.status <= 299) {
      if (!body) throw new PickerError(UNREADABLE, res.status);
      return body;
    }
    const reason = typeof body?.error === "string" && body.error.trim() ? body.error.trim() : null;
    throw new PickerError((reason ?? `The app server answered ${res.status}.`).slice(0, MESSAGE_MAX), res.status);
  } catch (err) {
    if (err instanceof PickerError) throw err;
    throw new PickerError(timedOut ? slow : UNREACHABLE);
  } finally {
    clearTimer(timer);
  }
}

/**
 * @param {{ fetchImpl: Function, setTimer: Function, clearTimer: Function }} deps
 * @returns {{ games: () => Promise<object>, callers: () => Promise<object>, resolve: (ref: string) => Promise<object> }}
 */
export function pickerApi(deps) {
  return {
    games: () => getObject(deps, PICKER_ROUTES.games, "The schedule took too long to load. Try again."),
    callers: () => getObject(deps, PICKER_ROUTES.callers, "The play-callers' models took too long to load."),
    async resolve(ref) {
      const text = typeof ref === "string" ? ref.trim() : "";
      if (!text) throw new PickerError("Paste an ESPN game link or id first.");
      const body = await getObject(deps, `${PICKER_ROUTES.resolve}?ref=${encodeURIComponent(text)}`,
        "Looking that game up took too long. Try again.");
      if (!isObject(body.game)) throw new PickerError(UNREADABLE);
      return body.game;
    },
  };
}
