// Boot (ui-architecture.md 3.1 and 9.5; restructure-v2.md 9; owner A0). Wires the store, sync, actions, keyboard,
// conductor, engine (WebGL with the 2D fallback), components and the world, then opens the game once (/api/open).
// Core modules are imported statically; components, the engine and worlds are imported dynamically, so a missing or
// broken one leaves a visible notice and boot goes on: the page is never blank. Timers, fetch and the clock are
// called bare ("Illegal invocation" otherwise).
import * as Copy from "./model/copy.js";
import { TOAST_MS, createActions } from "./core/actions.js";
import { createApi } from "./core/api.js";
import { createConductor } from "./core/conductor.js";
import { attachKeyboard } from "./core/keyboard.js";
import { initialState, reducer } from "./core/reducer.js";
import { createStore } from "./core/store.js";
import { createSync } from "./core/sync.js";
import { fieldVm } from "./model/vm-field.js";
import { COMPONENTS, SHELL_IDS } from "./shell/bindings.js";
import { createEngineLoader } from "./shell/engine.js";
import { loadModules, mountComponents } from "./shell/mount.js";
import { createNotices } from "./shell/notices.js";
import { STORAGE_KEYS, readBootPrefs } from "./shell/prefs.js";
import {
  POSSESSION_FINAL, applyPossession, applyRootAttrs, applyTeams, applyWorld, missingWorldTokens, watchMotion,
} from "./theme/apply.js";
import { LookError, resolveLook } from "./theme/look-schema.js";
import { NEUTRAL_LOOK } from "./theme/neutral-look.js";
import { REGION_NAMES, registry } from "./theme/registry.js";
import { el, setData, setText } from "./ui/dom.js";
import { createScheduler } from "./ui/scheduler.js";

const HEARTBEAT_MS = 250;   // while a retry is pending, so "Retrying in N s" counts down on time
const WORLD_CSS_TIMEOUT_MS = 3000;
const TOKENS_LISTED = 3;
const REPORT_PATH = "/report";
/** The world's settings menu (its arrange marks it; the top bar's Settings key controls it by id). */
const SETTINGS_MENU = "[data-settings-menu]";
/** G2-4: what a lost and a restored WebGL context say (a toast: the GPU going away is not a bug). */
const SCENE_TOASTS = Object.freeze({
  lost: "The 3D field paused (the graphics reset), so the 2D field is showing until it comes back.",
  back: "The 3D field is back.",
});

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

/** The Model Report's address, keeping a world the page's own address names (a known id only, never a raw value). */
function reportHref(boot) {
  const id = boot.world.query;
  return id && registry.has(id) ? `${REPORT_PATH}?world=${encodeURIComponent(id)}` : REPORT_PATH;
}

