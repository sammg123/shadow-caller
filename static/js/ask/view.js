// The analyst panel's nodes (DOM side, through ui/dom.js: text only, never markup; docs/design/analyst-ui.md).
// buildPanel makes them once; renderPanel applies a view model (vm.js askVm). Turns and cite keys are keyed lists
// (reconcile), so a streaming answer rewrites only its own text node and a focused key keeps focus. The DOM order is
// the tab order: the head (title, status, Close), the intro (suggestions), the conversation, the box and its key.
//
// Hooks the sheets style against (css/ask/ask.css, css/ask/ask-under-the-lights.css):
//   .sc-ask[data-layout="slide|embedded"][data-open][data-phase][data-status][data-empty]
//   .sc-ask-head > .sc-ask-title, .sc-ask-state[data-tone="good|warn|bad|idle"] (.sc-ask-lamp, .sc-ask-state-word),
//     .sc-ask-close; .sc-ask-note
//   .sc-ask-body > .sc-ask-intro (.sc-ask-lead, .sc-ask-facts, .sc-ask-try, .sc-ask-suggestions .sc-ask-suggestion),
//     .sc-ask-face (.sc-ask-empty, .sc-ask-log > .sc-ask-turn[data-state]), .sc-ask-desk (.sc-ask-row > .sc-ask-input
//     + .sc-ask-send[data-mode], .sc-ask-hint > .sc-ask-count)
//   .sc-ask-turn > .sc-ask-q (.sc-ask-q-text), .sc-ask-a (.sc-ask-line, .sc-ask-text > .sc-ask-text-body,
//     .sc-ask-error, .sc-ask-stopped, .sc-ask-cites > .sc-ask-cite, .sc-ask-retry)
import { clear, el, reconcile, setAttr, setData, setHidden, setText } from "../ui/dom.js";
import { keycap, lamp } from "../ui/keycap.js";
import { ASK } from "./copy.js";
import { LIMITS } from "./history.js";

/** Each turn's own parts, so an update never searches the DOM. */
const PARTS = new WeakMap();
/** The id of the last announcement each live region read out. */
const ANNOUNCED = new WeakMap();

function setDisabled(node, disabled) {
  const want = Boolean(disabled);
  if (node.disabled !== want) node.disabled = want;
}

function buildHead(h, ids, layout) {
  const title = el("h2", { id: ids.title, cls: "sc-ask-title", text: ASK.title });
  const word = el("span", { cls: "sc-ask-state-word" });
  const state = el("p", { cls: "sc-ask-state", data: { testid: "ask-status" } },
    [el("span", { cls: "sr-only", text: `${ASK.statusLabel}: ` }), lamp("sc-ask-lamp"), word]);
  const close = layout === "slide"
    ? keycap({ cap: "Esc", name: ASK.close, shortcut: "Escape", title: ASK.closeTitle, cls: "sc-ask-close",
      data: { testid: "ask-close" }, on: { click: () => h.close() } }).node
    : null;
  return { head: el("header", { cls: "sc-ask-head" }, [title, state, close]), word, state };
}

function buildIntro(h, ids) {
  const facts = el("ul", { cls: "sc-ask-facts" });
  const suggestions = ASK.suggestions.map((text) => el("button", { cls: "sc-ask-suggestion", attrs: { type: "button" },
    data: { testid: "ask-suggestion" }, text, on: { click: () => h.suggest(text) } }));
  const intro = el("div", { cls: "sc-ask-intro" }, [
    el("p", { cls: "sc-ask-lead", text: ASK.lead }),
    facts,
    el("p", { id: ids.try, cls: "sc-ask-try", text: ASK.tryLabel }),
    el("ul", { cls: "sc-ask-suggestions", attrs: { "aria-labelledby": ids.try } },
      suggestions.map((button) => el("li", {}, [button]))),
  ]);
  return { intro, facts, suggestions };
}

