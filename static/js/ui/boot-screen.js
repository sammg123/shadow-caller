// Boot screen (ui-architecture.md 2.6, 3.1 step 5, 5.4; FI 3.11; #119, #120, G11; owner A9). DOM side, text only.
// Covers the page until the first state loads: "Loading the game…", then, when the server can't be reached, "Can't
// reach the app server" with a countdown and Retry now (actions.retryNow), or the restart screen for an old server
// (#119). It hides once the boot phase is ready. One polite line per phase speaks it; the countdown does not.
import { clear, el, setAttr, setData, setHidden, setText } from "./dom.js";
import { keycap, lamp, setKeyName } from "./keycap.js";

function build(ctx) {
  const heading = el("h2", { cls: "sc-boot-heading", attrs: { id: "sc-boot-heading" } });
  const text = el("p", { cls: "sc-boot-text" });
  const retry = keycap({ name: ctx.copy.CONN.retryNow, cls: "sc-boot-retry", data: { testid: "boot-retry" },
    on: { click: () => ctx.actions.retryNow() } });
  const board = el("div", { cls: "sc-boot-board" }, [
    el("p", { cls: "sc-boot-plate" }, [lamp("sc-boot-lamp"),
      el("span", { cls: "sc-boot-title", text: ctx.copy.APP.title })]),
    heading, text, retry.node,
  ]);
  const screen = el("section", {
    cls: "sc-boot", attrs: { "aria-labelledby": "sc-boot-heading", "aria-busy": "true" },
    data: { testid: "boot", phase: "loading" },
  }, [board]);
  const live = el("p", { cls: ["sc-boot-live", "sr-only"], attrs: { role: "status", "aria-live": "polite" } });
  setHidden(retry.node, true);
  return { screen, heading, text, retry, live, keys: { body: null, phase: null } };
}

/** The text line: runs of plain text, with the command in <strong> on the restart screen (FI 3.11). */
function renderText(parts, vm) {
  const runs = Array.isArray(vm.body) && vm.body.length ? vm.body : [{ text: vm.text ?? "", strong: false }];
  const key = JSON.stringify(runs);
  if (key === parts.keys.body) return;
  parts.keys.body = key;
  clear(parts.text);
  for (const run of runs) {
    const words = String(run?.text ?? "");
    const node = run?.strong ? el("strong", { text: words }) : parts.text.ownerDocument.createTextNode(words);
    parts.text.appendChild(node);
  }
}

function announce(parts, vm) {
  if (vm.phase === parts.keys.phase) return;
  parts.keys.phase = vm.phase;
  const words = vm.hidden ? "" : [vm.heading, vm.text].filter((t) => typeof t === "string" && t !== "").join(". ");
  setText(parts.live, words);
}

function render(parts, vm) {
  setHidden(parts.screen, Boolean(vm.hidden));
  setData(parts.screen, "phase", vm.phase);
  setAttr(parts.screen, "aria-busy", String(vm.phase === "loading"));
  setText(parts.heading, vm.heading);
  renderText(parts, vm);
  setHidden(parts.retry.node, !vm.retryLabel);
  if (vm.retryLabel) setKeyName(parts.retry, vm.retryLabel);
  announce(parts, vm);
}

/**
 * @param {HTMLElement} root  #rg-boot
 * @param {{ actions: object, copy: object }} ctx
 * @returns {{ update(vm: ReturnType<import("../model/vm-conn.js").bootVm>): void, destroy(): void }}
 */
export function mount(root, ctx) {
  const parts = build(ctx);
  root.appendChild(parts.screen);
  root.appendChild(parts.live);
  return {
    update(vm) {
      if (vm) render(parts, vm);
    },
    destroy() {
      parts.screen.remove();
      parts.live.remove();
    },
  };
}
