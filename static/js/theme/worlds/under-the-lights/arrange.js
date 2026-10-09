// Under the Lights: where the stadium hangs each region (DESIGN.md Layout; ui-architecture.md 2.7, 9.4, v1.4; owner W3).
// arrange(app, regions) runs once at boot, before the components mount. It builds the stadium's fixtures (the upper
// LED ribbon, the control-room drawer and its racks, the video board, the desk, the lower ribbon, the scoreboard band
// and the stat board) and moves whole regions into them, never parts of one (the Whole Region Rule), in the order Tab
// walks the page: top to bottom, left to right. css/worlds/under-the-lights/layout.css places the fixtures; state
// (the drawer, manual entry, the stat board) moves regions by CSS alone, so the DOM order, and with it the tab order,
// never changes after boot.
//
// The HUD insets (surface brief, unresolved #1): layout.css publishes how far the HUD reaches into the bowl as the
// registered lengths --sc-field-safe-top|right|bottom|left (px), which both engines read on every resize.
// hudInsets / readHudInsets are the JS getter; the watcher dispatches INSET_EVENT on #app (detail: the insets)
// whenever they change without a resize (manual entry's strip, the drawer, the stat board), so the engine can re-read
// them at once: app.addEventListener(INSET_EVENT, () => engine.setSafeArea(null)).

import { mountBooth } from "./booth.js";

export const LAYOUT_ID = "uls";
export const INSET_EVENT = "sc:hud-insets";
export const SAFE_PROPS = Object.freeze({ top: "--sc-field-safe-top", right: "--sc-field-safe-right",
  bottom: "--sc-field-safe-bottom", left: "--sc-field-safe-left" });

/** App attributes that move the HUD without resizing the window (#app hooks the conductor writes, 2.7). */
const WATCHED_ATTRS = Object.freeze(["data-mode", "data-booth-open", "data-scorecard-open"]);
const PX = /^\s*(\d+(?:\.\d+)?)px\s*$/;
const ZERO = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });
/** One insets watcher per #app, however often arrange runs. */
const WATCHERS = new WeakMap();

const rack = (key, plate, regions) => Object.freeze({ key, plate, regions: Object.freeze(regions) });
const fixture = (key, regions, extra = {}) => Object.freeze({ key, cls: `uls-${key}`, regions: Object.freeze(regions),
  ...extra });

/**
 * The fixtures in document order. `regions` hang inside the fixture; a fixture with `racks` (the drawer) holds them
 * in racks under painted plates; `bare` hangs the region itself with no fixture around it (the bowl is the page).
 * Plate words are world signage (DESIGN.md: FEED, SITUATION, FLAGS, SETTINGS; set in caps by CSS).
 */
export const PLAN = Object.freeze([
  // The ribbon reads left to right: the masthead's nameplate, the newest play, the masthead's keys, the feed lamp.
  // The play feed comes first in the DOM so Tab meets the plays, then the keys, then the feed, in that visual order
  // (layout.css lays the masthead's plate and keys out around it with display: contents).
  fixture("ribbon", ["plays", "masthead"]),
  fixture("drawer", [], { racks: Object.freeze([
    rack("feed", "Feed", ["feed"]),
    rack("situation", "Situation", ["situation"]),
    rack("flags", "Flags", ["flags"]),
    rack("settings", "Settings", []),
  ]) }),
  fixture("field", ["field"], { bare: true }),
  fixture("board", ["call"]),
  fixture("desk", ["transport", "entry"]),
  fixture("lower", ["drives", "wp"]),
  fixture("band", ["scoreboard"]),
  fixture("statboard", ["score", "tendencies", "box", "log"]),
]);

/** Region names in the order the plan hangs them, which is the order Tab walks them. */
export function regionOrder(plan = PLAN) {
  return plan.flatMap((f) => (f.racks ? f.racks.flatMap((r) => r.regions) : f.regions));
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

function buildRack(doc, drawer, spec) {
  const found = [...drawer.children].find((n) => n.getAttribute("data-rack") === spec.key);
  if (found) return found;
  const plateId = `uls-plate-${spec.key}`;
  const node = make(doc, "div", { class: "uls-rack", "data-rack": spec.key, role: "group", "aria-labelledby": plateId });
  const plate = make(doc, "p", { class: "uls-plate", id: plateId });
  plate.appendChild(doc.createTextNode(spec.plate));
  node.appendChild(plate);
  if (!spec.regions.length) node.appendChild(make(doc, "div", { class: "uls-rack-body" }));
  drawer.appendChild(node);
  return node;
}

function hang(app, spec, regions) {
  const doc = app.ownerDocument;
  if (spec.bare) {
    for (const name of spec.regions) if (regions[name]) app.appendChild(regions[name]);
    return;
  }
  const node = ownChild(app, spec.cls) ?? make(doc, "div", { class: spec.cls, "data-fixture": spec.key });
  app.appendChild(node);
  for (const r of spec.racks ?? []) {
    const holder = buildRack(doc, node, r);
    for (const name of r.regions) if (regions[name]) holder.appendChild(regions[name]);
  }
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
  if (!WATCHERS.has(app)) {
    const watcher = watchInsets(app);
    if (watcher) WATCHERS.set(app, watcher);
  }
  mountBooth(app);   // W4: the SETTINGS rack's switches, room lights, X opens the drawer to FLAGS (booth.js)
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
 * Watch #app for HUD moves that do not resize the window and dispatch INSET_EVENT (detail: the insets) on #app when
 * the insets change. Returns { current(), stop() }, or null when the page has no window (node).
 */
export function watchInsets(app) {
  const doc = app?.ownerDocument;
  const view = doc?.defaultView;
  if (!view || typeof view.MutationObserver !== "function") return null;
  let last = readHudInsets(doc);
  const check = () => {
    const next = readHudInsets(doc);
    if (Object.keys(SAFE_PROPS).every((side) => next[side] === last[side])) return;
    last = next;
    app.dispatchEvent(new view.CustomEvent(INSET_EVENT, { detail: next, bubbles: true }));
  };
  const observer = new view.MutationObserver(check);
  observer.observe(app, { attributes: true, attributeFilter: [...WATCHED_ATTRS] });
  view.addEventListener("resize", check);
  return {
    current: () => last,
    stop() {
      observer.disconnect();
      view.removeEventListener("resize", check);
    },
  };
}
