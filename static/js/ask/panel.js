// The analyst panel (restructure-v2.md section 7 item 4; docs/design/analyst.md section 5; docs/design/analyst-ui.md).
// One component, two layouts: "slide", the GameCast's Ask slide-out (closed until the top bar's Ask key opens it;
// Escape closes it, as the topmost layer, and gives focus back to the key), and "embedded", the Model Report's full
// chat (always shown). DOM side; the state is state.js (immutable, reduce only), the view model vm.js, the nodes
// view.js, the calls stream.js.
//
// The host page decides what a cite does: a cite key dispatches "sc:ask-cite" ({seq, ref}, bubbling) on the panel's
// root; the GameCast seeks to that play (POST /api/watch/seek {idx: seq}), the Model Report scrolls to that call's
// row. The slide-out dispatches "sc:ask-toggle" ({open}) when it opens or closes, and while open sets
// <html data-ask="open">, which the world uses to keep the play clear of it (--sc-field-safe-left); the GameCast
// re-reads the field's insets on that event. Closing the slide-out, Stop, leaving the page or destroy() aborts the
// question on its way. The status (GET /api/ask/status) is checked when the panel shows, after every answer, when the
// box is focused and the last check is old, and every few seconds while the analyst is not ready or busy.
import { setAttr, setData, setHidden } from "../ui/dom.js";
import { ASK } from "./copy.js";
import { requestBody } from "./history.js";
import { composerAction, isPlainEscape } from "./keys.js";
import { INITIAL, answering, newest, reduce } from "./state.js";
import { askAnalyst, fetchStatus } from "./stream.js";
import { buildPanel, renderPanel } from "./view.js";
import { askVm } from "./vm.js";

export const POLL_MS = 5000;           // not ready or unreachable: check again
export const BUSY_POLL_MS = 2000;      // another question is answering: it frees the analyst soon
export const MISSING_POLL_MS = 30000;  // this server has no analyst route: only a restart changes that
export const STATUS_STALE_MS = 30000;  // focusing the box re-checks a status older than this (the model unloads)
/** After an answer ends, the status is checked this much later: the server frees its one-question gate only when the
 * response closes, and a check that beat it would flash Busy and hold Ask off for a poll. */
export const AFTER_ANSWER_MS = 400;
const STICK_PX = 48;                   // the conversation follows new words while it is this close to its end
const LAYOUTS = new Set(["slide", "embedded"]);
const ID = /^[a-z][a-z0-9-]{0,39}$/;
const DEFAULT_ID = "sc-ask";

function report(err) {
  if (typeof globalThis.reportError === "function") globalThis.reportError(err);
  else queueMicrotask(() => { throw err; });
}

/** The server refused the question before streaming (busy, a bad body, no analyst route). */
const refusedAtTheDoor = (outcome) => outcome.type === "error"
  && ["busy", "refused", "missing"].includes(outcome.reason);

const nearEnd = (node) => typeof node.scrollHeight === "number"
  && node.scrollHeight - node.scrollTop - node.clientHeight <= STICK_PX;

function scrollToEnd(node) {
  if (typeof node.scrollHeight === "number") node.scrollTop = node.scrollHeight;
}

class AskPanel {
  constructor(host, { layout, id, fetchImpl, timers, now, raf }) {
    Object.assign(this, { host, doc: host.ownerDocument, layout, fetchImpl, timers, now, raf });
    this.state = INITIAL;
    this.shown = layout === "embedded";
    this.opener = null;
    this.inflight = null;               // { id, ctl }: the question on its way
    this.poll = null;
    this.checking = false;
    this.checkedAt = null;
    this.queued = false;
    this.stick = false;
    this.destroyed = false;
    this.life = new AbortController();  // aborts a status check when the panel goes
    this.n = buildPanel(this.handlers(), { layout, id });
    this.root = this.n.root;
    this.onDocKey = (e) => this.docKey(e);
    this.onLeave = () => this.stop();
    this.doc.addEventListener("keydown", this.onDocKey, true);
    this.doc.defaultView?.addEventListener?.("pagehide", this.onLeave);
    host.appendChild(this.root);
    this.render();
    if (this.shown) this.checkStatus();
  }

  handlers() {
    return Object.freeze({
      close: () => this.close(),
      sendOrStop: () => (answering(this.state) ? this.stopHere() : this.send()),
      suggest: (text) => this.ask(text, false),
      retry: (id) => this.retry(id),
      cite: (seq, ref) => this.emit("sc:ask-cite", { seq, ref }),
      input: (text) => this.dispatch({ type: "draft", text }),
      key: (e) => this.composerKey(e),
      focused: () => this.recheckIfOld(),
    });
  }

