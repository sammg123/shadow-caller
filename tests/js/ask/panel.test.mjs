// static/js/ask/panel.js: the analyst panel, one component with two layouts (docs/design/analyst-ui.md). The slide-out
// on the GameCast (closed until the top bar's Ask key opens it; Escape closes it and gives focus back) and the
// embedded chat on the Model Report (always shown). Enter asks, Shift+Enter is a new line, a suggestion asks at once,
// the answer streams in as text, cite keys emit sc:ask-cite, the finished answer is announced once, closing or
// leaving stops the request, and the status is checked when it matters. Run on the fake DOM (tests/js/fake-dom.mjs).
import assert from "node:assert/strict";
import test from "node:test";
import { STOP_GUARD_MS, mountAsk } from "../../../static/js/ask/panel.js";
import { attachKeyboard } from "../../../static/js/core/keyboard.js";
import { initialState, reducer } from "../../../static/js/core/reducer.js";
import { createStore } from "../../../static/js/core/store.js";
import { recordingActions } from "../chrome-ctx.mjs";
import { createDocument, withDocument } from "../fake-dom.mjs";
import { stateBody } from "../fixtures.mjs";
import { fakeTimers, flush, jsonResponse, line, statusBody, streamResponse } from "./helpers.mjs";

const QUESTION = "What does he call on 3rd and short?";
const DONE = { type: "done", text: "On 3rd and 1 to 3 he ran it 4 times in 5 (Q3 2:52).",
  cites: [{ seq: 120, ref: "Q3 2:52" }] };

/** fetch for both routes: status bodies (each answered as a fresh 200 JSON response; the last one repeats) and ask
 * replies in order (a Response used once, a function called each time, or an Error to throw). */
function routedFetch({ status = [statusBody()], ask = [] } = {}) {
  const calls = [];
  const queues = { status: [...status], ask: [...ask] };
  const next = (q) => (queues[q].length > 1 ? queues[q].shift() : queues[q][0]);
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
    if (url === "/api/ask/status") return jsonResponse(200, next("status"));
    const item = next("ask");
    const value = typeof item === "function" ? item() : item;
    if (value instanceof Error) throw value;
    return value;
  };
  return { fetchImpl, calls, asks: () => calls.filter((c) => c.url === "/api/ask") };
}

function setup(doc, { layout = "slide", fetch = routedFetch(), clock = { ms: 0 } } = {}) {
  const host = doc.createElement("div");
  host.setAttribute("id", "rg-ask");
  doc.body.appendChild(host);
  const opener = doc.createElement("button");
  opener.setAttribute("id", "ask-key");
  doc.body.appendChild(opener);
  const outsider = doc.createElement("button");
  doc.body.appendChild(outsider);
  const timers = fakeTimers();
  const panel = mountAsk(host, { layout, fetchImpl: fetch.fetchImpl, timers, now: () => clock.ms });
  const root = host.querySelector(".sc-ask");
  const emitted = [];
  const original = root.dispatchEvent.bind(root);
  root.dispatchEvent = (event) => {
    emitted.push(event);
    return original(event);
  };
  const q = (sel) => root.querySelector(sel);
  const qa = (sel) => [...root.querySelectorAll(sel)];
  return { doc, host, root, opener, outsider, timers, panel, emitted, q, qa, fetch,
    input: q(".sc-ask-input"), send: q(".sc-ask-send") };
}

const run = (fn) => () => {
  const doc = createDocument();
  return withDocument(doc, () => fn(doc));
};

/** A keydown on `node` (the fake DOM doesn't bubble); returns the event, so a test can see whether it was prevented. */
function keydown(node, key, over = {}) {
  const evt = { type: "keydown", key, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false,
    isComposing: false, keyCode: 0, defaultPrevented: false, ...over };
  evt.preventDefault = () => { evt.defaultPrevented = true; };
  node.dispatchEvent(evt);
  return evt;
}

/** The same keydown as the document's capture listeners hear it (target: where focus was). */
function docKeydown(doc, target, key, over = {}) {
  const evt = { type: "keydown", key, target, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false,
    isComposing: false, keyCode: 0, defaultPrevented: false, ...over };
  evt.preventDefault = () => { evt.defaultPrevented = true; };
  for (const fn of doc.listeners.get("keydown") ?? []) fn(evt);
  return evt;
}

