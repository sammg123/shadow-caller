// The Model Report's boot (restructure-v2.md section 6; the home page's boot pattern, static/js/main.js): the world's
// styles, the app's own store, reducer and sync (polling /api/version, then /api/state and /api/timeline as they
// change, so the report follows a game the server keeps playing), the drain that stands in for the field, then every
// board, each imported on its own so a broken one leaves a visible notice while the rest load. No engine, no
// three.js, no POST: this page only reads (the analyst's questions are its own POST, docs/design/analyst.md 5).
// Timers, fetch and the clock are called bare ("Illegal invocation").
// Both play-callers tracked (restructure-v2.md 11 decision 4): the viewer's pick of whose sections to show rides on
// the scheduler's extras (pv.sideChoice); a drive button or an analyst's cite switches to that call's caller first,
// then brings its row into view (report/moves.js, report/model/cite.js, report/ui/reveal.js).
import { createApi } from "../core/api.js";
import { presentedTimeline } from "../core/present.js";
import { initialState, reducer } from "../core/reducer.js";
import { createStore } from "../core/store.js";
import { createSync } from "../core/sync.js";
import { loadModules, mountComponents } from "../shell/mount.js";
import { createNotices } from "../shell/notices.js";
import { STORAGE_KEYS, readBootPrefs } from "../shell/prefs.js";
import { applyRootAttrs, applyTeams, applyWorld, missingWorldTokens, watchMotion } from "../theme/apply.js";
import { setAttr, setData, setHidden, setText } from "../ui/dom.js";
import { createScheduler } from "../ui/scheduler.js";
import { REPORT_COMPONENTS, REPORT_IDS } from "./bindings.js";
import { attachDrain } from "./drain.js";
import { REPORT_DRIVES_COPY } from "./model/drives.js";
import { createMoves } from "./moves.js";
import { createRevealer } from "./ui/reveal.js";
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

// ---------------------------------------------------------------- whose sections, and the way to one call
/** report/moves.js on this page's store and DOM; `render` is the scheduler's flush, once it exists. */
function pageMoves(doc, { core, motion, render }) {
  const view = () => {
    const state = core.store.getState();
    return { presented: state.presented, tl: presentedTimeline(state) };
  };
  return createMoves({ reveal: createRevealer(doc, { motion, timers }), view, render });
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

function startScheduler(core, bindings, extras) {
  const scheduler = createScheduler(core.store, bindings, {
    raf: (fn) => globalThis.requestAnimationFrame(fn),
    cancelRaf: (id) => globalThis.cancelAnimationFrame(id),
    now,
    onError: (err) => core.onError(err),
    extras,
  });
  scheduler.start();
  globalThis.setInterval(() => {
    if (core.store.getState().conn.retryAt !== null) scheduler.invalidate();
  }, HEARTBEAT_MS);
  return scheduler;
}

// ---------------------------------------------------------------- the analyst (phase 4)
/** restructure-v2.md 6 and 7 item 4: the analyst's full chat (docs/design/analyst-ui.md 5); a cite takes the reader
 * to that call's row. Imported on its own, so a broken analyst leaves a notice and never stops the report. */
async function mountAnalyst(doc, { notices, revealCall }) {
  const host = doc.getElementById("rp-analyst");
  if (!host) return;
  try {
    const { mountAsk } = await import("../ask/panel.js");
    mountAsk(host, { layout: "embedded" });
  } catch (err) {
    notices.show("ask", `The analyst couldn't load (${message(err)}).`);
    return;
  }
  setHidden(host, false);
  host.addEventListener("sc:ask-cite", (e) => {
    const seq = Number(e && e.detail && e.detail.seq);
    if (Number.isInteger(seq)) revealCall(seq);
  });
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
  let scheduler = null;
  const moves = pageMoves(doc, { core, motion, render: () => scheduler?.flush() });
  // no board on this page takes input into the game: a drive picked on the drive chart only scrolls to its first
  // call, and the ribbon's switch only picks whose calls the boards show
  const actions = Object.freeze({ retryNow: () => core.sync.kick(), reviewAt: moves.revealCall,
    showSide: moves.showSide });
  const ctx = Object.freeze({ actions, engine: () => null, copy: REPORT_DRIVES_COPY });
  const { bindings } = mountComponents(REPORT_COMPONENTS, await modules,
    { doc, ctx, notices, shellIds: REPORT_IDS });
  scheduler = startScheduler(core, [...bindings, ...pageBindings(doc, theme.world)], moves.extras);
  mountAnalyst(doc, { notices, revealCall: moves.revealCall }).catch(reportError);
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
