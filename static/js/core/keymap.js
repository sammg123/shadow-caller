// The keyboard (restructure-v2.md 2: "Space play/pause, Left/Right step back/forward, 1 to 4 speed, V camera, Escape =
// Go Live", and no others; ui-architecture.md section 4; owner A2). Pure. resolveKey maps one keydown, already
// classified by core/keyboard.js, to at most one intent plus whether to preventDefault. Order: the guard (modifiers,
// IME composition, an inline input: shortcuts never fire there), then a focused slider keeps its own keys (the top
// bar's progress bar), then the table. Escape takes the topmost layer first: an error toast, the open settings menu,
// then Go Live.
import { own } from "./domain.js";

const LEGACY_NAMES = Object.freeze({ Spacebar: "Space", Esc: "Escape", Left: "ArrowLeft", Right: "ArrowRight" });
const WATCH_MODE = Object.freeze(["playing", "paused", "done", "error"]);
const SPEED_OF = Object.freeze({ 1: 1, 2: 2, 3: 4, 4: 10 });
/** Intents a held key must not repeat. Left and Right repeat: each press waits its turn in the playback lane. */
const NO_REPEAT = new Set(["togglePlay", "setSpeed", "cycleCamera", "goLive", "closeSettings", "dismissToast"]);
/** A slider's own keys (ui/watch-transport.js's progress bar steps, seeks and plays with them); every other key on a
 * focused slider works as it does anywhere on the page. */
const SLIDER_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown",
  "Space"]);

const NOTHING = Object.freeze({ intent: null, prevent: false });
const PREVENT_ONLY = Object.freeze({ intent: null, prevent: true });
const act = (intent) => ({ intent, prevent: true });

/** One printable character becomes uppercase (" " becomes "Space"); named keys stay as they are. */
export function normalizeKey(key) {
  if (typeof key !== "string") return "";
  if (key === " ") return "Space";
  if (key.length === 1) return key.toUpperCase();
  return own(LEGACY_NAMES, key) ?? key;
}

/** The game on screen: a watched game ("watch"), else the live feed ("feed"), else "normal". #app[data-mode]. */
export function modeOf(ctx) {
  if (WATCH_MODE.includes(ctx.watchState ?? "idle")) return "watch";
  return ctx.feedOn ? "feed" : "normal";
}

/** The keyboard's view of the store: the freshest feed and watch (version first), the error toast, the menu. */
export function keyContext(state) {
  const { server, version, view } = state;
  return {
    feedOn: Boolean(version?.feed?.on ?? server?.feed?.on ?? false),
    watchState: version?.watch?.state ?? server?.watch?.state ?? "idle",
    toastErr: Boolean(view.toast?.err),
    settingsOpen: Boolean(view.settingsOpen),
  };
}

function escapeIntent(ctx) {
  if (ctx.toastErr) return { type: "dismissToast" };
  if (ctx.settingsOpen) return { type: "closeSettings" };
  return { type: "goLive" };
}

function resolveIn(k, target, ctx) {
  if (k === "Space") return target === "activatable" ? NOTHING : act({ type: "togglePlay" });
  if (k === "ArrowLeft") return act({ type: "stepBack" });
  if (k === "ArrowRight") return act({ type: "stepForward" });
  if (own(SPEED_OF, k)) return act({ type: "setSpeed", speed: SPEED_OF[k] });
  if (k === "V") return act({ type: "cycleCamera" });
  if (k === "Escape") return act(escapeIntent(ctx));
  return NOTHING;
}

/**
 * @param {{ key: string, repeat: boolean, mods: { meta: boolean, ctrl: boolean, alt: boolean, shift: boolean },
 *           composing: boolean, target: "text" | "slider" | "activatable" | "other", ctx: object }} input
 * @returns {{ intent: object | null, prevent: boolean, mode: string }}
 */
export function resolveKey({ key, repeat = false, mods = {}, composing = false, target = "other", ctx }) {
  const done = (res) => ({ ...res, mode: modeOf(ctx) });
  if (mods.meta || mods.ctrl || mods.alt || composing || target === "text") return done(NOTHING);
  const k = normalizeKey(key);
  if (target === "slider" && SLIDER_KEYS.has(k)) return done(NOTHING);
  const res = resolveIn(k, target, ctx);
  if (repeat && res.intent && NO_REPEAT.has(res.intent.type)) return done(PREVENT_ONLY);
  return done(res);
}
