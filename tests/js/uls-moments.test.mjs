// Under the Lights: the moments and what they drive (owner W1, the camera by the home frame; DESIGN.md motion grammar:
// "Light dip (20%, 300 ms)"; surface brief #4; ui-architecture.md 2.7, 14.6, 21; restructure-v2.md 4: the camera is
// the viewer's alone, so no moment moves it).
import assert from "node:assert/strict";
import test from "node:test";
import { loadThree } from "./three-env.mjs";
import { loadTimeline } from "./fixtures.mjs";

const THREE = await loadThree();
const { createDim, isStadiumLight } = await import("../../static/js/theme/worlds/under-the-lights/stadium/dim.js");
const { moments } = await import("../../static/js/theme/worlds/under-the-lights/moments.js");
const { STADIUM } = await import("../../static/js/theme/worlds/under-the-lights/props.js");
const { gameMessage, idleMessage, plainMessage, textOf } =
  await import("../../static/js/theme/worlds/under-the-lights/stadium/messages.js");
const { buildGhostSet } = await import("../../static/js/field/ghosts.js");

const TL = loadTimeline();
const light = (name, intensity) => Object.assign(new THREE.SpotLight(0xffffff, intensity), { name });
const pose = (z, fov = 20) => ({ position: { x: 0, y: 40, z }, target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, fov });

/** A stand-in camera rig: records every shot it is told and every pose it is handed (none, now). */
function fakeRig(mode = "wide") {
  const calls = [];
  return { calls, mode: () => mode, shot: (id, opts) => { calls.push(["shot", id, opts ?? null]); return true; },
    setPose: (p) => calls.push(["setPose", p]), pose: () => pose(120) };
}

test("the dip: the towers' spots, lamps, shafts, stands and crowd fall to 80% and come back; the sky stays", () => {
  const levels = [];
  const crowd = { material: { color: new THREE.Color(1, 1, 1) } };
  const dim = createDim({ lamps: { setLevel: (k) => levels.push(["lamps", k]) }, crowd,
    stands: { setLevel: (k) => levels.push(["stands", k]) } });
  const lights = { "tower-home-left": light("tower-home-left", 30000), sky: light("sky", 0.24) };
  assert.equal(isStadiumLight(lights.sky), false);
  dim.to(0.8, 300, lights);
  assert.equal(dim.update(150), true);
  assert.equal(dim.update(160), false);
  assert.equal(lights["tower-home-left"].intensity, 24000);
  assert.equal(lights.sky.intensity, 0.24);
  assert.ok(Math.abs(crowd.material.color.r - 0.8) < 1e-9);
  assert.deepEqual(levels.at(-1), ["stands", 0.8]);
  dim.to(1, 300, lights);
  dim.update(100);
  dim.to(0.8, 0, lights);
  assert.equal(lights["tower-home-left"].intensity, 24000, "a new target turns it round from where it is; 0 ms is at once");
  dim.restore();
  assert.equal(lights["tower-home-left"].intensity, 30000);
});

/** A scene holding a stand-in stadium whose parts record what the moments ask of them. */
function stage(mode = "wide") {
  const calls = [];
  const scene = new THREE.Scene();
  const g = new THREE.Group();
  g.name = STADIUM;
  const rec = (name) => (...args) => calls.push([name, ...args.filter((a) => typeof a !== "object" || a === null)]);
  const on = {};
  g.userData.uls = { dip: { level: 0.8, ms: 300 }, frame: { teams: TL.body.teams, field: TL.body.field, teamOrder: ["TB", "DAL"] },
    dim: { to: rec("dim"), flare: rec("flare") },
    ribbons: { show: (id, msg) => { on[id] = msg; calls.push(["show", id, msg.kind]); },
      revise: (id) => calls.push(["revise", id]), message: (id) => on[id] ?? null, drop: (id) => calls.push(["drop", id]),
      queue: (id, msg, dwellMs) => { on[id] = msg; calls.push(["queue", id, msg.kind, dwellMs]); } } };
  scene.add(g);
  return { calls, ctx: { scene, rig: fakeRig(mode), camera: new THREE.PerspectiveCamera(), lights: {}, requestRender: () => {} } };
}

const D46 = Object.freeze({ ballX: 46, ltgX: 56, dir: 1, poss: "DAL", kind: "snap", goalToGo: false, down: 1, togo: 10 });
const NEXT = buildGhostSet({ leaves: [{ leaf: "run_inside", p: 0.24 }, { leaf: "pa_short", p: 0.16 }] }, D46);

