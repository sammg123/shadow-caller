// The WebGL Engine facade (ui-architecture 2.5 and the v1.2 A5 note, section 14; package A5). A stage without WebGL
// (the real kit, camera rig and situation paint; a hand-cranked frame clock) stands in for stage.js, and spy layers
// record exactly what the facade asks of player, ghosts, overlays and residue: the contract part 2 implements.
import assert from "node:assert/strict";
import test from "node:test";
import { loadThree, lookWith } from "./three-env.mjs";
import { loadJson } from "./fixtures.mjs";

const THREE = await loadThree();
const { createEngine, EngineInitError } = await import("../../static/js/field/scene.js");
const { createKit } = await import("../../static/js/field/materials.js");
const { createCameraRig } = await import("../../static/js/field/cameras.js");
const { createLines } = await import("../../static/js/field/lines.js");
const { createLabels } = await import("../../static/js/field/labels.js");
const { ROOTS } = await import("../../static/js/field/stage.js");
const { buildGhostSet } = await import("../../static/js/field/ghosts.js");
const { buildDrawing } = await import("../../static/js/field/paths.js");

const TL = loadJson("timeline_tb_dal.json");
const row = (seq) => TL.rows.find((r) => r.seq === seq);
const DAL25 = Object.freeze({ ballX: 25, ltgX: 35, dir: 1, poss: "DAL", kind: "snap", goalToGo: false, down: 1, togo: 10 });
const GHOSTS = buildGhostSet({ leaves: [{ leaf: "run_inside", p: 0.27 }, { leaf: "pa_short", p: 0.16 },
  { leaf: "dropback_short", p: 0.14 }] }, DAL25);
const OTHER = buildGhostSet({ leaves: [{ leaf: "dropback_deep", p: 0.4 }] }, DAL25);

function fakeDoc({ webgl = true } = {}) {
  const win = { addEventListener() {}, removeEventListener() {}, setTimeout: () => 0,
    getComputedStyle: () => ({ position: "relative" }) };
  const doc = {
    defaultView: win, visibilityState: "visible", documentElement: { getAttribute: () => "dark" },
    addEventListener() {}, removeEventListener() {},
    createElement: () => ({ getContext: (k) => (k === "webgl2" && webgl ? { getExtension: () => null } : null),
      setAttribute() {}, style: {}, remove() { this.removed = true; } }),
  };
  win.document = doc;
  return doc;
}

function fakeHost(doc) {
  return { ownerDocument: doc, clientWidth: 1440, clientHeight: 900, style: {}, attrs: {}, appendChild() {},
    setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } };
}

/** stage.js without WebGL: same parts and API, frames advanced by clock.tick(ms). */
function makeFakeStage(clock) {
  return ({ host, look, world, emit }) => {
    const updaters = new Set();
    const kit = createKit(look);
    const cams = createCameraRig(look);
    const lines = createLines(look, kit);
    const roots = Object.fromEntries(ROOTS.map((n) => [n, new THREE.Group()]));
    const st = { frames: 0, visible: true, frame: null, reduced: false };
    const s = {
      THREE, host, scene: new THREE.Scene(), roots, kit, cams, lines, world, layers: null,
      labels: createLabels(look.labels, host, { doc: null }),
      get look() { return look; }, get frame() { return st.frame; },
      rig: { frames: () => st.frames, dpr: () => 1, running: () => updaters.size > 2, visible: () => st.visible,
        setVisible: (v) => { st.visible = v; }, warmUp: async () => {},
        info: () => ({ render: { calls: 21, triangles: 3000 }, memory: { geometries: 9, textures: 4 }, programs: 7, cpuMs: null }) },
      requestRender() {}, keepAlive: (fn) => { updaters.add(fn); return () => updaters.delete(fn); },
      reducedMotion: () => st.reduced, visible: () => st.visible, lights: () => ({ key: { intensity: 1 } }),
      setFrame(frame) { st.frame = frame; kit.setTeams(frame?.teams ?? {}); return Promise.resolve(); },
      resize: () => true, setSafeArea: () => true, setAmbient() {}, view: (ctx, o) => cams.view(ctx, o),
      setReducedMotion(on) { st.reduced = on; cams.setReducedMotion(on); }, draw() {}, dispose() { clock.disposed = true; },
    };
    updaters.add((dt) => cams.step(dt));
    updaters.add((dt) => lines.step(dt));
    clock.tick = async (ms, step = 16) => {
      await Promise.resolve();
      for (let t = 0; t < ms; t += step) {
        for (const fn of [...updaters]) fn(step);
        st.frames += 1;
        emit("frame", st.frames);
      }
      await Promise.resolve();
    };
    clock.stage = s;
    return s;
  };
}

