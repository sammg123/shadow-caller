// Under the Lights: the settings menu (restructure-v2.md 1 and 2: the control-room drawer's two settings move to a small
// menu in the top bar; DESIGN.md "Keys, lamps and LED inputs"; owner: home frame). arrange.js calls mountBooth(app)
// once at boot, after it has hung the menu's fixture ([data-settings-menu]) and before the components mount. It:
// - fills the menu with the world's two lamp switches: "Light dip in live games" (ON by default, stored per viewer as
//   sc:uls:dip-live; OFF skips the dip while the live feed runs, a watched game always dips) and "Room lights" (on =
//   data-ambient "room", for a lit room or a projector);
// - hands a room lights change to the app first: a cancelable "sc:booth-ambient" event on #app (detail { value }),
//   which main.js answers with actions.setAmbient(value) and preventDefault(); when nobody answers, the booth writes
//   <html data-ambient> through theme/apply.js and keeps sc:ambient itself, so the switch works either way. The
//   switch always shows what <html data-ambient> says, whoever set it;
// - tells the world's moments whether to dip: dipInLiveGames(), dipFor(mode, on), shouldDipNow(doc);
// - moves focus into the menu when it opens (#app[data-settings-open], the top bar's Settings key) and back to where
//   it was when it closes; a press outside the open menu, or focus leaving it, asks the app to close it (a
//   "sc:settings-close" event on #app, which main.js answers with actions.closeSettings()). Escape closes it through
//   the keyboard (core/keymap.js).
// Text only (G27); storage reads and writes never throw (a private window keeps the choice for the visit).
import { applyRootAttrs } from "../../apply.js";
import { setAttr } from "../../../ui/dom.js";

export const DIP_KEY = "sc:uls:dip-live";
export const AMBIENT_KEY = "sc:ambient";
export const AMBIENT_EVENT = "sc:booth-ambient";
export const CLOSE_EVENT = "sc:settings-close";

/** World copy for the menu's switches (set in caps by CSS; the source strings stay sentence case). */
export const BOOTH_COPY = Object.freeze({
  dip: "Light dip in live games",
  dipNote: "A watched game always dips.",
  room: "Room lights",
  roomNote: "On for a lit room or a projector: the bowl brightens.",
});

const DIP_ON = "on";
const DIP_OFF = "off";
const AMBIENT_ROOM = "room";
const AMBIENT_DARK = "dark";
const OPEN_ATTR = "data-settings-open";
const MENU = "[data-settings-menu]";
/** The viewer's dip choice for this visit, per storage, when storage cannot keep it. */
const VISIT = new WeakMap();
const NO_STORAGE = Object.freeze({});
/** One booth per #app, however often arrange runs. */
const BOOTHS = new WeakMap();

/** The page's localStorage, or null where reaching it throws or it does not exist (node, a sandboxed frame). */
function pageStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const visitKey = (storage) => (storage && typeof storage === "object" ? storage : NO_STORAGE);

/** sc:uls:dip-live as stored, null when absent, undefined when storage can't be read. */
function readDip(storage) {
  if (!storage || typeof storage.getItem !== "function") return undefined;
  try {
    return storage.getItem(DIP_KEY);
  } catch {
    return undefined;
  }
}

/**
 * Light dip in live games: ON unless the viewer turned it off (anything but "off" reads as on). When storage can't
 * be read, or holds nothing while this visit made a choice storage couldn't keep, the visit's choice applies.
 * @param {Storage | null} [storage]
 * @returns {boolean}
 */
export function dipInLiveGames(storage = pageStorage()) {
  const stored = readDip(storage);
  if (typeof stored === "string") return stored !== DIP_OFF;
  const visit = VISIT.get(visitKey(storage));
  return typeof visit === "boolean" ? visit : true;
}

