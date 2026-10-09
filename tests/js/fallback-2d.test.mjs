// field/fallback-2d.js (A6): the 2D SVG engine behind the same Engine interface as the WebGL one (2.5, 6.2).
import assert from "node:assert/strict";
import test from "node:test";

import { CAMERA_MODES, createFallbackEngine } from "../../static/js/field/fallback-2d.js";
import { buildGhostSet, ghostInputFromPred } from "../../static/js/field/ghosts.js";
import { situationFromRow } from "../../static/js/field/paths.js";
import { resolveLook } from "../../static/js/theme/look-schema.js";
import { createDocument, withDocument } from "./fake-dom.mjs";
import { capture, rowById } from "./field-rows.mjs";

const T = capture();
const row = (seq) => T.rows.find((r) => r.seq === seq);
const rows = (from, to) => T.rows.filter((r) => r.seq >= from && r.seq <= to);
const ENGINE_METHODS = ["on", "setGameFrame", "showSituation", "showGhosts", "clearGhosts", "highlightGhost", "playRow",
  "drawRowsInstant", "finishNow", "showReview", "refreshLabels", "markVerdict", "setCamera", "cameraModes", "resize",
  "setVisible", "setReducedMotion", "debugState", "dispose"];

/** A frame clock the test drives: raf queues callbacks, step(ms) advances time and runs one frame. */
function clock() {
  let t = 1000;
  let queue = [];
  let id = 0;
  return {
    raf: (fn) => { queue.push({ id: (id += 1), fn }); return id; },
    cancelRaf: (cancel) => { queue = queue.filter((q) => q.id !== cancel); },
    now: () => t,
    setTimeout: (fn) => { queue.push({ id: (id += 1), fn: () => fn() }); return id; },
    clearTimeout: (cancel) => { queue = queue.filter((q) => q.id !== cancel); },
    step(ms = 16) {
      t += ms;
      const run = queue;
      queue = [];
      for (const q of run) q.fn(t);
    },
    pending: () => queue.length,
  };
}

function setup(t, { look = {}, reducedMotion = false } = {}) {
  const doc = createDocument();
  const before = globalThis.document;
  globalThis.document = doc;
  t.after(() => { globalThis.document = before; });
  const host = doc.createElement("div");
  host.setAttribute("id", "field");
  doc.body.appendChild(host);
  const c = clock();
  const errors = [];
  const engine = createFallbackEngine(host, look, { reducedMotion, ...c, onError: (e) => errors.push(e) });
  const events = [];
  for (const ev of ["ready", "anim", "camera", "frame", "error"]) engine.on(ev, (p) => events.push([ev, p]));
  return { doc, host, engine, c, errors, events, svg: () => host.querySelector('[data-testid="field-svg"]') };
}

const layer = (s, name) => s.host.querySelector(`[data-layer="${name}"]`);
const frame = (s) => s.engine.setGameFrame(T.field, T.teams, T.team_order);
const ghostsFor = (r) => buildGhostSet(ghostInputFromPred(r.pred), situationFromRow(r));

test("the engine implements every Engine method, draws one SVG in the host, and has one camera, Top", (t) => {
  const s = setup(t);
  for (const m of ENGINE_METHODS) assert.equal(typeof s.engine[m], "function", m);
  assert.equal(s.engine.kind, "2d");
  assert.ok(s.engine.ready instanceof Promise);
  assert.ok(s.svg(), "svg[data-testid=field-svg]");
  assert.equal(s.host.querySelectorAll('[data-testid="field-svg"]').length, 1, "one field-svg for the hooks");
  assert.equal(s.svg().getAttribute("aria-hidden"), "true");
  const base = s.host.querySelector("[data-sc-fb-static]");
  assert.equal(base.getAttribute("aria-hidden"), "true");
  assert.equal(base.nextSibling, s.svg(), "the static field sits under the moving layer");
  assert.match(base.getAttribute("style"), /will-change: transform/);
  assert.deepEqual(s.engine.cameraModes(), [{ id: "top", label: "Top" }]);
  assert.deepEqual(CAMERA_MODES, [{ id: "top", label: "Top" }]);
  const d = s.engine.debugState();
  assert.equal(d.kind, "2d");
  assert.equal(d.camera, "top");
  assert.equal(d.animState, "idle");
  assert.deepEqual([d.ready, d.drawCalls, d.triangles, d.geometries, d.textures], [false, 0, 0, 0, 0]);
  assert.ok(layer(s, "field").childNodes.length > 0, "a bare field before the first frame: never blank");
});

