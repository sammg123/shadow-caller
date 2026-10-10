// Numbers behind the 3D stage (ui-architecture 6.1; three-recipe 6.3, 10.4; package A5): device pixel ratio, the
// frame-time governor, the HUD safe area, camera pose easing and the alpha bleed for logo decals. Pure.
import assert from "node:assert/strict";
import test from "node:test";
import {
  DPR, pickDpr, governDpr, initialGovernor, safeView, lerpPose, dampPose, poseGap, bleedAlpha, insetsFrom,
  dprFloor, dprOverride, sameFrame, needsRealloc,
} from "../../static/js/field/stage-math.js";

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const frozen = (o) => Object.freeze(o);

test("DPR: min(device, 2), and never more than a 4K frame of pixels (6.1, recipe 10.4)", () => {
  assert.equal(pickDpr({ deviceDpr: 2, width: 1440, height: 900 }), 2);
  assert.equal(pickDpr({ deviceDpr: 3, width: 1440, height: 900 }), 2);
  assert.equal(pickDpr({ deviceDpr: 1, width: 1920, height: 1080 }), 1);
  close(pickDpr({ deviceDpr: 2, width: 3840, height: 2160 }), 1);
  close(pickDpr({ deviceDpr: 2, width: 2560, height: 1440 }), Math.sqrt((3840 * 2160) / (2560 * 1440)));
  assert.equal(pickDpr({ deviceDpr: 2, width: 1440, height: 900, maxDpr: 1.5 }), 1.5);
  assert.equal(pickDpr({ deviceDpr: Number.NaN, width: 0, height: 0 }), 1, "bad input gives 1");
});

/** `n` animated frames of `ms` each (the frame before each spent `cpuMs` in the engine). */
const frames = (g, n, ms, opts = {}) => {
  let out = g;
  for (let i = 0; i < n; i += 1) out = governDpr(out, ms, opts);
  return out;
};
/** Past the cooldown that follows a step: smooth 60 Hz frames, too few to step back up. */
const cool = (g) => frames(g, Math.ceil(DPR.COOLDOWN_MS / 16.7) + 1, 16.7, { cpuMs: 0.5 });

test("governor: a mean over 30 frames above 22 ms steps down 0.25, to a floor of 1", () => {
  let g = initialGovernor(2);
  g = frames(g, DPR.WINDOW - 1, 30);
  assert.equal(g.dpr, 2, "not before the window is full");
  g = governDpr(g, 30);
  assert.equal(g.dpr, 1.75);
  for (let k = 0; k < 6; k += 1) g = frames(cool(g), DPR.WINDOW, 40);
  assert.equal(g.dpr, 1, "floor");
  const fixed = governDpr(frozen({ ...initialGovernor(2), samples: frozen([]) }), 50);
  assert.deepEqual(fixed.samples, [50], "returns a new state");
  assert.equal(governDpr(initialGovernor(1), Number.NaN).samples.length, 0, "a bad sample is ignored");
});

test("governor: a frame the engine's own CPU made slow (a play being built) is not the GPU running out", () => {
  const hitches = frames(initialGovernor(2), DPR.WINDOW, 33.4, { cpuMs: 20 });
  assert.equal(hitches.dpr, 2, "33 ms frames that spent 20 ms in the engine: CPU-side, left out");
  const gpu = frames(initialGovernor(2), DPR.WINDOW, 33.4, { cpuMs: 0.6 });
  assert.equal(gpu.dpr, 1.75, "33 ms frames with an idle engine: the GPU is behind");
});

test("governor: after a transient slowdown, 5 s of animated frames at the display's pace step back up 0.25", () => {
  let g = frames(initialGovernor(2), DPR.WINDOW, 40);
  assert.equal(g.dpr, 1.75);
  g = cool(g);
  g = frames(g, Math.floor((DPR.RECOVER_MS - 100) / 16.7), 16.7, { cpuMs: 0.5 });
  assert.equal(g.dpr, 1.75, "not before about 5 s of smooth frames");
  g = frames(g, 20, 16.7, { cpuMs: 0.5 });
  assert.equal(g.dpr, 2, "a 60 Hz display at its own pace has headroom again");
  g = frames(cool(g), 400, 16.7, { cpuMs: 0.5 });
  assert.equal(g.dpr, 2, "never above the ceiling");
  const capped = frames(cool(frames(initialGovernor(2), DPR.WINDOW, 40)), 400, 16.7, { cpuMs: 0.5, ceiling: 1.75 });
  assert.equal(capped.dpr, 1.75, "a pixel cap or a tier is the ceiling");
});