/** Store the viewer's dip choice; storage that throws keeps it for the visit only. */
export function setDipInLiveGames(on, storage = pageStorage()) {
  VISIT.set(visitKey(storage), Boolean(on));
  if (!storage || typeof storage.setItem !== "function") return;
  try {
    storage.setItem(DIP_KEY, on ? DIP_ON : DIP_OFF);
  } catch {
    // private mode or blocked site data: the choice lasts for this visit
  }
}

/** Whether the stadium dips before a call: a watched game always does; the live feed follows the setting. Pure. */
export function dipFor(mode, dipLive) {
  return mode === "watch" ? true : Boolean(dipLive);
}

/** For the world's presnap moment: #app[data-mode] and the viewer's setting, read now. */
export function shouldDipNow(doc = globalThis.document, storage = pageStorage()) {
  const app = doc?.getElementById?.("app") ?? null;
  return dipFor(app?.getAttribute?.("data-mode") ?? null, dipInLiveGames(storage));
}

// ---------------------------------------------------------------- building the switches
function make(doc, tag, attrs = {}, children = []) {
  const node = doc.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) setAttr(node, name, value);
  for (const child of children) node.appendChild(typeof child === "string" ? doc.createTextNode(child) : child);
  return node;
}

/** A lamp switch (DESIGN.md: a checkbox drawn as a lamp beside its label, lit when checked), and its note. */
function lampSwitch(doc, { setting, id, noteId, label, note }) {
  const input = make(doc, "input", { type: "checkbox", id, class: "uls-switch-input", "aria-describedby": noteId });
  const text = make(doc, "span", { class: "sc-check-label uls-switch-label" }, [label]);
  const node = make(doc, "label", { class: "sc-check uls-switch", "data-setting": setting }, [input, text]);
  const help = make(doc, "p", { class: "uls-switch-note", id: noteId }, [note]);
  return { input, node: make(doc, "div", { class: "uls-setting", "data-setting": setting }, [node, help]) };
}

function buildSettings(doc) {
  const dip = lampSwitch(doc, { setting: "dip", id: "ulsDipLive", noteId: "ulsDipNote", label: BOOTH_COPY.dip,
    note: BOOTH_COPY.dipNote });
  const room = lampSwitch(doc, { setting: "room", id: "ulsRoomLights", noteId: "ulsRoomNote", label: BOOTH_COPY.room,
    note: BOOTH_COPY.roomNote });
  const node = make(doc, "div", { class: "uls-booth", "data-booth": "settings" }, [dip.node, room.node]);
  return { node, dip: dip.input, room: room.input };
}

// ---------------------------------------------------------------- room lights
const ambientOf = (doc) => doc?.documentElement?.getAttribute("data-ambient") === AMBIENT_ROOM ? AMBIENT_ROOM
  : AMBIENT_DARK;

/** Ask the app (actions.setAmbient) first; nobody answering means the booth applies and keeps it itself. */
function requestAmbient(app, value, storage) {
  const doc = app.ownerDocument;
  const view = doc?.defaultView;
  if (view && typeof view.CustomEvent === "function") {
    const event = new view.CustomEvent(AMBIENT_EVENT, { detail: { value }, bubbles: true, cancelable: true });
    app.dispatchEvent(event);
    if (event.defaultPrevented) return;
  }
  applyRootAttrs(doc, { ambient: value });
  if (!storage || typeof storage.setItem !== "function") return;
  try {
    storage.setItem(AMBIENT_KEY, value);
  } catch {
    // the room lights stay as chosen for this visit
  }
}

// ---------------------------------------------------------------- watching the page
function observe(view, target, attributeFilter, fn) {
  if (!target || typeof view?.MutationObserver !== "function") return null;
  const observer = new view.MutationObserver(fn);
  observer.observe(target, { attributes: true, attributeFilter });
  return observer;
}

/** The top bar's Settings key: the control naming the menu (aria-controls). */
const keyOf = (doc, menu) => (menu.id ? doc.querySelector?.(`[aria-controls="${menu.id}"]`) ?? null : null);

