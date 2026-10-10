// Scoreboard (ui-architecture.md 2.6, 5.4; owner A8). Renders scoreboardVm: both teams in ESPN order (away, then
// home) with logo, name, score, possession lamp and timeouts, then the quarter, the clock (flagged when estimated),
// down and distance, and ball on. Text only (G27). Numbers that tick in place sit in digit windows whose unlit
// ghost (data-ghost) a world may light behind them (DESIGN.md, the Ticking Number Rule); the neutral world doesn't.
// Logos: the app's own proxy only (the VM validates it); a world asks for ESPN's dark-background variant by setting
// --sc-logo-variant: dark; a logo that fails to load gives way to the team's monogram. v1.5 (G4-11): the variant is
// read (a forced style recalc) once per <html> data-world and data-ambient, the two things that set it, not on every
// update, which landed in the play-start frame.
import { el, reconcile, setAttr, setData, setHidden, setText } from "./dom.js";

const TIMEOUTS_PER_HALF = 3;
const LOGO_PX = 48;
const GHOST = Object.freeze({ score: "88", qtr: "Q8", clock: "88:88" });
const VARIANT_PROP = "--sc-logo-variant";

/** Parts of each team row, keyed by its node (rows are created once and kept by reconcile). */
const TEAM_PARTS = new WeakMap();

/** A digit window: the value over an unlit ghost a world may show (the ghost holds the cell's width). */
function digits(cls, ghost, data = {}) {
  const value = el("span", { cls: ["sc-digits-value", "sc-sb-value"] });
  return { node: el("span", { cls: ["sc-digits", "sc-num", cls], data: { ghost, ...data } }, [value]), value };
}

/** The variant last read per <html> element, with the world and room-lights setting it was read under. */
const VARIANT_MEMO = new WeakMap();

/** "dark" when the world asks for ESPN's dark-background logos (a CSS custom property on the region). */
function readVariant(node) {
  try {
    const view = node.ownerDocument?.defaultView;
    const value = view?.getComputedStyle?.(node)?.getPropertyValue(VARIANT_PROP);
    return typeof value === "string" && value.trim() === "dark" ? "dark" : "default";
  } catch {
    return "default";
  }
}

/** readVariant, memoized on what decides it: the world (<html data-world>) and the room lights (data-ambient). */
function logoVariant(node) {
  const html = node.ownerDocument?.documentElement;
  if (!html) return readVariant(node);
  const key = `${html.getAttribute("data-world") ?? ""}|${html.getAttribute("data-ambient") ?? ""}`;
  const memo = VARIANT_MEMO.get(html);
  if (memo && memo.key === key) return memo.variant;
  const variant = readVariant(node);
  VARIANT_MEMO.set(html, { key, variant });
  return variant;
}

function markLogoFailed(li) {
  const parts = TEAM_PARTS.get(li);
  if (!parts) return;
  TEAM_PARTS.set(li, { ...parts, failed: parts.img.getAttribute("src") });
  setHidden(parts.img, true);
  setData(li, "logo", "failed");
}

function createTeam(copy) {
  const img = el("img", { cls: "sc-sb-logo-img", attrs: { alt: "", width: LOGO_PX, height: LOGO_PX, decoding: "async" },
    data: { testid: "team-logo" } });
  const mono = el("span", { cls: "sc-sb-mono", attrs: { "aria-hidden": "true" } });
  const name = el("span", { cls: "sc-sb-name" });
  const abbr = el("span", { cls: "sc-sb-abbr", attrs: { "aria-hidden": "true" } });
  const score = digits("sc-sb-score", GHOST.score, { testid: "team-score" });
  const possText = el("span", { cls: "sr-only" });
  const poss = el("span", { cls: "sc-sb-poss" }, [possText]);
  const lamps = Array.from({ length: TIMEOUTS_PER_HALF }, () => el("span", { cls: "sc-sb-to" }));
  const tos = el("span", { cls: "sc-sb-tos", attrs: { role: "img" } }, lamps);
  const li = el("li", { cls: "sc-sb-team" }, [
    el("span", { cls: "sc-sb-logo" }, [img, mono]),
    el("span", { cls: "sc-sb-who" }, [name, abbr]),
    score.node, poss, tos,
  ]);
  img.addEventListener("error", () => markLogoFailed(li));
  TEAM_PARTS.set(li, { img, mono, name, abbr, score, poss, possText, tos, lamps, failed: null });
  return li;
}

