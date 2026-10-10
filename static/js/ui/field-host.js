// Field host (ui-architecture.md 2.5, 2.6, 5.3, 6.1, 6.2, 9.1, 9.6; FI 6.2; #27, #28; owner A9). DOM side.
// Builds #field, the element the engine draws in (main.js creates the engine there: shell/engine.js picks WebGL or
// the 2D fallback and writes data-scene-error when it falls back; this host never touches that attribute). The
// host reports what is on the field through the 5.3 hooks, because a canvas can't be inspected: the situation
// (from fieldVm), the animation bookkeeping (from the store, through fieldHostVm) and the engine's own state
// (debugState, mirrored on every engine event). It sizes the engine (ResizeObserver -> engine.resize), stops it
// in a hidden tab (visibilitychange -> engine.setVisible) and re-subscribes whenever main.js swaps the engine.
// play-drawing.md 4b: a small style key on the field's edge (.sc-field-key: last play / next 1 / next 2, each with
// its stroke's swatch); the world's CSS shows it while his next call is up (#field[data-ghosts] not empty).
import { el, setAttr, setData, setText } from "./dom.js";

const ENGINE_EVENTS = Object.freeze(["ready", "anim", "camera", "frame", "contextlost", "contextrestored"]);
const ANIM_STATES = Object.freeze(["idle", "playing", "rebuilding", "reviewing"]);
const SCENE_KINDS = Object.freeze(["webgl", "2d"]);

const finiteOrNull = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);

function report(err) {
  if (typeof globalThis.reportError === "function") globalThis.reportError(err);
}

/**
 * What #field[data-anim-state] says (pure): the store's queue first (a row is queued, playing or the scene is
 * rebuilding), then the engine's own drawing (it may still be finishing a move), then review, else idle.
 * @param {{ playingSeq: number | null, queue: number, rebuilding: boolean } | null} anim
 * @param {number | null} reviewSeq
 * @param {string | null} engineState  debugState().animState
 */
export function animStateOf(anim, reviewSeq, engineState) {
  if (anim?.rebuilding) return "rebuilding";
  const playing = anim?.playingSeq !== null && anim?.playingSeq !== undefined;
  if (playing || anim?.queue > 0) return "playing";
  if (ANIM_STATES.includes(engineState) && engineState !== "idle") return engineState;
  return reviewSeq === null || reviewSeq === undefined ? "idle" : "reviewing";
}

// The functions below share one context `c` = { host, legend, ctx, label, engine, offs, anim, reviewSeq,
// engineState, debugFailed }.
function renderAnimState(c) {
  setData(c.host, "animState", animStateOf(c.anim, c.reviewSeq, c.engineState));
}

/** The engine's debugState, or null. A throw is reported once per engine: it runs on every frame event. */
function readDebug(c, engine) {
  try {
    return typeof engine.debugState === "function" ? engine.debugState() : null;
  } catch (err) {
    if (c.debugFailed !== engine) report(err);
    c.debugFailed = engine;
    return null;
  }
}

/** Copy the engine's state into the 5.3 hooks (2.5 debugState). */
function mirror(c) {
  const engine = c.engine;
  if (!engine) return;
  setData(c.host, "scene", SCENE_KINDS.includes(engine.kind) ? engine.kind : null);
  const s = readDebug(c, engine);
  if (s) {
    setData(c.host, "sceneReady", Boolean(s.ready));
    setData(c.host, "frames", finiteOrNull(s.frames));
    setData(c.host, "ghosts", Array.isArray(s.ghosts) ? s.ghosts.join(" ") : "");
    setData(c.host, "ghostHighlight", typeof s.highlight === "string" ? s.highlight : "");
    setData(c.host, "camera", typeof s.camera === "string" && s.camera !== "" ? s.camera : null);
    c.engineState = ANIM_STATES.includes(s.animState) ? s.animState : null;
  }
  renderAnimState(c);
}

function engineCall(c, name, ...args) {
  const fn = c.engine?.[name];
  if (typeof fn !== "function") return;
  try {
    fn.apply(c.engine, args);
  } catch (err) {
    report(err);
  }
}

function sizeEngine(c, width, height) {
  if (!(width > 0 && height > 0)) return;
  engineCall(c, "resize", width, height);
}

function attach(c, next) {
  for (const off of c.offs) off();
  c.offs = [];
  c.engine = next ?? null;
  c.engineState = null;
  if (!c.engine) return;
  if (typeof next.on === "function") c.offs = ENGINE_EVENTS.map((ev) => next.on(ev, () => mirror(c)));
  Promise.resolve(next.ready).then(() => { if (c.engine === next) mirror(c); }, () => {});
  sizeEngine(c, c.host.clientWidth, c.host.clientHeight);
  if (c.host.ownerDocument?.hidden) engineCall(c, "setVisible", false);
  mirror(c);
}