/** A click; `detail` is the browser's click count (2 for the second click of a double-click, 0 from a key). */
const click = (node, detail = 1) => node.dispatchEvent({ type: "click", detail, preventDefault() {} });

function type(t, text) {
  t.input.value = text;
  t.input.dispatchEvent({ type: "input" });
}

test("the slide-out mounts closed: an aside named by its title, the box labelled, nothing fetched yet", run((doc) => {
  const t = setup(doc);
  assert.equal(t.root.localName, "aside");
  assert.equal(t.root.getAttribute("data-layout"), "slide");
  assert.equal(t.root.hidden, true);
  assert.equal(t.root.getAttribute("aria-labelledby"), "sc-ask-title");
  assert.equal(t.q("#sc-ask-title").textContent, "Ask the analyst");
  assert.equal(t.input.localName, "textarea");
  assert.equal(t.input.getAttribute("maxlength"), "500");
  assert.equal(t.input.getAttribute("aria-describedby"), "sc-ask-hint");
  assert.equal(t.q("label").getAttribute("for"), t.input.id);
  assert.equal(t.send.disabled, true);
  assert.equal(t.fetch.calls.length, 0);
  assert.equal(doc.documentElement.getAttribute("data-ask"), null);
  assert.equal(t.qa(".sc-ask-suggestion").length, 4);
  assert.equal(t.q(".sc-ask-live").getAttribute("aria-live"), "polite");
  assert.equal(t.q(".sc-ask-log").getAttribute("aria-live"), null, "the conversation itself is never live");
}));

test("open: shown, the Ask key says expanded and names it, focus in the box, the status checked", run(async (doc) => {
  const t = setup(doc);
  t.panel.open(t.opener);
  assert.equal(t.root.hidden, false);
  assert.equal(t.root.getAttribute("data-open"), "true");
  assert.equal(t.opener.getAttribute("aria-expanded"), "true");
  assert.equal(t.opener.getAttribute("aria-controls"), "sc-ask");
  assert.equal(doc.activeElement, t.input);
  assert.equal(doc.documentElement.getAttribute("data-ask"), "open", "the field's safe area hook");
  assert.deepEqual(t.emitted.filter((e) => e.type === "sc:ask-toggle").map((e) => e.detail), [{ open: true }]);
  assert.equal(t.panel.isOpen(), true);
  await flush();
  assert.equal(t.fetch.calls[0].url, "/api/ask/status");
  assert.equal(t.root.getAttribute("data-status"), "ready");
  assert.equal(t.q(".sc-ask-state-word").textContent, "Ready");
}));

test("Escape closes the slide-out from the box and is spent there; focus goes back to the Ask key", run(async (doc) => {
  const t = setup(doc);
  t.panel.open(t.opener);
  await flush();
  const evt = docKeydown(doc, t.input, "Escape");
  assert.equal(evt.defaultPrevented, true, "the page's Escape (Go Live) never sees it");
  assert.equal(t.root.hidden, true);
  assert.equal(t.opener.getAttribute("aria-expanded"), "false");
  assert.equal(doc.activeElement, t.opener);
  assert.equal(doc.documentElement.getAttribute("data-ask"), null);
  assert.deepEqual(t.emitted.filter((e) => e.type === "sc:ask-toggle").map((e) => e.detail.open), [true, false]);
}));

test("Escape with focus nowhere closes it too; Escape on another control is left to the page", run(async (doc) => {
  const t = setup(doc);
  t.panel.open(t.opener);
  t.outsider.focus();
  const elsewhere = docKeydown(doc, t.outsider, "Escape");
  assert.equal(elsewhere.defaultPrevented, false);
  assert.equal(t.root.hidden, false);
  doc.body.focus?.();
  const nowhere = docKeydown(doc, doc.body, "Escape");
  assert.equal(nowhere.defaultPrevented, true);
  assert.equal(t.root.hidden, true);
  assert.equal(docKeydown(doc, doc.body, "Escape").defaultPrevented, false, "closed: Escape is the page's again");
}));

