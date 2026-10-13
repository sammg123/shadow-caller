// The game picker (docs/design/game-picker.md 3; restructure-v2.md 7, phase 2): a key for the top bar that opens a
// panel of the season's games by week (this week first), a team filter, the chosen game's two sides with their
// play-callers and "Track both sides", and a field for a pasted ESPN game link or id. It emits {event_id, sides}
// through onSelect; phase 2's POST /api/game/select acts on it. DOM side, through ui/dom.js: text only, never HTML.
// Keyboard: Escape closes it and is spent there (the page's Escape is Go Live), Up and Down walk the games. It is
// modal (restructure-v2.md 11 item 5): while it is open its panel carries data-sc-layer="modal", so no page shortcut
// fires anywhere (core/keyboard.js stands down), Escape from anywhere on the page closes it, and so does focus moving
// to a control outside it (it never stays open behind the control that has the keys).
import { el, reconcile, setAttr, setData, setHidden, setText } from "../ui/dom.js";
import { keycap, lamp } from "../ui/keycap.js";
import { pickerApi } from "./picker-api.js";
import { INITIAL, pickerReduce, pickerVm, selectionOf } from "./picker-vm.js";

export const REFRESH_MS = 30000;   // while open, the list is asked for again (a live game's clock and score move)
const ID = "sc-picker";

function report(err) {
  if (typeof globalThis.reportError === "function") globalThis.reportError(err);
  else queueMicrotask(() => { throw err; });
}

const defaultApi = () => pickerApi({ fetchImpl: (...args) => fetch(...args),
  setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (id) => clearTimeout(id) });
const defaultTimers = () => ({ setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id) });

function localZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

const isGame = (node) => typeof node?.getAttribute === "function" && node.getAttribute("data-event") !== null;
const isEscape = (e) => e.key === "Escape" || e.key === "Esc";
/** Escape with no modifier, outside an input method's composition (229 is the key code some browsers send then). */
const plainEscape = (e) => isEscape(e) && !(e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || e.isComposing)
  && e.keyCode !== 229;

function openWeek(node) {
  for (let n = node; n; n = n.parentNode) if (n.localName === "details") return n.hasAttribute("open");
  return true;
}

// ---------------------------------------------------------------- the nodes
function buildTools(p) {
  const select = el("select", { id: `${ID}-filter`, cls: "sc-picker-select",
    on: { change: () => p.dispatch({ type: "filter", team: select.value }) } });
  const input = el("input", { id: `${ID}-ref-input`, cls: "sc-picker-input", attrs: { type: "text", inputmode: "url",
    autocomplete: "off", spellcheck: "false", maxlength: "500", "aria-describedby": `${ID}-ref-help` },
  on: { input: () => p.dispatch({ type: "refText", text: input.value }) } });
  const find = el("button", { cls: ["sc-key", "sc-picker-find"], attrs: { type: "submit" }, text: "Find" });
  const help = el("p", { id: `${ID}-ref-help`, cls: "sc-picker-help" });
  const error = el("p", { id: `${ID}-ref-error`, cls: "sc-picker-error", attrs: { role: "alert", hidden: true } });
  const refLabel = el("label", { cls: "sc-picker-label", attrs: { for: input.id } });
  const form = el("form", { cls: "sc-picker-ref", attrs: { novalidate: true }, on: { submit: (e) => p.submitRef(e) } },
    [refLabel, el("div", { cls: "sc-picker-ref-row" }, [input, find]), help, error]);
  const filter = el("div", { cls: "sc-picker-filter" }, [el("label", { cls: "sc-picker-label", attrs: { for: select.id },
    text: "Team" }), select]);
  return { tools: el("div", { cls: "sc-picker-tools" }, [filter, form]), select, input, find, help, error, refLabel,
    form };
}