/** Layers that record every call (and run a play by its plan, as part 2's player will). */
function spyLayers(log) {
  // v1.4: `shown` is a query (the data-ghosts hook), not a command: the spies don't answer it, so the hook falls back
  // to the call's own leaves.
  const record = (layer) => new Proxy({}, { get: (_, name) => (name === "shown" ? undefined
    : (...args) => { log.push([layer, name, ...args]); }) });
  return {
    residue: () => record("residue"),
    overlays: () => record("overlays"),
    ghosts: () => record("ghosts"),
    player: () => ({
      start(drawing, plan, r) {
        log.push(["player", "start", r.seq, plan.totalMs]);
        let t = 0;
        return { update: (tMs) => { t = tMs; return tMs < plan.totalMs; }, ball: () => ({ x: 30 + t / 100, y: 26.667, h: 1 }),
          finish: () => { t = plan.totalMs; log.push(["player", "finish", r.seq]); }, dispose() {} };
      },
      placeAll: (items) => log.push(["player", "placeAll", items.map((i) => i.row.seq)]),
      review: (item) => log.push(["player", "review", item?.row.seq ?? null]),
      relabel: (rows) => log.push(["player", "relabel", rows.length]),
      verdict: (v) => log.push(["player", "verdict", v.key]),
      clear: () => log.push(["player", "clear"]),
      dispose: () => log.push(["player", "dispose"]),
    }),
  };
}

async function setup({ look = {}, world = null, hooks = false, reducedMotion = false } = {}) {
  const clock = {};
  const log = [];
  const host = fakeHost(fakeDoc());
  const engine = await createEngine(host, await lookWith(look), { createStage: makeFakeStage(clock),
    layerFactories: spyLayers(log), world, hooks, reducedMotion });
  const events = [];
  for (const ev of ["ready", "anim", "camera", "frame", "warning", "error"]) {
    engine.on(ev, (p) => { if (ev !== "frame") events.push([ev, p]); });
  }
  engine.setGameFrame(TL.field, TL.teams, TL.team_order, null);
  await clock.tick(16);
  return { engine, clock, log, host, events };
}

const settled = (p) => Promise.race([p.then((v) => ({ done: v })), Promise.resolve({ pending: true })]);

test("without WebGL2 createEngine rejects with EngineInitError (main.js then starts the 2D field)", async () => {
  const host = fakeHost(fakeDoc({ webgl: false }));
  await assert.rejects(createEngine(host, await lookWith(), {}), EngineInitError);
});

test("setGameFrame: every layer cleared, rebuilding, then ready on the next frame (5.3 data-scene-ready)", async () => {
  const clock = {};
  const log = [];
  const host = fakeHost(fakeDoc());
  const engine = await createEngine(host, await lookWith(), { createStage: makeFakeStage(clock), layerFactories: spyLayers(log) });
  assert.equal(engine.kind, "webgl");
  engine.setGameFrame(TL.field, TL.teams, TL.team_order, null);
  for (const layer of ["residue", "overlays", "ghosts", "player"]) assert.ok(log.some(([l, m]) => l === layer && m === "clear"), layer);
  assert.equal(engine.debugState().animState, "rebuilding");
  assert.equal(engine.debugState().ready, false);
  await Promise.resolve();
  await clock.tick(16);
  assert.equal(engine.debugState().ready, true);
  assert.equal(engine.debugState().animState, "idle");
  await engine.ready;
  assert.equal(clock.stage.frame.field.left_team, "DAL");
});

test("playRow animates for its fitted duration and resolves with its own token (3.4)", async () => {
  const { engine, clock, log, events } = await setup();
  const p = engine.playRow(row(81), { durationMs: 1000, token: 7 });
  assert.deepEqual(log.find(([l, m]) => l === "player" && m === "start"), ["player", "start", 81, 1000]);
  assert.equal(engine.debugState().animState, "playing");
  assert.equal(engine.debugState().playingSeq, 81);
  await clock.tick(480);
  assert.equal((await settled(p)).pending, true);
  await clock.tick(560);
  assert.deepEqual(await p, { seq: 81, token: 7, completed: true });
  assert.equal(engine.debugState().animState, "idle");
  const anims = events.filter(([e]) => e === "anim").map(([, x]) => x);
  assert.deepEqual(anims.slice(-2), [{ state: "playing", seq: 81 }, { state: "idle", seq: null }]);
});

