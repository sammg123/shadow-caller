// Boot (ui-architecture.md 3.1 and 9.5; owner A0). Wires the store, sync, actions, keyboard, conductor, engine
// (WebGL with the 2D fallback), components and the world. Core modules are imported statically; components, the
// engine, dialogs and worlds are imported dynamically, so a missing or broken one leaves a visible notice and boot
// goes on: the page is never blank. Timers, fetch and the clock are called bare ("Illegal invocation" otherwise).
import * as Copy from "./model/copy.js";
import { createActions } from "./core/actions.js";
import { createApi } from "./core/api.js";
import { createConductor } from "./core/conductor.js";
import { attachKeyboard } from "./core/keyboard.js";
import { initialState, reducer } from "./core/reducer.js";
import { createStore } from "./core/store.js";
import { createSync } from "./core/sync.js";
import { fieldVm } from "./model/vm-field.js";
import { COMPONENTS, SHELL_IDS } from "./shell/bindings.js";
import { createEngineLoader } from "./shell/engine.js";
import { createFormHub, loadModules, mountComponents } from "./shell/mount.js";
import { createNotices } from "./shell/notices.js";
import { STORAGE_KEYS, readBootPrefs } from "./shell/prefs.js";
import { applyPossession, applyRootAttrs, applyTeams, applyWorld, missingWorldTokens, watchMotion } from "./theme/apply.js";
import { LookError, resolveLook } from "./theme/look-schema.js";
import { NEUTRAL_LOOK } from "./theme/neutral-look.js";
import { REGION_NAMES, registry } from "./theme/registry.js";
import { el, setData, setText } from "./ui/dom.js";
import { createScheduler } from "./ui/scheduler.js";

const HEARTBEAT_MS = 250;   // while a retry is pending, so "Retrying in N s" counts down on time
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

function storageSet(key, value) {
  if (typeof key !== "string" || !key.startsWith("sc:")) return;
  try {
    globalThis.localStorage.setItem(key, String(value));
  } catch {
    // private mode or blocked storage: the choice lasts for this visit only
  }
}

function reportError(err) {
  if (typeof globalThis.reportError === "function") globalThis.reportError(err);
}

/** The engine's camera modes, or the look's when there is no engine or it fails to answer. */
function cameraModesOf(rt, look) {
  try {
    const modes = rt.engine?.cameraModes?.();
    return Array.isArray(modes) && modes.length ? modes : look.cameras.modes;
  } catch (err) {
    reportError(err);
    return look.cameras.modes;
  }
}

function readPrefs() {
  const media = typeof globalThis.matchMedia === "function" ? globalThis.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const stored = Object.fromEntries(Object.values(STORAGE_KEYS).map((key) => [key, storageGet(key)]));
  return readBootPrefs({ search: globalThis.location?.search ?? "", stored, reducedMotion: Boolean(media?.matches) });
}

// ---------------------------------------------------------------- world (3.1 step 1)
function resolveWorldLook(world, notices) {
  try {
    return resolveLook(world.look);
  } catch (err) {
    const n = err instanceof LookError ? err.errors.length : 1;
    notices.show("look", `The ${world.label} scene settings have ${n} problem${n === 1 ? "" : "s"} (${message(err)}), `
      + "so the plain scene is showing.");
    return NEUTRAL_LOOK;
  }
}

async function applyWorldCss(doc, world, notices) {
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
}

async function loadTheme(doc, boot, notices) {
  const choice = registry.chooseWorldId(boot.world);
  for (const id of choice.ignored) notices.show(`world-id:${id}`, `There is no look called "${id}", so it was ignored.`);
  const loaded = await registry.loadWithFallback(choice.id);
  if (loaded.fellBack) {
    notices.show("world", `The "${loaded.requested}" look didn't load (${message(loaded.error)}), `
      + `so the ${loaded.world.label.toLowerCase()} look is showing.`);
  }
  const look = resolveWorldLook(loaded.world, notices);
  const ambient = boot.ambient ?? loaded.world.ambient ?? "room";
  applyRootAttrs(doc, { motion: boot.prefs.motion, ambient });
  await applyWorldCss(doc, loaded.world, notices);
  return { world: loaded.world, look, ambient };
}

function arrangeRegions(doc, world, notices) {
  const app = doc.getElementById("app");
  const regions = Object.freeze(Object.fromEntries(REGION_NAMES
    .map((name) => [name, app.querySelector(`[data-region="${name}"]`)]).filter(([, node]) => node)));
  if (typeof world.arrange !== "function") return;
  try {
    world.arrange(app, regions);
    const lost = Object.entries(regions).filter(([, node]) => !node.isConnected).map(([name]) => name);
    if (lost.length) throw new Error(`it removed ${lost.join(", ")}`);
  } catch (err) {
    notices.show("arrange", `The ${world.label} layout hit a problem (${message(err)}).`);
  }
}

