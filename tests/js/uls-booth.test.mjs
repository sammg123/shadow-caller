// theme/worlds/under-the-lights/booth.js (owner W4; DESIGN.md "Control-room drawer", "Keys, lamps and LED inputs";
// ui-architecture.md 8.2, v1.4). The booth fills the drawer's SETTINGS rack with the world's two lamp switches (light
// dip in live games, room lights), keeps them true to the page (<html data-ambient>, sc:uls:dip-live), hands a room
// lights change to the app (a cancelable sc:booth-ambient event on #app) or applies it itself, tells W1's moments
// whether to dip, and opens the drawer to the FLAGS rack when the flag panel appears (X).
import assert from "node:assert/strict";
import test from "node:test";
import {
  AMBIENT_EVENT, AMBIENT_KEY, BOOTH_COPY, DIP_KEY, dipFor, dipInLiveGames, mountBooth, setDipInLiveGames, shouldDipNow,
} from "../../static/js/theme/worlds/under-the-lights/booth.js";
import { arrange } from "../../static/js/theme/worlds/under-the-lights/arrange.js";
import { REGION_NAMES } from "../../static/js/theme/registry.js";
import { createDocument } from "./fake-dom.mjs";

/** The shell (index.html 5.2) with every region, #flagPanel inside the flags region, hung by W3's arrange. */
function stadium({ win = null } = {}) {
  const doc = createDocument();
  if (win) doc.defaultView = win;
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
  const flagPanel = doc.createElement("div");
  flagPanel.setAttribute("id", "flagPanel");
  flagPanel.setAttribute("hidden", "");
  regions.flags.appendChild(flagPanel);
  return { doc, app, regions: Object.freeze(regions), flagPanel };
}

/** Just the drawer the booth needs (a FLAGS rack holding #flagPanel, an empty SETTINGS body), without arrange. */
function drawer({ win = null } = {}) {
  const doc = createDocument();
  if (win) doc.defaultView = win;
  const app = doc.createElement("div");
  app.setAttribute("id", "app");
  doc.body.appendChild(app);
  const box = doc.createElement("div");
  box.setAttribute("class", "uls-drawer");
  app.appendChild(box);
  const rack = (key) => {
    const node = doc.createElement("div");
    node.setAttribute("class", "uls-rack");
    node.setAttribute("data-rack", key);
    box.appendChild(node);
    return node;
  };
  const flags = rack("flags");
  const region = doc.createElement("section");
  region.setAttribute("id", "rg-flags");
  flags.appendChild(region);
  const flagPanel = doc.createElement("div");
  flagPanel.setAttribute("id", "flagPanel");
  flagPanel.setAttribute("hidden", "");
  region.appendChild(flagPanel);
  const body = doc.createElement("div");
  body.setAttribute("class", "uls-rack-body");
  rack("settings").appendChild(body);
  return { doc, app, flagPanel, flags };
}

/** A Storage stand-in; `broken` throws on every call, like a private window or blocked site data. */
function memoryStorage(initial = {}, { broken = false } = {}) {
  const data = new Map(Object.entries(initial));
  const guard = () => {
    if (broken) throw new Error("SecurityError: storage is disabled");
  };
  return {
    data,
    getItem: (k) => { guard(); return data.has(k) ? data.get(k) : null; },
    setItem: (k, v) => { guard(); data.set(k, String(v)); },
  };
}

/** A window for the booth's observers: MutationObserver (recorded) and a cancelable CustomEvent. */
function fakeWindow() {
  const observers = [];
  return {
    observers,
    MutationObserver: class {
      constructor(fn) { this.fn = fn; observers.push(this); }
      observe(target, opts) { this.target = target; this.opts = opts; }
      disconnect() { this.off = true; }
    },
    CustomEvent: class {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
        this.bubbles = init.bubbles;
        this.cancelable = init.cancelable;
        this.defaultPrevented = false;
        // own property, so the fake DOM's event copy carries it to the listener
        this.preventDefault = () => { if (this.cancelable) this.defaultPrevented = true; };
      }
    },
  };
}

const settingsOf = (app) => app.querySelector('[data-rack="settings"]').querySelector(".uls-rack-body");
const observerOn = (win, target) => win.observers.find((o) => o.target === target);

test("dipFor: Watch this game always dips; live entry (feed, manual, flags) follows the setting", () => {
  assert.equal(dipFor("watch", false), true);
  assert.equal(dipFor("watch", true), true);
  for (const mode of ["normal", "flag", "feed"]) {
    assert.equal(dipFor(mode, true), true, mode);
    assert.equal(dipFor(mode, false), false, mode);
  }
  assert.equal(dipFor(undefined, false), false, "an unknown mode is a live game");
});

