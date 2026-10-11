// ui/field-host.js and shell/bindings.js fieldHostVm (owner A9; ui-architecture.md 2.5, 2.6, 5.3, 6.1, 6.2, 9.1, 9.6):
// the #field host, its hooks, and the engine wiring (resize, visibility, the debugState mirror).
import assert from "node:assert/strict";
import test from "node:test";
import { mount } from "../../static/js/ui/field-host.js";
import { fieldHostVm } from "../../static/js/shell/bindings.js";
import { chromeCtx, chromePage } from "./chrome-ctx.mjs";
import { withDocument } from "./fake-dom.mjs";
import { makePv, state } from "./model-fixtures.mjs";

function fakeEngine(kind = "webgl", over = {}) {
  const handlers = new Map();
  const calls = [];
  let ds = { kind, ready: false, frames: 0, animState: "idle", playingSeq: null, ghosts: [], highlight: null,
    camera: kind === "2d" ? "blimp" : "wide", situation: null, drawCalls: 0, triangles: 0, geometries: 0, textures: 0,
    dpr: 1, ...over };
  return {
    kind,
    ready: new Promise(() => {}),
    on(ev, fn) {
      handlers.set(ev, [...(handlers.get(ev) ?? []), fn]);
      return () => handlers.set(ev, (handlers.get(ev) ?? []).filter((f) => f !== fn));
    },
    emit(ev) { for (const fn of handlers.get(ev) ?? []) fn(); },
    listening: (ev) => (handlers.get(ev) ?? []).length,
    debugState() { return ds; },
    set(next) { ds = { ...ds, ...next }; },
    resize(w, h) { calls.push(["resize", w, h]); },
    setVisible(v) { calls.push(["setVisible", v]); },
    calls,
  };
}

class FakeResizeObserver {
  static last = null;
  constructor(cb) { this.cb = cb; this.observed = []; FakeResizeObserver.last = this; }
  observe(node) { this.observed.push(node); }
  disconnect() { this.observed = []; this.disconnected = true; }
  fire(width, height) { this.cb([{ target: this.observed[0], contentRect: { width, height } }]); }
}

function setup({ engine = null } = {}) {
  const doc = chromePage([["section", "rg-field"]]);
  const { ctx, setEngine } = chromeCtx({ engine });
  const root = doc.getElementById("rg-field");
  const before = globalThis.ResizeObserver;
  globalThis.ResizeObserver = FakeResizeObserver;
  const component = withDocument(doc, () => mount(root, ctx));
  globalThis.ResizeObserver = before;
  const host = root.querySelector("#field");
  const render = (pvOpts = {}) => withDocument(doc, () => component.update(fieldHostVm(makePv(pvOpts))));
  return { doc, root, host, component, render, setEngine, ro: FakeResizeObserver.last };
}

const data = (node, name) => node.getAttribute(`data-${name}`);

test("fieldHostVm is fieldVm plus the store facts the #field hooks report (5.3)", () => {
  const pv = makePv({ presented: { ...state.drive(), timeline: { n: 104, epoch: "e7", source: "espn", mode: "replay" } },
    anim: { drawnThrough: 104, queue: [{ seq: 105 }, { seq: 106 }], playing: { seq: 105 }, rebuilding: false } });
  const vm = fieldHostVm(pv);
  assert.equal(vm.ariaLabel, "Ball on DAL 25. 1st & 10. Line to gain DAL 35.");
  assert.deepEqual(vm.facts, { driveActive: true, los: 75, ltg: 65, poss: "DAL", ballX: 25, ltgX: 35 });
  assert.deepEqual(vm.anim, { drawnSeq: 104, queue: 2, playingSeq: 105, rebuilding: false });
  assert.equal("reviewSeq" in vm, false, "there is no client review mode");
  assert.equal(vm.epoch, "e7");
  assert.ok(Object.isFrozen(vm));
  const bare = fieldHostVm(makePv());
  assert.deepEqual(bare.anim, { drawnSeq: 0, queue: 0, playingSeq: null, rebuilding: false });
  assert.equal(bare.epoch, null);
});

test("mount builds #field as an image with its legend, inside its root, not ready yet", () => {
  const { doc, host } = setup();
  assert.ok(host);
  assert.equal(host.getAttribute("role"), "img");
  assert.equal(host.getAttribute("aria-label"), "Football field");
  assert.equal(data(host, "scene-ready"), "false");
  const legend = host.querySelector("[data-testid=\"field-legend\"]");
  assert.equal(legend.textContent, "Ball shown mid-field; ESPN gives no hash.");
  assert.equal(doc.getElementById("outsider").textContent, "not yours");
});

