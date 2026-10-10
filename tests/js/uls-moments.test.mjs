// Under the Lights: the moments and what they drive (owner W1; DESIGN.md motion grammar: "Light dip (20%, 300 ms)",
// "Camera by altitude"; surface brief #3, #4; ui-architecture.md 2.7, 14.6, 21).
import assert from "node:assert/strict";
import test from "node:test";
import { loadThree } from "./three-env.mjs";
import { loadTimeline } from "./fixtures.mjs";

const THREE = await loadThree();
const { createDim, isStadiumLight } = await import("../../static/js/theme/worlds/under-the-lights/stadium/dim.js");
const { createChoreo } = await import("../../static/js/theme/worlds/under-the-lights/stadium/choreo.js");
const { DRIFT, driftAngle, driftFrame, dollyPose, yawPose } = await import("../../static/js/theme/worlds/under-the-lights/stadium/drift.js");
const { moments } = await import("../../static/js/theme/worlds/under-the-lights/moments.js");
const { STADIUM } = await import("../../static/js/theme/worlds/under-the-lights/props.js");
const { buildGhostSet } = await import("../../static/js/field/ghosts.js");

const TL = loadTimeline();
const light = (name, intensity) => Object.assign(new THREE.SpotLight(0xffffff, intensity), { name });
const pose = (z, fov = 20) => ({ position: { x: 0, y: 40, z }, target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, fov });