function buildChosen(p) {
  const back = keycap({ name: "Back to games", cls: "sc-picker-back", on: { click: () => p.back() } }).node;
  const title = el("h3", { cls: "sc-picker-chosen-title", attrs: { tabindex: "-1" } });
  const sub = el("p", { cls: "sc-picker-chosen-sub" });
  const sides = el("div", { cls: "sc-picker-side-list" });
  const fieldset = el("fieldset", { cls: "sc-picker-sides" }, [el("legend", { cls: "sc-picker-label",
    text: "Whose calls to shadow" }), sides]);
  const both = el("input", { cls: "sc-picker-both-box", attrs: { type: "checkbox" },
    on: { change: () => p.dispatch({ type: "both", on: both.checked }) } });
  const bothText = el("span", { cls: "sc-picker-both-text" });
  const bothNote = el("p", { cls: "sc-picker-note" });
  const go = el("button", { cls: ["sc-key", "sc-picker-go"], attrs: { type: "button" }, on: { click: () => p.go() } });
  const hint = el("p", { cls: "sc-picker-note sc-picker-go-hint" });
  const root = el("div", { cls: "sc-picker-chosen", attrs: { hidden: true } }, [back, title, sub, fieldset,
    el("label", { cls: "sc-picker-both" }, [both, bothText]), bothNote, el("div", { cls: "sc-picker-go-row" }, [go, hint])]);
  return { root, title, sub, sides, both, bothText, bothNote, go, hint };
}

function buildNodes(p, label) {
  const trigger = keycap({ name: "Game", value: String(label ?? ""), cls: "sc-picker-trigger", attrs: { "aria-haspopup": "dialog",
    "aria-expanded": "false", "aria-controls": `${ID}-panel` }, on: { click: () => p.toggle() } });
  const close = keycap({ cap: "Esc", name: "Close", shortcut: "Escape", cls: "sc-picker-close",
    on: { click: () => p.close() } }).node;
  const statusText = el("span", { cls: "sc-picker-status-text" });
  const retry = keycap({ name: "Try again", cls: "sc-picker-retry", on: { click: () => p.load() } }).node;
  const status = el("p", { cls: "sc-picker-status", attrs: { role: "status", "aria-live": "polite" } },
    [lamp("sc-picker-lamp"), statusText, retry]);
  const tools = buildTools(p);
  const list = el("div", { cls: "sc-picker-list" });
  const empty = el("p", { cls: "sc-picker-empty", attrs: { hidden: true } });
  const chosen = buildChosen(p);
  const title = el("h2", { id: `${ID}-title`, cls: "sc-picker-title" });
  const panel = el("section", { id: `${ID}-panel`, cls: "sc-picker-panel", attrs: { role: "dialog",
    "aria-labelledby": title.id, hidden: true }, on: { keydown: (e) => p.keydown(e) } }, [
    el("header", { cls: "sc-picker-head" }, [title, close]), tools.tools, status, list, empty, chosen.root]);
  const root = el("div", { cls: "sc-picker", data: { open: false } }, [trigger.node, panel]);
  return { root, trigger, panel, title, close, status, statusText, retry, list, empty, chosen, ...tools };
}

// ---------------------------------------------------------------- rows
function gameNode(p, row) {
  const team = (side) => el("span", { cls: "sc-picker-team", data: { side } }, [el("span", { cls: "sc-picker-abbr" }),
    el("span", { cls: "sc-picker-score" })]);
  const button = el("button", { cls: "sc-picker-game", attrs: { type: "button" }, data: { event: row.id },
    on: { click: () => p.pick(button.getAttribute("data-event")) } }, [team("away"), el("span", { cls: "sc-picker-at" }),
    team("home"), el("span", { cls: "sc-picker-state" }, [lamp("sc-picker-lamp"), el("span",
      { cls: "sc-picker-state-text" })]), el("span", { cls: "sc-picker-caller" })]);
  return el("li", { cls: "sc-picker-item" }, [button]);
}

function updateGame(li, row) {
  const button = li.firstChild;
  const [away, at, home, state, caller] = button.childNodes;
  setData(button, "kind", row.kind);
  setData(button, "picked", row.picked);
  setAttr(button, "aria-label", row.label);
  for (const [node, t] of [[away, row.away], [home, row.home]]) {
    setText(node.firstChild, t.abbr);
    setText(node.lastChild, t.score);
    setHidden(node.lastChild, !t.score);
  }
  setText(at, row.matchup.includes(" vs ") ? "vs" : "at");
  setText(state.lastChild, row.status);
  setText(caller, row.caller);
  setHidden(caller, !row.caller);
}