test("the moments: presnap dips; the snap and every play bring the lights up", () => {
  const { calls, ctx } = stage();
  moments.presnap(ctx, {});
  assert.deepEqual(calls, [["dim", 0.8, 300]], "no app in node: the dip setting defaults to on");
  calls.length = 0;
  moments.snap(ctx, TL.row(2));
  moments.play(ctx, TL.row(2));
  assert.deepEqual(calls, [["dim", 1, 300], ["dim", 1, 300], ["drop", "A"]]);
});

test("restructure-v2.md 4: no moment moves the camera, in a live game or a watched one, in either view", () => {
  for (const mode of ["wide", "blimp"]) {
    for (const appMode of ["feed", "watch"]) {
      const { ctx } = stage(mode);
      const before = ctx.camera.position.clone();
      const app = { getAttribute: (name) => (name === "data-mode" ? appMode : null) };
      const had = Object.hasOwn(globalThis, "document");
      const prior = globalThis.document;
      globalThis.document = { getElementById: (id) => (id === "app" ? app : null) };
      try {
        moments.presnap(ctx, NEXT);
        moments.snap(ctx, TL.row(2));
        moments.play(ctx, TL.row(2));
        moments.landed(ctx, TL.row(12));
        moments.verdict(ctx, { seq: 12, key: "top1" });
        moments.possession(ctx, "TB");
        moments.placed(ctx, [TL.row(12)]);
      } finally {
        if (had) globalThis.document = prior;
        else delete globalThis.document;
      }
      assert.deepEqual(ctx.rig.calls, [], `${mode}, ${appMode}: the rig was never told a shot`);
      assert.ok(ctx.camera.position.equals(before), `${mode}, ${appMode}: the camera never moved`);
    }
  }
});

test("landed steps the play's words onto the ribbons; a touchdown on both; the grade joins the caller's words", () => {
  const { calls, ctx } = stage();
  moments.landed(ctx, TL.row(3));
  assert.deepEqual(calls, [["show", "A", "play"]]);
  moments.verdict(ctx, { seq: 3, key: "top3" });
  assert.deepEqual(calls.at(-1), ["revise", "A"]);
  calls.length = 0;
  moments.verdict(ctx, { seq: 99, key: "miss" });
  assert.deepEqual(calls, [], "a grade for another play changes nothing");
  moments.landed(ctx, TL.row(12));
  assert.deepEqual(calls, [["show", "A", "td"], ["show", "B", "td"], ["flare", 1.15, 300]]);
});

test("G3-6: presnap puts the next call on the field-wall ribbon after the play's words; the snap drops a queued one", () => {
  const { calls, ctx } = stage();
  moments.landed(ctx, TL.row(4));
  calls.length = 0;
  moments.presnap(ctx, NEXT);
  assert.deepEqual(calls.filter((c) => c[0] === "queue"), [["queue", "A", "call", 1500]],
    "queued behind the play's words for 1.5 s (they have their moment first)");
  calls.length = 0;
  moments.play(ctx, TL.row(5));
  assert.deepEqual(calls.at(-1), ["drop", "A"], "a call still waiting when the ball is snapped is dropped");
  moments.landed(ctx, TL.row(5));
  assert.deepEqual(calls.at(-1), ["show", "A", "play"], "the play's words again once it is down");
});

/** What a ribbon of the stand-in stadium says now (its words). */
const said = (ctx, id) => textOf(ctx.scene.getObjectByName(STADIUM).userData.uls.ribbons.message(id));
const frameOf = (ctx) => ctx.scene.getObjectByName(STADIUM).userData.uls.frame;

test("restructure-v2.md 5: rows drawn at once (a jump) never leave a call that is gone on the ribbon", () => {
  const { calls, ctx } = stage();
  moments.landed(ctx, TL.row(4));
  moments.presnap(ctx, NEXT);                     // his call is up: the lights dipped, NEXT CALL on the field wall
  calls.length = 0;
  moments.placed(ctx, [TL.row(5), TL.row(6), TL.row(13)]);
  assert.deepEqual(calls.slice(0, 3), [["dim", 1, 300], ["drop", "A"], ["show", "A", "play"]],
    "the lights come up and the call goes: no snap or play moment will come to do it");
  assert.equal(said(ctx, "A"), textOf(plainMessage(TL.row(6))), "the newest play's words (13 is an admin row)");
  assert.equal(said(ctx, "B"), textOf(gameMessage(frameOf(ctx))), "the upper ribbon rests on the game");
  calls.length = 0;
  moments.placed(ctx, [TL.row(6)]);
  assert.deepEqual(calls, [["dim", 1, 300], ["drop", "A"]], "the same words again: no second step-in");
  moments.placed(ctx, []);
  assert.equal(said(ctx, "A"), textOf(idleMessage()), "a jump to kickoff (nothing drawn): the title");
});