/** Ask the app to close the menu (main.js: actions.closeSettings), never the store directly. */
function askClose(app) {
  const view = app.ownerDocument?.defaultView;
  if (typeof view?.CustomEvent === "function") app.dispatchEvent(new view.CustomEvent(CLOSE_EVENT, { bubbles: true }));
}

/**
 * Focus follows the menu: opened, focus goes to its first switch and the control that had it is remembered; closed,
 * focus goes back there when it was in the menu (or nowhere). While open, a press outside the menu and its key, or
 * focus leaving both, asks the app to close it. Returns stop().
 */
function watchMenu(app, menu) {
  const doc = app.ownerDocument;
  const st = { open: app.getAttribute(OPEN_ATTR) === "true", opener: null };
  const outside = (node) => Boolean(node) && !menu.contains(node) && node !== keyOf(doc, menu)
    && !keyOf(doc, menu)?.contains(node);
  const onPress = (e) => { if (st.open && outside(e.target)) askClose(app); };
  const onFocusOut = (e) => { if (st.open && outside(e.relatedTarget)) askClose(app); };
  const sync = () => {
    const open = app.getAttribute(OPEN_ATTR) === "true";
    if (open === st.open) return;
    st.open = open;
    if (open) {
      st.opener = doc.activeElement;
      menu.querySelector("input")?.focus({ preventScroll: true });
      return;
    }
    const active = doc.activeElement;
    if (st.opener?.isConnected && (!active || active === doc.body || menu.contains(active))) {
      st.opener.focus({ preventScroll: true });
    }
    st.opener = null;
  };
  const observer = observe(doc.defaultView, app, [OPEN_ATTR], sync);
  doc.addEventListener("pointerdown", onPress, true);
  menu.addEventListener("focusout", onFocusOut);
  return () => {
    observer?.disconnect();
    doc.removeEventListener("pointerdown", onPress, true);
    menu.removeEventListener("focusout", onFocusOut);
  };
}

function wire(app, menu, parts, storage) {
  const doc = app.ownerDocument;
  const view = doc?.defaultView ?? null;
  const showAmbient = () => { parts.room.checked = ambientOf(doc) === AMBIENT_ROOM; };
  parts.dip.checked = dipInLiveGames(storage);
  showAmbient();
  parts.dip.addEventListener("change", () => setDipInLiveGames(parts.dip.checked, storage));
  // The switch shows the viewer's choice at once; the <html> watcher brings it back in line with the page if the app
  // settles the room lights differently (the store applies its prefs on the next frame).
  parts.room.addEventListener("change", () => requestAmbient(app, parts.room.checked ? AMBIENT_ROOM : AMBIENT_DARK,
    storage));
  const observer = observe(view, doc?.documentElement, ["data-ambient"], showAmbient);
  const stopMenu = watchMenu(app, menu);
  return Object.freeze({
    node: parts.node,
    dip: parts.dip,
    room: parts.room,
    stop() {
      observer?.disconnect();
      stopMenu();
    },
  });
}

/**
 * Fill the settings menu (arrange.js hangs it: [data-settings-menu]) and start the booth's watchers. Idempotent per
 * #app. Returns the booth ({ node, dip, room, stop }), or null without the menu.
 * @param {HTMLElement} app  #app, already arranged
 * @param {{ storage?: Storage | null }} [opts]  storage: the page's localStorage unless given (tests)
 */
export function mountBooth(app, opts = {}) {
  if (!app || typeof app.querySelector !== "function") return null;
  const known = BOOTHS.get(app);
  if (known) return known;
  const menu = app.querySelector(MENU);
  if (!menu) return null;
  const storage = Object.hasOwn(opts ?? {}, "storage") ? opts.storage : pageStorage();
  const parts = buildSettings(app.ownerDocument);
  menu.appendChild(parts.node);
  const booth = wire(app, menu, parts, storage);
  BOOTHS.set(app, booth);
  return booth;
}