function weekNode(p, week) {
  const node = el("details", { cls: "sc-picker-week", data: { key: week.key } }, [
    el("summary", { cls: "sc-picker-week-head" }, [el("span", { cls: "sc-picker-week-title" }),
      el("span", { cls: "sc-picker-week-detail" })]),
    el("p", { cls: "sc-picker-week-note", attrs: { hidden: true } }), el("ul", { cls: "sc-picker-games" })]);
  node.addEventListener("toggle", () => p.toggled(node));
  return node;
}

function updateWeek(p, node, week) {
  const [head, note, list] = node.childNodes;
  setText(head.firstChild, week.title);
  setText(head.lastChild, week.detail);
  setData(node, "current", week.current);
  setText(note, week.note);
  setHidden(note, !week.note);
  p.shownOpen.set(week.key, week.open);
  setAttr(node, "open", week.open);
  reconcile(list, week.games, { key: (g) => g.id, create: (g) => gameNode(p, g), update: updateGame });
}

function sideNode(p, side) {
  const input = el("input", { cls: "sc-picker-side-box", attrs: { type: "radio", value: side.abbr },
    on: { change: () => p.dispatch({ type: "side", abbr: side.abbr }) } });
  return el("label", { cls: "sc-picker-side", data: { abbr: side.abbr } }, [input, el("span",
    { cls: "sc-picker-side-team" }), el("span", { cls: "sc-picker-side-caller" }), el("span",
    { cls: "sc-picker-side-note" })]);
}

/** A browser keeps one radio of a group checked, and a radio that joins a group while checked unchecks the others. So
 * a side that ends dark goes dark before it changes group, and one that ends lit changes group before it lights:
 * "Track both sides" keeps both lit, and turning it off leaves exactly the chosen side (restructure-v2.md 11 item 5). */
function setRadio(input, name, checked) {
  if (!checked) input.checked = false;
  setAttr(input, "name", name);
  input.checked = checked;
}

function updateSide(label, side) {
  const [input, team, caller, note] = label.childNodes;
  setRadio(input, `${ID}-${side.group}`, side.checked);
  input.disabled = side.disabled;
  setData(label, "model", side.model);
  setText(team, side.team);
  setText(caller, side.caller);
  setHidden(caller, !side.caller);       // no caller on file: the note says so
  setText(note, side.note);
}

// ---------------------------------------------------------------- the component
class Picker {
  constructor(host, { api, onSelect, timers, label, timeZone }) {
    Object.assign(this, { host, api, onSelect, timers, timeZone, ui: INITIAL, timer: null, seq: 0, lastGame: null });
    this.shownOpen = new Map();
    this.n = buildNodes(this, label);
    this.onOutside = (e) => { if (this.ui.open && !this.n.root.contains(e.target)) this.close({ focus: false }); };
    this.onDocKey = (e) => this.docKey(e);
    this.onFocusIn = (e) => {
      if (this.ui.open && e.target && !this.n.root.contains(e.target)) this.close({ focus: false });
    };
    this.n.trigger.node.addEventListener("keydown", (e) => this.triggerKey(e));
    host.appendChild(this.n.root);
    this.render();
  }

  dispatch(action) {
    const next = pickerReduce(this.ui, action);
    if (next === this.ui) return;
    this.ui = next;
    this.render();
  }

  toggle() {
    if (this.ui.open) this.close();
    else this.open();
  }

  open() {
    if (this.ui.open) return;
    this.dispatch({ type: "open" });
    const doc = this.host.ownerDocument;
    doc.addEventListener("pointerdown", this.onOutside);
    doc.addEventListener("keydown", this.onDocKey, true);
    doc.addEventListener("focusin", this.onFocusIn);   // modal: focus leaving it (Tab past its end) closes it
    this.n.select.focus();
    this.load();
  }

