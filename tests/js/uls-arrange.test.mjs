// theme/worlds/under-the-lights/arrange.js (owner W3; DESIGN.md Layout; ui-architecture.md 2.7, 9.4, v1.4).
// arrange() hangs the regions in the stadium's fixtures (ribbon, drawer, bowl, video board, desk, lower ribbon,
// scoreboard band, stat board), whole regions only, in the order Tab walks them; hudInsets() reads the HUD insets the
// camera keeps the play out from under, and the watcher announces when they change.
import assert from "node:assert/strict";
import test from "node:test";
import {
  HUD_SCALE_PROP, INSET_EVENT, LAYOUT_ID, PLAN, SAFE_PROPS, applyHudScale, arrange, hudInsets, hudScale, readHudInsets,
  regionOrder, watchInsets,
} from "../../static/js/theme/worlds/under-the-lights/arrange.js";
import { REGION_NAMES } from "../../static/js/theme/registry.js";
import { createDocument } from "./fake-dom.mjs";

/** The shell's #app with every region of index.html (5.2), in index.html's order. */
function shell() {
  const doc = createDocument();
  const app = doc.createElement("div");
  app.setAttribute("id", "app");
  doc.body.appendChild(app);
  const regions = {};
  for (const name of REGION_NAMES) {
    const node = doc.createElement(name === "masthead" ? "header" : "section");
    node.setAttribute("id", name === "entry" ? "entry" : `rg-${name}`);
    node.setAttribute("data-region", name);
    app.appendChild(node);
    regions[name] = node;
  }
  const field = doc.createElement("div");
  field.setAttribute("id", "field");
  regions.field.appendChild(field);
  return { doc, app, regions: Object.freeze(regions) };
}

/** Region names in document order under `root`. */
function regionsInOrder(root) {
  const out = [];
  const walk = (node) => {
    for (const child of node.children) {
      const name = child.getAttribute("data-region");
      if (name) out.push(name);
      walk(child);
    }
  };
  walk(root);
  return out;
}

const childClasses = (app) => [...app.children].map((n) => n.getAttribute("class") ?? n.getAttribute("id"));

test("the plan places every region exactly once", () => {
  const placed = regionOrder(PLAN);
  assert.deepEqual([...placed].sort(), [...REGION_NAMES].sort());
  assert.equal(new Set(placed).size, placed.length);
  assert.ok(Object.isFrozen(PLAN));
});

test("Tab walks the stadium top to bottom: ribbon, drawer, bowl, board, desk, lower ribbon, band, stat board", () => {
  assert.deepEqual(regionOrder(PLAN), ["plays", "masthead", "feed", "situation", "flags", "field", "call",
    "transport", "entry", "drives", "wp", "scoreboard", "score", "tendencies", "box", "log"]);
});

test("arrange wraps the regions in the fixtures, in plan order, and marks the layout", () => {
  const { app, regions } = shell();
  arrange(app, regions);
  assert.equal(app.getAttribute("data-layout"), LAYOUT_ID);
  assert.deepEqual(childClasses(app), ["uls-ribbon", "uls-drawer", "rg-field", "uls-board", "uls-desk", "uls-lower",
    "uls-band", "uls-statboard"]);
  assert.deepEqual(regionsInOrder(app), regionOrder(PLAN));
  for (const [name, node] of Object.entries(regions)) assert.ok(node.isConnected, `${name} stays on the page`);
});

test("regions keep their ids and attributes; nothing is renamed or removed", () => {
  const { doc, app, regions } = shell();
  const before = Object.fromEntries(Object.entries(regions).map(([k, n]) => [k, n.getAttribute("id")]));
  arrange(app, regions);
  for (const [name, id] of Object.entries(before)) {
    assert.equal(doc.getElementById(id), regions[name], `#${id}`);
    assert.equal(regions[name].getAttribute("data-region"), name);
  }
  assert.ok(doc.getElementById("field").isConnected);
});

test("the drawer holds the feed, situation, flags and settings racks under painted plates", () => {
  const { app, regions } = shell();
  arrange(app, regions);
  const drawer = app.querySelector(".uls-drawer");
  const racks = [...drawer.children];
  assert.deepEqual(racks.map((r) => r.getAttribute("data-rack")), ["feed", "situation", "flags", "settings"]);
  for (const rack of racks) {
    const plate = rack.querySelector(".uls-plate");
    assert.ok(plate, `${rack.getAttribute("data-rack")} has a plate`);
    assert.equal(rack.getAttribute("role"), "group");
    assert.equal(rack.getAttribute("aria-labelledby"), plate.getAttribute("id"));
    assert.ok(plate.textContent.length > 2);
  }
  assert.equal(drawer.querySelector('[data-rack="feed"]').contains(regions.feed), true);
  assert.equal(drawer.querySelector('[data-rack="flags"]').contains(regions.flags), true);
  const settings = drawer.querySelector('[data-rack="settings"]');
  assert.ok(settings.querySelector(".uls-rack-body"), "an empty body the booth can fill");
});

