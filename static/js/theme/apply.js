// Applying a world to the page (ui-architecture.md 2.7; owner A10). DOM side.
// applyWorld swaps the world stylesheets without a flash: the new links load next to the old ones, then
// <html data-world> flips and the old links go. applyRootAttrs writes the other <html> hooks (data-motion,
// data-ambient, data-scene). applyTeams and applyPossession set the runtime --sc-team-* tokens from the game's teams
// through teamPaint (DC C2), so worlds paint with team colors that stay legible. Timers are called bare.
import { teamPaint } from "./team-colors.js";
import { REQUIRED_TOKENS, missingTokens } from "./tokens.js";

const ROOT_VALUES = Object.freeze({ motion: ["full", "reduced"], ambient: ["room", "dark"], scene: ["webgl", "2d"] });
const WORLD_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ABBR = /^[A-Z]{2,4}$/;
const FONT_TYPES = Object.freeze({ woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf" });
const DEFAULT_CSS_TIMEOUT_MS = 4000;
/** Per document: the teams' paints and the current possession, so possession can change without the teams. */
const TEAM_STATE = new WeakMap();

const setTimer = (fn, ms) => globalThis.setTimeout(fn, ms);
const clearTimer = (id) => globalThis.clearTimeout(id);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Write data-motion, data-ambient and data-scene on <html> (known values only; unchanged values are skipped). */
export function applyRootAttrs(doc, attrs = {}) {
  const html = doc.documentElement;
  for (const [key, allowed] of Object.entries(ROOT_VALUES)) {
    const value = attrs?.[key];
    if (!allowed.includes(value)) continue;
    if (html.getAttribute(`data-${key}`) !== value) html.setAttribute(`data-${key}`, value);
  }
}

// ---------------------------------------------------------------- world stylesheets and fonts
function checkedPaths(world) {
  const id = world?.id;
  if (typeof id !== "string" || !WORLD_ID.test(id)) throw new TypeError(`bad world id ${JSON.stringify(id)}`);
  const inside = (root, ext) => (p) => typeof p === "string" && p.startsWith(root) && !p.includes("..")
    && !p.slice(1).includes("//") && ext.test(p);
  const cssOk = inside(`/static/css/worlds/${id}/`, /\.css$/);
  const fontOk = inside(`/static/fonts/${id}/`, /\.(woff2|woff|ttf|otf)$/);
  const css = [...(world.css ?? [])];
  const fonts = [...(world.fonts ?? [])];
  const bad = [...css.filter((p) => !cssOk(p)), ...fonts.filter((p) => !fontOk(p))];
  if (bad.length) throw new TypeError(`world file outside its folder: ${bad.join(", ")}`);
  return { id, css, fonts };
}

function settle(link, timeoutMs) {
  return new Promise((resolve) => {
    let timer = null;
    const finish = (ok) => {
      if (timer !== null) clearTimer(timer);
      timer = null;
      link.removeEventListener("load", onLoad);
      link.removeEventListener("error", onError);
      resolve(ok);
    };
    const onLoad = () => finish(true);
    const onError = () => finish(false);
    link.addEventListener("load", onLoad);
    link.addEventListener("error", onError);
    timer = setTimer(() => finish(false), timeoutMs);
  });
}

function makeLink(doc, attrs) {
  const link = doc.createElement("link");
  for (const [name, value] of Object.entries(attrs)) link.setAttribute(name, value);
  return link;
}

function preloadFonts(doc, id, fonts) {
  for (const old of [...doc.querySelectorAll("[data-world-font]")]) old.remove();
  for (const href of fonts) {
    const type = FONT_TYPES[href.split(".").pop()];
    doc.head.appendChild(makeLink(doc, { rel: "preload", as: "font", type, href, crossorigin: "", "data-world-font": id }));
  }
}

function isApplied(doc, id, css) {
  const current = [...doc.querySelectorAll("[data-world-css]")];
  return doc.documentElement.getAttribute("data-world") === id && current.length === css.length
    && current.every((l, i) => l.getAttribute("href") === css[i]);
}

/** The world is already on: wait for any of its sheets still loading (link.sheet is null until then). */
async function settleCurrent(doc, css, timeoutMs) {
  const links = [...doc.querySelectorAll("[data-world-css]")];
  const results = await Promise.all(links.map((link) => (link.sheet === null ? settle(link, timeoutMs) : true)));
  return { loaded: css.filter((_, i) => results[i]), failed: css.filter((_, i) => !results[i]) };
}

/**
 * Load a world's stylesheets next to the current ones, then flip <html data-world> and drop the old links.
 * Resolves { loaded, failed } (hrefs); a stylesheet that errors or takes longer than timeoutMs counts as failed and
 * the world applies anyway (main.js reports it). Rejects when a path is outside the world's own folders.
 */
export async function applyWorld(world, doc, { timeoutMs = DEFAULT_CSS_TIMEOUT_MS } = {}) {
  const { id, css, fonts } = checkedPaths(world);
  if (isApplied(doc, id, css)) return settleCurrent(doc, css, timeoutMs);
  const old = [...doc.querySelectorAll("[data-world-css]")];
  const anchor = old.length ? old[old.length - 1].nextSibling : null;
  const links = css.map((href) => makeLink(doc, { rel: "stylesheet", href, "data-world-css": id }));
  for (const link of links) doc.head.insertBefore(link, anchor);
  preloadFonts(doc, id, fonts);
  const results = await Promise.all(links.map((link) => settle(link, timeoutMs)));
  for (const link of old) link.remove();
  if (links.length) links[0].setAttribute("id", "world-css");
  doc.documentElement.setAttribute("data-world", id);
  return { loaded: css.filter((_, i) => results[i]), failed: css.filter((_, i) => !results[i]) };
}

/** Required tokens the page cannot resolve right now (an empty list means the world defines them all). */
export function missingWorldTokens(doc) {
  const view = doc.defaultView;
  if (!view || typeof view.getComputedStyle !== "function") return [...REQUIRED_TOKENS];
  const style = view.getComputedStyle(doc.documentElement);
  return missingTokens((name) => style.getPropertyValue(name));
}

// ---------------------------------------------------------------- runtime team tokens
function setTokens(doc, values) {
  const { style } = doc.documentElement;
  for (const [name, value] of Object.entries(values)) {
    if (style.getPropertyValue(name) !== value) style.setProperty(name, value);
  }
}

function teamOrder(teams) {
  const list = isObj(teams) ? Object.values(teams).filter(isObj) : [];
  const caller = list.find((t) => t.caller === true) ?? null;
  const opp = list.find((t) => t !== caller) ?? null;
  const abbr = (t) => (typeof t?.abbr === "string" && ABBR.test(t.abbr) ? t.abbr : null);
  return { caller, opp, callerAbbr: abbr(caller), oppAbbr: abbr(opp) };
}

/**
 * Set --sc-team-caller(-alt, -ink) and --sc-team-opp(-alt, -ink) from DC C2 teams, legible against the look's
 * teamColor backgrounds; then the offense and defense tokens for the current possession. Returns the paints.
 */
export function applyTeams(teams, doc, look) {
  const rule = look?.teamColor ?? {};
  const order = teamOrder(teams);
  const caller = teamPaint(order.caller, rule.against ?? [], rule.minContrast);
  const opp = teamPaint(order.opp, rule.against ?? [], rule.minContrast);
  const poss = TEAM_STATE.get(doc)?.poss ?? null;
  TEAM_STATE.set(doc, { caller, opp, callerAbbr: order.callerAbbr, oppAbbr: order.oppAbbr, poss });
  setTokens(doc, {
    "--sc-team-caller": caller.fill, "--sc-team-caller-alt": caller.alt, "--sc-team-caller-ink": caller.ink,
    "--sc-team-opp": opp.fill, "--sc-team-opp-alt": opp.alt, "--sc-team-opp-ink": opp.ink,
  });
  applyPossession(poss, doc);
  return Object.freeze({ caller, opp });
}

/** --sc-team-off(-ink) and --sc-team-def follow the ball; with no possession the caller is the offense. */
export function applyPossession(poss, doc) {
  const state = TEAM_STATE.get(doc) ?? { caller: teamPaint(null), opp: teamPaint(null), oppAbbr: null };
  const oppHasBall = typeof poss === "string" && poss !== "" && poss === state.oppAbbr;
  const off = oppHasBall ? state.opp : state.caller;
  const def = oppHasBall ? state.caller : state.opp;
  TEAM_STATE.set(doc, { ...state, poss: typeof poss === "string" && poss !== "" ? poss : null });
  setTokens(doc, { "--sc-team-off": off.fill, "--sc-team-off-ink": off.ink, "--sc-team-def": def.fill });
}

/** Call onChange("reduced" | "full") whenever prefers-reduced-motion changes; returns the unsubscribe. */
export function watchMotion(matchMedia, onChange) {
  if (typeof matchMedia !== "function") return () => {};
  const mq = matchMedia("(prefers-reduced-motion: reduce)");
  const handler = () => onChange(mq.matches ? "reduced" : "full");
  if (typeof mq?.addEventListener === "function") {
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }
  if (typeof mq?.addListener === "function") {
    mq.addListener(handler);
    return () => mq.removeListener(handler);
  }
  return () => {};
}
