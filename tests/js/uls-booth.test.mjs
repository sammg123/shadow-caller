// theme/worlds/under-the-lights/booth.js (restructure-v2.md 1 and 2: the control-room drawer's two settings move to
// a small menu in the top bar; DESIGN.md "Keys, lamps and LED inputs"; owner: home frame). The booth fills the
// settings menu ([data-settings-menu], hung by arrange.js) with the world's two lamp switches (light dip in live
// games, room lights), keeps them true to the page (<html data-ambient>, sc:uls:dip-live), hands a room lights change
// to the app (a cancelable sc:booth-ambient event on #app) or applies it itself, tells the world's moments whether to
// dip, moves focus into the menu when it opens and back when it closes, and asks the app to close it on a press
// outside or when focus leaves it (sc:settings-close).
import assert from "node:assert/strict";
import test from "node:test";
import {
  AMBIENT_EVENT, AMBIENT_KEY, BOOTH_COPY, CLOSE_EVENT, DIP_KEY, dipFor, dipInLiveGames, mountBooth, setDipInLiveGames,
  shouldDipNow,
} from "../../static/js/theme/worlds/under-the-lights/booth.js";
import { SETTINGS_ID, arrange } from "../../static/js/theme/worlds/under-the-lights/arrange.js";
import { REGION_NAMES } from "../../static/js/theme/registry.js";
import { createDocument } from "./fake-dom.mjs";

/** The shell (index.html) with every region, hung by arrange. */
function stadium({ win = null } = {}) {
  const doc = createDocument();
  if (win) doc.defaultView = win;
  const app = doc.createElement("div");
  app.setAttribute("id", "app");
  doc.body.appendChild(app);
  const regions = {};
  for (const name of REGION_NAMES) {
    const node = doc.createElement(name === "masthead" ? "header" : "section");
    node.setAttribute("id", `rg-${name}`);
    node.setAttribute("data-region", name);
    app.appendChild(node);
    regions[name] = node;
  }
  return { doc, app, regions: Object.freeze(regions) };
}

