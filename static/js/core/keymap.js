// The keyboard state machine (ui-architecture.md section 4, FI section 1, DIR shared keys; owner A2). Pure.
// resolveKey maps one keydown, already classified by core/keyboard.js, to at most one intent plus whether to
// preventDefault. Order: the guard (4.1), then flag mode (modal), then the global keys, then the mode table.
import { own } from "./domain.js";
import { FLAG_KEYS } from "./flags.js";

/** @typedef {"text" | "yards" | "slider" | "activatable" | "other"} Target */

const LEGACY_NAMES = Object.freeze({ Spacebar: "Space", Esc: "Escape", Left: "ArrowLeft", Right: "ArrowRight" });
const WATCH_SESSION = Object.freeze(["playing", "paused"]);
const WATCH_MODE = Object.freeze(["playing", "paused", "done", "error"]);
const FLAG_ALLOWED_WATCH = Object.freeze(["idle", "stopped"]);
const PLAY_KEYS = Object.freeze(["J", "K", "L", "R", "P", "A", "N", "O"]);
const RETAG_KEYS = Object.freeze(["A", "N", "O", "P", "J", "K", "L", "R"]);
const OUTCOME_OF = Object.freeze({ I: "incomplete", S: "sack", C: "scramble" });
const SPEED_OF = Object.freeze({ 1: 1, 2: 2, 3: 4, 4: 10 });
const NORMAL_SIMPLE = Object.freeze({ T: "toggleTD", F: "toggleTO", X: "openFlag", U: "undo", Escape: "clearPick" });
const YARDS_CHARS_RE = /^[0-9-]$/;
/** Intents a held key must not repeat: requests (log, undo, retag, flag, Space, digits) and modal toggles. */
const NO_REPEAT = new Set(["logPlay", "undo", "undoRefused", "retag", "applyFlag", "watchToggle", "watchSpeed",
  "openFlag", "closeFlag", "cycleCamera", "toggleBooth", "closeBooth", "toggleScorecard", "closeScorecard", "exitReview",
  "clearPick", "dismissToast"]);
/** G5-12: a slider's own keys (ui/scrub.js moves the review cursor and plays or pauses with them); every other key
 * on a focused slider works as it does anywhere on the page. */
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

const isCharacter = (k) => k.length === 1 || k === "Space";
const watchStateOf = (ctx) => ctx.watchState ?? "idle";

/** The active mode, in this order: flag, watch, feed, normal (4.2). #app[data-mode] mirrors it. */
export function modeOf(ctx) {
  const ws = watchStateOf(ctx);
  if (ctx.flagOpen && !ctx.feedOn && FLAG_ALLOWED_WATCH.includes(ws)) return "flag";
  if (WATCH_MODE.includes(ws)) return "watch";
  return ctx.feedOn ? "feed" : "normal";
}

/** The keyboard's view of the store: the freshest feed and watch (version first), overlays and the drive. */
export function keyContext(state) {
  const { server, version, view } = state;
  return {
    feedOn: Boolean(version?.feed?.on ?? server?.feed?.on ?? false),
    watchState: version?.watch?.state ?? server?.watch?.state ?? "idle",
    flagOpen: Boolean(view.flag.open),
    scorecardOpen: Boolean(view.scorecardOpen),
    reviewing: view.review.seq !== null && view.review.seq !== undefined,
    driveActive: Boolean(server?.drive_active),
    boothOpen: Boolean(view.booth?.open),
    toastErr: Boolean(view.toast?.err),
  };
}

function flagTable(k, target) {
  if (k === "Escape" || k === "X") return act({ type: "closeFlag" });
  if (own(FLAG_KEYS, k)) return act({ type: "applyFlag", code: FLAG_KEYS[k] });
  if (YARDS_CHARS_RE.test(k)) return NOTHING;
  if ((k === "Space" || k === "Enter") && target === "activatable") return NOTHING;
  if (k === "Enter" || isCharacter(k)) return PREVENT_ONLY;
  return NOTHING;
}