function buildDesk(h, ids) {
  const input = el("textarea", { id: ids.input, cls: "sc-ask-input", data: { testid: "ask-input" },
    attrs: { rows: "2", maxlength: String(LIMITS.question), placeholder: ASK.placeholder, autocomplete: "off",
      enterkeyhint: "send", "aria-describedby": ids.hint },
    on: { input: () => h.input(input.value), keydown: (e) => h.key(e), focus: () => h.focused() } });
  const send = keycap({ cap: ASK.sendCap, name: ASK.send, shortcut: "Enter", title: ASK.sendTitle, cls: "sc-ask-send",
    data: { testid: "ask-send", mode: "ask" }, on: { click: () => h.sendOrStop() } });
  const count = el("span", { cls: "sc-ask-count", attrs: { hidden: true } });
  const desk = el("div", { cls: "sc-ask-desk" }, [
    el("label", { cls: "sr-only", attrs: { for: ids.input }, text: ASK.inputLabel }),
    el("div", { cls: "sc-ask-row" }, [input, send.node]),
    el("p", { id: ids.hint, cls: "sc-ask-hint" }, [el("span", { cls: "sc-ask-hint-text", text: ASK.hint }), count]),
  ]);
  return { desk, input, send, count };
}

/**
 * The panel's nodes. h: the controller's handlers ({ close, suggest(text), retry(id), cite(seq, ref), input(text),
 * key(event), focused(), sendOrStop() }).
 * @param {object} h
 * @param {{ layout: "slide" | "embedded", id: string }} opts
 */
export function buildPanel(h, { layout, id }) {
  const ids = { root: id, title: `${id}-title`, try: `${id}-try`, input: `${id}-input`, hint: `${id}-hint` };
  const head = buildHead(h, ids, layout);
  const intro = buildIntro(h, ids);
  const desk = buildDesk(h, ids);
  const note = el("p", { cls: "sc-ask-note", attrs: { hidden: true } });
  const log = el("ol", { cls: "sc-ask-log", data: { testid: "ask-log" } });
  const face = el("div", { cls: "sc-ask-face",
    attrs: { tabindex: "0", role: "group", "aria-label": ASK.conversation } },
  [el("p", { cls: "sc-ask-empty", text: ASK.emptyLog }), log]);
  const live = el("p", { cls: ["sr-only", "sc-ask-live"], attrs: { role: "status", "aria-live": "polite",
    "aria-atomic": "true" } });
  const slide = layout === "slide";
  const root = el(slide ? "aside" : "div", { id: ids.root, cls: "sc-ask",
    attrs: { "aria-labelledby": slide ? ids.title : null, hidden: slide },
    data: { layout, open: slide ? false : null, testid: "ask-panel" } },
  [head.head, note, el("div", { cls: "sc-ask-body" }, [intro.intro, face, desk.desk]), live]);
  return Object.freeze({ root, ...head, note, ...intro, face, log, ...desk, live, h, layout });
}

// ---------------------------------------------------------------- turns
function citeNode(h) {
  const button = el("button", { cls: "sc-ask-cite", attrs: { type: "button" }, data: { testid: "ask-cite" },
    on: { click: () => h.cite(Number(button.getAttribute("data-seq")), button.textContent) } });
  return button;
}

function updateCite(button, chip) {
  setData(button, "seq", chip.seq);
  setText(button, chip.label);
  setAttr(button, "aria-label", chip.title);
  setAttr(button, "title", chip.title);
}