  // ---------------------------------------------------------------- state and render
  dispatch(action) {
    const next = reduce(this.state, action);
    if (next === this.state) return;
    this.state = next;
    if (!this.raf) {
      this.render();
      return;
    }
    if (this.queued) return;
    this.queued = true;
    this.raf(() => {
      this.queued = false;
      this.render();
    });
  }

  render() {
    if (this.destroyed) return;
    try {
      const stick = this.stick || nearEnd(this.n.face);
      renderPanel(this.n, askVm(this.state, { layout: this.layout }));
      if (stick) scrollToEnd(this.n.face);
      this.stick = false;
    } catch (err) {
      report(err);     // a render bug never ends the answer it was drawing
    }
  }

  emit(type, detail) {
    const Ctor = this.doc.defaultView?.CustomEvent ?? globalThis.CustomEvent;
    if (typeof Ctor !== "function") return;
    this.root.dispatchEvent(new Ctor(type, { detail, bubbles: true }));
  }

  focusInput() {
    if (this.shown && !this.destroyed) this.n.input.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- asking
  composerKey(e) {
    if (composerAction(e) !== "send") return;
    e.preventDefault();                 // Enter never adds a line; it asks, when a question can go
    if (!answering(this.state)) this.send();
  }

  send() {
    if (this.ask(this.n.input.value, true)) this.n.input.value = "";
  }

  /** Ask `question`; true when it went (a new turn is answering). */
  ask(question, fromBox) {
    const before = this.state;
    this.dispatch({ type: "ask", question, clearDraft: fromBox });
    const turn = newest(this.state);
    if (!turn || turn === newest(before) || turn.state !== "asking") return false;
    this.begin(turn, before.turns);
    return true;
  }

  retry(id) {
    const before = newest(this.state);
    this.dispatch({ type: "retry", id });
    const turn = newest(this.state);
    if (turn && turn !== before && turn.state === "asking") this.begin(turn, this.state.turns.slice(0, -1));
  }

  begin(turn, earlier) {
    this.stick = true;
    this.render();
    this.stream(turn, earlier).catch(report);
    this.focusInput();
  }

  async stream(turn, earlier) {
    const ctl = new AbortController();
    this.inflight = { id: turn.id, ctl };
    const outcome = await askAnalyst({ fetchImpl: this.fetchImpl, timers: this.timers, signal: ctl.signal,
      body: requestBody(turn.question, earlier),
      onEvent: (event) => this.dispatch({ type: "event", id: turn.id, event }) })
      .catch((err) => {
        report(err);                    // a bug, never the network: the turn still ends, with words
        return { type: "error", reason: "fault", message: ASK.errors.fault, retry: true };
      });
    if (this.inflight?.id === turn.id) this.inflight = null;
    if (this.destroyed) return;
    this.dispatch({ type: "end", id: turn.id, outcome });
    if (!this.shown) return;
    // refused at the door (429 and the like): the gate is someone else's, so ask now; after our own stream, give the
    // server a moment to free the gate (warm now, or still finishing a stopped answer)
    if (refusedAtTheDoor(outcome)) this.checkStatus();
    else this.pollIn(AFTER_ANSWER_MS);
  }

  stop() {
    this.inflight?.ctl.abort();
  }

  stopHere() {
    this.stop();
    this.focusInput();
  }

  // ---------------------------------------------------------------- the status
  async checkStatus() {
    if (this.checking || this.destroyed) return;
    this.checking = true;
    this.clearPoll();
    const result = await fetchStatus({ fetchImpl: this.fetchImpl, timers: this.timers, signal: this.life.signal })
      .catch((err) => {
        report(err);
        return null;
      });
    this.checking = false;
    if (this.destroyed || !result) return;
    this.checkedAt = this.now();
    this.dispatch(result.ok ? { type: "status", status: result.status }
      : { type: "statusFailed", code: result.code, message: result.message });
    this.schedulePoll();
  }

  pollDelay() {
    const { status, statusError, statusCode } = this.state;
    if (statusError) return statusCode === "missing" ? MISSING_POLL_MS : POLL_MS;
    if (!status || !status.ready) return POLL_MS;
    return status.busy ? BUSY_POLL_MS : null;
  }

  schedulePoll() {
    const ms = this.pollDelay();
    if (ms === null) this.clearPoll();
    else this.pollIn(ms);
  }

  /** The next status check, `ms` from now (one at a time: it replaces any check already waiting). */
  pollIn(ms) {
    this.clearPoll();
    if (!this.shown || this.destroyed) return;
    this.poll = this.timers.setTimeout(() => {
      this.poll = null;
      this.checkStatus();
    }, ms);
  }

  clearPoll() {
    if (this.poll !== null) this.timers.clearTimeout(this.poll);
    this.poll = null;
  }

  recheckIfOld() {
    if (this.checkedAt === null || this.now() - this.checkedAt >= STATUS_STALE_MS) this.checkStatus();
  }

  // ---------------------------------------------------------------- the slide-out
  /** Escape closes the open slide-out when it comes from inside it, from its key or from nowhere in particular (the
   * page's body); Escape anywhere else is that control's or the page's. It runs first (capture), so the page's
   * Escape (Go Live, core/keyboard.js) sees it prevented and leaves it. */
  docKey(e) {
    if (this.layout !== "slide" || !this.shown || e.defaultPrevented || !isPlainEscape(e)) return;
    const t = e.target;
    const { doc } = this;
    const ours = !t || t === doc || t === doc.body || t === doc.documentElement || t === this.opener
      || this.root.contains(t);
    if (!ours) return;
    e.preventDefault();
    this.close();
  }

  setOpener(node) {
    this.opener = node;
    setAttr(node, "aria-controls", this.root.id);
    setAttr(node, "aria-expanded", String(this.shown));
  }

  sync() {
    setHidden(this.root, !this.shown);
    setData(this.root, "open", this.shown);
    setData(this.doc.documentElement, "ask", this.shown ? "open" : null);
    if (this.opener) setAttr(this.opener, "aria-expanded", String(this.shown));
  }

  open(opener = null) {
    if (this.layout !== "slide" || this.destroyed) return;
    if (opener) this.setOpener(opener);
    if (!this.shown) {
      this.shown = true;
      this.sync();
      this.emit("sc:ask-toggle", { open: true });
      this.checkStatus();
    }
    this.focusInput();
  }

  close({ focus = true } = {}) {
    if (this.layout !== "slide" || !this.shown) return;
    const active = this.doc.activeElement;
    const giveBack = focus && this.opener?.isConnected
      && (!active || active === this.doc.body || this.root.contains(active));
    this.shown = false;
    this.stop();
    this.clearPoll();
    if (giveBack) this.opener.focus({ preventScroll: true });
    this.sync();
    this.emit("sc:ask-toggle", { open: false });
  }

  toggle(opener) {
    if (this.shown) this.close();
    else this.open(opener);
  }

  destroy() {
    if (this.destroyed) return;
    this.close({ focus: false });
    this.stop();
    this.destroyed = true;
    this.clearPoll();
    this.life.abort();
    this.doc.removeEventListener("keydown", this.onDocKey, true);
    this.doc.defaultView?.removeEventListener?.("pagehide", this.onLeave);
    setData(this.doc.documentElement, "ask", null);
    this.root.remove();
  }
}

/**
 * Mount the analyst panel in `host` (the GameCast: a container outside #app; the Model Report: #rp-analyst).
 * opts: layout ("slide" or "embedded"), id (the root's id, "sc-ask"), fetchImpl, timers ({setTimeout,
 * clearTimeout}), now (ms) and raf (render batching; the window's requestAnimationFrame by default), all for tests.
 * @param {HTMLElement} host
 * @param {{ layout?: "slide" | "embedded", id?: string, fetchImpl?: typeof fetch, timers?: object,
 *   now?: () => number, raf?: ((fn: () => void) => unknown) | null }} [opts]
 * @returns {Readonly<{ root: HTMLElement, open: (opener?: HTMLElement) => void, close: (o?: { focus?: boolean }) =>
 *   void, toggle: (opener?: HTMLElement) => void, isOpen: () => boolean, destroy: () => void }>}
 */
export function mountAsk(host, opts = {}) {
  if (!host || typeof host.appendChild !== "function" || !host.ownerDocument) {
    throw new TypeError("mountAsk needs a host element in a document");
  }
  const id = opts.id ?? DEFAULT_ID;
  if (!ID.test(id)) throw new TypeError(`mountAsk: bad id "${id}"`);
  const view = host.ownerDocument.defaultView;
  const frame = typeof view?.requestAnimationFrame === "function" ? (fn) => view.requestAnimationFrame(fn) : null;
  const panel = new AskPanel(host, {
    layout: LAYOUTS.has(opts.layout) ? opts.layout : "slide",
    id,
    fetchImpl: opts.fetchImpl ?? ((url, init) => fetch(url, init)),
    timers: opts.timers ?? { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (t) => clearTimeout(t) },
    now: opts.now ?? (() => Date.now()),
    raf: opts.raf === undefined ? frame : opts.raf,
  });
  return Object.freeze({
    root: panel.root,
    open: (opener) => panel.open(opener),
    close: (o) => panel.close(o),
    toggle: (opener) => panel.toggle(opener),
    isOpen: () => panel.shown,
    destroy: () => panel.destroy(),
  });
}