  close({ focus = true } = {}) {
    if (!this.ui.open) return;
    this.stopRefresh();
    this.seq += 1;                       // a load still on its way lands in a closed panel: ignored
    const doc = this.host.ownerDocument;
    doc.removeEventListener("pointerdown", this.onOutside);
    doc.removeEventListener("keydown", this.onDocKey, true);
    doc.removeEventListener("focusin", this.onFocusIn);
    this.dispatch({ type: "close" });
    if (focus) this.n.trigger.node.focus();
  }

  /** Escape from anywhere outside it (the page, a key it tabbed to) closes the open picker; it runs first (capture),
   * so the page's Escape (Go Live) sees it spent. Inside it, the panel's and the key's own handlers close it. */
  docKey(e) {
    if (!this.ui.open || e.defaultPrevented || !plainEscape(e) || this.n.root.contains(e.target)) return;
    e.preventDefault();
    this.close();
  }

  /** The models' index (restructure-v2.md 11 decision 1), or null: one that can't be read never stops the listing. */
  async callerIndex() {
    try {
      return typeof this.api.callers === "function" ? await this.api.callers() : null;
    } catch {
      return null;   // an older server, or the index unreadable: the listing's own word on each caller stands
    }
  }

  async load() {
    const seq = ++this.seq;
    this.stopRefresh();
    this.dispatch({ type: "loading" });
    try {
      const [data, callers] = await Promise.all([this.api.games(), this.callerIndex()]);
      if (seq === this.seq) this.dispatch({ type: "loaded", data, callers });
    } catch (err) {
      if (seq === this.seq) this.dispatch({ type: "loadFailed", error: err });
    }
    if (seq === this.seq && this.ui.open) this.timer = this.timers.setTimeout(() => this.load(), REFRESH_MS);
  }

  stopRefresh() {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
  }

  pick(eventId) {
    const game = (this.ui.data?.weeks ?? []).flatMap((w) => w.games ?? []).find((g) => g?.event_id === eventId);
    if (!game) return;
    this.lastGame = eventId;
    this.dispatch({ type: "pick", game });
    this.n.chosen.title.focus();
  }

  back() {
    this.dispatch({ type: "back" });
    const row = [...this.n.list.querySelectorAll(".sc-picker-game")].find((b) => b.getAttribute("data-event")
      === this.lastGame);
    (row ?? this.n.select).focus();
  }

  go() {
    const selection = selectionOf(this.ui);
    if (!selection) return;
    try {
      this.onSelect(selection);
    } catch (err) {
      report(err);
    }
    this.close();
  }

  async submitRef(e) {
    e.preventDefault();
    if (this.ui.ref.busy) return;
    const text = this.ui.ref.text;
    this.dispatch({ type: "refBusy" });
    try {
      const game = await this.api.resolve(text);
      if (!this.ui.open) return;         // closed while ESPN was asked: nothing to show
      this.lastGame = game?.event_id ?? null;
      this.dispatch({ type: "refFound", game });
      if (this.ui.chosen) this.n.chosen.title.focus();
    } catch (err) {
      if (this.ui.open) this.dispatch({ type: "refFailed", error: err });
    }
  }

  toggled(node) {
    const key = node.getAttribute("data-key");
    const open = node.hasAttribute("open");
    if (this.shownOpen.get(key) !== open) this.dispatch({ type: "toggleWeek", key, open });
  }

  keydown(e) {
    if (isEscape(e)) {
      e.preventDefault();
      e.stopPropagation();
      this.close();
      return;
    }
    e.stopPropagation();                 // the page's shortcuts never fire inside the picker
    if (isGame(e.target) && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      this.step(e.target, e.key === "ArrowDown" ? 1 : -1);
    }
  }

  triggerKey(e) {
    if (this.ui.open && isEscape(e)) {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }
  }

  step(from, by) {
    const rows = [...this.n.list.querySelectorAll(".sc-picker-game")].filter(openWeek);
    const next = rows[rows.indexOf(from) + by];
    if (next) next.focus();
  }

