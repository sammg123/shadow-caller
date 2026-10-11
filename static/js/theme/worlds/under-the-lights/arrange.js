// Under the Lights: where the stadium hangs each region (DESIGN.md Layout; restructure-v2.md 1 and 2; ui-architecture.md
// 2.7, 9.4; owner: home frame). arrange(app, regions) runs once at boot, before the components mount. It builds the
// stadium's fixtures (the two-row top bar, its settings menu, the video board, the lower ribbon and the
// scoreboard band) and moves whole regions into them, never parts of one (the Whole Region Rule), in the order Tab
// walks the page: top to bottom, left to right. css/worlds/under-the-lights/layout.css places the fixtures; the
// settings menu opens by CSS alone (#app[data-settings-open]), so the DOM order, and with it the tab order, never
// changes after boot.
//
// The HUD insets (surface brief, unresolved #1): layout.css publishes how far the HUD reaches into the bowl as the
// registered lengths --sc-field-safe-top|right|bottom|left (px), which both engines read on every resize.
// hudInsets / readHudInsets are the JS getter; the watcher dispatches INSET_EVENT on #app (detail: the insets)
// whenever they change, so the engine can re-read them at once: app.addEventListener(INSET_EVENT, () =>
// engine.setSafeArea(null)).
//
// G5-2: the HUD fits the window's height. The stadium's fixtures are measured for 1440x900 and 1920x1080 (and the
// widths between, where the reference height is 0.375 x width + 360); a shorter window (a laptop's browser with its
// toolbars, 1440x790) would squeeze the video board. hudScale is the window's height over the reference height
// (at most 1, at least HUD_SCALE_MIN); arrange sets it on <html> as --uls-hud-scale, and the watcher updates it on
// every resize, before it reads the insets. tokens.css multiplies the HUD's sizes by it, so every fixture keeps its
// proportions, and 1440x900 and 1920x1080 stay exact.

import { mountBooth } from "./booth.js";

export const LAYOUT_ID = "uls";
export const INSET_EVENT = "sc:hud-insets";
export const SAFE_PROPS = Object.freeze({ top: "--sc-field-safe-top", right: "--sc-field-safe-right",
  bottom: "--sc-field-safe-bottom", left: "--sc-field-safe-left" });

export const HUD_SCALE_PROP = "--uls-hud-scale";
/** The reference height for a width (px): 900 at 1440, 1080 at 1920 (DESIGN.md's two first viewports), held
 * outside them as the tokens' clamps hold their sizes (narrower windows keep the laptop's, wider ones the TV's). */
const HUD_REF = Object.freeze({ perWidth: 0.375, base: 360, fromWidth: 1440, toWidth: 1920 });
export const HUD_SCALE_MIN = 0.6;
/** layout.css's stadium block: narrower or shorter windows are one scrolling column, never scaled. */
const STADIUM_MIN = Object.freeze({ width: 1200, height: 640 });
const SCALE_DP = 4;

const PX = /^\s*(\d+(?:\.\d+)?)px\s*$/;
const ZERO = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });
/** One insets watcher per #app, however often arrange runs. */
const WATCHERS = new WeakMap();

const fixture = (key, regions, extra = {}) => Object.freeze({ key, cls: `uls-${key}`, regions: Object.freeze(regions),
  ...extra });

/** The settings menu's id: the top bar's Settings key controls it (main.js finds it by [data-settings-menu]). */
export const SETTINGS_ID = "sc-settings";

/**
 * The fixtures in document order. `regions` hang inside the fixture; `bare` hangs the region itself with no fixture
 * around it (the bowl is the page). The settings menu holds no region: booth.js fills it.
 */
export const PLAN = Object.freeze([
  // restructure-v2.md 1 and 2: the top bar, two rows. The upper LED ribbon: the nameplate and current game, the newest
  // play (the top LED ticker) and the view keys; under it the playback row. The masthead region holds the nameplate,
  // the view keys and the playback, in that order; layout.css places them around the play feed.
  fixture("ribbon", ["masthead", "plays"]),
  // the small menu the top bar's Settings key opens (booth.js fills it), right after the bar
  fixture("settings", [], { attrs: Object.freeze({ id: SETTINGS_ID, "data-settings-menu": "", role: "group",
    "aria-label": "Settings" }) }),
  fixture("field", ["field"], { bare: true }),
  fixture("board", ["call"], { attrs: Object.freeze({ role: "region", "aria-label": "Next call" }) }),   // G5-9
  fixture("lower", ["drives", "wp"]),
  fixture("band", ["scoreboard"], { attrs: Object.freeze({ role: "region", "aria-label": "Scoreboard" }) }),
]);

/** Region names in the order the plan hangs them, which is the order Tab walks them. */
export function regionOrder(plan = PLAN) {
  return plan.flatMap((f) => f.regions);
}

// ---------------------------------------------------------------- building the fixtures
function ownChild(parent, cls) {
  return [...parent.children].find((node) => (node.getAttribute("class") ?? "").split(/\s+/).includes(cls)) ?? null;
}