test("governor: on a 120 Hz display only frames under about 12 ms count as headroom; a slow frame restarts the run", () => {
  let g = frames(initialGovernor(2), 40, 8.3, { cpuMs: 0.4 });        // learns the display's pace
  g = cool(frames(g, DPR.WINDOW, 40));
  assert.equal(g.dpr, 1.75);
  g = frames(g, 700, 16.7, { cpuMs: 0.4 });
  assert.equal(g.dpr, 1.75, "60 fps on a 120 Hz display is not headroom");
  g = frames(g, 500, 8.3, { cpuMs: 0.4 });
  g = governDpr(g, 30, { cpuMs: 0.4 });
  g = frames(g, 120, 8.3, { cpuMs: 0.4 });
  assert.equal(g.dpr, 1.75, "the run restarted at the slow frame");
  g = frames(g, 600, 8.3, { cpuMs: 0.4 });
  assert.equal(g.dpr, 2);
});

test("governor: a step up that fails soon after is a flip; after the flip limit it stays down for the session", () => {
  let g = frames(initialGovernor(2), DPR.WINDOW, 40);
  for (let k = 0; k < DPR.MAX_FLIPS; k += 1) {
    g = frames(cool(g), Math.ceil(DPR.RECOVER_MS / 16.7) + 1, 16.7, { cpuMs: 0.5 });
    assert.equal(g.dpr, 2, `probe ${k + 1} steps up`);
    g = frames(cool(g), 2 * DPR.WINDOW, 40);       // a window part filled with smooth frames takes one more
    assert.equal(g.dpr, 1.75, `probe ${k + 1} was too much`);
  }
  assert.equal(g.flips, DPR.MAX_FLIPS);
  g = frames(cool(g), 2000, 16.7, { cpuMs: 0.5 });
  assert.equal(g.dpr, 1.75, "no more probes");
  const late = frames(cool(frames(cool(frames(initialGovernor(2), DPR.WINDOW, 40)), 400, 16.7, { cpuMs: 0.5 })),
    Math.ceil(DPR.FLIP_MS / 16.7) + 10, 16.7, { cpuMs: 0.5 });
  assert.equal(late.dpr, 2);
  const slowed = frames(late, 2 * DPR.WINDOW, 40);
  assert.equal(slowed.dpr, 1.75);
  assert.equal(slowed.flips, 0, "a slowdown long after a step up is not a flip");
});

test("governor: the floor is 1, or 0.75 for a viewport 3840 px wide or more", () => {
  assert.equal(dprFloor(1440), DPR.FLOOR);
  assert.equal(dprFloor(3839), 1);
  assert.equal(dprFloor(3840), 0.75);
  assert.equal(dprFloor(Number.NaN), 1);
  let g = initialGovernor(1);
  g = frames(g, DPR.WINDOW, 40, { floor: dprFloor(3840) });
  assert.equal(g.dpr, 0.75, "a 4K TV at DPR 1 still has a step down");
  g = frames(cool(g), DPR.WINDOW, 40, { floor: 0.75 });
  assert.equal(g.dpr, 0.75);
});

test("?dpr= pins the pixel ratio: a number from 0.5 to 3, anything else ignored", () => {
  assert.equal(dprOverride("?dpr=1.5"), 1.5);
  assert.equal(dprOverride("?world=neutral&dpr=2"), 2);
  assert.equal(dprOverride("?dpr=9"), 3, "clamped");
  assert.equal(dprOverride("?dpr=0.1"), 0.5);
  assert.equal(dprOverride("?dpr=abc"), null);
  assert.equal(dprOverride("?dpr=0"), null);
  assert.equal(dprOverride("?dpr=-1"), null);
  assert.equal(dprOverride("?dpr="), null);
  assert.equal(dprOverride(""), null);
  assert.equal(dprOverride(undefined), null);
});

test("sameFrame: the same field, teams, order and game, however fetched, is the same frame", () => {
  const a = { field: { home: "DAL", dir: [1, -1] }, teams: { DAL: { color: "#002a5c" } }, teamOrder: ["TB", "DAL"],
    game: null };
  const b = JSON.parse(JSON.stringify(a));
  assert.equal(sameFrame(a, b), true);
  assert.equal(sameFrame(null, null), true);
  assert.equal(sameFrame(a, null), false);
  assert.equal(sameFrame(a, { ...b, game: { light: "day" } }), false);
  assert.equal(sameFrame(a, { ...b, teamOrder: ["DAL", "TB"] }), false);
  assert.equal(sameFrame(a, { ...b, teams: { DAL: { color: "#002a5d" } } }), false);
  assert.equal(sameFrame(a, { ...b, field: { home: "DAL", dir: [1, -1], extra: 1 } }), false);
  assert.equal(sameFrame({ x: [1, 2] }, { x: { 0: 1, 1: 2 } }), false, "an array is not an object");
});

test("a resize reallocates the drawing buffer only when it changes by more than a few pixels", () => {
  const cur = { width: 1440, height: 900 };
  assert.equal(needsRealloc(cur, { width: 1441, height: 899 }), false);
  assert.equal(needsRealloc(cur, { width: 1440 + DPR.SNAP_PX, height: 900 }), false);
  assert.equal(needsRealloc(cur, { width: 1440 + DPR.SNAP_PX + 1, height: 900 }), true);
  assert.equal(needsRealloc(cur, { width: 1440, height: 720 }), true);
  assert.equal(needsRealloc(null, cur), true, "the first size");
});

