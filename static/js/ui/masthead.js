// The top bar's nameplate and game label (restructure-v2.md 2 and 11; ui-architecture.md 2.6, 5.1, 5.4; owner: home
// frame). DOM side, text only (G27). It mounts first in the top bar (#rg-masthead): the title, who this app shadows
// ("Shadowing Schottenheimer · DAL", both callers when both sides are tracked; the full words on its tooltip), then
// the game slot: the game picker (game-picker.md 3 and 5), whose key carries the current game ("TB at DAL · Final",
// #gameLabel) and opens the 2026 season; choosing a game and side(s) calls actions.selectGame (POST /api/game/select)
// and the page follows the new track. main.js loads the picker's module beside the components (ctx.picker); without
// it, or when it fails to mount, the slot shows the game's plain words and the GameCast goes on. The playback
// (ui/watch-transport.js) and the view keys (ui/view-keys.js) mount after it. Built once in mount; update only sets
// text and attributes.
import { el, setAttr, setData, setHidden, setText } from "./dom.js";

const LABEL = Object.freeze({ id: "gameLabel", testid: "game-label" });

const message = (err) => (err && typeof err.message === "string" && err.message ? err.message : String(err));

function report(err) {
  if (typeof globalThis.reportError === "function") globalThis.reportError(err);
}

function build(ctx) {
  const title = el("h1", { cls: "sc-masthead-title", text: ctx.copy.APP.title });
  const who = el("span", { id: "whoLabel", cls: "sc-masthead-who" });
  const plate = el("div", { cls: "sc-masthead-plate" }, [title, el("p", { cls: "sc-masthead-meta" }, [who])]);
  const slot = el("div", { cls: "sc-masthead-slot", data: { testid: "game-slot" } });
  return { plate, title, who, slot };
}

/** The game's plain words, when there is no picker (`#gameLabel`, hidden while empty). */
function plainLabel(slot) {
  const node = el("p", { id: LABEL.id, cls: "sc-masthead-game", data: { testid: LABEL.testid } });
  slot.appendChild(node);
  setHidden(node, true);
  return {
    show(text, title) {
      setText(node, text);
      setAttr(node, "title", title || null);
      setHidden(node, !text);
    },
    destroy: () => node.remove(),
  };
}

/** The game picker in the slot, its key's words carrying #gameLabel; null (and a notice) when it fails to mount. */
function pickerLabel(slot, ctx) {
  try {
    const picker = ctx.picker.mountPicker(slot, { onSelect: (selection) => ctx.actions.selectGame(selection) });
    setAttr(picker.labelNode, "id", LABEL.id);
    setData(picker.labelNode, "testid", LABEL.testid);
    return { show: (text, title) => picker.setLabel(text, title || null), destroy: () => picker.destroy() };
  } catch (err) {
    report(err);
    while (slot.firstChild) slot.removeChild(slot.firstChild);
    ctx.notices?.show?.("picker", `The game picker didn't load (${message(err)}), so the game can't be switched here.`);
    return null;
  }
}

function gameLabel(slot, ctx) {
  const usable = ctx.picker && typeof ctx.picker.mountPicker === "function";
  return (usable ? pickerLabel(slot, ctx) : null) ?? plainLabel(slot);
}

function render(parts, game, vm) {
  setText(parts.title, vm.title);
  setText(parts.who, vm.whoLabel);
  setAttr(parts.plate, "title", vm.plateTitle || null);
  setData(parts.plate, "sides", vm.sides || null);
  game.show(vm.gameLabel, vm.gameTitle);
}

/**
 * @param {HTMLElement} root  #rg-masthead (the top bar)
 * @param {{ copy: object, actions: { selectGame: Function }, picker?: { mountPicker: Function } | null,
 *   notices?: { show: Function } }} ctx  picker: picker/picker.js, loaded by main.js (null when it didn't load)
 * @returns {{ update(vm: ReturnType<import("../model/vm-masthead.js").mastheadVm>): void, destroy(): void }}
 */
export function mount(root, ctx) {
  const parts = build(ctx);
  root.appendChild(parts.plate);
  root.appendChild(parts.slot);
  const game = gameLabel(parts.slot, ctx);
  return {
    update(vm) {
      if (vm) render(parts, game, vm);
    },
    destroy() {
      game.destroy();
      parts.plate.remove();
      parts.slot.remove();
    },
  };
}