test("restructure-v2.md 5: an admin row drawn at once (a timeout between his snaps) keeps the call and the dip", () => {
  const { calls, ctx } = stage();
  moments.presnap(ctx, NEXT);
  calls.length = 0;
  moments.placed(ctx, [TL.row(13)]);
  assert.deepEqual(calls, []);
});

test("G3-6: a late grade never pushes the next call off the ribbon (the HUD's ribbon carries it)", () => {
  const { calls, ctx } = stage();
  moments.landed(ctx, TL.row(4));
  moments.presnap(ctx, NEXT);
  calls.length = 0;
  moments.verdict(ctx, { seq: 4, key: "top3" });
  assert.deepEqual(calls.filter((c) => c[0] === "revise"), [], "the call stays up");
});

test("G3-7: the lamp banks flare when he is right (TOP PICK) or on a touchdown; never for a miss or a plain play", () => {
  const { calls, ctx } = stage();
  moments.landed(ctx, TL.row(3));
  calls.length = 0;
  moments.verdict(ctx, { seq: 3, key: "top1" });
  assert.deepEqual(calls.filter((c) => c[0] === "flare"), [["flare", 1.15, 300]]);
  calls.length = 0;
  moments.verdict(ctx, { seq: 3, key: "miss" });
  moments.verdict(ctx, { seq: 3, key: "top3" });
  moments.landed(ctx, TL.row(5));
  assert.deepEqual(calls.filter((c) => c[0] === "flare"), []);
  moments.landed(ctx, TL.row(35));
  assert.deepEqual(calls.filter((c) => c[0] === "flare"), [["flare", 1.15, 300]], "the opponent's touchdown too");
});

test("G3-7: a flare lifts the lamps to x1.15 and back in 300 ms, above the dip's 80%, and leaves the dip alone", () => {
  const lamps = [];
  const shafts = [];
  const stands = [];
  const dim = createDim({ lamps: { setLevel: (k) => lamps.push(k) }, shafts: { setLevel: (k) => shafts.push(k) },
    stands: { setLevel: (k) => stands.push(k) } });
  const lights = { "tower-home-left": light("tower-home-left", 30000) };
  dim.to(0.8, 0, lights);                       // the presnap dip, at once
  lamps.length = 0;
  dim.flare(1.15, 300);
  const frames = [];
  for (let t = 0; t < 400; t += 16) frames.push(dim.update(16));
  const peak = Math.max(...lamps);
  assert.ok(peak > 1.1 && peak <= 1.15 + 1e-9, `the lamps peak near x1.15: ${peak}`);
  assert.ok(lamps.some((k) => k > 0.8 + 0.1), "a frame where the lamps sit above the pre-snap dip level");
  assert.ok(Math.abs(lamps.at(-1) - 0.8) < 1e-9, "then back to the dip");
  assert.equal(frames.at(-1), false, "and the loop may stop");
  assert.ok(frames.filter(Boolean).length >= 15 && frames.filter(Boolean).length <= 20, "about 300 ms of frames");
  assert.deepEqual(shafts.slice(-lamps.length), lamps.map((k) => Math.min(1, k)),
    "the lamps' beams in the haze rise with them, up to full (DESIGN.md: at most 6%)");
  assert.equal(lights["tower-home-left"].intensity, 24000, "the spots keep the dip: the field never flashes");
  assert.ok(stands.every((k) => Math.abs(k - 0.8) < 1e-9));
  dim.flare(1.15, 0);
  assert.equal(dim.update(16), false, "no flare without time (reduced motion never asks for one)");
  dim.flare(1.15, 300);
  dim.update(100);
  dim.restore();
  assert.equal(lamps.at(-1), 1, "restore clears a flare");
});

test("G3-6: while a new game frame's stadium is built beside the old one, the moments go to the new one", () => {
  const old = stage();
  const fresh = stage();
  const stadium = fresh.ctx.scene.getObjectByName(STADIUM);
  stadium.visible = false;                             // built hidden; the swap shows it and frees the old one
  old.ctx.scene.add(stadium);
  moments.presnap(old.ctx, NEXT);
  assert.deepEqual(old.calls.filter((c) => c[0] === "queue"), [], "not the stadium on its way out");
  assert.deepEqual(fresh.calls.filter((c) => c[0] === "queue"), [["queue", "A", "call", 1500]]);
});

test("without a stadium (another world's props, or none) the moments do nothing and never throw", () => {
  const ctx = { scene: new THREE.Scene(), rig: fakeRig(), lights: {}, requestRender: () => {} };
  for (const name of ["presnap", "snap", "play", "landed", "verdict", "possession", "placed"]) {
    assert.doesNotThrow(() => moments[name](ctx, TL.row(2)));
  }
  assert.doesNotThrow(() => moments.presnap(null));
});