// ---------------------------------------------------------------- dialogs, field host, engine (3.1 step 3)
async function loadDialogs() {
  try {
    const mod = await import("./ui/dialogs.js");
    if (typeof mod.confirmAction === "function") return { confirmAction: (text) => mod.confirmAction(text) };
  } catch {
    // ui/dialogs.js is window.confirm behind a promise (2.6); the same stand-in below keeps confirms working.
  }
  return { confirmAction: (text) => Promise.resolve(Boolean(globalThis.confirm(String(text)))) };
}

/** #field, created by the field host; made here when the field host did not mount, so the engine has a home. */
function ensureFieldHost(doc) {
  const found = doc.getElementById("field");
  if (found) return found;
  const host = el("div", { id: "field", attrs: { role: "img", "aria-label": "Football field" } });
  (doc.getElementById("rg-field") ?? doc.getElementById("app") ?? doc.body).appendChild(host);
  return host;
}

function reportEngine(res, host, notices) {
  if (!res.engine) {
    notices.regionFailed(host, { name: "engine", region: "field", label: "The field" }, res.error);
    return;
  }
  if (res.reason === "failed") {
    setData(host, "sceneError", message(res.error));
    notices.show("engine", `The 3D field didn't start (${message(res.error)}), so the 2D field is showing.`);
  }
  if (res.reason === "no-webgl2") {
    notices.show("engine", "This browser can't draw the 3D field (no WebGL2), so the 2D field is showing.");
  }
}

async function bootEngine({ doc, look, world, boot, loader, notices, rt }) {
  const host = ensureFieldHost(doc);
  const res = await loader.start({ doc, host, look, world, scene: boot.prefs.scene,
    reducedMotion: boot.prefs.motion === "reduced", capture: boot.capture });
  rt.engine = res.engine;
  reportEngine(res, host, notices);
  applyRootAttrs(doc, { scene: res.engine?.kind === "webgl" ? "webgl" : "2d" });
}

/** The conductor's run-time failover: the 2D engine replaces a failed WebGL one (6.2). */
function fallbackFactory({ doc, look, store, loader, notices, rt }) {
  return (err) => {
    const host = ensureFieldHost(doc);
    const next = loader.fallbackNow(host, look, { reducedMotion: store.getState().prefs.motion === "reduced" });
    try {
      rt.engine?.dispose?.();
    } catch (disposeErr) {
      reportError(disposeErr);
    }
    rt.engine = next;
    setData(host, "sceneError", message(err));
    applyRootAttrs(doc, { scene: "2d" });
    notices.show("engine", `The 3D field stopped (${message(err)}), so the 2D field is showing.`);
    rt.refreshExtras();
    return next;
  };
}

// ---------------------------------------------------------------- shell bindings (theme follows the state)
function shellBindings(doc, look, rt) {
  const binding = (name, label, deps, select, update) => ({ name, region: "app", label, deps, select,
    component: { update, destroy() {} } });
  return [
    binding("teams", "Team colors", (s) => [s.timeline.teams], (pv) => pv.tl.teams,
      (teams) => applyTeams(teams, doc, look)),
    binding("possession", "Possession colors", (s) => [s.presented, s.timeline, s.anim.drawnThrough],
      (pv) => fieldVm(pv).situation?.poss ?? null, (poss) => applyPossession(poss, doc)),
    binding("prefs", "Display settings", (s) => [s.prefs.motion, s.prefs.ambient], (pv) => pv.prefs, (prefs) => {
      applyRootAttrs(doc, prefs);
      rt.engine?.setReducedMotion?.(prefs.motion === "reduced");
    }),
  ];
}

// ---------------------------------------------------------------- store, sync, actions, components (steps 2 to 4)
function createCore(doc, boot, theme, notices) {
  const onError = (err) => {
    reportError(err);
    notices.bug(err);
  };
  const prefs = { ...boot.prefs, ambient: theme.ambient, world: theme.world.id };
  const store = createStore(reducer, initialState({ prefs }), { onError });
  const api = createApi({ fetchImpl: (input, init) => globalThis.fetch(input, init) });
  const sync = createSync({ api, store, now, timers, doc, onError });
  return { store, api, sync, onError };
}

function createAppActions({ core, form, dialogs, world, look, rt }) {
  return createActions({
    store: core.store, api: core.api, sync: core.sync, form, dialogs, now, timers,
    cameraModes: () => cameraModesOf(rt, look),
    defaultCamera: () => look.cameras.default,
    boothHoldsFlags: () => Boolean(world.booth?.holds?.includes("flags")),
    persist: storageSet,
  });
}