test("setGameFrame draws the teams' field; ready resolves on the next frame", async (t) => {
  const s = setup(t);
  frame(s);
  const zones = s.host.querySelectorAll('[data-part="end-zone"]');
  assert.deepEqual([...zones].map((z) => z.getAttribute("fill")), ["#002a5c", "#bd1c36"]);
  assert.equal(s.engine.debugState().ready, false);
  s.c.step();
  await s.engine.ready;
  assert.equal(s.engine.debugState().ready, true);
  assert.equal(s.events.filter(([e]) => e === "ready").length, 1);
});

test("drawRowsInstant: the drive's earlier plays become residue, the last play stays, the ball rests after it", (t) => {
  const s = setup(t);
  frame(s);
  s.engine.drawRowsInstant(rows(1, 12));
  const residue = layer(s, "live-residue").childNodes.length;
  assert.ok(residue >= 8, `the first drive's plays are residue (${residue})`);
  const last = layer(s, "live-last").querySelector(".sc-fb-play");
  assert.equal(last.getAttribute("data-seq"), "12");
  assert.ok(layer(s, "live-ball").childNodes.length > 0, "the ball where the last play left it");
  s.engine.drawRowsInstant(rows(1, 12));
  assert.equal(layer(s, "live-residue").childNodes.length, residue, "rows already drawn are not drawn twice");
  s.engine.drawRowsInstant(rows(13, 20));
  assert.ok(layer(s, "live-residue").childNodes.length < residue, "a new drive clears the residue");
});

test("playRow with durationMs 0 draws at once and resolves completed", async (t) => {
  const s = setup(t);
  frame(s);
  const res = await s.engine.playRow(row(2), { durationMs: 0, token: 7 });
  assert.deepEqual(res, { seq: 2, token: 7, completed: true });
  assert.equal(layer(s, "live-last").querySelector(".sc-fb-play").getAttribute("data-seq"), "2");
  assert.equal(s.engine.debugState().animState, "idle");
});

test("an animated play runs frame by frame, moves the ball, then lands as the last play", async (t) => {
  const s = setup(t);
  frame(s);
  let settled = null;
  s.engine.playRow(row(81), { durationMs: 1200, token: 3 }).then((r) => { settled = r; });
  assert.equal(s.engine.debugState().animState, "playing");
  assert.equal(s.engine.debugState().playingSeq, 81);
  s.c.step(16);
  assert.ok(layer(s, "live-play").childNodes.length > 0, "the play draws in the play layer");
  assert.ok(layer(s, "live-ball").querySelector('[data-part="ball"]'), "the ball moves with it");
  for (let i = 0; i < 80 && s.c.pending(); i += 1) s.c.step(20);
  await Promise.resolve();
  assert.deepEqual(settled, { seq: 81, token: 3, completed: true });
  assert.equal(layer(s, "live-play").childNodes.length, 0);
  assert.equal(layer(s, "live-last").querySelector(".sc-fb-play").getAttribute("data-seq"), "81");
  assert.deepEqual(s.events.filter(([e]) => e === "anim").map(([, p]) => p.state), ["playing", "idle"]);
  assert.ok(s.engine.debugState().frames > 3);
});

test("an admin row (a timeout) draws nothing and leaves the ball where the last play put it", async (t) => {
  const s = setup(t);
  frame(s);
  await s.engine.playRow(row(12), { durationMs: 0, token: 1 });
  const ball = () => layer(s, "live-ball").querySelector('[data-part="ball"]');
  assert.ok(ball(), "the ball rests after the touchdown");
  const admin = T.rows.find((r) => r.kind === "admin" && r.seq > 12);
  assert.deepEqual(await s.engine.playRow(admin, { durationMs: 0, token: 2 }), { seq: admin.seq, token: 2, completed: true });
  assert.ok(ball(), "still there after the timeout");
  assert.equal(layer(s, "live-last").querySelector(".sc-fb-play").getAttribute("data-seq"), "12");
});

test("drawRowsInstant during an animation lands the running play first", async (t) => {
  const s = setup(t);
  frame(s);
  const running = s.engine.playRow(row(2), { durationMs: 2000, token: 5 });
  s.c.step(16);
  s.engine.drawRowsInstant(rows(3, 6));
  assert.deepEqual(await running, { seq: 2, token: 5, completed: true });
  assert.equal(layer(s, "live-play").childNodes.length, 0, "nothing left animating");
  assert.equal(layer(s, "live-last").querySelector(".sc-fb-play").getAttribute("data-seq"), "6");
});