function make(doc, tag, attrs) {
  const node = doc.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

function hang(app, spec, regions) {
  const doc = app.ownerDocument;
  if (spec.bare) {
    for (const name of spec.regions) if (regions[name]) app.appendChild(regions[name]);
    return;
  }
  const node = ownChild(app, spec.cls) ?? make(doc, "div", { class: spec.cls, "data-fixture": spec.key });
  for (const [name, value] of Object.entries(spec.attrs ?? {})) node.setAttribute(name, value);
  app.appendChild(node);
  for (const name of spec.regions) if (regions[name]) node.appendChild(regions[name]);
}

/**
 * Hang every region in its fixture (idempotent: fixtures are found again by class, regions re-appended in order).
 * Never removes or renames a region or an id; keeps the tab order logical (regionOrder). Starts the insets watcher
 * when the page has a window.
 * @param {HTMLElement} app  #app
 * @param {Record<string, HTMLElement>} regions  RegionName -> its section (theme/registry.js REGION_NAMES)
 */
export function arrange(app, regions) {
  for (const spec of PLAN) hang(app, spec, regions ?? {});
  app.setAttribute("data-layout", LAYOUT_ID);
  app.setAttribute("role", "main");   // G5-9: the page's main landmark, without moving a fixture
  // ...so the masthead's <header>, inside it, is no banner of its own (a banner never sits inside main)
  regions?.masthead?.setAttribute?.("role", "none");
  applyHudScale(app.ownerDocument);
  if (!WATCHERS.has(app)) {
    const watcher = watchInsets(app);
    if (watcher) WATCHERS.set(app, watcher);
  }
  mountBooth(app);   // the settings menu's two switches, light dip and room lights (booth.js)
}

// ---------------------------------------------------------------- the HUD's scale (G5-2)
/**
 * How much the stadium's HUD shrinks to fit a window `width` x `height` (CSS px): 1 at the reference height or taller,
 * else height over the reference height, never under HUD_SCALE_MIN. The one-column layout (narrow or short windows)
 * scrolls instead: 1. Pure.
 * @param {number} width
 * @param {number} height
 * @returns {number}
 */
export function hudScale(width, height) {
  if (!(width >= STADIUM_MIN.width && height >= STADIUM_MIN.height)) return 1;
  const sized = Math.min(HUD_REF.toWidth, Math.max(HUD_REF.fromWidth, width));
  const ratio = height / (HUD_REF.perWidth * sized + HUD_REF.base);
  return Number(Math.min(1, Math.max(HUD_SCALE_MIN, ratio)).toFixed(SCALE_DP));
}

/** Set --uls-hud-scale on <html> for the page's window; returns the scale (1, and nothing set, without a window). */
export function applyHudScale(doc) {
  const view = doc?.defaultView;
  const root = doc?.documentElement;
  if (!view || !root?.style) return 1;
  const scale = hudScale(view.innerWidth, view.innerHeight);
  const value = String(scale);
  if (root.style.getPropertyValue(HUD_SCALE_PROP) !== value) root.style.setProperty(HUD_SCALE_PROP, value);
  return scale;
}

// ---------------------------------------------------------------- the HUD insets
/**
 * The HUD insets in px from a style reader: `read(name)` returns a property's computed value ("44px"). Registered
 * lengths compute to pixels; anything else, a negative length or a reader that throws reads as 0.
 * @param {(name: string) => string} read
 * @returns {{ top: number, right: number, bottom: number, left: number }}
 */
export function hudInsets(read) {
  const px = (name) => {
    try {
      const m = PX.exec(String(read(name) ?? ""));
      return m ? Number(m[1]) : 0;
    } catch {
      return 0;
    }
  };
  return Object.freeze(Object.fromEntries(Object.entries(SAFE_PROPS).map(([side, name]) => [side, px(name)])));
}

/** The page's current HUD insets, read from #field (the engine's host) or #app; zeros without a window. */
export function readHudInsets(doc) {
  const view = doc?.defaultView;
  const host = doc?.getElementById?.("field") ?? doc?.getElementById?.("app") ?? null;
  if (!host || typeof view?.getComputedStyle !== "function") return ZERO;
  try {
    const style = view.getComputedStyle(host);
    return hudInsets((name) => style.getPropertyValue(name));
  } catch {
    return ZERO;
  }
}

/**
 * Watch the window: on every resize the HUD's scale follows it (G5-2), and INSET_EVENT (detail: the insets) is
 * dispatched on #app when the insets changed. Nothing on #app moves the HUD any more (no drawer, strip or stat board),
 * so a resize is the only cause. Returns { current(), stop() }, or null when the page has no window (node).
 */
export function watchInsets(app) {
  const doc = app?.ownerDocument;
  const view = doc?.defaultView;
  if (!view || typeof view.addEventListener !== "function" || typeof view.CustomEvent !== "function") return null;
  let last = readHudInsets(doc);
  const onResize = () => {
    applyHudScale(doc);                // G5-2: the insets follow the HUD's new scale
    const next = readHudInsets(doc);
    if (Object.keys(SAFE_PROPS).every((side) => next[side] === last[side])) return;
    last = next;
    app.dispatchEvent(new view.CustomEvent(INSET_EVENT, { detail: next, bubbles: true }));
  };
  view.addEventListener("resize", onResize);
  return {
    current: () => last,
    stop() {
      view.removeEventListener("resize", onResize);
    },
  };
}
