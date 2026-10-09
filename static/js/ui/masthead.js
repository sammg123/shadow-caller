// Masthead (ui-architecture.md 2.6, 5.1, 5.4; FI 3.1, #1; owner A9). DOM side, text only (G27).
// The nameplate (title, the game, who is modelled) and two groups of keys: the game keys (Undo, Export CSV, Reset)
// and the view keys (camera V, booth B, scorecard G). Built once in mount; update only sets text and attributes.
// Every key calls ctx.actions; the confirm for Reset lives in actions (dialogs.confirmAction).
import { el, setAttr, setData, setText } from "./dom.js";
import { keycap, setKeyValue } from "./keycap.js";

const CSV_HREF = "/api/export.csv";
const CSV_NAME = "shadow_caller_log.csv";

function gameKeys(ctx) {
  const M = ctx.copy.MASTHEAD;
  const run = (name) => () => ctx.actions[name]();
  return {
    undo: keycap({ id: "undoBtn", cap: "U", name: M.undo, shortcut: "U", title: M.undoTitle,
      on: { click: run("undo") } }),
    csv: keycap({ tag: "a", name: M.exportCsv, cls: "sc-key-link", attrs: { href: CSV_HREF, download: CSV_NAME } }),
    reset: keycap({ id: "resetBtn", name: M.reset, cls: "sc-key-danger", on: { click: run("reset") } }),
  };
}

function viewKeys(ctx) {
  const M = ctx.copy.MASTHEAD;
  const run = (name) => () => ctx.actions[name]();
  return {
    camera: keycap({ cap: "V", name: M.camera, value: "", shortcut: "V", title: M.cameraTitle,
      data: { testid: "camera-mode" }, on: { click: run("cycleCamera") } }),
    booth: keycap({ cap: "B", name: M.booth, shortcut: "B", title: M.boothTitle,
      attrs: { "aria-expanded": "false" }, data: { testid: "booth-toggle" }, on: { click: run("toggleBooth") } }),
    scorecard: keycap({ cap: "G", name: M.scorecard, shortcut: "G", title: M.scorecardTitle,
      attrs: { "aria-expanded": "false", "aria-controls": "rg-score" }, data: { testid: "scorecard-toggle" },
      on: { click: run("toggleScorecard") } }),
  };
}

function build(ctx) {
  const M = ctx.copy.MASTHEAD;
  const title = el("h1", { cls: "sc-masthead-title", text: ctx.copy.APP.title });
  const game = el("span", { id: "gameLabel", cls: "sc-masthead-game" });
  const who = el("span", { id: "whoLabel", cls: "sc-masthead-who" });
  const keys = { ...gameKeys(ctx), ...viewKeys(ctx) };
  const plate = el("div", { cls: "sc-masthead-plate" }, [title, el("p", { cls: "sc-masthead-meta" }, [game, who])]);
  const group = (cls, label, nodes) => el("div", { cls: ["sc-masthead-keys", cls], attrs: { role: "group",
    "aria-label": label } }, nodes);
  const gameGroup = group("sc-masthead-game-keys", M.gameGroup, [keys.undo.node, keys.csv.node, keys.reset.node]);
  const viewGroup = group("sc-masthead-view-keys", M.viewGroup,
    [keys.camera.node, keys.booth.node, keys.scorecard.node]);
  const controls = el("div", { cls: "sc-masthead-controls" }, [gameGroup, viewGroup]);
  const node = el("div", { cls: "sc-masthead" }, [plate, controls]);
  return { node, title, game, who, keys };
}

function render(parts, vm) {
  setText(parts.title, vm.title);
  setText(parts.game, vm.gameLabel);
  setText(parts.who, vm.whoLabel);
  setData(parts.node, "hasGame", Boolean(vm.gameLabel));
  setKeyValue(parts.keys.camera, vm.cameraLabel);
  setData(parts.keys.camera.node, "camera", vm.cameraMode || null);
  setAttr(parts.keys.booth.node, "aria-expanded", String(Boolean(vm.boothOpen)));
  setAttr(parts.keys.scorecard.node, "aria-expanded", String(Boolean(vm.scorecardOpen)));
}

/**
 * @param {HTMLElement} root  #rg-masthead
 * @param {{ actions: object, copy: object }} ctx
 * @returns {{ update(vm: ReturnType<import("../model/vm-masthead.js").mastheadVm>): void, destroy(): void }}
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