// ---------------------------------------------------------------- announcer, field host, engine (3.1 step 3)
/** ui/announcer.js (G2-6), loaded like every component: one that fails leaves a notice, and boot goes on. */
async function loadAnnouncer(notices) {
  try {
    const mod = await import("./ui/announcer.js");
    if (typeof mod.mountAnnouncer === "function" && typeof mod.announcerVm === "function") return mod;
    throw new TypeError("ui/announcer.js has no mountAnnouncer() or announcerVm()");
  } catch (err) {
    notices.show("announcer", `Screen reader announcements didn't load (${message(err)}).`);
    return null;
  }
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

/** A toast from the shell, in the store's toast slot (its own ids, so it never clears an action's toast). */
function shellToaster(store) {
  let n = 0;
  return (text) => {
    n += 1;
    const id = `shell-${n}`;
    store.dispatch({ type: "toast/show", id, text, err: false });
    timers.setTimeout(() => store.dispatch({ type: "toast/hide", id }), TOAST_MS);
  };
}

/** Put `next` on the field: the engine it replaces is disposed, and rt, #field and <html> follow (6.2). */
function installEngine({ doc, rt }, next, scene, error) {
  const host = ensureFieldHost(doc);
  const old = rt.engine;
  rt.engine = next;
  if (old && old !== next) {
    try {
      old.dispose?.();
    } catch (disposeErr) {
      reportError(disposeErr);
    }
  }
  setData(host, "sceneError", error ? message(error) : null);
  applyRootAttrs(doc, { scene });
  rt.refreshExtras();
}

/**
 * The conductor's engines at run time (6.1, 6.2; G2-4): the 2D field when WebGL fails (a notice) or loses its context
 * (a toast: the GPU went away, not a bug), and a fresh WebGL field through loader.start once the browser restores the
 * context or the next epoch tries again. WebGL that still can't start comes back as a new 2D field.
 */
function runtimeEngines({ doc, look, world, boot, store, loader, notices, rt }) {
  const env = { doc, rt };
  const toast = shellToaster(store);
  const reducedMotion = () => store.getState().prefs.motion === "reduced";
  return {
    createFallback(err, { lost = false } = {}) {
      const next = loader.fallbackNow(ensureFieldHost(doc), look, { reducedMotion: reducedMotion() });
      installEngine(env, next, "2d", err);
      if (lost) toast(SCENE_TOASTS.lost);
      else notices.show("engine", `The 3D field stopped (${message(err)}), so the 2D field is showing.`);
      return next;
    },
    async createWebgl() {
      const res = await loader.start({ doc, host: ensureFieldHost(doc), look, world, scene: "auto",
        reducedMotion: reducedMotion(), capture: boot.capture });
      if (!res.engine) return null;
      const webgl = res.engine.kind === "webgl";
      installEngine(env, res.engine, webgl ? "webgl" : "2d", webgl ? null : res.error);
      if (webgl) {
        notices.hide("engine");
        toast(SCENE_TOASTS.back);
      }
      return res.engine;
    },
  };
}

// ---------------------------------------------------------------- shell bindings (theme follows the state)
/** Whose paint the band wears (G2-5): the team with the ball; once ESPN calls the game final, nobody's (steel). */
const bandPossession = (pv) => (pv.tl?.status?.state === "post" ? POSSESSION_FINAL
  : fieldVm(pv).situation?.poss ?? null);

function shellBindings(doc, look, rt, announcerMod) {
  const binding = (name, label, deps, select, update) => ({ name, region: "app", label, deps, select,
    component: { update, destroy() {} } });
  const announcer = announcerMod ? announcerMod.mountAnnouncer(doc) : null;
  return [
    binding("teams", "Team colors", (s) => [s.timeline.teams], (pv) => pv.tl.teams,
      (teams) => applyTeams(teams, doc, look)),
    binding("possession", "Possession colors", (s) => [s.presented, s.timeline, s.anim.drawnThrough],
      bandPossession, (poss) => applyPossession(poss, doc)),
    binding("prefs", "Display settings", (s) => [s.prefs.motion, s.prefs.ambient], (pv) => pv.prefs, (prefs) => {
      applyRootAttrs(doc, prefs);
      rt.engine?.setReducedMotion?.(prefs.motion === "reduced");
    }),
    // G2-6: each drawn play, its verdict and every mode change, spoken to assistive tech (ui/announcer.js)
    ...(announcer ? [binding("announcer", "Announcements", announcerDeps, (pv) => announcerMod.announcerVm(pv),
      (vm) => announcer.update(vm))] : []),
  ];
}

/** What the announcer hears change: a drawn play, a rebuild, the camera, the watch and the live feed. */
const announcerDeps = (s, env) => [s.anim.token, s.anim.drawnThrough, s.view.camera, s.version?.watch?.state,
  s.version?.watch?.speed, s.version?.feed?.on, env.extras?.cameraModes];

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

function createAppActions({ core, look, rt }) {
  return createActions({
    store: core.store, api: core.api, sync: core.sync, now, timers,
    cameraModes: () => cameraModesOf(rt, look),
    defaultCamera: () => look.cameras.default,
    persist: storageSet,
  });
}

function startScheduler({ doc, core, bindings, look, notices, rt, announcerMod }) {
  const scheduler = createScheduler(core.store, [...bindings, ...shellBindings(doc, look, rt, announcerMod)], {
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

function startConductor({ doc, look, world, boot, core, loader, notices, rt }) {
  const engines = runtimeEngines({ doc, look, world, boot, store: core.store, loader, notices, rt });
  const conductor = createConductor({
    store: core.store, getEngine: () => rt.engine, look, now, setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout, app: doc.getElementById("app"), onError: core.onError,
    createFallback: engines.createFallback, createWebgl: engines.createWebgl,
  });
  conductor.start();
  return conductor;
}

/** The world's events on #app: the HUD insets moved without a resize, the settings menu's room lights switch (it goes
 * through the store, so prefs.ambient follows) and a press outside the open menu (it closes, like Escape). */
function listenToWorld(app, { actions, rt }) {
  app?.addEventListener("sc:hud-insets", () => rt.engine?.setSafeArea?.(null));
  app?.addEventListener("sc:booth-ambient", (e) => {
    e.preventDefault();
    actions.setAmbient(e.detail?.value);
  });
  app?.addEventListener("sc:settings-close", () => actions.closeSettings());
}

/** restructure-v2.md 9: once the first state is in, the page opens the game, once (a live game goes live; a finished
 * one is a watch paused at kickoff; a session or the live feed already running is left as it is). */
async function startGame(core, actions) {
  await core.sync.start();
  if (core.store.getState().boot.phase === "ready") await actions.open();
}

// ---------------------------------------------------------------- boot
async function boot() {
  const doc = globalThis.document;
  const notices = createNotices(doc);
  const prefs = readPrefs();
  const modules = loadModules(COMPONENTS);
  const loader = createEngineLoader();
  loader.preloadFallback();
  const announcerLoading = loadAnnouncer(notices);
  const theme = await loadTheme(doc, prefs, notices);
  const { world, look } = theme;
  arrangeRegions(doc, world, notices);
  const app = doc.getElementById("app");
  const rt = { engine: null, extras: Object.freeze({ cameraModes: look.cameras.modes, engine: null }), refreshExtras: () => {} };
  const core = createCore(doc, prefs, theme, notices);
  const actions = createAppActions({ core, look, rt });
  const ctx = Object.freeze({ actions, engine: () => rt.engine, copy: Copy, reportHref: reportHref(prefs),
    settingsId: app?.querySelector(SETTINGS_MENU)?.id || null });
  const { bindings } = mountComponents(COMPONENTS, await modules, { doc, ctx, notices, shellIds: SHELL_IDS });
  startScheduler({ doc, core, bindings, look, notices, rt, announcerMod: await announcerLoading });
  await bootEngine({ doc, look, world, boot: prefs, loader, notices, rt });
  rt.refreshExtras();
  startConductor({ doc, look, world, boot: prefs, core, loader, notices, rt });
  listenToWorld(app, { actions, rt });
  initialCamera(core.store, prefs, look, rt);
  attachKeyboard(doc, { store: core.store, actions, onError: core.onError });
  const matchMedia = typeof globalThis.matchMedia === "function" ? (query) => globalThis.matchMedia(query) : undefined;
  watchMotion(matchMedia, (motion) => core.store.dispatch({ type: "prefs/set", key: "motion", value: motion }));
  if (prefs.debug) globalThis.__shadowDebug = () => rt.engine?.debugState?.() ?? null;
  startGame(core, actions).catch(core.onError);
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