test("Enter asks: the question streams in as text, ends with cite keys and one announcement", run(async (doc) => {
  const stream = streamResponse({ end: "hang" });
  const t = setup(doc, { fetch: routedFetch({ ask: [stream.response] }) });
  t.panel.open(t.opener);
  await flush();
  type(t, `  ${QUESTION}\n`);
  assert.equal(t.send.disabled, false);
  const evt = keydown(t.input, "Enter");
  assert.equal(evt.defaultPrevented, true, "Enter never adds a line");
  await flush();
  assert.deepEqual(t.fetch.asks()[0].body, { question: QUESTION, history: [] });
  assert.equal(t.input.value, "", "the box clears");
  assert.equal(doc.activeElement, t.input);
  const turn = t.q(".sc-ask-turn");
  assert.equal(turn.querySelector(".sc-ask-q-text").textContent, QUESTION);
  assert.equal(t.root.getAttribute("data-phase"), "asking");
  assert.equal(t.send.querySelector(".sc-key-name").textContent, "Stop");
  stream.push(line({ type: "tool", name: "list_plays", label: "Looking through the plays" }));
  await flush();
  assert.equal(turn.querySelector(".sc-ask-line-text").textContent, "Looking through the plays…");
  assert.equal(turn.querySelector(".sc-ask-line").hidden, false);
  stream.push(line({ type: "delta", text: "On 3rd and 1 to 3 " }));
  await flush();
  assert.equal(t.root.getAttribute("data-phase"), "streaming");
  assert.equal(turn.querySelector(".sc-ask-text-body").textContent, "On 3rd and 1 to 3 ");
  assert.equal(turn.querySelector(".sc-ask-line").hidden, true, "the quiet line goes when words arrive");
  assert.equal(t.q(".sc-ask-live").textContent, "", "nothing announced while it streams");
  stream.push(line(DONE));
  await flush();
  assert.equal(t.root.getAttribute("data-phase"), "done");
  assert.equal(turn.querySelector(".sc-ask-text-body").textContent, DONE.text);
  const cites = [...turn.querySelectorAll(".sc-ask-cite")];
  assert.deepEqual(cites.map((c) => c.textContent), ["Q3 2:52"]);
  assert.equal(cites[0].getAttribute("aria-label"), "Show Q3 2:52 on the field");
  assert.equal(t.q(".sc-ask-live").textContent, `The analyst answered: ${DONE.text}`);
  assert.equal(t.send.querySelector(".sc-key-name").textContent, "Ask");
}));

test("Shift+Enter is a new line, composing never sends, and an empty box sends nothing", run(async (doc) => {
  const t = setup(doc, { fetch: routedFetch({ ask: [streamResponse({ chunks: [line(DONE)] }).response] }) });
  t.panel.open(t.opener);
  await flush();
  type(t, QUESTION);
  assert.equal(keydown(t.input, "Enter", { shiftKey: true }).defaultPrevented, false);
  assert.equal(keydown(t.input, "Enter", { isComposing: true }).defaultPrevented, false);
  await flush();
  assert.equal(t.fetch.asks().length, 0);
  type(t, "   ");
  assert.equal(keydown(t.input, "Enter").defaultPrevented, true, "Enter is still spent, but nothing goes");
  await flush();
  assert.equal(t.fetch.asks().length, 0);
}));

test("a suggestion asks its question at once", run(async (doc) => {
  const t = setup(doc, { fetch: routedFetch({ ask: [streamResponse({ chunks: [line(DONE)] }).response] }) });
  t.panel.open(t.opener);
  await flush();
  const buttons = t.qa(".sc-ask-suggestion");
  assert.ok(buttons.every((b) => !b.disabled));
  click(buttons[3]);
  await flush();
  assert.equal(t.fetch.asks()[0].body.question, "What were his biggest surprises?");
  assert.equal(t.root.getAttribute("data-empty"), "false");
  assert.equal(doc.activeElement, t.input);
}));