test("safe area: a right-hand panel moves the optical center into the free area (recipe 6.3)", () => {
  const v = safeView({ width: 1440, height: 900, insets: { right: 456 } });
  assert.equal(v.fullWidth, 1440 + 456);
  assert.equal(v.offsetX, 456);
  assert.equal(v.fullHeight, 900);
  assert.equal(v.offsetY, 0);
  close(v.aspect, (1440 + 456) / 900);
  assert.ok(v.shifted);
  // the free area (984 px) is centered in the virtual frame, so its side margins are equal
  close(v.margins.left, v.margins.right);
  close(1 - v.margins.left - v.margins.right, (984 / 1896) * (1 - 2 * 0.04), 1e-9);
});

test("safe area: top and bottom bands center the frame vertically in what is left", () => {
  const v = safeView({ width: 1440, height: 900, insets: { top: 44, right: 456, bottom: 184 } });
  const cy = (44 + 900 - 184) / 2;
  assert.equal(v.fullHeight, 2 * (900 - cy));
  assert.equal(v.offsetY, 900 - 2 * cy);
  close(v.margins.top, v.margins.bottom);
  const free = 900 - 44 - 184;
  close(1 - v.margins.top - v.margins.bottom, (free / v.fullHeight) * (1 - 2 * 0.06), 1e-9);
});

test("safe area: a left inset shifts the other way; no insets is the plain frame", () => {
  const left = safeView({ width: 1000, height: 600, insets: { left: 200 } });
  assert.equal(left.offsetX, 0);
  assert.equal(left.fullWidth, 1200);
  const plain = safeView({ width: 1000, height: 600 });
  assert.deepEqual([plain.fullWidth, plain.fullHeight, plain.offsetX, plain.offsetY, plain.shifted], [1000, 600, 0, 0, false]);
  assert.deepEqual(plain.margins, { left: 0.04, right: 0.04, top: 0.06, bottom: 0.06 });
  const silly = safeView({ width: 1000, height: 600, insets: { right: 5000, top: -3 } });
  assert.ok(silly.fullWidth >= 1000 && Number.isFinite(silly.aspect), "insets are clamped to the canvas");
});

test("insets from CSS lengths: px values parse, anything else is 0", () => {
  assert.deepEqual(insetsFrom({ top: "44px", right: " 456px", bottom: "", left: "auto" }), { top: 44, right: 456, bottom: 0, left: 0 });
  assert.deepEqual(insetsFrom(null), { top: 0, right: 0, bottom: 0, left: 0 });
  assert.deepEqual(insetsFrom({ top: "-3px", right: "1e9px" }), { top: 0, right: 100000, bottom: 0, left: 0 });
});

const P = (x, fov = 20) => frozen({ position: frozen({ x, y: 10, z: 50 }), target: frozen({ x: 0, y: 0, z: 0 }), fov });

test("pose easing: lerp ends at both poses; damping is frame-rate independent and stops when close", () => {
  const a = P(0, 20);
  const b = P(10, 30);
  assert.deepEqual(lerpPose(a, b, 0), { position: { x: 0, y: 10, z: 50 }, target: { x: 0, y: 0, z: 0 }, fov: 20 });
  assert.deepEqual(lerpPose(a, b, 1).position, { x: 10, y: 10, z: 50 });
  close(lerpPose(a, b, 0.5).fov, 25);
  const one = dampPose(a, b, 3.2, 100);
  const two = dampPose(dampPose(a, b, 3.2, 50).pose, b, 3.2, 50);
  close(one.pose.position.x, two.pose.position.x, 1e-9);
  assert.equal(one.moving, true);
  const settled = dampPose(P(9.99995, 30), b, 3.2, 16);
  assert.equal(settled.moving, false);
  assert.deepEqual(settled.pose.position, b.position, "snaps the last hair");
  assert.ok(poseGap(a, b) > 9.9);
  assert.equal(poseGap(b, b), 0);
});

test("alpha bleed: transparent pixels take their neighbours' color and stay transparent; input untouched", () => {
  const w = 3;
  const h = 1;
  const data = new Uint8ClampedArray([200, 10, 20, 255, 0, 0, 0, 0, 0, 0, 0, 0]);
  const copy = new Uint8ClampedArray(data);
  const out = bleedAlpha(data, w, h, 4);
  assert.deepEqual([...data], [...copy], "the input is not changed");
  assert.deepEqual([...out.slice(4, 8)], [200, 10, 20, 0]);
  assert.deepEqual([...out.slice(8, 12)], [200, 10, 20, 0], "a second pass reaches further");
  assert.deepEqual([...bleedAlpha(new Uint8ClampedArray(4), 1, 1)], [0, 0, 0, 0], "nothing to bleed from");
});
