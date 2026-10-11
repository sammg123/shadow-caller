// The Model Report ribbon's live part (DOM side, text only through ui/dom.js): who the page shadows and the game, both
// teams (ESPN's logo, the abbreviation, the score), and the status lamp with its words. One polite line says the news
// (the score and the status word) when it changes; the clock only ticks on screen. Logos as the scoreboard picks them
// (ui/scoreboard.js): ESPN's dark-background variant when the world asks for it (--sc-logo-variant: dark), and a logo
// that fails to load steps aside for the abbreviation beside it.
import { el, reconcile, setAttr, setData, setHidden, setText } from "../../ui/dom.js";

const TEAM_PARTS = new WeakMap();
const VARIANT_PROP = "--sc-logo-variant";

/** "dark" when the world asks for ESPN's dark-background logos (a CSS custom property on the ribbon). */
function readVariant(node) {
  try {
    const value = node.ownerDocument?.defaultView?.getComputedStyle?.(node)?.getPropertyValue(VARIANT_PROP);
    return typeof value === "string" && value.trim() === "dark" ? "dark" : "default";
  } catch {
    return "default";   // no computed style (a document without a window): the plain logos
  }
}

/** The variant for what decides it (the world and the room lights on <html>), read again only when they change. */
function variantFor(node, memo) {
  const html = node.ownerDocument?.documentElement;
  const key = `${html?.getAttribute("data-world") ?? ""}|${html?.getAttribute("data-ambient") ?? ""}`;
  return memo && memo.key === key ? memo : { key, variant: readVariant(node) };
}

function createTeam() {
  const img = el("img", { attrs: { alt: "", width: "28", height: "28", decoding: "async" } });
  const abbr = el("span", { cls: "rp-abbr" });
  const score = el("span", { cls: ["rp-team-score", "sc-num"] });
  const node = el("span", { cls: "rp-team" }, [el("span", { cls: "rp-logo", attrs: { "aria-hidden": "true" } }, [img]),
    abbr, score]);
  TEAM_PARTS.set(node, { img, abbr, score, failed: [] });
  img.addEventListener("error", () => {
    const parts = TEAM_PARTS.get(node);
    TEAM_PARTS.set(node, { ...parts, failed: [...parts.failed, img.getAttribute("src")] });
    setHidden(img, true);
  });
  return node;
}

function updateTeam(node, team, variant) {
  const p = TEAM_PARTS.get(node);
  const src = (variant === "dark" && team.logoDark) || team.logo || null;
  const usable = Boolean(src) && !p.failed.includes(src);
  setData(node, "team", team.abbr);
  setData(node, "caller", Boolean(team.caller));
  setAttr(p.img, "src", usable ? src : null);
  setHidden(p.img, !usable);
  setText(p.abbr, team.abbr);
  setText(p.score, team.score);
}

function skeleton() {
  const ui = {
    who: el("p", { cls: "rp-who" }),
    game: el("p", { cls: "rp-game" }),
    teams: el("p", { cls: "rp-teams" }),
    statusText: el("span", { cls: "rp-status-text" }),
    news: el("p", { cls: ["rp-news", "sr-only"], attrs: { role: "status", "aria-live": "polite" } }),
  };
  const lamp = el("span", { cls: ["sc-lamp", "rp-status-lamp"], attrs: { "aria-hidden": "true" } });
  ui.status = el("p", { cls: "rp-status" }, [lamp, ui.statusText]);
  ui.box = el("div", { cls: "rp-head" },
    [el("div", { cls: "rp-id" }, [ui.who, ui.game]), ui.teams, ui.status, ui.news]);
  return ui;
}

/**
 * @param {HTMLElement} root  the ribbon's live slot ([data-mount="head"])
 * @returns {{ update(vm: ReturnType<import("../model/vm-head.js").headVm>): void, destroy(): void }}
 */
export function mount(root) {
  const ui = skeleton();
  let logos = null;
  root.appendChild(ui.box);
  return {
    update(vm) {
      setText(ui.who, vm.who);
      setText(ui.game, vm.game);
      setAttr(ui.game, "title", vm.game || null);
      logos = variantFor(root, logos);
      reconcile(ui.teams, vm.teams, { key: (t) => t.abbr, create: createTeam,
        update: (node, team) => updateTeam(node, team, logos.variant) });
      setData(ui.status, "tone", vm.status.tone);
      setText(ui.statusText, vm.status.text);
      setText(ui.news, vm.spoken);
    },
    destroy() {
      ui.box.remove();
    },
  };
}