test("a cite key emits sc:ask-cite with its seq; the page decides what it shows", run(async (doc) => {
  const t = setup(doc, { fetch: routedFetch({ ask: [streamResponse({ chunks: [line(DONE)] }).response] }) });
  t.panel.open(t.opener);
  await flush();
  type(t, QUESTION);
  keydown(t.input, "Enter");
  await flush();
  click(t.q(".sc-ask-cite"));
  const cite = t.emitted.find((e) => e.type === "sc:ask-cite");
  assert.deepEqual(cite.detail, { seq: 120, ref: "Q3 2:52" });
  assert.equal(cite.bubbles, true);
}));

test("the question and the answer are text, never markup (the answer can quote ESPN)", run(async (doc) => {
  const hostile = "<img src=x onerror=alert(1)> Prescott pass deep left <b>INTERCEPTED</b>";
  const done = { type: "done", text: hostile, cites: [{ seq: 3, ref: "<script>" }] };
  const t = setup(doc, { fetch: routedFetch({ ask: [streamResponse({ chunks: [line(done)] }).response] }) });
  t.panel.open(t.opener);
  await flush();
  type(t, "<b>bold?</b>");
  keydown(t.input, "Enter");
  await flush();
  const turn = t.q(".sc-ask-turn");
  assert.equal(turn.querySelector(".sc-ask-q-text").textContent, "<b>bold?</b>");
  const body = turn.querySelector(".sc-ask-text-body");
  assert.equal(body.textContent, hostile);
  assert.equal(body.children.length, 0);
  assert.equal(turn.querySelector(".sc-ask-cite").textContent, "Play 3");
}));

test("the second question carries the first exchange as history", run(async (doc) => {
  const t = setup(doc, { fetch: routedFetch({ ask: [() => streamResponse({ chunks: [line(DONE)] }).response] }) });
  t.panel.open(t.opener);
  await flush();
  type(t, QUESTION);
  keydown(t.input, "Enter");
  await flush();
  type(t, "And on 4th?");
  keydown(t.input, "Enter");
  await flush();
  assert.deepEqual(t.fetch.asks()[1].body, { question: "And on 4th?", history: [
    { role: "user", content: QUESTION }, { role: "assistant", content: DONE.text }] });
  assert.equal(t.qa(".sc-ask-turn").length, 2);
}));

test("closing while an answer streams stops it: the request is aborted and the turn says so", run(async (doc) => {
  const stream = streamResponse({ chunks: [line({ type: "delta", text: "Half an" })], end: "hang" });
  const t = setup(doc, { fetch: routedFetch({ ask: [stream.response] }) });
  t.panel.open(t.opener);
  await flush();
  type(t, QUESTION);
  keydown(t.input, "Enter");
  await flush();
  t.panel.close();
  await flush();
  assert.equal(t.fetch.asks()[0].init.signal.aborted, true);
  const turn = t.q(".sc-ask-turn");
  assert.equal(turn.getAttribute("data-state"), "stopped");
  assert.equal(turn.querySelector(".sc-ask-stopped").hidden, false);
  assert.equal(turn.querySelector(".sc-ask-text-body").textContent, "Half an");
  assert.equal(t.q(".sc-ask-live").textContent, "", "a stop isn't announced");
}));

test("the Stop key stops the answer and the box keeps focus", run(async (doc) => {
  const stream = streamResponse({ end: "hang" });
  const clock = { ms: 0 };
  const t = setup(doc, { fetch: routedFetch({ ask: [stream.response] }), clock });
  t.panel.open(t.opener);
  await flush();
  type(t, QUESTION);
  keydown(t.input, "Enter");
  await flush();
  clock.ms += STOP_GUARD_MS;            // a deliberate Stop, a moment after asking
  click(t.send);
  await flush();
  assert.equal(t.fetch.asks()[0].init.signal.aborted, true);
  assert.equal(t.q(".sc-ask-turn").getAttribute("data-state"), "stopped");
  assert.equal(doc.activeElement, t.input);
  assert.equal(t.root.hidden, false, "Stop keeps the panel open");
}));