function startScheduler({ doc, core, bindings, look, notices, rt }) {
  const scheduler = createScheduler(core.store, [...bindings, ...shellBindings(doc, look, rt)], {
    raf: (fn) => globalThis.requestAnimationFrame(fn),
    cancelRaf: (id) => globalThis.cancelAnimationFrame(id),
    now,
    extras: () => rt.extras,
    onError: (err, binding) => {
      reportError(err);
      notices.componentError(binding, err);
    },
  });
  rt.refreshExtras = () => {
    rt.extras = Object.freeze({ cameraModes: cameraModesOf(rt, look), engine: rt.engine });
    scheduler.invalidate();
  };
  scheduler.start();
  globalThis.setInterval(() => {
    if (core.store.getState().conn.retryAt !== null) scheduler.invalidate();
  }, HEARTBEAT_MS);
  return scheduler;
}

/** The stored camera when this engine has it, else the look's default, else the engine's first mode. */
function initialCamera(store, boot, look, rt) {
  const ids = cameraModesOf(rt, look).map((m) => m?.id).filter((id) => typeof id === "string");
  const id = [boot.camera, look.cameras.default].find((c) => c && ids.includes(c)) ?? ids[0];
  if (id) store.dispatch({ type: "camera/set", id });
}

function startConductor({ doc, look, core, loader, notices, rt }) {
  const conductor = createConductor({
    store: core.store, getEngine: () => rt.engine, look, now, setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout, app: doc.getElementById("app"), onError: core.onError,
    createFallback: fallbackFactory({ doc, look, store: core.store, loader, notices, rt }),
  });
  conductor.start();
  return conductor;
}

// ---------------------------------------------------------------- boot
async function boot() {
  const doc = globalThis.document;
  const notices = createNotices(doc);
  const prefs = readPrefs();
  const modules = loadModules(COMPONENTS);
  const loader = createEngineLoader();
  loader.preloadFallback();
  const dialogsLoading = loadDialogs();
  const theme = await loadTheme(doc, prefs, notices);
  const { world, look } = theme;
  arrangeRegions(doc, world, notices);
  const rt = { engine: null, extras: Object.freeze({ cameraModes: look.cameras.modes, engine: null }), refreshExtras: () => {} };
  const core = createCore(doc, prefs, theme, notices);
  const formHub = createFormHub();
  const actions = createAppActions({ core, form: formHub.form, dialogs: await dialogsLoading, world, look, rt });
  const ctx = Object.freeze({ actions, form: formHub.form, engine: () => rt.engine, copy: Copy });
  const { bindings } = mountComponents(COMPONENTS, await modules, { doc, ctx, notices, formHub, shellIds: SHELL_IDS });
  startScheduler({ doc, core, bindings, look, notices, rt });
  await bootEngine({ doc, look, world, boot: prefs, loader, notices, rt });
  rt.refreshExtras();
  startConductor({ doc, look, core, loader, notices, rt });
  // v1.4 (W3's ask, wired by W1): the HUD insets changed without a resize (mode, drawer): the camera re-reads them
  doc.getElementById("app")?.addEventListener("sc:hud-insets", () => rt.engine?.setSafeArea?.(null));
  // v1.4 (W4's ask, wired by W6): the booth's Room lights switch goes through the store, so prefs.ambient follows
  doc.getElementById("app")?.addEventListener("sc:booth-ambient", (e) => {
    e.preventDefault();
    actions.setAmbient(e.detail?.value);
  });
  initialCamera(core.store, prefs, look, rt);
  attachKeyboard(doc, { store: core.store, actions, onError: core.onError });
  const matchMedia = typeof globalThis.matchMedia === "function" ? (query) => globalThis.matchMedia(query) : undefined;
  watchMotion(matchMedia, (motion) => core.store.dispatch({ type: "prefs/set", key: "motion", value: motion }));
  if (prefs.debug) globalThis.__shadowDebug = () => rt.engine?.debugState?.() ?? null;
  core.sync.start().catch(core.onError);
}

/** Boot itself failed (a bug): say so on the loading screen, or in the notice tray once that screen is gone. */
function showFatal(err) {
  reportError(err);
  const doc = globalThis.document;
  const text = `The app couldn't start (${message(err)}). Check the Terminal running bash start.sh, then refresh.`;
  const line = doc?.querySelector(".sc-boot-static-text");
  if (line) setText(line, text);
  else if (doc) createNotices(doc).show("fatal", text, { tone: "error" });
}

boot().catch(showFatal);