test("instant draws: durationMs 0, reduced motion and a hidden engine; a malformed row draws nothing", async () => {
  const { engine, log } = await setup();
  assert.deepEqual(await engine.playRow(row(87), { durationMs: 0, token: 1 }), { seq: 87, token: 1, completed: true });
  assert.deepEqual(log.at(-1), ["player", "placeAll", [87]]);
  engine.setVisible(false);
  assert.equal((await engine.playRow(row(81), { durationMs: 900, token: 2 })).completed, true);
  engine.setVisible(true);
  engine.setReducedMotion(true);
  assert.equal((await engine.playRow(row(81), { durationMs: 900, token: 3 })).completed, true);
  assert.equal(log.filter(([l, m]) => l === "player" && m === "start").length, 0, "nothing animated");
  assert.deepEqual(await engine.playRow({ seq: 5, kind: "play", geo: "broken" }, { durationMs: 500, token: 4 }),
    { seq: 5, token: 4, completed: true }, "no steps: nothing to animate");
  assert.deepEqual(await engine.playRow(null, { durationMs: 500, token: 5 }), { seq: null, token: 5, completed: false });
});

test("a player that throws resolves completed: false and reports an engine error (the conductor swaps in 2D)", async () => {
  const clock = {};
  const log = [];
  const layers = { ...spyLayers(log), player: () => ({ start() { throw new Error("no geometry"); }, clear() {}, dispose() {} }) };
  const engine = await createEngine(fakeHost(fakeDoc()), await lookWith(), { createStage: makeFakeStage(clock),
    layerFactories: layers });
  const errors = [];
  engine.on("error", (e) => errors.push(e.message));
  engine.setGameFrame(TL.field, TL.teams, TL.team_order);
  await clock.tick(16);
  assert.deepEqual(await engine.playRow(row(81), { durationMs: 500, token: 6 }), { seq: 81, token: 6, completed: false });
  assert.deepEqual(errors, ["no geometry"]);
  assert.equal(engine.debugState().animState, "idle");
});

test("finishNow completes the running play at once; a new play finishes the old one first", async () => {
  const { engine, clock, log } = await setup();
  const first = engine.playRow(row(81), { durationMs: 2000, token: 1 });
  await clock.tick(100);
  const second = engine.playRow(row(108), { durationMs: 2000, token: 2 });
  assert.deepEqual(await first, { seq: 81, token: 1, completed: true });
  assert.ok(log.some(([l, m, seq]) => l === "player" && m === "finish" && seq === 81));
  engine.finishNow();
  assert.deepEqual(await second, { seq: 108, token: 2, completed: true });
  assert.equal(engine.debugState().playingSeq, null);
});

test("a caller snap fades the call; ghosts shown during a play wait for it to end, and the last call wins", async () => {
  const { engine, clock, log } = await setup();
  engine.showSituation(DAL25);
  engine.showGhosts(GHOSTS);
  assert.deepEqual(engine.debugState().ghosts, ["run_inside", "pa_short", "dropback_short"]);
  const look = await lookWith();
  const p = engine.playRow(row(81), { durationMs: 500, token: 1 });
  assert.ok(log.some(([l, m, k, ms]) => l === "ghosts" && m === "fade" && k === look.ghost.afterSnapOpacity
    && ms === look.motion.ghostOutMs), "row 81 is a caller snap");
  engine.showGhosts(OTHER);
  engine.showGhosts(GHOSTS);
  engine.clearGhosts();
  assert.deepEqual(engine.debugState().ghosts, ["run_inside", "pa_short", "dropback_short"], "deferred");
  await clock.tick(600);
  await p;
  assert.deepEqual(engine.debugState().ghosts, [], "the last call (clear) applied after the play");
});

