// ESPN feed bar (ui-architecture.md 2.6, 4.5, 5.1, 5.4; FI 2.2, 2.7, 3.2; #92 to #104, G12, G27; owner A9). DOM side.
// The ESPN live switch with its lamp, the game id box, Replay this game, Watch this game, the status line and the
// background message (G12, a polite live region, never a toast). The id box follows the server's event id only when
// that id changes and never while focused, and Enter in it only blurs (#104); the buttons hand its text to the
// actions, which trim it.
import { clear, el, setClass, setData, setHidden, setText } from "./dom.js";
import { keycap, lamp } from "./keycap.js";

function feedButton(ctx, read) {
  const text = el("span", { id: "feedBtnTxt", cls: "sc-feed-btn-text" });
  const node = el("button", {
    id: "feedBtn", cls: ["sc-key", "sc-feed-btn"], attrs: { type: "button" },
    data: { feedState: "off" }, on: { click: () => ctx.actions.feedToggle(read()) },
  }, [lamp("sc-feed-lamp"), text]);
  return { node, text };
}

function eventBox(ctx) {
  const F = ctx.copy.FEED;
  const input = el("input", {
    id: "feedEvent", cls: "sc-feed-event-input",
    attrs: { type: "text", inputmode: "numeric", autocomplete: "off", spellcheck: "false",
      placeholder: F.eventPlaceholder },
    on: {
      keydown: (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        input.blur();
      },
    },
  });
  const label = el("label", { cls: "sc-feed-event-label", attrs: { for: "feedEvent" }, text: F.eventLabel });
  return { node: el("div", { cls: "sc-feed-event" }, [label, input]), input };
}

function build(ctx) {
  const F = ctx.copy.FEED;
  const box = eventBox(ctx);
  const read = () => (typeof box.input.value === "string" ? box.input.value : "");
  const feed = feedButton(ctx, read);
  const replay = keycap({ id: "replayBtn", name: F.replay, title: F.replayTitle,
    on: { click: () => ctx.actions.replay(read()) } });
  const watch = keycap({ name: F.watch, title: F.watchTitle, cls: "sc-feed-watch", data: { watch: "start" },
    on: { click: () => ctx.actions.watchStart(read()) } });
  const status = el("p", { id: "feedStatus", cls: "sc-feed-status" });
  const bg = el("p", { cls: "sc-feed-bg", attrs: { role: "status", "aria-live": "polite" },
    data: { testid: "bg-message", empty: true } });
  const controls = el("div", { cls: "sc-feed-controls" }, [feed.node, box.node, replay.node, watch.node]);
  const node = el("div", { cls: "sc-feed", data: { feedState: "off" } }, [controls, status, bg]);
  const keys = { status: null, bg: null, eventId: null };   // what is on screen: an unchanged render writes nothing
  return { node, feed, input: box.input, watch: watch.node, status, bg, keys };
}

/** The status line: plain runs as text, labels in <strong> (FI 3.2). Rebuilt only when it changed. */
function renderStatus(parts, status) {
  const key = JSON.stringify(status ?? []);
  if (key === parts.keys.status) return;
  parts.keys.status = key;
  clear(parts.status);
  for (const seg of status ?? []) {
    const text = String(seg?.text ?? "");
    parts.status.appendChild(seg?.strong ? el("strong", { text }) : parts.status.ownerDocument.createTextNode(text));
  }
}

/** G12: each new message is a new line, so a world can step it in; the region itself stays put (polite). */
function renderBg(parts, text) {
  const value = typeof text === "string" ? text : "";
  if (value === parts.keys.bg) return;
  parts.keys.bg = value;
  clear(parts.bg);
  if (value) parts.bg.appendChild(el("span", { cls: "sc-feed-bg-line", text: value }));
  setData(parts.bg, "empty", value === "");
}

/** The id box follows the server's event id, but only when that id changes, and never while it has focus: text
 * typed there (and left by Enter or a click) stays until the server moves to another game (#104, FI 5.17). */
function renderInput(parts, eventId) {
  const value = typeof eventId === "string" ? eventId : "";
  if (value === parts.keys.eventId || parts.input.ownerDocument?.activeElement === parts.input) return;
  parts.keys.eventId = value;
  if (parts.input.value !== value) parts.input.value = value;
}

function render(parts, vm) {
  const state = vm.state ?? "off";
  setData(parts.node, "feedState", state);
  setData(parts.feed.node, "feedState", state);
  setClass(parts.feed.node, "on", Boolean(vm.on));
  setClass(parts.feed.node, "err", state === "retrying");
  setText(parts.feed.text, vm.buttonText);
  renderInput(parts, vm.eventId);
  setHidden(parts.watch, !vm.watchStartVisible);
  renderStatus(parts, vm.status);
  renderBg(parts, vm.bgMessage);
}

/**
 * @param {HTMLElement} root  #rg-feed
 * @param {{ actions: object, copy: object }} ctx
 * @returns {{ update(vm: ReturnType<import("../model/vm-feed.js").feedVm>): void, destroy(): void }}
 */
export function mount(root, ctx) {
  const parts = build(ctx);
  setHidden(parts.watch, true);
  root.appendChild(parts.node);
  return {
    update(vm) {
      if (vm) render(parts, vm);
    },
    destroy() {
      parts.node.remove();
    },
  };
}
