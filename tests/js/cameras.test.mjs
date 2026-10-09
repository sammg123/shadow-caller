// The camera rig (ui-architecture 2.5 cameras.js; three-recipe 6; package A5): the look's modes, poses from
// field/camera-plan.js, eased cuts, damped re-aims, a HUD safe area, ball following and temporary shots.
import assert from "node:assert/strict";
import test from "node:test";
import { loadThree, lookWith } from "./three-env.mjs";

const THREE = await loadThree();
const { createCameraRig } = await import("../../static/js/field/cameras.js");
const { toWorld } = await import("../../static/js/field/coords.js");

const DAL25 = Object.freeze({ ballX: 25, ltgX: 35, dir: 1, poss: "DAL", kind: "snap", goalToGo: false, down: 1, togo: 10 });

/** Screen pixels of a field point for the rig's camera on a width x height canvas. */
function screenOf(rig, { x, y, h = 0 }, width, height) {
  const w = toWorld(x, y, h);
  rig.camera.updateMatrixWorld();
  const v = new THREE.Vector3(w.x, w.y, w.z).project(rig.camera);
  return { px: ((v.x + 1) / 2) * width, py: ((1 - v.y) / 2) * height, z: v.z };
}

function settle(rig, ms = 5000) {
  for (let t = 0; t < ms; t += 16) if (!rig.step(16)) return t;
  return ms;
}

test("modes come from the look; the default mode is the look's; unknown ids are refused", async () => {
  const look = await lookWith();
  const rig = createCameraRig(look);
  assert.deepEqual(rig.modes(), look.cameras.modes.map(({ id, label }) => ({ id, label })));
  assert.equal(rig.mode(), look.cameras.default);
  assert.equal(rig.setMode("nope"), false);
  assert.equal(rig.mode(), look.cameras.default);
});

test("the default view keeps the line of scrimmage and the line to gain on screen", async () => {
  const rig = createCameraRig(await lookWith());
  rig.setView({ width: 1440, height: 900 });
  rig.view({ situation: DAL25 }, { instant: true });
  for (const x of [25, 35]) {
    for (const y of [0, 26.667, 53.333]) {
      const s = screenOf(rig, { x, y }, 1440, 900);
      assert.ok(s.px > 0 && s.px < 1440 && s.py > 0 && s.py < 900 && s.z < 1, `x ${x} y ${y} at ${s.px},${s.py}`);
    }
  }
});

test("a HUD panel on the right: the frame stays in the free area to its left (recipe 6.3)", async () => {
  const rig = createCameraRig(await lookWith());
  rig.setView({ width: 1440, height: 900, insets: { right: 456, top: 44, bottom: 184 } });
  rig.view({ situation: DAL25 }, { instant: true });
  assert.equal(rig.camera.view?.enabled, true);
  for (const x of [25, 35]) {
    const s = screenOf(rig, { x, y: 26.667 }, 1440, 900);
    assert.ok(s.px < 1440 - 456 && s.py > 44 && s.py < 900 - 184, `x ${x} at ${s.px},${s.py}`);
  }
  rig.setView({ width: 1440, height: 900 });
  assert.equal(rig.camera.view?.enabled ?? false, false, "no insets, no view offset");
});

test("switching modes eases over look.cameras.moveMs, and step says when it is still moving", async () => {
  const look = await lookWith({ cameras: { moveMs: 600, ease: "linear" } });
  const rig = createCameraRig(look);
  rig.setView({ width: 1440, height: 900 });
  rig.view({ situation: DAL25 }, { instant: true });
  const start = rig.camera.position.clone();
  assert.equal(rig.setMode("endzone"), true);
  assert.equal(rig.step(300), true);
  const mid = rig.camera.position.clone();
  assert.ok(mid.distanceTo(start) > 1, "it moved");
  rig.step(400);
  const arrived = rig.camera.position.clone();
  assert.ok(settle(rig) < 5000);
  assert.ok(arrived.distanceTo(rig.camera.position) < 0.01, "the tween ends on the live pose");
  assert.equal(rig.step(16), false, "idle once settled");
});

test("a cut mode, an instant switch and reduced motion all land at once", async () => {
  const look = await lookWith();
  const rig = createCameraRig(look);
  rig.setView({ width: 1440, height: 900 });
  rig.view({ situation: DAL25 }, { instant: true });
  rig.setMode("overhead");                       // the neutral look's overhead mode has cut: true
  assert.equal(rig.step(0), false);
  rig.setMode("sideline", { instant: true });
  assert.equal(rig.step(0), false);
  rig.setReducedMotion(true);
  rig.setMode("endzone");
  assert.equal(rig.step(0), false);
});

test("re-aiming at a new situation glides (damped) and settles", async () => {
  const rig = createCameraRig(await lookWith());
  rig.setView({ width: 1440, height: 900 });
  rig.view({ situation: DAL25 }, { instant: true });
  const before = rig.pose().target.x;
  rig.view({ situation: { ...DAL25, ballX: 60, ltgX: 70 } });
  assert.equal(rig.step(16), true);
  const t = settle(rig);
  assert.ok(t > 100 && t < 5000, `settled in ${t} ms`);
  assert.ok(rig.pose().target.x > before + 20);
});

test("a ball-following mode tracks rig.follow(ball); shot() overrides the mode without changing it", async () => {
  const look = await lookWith({ cameras: { modes: [
    { id: "wide", label: "Wide", rig: "sideline", fov: 20, height: 40, back: 80, follow: "none", cut: false },
    { id: "tight", label: "Tight", rig: "sideline", fov: 16, height: 12, back: 34, follow: "ball", cut: false },
  ], default: "wide" } });
  const rig = createCameraRig(look);
  rig.setView({ width: 1440, height: 900 });
  rig.view({ situation: DAL25 }, { instant: true });
  rig.shot("tight", { instant: true });
  assert.equal(rig.mode(), "wide");
  assert.equal(rig.activeMode(), "tight");
  rig.follow({ x: 70, y: 26.667, h: 0 });
  settle(rig);
  const s = screenOf(rig, { x: 70, y: 26.667 }, 1440, 900);
  assert.ok(Math.abs(s.px - 720) < 200, `the ball is near the middle: ${s.px}`);
  rig.follow(null);
  rig.shot(null);
  assert.equal(rig.activeMode(), "wide");
  assert.equal(rig.shot("nope"), false);
});

test("no situation frames the whole field; the pose is plain data", async () => {
  const rig = createCameraRig(await lookWith());
  rig.setView({ width: 1920, height: 1080 });
  rig.view({ situation: null }, { instant: true });
  for (const x of [-10, 110]) {
    const s = screenOf(rig, { x, y: 26.667 }, 1920, 1080);
    assert.ok(s.px >= 0 && s.px <= 1920, `end line ${x} at ${s.px}`);
  }
  const p = rig.pose();
  assert.deepEqual(Object.keys(p).sort(), ["fov", "position", "target", "up"]);
  rig.dispose();
});