test("arrange is idempotent: a second call reuses the fixtures and moves nothing twice", () => {
  const { app, regions } = shell();
  arrange(app, regions);
  const first = childClasses(app);
  arrange(app, regions);
  assert.deepEqual(childClasses(app), first);
  assert.equal(app.querySelectorAll(".uls-ribbon").length, 1);
  assert.equal(app.querySelectorAll(".uls-plate").length, 4);
  assert.deepEqual(regionsInOrder(app), regionOrder(PLAN));
});

test("a missing region is skipped; the rest still hang in order", () => {
  const { app, regions } = shell();
  const { plays, flags, ...rest } = regions;
  plays.remove();
  flags.remove();
  arrange(app, rest);
  assert.deepEqual(regionsInOrder(app), regionOrder(PLAN).filter((n) => n !== "plays" && n !== "flags"));
});

test("arrange runs without a window (node, the fake DOM): no watcher, no throw", () => {
  const { app, regions } = shell();
  assert.doesNotThrow(() => arrange(app, regions));
});

test("hudInsets reads the four --sc-field-safe-* lengths as pixels, anything else as 0", () => {
  assert.deepEqual(SAFE_PROPS, { top: "--sc-field-safe-top", right: "--sc-field-safe-right",
    bottom: "--sc-field-safe-bottom", left: "--sc-field-safe-left" });
  const values = { "--sc-field-safe-top": " 44px", "--sc-field-safe-right": "456px",
    "--sc-field-safe-bottom": "184.5px", "--sc-field-safe-left": "calc(1px + 2px)" };
  assert.deepEqual(hudInsets((name) => values[name]), { top: 44, right: 456, bottom: 184.5, left: 0 });
  assert.deepEqual(hudInsets(() => ""), { top: 0, right: 0, bottom: 0, left: 0 });
  assert.deepEqual(hudInsets(() => "-12px"), { top: 0, right: 0, bottom: 0, left: 0 }, "never negative");
  assert.deepEqual(hudInsets(() => { throw new Error("no style"); }), { top: 0, right: 0, bottom: 0, left: 0 });
  assert.ok(Object.isFrozen(hudInsets(() => "1px")));
});

test("readHudInsets reads the computed style of #field (or #app) through the page's window", () => {
  const { doc, app, regions } = shell();
  arrange(app, regions);
  const asked = [];
  doc.defaultView = { getComputedStyle: (node) => {
    asked.push(node.getAttribute("id"));
    return { getPropertyValue: (name) => (name === "--sc-field-safe-right" ? "624px" : "56px") };
  } };
  assert.deepEqual(readHudInsets(doc), { top: 56, right: 624, bottom: 56, left: 56 });
  assert.deepEqual(asked, ["field"]);
  assert.deepEqual(readHudInsets(createDocument()), { top: 0, right: 0, bottom: 0, left: 0 }, "no window: zeros");
});

/** A window for the watcher: MutationObserver, resize listeners, CustomEvent and a style the test can change. */
function fakeWindow(styleOf) {
  const observers = [];
  const listeners = new Map();
  return {
    observers,
    listeners,
    MutationObserver: class {
      constructor(fn) { this.fn = fn; observers.push(this); }
      observe(target, opts) { this.target = target; this.opts = opts; }
      disconnect() { this.off = true; }
    },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; this.bubbles = init?.bubbles; } },
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
    getComputedStyle: () => ({ getPropertyValue: (name) => styleOf()[name] ?? "" }),
  };
}

