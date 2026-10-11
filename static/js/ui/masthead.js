// The top bar's nameplate (restructure-v2.md 2; ui-architecture.md 2.6, 5.1, 5.4; owner: home frame). DOM side, text
// only (G27). It mounts first in the top bar (#rg-masthead): the title, who this app shadows ("Shadowing
// Schottenheimer · DAL", the full words on its tooltip) and the current game ("TB at DAL · Final"; phase 2's game
// picker takes this place). The playback (ui/watch-transport.js) and the view keys (ui/view-keys.js) mount after it.
// Built once in mount; update only sets text and attributes.
import { el, setAttr, setHidden, setText } from "./dom.js";

function build(ctx) {
  const title = el("h1", { cls: "sc-masthead-title", text: ctx.copy.APP.title });
  const who = el("span", { id: "whoLabel", cls: "sc-masthead-who" });
  const plate = el("div", { cls: "sc-masthead-plate" }, [title, el("p", { cls: "sc-masthead-meta" }, [who])]);
  const game = el("p", { id: "gameLabel", cls: "sc-masthead-game", data: { testid: "game-label" } });
  return { plate, title, who, game };
}

function render(parts, vm) {
  setText(parts.title, vm.title);
  setText(parts.who, vm.whoLabel);
  setAttr(parts.plate, "title", vm.plateTitle || null);
  setText(parts.game, vm.gameLabel);
  setAttr(parts.game, "title", vm.gameTitle || null);
  setHidden(parts.game, !vm.gameLabel);
}

/**
 * @param {HTMLElement} root  #rg-masthead (the top bar)
 * @param {{ copy: object }} ctx
 * @returns {{ update(vm: ReturnType<import("../model/vm-masthead.js").mastheadVm>): void, destroy(): void }}
 */
export function mount(root, ctx) {
  const parts = build(ctx);
  root.appendChild(parts.plate);
  root.appendChild(parts.game);
  setHidden(parts.game, true);
  return {
    update(vm) {
      if (vm) render(parts, vm);
    },
    destroy() {
      parts.plate.remove();
      parts.game.remove();
    },
  };
}