test("finishNow completes the running play at once", async (t) => {
  const s = setup(t);
  frame(s);
  const done = s.engine.playRow(row(95), { durationMs: 3000, token: 1 });
  s.c.step(16);
  s.engine.finishNow();
  assert.deepEqual(await done, { seq: 95, token: 1, completed: true });
  assert.equal(s.engine.debugState().animState, "idle");
});

test("ghosts: shown before the snap, deferred while a play runs (last call wins), faint after a caller snap", async (t) => {
  const s = setup(t);
  frame(s);
  const first = row(2);
  s.engine.showSituation(situationFromRow(first));
  s.engine.showGhosts(ghostsFor(first));
  assert.deepEqual(s.engine.debugState().ghosts, ["run_inside", "pa_short", "dropback_short"]);
  const playing = s.engine.playRow(first, { durationMs: 900, token: 1 });
  assert.deepEqual(s.engine.debugState().ghosts, ["run_inside"], "after the caller's snap only the top call stays");
  s.engine.showGhosts(null);
  s.engine.showGhosts(ghostsFor(row(3)));
  assert.deepEqual(s.engine.debugState().ghosts, ["run_inside"], "deferred until the play ends");
  s.engine.finishNow();
  await playing;
  assert.deepEqual(s.engine.debugState().ghosts, ghostsFor(row(3)).shapes.map((x) => x.leaf), "the last call wins");
  s.engine.highlightGhost("pa_short");
  assert.equal(s.engine.debugState().highlight, "pa_short");
  s.engine.clearGhosts();
  assert.deepEqual(s.engine.debugState().ghosts, []);
});

test("setGameFrame clears plays, ghosts and the situation", (t) => {
  const s = setup(t);
  frame(s);
  s.engine.drawRowsInstant(rows(1, 5));
  s.engine.showSituation(situationFromRow(row(6)));
  s.engine.showGhosts(ghostsFor(row(6)));
  frame(s);
  assert.equal(layer(s, "live-last").childNodes.length, 0);
  assert.equal(layer(s, "live-residue").childNodes.length, 0);
  assert.deepEqual(s.engine.debugState().ghosts, []);
  assert.equal(s.engine.debugState().situation, null);
});

test("review replays a past row with its own ghosts over a hidden live field; null returns to live", (t) => {
  const s = setup(t, { reducedMotion: true });
  frame(s);
  s.engine.drawRowsInstant(rows(1, 30));
  const past = row(2);
  s.engine.showReview(past, ghostsFor(past));
  assert.equal(s.engine.debugState().animState, "reviewing");
  assert.equal(layer(s, "review").getAttribute("display"), null);
  assert.equal(layer(s, "live").getAttribute("display"), "none");
  assert.equal(layer(s, "review-last").querySelector(".sc-fb-play").getAttribute("data-seq"), "2");
  assert.equal(layer(s, "review-ghosts").childNodes.length, 3);
  s.engine.showReview(null, null);
  assert.equal(s.engine.debugState().animState, "idle");
  assert.equal(layer(s, "review").getAttribute("display"), "none");
  assert.equal(layer(s, "live").getAttribute("display"), null);
});

test("markVerdict puts the grade under the last play's result; refreshLabels regrades after a retag", async (t) => {
  const s = setup(t);
  frame(s);
  const snap = row(81);
  await s.engine.playRow(snap, { durationMs: 0, token: 1 });
  s.engine.markVerdict({ seq: 81, key: "miss" });
  const chip = () => layer(s, "live-tagPlay").querySelector('[data-part="verdict"]');
  assert.equal(chip().querySelector("text").textContent, "Miss");
  const retagged = { ...snap, pred: { ...snap.pred, leaf_rank: 1 } };
  s.engine.refreshLabels([retagged]);
  assert.equal(chip().querySelector("text").textContent, "Top pick");
  s.engine.markVerdict({ seq: 999, key: "top1" });
  assert.equal(chip().querySelector("text").textContent, "Top pick", "a verdict for another row changes nothing");
});

test("a hidden engine or reduced motion draws every play instantly", async (t) => {
  const s = setup(t);
  frame(s);
  s.engine.setVisible(false);
  assert.deepEqual(await s.engine.playRow(row(81), { durationMs: 2000, token: 1 }), { seq: 81, token: 1, completed: true });
  s.engine.setVisible(true);
  s.engine.setReducedMotion(true);
  assert.deepEqual(await s.engine.playRow(row(82), { durationMs: 2000, token: 2 }), { seq: 82, token: 2, completed: true });
  assert.equal(s.engine.debugState().animState, "idle");
});