test("#27: a caller drive at DAL 25 reports LOS 75 and LTG 65 with the ball's field x", () => {
  const { host, render } = setup();
  render({ presented: state.drive() });
  assert.equal(data(host, "drive-active"), "true");
  assert.equal(data(host, "los"), "75");
  assert.equal(data(host, "ltg"), "65");
  assert.equal(data(host, "poss"), "DAL");
  assert.equal(data(host, "ball-x"), "25");
  assert.equal(data(host, "ltg-x"), "35");
  assert.equal(host.getAttribute("aria-label"), "Ball on DAL 25. 1st & 10. Line to gain DAL 35.");
});

test("#27: off the field, no drive, no lines, and the label says so", () => {
  const { host, render } = setup();
  render({ presented: state.drive() });
  render({ presented: state.final() });
  assert.equal(data(host, "drive-active"), "false");
  for (const name of ["los", "ltg", "ball-x", "ltg-x"]) assert.equal(host.hasAttribute(`data-${name}`), false, name);
  assert.equal(data(host, "poss"), "");
  assert.equal(host.getAttribute("aria-label"), "DAL off the field.");
});

test("the animation hooks follow the store: drawn seq, queue, playing seq, epoch", () => {
  const { host, render } = setup();
  render({ presented: { ...state.final(), timeline: { n: 3, epoch: "e1" } },
    anim: { drawnThrough: 2, queue: [{ seq: 3 }], playing: null } });
  assert.equal(data(host, "drawn-seq"), "2");
  assert.equal(data(host, "queue"), "1");
  assert.equal(host.hasAttribute("data-playing-seq"), false);
  assert.equal(data(host, "epoch"), "e1");
  assert.equal(data(host, "anim-state"), "playing", "rows still queued: not idle");
  render({ presented: state.final(), anim: { drawnThrough: 3, queue: [], playing: null } });
  assert.equal(data(host, "anim-state"), "idle");
  assert.equal(host.hasAttribute("data-review-seq"), false);
  render({ presented: state.final(), anim: { drawnThrough: 0, queue: [], playing: null, rebuilding: true } });
  assert.equal(data(host, "anim-state"), "rebuilding");
});

test("the engine's own state is mirrored on its events (2.5 debugState)", () => {
  const engine = fakeEngine("webgl");
  const { host, render } = setup({ engine });
  render({ presented: state.drive() });
  for (const ev of ["ready", "anim", "camera", "frame", "contextlost", "contextrestored"]) {
    assert.equal(engine.listening(ev), 1, `listens to ${ev}`);
  }
  assert.equal(data(host, "scene"), "webgl");
  assert.equal(data(host, "scene-ready"), "false");
  assert.equal(data(host, "camera"), "wide");
  engine.set({ ready: true, frames: 7, ghosts: ["run_inside", "pa_short", "dropback_short"], highlight: "pa_short",
    camera: "tight", animState: "playing", playingSeq: 12 });
  engine.emit("frame");
  assert.equal(data(host, "scene-ready"), "true");
  assert.equal(data(host, "frames"), "7");
  assert.equal(data(host, "ghosts"), "run_inside pa_short dropback_short");
  assert.equal(data(host, "ghost-highlight"), "pa_short");
  assert.equal(data(host, "camera"), "tight");
  assert.equal(data(host, "anim-state"), "playing", "the engine is still drawing");
  engine.set({ animState: "idle", highlight: null, ghosts: [] });
  engine.emit("anim");
  assert.equal(data(host, "anim-state"), "idle");
  assert.equal(data(host, "ghost-highlight"), "");
  assert.equal(data(host, "ghosts"), "");
});

test("a swapped engine is re-subscribed and sized; the old one is let go (6.2)", () => {
  const first = fakeEngine("webgl");
  const { host, render, setEngine } = setup({ engine: first });
  host.clientWidth = 960;
  host.clientHeight = 540;
  render({ presented: state.drive() });
  assert.deepEqual(first.calls.filter((c) => c[0] === "resize"), [["resize", 960, 540]]);
  const second = fakeEngine("2d");
  setEngine(second);
  render({ presented: state.drive() });
  assert.equal(first.listening("frame"), 0, "the old engine's events are ignored");
  assert.equal(second.listening("frame"), 1);
  assert.equal(data(host, "scene"), "2d");
  assert.equal(data(host, "camera"), "blimp");
  assert.deepEqual(second.calls.filter((c) => c[0] === "resize"), [["resize", 960, 540]]);
  first.set({ frames: 99 });
  first.emit("frame");
  assert.notEqual(data(host, "frames"), "99");
});