test("the dip setting is ON by default and stored per viewer as sc:uls:dip-live", () => {
  assert.equal(DIP_KEY, "sc:uls:dip-live");
  assert.equal(dipInLiveGames(memoryStorage()), true);
  assert.equal(dipInLiveGames(memoryStorage({ [DIP_KEY]: "off" })), false);
  assert.equal(dipInLiveGames(memoryStorage({ [DIP_KEY]: "on" })), true);
  assert.equal(dipInLiveGames(memoryStorage({ [DIP_KEY]: "garbage" })), true, "anything but off is on");
  const store = memoryStorage();
  setDipInLiveGames(false, store);
  assert.equal(store.data.get(DIP_KEY), "off");
  assert.equal(dipInLiveGames(store), false);
  setDipInLiveGames(true, store);
  assert.equal(store.data.get(DIP_KEY), "on");
  assert.equal(dipInLiveGames(store), true);
});

test("blocked storage never throws: the choice lasts for the visit", () => {
  const broken = memoryStorage({}, { broken: true });
  assert.equal(dipInLiveGames(broken), true);
  assert.doesNotThrow(() => setDipInLiveGames(false, broken));
  assert.equal(dipInLiveGames(broken), false, "the visit remembers what storage could not");
  setDipInLiveGames(true, broken);
  assert.equal(dipInLiveGames(broken), true);
  assert.equal(dipInLiveGames(null), true, "no storage at all (node, a sandboxed frame)");
});

test("shouldDipNow reads #app[data-mode] and the setting", () => {
  const { doc, app } = stadium();
  const off = memoryStorage({ [DIP_KEY]: "off" });
  app.setAttribute("data-mode", "feed");
  assert.equal(shouldDipNow(doc, off), false);
  app.setAttribute("data-mode", "watch");
  assert.equal(shouldDipNow(doc, off), true);
  app.setAttribute("data-mode", "normal");
  assert.equal(shouldDipNow(doc, memoryStorage()), true);
  assert.equal(shouldDipNow(createDocument(), off), false, "no #app: a live game");
  assert.equal(shouldDipNow(null, memoryStorage()), true);
});

test("arrange hangs the booth: the SETTINGS rack holds two lamp switches with their notes", () => {
  const { doc, app, regions } = stadium();
  doc.documentElement.setAttribute("data-ambient", "dark");
  arrange(app, regions);
  const body = settingsOf(app);
  const dip = body.querySelector("#ulsDipLive");
  const room = body.querySelector("#ulsRoomLights");
  assert.equal(dip.getAttribute("type"), "checkbox");
  assert.equal(room.getAttribute("type"), "checkbox");
  assert.equal(dip.checked, true, "the dip is on by default");
  assert.equal(room.checked, false, "the room lights follow <html data-ambient> (dark)");
  const labels = body.querySelectorAll(".uls-switch-label");
  assert.deepEqual([...labels].map((n) => n.textContent), [BOOTH_COPY.dip, BOOTH_COPY.room]);
  assert.equal(dip.getAttribute("aria-describedby"), "ulsDipNote");
  assert.equal(doc.getElementById("ulsDipNote").textContent, BOOTH_COPY.dipNote);
  assert.equal(doc.getElementById("ulsRoomNote").textContent, BOOTH_COPY.roomNote);
  for (const sw of body.querySelectorAll(".uls-switch")) {
    assert.equal(sw.localName, "label", "the whole switch is the hit area");
  }
});

test("mountBooth is idempotent and needs only a SETTINGS rack", () => {
  const { app, regions } = stadium();
  arrange(app, regions);
  const first = mountBooth(app);
  assert.ok(first, "arrange mounted it");
  assert.equal(mountBooth(app), first, "the same booth comes back");
  arrange(app, regions);
  assert.equal(app.querySelectorAll("#ulsDipLive").length, 1);
  assert.equal(app.querySelectorAll(".uls-plate").length, 4, "the booth adds no plates");
  const bare = createDocument().createElement("div");
  assert.equal(mountBooth(bare), null, "no drawer, no booth");
  assert.equal(mountBooth(null), null);
});

test("the dip switch stores the viewer's choice; a stored OFF shows unlit", () => {
  const store = memoryStorage({ [DIP_KEY]: "off" });
  const { app } = drawer();
  const booth = mountBooth(app, { storage: store });
  const dip = booth.dip;
  assert.equal(dip.checked, false);
  dip.checked = true;
  dip.dispatchEvent({ type: "change" });
  assert.equal(store.data.get(DIP_KEY), "on");
  dip.checked = false;
  dip.dispatchEvent({ type: "change" });
  assert.equal(store.data.get(DIP_KEY), "off");
});