test("the camera follows the player's ball, and the resting ball lands where the play ended", async () => {
  const look = { cameras: { modes: [{ id: "tight", label: "Tight", rig: "sideline", fov: 16, height: 12, back: 34,
    follow: "ball", cut: false }], default: "tight" } };
  const { engine, clock } = await setup({ look });
  engine.showSituation({ ...DAL25, ballX: 13, ltgX: 23 });
  await clock.tick(4000);
  const before = clock.stage.cams.pose().target.x;
  const p = engine.playRow(row(81), { durationMs: 3000, token: 1 });
  await clock.tick(2000);
  assert.ok(clock.stage.cams.pose().target.x > before + 3, "tracking the ball downfield");
  await clock.tick(1100);
  await p;
  const end = buildDrawing(row(81)).ballEnd.x;
  assert.equal(clock.stage.lines.state().ball.x, end - 50);
  assert.equal(clock.stage.lines.state().ball.visible, true);
});

test("review shows a past row with its own ghosts and returns to the live call (2.2 review)", async () => {
  const { engine, log } = await setup();
  engine.showSituation(DAL25);
  engine.showGhosts(GHOSTS);
  engine.showReview(row(81), OTHER);
  const d = engine.debugState();
  assert.equal(d.animState, "reviewing");
  assert.equal(d.reviewSeq, 81);
  assert.equal(d.situation.ballX, 13, "the reviewed row's own spot");
  assert.deepEqual(d.ghosts, ["dropback_deep"]);
  assert.deepEqual(log.filter(([l, m]) => l === "player" && m === "review").at(-1), ["player", "review", 81]);
  engine.showSituation({ ...DAL25, ballX: 40, ltgX: 50 });
  assert.equal(engine.debugState().situation.ballX, 13, "live updates wait while reviewing");
  engine.showReview(null, null);
  assert.equal(engine.debugState().situation.ballX, 40);
  assert.deepEqual(engine.debugState().ghosts, ["run_inside", "pa_short", "dropback_short"]);
  assert.equal(engine.debugState().animState, "idle");
});

test("highlight, relabel, verdict and camera calls reach the layers and the rig", async () => {
  const { engine, log, events } = await setup();
  engine.highlightGhost("pa_short");
  assert.equal(engine.debugState().highlight, "pa_short");
  assert.deepEqual(log.at(-1), ["ghosts", "highlight", "pa_short"]);
  engine.highlightGhost("");
  assert.equal(engine.debugState().highlight, null);
  engine.refreshLabels([row(2), row(3)]);
  assert.ok(log.some(([l, m, n]) => l === "player" && m === "relabel" && n === 2));
  assert.ok(log.some(([l, m]) => l === "residue" && m === "relabel"));
  engine.markVerdict({ seq: 2, key: "top3" });
  assert.deepEqual(log.at(-1), ["player", "verdict", "top3"]);
  engine.setCamera("endzone");
  assert.equal(engine.debugState().camera, "endzone");
  assert.deepEqual(events.filter(([e]) => e === "camera").at(-1), ["camera", "endzone"]);
  engine.setCamera("nope");
  assert.equal(engine.debugState().camera, "endzone");
  assert.deepEqual(engine.cameraModes().map((m) => m.id), ["sideline", "endzone", "overhead"]);
  engine.drawRowsInstant([row(1), row(2), null, { seq: 9, geo: "bad" }]);
  assert.deepEqual(log.filter(([l, m]) => m === "placeAll").at(-1), ["player", "placeAll", [1, 2, 9]],
    "every row with a seq; one with nothing to draw has an empty drawing");
});

test("hooks: true writes the 5.3 hooks; by default the field host owns them", async () => {
  const quiet = await setup();
  quiet.engine.showSituation(DAL25);
  assert.equal(quiet.host.attrs["data-los"], undefined);
  const { engine, host } = await setup({ hooks: true });
  engine.showSituation(DAL25);
  assert.equal(host.attrs["data-los"], "75");
  assert.equal(host.attrs["data-ltg"], "65");
  assert.equal(host.attrs["aria-label"], "Ball on DAL 25. 1st & 10. Line to gain DAL 35.");
  assert.equal(host.attrs["data-scene-ready"], "true");
  engine.showSituation(null);
  assert.equal(host.attrs["data-los"], undefined);
  assert.equal(host.attrs["aria-label"], "DAL off the field.");
  engine.dispose();
  assert.equal(host.attrs["data-scene"], undefined, "dispose takes its hooks away");
  assert.equal(host.attrs["aria-label"], "DAL off the field.", "but leaves the label for the next engine");
});