/** Just what the booth needs, without arrange: #app, the top bar's Settings key and the empty menu it controls. */
function menuOnly({ win = null } = {}) {
  const doc = createDocument();
  if (win) doc.defaultView = win;
  const app = doc.createElement("div");
  app.setAttribute("id", "app");
  doc.body.appendChild(app);
  const key = doc.createElement("button");
  key.setAttribute("aria-controls", SETTINGS_ID);
  app.appendChild(key);
  const menu = doc.createElement("div");
  menu.setAttribute("id", SETTINGS_ID);
  menu.setAttribute("data-settings-menu", "");
  app.appendChild(menu);
  const elsewhere = doc.createElement("button");
  app.appendChild(elsewhere);
  return { doc, app, key, menu, elsewhere };
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

const observerOn = (win, target) => win.observers.find((o) => o.target === target);
/** Open or close the menu as the conductor does (#app[data-settings-open]), then run the booth's watcher. */
function setOpen(win, app, open) {
  app.setAttribute("data-settings-open", String(open));
  observerOn(win, app).fn([]);
}
/** A press on `target`, delivered to the document's own listeners (the booth listens on the document; the fake
 * document listens but does not dispatch). */
function press(doc, target) {
  for (const fn of doc.listeners.get("pointerdown") ?? []) fn({ type: "pointerdown", target });
}
/** Count the close requests the booth sends the app. */
function closes(app) {
  const seen = [];
  app.addEventListener(CLOSE_EVENT, (e) => seen.push(e.type));
  return seen;
}

test("dipFor: a watched game always dips; the live feed follows the setting", () => {
  assert.equal(dipFor("watch", false), true);
  assert.equal(dipFor("watch", true), true);
  for (const mode of ["feed", "normal"]) {
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

test("arrange fills the settings menu: two lamp switches with their notes, and nothing else", () => {
  const { doc, app, regions } = stadium();
  doc.documentElement.setAttribute("data-ambient", "dark");
  arrange(app, regions);
  const menu = app.querySelector("[data-settings-menu]");
  const dip = menu.querySelector("#ulsDipLive");
  const room = menu.querySelector("#ulsRoomLights");
  assert.equal(dip.getAttribute("type"), "checkbox");
  assert.equal(room.getAttribute("type"), "checkbox");
  assert.equal(dip.checked, true, "the dip is on by default");
  assert.equal(room.checked, false, "the room lights follow <html data-ambient> (dark)");
  const labels = menu.querySelectorAll(".uls-switch-label");
  assert.deepEqual([...labels].map((n) => n.textContent), [BOOTH_COPY.dip, BOOTH_COPY.room]);
  assert.equal(dip.getAttribute("aria-describedby"), "ulsDipNote");
  assert.equal(doc.getElementById("ulsDipNote").textContent, BOOTH_COPY.dipNote);
  assert.equal(doc.getElementById("ulsRoomNote").textContent, BOOTH_COPY.roomNote);
  for (const sw of menu.querySelectorAll(".uls-switch")) {
    assert.equal(sw.localName, "label", "the whole switch is the hit area");
  }
  assert.equal(menu.querySelectorAll("input").length, 2, "restructure-v2.md 2: the booth's two settings only");
  assert.equal(menu.querySelectorAll("[data-region]").length, 0, "the menu holds no region");
});

test("mountBooth is idempotent and needs only the settings menu", () => {
  const { app, regions } = stadium();
  arrange(app, regions);
  const first = mountBooth(app);
  assert.ok(first, "arrange mounted it");
  assert.equal(mountBooth(app), first, "the same booth comes back");
  arrange(app, regions);
  assert.equal(app.querySelectorAll("#ulsDipLive").length, 1);
  const bare = createDocument().createElement("div");
  assert.equal(mountBooth(bare), null, "no menu, no booth");
  assert.equal(mountBooth(null), null);
});

test("the dip switch stores the viewer's choice; a stored OFF shows unlit", () => {
  const store = memoryStorage({ [DIP_KEY]: "off" });
  const { app } = menuOnly();
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
  const { doc, app } = menuOnly({ win });
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
  const { doc, app } = menuOnly();
  doc.documentElement.setAttribute("data-ambient", "dark");
  const booth = mountBooth(app, { storage: memoryStorage() });
  booth.room.checked = true;
  booth.room.dispatchEvent({ type: "change" });
  assert.equal(doc.documentElement.getAttribute("data-ambient"), "room");
});

test("blocked storage never breaks the room lights: the page still changes", () => {
  const { doc, app } = menuOnly();
  doc.documentElement.setAttribute("data-ambient", "dark");
  const booth = mountBooth(app, { storage: memoryStorage({}, { broken: true }) });
  booth.room.checked = true;
  assert.doesNotThrow(() => booth.room.dispatchEvent({ type: "change" }));
  assert.equal(doc.documentElement.getAttribute("data-ambient"), "room");
});

test("the room switch follows <html data-ambient> whoever changes it", () => {
  const win = fakeWindow();
  const { doc, app } = menuOnly({ win });
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

test("opening the menu moves focus to its first switch; closing gives it back to the Settings key", () => {
  const win = fakeWindow();
  const { doc, app, key } = menuOnly({ win });
  const booth = mountBooth(app, { storage: memoryStorage() });
  const mo = observerOn(win, app);
  assert.deepEqual([...mo.opts.attributeFilter], ["data-settings-open"]);
  key.focus();
  setOpen(win, app, true);
  assert.equal(doc.activeElement, booth.dip, "focus went into the menu");
  setOpen(win, app, true);
  assert.equal(doc.activeElement, booth.dip, "no change, no move");
  setOpen(win, app, false);
  assert.equal(doc.activeElement, key, "and came back where it was");
});

test("closing never steals focus the viewer already moved out of the menu", () => {
  const win = fakeWindow();
  const { doc, app, key, elsewhere } = menuOnly({ win });
  mountBooth(app, { storage: memoryStorage() });
  key.focus();
  setOpen(win, app, true);
  elsewhere.focus();
  setOpen(win, app, false);
  assert.equal(doc.activeElement, elsewhere);
});

test("a press outside the open menu asks the app to close it; a press inside it or on its key does not", () => {
  const win = fakeWindow();
  const { doc, app, key, menu, elsewhere } = menuOnly({ win });
  const booth = mountBooth(app, { storage: memoryStorage() });
  const seen = closes(app);
  press(doc, elsewhere);
  assert.deepEqual(seen, [], "closed: nothing to close");
  setOpen(win, app, true);
  press(doc, booth.room);
  press(doc, menu);
  press(doc, key);
  assert.deepEqual(seen, [], "inside the menu, or the key that toggles it");
  press(doc, elsewhere);
  assert.deepEqual(seen, [CLOSE_EVENT]);
});

test("focus leaving the open menu asks the app to close it; moving between its switches does not", () => {
  const win = fakeWindow();
  const { app, key, menu, elsewhere } = menuOnly({ win });
  const booth = mountBooth(app, { storage: memoryStorage() });
  const seen = closes(app);
  setOpen(win, app, true);
  const leave = (relatedTarget) => menu.dispatchEvent({ type: "focusout", target: booth.dip, relatedTarget });
  leave(booth.room);
  leave(key);
  leave(null);
  assert.deepEqual(seen, [], "within the menu, back to its key, or focus nowhere (a click on empty page)");
  leave(elsewhere);
  assert.deepEqual(seen, [CLOSE_EVENT]);
});

test("stop disconnects every observer and listener", () => {
  const win = fakeWindow();
  const { doc, app, elsewhere } = menuOnly({ win });
  const booth = mountBooth(app, { storage: memoryStorage() });
  const seen = closes(app);
  setOpen(win, app, true);
  booth.stop();
  assert.ok(win.observers.every((o) => o.off));
  assert.equal((doc.listeners.get("pointerdown") ?? []).length, 0, "the document listener is gone");
  press(doc, elsewhere);
  assert.deepEqual(seen, []);
});

test("the booth copy is plain words, set in caps by CSS", () => {
  for (const [key, text] of Object.entries(BOOTH_COPY)) {
    assert.equal(typeof text, "string", key);
    assert.ok(text.length > 2 && text === text.trim(), key);
    assert.ok(!text.includes("—"), `${key}: no em dash`);
  }
  assert.ok(Object.isFrozen(BOOTH_COPY));
});