test("playRow never rejects: a broken row resolves completed false and reports the error", async (t) => {
  const s = setup(t);
  frame(s);
  const res = await s.engine.playRow(null, { durationMs: 500, token: 4 });
  assert.deepEqual(res, { seq: null, token: 4, completed: false });
  assert.equal(s.errors.length, 1);
  assert.equal(s.events.filter(([e]) => e === "error").length, 1);
});

test("camera, resize, safe area and listeners", (t) => {
  const s = setup(t);
  frame(s);
  s.engine.setCamera("top");
  assert.deepEqual(s.events.filter(([e]) => e === "camera").map(([, p]) => p), [{ id: "top" }]);
  s.engine.setCamera("blimp");
  assert.equal(s.engine.debugState().camera, "top");
  s.engine.resize(800, 450);
  assert.equal(s.svg().getAttribute("viewBox"), "0 0 800 450");
  assert.equal(s.host.querySelector("[data-sc-fb-static]").getAttribute("viewBox"), "0 0 800 450");
  s.engine.resize(0, 0);
  assert.equal(s.svg().getAttribute("viewBox"), "0 0 800 450", "a zero size is ignored");
  let calls = 0;
  const off = s.engine.on("frame", () => { calls += 1; });
  s.engine.showSituation(situationFromRow(row(2)));
  off();
  s.engine.showSituation(situationFromRow(row(3)));
  assert.equal(calls, 1);
  assert.equal(typeof s.engine.on("nonsense", () => {}), "function");
});

test("a world look draws in its own style (pixel ghosts and strokes)", (t) => {
  const look = resolveLook({ ghost: { style: "pixel", fill: "#fff3d1" }, strokes: { corridor: { approx: "pixel" } } });
  const s = setup(t, { look });
  frame(s);
  s.engine.showSituation(situationFromRow(row(2)));
  s.engine.showGhosts(ghostsFor(row(2)));
  const zone = layer(s, "live-ghosts").querySelector('[data-leaf="run_inside"]');
  assert.equal(zone.querySelector("path").getAttribute("fill"), "#fff3d1");
});

test("setGameFrame's optional game: a day kickoff merges look.world.day over the look (as the WebGL engine does)", (t) => {
  const look = resolveLook({ world: { day: { field: { turf: ["#a1b2c3", "#c3b2a1"] } } } });
  const s = setup(t, { look });
  const turf = () => [...s.host.querySelectorAll('[data-part="stripes"]')].map((n) => n.getAttribute("fill"));
  s.engine.setGameFrame(T.field, T.teams, T.team_order, { light: "day" });
  assert.deepEqual(turf(), ["#a1b2c3", "#c3b2a1"]);
  s.engine.setGameFrame(T.field, T.teams, T.team_order, { light: "night" });
  assert.deepEqual(turf(), look.field.turf);
  const broken = resolveLook({ world: { day: { field: { turf: "green" } } } });
  const b = setup(t, { look: broken });
  b.engine.setGameFrame(T.field, T.teams, T.team_order, { light: "day" });
  assert.equal(b.errors.length, 1, "a day variant that doesn't validate is reported");
  assert.deepEqual([...b.host.querySelectorAll('[data-part="stripes"]')].map((n) => n.getAttribute("fill")), broken.field.turf);
});

test("dispose removes the SVG and settles a running play", async (t) => {
  const s = setup(t);
  frame(s);
  const running = s.engine.playRow(rowById("4018729802242"), { durationMs: 3000, token: 9 });
  s.c.step(16);
  s.engine.dispose();
  assert.equal(s.svg(), null);
  assert.equal(s.host.querySelector("[data-sc-fb-static]"), null, "the static field layer goes too");
  assert.deepEqual(await running, { seq: 95, token: 9, completed: false });
  assert.doesNotThrow(() => s.engine.showSituation(null));
  assert.deepEqual(await s.engine.playRow(row(3), { durationMs: 0, token: 1 }), { seq: 3, token: 1, completed: false });
});

test("withDocument works for engines created inside it", () => withDocument(createDocument(), () => {
  const host = globalThis.document.createElement("div");
  globalThis.document.body.appendChild(host);
  const engine = createFallbackEngine(host, null, { raf: () => 1, cancelRaf: () => {} });
  assert.equal(engine.kind, "2d");
  engine.dispose();
}));

test("an invalid look is reported and the neutral look draws instead", (t) => {
  const s = setup(t, { look: { version: 2 } });
  assert.equal(s.errors.length, 1);
  frame(s);
  const turf = [...s.host.querySelectorAll('[data-part="stripes"]')].map((n) => n.getAttribute("fill"));
  assert.deepEqual(turf, ["#7c8b7f", "#768579"]);
});

