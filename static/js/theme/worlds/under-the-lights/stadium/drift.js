// Under the Lights: the blimp's drift between drives (DESIGN.md "Camera by altitude": in Watch this game the camera
// rises to blimp between drives and drifts, at most 3 degrees of yaw a second; owner W1). Pure pose math in world
// yards ({ position, target, up, fov }). From the blimp the drift eases out to an establishing shot of the whole
// bowl (pulled back, a little lower, aimed past the field's middle so the far stands and their two light towers
// frame the top of the picture), then sweeps slowly round the field and holds.

const DEG = Math.PI / 180;
/** The ease into the establishing framing (ms). */
export const FRAME_MS = 2400;
export const DRIFT = Object.freeze({ driftDegPerS: 2.4, driftMaxDeg: 20, driftZoom: 1.65, driftPitchDeg: 42,
  driftLiftYd: 25 });

const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const lerp = (a, b, k) => a + (b - a) * k;
const lerp3 = (a, b, k) => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: lerp(a.z, b.z, k) });
const norm3 = (v) => {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};
const cross3 = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

/** Two poses mixed: positions, targets, lens and up (renormalized). */
export function blendPose(a, b, k) {
  return { position: lerp3(a.position, b.position, k), target: lerp3(a.target, b.target, k),
    up: norm3(lerp3(a.up, b.up, k)), fov: lerp(a.fov, b.fov, k) };
}

/** The pose turned `rad` about the vertical axis through its target. */
export function yawPose(pose, rad) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const t = pose.target;
  const dx = pose.position.x - t.x;
  const dz = pose.position.z - t.z;
  return { ...pose, position: { x: t.x + dx * c - dz * s, y: pose.position.y, z: t.z + dx * s + dz * c },
    up: { x: pose.up.x * c - pose.up.z * s, y: pose.up.y, z: pose.up.x * s + pose.up.z * c }, target: { ...t } };
}

/** The pose pulled back along its line of sight to `k` times its distance. */
export function dollyPose(pose, k) {
  const t = pose.target;
  const p = pose.position;
  return { ...pose, position: { x: t.x + (p.x - t.x) * k, y: t.y + (p.y - t.y) * k, z: t.z + (p.z - t.z) * k } };
}

/** The establishing shot a blimp pose drifts to: `driftZoom` times as far, `driftPitchDeg` down, aimed
 * `driftLiftYd` past its target along its heading (the far side), with the same lens. */
export function driftFrame(pose, cfg = DRIFT) {
  const t = pose.target;
  const flat = { x: t.x - pose.position.x, z: t.z - pose.position.z };
  const fl = Math.hypot(flat.x, flat.z) || 1;
  const h = { x: flat.x / fl, z: flat.z / fl };
  const dist = dist3(pose.position, t) * cfg.driftZoom;
  const pitch = cfg.driftPitchDeg * DEG;
  const target = { x: t.x + h.x * cfg.driftLiftYd, y: t.y, z: t.z + h.z * cfg.driftLiftYd };
  const position = { x: target.x - h.x * dist * Math.cos(pitch), y: target.y + dist * Math.sin(pitch),
    z: target.z - h.z * dist * Math.cos(pitch) };
  const forward = norm3({ x: target.x - position.x, y: target.y - position.y, z: target.z - position.z });
  const right = norm3(cross3(forward, { x: 0, y: 1, z: 0 }));
  return { position, target, up: cross3(right, forward), fov: pose.fov };
}

/** The drift `ms` in: the ease into the establishing framing (k) and the yaw sweep (an ease-in-out to driftMaxDeg
 * whose fastest point is driftDegPerS). */
export function driftAngle(ms, cfg = DRIFT) {
  const sweepMs = ((cfg.driftMaxDeg / cfg.driftDegPerS) * (Math.PI / 2)) * 1000;
  const u = Math.min(1, Math.max(0, ms / sweepMs));
  const f = Math.min(1, Math.max(0, ms / FRAME_MS));
  return { rad: cfg.driftMaxDeg * DEG * (1 - Math.cos(Math.PI * u)) / 2, k: 1 - (1 - f) ** 3, moving: u < 1 || f < 1 };
}

/** The drifting pose `ms` in, from the blimp pose the rig holds; `sign` picks the sweep's direction. */
export function driftPose(pose, ms, sign = 1, cfg = DRIFT) {
  const a = driftAngle(ms, cfg);
  const framed = blendPose(pose, driftFrame(pose, cfg), a.k);
  return { pose: yawPose(framed, a.rad * sign), moving: a.moving };
}