function syncEngine(c) {
  let next = null;
  try {
    next = c.ctx.engine?.() ?? null;
  } catch (err) {
    report(err);
  }
  if (next !== c.engine) attach(c, next);
}

/** The situation the field shows (#27, #28): drive, lines of scrimmage and to gain, possession, field x. */
function renderFacts(c, vm) {
  const f = vm.facts ?? {};
  setAttr(c.host, "aria-label", vm.ariaLabel || c.label);
  setData(c.host, "driveActive", Boolean(f.driveActive));
  setData(c.host, "los", finiteOrNull(f.los));
  setData(c.host, "ltg", finiteOrNull(f.ltg));
  setData(c.host, "poss", typeof f.poss === "string" ? f.poss : "");
  setData(c.host, "ballX", finiteOrNull(f.ballX));
  setData(c.host, "ltgX", finiteOrNull(f.ltgX));
  if (typeof vm.legend === "string" && vm.legend) setText(c.legend, vm.legend);
}

/** The store's animation bookkeeping (fieldHostVm): drawn seq, queue, playing seq, reviewed seq, epoch. */
function renderStore(c, vm) {
  const a = vm.anim ?? {};
  c.anim = { playingSeq: finiteOrNull(a.playingSeq), queue: finiteOrNull(a.queue) ?? 0,
    rebuilding: Boolean(a.rebuilding) };
  c.reviewSeq = finiteOrNull(vm.reviewSeq);
  setData(c.host, "drawnSeq", finiteOrNull(a.drawnSeq) ?? 0);
  setData(c.host, "queue", c.anim.queue);
  setData(c.host, "playingSeq", c.anim.playingSeq);
  setData(c.host, "reviewSeq", c.reviewSeq);
  setData(c.host, "epoch", typeof vm.epoch === "string" && vm.epoch !== "" ? vm.epoch : null);
}

function observeSize(c) {
  const RO = globalThis.ResizeObserver;
  if (typeof RO !== "function") return null;
  const observer = new RO((entries) => {
    const rect = entries[entries.length - 1]?.contentRect;
    sizeEngine(c, rect?.width, rect?.height);
  });
  observer.observe(c.host);
  return observer;
}

/**
 * @param {HTMLElement} root  #rg-field (the review banner appends its own banner here too)
 * @param {{ engine: () => object | null, copy: object }} ctx
 * @returns {{ update(vm: ReturnType<import("../shell/bindings.js").fieldHostVm>): void, destroy(): void }}
 */
/** 4b: the style key: the previous play's solid steel stroke, then his #1 and #2 as dashed lines in their colours. */
function styleKey(words) {
  const item = (role, text) => el("span", { cls: ["sc-field-key-item", `is-${role}`], data: { role } },
    [el("i", { cls: "sc-field-key-swatch" }), text]);
  return el("p", { cls: "sc-field-key", data: { testid: "field-key" }, attrs: { "aria-hidden": "true" } },
    [item("last", words?.last ?? "Last play"), item("next-1", words?.next1 ?? "Next 1"),
      item("next-2", words?.next2 ?? "Next 2")]);
}

export function mount(root, ctx) {
  const label = ctx.copy.FIELD.label;
  const legend = el("p", { cls: "sc-field-legend", data: { testid: "field-legend" }, text: ctx.copy.FIELD.legend });
  const key = styleKey(ctx.copy.FIELD.key);
  const host = el("div", { id: "field", cls: "sc-field", attrs: { role: "img", "aria-label": label },
    data: { sceneReady: false, animState: "idle", drawnSeq: 0, queue: 0, ghosts: "", ghostHighlight: "" } },
  [legend, key]);
  root.appendChild(host);
  const c = { host, legend, ctx, label, engine: null, offs: [], anim: null, reviewSeq: null, engineState: null,
    debugFailed: null };
  const observer = observeSize(c);
  const doc = root.ownerDocument;
  const onVisibility = () => engineCall(c, "setVisible", !doc.hidden);
  doc.addEventListener("visibilitychange", onVisibility);
  return {
    update(vm) {
      if (!vm) return;
      renderFacts(c, vm);
      renderStore(c, vm);
      syncEngine(c);
      renderAnimState(c);
    },
    destroy() {
      attach(c, null);
      observer?.disconnect();
      doc.removeEventListener("visibilitychange", onVisibility);
      host.remove();
    },
  };
}
