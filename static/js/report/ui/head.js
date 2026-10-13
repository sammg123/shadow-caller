// The Model Report ribbon's live part (DOM side, text only through ui/dom.js): who the page shadows and the game, both
// teams (ESPN's logo, the abbreviation, the score), and the status lamp with its words. One polite line says the news
// (the score and the status word) when it changes; the clock only ticks on screen. Logos as the scoreboard picks them
// (ui/scoreboard.js): ESPN's dark-background variant when the world asks for it (--sc-logo-variant: dark), and a logo
// that fails to load steps aside for the abbreviation beside it. With both play-callers tracked the who line is the
// switch (restructure-v2.md 11 decision 4): .rp-sides[role=group] > .rp-side-key[aria-pressed][data-team], his team in
// the key's window (.rp-side-team) and his last name on its face; a press asks ctx.actions.showSide(team).
import { act } from "../../ui/input-kit.js";
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

// ---------------------------------------------------------------- the switch between two callers' sections
const KEY_PARTS = new WeakMap();

/** A caller's key: his team in the window, his last name on the face; a press asks for his sections. */
function createSideKey(pick) {
  const team = el("span", { cls: "rp-side-team" });
  const name = el("span", { cls: "sc-key-name" });
  // the space keeps the accessible name two words ("TB Robinson"); the key's flex gap sets the visible spacing
  const node = el("button", { cls: ["sc-key", "rp-side-key"], attrs: { type: "button", "aria-pressed": "false" } },
    [team, " ", name]);
  node.addEventListener("click", () => pick(node.getAttribute("data-team")));
  KEY_PARTS.set(node, { team, name });
  return node;
}

function updateSideKey(node, key) {
  const p = KEY_PARTS.get(node);
  setData(node, "team", key.team);
  setAttr(node, "aria-pressed", String(Boolean(key.pressed)));
  setAttr(node, "title", key.title || null);
  setText(p.team, key.team);
  setText(p.name, key.name);
}

function renderSides(ui, sides, pick) {
  setHidden(ui.who, sides.shown);
  setHidden(ui.sides, !sides.shown);
  setAttr(ui.sides, "aria-label", sides.group || null);
  setText(ui.sidesLabel, sides.label);
  reconcile(ui.sideKeys, sides.keys, { key: (k) => k.team, create: () => createSideKey(pick), update: updateSideKey });
}

function skeleton() {
  const ui = {
    who: el("p", { cls: "rp-who" }),
    sidesLabel: el("span", { cls: "rp-sides-label", attrs: { "aria-hidden": "true" } }),
    sideKeys: el("span", { cls: "rp-side-keys" }),
    game: el("p", { cls: "rp-game" }),
    teams: el("p", { cls: "rp-teams" }),
    statusText: el("span", { cls: "rp-status-text" }),
    news: el("p", { cls: ["rp-news", "sr-only"], attrs: { role: "status", "aria-live": "polite" } }),
  };
  ui.sides = el("div", { cls: "rp-sides", attrs: { role: "group", hidden: "" }, data: { testid: "report-sides" } },
    [ui.sidesLabel, ui.sideKeys]);
  const lamp = el("span", { cls: ["sc-lamp", "rp-status-lamp"], attrs: { "aria-hidden": "true" } });
  ui.status = el("p", { cls: "rp-status" }, [lamp, ui.statusText]);
  ui.box = el("div", { cls: "rp-head" },
    [el("div", { cls: "rp-id" }, [ui.who, ui.sides, ui.game]), ui.teams, ui.status, ui.news]);
  return ui;
}

/**
 * @param {HTMLElement} root  the ribbon's live slot ([data-mount="head"])
 * @param {{ actions: { showSide?: (team: string) => void } }} [ctx]  showSide: the viewer picked a caller's sections
 * @returns {{ update(vm: ReturnType<import("../model/vm-head.js").headVm>): void, destroy(): void }}
 */
export function mount(root, ctx = {}) {
  const ui = skeleton();
  const pick = (team) => act(() => ctx.actions?.showSide?.(team));
  let logos = null;
  root.appendChild(ui.box);
  return {
    update(vm) {
      setText(ui.who, vm.who);
      renderSides(ui, vm.sides ?? { shown: false, label: "", group: "", keys: [] }, pick);
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
