// Connection banner (ui-architecture.md 2.6, 3.9, 5.4; G11; owner A9). DOM side, text only.
// Online: nothing shows. One or two failures: the quiet "Reconnecting…" line. Three or more: "Can't reach the app
// server. Retrying in N s." with Retry now (actions.retryNow kicks the poll loop). The last good state stays on
// screen meanwhile. The countdown ticks on screen, but the polite region beside the banner speaks only when the
// state changes, so a screen reader hears one line per change instead of one every second.
import { el, setData, setHidden, setText } from "./dom.js";
import { keycap, lamp, setKeyName } from "./keycap.js";

function build(ctx) {
  const text = el("p", { cls: "sc-conn-text" });
  const retry = keycap({ name: ctx.copy.CONN.retryNow, cls: "sc-conn-retry", data: { testid: "conn-retry" },
    on: { click: () => ctx.actions.retryNow() } });
  const banner = el("div", { cls: "sc-conn", data: { testid: "conn", conn: "online" } },
    [lamp("sc-conn-lamp"), text, retry.node]);
  const live = el("p", { cls: ["sc-conn-live", "sr-only"], attrs: { role: "status", "aria-live": "polite" } });
  setHidden(banner, true);
  setHidden(retry.node, true);
  return { banner, text, retry, live, said: null };
}

function render(parts, vm) {
  const state = vm.state ?? "online";
  setHidden(parts.banner, state === "online");
  setData(parts.banner, "conn", state);
  setText(parts.text, vm.text);
  setHidden(parts.retry.node, state !== "offline");
  if (vm.retryLabel) setKeyName(parts.retry, vm.retryLabel);
  if (state !== parts.said) {
    parts.said = state;
    setText(parts.live, state === "online" ? "" : vm.text);
  }
}

/**
 * @param {HTMLElement} root  #rg-conn
 * @param {{ actions: object, copy: object }} ctx
 * @returns {{ update(vm: ReturnType<import("../model/vm-conn.js").connVm>): void, destroy(): void }}
 */
export function mount(root, ctx) {
  const parts = build(ctx);
  root.appendChild(parts.banner);
  root.appendChild(parts.live);
  return {
    update(vm) {
      if (vm) render(parts, vm);
    },
    destroy() {
      parts.banner.remove();
      parts.live.remove();
    },
  };
}