// restructure-v2.md 11 item 5: Ask turns into Stop the moment the question goes, so a double-click used to ask and
// then stop. The second click of a double-click, or any press on Stop right after asking, is the same press.
test("a double-click on Ask asks once and never stops the answer it started", run(async (doc) => {
  const stream = streamResponse({ end: "hang" });
  const clock = { ms: 1000 };
  const t = setup(doc, { fetch: routedFetch({ ask: [stream.response] }), clock });
  t.panel.open(t.opener);
  await flush();
  type(t, QUESTION);
  click(t.send, 1);
  clock.ms += 120;
  click(t.send, 2);
  await flush();
  assert.equal(t.fetch.asks().length, 1, "one question went out");
  assert.equal(t.fetch.asks()[0].init.signal.aborted, false, "and it was never stopped");
  assert.equal(t.q(".sc-ask-turn").getAttribute("data-state"), "asking");
  assert.equal(t.send.querySelector(".sc-key-name").textContent, "Stop");
  clock.ms += 200;
  click(t.send, 1);                      // a slower second press, still part of the same moment
  await flush();
  assert.equal(t.fetch.asks()[0].init.signal.aborted, false, `a Stop within ${STOP_GUARD_MS} ms is the same press`);
  clock.ms += STOP_GUARD_MS;
  click(t.send, 0);                      // from the keyboard, well after: a real Stop
  await flush();
  assert.equal(t.fetch.asks()[0].init.signal.aborted, true);
  assert.equal(t.q(".sc-ask-turn").getAttribute("data-state"), "stopped");
}));

test("a double-click on a suggestion asks it once", run(async (doc) => {
  const stream = streamResponse({ end: "hang" });
  const t = setup(doc, { fetch: routedFetch({ ask: [stream.response] }) });
  t.panel.open(t.opener);
  await flush();
  const button = t.qa(".sc-ask-suggestion")[0];
  click(button, 1);
  click(button, 2);
  click(t.send, 2);
  await flush();
  assert.equal(t.fetch.asks().length, 1);
  assert.equal(t.fetch.asks()[0].init.signal.aborted, false);
}));

// The hard rule: shortcuts never fire while the slide-out has focus (core/keyboard.js stands down for a keydown from
// inside a [data-sc-layer]); the Model Report's embedded chat has no page shortcuts to keep out.
test("the slide-out keeps its keys: its root is a panel layer; the embedded chat's is not", run((doc) => {
  const t = setup(doc);
  assert.equal(t.root.getAttribute("data-sc-layer"), "panel");
  const host = doc.body.appendChild(doc.createElement("div"));
  const embedded = mountAsk(host, { layout: "embedded", id: "ask-e", fetchImpl: routedFetch().fetchImpl,
    timers: fakeTimers() });
  assert.equal(embedded.root.getAttribute("data-sc-layer"), null);
  embedded.destroy();
}));

test("with the drawer focused, the page's keys stand down; Escape there closes it and never goes live",
  run(async (doc) => {
    const t = setup(doc, { fetch: routedFetch({ ask: [streamResponse({ chunks: [line(DONE)] }).response] }) });
    const store = createStore(reducer, initialState());
    store.dispatch({ type: "state/loaded", body: stateBody({ watch: { state: "paused" } }), origin: "poll", reqSeq: 0,
      now: 0 });
    const { actions, calls } = recordingActions();
    const detach = attachKeyboard(doc, { store, actions });
    t.panel.open(t.opener);
    await flush();
    type(t, QUESTION);
    keydown(t.input, "Enter");
    await flush();
    const inside = [t.q(".sc-ask-cite"), t.qa(".sc-ask-suggestion")[0], t.q(".sc-ask-face"), t.input, t.send];
    for (const node of inside) {
      for (const k of [" ", "ArrowLeft", "ArrowRight", "1", "4", "v"]) {
        assert.equal(docKeydown(doc, node, k).defaultPrevented, false, `${k} stays the control's own`);
      }
    }
    assert.deepEqual(calls, [], "no page shortcut fired from inside the drawer");
    assert.equal(docKeydown(doc, t.q(".sc-ask-cite"), "Escape").defaultPrevented, true);
    assert.equal(t.root.hidden, true, "Escape closed the drawer");
    assert.deepEqual(calls, [], "and never went live");
    docKeydown(doc, t.outsider, "ArrowLeft");
    assert.deepEqual(calls, [["stepBack"]], "outside it, the keys are the page's again");
    detach();
  }));