test("the host's size goes to engine.resize; a hidden tab stops the engine (3.9)", () => {
  const engine = fakeEngine();
  const { doc, host, render, ro } = setup({ engine });
  render({ presented: state.drive() });
  assert.deepEqual(ro.observed, [host]);
  ro.fire(1200, 675);
  assert.deepEqual(engine.calls.at(-1), ["resize", 1200, 675]);
  ro.fire(0, 0);
  assert.deepEqual(engine.calls.at(-1), ["resize", 1200, 675], "a collapsed host is not a size");
  doc.hidden = true;
  for (const fn of doc.listeners.get("visibilitychange") ?? []) fn({ type: "visibilitychange" });
  assert.deepEqual(engine.calls.at(-1), ["setVisible", false]);
  doc.hidden = false;
  for (const fn of doc.listeners.get("visibilitychange") ?? []) fn({ type: "visibilitychange" });
  assert.deepEqual(engine.calls.at(-1), ["setVisible", true]);
});

test("the scene error main.js writes survives every render (6.2)", () => {
  const { host, render } = setup({ engine: fakeEngine("2d") });
  host.setAttribute("data-scene-error", "WebGL context lost");
  render({ presented: state.drive() });
  render({ presented: state.final() });
  assert.equal(data(host, "scene-error"), "WebGL context lost");
});

test("an engine that throws in debugState never breaks the field's own hooks", () => {
  const engine = fakeEngine();
  engine.debugState = () => { throw new Error("lost context"); };
  const { host, render } = setup({ engine });
  render({ presented: state.drive(), anim: { drawnThrough: 5, queue: [] } });
  assert.equal(data(host, "los"), "75");
  assert.equal(data(host, "drawn-seq"), "5");
  assert.equal(data(host, "scene"), "webgl", "the kind still comes from the engine itself");
});

test("engine failures are reported, once per engine for debugState, and never stop the host", () => {
  const reported = [];
  const before = globalThis.reportError;
  globalThis.reportError = (err) => reported.push(err.message);
  try {
    const engine = fakeEngine();
    engine.resize = () => { throw new Error("resize failed"); };
    engine.debugState = () => { throw new Error("no state"); };
    const { host, render, ro } = setup({ engine });
    host.clientWidth = 800;
    host.clientHeight = 450;
    render({ presented: state.drive() });
    engine.emit("frame");
    engine.emit("frame");
    ro.fire(640, 360);
    assert.deepEqual(reported, ["resize failed", "no state", "resize failed"]);
    assert.equal(data(host, "los"), "75", "the situation hooks are still written");
  } finally {
    globalThis.reportError = before;
  }
});

test("ctx.engine() that throws is reported and the host carries on without an engine", () => {
  const reported = [];
  const before = globalThis.reportError;
  globalThis.reportError = (err) => reported.push(err.message);
  try {
    const doc = chromePage([["section", "rg-field"]]);
    const root = doc.getElementById("rg-field");
    const ctx = { actions: {}, form: {}, copy: chromeCtx().ctx.copy, engine: () => { throw new Error("engine gone"); } };
    const component = withDocument(doc, () => mount(root, ctx));
    withDocument(doc, () => component.update(fieldHostVm(makePv({ presented: state.drive() }))));
    assert.deepEqual(reported, ["engine gone"]);
    assert.equal(root.querySelector("#field").getAttribute("data-los"), "75");
    assert.equal(root.querySelector("#field").hasAttribute("data-scene"), false);
  } finally {
    globalThis.reportError = before;
  }
});

test("a render that changes nothing writes nothing", () => {
  const { doc, render } = setup({ engine: fakeEngine() });
  render({ presented: state.drive() });
  const writes = doc.writes;
  render({ presented: state.drive() });
  assert.equal(doc.writes, writes);
});

test("destroy lets go of the engine, the observer and the document", () => {
  const engine = fakeEngine();
  const { doc, root, component, render, ro } = setup({ engine });
  render({ presented: state.drive() });
  component.destroy();
  assert.equal(engine.listening("frame"), 0);
  assert.equal(ro.disconnected, true);
  assert.equal((doc.listeners.get("visibilitychange") ?? []).length, 0);
  assert.equal(root.querySelector("#field"), null);
});