/** A stand-in camera rig: the shot it was told, the pose it reports, the viewer's mode. */
function fakeRig(mode = "wide") {
  const calls = [];
  const st = { shot: null, pose: pose(120) };
  return { calls, st, mode: () => mode, shot(id, opts) { calls.push([id, opts?.instant === true]); st.shot = id;
    st.pose = id === "tight" ? pose(80, 18) : id === "blimp" ? pose(250, 30) : pose(120); return true; },
  pose: () => structuredClone(st.pose) };
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

test("the choreography takes the shot at once in the rig and blends the camera there on its own clock", () => {
  const rig = fakeRig();
  const camera = new THREE.PerspectiveCamera(20, 16 / 9, 0.5, 1500);
  const c = createChoreo({ timing: { pushMs: 600, settleMs: 900 } });
  c.attach({ rig, camera });
  c.play(TL.row(2), { viewerMode: "wide", watch: false });
  assert.deepEqual(rig.calls, [["tight", true]]);
  assert.equal(c.update(300), true);
  assert.ok(camera.position.z < 120 && camera.position.z > 80, `half way: ${camera.position.z}`);
  assert.equal(c.update(400), false);
  assert.ok(Math.abs(camera.position.z - 80) < 1e-6);
  assert.equal(c.update(16), false, "at rest the rig owns the camera again");
  c.landed(TL.row(2), { viewerMode: "wide", watch: false });
  assert.deepEqual(rig.calls.at(-1), [null, true]);
  assert.deepEqual(c.state(), { shot: null, drifting: false });
});

test("in Watch this game a finished drive rises to the blimp and drifts; reduced motion drops the shot at once", () => {
  const rig = fakeRig();
  const camera = new THREE.PerspectiveCamera();
  let reduced = false;
  const c = createChoreo({ timing: { riseMs: 1000 }, reduced: () => reduced });
  c.attach({ rig, camera });
  c.landed(TL.row(43), { viewerMode: "wide", watch: true });   // a punt ends the drive (a score would hold first)
  assert.deepEqual(c.state(), { shot: "blimp", drifting: true });
  for (let i = 0; i < 100; i += 1) c.update(50);
  assert.ok(Math.hypot(camera.position.x, camera.position.y, camera.position.z - 0) > 300, "eased out to the whole bowl");
  assert.ok(Math.abs(camera.position.x) > 1, "turned about the field's middle");
  reduced = true;
  c.update(16);
  assert.deepEqual(rig.calls.at(-1), [null, true]);
  assert.deepEqual(c.state(), { shot: null, drifting: false });
});

/** A hand-cranked timer queue for the choreography's hold (schedule / cancel). */
function fakeTimers() {
  const list = [];
  return { list, live: () => list.filter((t) => t.live),
    schedule: (fn, ms) => { list.push({ fn, ms, live: true }); return list.length - 1; },
    cancel: (id) => { if (list[id]) list[id].live = false; },
    fire() { const t = list.filter((x) => x.live).at(-1); t.live = false; t.fn(); } };
}

test("G3-4: in Watch a touchdown holds the camera on the play for holdScoreMs, then it rises to the blimp", () => {
  const rig = fakeRig();
  const camera = new THREE.PerspectiveCamera(20, 16 / 9, 0.5, 1500);
  const timers = fakeTimers();
  let renders = 0;
  const c = createChoreo({ timing: { pushMs: 600, riseMs: 1000, holdScoreMs: 2000 }, schedule: timers.schedule,
    cancel: timers.cancel, requestRender: () => { renders += 1; } });
  const watch = { viewerMode: "wide", watch: true };
  c.attach({ rig, camera });
  c.play(TL.row(12), watch);
  for (let i = 0; i < 20; i += 1) c.update(50);
  assert.ok(Math.abs(camera.position.z - 80) < 1e-6, "pushed in to tight on the touchdown run");
  c.landed(TL.row(12), watch);
  assert.deepEqual(timers.live().map((t) => t.ms), [2000], "the rise waits holdScoreMs");
  assert.deepEqual(rig.calls.at(-1), ["tight", true], "the rig keeps its shot during the hold");
  rig.st.pose = pose(140);                     // the rig lets go of the ball and starts to glide away meanwhile
  assert.equal(c.update(16), false, "a held camera needs no frames of its own");
  assert.ok(Math.abs(camera.position.z - 80) < 1e-6, "held on the end zone, not gliding");
  const before = renders;
  timers.fire();
  assert.ok(renders > before, "the rise asks for frames");
  assert.deepEqual(rig.calls.at(-1), ["blimp", true]);
  assert.deepEqual(c.state(), { shot: "blimp", drifting: true });
  assert.equal(c.update(500), true);
  assert.ok(camera.position.z > 80 && camera.position.z < 250, `rising from where it held: ${camera.position.z}`);
});

test("G3-4: a new play or reduced motion during the hold cancels it; a field goal never holds", () => {
  const rig = fakeRig();
  const camera = new THREE.PerspectiveCamera();
  const timers = fakeTimers();
  let reduced = false;
  const c = createChoreo({ timing: { holdScoreMs: 2000 }, schedule: timers.schedule, cancel: timers.cancel,
    reduced: () => reduced });
  const watch = { viewerMode: "wide", watch: true };
  c.attach({ rig, camera });
  c.landed(TL.row(104), watch);                // the interception: held
  assert.equal(timers.live().length, 1);
  c.play(TL.row(1), watch);                    // the next play (a kickoff) comes before the hold is over
  assert.equal(timers.live().length, 0, "cancelled");
  assert.deepEqual(rig.calls.at(-1), ["blimp", true], "the kickoff rises from where the camera held");
  c.presnap(watch);                            // back down to wide for the next call
  c.landed(TL.row(87), watch);                 // a field goal ends the drive: up at once, no hold
  assert.equal(timers.live().length, 0);
  assert.deepEqual(c.state(), { shot: "blimp", drifting: true });
  c.presnap(watch);
  c.landed(TL.row(12), watch);                 // a touchdown: held
  assert.equal(timers.live().length, 1);
  reduced = true;
  c.update(16);
  assert.equal(timers.live().length, 0, "reduced motion drops the hold");
  assert.deepEqual(c.state(), { shot: null, drifting: false });
});

test("the drift: at most degPerS, to maxDeg, out to an establishing shot aimed past the field; the target holds", () => {
  const t = DRIFT;
  let prev = 0;
  let fastest = 0;
  for (let ms = 100; ms <= 20000; ms += 100) {
    const a = driftAngle(ms, t);
    fastest = Math.max(fastest, ((a.rad - prev) * 180) / Math.PI / 0.1);
    prev = a.rad;
  }
  assert.ok(fastest <= t.driftDegPerS + 0.01 && fastest <= 3, `fastest ${fastest} deg/s`);
  assert.ok(Math.abs((prev * 180) / Math.PI - t.driftMaxDeg) < 1e-6);
  assert.equal(driftAngle(20000, t).moving, false);
  assert.equal(driftAngle(0, t).k, 0, "it starts exactly at the blimp (no jump)");
  const blimp = { position: { x: 0, y: 230, z: 108 }, target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0.9, z: -0.42 }, fov: 30 };
  const est = driftFrame(blimp, t);
  assert.ok(est.target.z < -t.driftLiftYd + 0.01, "aimed past the field's middle, away from the camera");
  const pitch = (Math.atan2(est.position.y - est.target.y, Math.hypot(est.position.x - est.target.x,
    est.position.z - est.target.z)) * 180) / Math.PI;
  assert.ok(Math.abs(pitch - t.driftPitchDeg) < 1e-6);
  const p = yawPose(dollyPose(pose(100), 1.5), Math.PI / 2);
  assert.deepEqual(p.target, { x: 0, y: 0, z: 0 });
  assert.ok(Math.abs(p.position.x + 150) < 1e-9 && Math.abs(p.position.z) < 1e-9);
  assert.equal(p.position.y, 60);
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
    choreo: { attach: () => {}, play: rec("play"), landed: rec("landed"), presnap: rec("presnap") },
    ribbons: { show: (id, msg) => { on[id] = msg; calls.push(["show", id, msg.kind]); },
      revise: (id) => calls.push(["revise", id]), message: (id) => on[id] ?? null, drop: (id) => calls.push(["drop", id]),
      queue: (id, msg, dwellMs) => { on[id] = msg; calls.push(["queue", id, msg.kind, dwellMs]); } } };
  scene.add(g);
  return { calls, ctx: { scene, rig: fakeRig(mode), camera: new THREE.PerspectiveCamera(), lights: {}, requestRender: () => {} } };
}

