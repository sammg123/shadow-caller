// Numbers behind the 3D stage (ui-architecture 6.1; three-recipe 6.3, 10.4; package A5): device pixel ratio, the
// frame-time governor, the HUD safe area, camera pose easing and the alpha bleed for logo decals. Pure.
import assert from "node:assert/strict";
import test from "node:test";
import {
  DPR, pickDpr, governDpr, initialGovernor, safeView, lerpPose, dampPose, poseGap, bleedAlpha, insetsFrom,
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

test("governor: a mean over 30 frames above 22 ms steps down 0.25, to a floor of 1, and never back up", () => {
  let g = initialGovernor(2);
  for (let i = 0; i < DPR.WINDOW - 1; i += 1) g = governDpr(g, 30);
  assert.equal(g.dpr, 2, "not before the window is full");
  g = governDpr(g, 30);
  assert.equal(g.dpr, 1.75);
  for (let i = 0; i < DPR.WINDOW; i += 1) g = governDpr(g, 8);
  assert.equal(g.dpr, 1.75, "fast frames never step back up");
  for (let k = 0; k < 6; k += 1) for (let i = 0; i < DPR.WINDOW; i += 1) g = governDpr(g, 40);
  assert.equal(g.dpr, 1, "floor");
  const fixed = governDpr(frozen({ ...initialGovernor(2), samples: frozen([]) }), 50);
  assert.deepEqual(fixed.samples, [50], "returns a new state");
  assert.equal(governDpr(initialGovernor(1), Number.NaN).samples.length, 0, "a bad sample is ignored");
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