test("world moments get a context and a tween, never run under reduced motion, and a throw is a warning", async () => {
  const calls = [];
  const world = { moments: {
    presnap: (ctx) => { calls.push(["presnap", typeof ctx.tween, Object.keys(ctx.lights)]); return ctx.tween(100, (u) => calls.push(["u", u])); },
    snap: (ctx, r) => calls.push(["snap", r.seq]),
    verdict: () => { throw new Error("moment broke"); },
    possession: (ctx, team) => calls.push(["possession", team]),
  } };
  const { engine, clock, events } = await setup({ world });
  engine.showSituation(DAL25);
  engine.showGhosts(GHOSTS);
  await clock.tick(120);
  assert.deepEqual(calls[0], ["presnap", "function", ["key"]]);
  assert.deepEqual(calls.filter(([n]) => n === "u").at(-1), ["u", 1]);
  const p = engine.playRow(row(81), { durationMs: 200, token: 1 });
  await clock.tick(250);
  await p;
  assert.ok(calls.some(([n, seq]) => n === "snap" && seq === 81));
  engine.markVerdict({ seq: 81, key: "miss" });
  assert.ok(events.some(([e, err]) => e === "warning" && err.message === "moment broke"));
  engine.showSituation({ ...DAL25, poss: "TB", dir: -1, ballX: 70, ltgX: 60 });
  assert.deepEqual(calls.at(-1), ["possession", "TB"]);
  const reduced = await setup({ world, reducedMotion: true });
  const before = calls.length;
  reduced.engine.showSituation(DAL25);
  reduced.engine.showGhosts(GHOSTS);
  assert.equal(calls.length, before, "no moments under reduced motion");
});

test("dispose finishes a running play, stops the stage and frees every layer", async () => {
  const { engine, clock, log } = await setup();
  const p = engine.playRow(row(81), { durationMs: 2000, token: 3 });
  engine.dispose();
  assert.equal((await p).completed, true);
  assert.equal(clock.disposed, true);
  for (const layer of ["residue", "overlays", "ghosts", "player"]) assert.ok(log.some(([l, m]) => l === layer && m === "dispose"));
  engine.dispose();
  engine.setGameFrame(TL.field, TL.teams, TL.team_order);
  assert.deepEqual(await engine.playRow(row(2), { durationMs: 0, token: 4 }), { seq: 2, token: 4, completed: false });
});

test("v1.4 (W1): every animated play calls the world's play moment at its start and landed when it is down", async () => {
  const calls = [];
  const world = { moments: {
    play: (ctx, r, info) => calls.push(["play", r.seq, info.durationMs > 0, typeof ctx.rig.shot]),
    landed: (ctx, r, info) => calls.push(["landed", r.seq, info.completed]),
    snap: (ctx, r) => calls.push(["snap", r.seq]),
  } };
  const { engine, clock } = await setup({ world });
  engine.showSituation(DAL25);
  const tb = TL.rows.find((r) => !r.offense_is_caller && r.kind === "play");
  const p1 = engine.playRow(tb, { durationMs: 200, token: 1 });
  await clock.tick(250);
  await p1;
  assert.deepEqual(calls, [["play", tb.seq, true, "function"], ["landed", tb.seq, true]], "the opponent's play too, no snap");
  calls.length = 0;
  const p2 = engine.playRow(row(81), { durationMs: 2000, token: 2 });
  engine.finishNow();
  await p2;
  assert.deepEqual(calls, [["snap", 81], ["play", 81, true, "function"], ["landed", 81, true]], "a hurried play lands too");
  calls.length = 0;
  await engine.playRow(row(81), { durationMs: 0, token: 3 });
  assert.deepEqual(calls, [], "instant draws are not plays the world animates");
});

test("v1.4 (W6): debugState().ball is the ball in flight while a play draws, null at rest (the e2e LOS check)", async () => {
  const { engine, clock } = await setup();
  engine.showSituation(DAL25);
  assert.equal(engine.debugState().ball, null, "no play, no ball in flight");
  const p = engine.playRow(row(81), { durationMs: 3000, token: 1 });
  await clock.tick(1000);
  const b = engine.debugState().ball;
  assert.ok(b && Number.isFinite(b.x), "the player's ball while the play draws");
  assert.deepEqual({ y: b.y, h: b.h }, { y: 26.667, h: 1 });
  assert.notEqual(engine.debugState().ball, b, "a copy each time, never the player's own object");
  await clock.tick(2100);
  await p;
  assert.equal(engine.debugState().ball, null, "the play is down");
});
