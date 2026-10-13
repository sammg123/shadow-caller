// The analyst's Ask slide-out on the GameCast (restructure-v2.md 7 item 4 and 11; analyst-ui.md 4; owner: home frame).
// DOM side. mountAnalyst puts the drawer (ask/panel.js, imported dynamically: a broken analyst leaves a notice and
// never stops the GameCast) in #rg-ask under the top bar's Ask key (ui/view-keys.js builds it hidden), and shows the
// key once the analyst's status says the server has one: plain when it can answer, "Not ready" with the reason on its
// tooltip when it can't (Ollama not running, the model missing), so a press opens the drawer that says what to do;
// it reads the status again every so often while it can't, and whenever the drawer closes. A server with no analyst
// keeps the key hidden. A cite seeks the GameCast to that play (actions.seek: POST /api/watch/seek {"idx": seq}), and
// the drawer opening or closing re-reads the field's insets, so the camera keeps the play clear of it.
import { fetchStatus } from "../ask/stream.js";
import { askKeyVm } from "../ask/vm.js";
import { setAttr, setData, setHidden, setText } from "../ui/dom.js";

/** While the analyst can't answer (or couldn't be asked), the key's status is read again this often. */
export const STATUS_RECHECK_MS = 30000;
const HOST_ID = "rg-ask";
const KEY = '[data-testid="ask"]';

const message = (err) => (err && typeof err.message === "string" && err.message ? err.message : String(err));

function report(err) {
  if (typeof globalThis.reportError === "function") globalThis.reportError(err);
}

const defaultLoad = () => import("../ask/panel.js");
const bareFetch = (input, init) => globalThis.fetch(input, init);
const bareTimers = Object.freeze({
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id),
});

/** The key as the status says: shown or not, its state, its words and its tooltip. */
function lightKey(key, vm) {
  setHidden(key, !vm.shown);
  setData(key, "status", vm.status);
  const value = key.querySelector(".sc-key-value");
  if (value) setText(value, vm.value);
  setAttr(key, "title", vm.title || null);
}

/** The key can rest: it answers, or the server has no analyst at all. Else (not ready, unreachable) it checks again. */
const settled = (vm) => vm.status === "missing" || (vm.shown && vm.status !== "down");

/** The key's status checks: one now, then again every STATUS_RECHECK_MS while it can't answer; the newest wins. */
function statusWatch(key, { fetchImpl, timers }) {
  let timer = null;
  let gone = false;
  let latest = 0;
  const life = new AbortController();
  const stop = () => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  };
  async function read() {
    stop();
    latest += 1;
    const mine = latest;
    const vm = askKeyVm(await fetchStatus({ fetchImpl, timers, signal: life.signal }));
    if (gone || mine !== latest) return;
    lightKey(key, vm);
    if (!settled(vm)) timer = timers.setTimeout(check, STATUS_RECHECK_MS);
  }
  /** Never rejects: it runs from a timer and from the drawer's events, where a rejection would go unheard. */
  const check = () => read().catch(report);
  return {
    check,
    destroy() {
      gone = true;
      stop();
      life.abort();
    },
  };
}

function wire(ask, key, { actions, rt, watch }) {
  setAttr(key, "aria-controls", ask.root.id);
  setAttr(key, "aria-expanded", "false");
  key.addEventListener("click", (e) => {
    if (Number.isInteger(e?.detail) && e.detail > 1) return;   // a double-click opens it once
    ask.toggle(key);
  });
  ask.root.addEventListener("sc:ask-cite", (e) => {
    const seq = e?.detail?.seq;
    if (Number.isInteger(seq) && seq >= 0) Promise.resolve(actions.seek(seq)).catch(report);
  });
  ask.root.addEventListener("sc:ask-toggle", (e) => {
    rt.engine?.setSafeArea?.(null);
    if (e?.detail?.open === false) watch.check();
  });
}

/**
 * Mount the Ask slide-out. Resolves a handle ({ ask, destroy }), or null when the page has no host or key, or the
 * drawer didn't load (a notice says so). fetchImpl, timers, now and load are for tests.
 * @param {Document} doc
 * @param {{ actions: { seek: Function }, rt: { engine: object | null }, notices: { show: Function },
 *   fetchImpl?: Function, timers?: object, now?: () => number, load?: () => Promise<object> }} deps
 */
export async function mountAnalyst(doc, { actions, rt, notices, fetchImpl = bareFetch, timers = bareTimers,
  now = () => Date.now(), load = defaultLoad }) {
  const host = doc.getElementById(HOST_ID);
  const key = doc.querySelector(KEY);
  if (!host || !key) return null;
  let mod;
  try {
    mod = await load();
    if (typeof mod?.mountAsk !== "function") throw new TypeError("ask/panel.js has no mountAsk()");
  } catch (err) {
    notices.show("ask", `The analyst couldn't load (${message(err)}).`);
    return null;
  }
  const ask = mod.mountAsk(host, { layout: "slide", fetchImpl, timers, now });
  const watch = statusWatch(key, { fetchImpl, timers });
  wire(ask, key, { actions, rt, watch });
  await watch.check();
  return Object.freeze({
    ask,
    destroy() {
      watch.destroy();
      ask.destroy();
      setHidden(key, true);
    },
  });
}
