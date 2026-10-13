// Client-only view state and prefs (ui-architecture.md 2.1; FI 4.5; restructure-v2.md 2 and 5; owner A2). Pure.
// The page holds no user input into the game (restructure-v2.md 1): the view is the camera, the hovered play, the
// toast, the settings menu and the playback request in flight (core/actions.js's lane: open, seek, back, forward,
// Go Live or play/pause, with a seek's target so the progress bar can show it before the server answers).
import { own } from "./domain.js";

const IDLE_PLAYBACK = Object.freeze({ kind: null, target: null });
/** The playback lane's requests (core/actions.js), the game picker's "select" among them (restructure-v2.md 11). */
const PLAYBACK_KINDS = Object.freeze(["open", "seek", "back", "forward", "golive", "toggle", "select"]);
const PREF_VALUES = Object.freeze({
  motion: ["full", "reduced"], ambient: ["room", "dark"], scene: ["auto", "2d"], watchSpeed: [1, 2, 4, 10],
});
const WORLD_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DEFAULT_PREFS = Object.freeze({ motion: "full", world: "neutral", ambient: "room", scene: "auto", watchSpeed: 4 });

export function initialView() {
  return { camera: null, hoverLeaf: null, toast: null, settingsOpen: false, playback: IDLE_PLAYBACK };
}

export function isValidPref(key, value) {
  if (key === "world") return typeof value === "string" && WORLD_ID_RE.test(value);
  return Boolean(own(PREF_VALUES, key)?.includes(value));
}

/** Defaults, overridden only by valid values (the URL and stored choices are untrusted). */
export function initialPrefs(overrides = {}) {
  const valid = Object.entries(overrides ?? {}).filter(([k, v]) => isValidPref(k, v));
  return { ...DEFAULT_PREFS, ...Object.fromEntries(valid) };
}

const withView = (state, patch) => ({ ...state, view: { ...state.view, ...patch } });

function setIfChanged(state, key, value) {
  return state.view[key] === value ? state : withView(state, { [key]: value });
}

function toastShow(state, { id, text, err }) {
  return withView(state, { toast: { id, text: String(text ?? ""), err: Boolean(err) } });
}

/** A playback request starts (or a newer press waits behind one): its kind, and a seek's target (a play count). */
function playbackStart(state, { kind, target = null }) {
  const targetOk = target === null || (Number.isInteger(target) && target >= 0);
  if (!PLAYBACK_KINDS.includes(kind) || !targetOk) return state;
  const now = state.view.playback;
  return now.kind === kind && now.target === target ? state : withView(state, { playback: { kind, target } });
}

function prefsSet(state, { key, value }) {
  if (!isValidPref(key, value) || state.prefs[key] === value) return state;
  return { ...state, prefs: { ...state.prefs, [key]: value } };
}

const HANDLERS = Object.freeze({
  "settings/toggle": (s) => withView(s, { settingsOpen: !s.view.settingsOpen }),
  "settings/close": (s) => setIfChanged(s, "settingsOpen", false),
  "playback/start": playbackStart,
  "playback/end": (s) => setIfChanged(s, "playback", IDLE_PLAYBACK),
  "camera/set": (s, e) => (typeof e.id === "string" ? setIfChanged(s, "camera", e.id) : s),
  "hover/leaf": (s, e) => setIfChanged(s, "hoverLeaf", typeof e.leaf === "string" ? e.leaf : null),
  "toast/show": toastShow,
  "toast/hide": (s, e) => (s.view.toast && s.view.toast.id === e.id ? withView(s, { toast: null }) : s),
  "prefs/set": prefsSet,
});

export const VIEW_EVENTS = Object.freeze(Object.keys(HANDLERS));

export function reduceView(state, event) {
  const handler = own(HANDLERS, event.type);
  return handler ? handler(state, event) : state;
}