test("the moments: presnap dips and brings the camera back; the snap and every play bring the lights up", () => {
  const { calls, ctx } = stage();
  moments.presnap(ctx, {});
  assert.deepEqual(calls, [["presnap"], ["dim", 0.8, 300]], "no app in node: the dip setting defaults to on");
  calls.length = 0;
  moments.snap(ctx, TL.row(2));
  moments.play(ctx, TL.row(2));
  assert.deepEqual(calls, [["dim", 1, 300], ["dim", 1, 300], ["play"], ["drop", "A"]]);
});

test("landed steps the play's words onto the ribbons; a touchdown on both; the grade joins the caller's words", () => {
  const { calls, ctx } = stage();
  moments.landed(ctx, TL.row(3));
  assert.deepEqual(calls, [["landed"], ["show", "A", "play"]]);
  moments.verdict(ctx, { seq: 3, key: "top3" });
  assert.deepEqual(calls.at(-1), ["revise", "A"]);
  calls.length = 0;
  moments.verdict(ctx, { seq: 99, key: "miss" });
  assert.deepEqual(calls, [], "a grade for another play changes nothing");
  moments.landed(ctx, TL.row(12));
  assert.deepEqual(calls.slice(1), [["show", "A", "td"], ["show", "B", "td"], ["flare", 1.15, 300]]);
});

const D46 = Object.freeze({ ballX: 46, ltgX: 56, dir: 1, poss: "DAL", kind: "snap", goalToGo: false, down: 1, togo: 10 });
const NEXT = buildGhostSet({ leaves: [{ leaf: "run_inside", p: 0.24 }, { leaf: "pa_short", p: 0.16 }] }, D46);

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
  for (const name of ["presnap", "snap", "play", "landed", "verdict", "possession"]) {
    assert.doesNotThrow(() => moments[name](ctx, TL.row(2)));
  }
  assert.doesNotThrow(() => moments.presnap(null));
});
