// Under the Lights: the booth (DESIGN.md "Control-room drawer", "Keys, lamps and LED inputs"; ui-architecture.md 8.2,
// v1.4; owner W4). arrange.js calls mountBooth(app) once at boot, after it has hung the drawer's racks and before the
// components mount. The booth:
// - fills the SETTINGS rack with the world's two lamp switches: "Light dip in live games" (ON by default, stored per
//   viewer as sc:uls:dip-live; OFF skips the dip during the ESPN feed and hand entry, Watch this game always dips)
//   and "Room lights" (on = data-ambient "room", for a lit room or a projector);
// - hands a room lights change to the app first: a cancelable "sc:booth-ambient" event on #app (detail { value }),
//   which main.js answers with actions.setAmbient(value) and preventDefault(); when nobody answers, the booth writes
//   <html data-ambient> through theme/apply.js and keeps sc:ambient itself, so the switch works either way. The
//   switch always shows what <html data-ambient> says, whoever set it;
// - tells W1's moments whether to dip: dipInLiveGames(), dipFor(mode, on), shouldDipNow(doc);
// - opens the drawer to the FLAGS rack: when the flag panel appears (X), the rack scrolls into view, so the fouls are
//   at the top of the drawer (and, on a phone, on screen).
// Text only (G27); storage reads and writes never throw (a private window keeps the choice for the visit).
import { applyRootAttrs } from "../../apply.js";
import { setAttr } from "../../../ui/dom.js";

export const DIP_KEY = "sc:uls:dip-live";
export const AMBIENT_KEY = "sc:ambient";
export const AMBIENT_EVENT = "sc:booth-ambient";

/** World copy for the booth's switches (set in caps by CSS; the source strings stay sentence case). */
export const BOOTH_COPY = Object.freeze({
  dip: "Light dip in live games",
  dipNote: "Watch this game always dips.",
  room: "Room lights",
  roomNote: "On for a lit room or a projector: the bowl brightens.",
});

const DIP_ON = "on";
const DIP_OFF = "off";
const AMBIENT_ROOM = "room";
const AMBIENT_DARK = "dark";
const SCROLL_TO_RACK = Object.freeze({ block: "start", inline: "nearest" });
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

/** Whether the stadium dips before a call: Watch this game always does; live entry follows the setting. Pure. */
export function dipFor(mode, dipLive) {
  return mode === "watch" ? true : Boolean(dipLive);
}

/** For W1's presnap moment: #app[data-mode] and the viewer's setting, read now. */
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

/** The nearest ancestor of `node` that is a drawer rack (the fake DOM and old engines have no closest()). */
function rackOf(node) {
  for (let at = node?.parentNode ?? null; at && at.nodeType === 1; at = at.parentNode) {
    if (at.hasAttribute("data-rack")) return at;
  }
  return null;
}

/** X opens the drawer to the FLAGS rack: scroll it into view each time the flag panel appears. */
function watchFlags(view, doc) {
  const panel = doc.getElementById?.("flagPanel") ?? null;
  let shown = Boolean(panel) && !panel.hasAttribute("hidden");
  return observe(view, panel, ["hidden"], () => {
    const now = !panel.hasAttribute("hidden");
    const appeared = now && !shown;
    shown = now;
    const rack = appeared ? rackOf(panel) : null;
    if (rack && typeof rack.scrollIntoView === "function") rack.scrollIntoView(SCROLL_TO_RACK);
  });
}

function wire(app, parts, storage) {
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
  const observers = [observe(view, doc?.documentElement, ["data-ambient"], showAmbient), watchFlags(view, doc)]
    .filter(Boolean);
  return Object.freeze({
    node: parts.node,
    dip: parts.dip,
    room: parts.room,
    stop() {
      for (const observer of observers) observer.disconnect();
    },
  });
}

/**
 * Fill the drawer's SETTINGS rack (arrange.js builds it: [data-rack="settings"] > .uls-rack-body) and start the
 * booth's watchers. Idempotent per #app. Returns the booth ({ node, dip, room, stop }), or null without the rack.
 * @param {HTMLElement} app  #app, already arranged
 * @param {{ storage?: Storage | null }} [opts]  storage: the page's localStorage unless given (tests)
 */
export function mountBooth(app, opts = {}) {
  if (!app || typeof app.querySelector !== "function") return null;
  const known = BOOTHS.get(app);
  if (known) return known;
  const body = app.querySelector('[data-rack="settings"]')?.querySelector(".uls-rack-body") ?? null;
  if (!body) return null;
  const storage = Object.hasOwn(opts ?? {}, "storage") ? opts.storage : pageStorage();
  const parts = buildSettings(app.ownerDocument);
  body.appendChild(parts.node);
  const booth = wire(app, parts, storage);
  BOOTHS.set(app, booth);
  return booth;
}