function turnNode(h, turn) {
  const qText = el("span", { cls: "sc-ask-q-text" });
  const lineText = el("span", { cls: "sc-ask-line-text" });
  const line = el("p", { cls: "sc-ask-line", attrs: { hidden: true } }, [lamp("sc-ask-line-lamp"), lineText]);
  const body = el("span", { cls: "sc-ask-text-body" });
  const text = el("p", { cls: "sc-ask-text", attrs: { hidden: true } },
    [el("span", { cls: "sr-only", text: `${ASK.analystSaid} ` }), body]);
  const errorText = el("span", { cls: "sc-ask-error-text" });
  const error = el("p", { cls: "sc-ask-error", attrs: { hidden: true } }, [lamp("sc-ask-error-lamp"), errorText]);
  const stopped = el("p", { cls: "sc-ask-stopped", attrs: { hidden: true }, text: ASK.stopped });
  const cites = el("div", { cls: "sc-ask-cites",
    attrs: { role: "group", "aria-label": ASK.citesLabel, hidden: true } });
  const li = el("li", { cls: "sc-ask-turn", data: { id: turn.id, testid: "ask-turn" } });
  const retry = keycap({ name: ASK.retry, cls: "sc-ask-retry", attrs: { hidden: true }, data: { testid: "ask-retry" },
    on: { click: () => h.retry(Number(li.getAttribute("data-id"))) } }).node;
  li.appendChild(el("p", { cls: "sc-ask-q" }, [el("span", { cls: "sr-only", text: `${ASK.youAsked} ` }), qText]));
  li.appendChild(el("div", { cls: "sc-ask-a" }, [line, text, error, stopped, cites, retry]));
  PARTS.set(li, { qText, line, lineText, text, body, error, errorText, stopped, cites, retry });
  return li;
}

function updateTurn(h, li, turn) {
  const p = PARTS.get(li);
  setData(li, "state", turn.state);
  setText(p.qText, turn.question);
  setText(p.lineText, turn.line);
  setHidden(p.line, !turn.line);
  setText(p.body, turn.answer);
  setHidden(p.text, !turn.answer);
  setText(p.errorText, turn.error);
  setHidden(p.error, !turn.error);
  setHidden(p.stopped, !turn.stopped);
  reconcile(p.cites, turn.cites, { key: (c) => c.key, create: () => citeNode(h), update: updateCite });
  setHidden(p.cites, turn.cites.length === 0);
  setHidden(p.retry, !turn.retry.shown);
  setDisabled(p.retry, turn.retry.disabled);
}

// ---------------------------------------------------------------- the panel
function renderSend(n, send) {
  setText(n.send.name, send.label);
  setText(n.send.cap, send.cap);
  setHidden(n.send.cap, !send.cap);
  setData(n.send.node, "mode", send.mode);
  setAttr(n.send.node, "title", send.title);
  setAttr(n.send.node, "aria-keyshortcuts", send.mode === "ask" ? "Enter" : null);
  setDisabled(n.send.node, send.disabled);
}

function announce(n, said) {
  if (!said || ANNOUNCED.get(n.live) === said.id) return;
  ANNOUNCED.set(n.live, said.id);
  clear(n.live);                             // a new node each time: the same words twice are heard twice
  n.live.appendChild(el("span", { text: said.text }));
}

/**
 * Show a view model.
 * @param {ReturnType<typeof buildPanel>} n
 * @param {ReturnType<typeof import("./vm.js").askVm>} vm
 */
export function renderPanel(n, vm) {
  setData(n.root, "phase", vm.phase);
  setData(n.root, "status", vm.status.key);
  setData(n.root, "empty", vm.empty);
  setData(n.state, "tone", vm.status.tone);
  setText(n.word, vm.status.word);
  setText(n.note, vm.status.note);
  setHidden(n.note, !vm.status.note);
  reconcile(n.facts, vm.facts, { key: (f) => f, create: () => el("li", { cls: "sc-ask-fact" }),
    update: (node, f) => setText(node, f) });
  n.suggestions.forEach((button, i) => setDisabled(button, vm.suggestions[i]?.disabled ?? true));
  reconcile(n.log, vm.turns, { key: (t) => t.key, create: (t) => turnNode(n.h, t),
    update: (node, t) => updateTurn(n.h, node, t) });
  renderSend(n, vm.send);
  setText(n.count, vm.count.text);
  setHidden(n.count, !vm.count.shown);
  announce(n, vm.announce);
}