test("429: the turn says busy, the status is checked again, and Ask again works once it is free", run(async (doc) => {
  const busy = "The analyst is answering another question. Ask again when it's done.";
  const fetch = routedFetch({ status: [statusBody(), statusBody({ busy: true }), statusBody()],
    ask: [jsonResponse(429, { error: busy }), streamResponse({ chunks: [line(DONE)] }).response] });
  const t = setup(doc, { fetch });
  t.panel.open(t.opener);
  await flush();
  type(t, QUESTION);
  keydown(t.input, "Enter");
  await flush();
  const turn = t.q(".sc-ask-turn");
  assert.equal(turn.getAttribute("data-state"), "error");
  assert.equal(turn.querySelector(".sc-ask-error-text").textContent, busy);
  assert.equal(t.root.getAttribute("data-status"), "busy");
  const retry = turn.querySelector(".sc-ask-retry");
  assert.equal(retry.hidden, false);
  assert.equal(retry.disabled, true, "not while the analyst is busy");
  assert.equal(t.q(".sc-ask-live").textContent, `The analyst couldn't answer. ${busy}`);
  assert.equal(t.timers.fire(400), 0, "refused at the door: the status was checked at once, not after a pause");
  assert.equal(t.root.getAttribute("data-status"), "busy", "still busy: checked again soon");
  assert.equal(t.timers.fire(2000), 1);
  await flush();
  assert.equal(t.root.getAttribute("data-status"), "ready");
  assert.equal(retry.disabled, false);
  click(retry);
  await flush();
  assert.equal(t.fetch.asks().length, 2);
  assert.equal(t.fetch.asks()[1].body.question, QUESTION);
  assert.equal(t.qa(".sc-ask-turn").length, 1, "the failed turn is replaced");
  assert.equal(t.q(".sc-ask-turn").getAttribute("data-state"), "done");
}));

test("not ready: the backend's own words, the keys off, and a check again every few seconds", run(async (doc) => {
  const message = "The analyst needs Ollama running with gpt-oss:20b. Start Ollama, then ask again.";
  const fetch = routedFetch({ status: [statusBody({ ready: false, ollama: false, message }),
    statusBody({ warm: false })] });
  const t = setup(doc, { fetch });
  t.panel.open(t.opener);
  await flush();
  assert.equal(t.root.getAttribute("data-status"), "down");
  assert.equal(t.q(".sc-ask-state-word").textContent, "Not ready");
  assert.equal(t.q(".sc-ask-note").textContent, message);
  assert.equal(t.q(".sc-ask-note").hidden, false);
  type(t, QUESTION);
  assert.equal(t.send.disabled, true);
  assert.ok(t.qa(".sc-ask-suggestion").every((b) => b.disabled));
  assert.equal(keydown(t.input, "Enter").defaultPrevented, true);
  await flush();
  assert.equal(fetch.asks().length, 0);
  assert.equal(t.timers.fireAll(), 1);
  await flush();
  assert.equal(t.root.getAttribute("data-status"), "warming");
  assert.match(t.q(".sc-ask-note").textContent, /about 10 s/);
  assert.equal(t.send.disabled, false);
  assert.equal(t.timers.pending.size, 0, "ready: no more checks");
}));

test("closing stops the status checks; reopening checks again", run(async (doc) => {
  const fetch = routedFetch({ status: [statusBody({ ready: false })] });
  const t = setup(doc, { fetch });
  t.panel.open(t.opener);
  await flush();
  assert.equal(t.timers.pending.size, 1);
  t.panel.close();
  assert.equal(t.timers.pending.size, 0);
  t.panel.toggle(t.opener);
  await flush();
  assert.equal(fetch.calls.filter((c) => c.url === "/api/ask/status").length, 2);
}));

