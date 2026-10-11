// The Model Report's boot (restructure-v2.md section 6; the home page's boot pattern, static/js/main.js): the world's
// styles, the app's own store, reducer and sync (polling /api/version, then /api/state and /api/timeline as they
// change, so the report follows a game the server keeps playing), the drain that stands in for the field, then every
// board, each imported on its own so a broken one leaves a visible notice while the rest load. No engine, no
// three.js, no POST: this page only reads. Timers, fetch and the clock are called bare ("Illegal invocation").
import { createApi } from "../core/api.js";
import { initialState, reducer } from "../core/reducer.js";
import { createStore } from "../core/store.js";
import { createSync } from "../core/sync.js";
import { loadModules, mountComponents } from "../shell/mount.js";
import { createNotices } from "../shell/notices.js";
import { STORAGE_KEYS, readBootPrefs } from "../shell/prefs.js";
import { applyRootAttrs, applyTeams, applyWorld, missingWorldTokens, watchMotion } from "../theme/apply.js";
import { setAttr, setData, setText } from "../ui/dom.js";
import { createScheduler } from "../ui/scheduler.js";
import { REPORT_COMPONENTS, REPORT_IDS } from "./bindings.js";
import { attachDrain } from "./drain.js";
import { REPORT_DRIVES_COPY } from "./model/drives.js";
import { chooseReportWorld, gamecastHref, reportWorld } from "./world.js";

const HEARTBEAT_MS = 250;            // while a retry is pending, so "Retrying in N s" counts down on time
const WORLD_CSS_TIMEOUT_MS = 3000;
const TOKENS_LISTED = 3;

const now = () => Date.now();
const timers = Object.freeze({
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id),
});
const message = (err) => (err && typeof err.message === "string" && err.message ? err.message : String(err));

function storageGet(key) {
  try {
    return globalThis.localStorage.getItem(key);
  } catch {
    return null;   // private mode or blocked storage: the stored choice is simply absent
  }
}

function reportError(err) {
  if (typeof globalThis.reportError === "function") globalThis.reportError(err);
}

function readPrefs() {
  const media = typeof globalThis.matchMedia === "function"
    ? globalThis.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const stored = Object.fromEntries(Object.values(STORAGE_KEYS).map((key) => [key, storageGet(key)]));
  return readBootPrefs({ search: globalThis.location?.search ?? "", stored, reducedMotion: Boolean(media?.matches) });
}

// ---------------------------------------------------------------- world (the same choice as the GameCast's)
async function applyReportWorld(doc, boot, notices) {
  const choice = chooseReportWorld(boot.world);
  for (const id of choice.ignored) {
    notices.show(`world-id:${id}`, `There is no look called "${id}", so it was ignored.`);
  }
  const world = reportWorld(choice.id);
  const ambient = boot.ambient ?? world.ambient ?? "room";
  applyRootAttrs(doc, { motion: boot.prefs.motion, ambient });
  try {
    const { failed } = await applyWorld(world, doc, { timeoutMs: WORLD_CSS_TIMEOUT_MS });
    if (failed.length) notices.show("world-css", `${world.label} styles didn't load: ${failed.join(", ")}.`);
  } catch (err) {
    notices.show("world-css", `The ${world.label} styles couldn't be applied (${message(err)}).`);
  }
  const missing = missingWorldTokens(doc);
  if (missing.length) {
    notices.show("tokens", `The ${world.label} look is missing ${missing.length} style tokens `
      + `(${missing.slice(0, TOKENS_LISTED).join(", ")}${missing.length > TOKENS_LISTED ? " and more" : ""}).`);
  }
  return { world, ambient };
}