test("the watcher announces new insets once per change (mode, drawer, scorecard, resize) on #app", () => {
  const { doc, app, regions } = shell();
  let style = { "--sc-field-safe-top": "44px", "--sc-field-safe-right": "456px", "--sc-field-safe-bottom": "184px" };
  const win = fakeWindow(() => style);
  doc.defaultView = win;
  arrange(app, regions);
  const seen = [];
  app.addEventListener(INSET_EVENT, (e) => seen.push(e.detail));
  const mo = win.observers[0];
  assert.equal(mo.target, app);
  assert.deepEqual([...mo.opts.attributeFilter].sort(), ["data-booth-open", "data-mode", "data-scorecard-open"]);
  mo.fn([]);
  assert.deepEqual(seen, [], "unchanged insets say nothing");
  style = { ...style, "--sc-field-safe-top": "96px" };
  mo.fn([]);
  assert.deepEqual(seen, [{ top: 96, right: 456, bottom: 184, left: 0 }]);
  win.listeners.get("resize")();
  assert.equal(seen.length, 1, "a resize with the same insets says nothing");
  style = { ...style, "--sc-field-safe-right": "624px" };
  win.listeners.get("resize")();
  assert.equal(seen.length, 2);
  assert.equal(seen[1].right, 624);
});

test("watchInsets can be stopped, and a style that throws reads as zeros", () => {
  const { doc, app } = shell();
  const win = fakeWindow(() => { throw new Error("detached"); });
  doc.defaultView = win;
  const watcher = watchInsets(app);
  assert.deepEqual(watcher.current(), { top: 0, right: 0, bottom: 0, left: 0 });
  watcher.stop();
  assert.equal(win.observers[0].off, true);
  assert.equal(win.listeners.has("resize"), false);
  assert.equal(watchInsets(createDocument().body), null, "no window, no watcher");
});

test("G5-2: hudScale fits the stadium's height: exact at 1440x900 and 1920x1080, smaller in a shorter window", () => {
  assert.equal(HUD_SCALE_PROP, "--uls-hud-scale");
  assert.equal(hudScale(1440, 900), 1, "Sam's laptop, the reference");
  assert.equal(hudScale(1920, 1080), 1, "the TV, the reference");
  assert.equal(hudScale(2560, 1440), 1, "never grows past the reference");
  const near = (w, h, want, why = "") => assert.ok(Math.abs(hudScale(w, h) - want) < 0.001, `${w}x${h}: ${hudScale(w, h)} ${why}`);
  near(1440, 790, 790 / 900);          // a 1440x900 MacBook with the browser's chrome
  near(1470, 840, 840 / (0.375 * 1470 + 360));
  near(1920, 950, 950 / 1080);
  near(1366, 768, 768 / 900, "below 1440 the tokens keep the laptop's sizes, so the laptop's reference holds");
  near(1280, 720, 720 / 900);
  near(2560, 1200, 1200 / 1080 > 1 ? 1 : 1200 / 1080);
  assert.equal(hudScale(1920, 640), 0.6, "a floor, so nothing shrinks past reading");
  assert.equal(hudScale(1199, 900), 1, "the one-column layout scrolls: no scale");
  assert.equal(hudScale(1440, 639), 1);
  assert.equal(hudScale(undefined, 900), 1);
});

test("G5-2: arrange sets the scale on <html> and the watcher updates it on every resize, before the insets", () => {
  const { doc, app, regions } = shell();
  const order = [];
  const style = {};
  const win = fakeWindow(() => { order.push("insets"); return style; });
  win.innerWidth = 1440;
  win.innerHeight = 790;
  doc.defaultView = win;
  arrange(app, regions);
  const scale = () => Number(doc.documentElement.style.getPropertyValue(HUD_SCALE_PROP));
  assert.ok(Math.abs(scale() - 790 / 900) < 0.001, String(scale()));
  win.innerHeight = 900;
  order.length = 0;
  const setProperty = doc.documentElement.style.setProperty.bind(doc.documentElement.style);
  doc.documentElement.style.setProperty = (name, value) => { order.push("scale"); setProperty(name, value); };
  win.listeners.get("resize")();
  assert.equal(scale(), 1);
  assert.deepEqual(order.slice(0, 2), ["scale", "insets"], "the insets are read at the new scale");
  assert.equal(applyHudScale(createDocument()), 1, "no window: the reference scale, nothing set");
});

test("G5-9: the page has a main landmark (#app) and the board and the band are named regions; nothing moves", () => {
  const { app, regions } = shell();
  const before = regionOrder();
  arrange(app, regions);
  assert.equal(app.getAttribute("role"), "main");
  assert.equal(regions.masthead.getAttribute("role"), "none", "no banner inside main");
  const named = (cls) => { const n = app.querySelector(`.${cls}`); return [n.getAttribute("role"), n.getAttribute("aria-label")]; };
  assert.deepEqual(named("uls-board"), ["region", "Next call"]);
  assert.deepEqual(named("uls-band"), ["region", "Scoreboard"]);
  assert.deepEqual(regionsInOrder(app), before, "the tab order is the plan's");
});