function updateLogo(li, parts, team, variant, copy) {
  const src = (variant === "dark" && team.logoDark) || team.logo || null;
  const usable = Boolean(src) && src !== parts.failed;
  setHidden(parts.img, !usable);
  setAttr(parts.img, "src", usable ? src : null);
  setAttr(parts.img, "alt", copy.logoAlt(team.name));
  setText(parts.mono, team.abbr);
  setData(li, "logo", usable ? "shown" : src ? "failed" : "none");
}

function updateTimeouts(parts, timeouts, copy) {
  const known = Number.isInteger(timeouts);
  setHidden(parts.tos, !known);
  setAttr(parts.tos, "aria-label", known ? copy.timeoutsLeft(timeouts) : null);
  parts.lamps.forEach((lamp, i) => setData(lamp, "on", known && i < timeouts));
}

function updateTeam(li, team, variant, copy) {
  const parts = TEAM_PARTS.get(li);
  setData(li, "team", team.abbr);
  setData(li, "caller", team.caller);
  setData(li, "home", team.home);
  setData(li, "side", team.side);
  setData(li, "poss", team.poss);
  updateLogo(li, parts, team, variant, copy);
  setText(parts.name, team.name);
  setText(parts.abbr, team.abbr);
  setText(parts.score.value, team.score);
  setData(parts.score.node, "team", team.abbr);
  setData(parts.poss, "on", team.poss);
  setAttr(parts.poss, "title", team.poss ? copy.hasBall : null);
  setText(parts.possText, team.poss ? copy.hasBall : "");
  updateTimeouts(parts, team.timeouts, copy);
}

function plainValue() {
  const value = el("span", { cls: "sc-sb-value" });
  return { node: value, value };
}

/** One captioned fact (Qtr, Time, Down, Ball on); a ghost makes it a digit window. */
function fact(key, caption, ghost, data) {
  const cap = el("span", { cls: "sc-sb-cap", text: caption });
  const val = ghost ? digits("sc-sb-num", ghost, data) : plainValue();
  return { node: el("div", { cls: "sc-sb-fact", data: { fact: key } }, [cap, val.node]), value: val.value };
}

function skeleton(ctx) {
  const copy = ctx.copy.SCOREBOARD;
  const qtr = fact("qtr", copy.qtr, GHOST.qtr);
  const clock = fact("clock", copy.time, GHOST.clock, { testid: "game-clock" });
  const down = fact("down", copy.down, null);
  const ball = fact("ball", copy.ballOn, null);
  const est = el("span", { cls: "sc-sb-est", text: ctx.copy.STRIP.est, attrs: { title: ctx.copy.STRIP.estTitle } });
  const final = el("span", { cls: "sc-sb-final", text: copy.final });
  clock.node.appendChild(est);
  qtr.node.appendChild(final);
  const teams = el("ol", { cls: "sc-sb-teams" });
  const facts = el("div", { cls: "sc-sb-facts" }, [qtr.node, clock.node, down.node, ball.node]);
  const board = el("div", { cls: "sc-scoreboard", attrs: { role: "group", "aria-label": copy.aria },
    data: { testid: "scoreboard" } }, [teams, facts]);
  return { board, teams, qtr, clock, down, ball, est, final };
}

/**
 * @param {HTMLElement} root  #rg-scoreboard
 * @param {{ copy: object }} ctx
 * @returns {{ update(vm: object): void, destroy(): void }}
 */
export function mount(root, ctx) {
  const copy = ctx.copy.SCOREBOARD;
  const ui = skeleton(ctx);
  root.appendChild(ui.board);
  return {
    update(vm) {
      const variant = logoVariant(root);
      setData(ui.board, "state", vm.state);
      setData(ui.board, "poss", vm.poss ?? "");
      setData(ui.board, "source", vm.source);
      reconcile(ui.teams, vm.teams, { key: (t) => t.abbr, create: () => createTeam(copy),
        update: (node, t) => updateTeam(node, t, variant, copy) });
      setText(ui.qtr.value, vm.qtrText);
      setText(ui.clock.value, vm.clock);
      setHidden(ui.est, !vm.clockEst);
      setHidden(ui.final, vm.state !== "post");
      setText(ui.down.value, vm.downText);
      setText(ui.ball.value, vm.ballOn);
    },
    destroy() {
      ui.board.remove();
    },
  };
}