  render() {
    const vm = pickerVm(this.ui, { timeZone: this.timeZone });
    const { n } = this;
    setData(n.root, "open", vm.open);
    setAttr(n.trigger.node, "aria-expanded", String(vm.open));
    setHidden(n.panel, !vm.open);
    setData(n.panel, "scLayer", vm.open ? "modal" : null);   // modal while open: the page's shortcuts stand down
    setText(n.title, vm.title);
    this.renderStatus(vm);
    this.renderTools(vm);
    setHidden(n.list, Boolean(vm.chosen));
    reconcile(n.list, vm.weeks, { key: (w) => w.key, create: (w) => weekNode(this, w),
      update: (node, w) => updateWeek(this, node, w) });
    setText(n.empty, vm.empty);
    setHidden(n.empty, !vm.empty || Boolean(vm.chosen));
    this.renderChosen(vm.chosen);
  }

  renderStatus(vm) {
    const { status, statusText, retry } = this.n;
    setData(status, "tone", vm.status.tone);
    setText(statusText, vm.status.text);
    setHidden(status, !vm.status.text);
    setHidden(retry, !vm.status.retry);
  }

  renderTools(vm) {
    const { select, input, find, help, error, refLabel } = this.n;
    reconcile(select, vm.filter.options, { key: (o) => o.value || "all", create: () => el("option"),
      update: (node, o) => { setAttr(node, "value", o.value); setText(node, o.label); } });
    if (select.value !== vm.filter.value) select.value = vm.filter.value;
    setText(refLabel, vm.ref.label);
    if (input.value !== vm.ref.text) input.value = vm.ref.text;
    setAttr(input, "aria-invalid", vm.ref.error ? "true" : null);
    setAttr(input, "aria-describedby", vm.ref.error ? `${ID}-ref-help ${ID}-ref-error` : `${ID}-ref-help`);
    setText(find, vm.ref.busy ? "Finding…" : vm.ref.button);
    find.disabled = vm.ref.busy;
    setText(help, vm.ref.help);
    setText(error, vm.ref.error);
    setHidden(error, !vm.ref.error);
  }

  renderChosen(chosen) {
    const c = this.n.chosen;
    setHidden(c.root, !chosen);
    if (!chosen) return;
    setData(c.root, "kind", chosen.kind);
    setText(c.title, chosen.title);
    setText(c.sub, chosen.sub);
    reconcile(c.sides, chosen.sides, { key: (s) => s.abbr, create: (s) => sideNode(this, s), update: updateSide });
    c.both.checked = chosen.both.checked;
    c.both.disabled = chosen.both.disabled;
    setText(c.bothText, chosen.both.label);
    setText(c.bothNote, chosen.both.note);
    setText(c.go, chosen.go.label);
    c.go.disabled = chosen.go.disabled;
    setText(c.hint, chosen.go.hint);
  }

  /** The game's words on the key ("TB at DAL · Final") and their tooltip (the game's whole label), or none. */
  setLabel(text, title = null) {
    setText(this.n.trigger.value, text);
    setAttr(this.n.trigger.value, "title", title || null);
  }

  destroy() {
    this.close({ focus: false });
    this.stopRefresh();
    this.n.root.remove();
  }
}

/**
 * Mount the picker in `host` (the top bar's slot). opts: api ({games, resolve}; default: this page's server), onSelect
 * ({event_id, sides} when a game is opened), timers ({setTimeout, clearTimeout}), label (the trigger's game, "TB at
 * DAL"), timeZone (the viewer's own by default).
 * @returns {{ open: () => void, close: () => void, setLabel: (text: string, title?: string | null) => void,
 *   destroy: () => void, isOpen: () => boolean, labelNode: HTMLElement }}  labelNode: the key's game words, for a
 *   host's own hooks (the GameCast keeps #gameLabel on them)
 */
export function mountPicker(host, { api = null, onSelect = () => {}, timers = null, label = "", timeZone = null } = {}) {
  const picker = new Picker(host, { api: api ?? defaultApi(), onSelect, timers: timers ?? defaultTimers(), label,
    timeZone: timeZone ?? localZone() });
  return Object.freeze({ open: () => picker.open(), close: () => picker.close(),
    setLabel: (t, title) => picker.setLabel(t, title), destroy: () => picker.destroy(), isOpen: () => picker.ui.open,
    labelNode: picker.n.trigger.value });
}