test("room lights: the app takes the change when it answers the event, else the booth applies it", () => {
  const win = fakeWindow();
  const { doc, app } = drawer({ win });
  doc.documentElement.setAttribute("data-ambient", "dark");
  const store = memoryStorage();
  const booth = mountBooth(app, { storage: store });
  const asked = [];
  const answer = (e) => { asked.push(e.detail.value); e.preventDefault(); };
  app.addEventListener(AMBIENT_EVENT, answer);
  booth.room.checked = true;
  booth.room.dispatchEvent({ type: "change" });
  assert.deepEqual(asked, ["room"]);
  assert.equal(doc.documentElement.getAttribute("data-ambient"), "dark", "the app owns it once it answers");
  assert.equal(store.data.has(AMBIENT_KEY), false);
  app.removeEventListener(AMBIENT_EVENT, answer);
  booth.room.dispatchEvent({ type: "change" });
  assert.equal(doc.documentElement.getAttribute("data-ambient"), "room", "nobody answered: the booth applies it");
  assert.equal(store.data.get(AMBIENT_KEY), "room", "and keeps it for the next load (sc:ambient)");
  booth.room.checked = false;
  booth.room.dispatchEvent({ type: "change" });
  assert.equal(doc.documentElement.getAttribute("data-ambient"), "dark");
  assert.equal(store.data.get(AMBIENT_KEY), "dark");
});

test("without a window the booth applies room lights itself", () => {
  const { doc, app } = drawer();
  doc.documentElement.setAttribute("data-ambient", "dark");
  const booth = mountBooth(app, { storage: memoryStorage() });
  booth.room.checked = true;
  booth.room.dispatchEvent({ type: "change" });
  assert.equal(doc.documentElement.getAttribute("data-ambient"), "room");
});

test("blocked storage never breaks the room lights: the page still changes", () => {
  const { doc, app } = drawer();
  doc.documentElement.setAttribute("data-ambient", "dark");
  const booth = mountBooth(app, { storage: memoryStorage({}, { broken: true }) });
  booth.room.checked = true;
  assert.doesNotThrow(() => booth.room.dispatchEvent({ type: "change" }));
  assert.equal(doc.documentElement.getAttribute("data-ambient"), "room");
});

test("a flag panel outside any rack scrolls nothing", () => {
  const win = fakeWindow();
  const { doc, app, flagPanel, flags } = drawer({ win });
  doc.body.appendChild(flagPanel);   // out of the drawer
  const scrolls = [];
  flags.scrollIntoView = (opts) => scrolls.push(opts);
  mountBooth(app);
  flagPanel.removeAttribute("hidden");
  observerOn(win, flagPanel).fn([]);
  assert.deepEqual(scrolls, []);
});

test("the room switch follows <html data-ambient> whoever changes it", () => {
  const win = fakeWindow();
  const { doc, app } = drawer({ win });
  doc.documentElement.setAttribute("data-ambient", "dark");
  const booth = mountBooth(app);
  const mo = observerOn(win, doc.documentElement);
  assert.ok(mo, "the booth watches <html>");
  assert.deepEqual([...mo.opts.attributeFilter], ["data-ambient"]);
  doc.documentElement.setAttribute("data-ambient", "room");
  mo.fn([]);
  assert.equal(booth.room.checked, true);
  doc.documentElement.setAttribute("data-ambient", "dark");
  mo.fn([]);
  assert.equal(booth.room.checked, false);
});

test("X opens the drawer to the FLAGS rack: it scrolls into view when the flag panel appears", () => {
  const win = fakeWindow();
  const { app, flagPanel, flags: rack } = drawer({ win });
  const booth = mountBooth(app);
  const scrolls = [];
  rack.scrollIntoView = (opts) => scrolls.push(opts);
  const mo = observerOn(win, flagPanel);
  assert.ok(mo, "the booth watches the flag panel");
  assert.deepEqual([...mo.opts.attributeFilter], ["hidden"]);
  mo.fn([]);
  assert.equal(scrolls.length, 0, "still hidden: nothing moves");
  flagPanel.removeAttribute("hidden");
  mo.fn([]);
  assert.deepEqual(scrolls, [{ block: "start", inline: "nearest" }]);
  mo.fn([]);
  assert.equal(scrolls.length, 1, "only when it appears, not on every change while open");
  flagPanel.setAttribute("hidden", "");
  mo.fn([]);
  flagPanel.removeAttribute("hidden");
  mo.fn([]);
  assert.equal(scrolls.length, 2, "each new open");
  booth.stop();
  assert.ok(win.observers.every((o) => o.off), "stop disconnects every observer");
});

test("the booth copy is plain words, set in caps by CSS", () => {
  for (const [key, text] of Object.entries(BOOTH_COPY)) {
    assert.equal(typeof text, "string", key);
    assert.ok(text.length > 2 && text === text.trim(), key);
  }
  assert.ok(Object.isFrozen(BOOTH_COPY));
});