test("setSafeArea fits the field inside the HUD's insets; null returns to the CSS properties", (t) => {
  const s = setup(t);
  s.engine.resize(1440, 900);
  frame(s);
  const rightEnd = () => {
    const zone = [...s.host.querySelectorAll('[data-part="end-zone"]')][1];
    return Number(zone.getAttribute("x")) + Number(zone.getAttribute("width"));
  };
  assert.ok(rightEnd() > 1100, "the whole width by default");
  s.engine.setSafeArea({ top: 44, right: 456, bottom: 184 });
  assert.ok(rightEnd() <= 984, `clear of the board column: ${rightEnd()}`);
  s.engine.setSafeArea(null);
  assert.ok(rightEnd() > 1100);
});

test("a ResizeObserver on the host relayouts the field", (t) => {
  const doc = createDocument();
  const before = globalThis.document;
  globalThis.document = doc;
  t.after(() => { globalThis.document = before; });
  const host = doc.createElement("div");
  doc.body.appendChild(host);
  let callback = null;
  class FakeObserver {
    constructor(fn) { callback = fn; }
    observe() {}
    disconnect() { callback = null; }
  }
  const c = clock();
  const engine = createFallbackEngine(host, {}, { ...c, ResizeObserver: FakeObserver });
  callback([{ contentRect: { width: 640, height: 360 } }]);
  assert.equal(host.querySelector('[data-testid="field-svg"]').getAttribute("viewBox"), "0 0 640 360");
  engine.dispose();
  assert.equal(callback, null, "dispose disconnects it");
});

test("a guarded call that throws reports, emits error and keeps the engine alive", (t) => {
  const s = setup(t);
  const teams = { DAL: { get color() { throw new Error("bad team"); } } };
  assert.equal(s.engine.setGameFrame(T.field, teams, T.team_order), undefined);
  assert.equal(s.errors.length, 1);
  assert.equal(s.events.filter(([e]) => e === "error").length, 1);
  frame(s);
  assert.equal(s.host.querySelectorAll('[data-part="end-zone"]').length, 2, "still drawing");
});

test("when frames can't be requested, ready still settles on its timer", async (t) => {
  const doc = createDocument();
  const before = globalThis.document;
  globalThis.document = doc;
  t.after(() => { globalThis.document = before; });
  const host = doc.createElement("div");
  doc.body.appendChild(host);
  const c = clock();
  const errors = [];
  const engine = createFallbackEngine(host, {}, { ...c, raf: () => { throw new Error("no frames"); },
    onError: (e) => errors.push(e) });
  engine.setGameFrame(T.field, T.teams, T.team_order);
  assert.equal(errors.length, 1);
  c.step(200);
  await engine.ready;
  assert.equal(engine.debugState().ready, true);
});

test("review animates the past play when motion is on, then holds it", (t) => {
  const s = setup(t);
  frame(s);
  s.engine.showReview(row(81), ghostsFor(row(81)));
  assert.ok(layer(s, "review-play").childNodes.length > 0, "the replay draws");
  for (let i = 0; i < 300 && layer(s, "review-play").childNodes.length; i += 1) s.c.step(20);
  assert.equal(layer(s, "review-play").childNodes.length, 0);
  assert.equal(layer(s, "review-last").querySelector(".sc-fb-play").getAttribute("data-seq"), "81");
  s.engine.finishNow();
  assert.equal(s.engine.debugState().animState, "reviewing");
});

test("cleared ghosts fade out, then leave the layer", (t) => {
  const s = setup(t);
  frame(s);
  s.engine.showSituation(situationFromRow(row(2)));
  s.engine.showGhosts(ghostsFor(row(2)));
  s.engine.clearGhosts();
  const zones = layer(s, "live-ghosts").childNodes;
  assert.equal(zones.length, 3, "still there while they fade");
  assert.ok([...zones].every((z) => z.style.getPropertyValue("opacity") === "0"));
  s.c.step(400);
  assert.equal(layer(s, "live-ghosts").childNodes.length, 0);
});

test("a field that can't draw at all throws from the constructor and leaves nothing in the host", (t) => {
  const doc = createDocument();
  const before = globalThis.document;
  globalThis.document = doc;
  t.after(() => { globalThis.document = before; });
  const host = doc.createElement("div");
  doc.body.appendChild(host);
  const make = doc.createElementNS;
  doc.createElementNS = (ns, tag) => {
    const el = make(ns, tag);
    if (tag === "svg") el.style.setProperty = () => { throw new Error("no style here"); };
    return el;
  };
  assert.throws(() => createFallbackEngine(host, {}, { raf: () => 1, cancelRaf: () => {} }), /no style here/);
  assert.equal(host.childNodes.length, 0);
});