// ---------------------------------------------------------------- the drive chart's buttons: to the calls table
/** A drive of his: bring its first call's row (under its drive's row) into view and give it focus. */
function showCall(doc, seq, motion) {
  const row = doc.querySelector(`#rp-calls tr[data-seq="${Number(seq)}"]`);
  if (!row) return;
  const driveRow = row.previousElementSibling?.matches(".rp-drive-row") ? row.previousElementSibling : row;
  driveRow.scrollIntoView({ block: "start", behavior: motion() === "reduced" ? "auto" : "smooth" });
  row.focus({ preventScroll: true });
}

// ---------------------------------------------------------------- store, sync, boards
function createCore(boot, theme, notices, doc) {
  const onError = (err) => {
    reportError(err);
    notices.bug(err);
  };
  const prefs = { ...boot.prefs, ambient: theme.ambient, world: theme.world.id };
  const store = createStore(reducer, initialState({ prefs }), { onError });
  const api = createApi({ fetchImpl: (input, init) => globalThis.fetch(input, init), timers });
  const sync = createSync({ api, store, now, timers, doc, onError });
  attachDrain(store, now);
  return { store, sync, onError };
}

/** The page's own bindings: team paint (DC C2) and #report[data-boot] (the boot phase, a test and a style hook). */
function pageBindings(doc, world) {
  const binding = (name, label, deps, select, update) => ({ name, region: "page", label, deps, select,
    component: { update, destroy() {} } });
  const page = doc.getElementById("report");
  return [
    binding("teams", "Team colors", (s) => [s.timeline.teams], (pv) => pv.tl.teams,
      (teams) => applyTeams(teams, doc, { teamColor: world.teamColor })),
    binding("boot", "Page state", (s) => [s.boot.phase], (pv) => pv.boot.phase,
      (phase) => setData(page, "boot", phase)),
  ];
}

function startScheduler(core, bindings) {
  const scheduler = createScheduler(core.store, bindings, {
    raf: (fn) => globalThis.requestAnimationFrame(fn),
    cancelRaf: (id) => globalThis.cancelAnimationFrame(id),
    now,
    onError: (err) => core.onError(err),
  });
  scheduler.start();
  globalThis.setInterval(() => {
    if (core.store.getState().conn.retryAt !== null) scheduler.invalidate();
  }, HEARTBEAT_MS);
  return scheduler;
}

// ---------------------------------------------------------------- boot
async function boot() {
  const doc = globalThis.document;
  const notices = createNotices(doc);
  const prefs = readPrefs();
  const modules = loadModules(REPORT_COMPONENTS);
  const theme = await applyReportWorld(doc, prefs, notices);
  setAttr(doc.getElementById("rp-back"), "href", gamecastHref(globalThis.location?.search ?? ""));
  const core = createCore(prefs, theme, notices, doc);
  const motion = () => core.store.getState().prefs.motion;
  // no board on this page takes input: a drive picked on the drive chart only scrolls to its first call
  const actions = Object.freeze({ retryNow: () => core.sync.kick(), reviewAt: (seq) => showCall(doc, seq, motion) });
  const ctx = Object.freeze({ actions, engine: () => null, copy: REPORT_DRIVES_COPY });
  const { bindings } = mountComponents(REPORT_COMPONENTS, await modules,
    { doc, ctx, notices, shellIds: REPORT_IDS });
  startScheduler(core, [...bindings, ...pageBindings(doc, theme.world)]);
  const matchMedia = typeof globalThis.matchMedia === "function" ? (query) => globalThis.matchMedia(query) : undefined;
  watchMotion(matchMedia, (value) => core.store.dispatch({ type: "prefs/set", key: "motion", value }));
  core.sync.start().catch(core.onError);
}

/** Boot itself failed (a bug): say so on the loading screen, or in the notice tray once that screen is gone. */
function showFatal(err) {
  reportError(err);
  const doc = globalThis.document;
  const text = `The report couldn't start (${message(err)}). Check the Terminal running bash start.sh, then refresh.`;
  const line = doc?.querySelector(".sc-boot-static-text");
  if (line) setText(line, text);
  else if (doc) createNotices(doc).show("fatal", text, { tone: "error" });
}

boot().catch(showFatal);
