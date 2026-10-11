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

test("restructure-v2.md 4: Wide follows the ball sideways while a play runs, never closer, then settles back", async () => {
  const look = await lookWith({ cameras: { modes: [
    { id: "wide", label: "Wide", rig: "sideline", fov: 20, height: 38, back: 82, follow: "pan", cut: false },
    { id: "blimp", label: "Blimp", rig: "blimp", fov: 30, height: 300, back: 140, follow: "none", cut: false },
  ], default: "wide" } });
  const rig = createCameraRig(look);
  rig.setView({ width: 1440, height: 900 });
  rig.view({ situation: DAL25 }, { instant: true });
  const rest = rig.pose();
  rig.follow({ x: 95, y: 26.667, h: 0 });
  settle(rig);
  const panned = rig.pose();
  const s = screenOf(rig, { x: 95, y: 26.667 }, 1440, 900);
  assert.ok(s.px > 0 && s.px < 1440, `the ball stays on screen: ${s.px}`);
  assert.ok(panned.target.x > rest.target.x + 20, "the camera slid along the field");
  assert.ok(Math.abs(panned.fov - rest.fov) < 1e-6, "no zoom");
  const dist = (p) => Math.hypot(p.position.x - p.target.x, p.position.y - p.target.y, p.position.z - p.target.z);
  assert.ok(Math.abs(dist(panned) - dist(rest)) < 0.5, "no push-in");
  rig.follow(null);
  settle(rig);
  assert.ok(Math.abs(rig.pose().target.x - rest.target.x) < 0.5, "the play is down: back to the situation's frame");
});

// G2-2: a reviewed play is framed whole, its line of scrimmage and its end, in the free part of the canvas
const { buildDrawing, situationFromRow } = await import("../../static/js/field/paths.js");
const { loadJson } = await import("./fixtures.mjs");
const TL_ROWS = loadJson("timeline_tb_dal.json").rows;
const rowOf = (seq) => TL_ROWS.find((r) => r.seq === seq);
const HUD = Object.freeze({ right: 456, top: 96, bottom: 184 });     // Under the Lights at 1440x900: the board, the band

/** Is the field point inside the free area (the canvas minus the HUD insets) for the rig's camera? */
function inFreeArea(rig, pt, { width = 1440, height = 900, insets = HUD } = {}) {
  const s = screenOf(rig, pt, width, height);
  return s.px >= (insets.left ?? 0) && s.px <= width - (insets.right ?? 0) && s.py >= (insets.top ?? 0)
    && s.py <= height - (insets.bottom ?? 0) && s.z < 1;
}

const { default: ULS_LOOK } = await import("../../static/js/theme/worlds/under-the-lights/look.js");
const VIEWS = Object.freeze([
  { width: 1440, height: 900, insets: HUD },
  { width: 1920, height: 1080, insets: { right: 624, top: 120, bottom: 240 } },   // the same HUD on the TV
]);

for (const seq of [81, 95, 108, 43, 87]) {
  test(`reviewing seq ${seq}: the line of scrimmage and the whole play stay in the free area (G2-2)`, async () => {
    const row = rowOf(seq);
    const drawing = buildDrawing(row);
    const sit = situationFromRow(row);
    const b = drawing.bounds;
    const pts = [{ x: sit.ballX, y: 26.667 }, { x: b.x0, y: b.y0 }, { x: b.x1, y: b.y1 }, drawing.label.at];
    for (const [name, look] of [["neutral", await lookWith()], ["under-the-lights", await lookWith(ULS_LOOK)]]) {
      for (const view of VIEWS) {
        const rig = createCameraRig(look);
        rig.setView(view);
        rig.view({ situation: sit, reviewDrawing: drawing }, { instant: true });
        for (const pt of pts) {
          assert.ok(inFreeArea(rig, pt, view), `${name} ${view.width}: seq ${seq} (${pt.x}, ${pt.y}) is off the free area`);
        }
      }
    }
  });
}

test("the live view ignores nothing it had: with no reviewed play the pose is the situation's alone (G2-2)", async () => {
  const look = await lookWith();
  const plain = createCameraRig(look);
  const withNull = createCameraRig(look);
  for (const rig of [plain, withNull]) rig.setView({ width: 1440, height: 900, insets: HUD });
  plain.view({ situation: DAL25 }, { instant: true });
  withNull.view({ situation: DAL25, reviewDrawing: null }, { instant: true });
  assert.deepEqual(withNull.pose(), plain.pose());
});

test("a reviewed row that draws nothing (no spot) leaves the situation's frame alone (G2-2)", async () => {
  const look = await lookWith();
  const a = createCameraRig(look);
  const b = createCameraRig(look);
  for (const rig of [a, b]) rig.setView({ width: 1440, height: 900, insets: HUD });
  a.view({ situation: DAL25 }, { instant: true });
  b.view({ situation: DAL25, reviewDrawing: buildDrawing({ seq: 9, kind: "admin" }) }, { instant: true });
  assert.deepEqual(b.pose(), a.pose(), "not the whole field");
});

test("a ball-following mode keeps its tight frame while reviewing (the viewer's own camera, G2-2)", async () => {
  const look = await lookWith({ cameras: { modes: [
    { id: "tight", label: "Tight", rig: "sideline", fov: 16, height: 12, back: 34, follow: "ball", cut: false },
  ], default: "tight" } });
  const row = rowOf(95);
  const sit = situationFromRow(row);
  const a = createCameraRig(look);
  const b = createCameraRig(look);
  for (const rig of [a, b]) rig.setView({ width: 1440, height: 900 });
  a.view({ situation: sit }, { instant: true });
  b.view({ situation: sit, reviewDrawing: buildDrawing(row) }, { instant: true });
  assert.deepEqual(b.pose(), a.pose());
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
