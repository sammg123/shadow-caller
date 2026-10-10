// Client-only view state and prefs (ui-architecture.md 2.1; FI 1.3, 4.4, 4.5, 5.5; G6, G7, G12; owner A2). Pure.
import { own } from "./domain.js";
import { EMPTY_PICK, pickLeaf, tap, toggleOutcome } from "./selection.js";
import { STRIP_FIELDS } from "./strip.js";

const LIVE_EDGE = Object.freeze({ seq: null });
const BOOTH_CLOSED = Object.freeze({ open: false, auto: false });
const PREF_VALUES = Object.freeze({
  motion: ["full", "reduced"], ambient: ["room", "dark"], scene: ["auto", "2d"], watchSpeed: [1, 2, 4, 10],
});
const WORLD_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DEFAULT_PREFS = Object.freeze({ motion: "full", world: "neutral", ambient: "room", scene: "auto", watchSpeed: 4 });

export function initialView() {
  return {
    pick: EMPTY_PICK, flag: { open: false, gen: 0 }, booth: BOOTH_CLOSED, scorecardOpen: false, camera: null,
    review: LIVE_EDGE, sideAtFifty: null, stripRejected: {}, stripErrors: {}, hoverLeaf: null, toast: null,
    bgMessage: null,
    bgPending: null,   // G12: a background message waiting for its state to be presented (reduce-server.js)
  };
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

const finiteOrNull = (v) => (Number.isFinite(v) ? v : null);
const withView = (state, patch) => ({ ...state, view: { ...state.view, ...patch } });
const keysOf = (state) => state.server?.keys ?? null;

function setPick(state, pick) {
  return pick === null || pick === state.view.pick ? state : withView(state, { pick });
}

function flagOpen(state, event) {
  const { flag, booth } = state.view;
  const openBooth = event.autoBooth === true && !booth.open;
  return withView(state, { flag: { open: true, gen: flag.gen + 1 }, booth: openBooth ? { open: true, auto: true } : booth });
}

/** Close the flag panel; a booth that X opened (`auto`) closes with it. */
export function closeFlag(view) {
  if (!view.flag.open && !view.booth.auto) return view;
  return { ...view, flag: { ...view.flag, open: false }, booth: view.booth.auto ? BOOTH_CLOSED : view.booth };
}

/** G7: once the presented state has no drive, the flag panel (and an auto-opened booth) closes. */
export function closeFlagWithoutDrive(state) {
  if (!state.view.flag.open || state.presented?.drive_active !== false) return state;
  return { ...state, view: closeFlag(state.view) };
}

/** A refused strip value: the text kept for its invalid style (FI 4.4) and the server's words for it (G5-13). */
function stripRejected(state, { field, text, error }) {
  if (!STRIP_FIELDS.includes(field)) return state;
  const errors = state.view.stripErrors ?? {};
  return withView(state, { stripRejected: { ...state.view.stripRejected, [field]: String(text ?? "") },
    stripErrors: { ...errors, [field]: typeof error === "string" ? error : "" } });
}

const without = (map, key) => Object.fromEntries(Object.entries(map ?? {}).filter(([k]) => k !== key));

function stripClear(state, { field }) {
  const errors = state.view.stripErrors ?? {};
  if (!Object.hasOwn(state.view.stripRejected, field) && !Object.hasOwn(errors, field)) return state;
  return withView(state, { stripRejected: without(state.view.stripRejected, field),
    stripErrors: without(errors, field) });
}

function toastShow(state, { id, text, err }) {
  return withView(state, { toast: { id, text: String(text ?? ""), err: Boolean(err) } });
}

function setIfChanged(state, key, value) {
  return state.view[key] === value ? state : withView(state, { [key]: value });
}

function reviewSet(state, { seq }) {
  if (seq !== null && !Number.isInteger(seq)) return state;
  return state.view.review.seq === seq ? state : withView(state, { review: seq === null ? LIVE_EDGE : { seq } });
}

function prefsSet(state, { key, value }) {
  if (!isValidPref(key, value) || state.prefs[key] === value) return state;
  return { ...state, prefs: { ...state.prefs, [key]: value } };
}

const HANDLERS = Object.freeze({
  "pick/tap": (s, e) => setPick(s, tap(s.view.pick, e.key)),
  "pick/outcome": (s, e) => setPick(s, toggleOutcome(s.view.pick, e.out)),
  "pick/leaf": (s, e) => setPick(s, pickLeaf(keysOf(s), e.leaf)),
  "pick/clear": (s) => setPick(s, EMPTY_PICK),
  "flag/open": flagOpen,
  "flag/close": (s) => {
    const view = closeFlag(s.view);
    return view === s.view ? s : { ...s, view };
  },
  "booth/toggle": (s) => withView(s, { booth: { open: !s.view.booth.open, auto: false } }),
  "booth/close": (s) => (s.view.booth.open || s.view.booth.auto ? withView(s, { booth: BOOTH_CLOSED }) : s),
  "scorecard/toggle": (s) => withView(s, { scorecardOpen: !s.view.scorecardOpen }),
  "scorecard/close": (s) => setIfChanged(s, "scorecardOpen", false),
  "camera/set": (s, e) => (typeof e.id === "string" ? setIfChanged(s, "camera", e.id) : s),
  "review/set": reviewSet,
  "hover/leaf": (s, e) => setIfChanged(s, "hoverLeaf", typeof e.leaf === "string" ? e.leaf : null),
  "side/fifty": (s, e) => (typeof e.team === "string" ? setIfChanged(s, "sideAtFifty", e.team) : s),
  "strip/rejected": stripRejected,
  "strip/clear": stripClear,
  "toast/show": toastShow,
  "toast/hide": (s, e) => (s.view.toast && s.view.toast.id === e.id ? withView(s, { toast: null }) : s),
  "bg/message": (s, e) => withView(s, { bgMessage: { text: String(e.text ?? ""), at: finiteOrNull(e.now) } }),
  "prefs/set": prefsSet,
});

export const VIEW_EVENTS = Object.freeze(Object.keys(HANDLERS));

export function reduceView(state, event) {
  const handler = own(HANDLERS, event.type);
  return handler ? handler(state, event) : state;
}