test("embedded on the Model Report: shown at once, no Close, checked on mount, Escape left alone", run(async (doc) => {
  const fetch = routedFetch({ ask: [streamResponse({ chunks: [line(DONE)] }).response] });
  const t = setup(doc, { layout: "embedded", fetch });
  assert.equal(t.root.localName, "div", "the report's own section is the landmark");
  assert.equal(t.root.hidden, false);
  assert.equal(t.root.getAttribute("data-layout"), "embedded");
  assert.equal(t.q(".sc-ask-close"), null);
  assert.equal(t.panel.isOpen(), true);
  await flush();
  assert.equal(fetch.calls[0].url, "/api/ask/status");
  assert.equal(docKeydown(doc, t.input, "Escape").defaultPrevented, false);
  t.panel.close();
  assert.equal(t.root.hidden, false, "nothing to close");
  type(t, QUESTION);
  keydown(t.input, "Enter");
  await flush();
  assert.equal(t.q(".sc-ask-cite").getAttribute("aria-label"), "Find Q3 2:52 in every call");
  assert.equal(doc.documentElement.getAttribute("data-ask"), null, "only the slide-out moves the field");
}));

test("destroy stops everything: the request, the checks, the listeners, the nodes", run(async (doc) => {
  const stream = streamResponse({ end: "hang" });
  const fetch = routedFetch({ status: [statusBody({ ready: false }), statusBody()], ask: [stream.response] });
  const t = setup(doc, { fetch });
  t.panel.open(t.opener);
  await flush();
  t.panel.destroy();
  assert.equal(t.host.querySelector(".sc-ask"), null);
  assert.equal(t.timers.pending.size, 0);
  assert.equal((doc.listeners.get("keydown") ?? []).length, 0);
  assert.equal(doc.documentElement.getAttribute("data-ask"), null);
  assert.equal(t.opener.getAttribute("aria-expanded"), "false");
}));

test("with a frame scheduler, a burst of words renders once per frame", run(async (doc) => {
  const host = doc.createElement("div");
  doc.body.appendChild(host);
  const frames = [];
  const stream = streamResponse({ end: "hang" });
  const fetch = routedFetch({ ask: [stream.response] });
  const panel = mountAsk(host, { layout: "embedded", fetchImpl: fetch.fetchImpl, timers: fakeTimers(), now: () => 0,
    raf: (fn) => frames.push(fn) });
  const runFrames = () => frames.splice(0).forEach((fn) => fn());
  await flush();
  runFrames();
  const input = host.querySelector(".sc-ask-input");
  input.value = QUESTION;
  input.dispatchEvent({ type: "input" });
  keydown(input, "Enter");
  await flush();
  runFrames();
  for (const text of ["On ", "3rd ", "and ", "short "]) stream.push(line({ type: "delta", text }));
  await flush();
  assert.equal(frames.length, 1, "four deltas, one frame");
  assert.equal(host.querySelector(".sc-ask-text-body").textContent, "", "nothing drawn until the frame");
  runFrames();
  assert.equal(host.querySelector(".sc-ask-text-body").textContent, "On 3rd and short ");
  panel.destroy();
}));

test("mountAsk checks its host and id", run((doc) => {
  assert.throws(() => mountAsk(null), TypeError);
  const host = doc.createElement("div");
  doc.body.appendChild(host);
  assert.throws(() => mountAsk(host, { id: "Bad Id" }), TypeError);
  const panel = mountAsk(host, { layout: "nope", id: "ask-2", fetchImpl: async () => jsonResponse(200, statusBody()),
    timers: fakeTimers() });
  const layout = host.querySelector(".sc-ask").getAttribute("data-layout");
  assert.equal(layout, "slide", "an unknown layout is the slide-out");
  assert.equal(host.querySelector("#ask-2-input").localName, "textarea");
  panel.destroy();
}));

test("after its own answer the status is checked a moment later, once the server freed its gate", run(async (doc) => {
  const fetch = routedFetch({ status: [statusBody({ warm: false }), statusBody()],
    ask: [streamResponse({ chunks: [line(DONE)] }).response] });
  const t = setup(doc, { fetch });
  t.panel.open(t.opener);
  await flush();
  type(t, QUESTION);
  keydown(t.input, "Enter");
  await flush();
  const statusCalls = () => fetch.calls.filter((c) => c.url === "/api/ask/status").length;
  assert.equal(statusCalls(), 1, "not straight away");
  assert.equal(t.root.getAttribute("data-status"), "ready", "the answer itself says the model is warm");
  assert.equal(t.timers.fire(400), 1);
  await flush();
  assert.equal(statusCalls(), 2);
}));