function globalTable(k, target, ctx, repeat) {
  const session = WATCH_SESSION.includes(watchStateOf(ctx));
  if (k === "V") return act({ type: "cycleCamera" });
  if (k === "B") return act({ type: "toggleBooth" });
  if (k === "G") return act({ type: "toggleScorecard" });
  if (k === "Space" && session && target !== "activatable") return act({ type: "watchToggle" });
  if ((k === "ArrowLeft" || k === "ArrowRight") && target !== "yards") {
    return act({ type: "review", delta: k === "ArrowLeft" ? -1 : 1, repeat });
  }
  if (own(SPEED_OF, k) && session && target !== "yards") return act({ type: "watchSpeed", speed: SPEED_OF[k] });
  if (k === "Escape" && ctx.toastErr) return act({ type: "dismissToast" });   // G5-13: the topmost layer
  if (k === "Escape" && ctx.scorecardOpen) return act({ type: "closeScorecard" });
  if (k === "Escape" && ctx.reviewing) return act({ type: "exitReview" });
  if (k === "Escape" && ctx.boothOpen) return act({ type: "closeBooth" });   // G5-12: before the pick is cleared
  return null;
}

function watchTable(k, _target, ctx) {
  if (RETAG_KEYS.includes(k)) return act({ type: "retag", key: k, pauseFirst: watchStateOf(ctx) === "playing" });
  if (k === "U") return act({ type: "undoRefused" });
  return NOTHING;
}

function feedTable(k) {
  if (RETAG_KEYS.includes(k)) return act({ type: "retag", key: k, pauseFirst: false });
  if (k === "U") return act({ type: "undo" });
  return NOTHING;
}

function normalTable(k, target) {
  if (PLAY_KEYS.includes(k)) return act({ type: "tap", key: k });
  if (own(OUTCOME_OF, k)) return act({ type: "outcome", out: OUTCOME_OF[k] });
  const simple = own(NORMAL_SIMPLE, k);
  if (simple) return act({ type: simple });
  if (k === "Enter") return target === "activatable" ? NOTHING : act({ type: "logPlay" });
  if (target === "yards" && isCharacter(k) && !YARDS_CHARS_RE.test(k)) return PREVENT_ONLY;
  return NOTHING;
}

const MODE_TABLES = Object.freeze({ watch: watchTable, feed: feedTable, normal: normalTable });

function resolveInMode(mode, k, target, ctx, repeat) {
  if (mode === "flag") return flagTable(k, target);
  return globalTable(k, target, ctx, repeat) ?? MODE_TABLES[mode](k, target, ctx);
}

/** The mode right after an intent's own local effect (feed and watch changes come from the server). */
function modeAfter(ctx, intent) {
  if (intent?.type === "openFlag" && ctx.driveActive !== false) return modeOf({ ...ctx, flagOpen: true });
  if (intent?.type === "closeFlag") return modeOf({ ...ctx, flagOpen: false });
  return modeOf(ctx);
}

/**
 * @param {{ key: string, repeat: boolean, mods: { meta: boolean, ctrl: boolean, alt: boolean, shift: boolean },
 *           composing: boolean, target: Target, ctx: object }} input
 * @returns {{ intent: object | null, prevent: boolean, mode: string, nextMode: string }}
 */
export function resolveKey({ key, repeat = false, mods = {}, composing = false, target = "other", ctx }) {
  const mode = modeOf(ctx);
  const done = (res) => ({ ...res, mode, nextMode: modeAfter(ctx, res.intent) });
  if (mods.meta || mods.ctrl || mods.alt || composing || target === "text") return done(NOTHING);
  const k = normalizeKey(key);
  if (target === "slider" && SLIDER_KEYS.has(k)) return done(NOTHING);
  const res = resolveInMode(mode, k, target, ctx, Boolean(repeat));
  if (repeat && res.intent && NO_REPEAT.has(res.intent.type)) return done(PREVENT_ONLY);
  return done(res);
}

const INPUT_KEYS = Object.freeze({
  strip: Object.freeze({ Enter: "commit", Escape: "restore" }),   // strip fields: commit if edited / server value back
  cmd: Object.freeze({ Enter: "run" }),                           // the shorthand bar: run, never log the pick (#84)
  feedEvent: Object.freeze({ Enter: "blur" }),                    // the ESPN id box: blur only (#104)
});

/**
 * Keys handled inside specific inputs (FI 1.8, section 4.5). The components own these handlers; this table keeps
 * the rule in one tested place. Returns null when the key is left to the browser (Tab blurs, and the blur commits).
 * @param {"strip" | "cmd" | "feedEvent"} field
 */
export function inputKeyAction(field, key) {
  const table = own(INPUT_KEYS, field);
  const action = table ? own(table, normalizeKey(key)) : undefined;
  return action ? { action, prevent: true } : null;
}
