// The top bar's view keys (restructure-v2.md 2 and 4; owner: home frame). DOM side, text only. After the playback:
// the camera (V cycles Wide and Blimp; its window names the mode), the "Model Report" link (ctx.reportHref keeps the
// page's world), the Ask key (hidden until the analyst's drawer mounts: shell/analyst.js) and Settings, which opens the
// world's small settings menu (ctx.settingsId names it; a world without one shows no Settings key).
import { el, setAttr, setData, setHidden } from "./dom.js";
import { keycap, setKeyValue } from "./keycap.js";

const REPORT_HREF = "/report";

function build(ctx) {
  const M = ctx.copy.MASTHEAD;
  const run = (name) => () => ctx.actions[name]();
  const camera = keycap({ cap: "V", name: M.camera, value: "", shortcut: "V", title: M.cameraTitle,
    cls: "sc-viewkey", data: { testid: "camera-mode" }, on: { click: run("cycleCamera") } });
  const report = keycap({ tag: "a", name: M.report, title: M.reportTitle, cls: ["sc-viewkey", "sc-key-link"],
    attrs: { href: ctx.reportHref || REPORT_HREF }, data: { testid: "model-report" } });
  // restructure-v2.md 11: hidden until the analyst's drawer mounts (shell/analyst.js shows it, with "Not ready" in its
  // value when the analyst can't answer)
  const ask = keycap({ name: M.ask, value: "", cls: "sc-viewkey", data: { testid: "ask" } });
  setHidden(ask.node, true);
  const settings = keycap({ name: M.settings, title: M.settingsTitle, cls: "sc-viewkey",
    attrs: { "aria-expanded": "false", "aria-controls": ctx.settingsId || null }, data: { testid: "settings-toggle" },
    on: { click: run("toggleSettings") } });
  setHidden(settings.node, !ctx.settingsId);
  const node = el("div", { cls: "sc-viewkeys", attrs: { role: "group", "aria-label": M.viewGroup } },
    [camera.node, report.node, ask.node, settings.node]);
  return { node, camera, settings };
}

function render(parts, vm) {
  setKeyValue(parts.camera, vm.cameraLabel);
  setData(parts.camera.node, "camera", vm.cameraMode || null);
  setAttr(parts.settings.node, "aria-expanded", String(Boolean(vm.settingsOpen)));
}

/**
 * @param {HTMLElement} root  #rg-masthead (the top bar; this mounts last in it)
 * @param {{ actions: object, copy: object, reportHref?: string, settingsId?: string | null }} ctx
 * @returns {{ update(vm: ReturnType<import("../model/vm-view-keys.js").viewKeysVm>): void, destroy(): void }}
 */
export function mount(root, ctx) {
  const parts = build(ctx);
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
