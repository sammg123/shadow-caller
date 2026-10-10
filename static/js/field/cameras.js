// The camera rig (ui-architecture 2.5; three-recipe 6.1 to 6.5; owner A5). What to look at comes from the pure
// field/camera-plan.js (frames and poses in field yards); this module turns poses into a PerspectiveCamera and
// moves between them: a mode switch eases over look.cameras.moveMs (or cuts: mode.cut, instant, reduced motion),
// a new situation glides there (frame-rate independent damping), and ball-following modes track rig.follow().
// The HUD's safe area renders a wider virtual frame (setViewOffset), so the optical center sits in the free part
// of the canvas and fitted frames never hide under a panel. step(dtMs) returns true while the camera still moves,
// which keeps the render-on-demand loop alive and then lets it stop.
//
//   rig.view({ situation, ghosts, drawing, reviewDrawing })   what the scene shows now (reviewDrawing: the play Left
//                                              or Right is replaying); a follow mode also uses rig.follow(ball)
//   rig.setMode(id, { instant })               the viewer's mode (V); rig.shot(id | null) overrides it for a while
// The functions below share one rig context `r` = { cfg, camera, st }.
import * as THREE from "three";
import { frameBall, frameDrawing, framePresetFor, frameSituation, poseFor, unionFrame } from "./camera-plan.js";
import { toWorld, vecToWorld } from "./coords.js";
import { dampPose, lerpPose, safeView } from "./stage-math.js";
import { EASE } from "./timing.js";

const NEAR = 0.5;
const FAR = 1500;
const DAMP_FRAME = 4;       // per second: a new situation settles in about 2 s
const DAMP_FOLLOW = 9;      // following the ball stays close behind it (about 3 yd behind a 30 yd/s pass)
const EMPTY_VIEW = Object.freeze({ situation: null, ghosts: null, drawing: null, reviewDrawing: null });

function worldPose(p) {
  const position = toWorld(p.position.x, p.position.y, p.position.h);
  const target = toWorld(p.target.x, p.target.y, p.target.h);
  return { position, target, up: vecToWorld(p.up), fov: p.fov };
}

function blendUp(a, b, u) {
  const v = new THREE.Vector3(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u);
  if (v.lengthSq() < 1e-8) return { ...b };
  v.normalize();
  return { x: v.x, y: v.y, z: v.z };
}

const copyPose = (p) => ({ position: { ...p.position }, target: { ...p.target }, up: { ...p.up }, fov: p.fov });
const modeById = (r, id) => r.cfg.modes.find((m) => m.id === id) ?? null;
const active = (r) => modeById(r, r.st.shot ?? r.st.selected) ?? r.cfg.modes[0];

/**
 * A ball-following mode holds the ball, never the ghosts (full-width pass bands would pull it back out). A review
 * (Left / Right) frames the reviewed row's situation and its whole play, so a long run, a deep shot or a kick ends on
 * screen, clear of the HUD; the live view is the situation's frame alone.
 */
function frameFor(r, mode) {
  const { situation, ghosts, drawing, reviewDrawing } = r.st.ctx;
  if (mode.follow === "ball") return r.st.ball ? frameBall(r.st.ball, situation) : frameSituation(situation, { preset: "tight" });
  if (mode.follow === "drive" && drawing && mode.rig !== "blimp") return frameDrawing(drawing);
  const frame = frameSituation(situation, { preset: framePresetFor(mode), ghosts });
  return reviewDrawing?.bounds ? unionFrame(frame, frameDrawing(reviewDrawing)) : frame;
}

function desired(r) {
  const mode = active(r);
  return worldPose(poseFor(frameFor(r, mode), mode, { aspect: r.st.view.aspect, margins: r.st.view.margins }));
}

function apply(r, pose) {
  const { camera } = r;
  camera.position.set(pose.position.x, pose.position.y, pose.position.z);
  camera.up.set(pose.up.x, pose.up.y, pose.up.z);
  camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
  if (camera.fov !== pose.fov) {
    camera.fov = pose.fov;
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld();
}

function snap(r) {
  r.st.tween = null;
  r.st.pose = desired(r);
  apply(r, r.st.pose);
}

function transition(r, instant) {
  if (instant || r.st.reduced || !r.st.pose || active(r).cut) {
    snap(r);
    return;
  }
  r.st.tween = { from: copyPose(r.st.pose), t: 0, ms: r.cfg.moveMs, ease: EASE[r.cfg.ease] ?? EASE.inOutCubic };
}

function stepTween(r, goal, dtMs) {
  const tw = r.st.tween;
  tw.t += dtMs;
  const u = tw.ms > 0 ? Math.min(1, tw.t / tw.ms) : 1;
  const k = tw.ease(u);
  r.st.pose = { ...lerpPose(tw.from, goal, k), up: blendUp(tw.from.up, goal.up, k) };
  apply(r, r.st.pose);
  if (u >= 1) r.st.tween = null;
  return u < 1;
}

/** Advance one frame; true while the camera still moves. */
function step(r, dtMs) {
  const goal = desired(r);
  if (!r.st.pose) {
    r.st.pose = goal;
    apply(r, goal);
    return false;
  }
  if (r.st.tween) return stepTween(r, goal, Math.max(0, dtMs));
  const lambda = active(r).follow === "ball" && r.st.ball ? DAMP_FOLLOW : DAMP_FRAME;
  const damped = dampPose(r.st.pose, goal, lambda, dtMs);
  r.st.pose = { ...damped.pose, up: { ...goal.up } };
  apply(r, r.st.pose);
  return damped.moving;
}

function setView(r, { width, height, insets = {} }) {
  const { camera } = r;
  r.st.view = safeView({ width, height, insets });
  camera.aspect = r.st.view.aspect;
  if (r.st.view.shifted) {
    const v = r.st.view;
    camera.setViewOffset(v.fullWidth, v.fullHeight, v.offsetX, v.offsetY, width, height);
  } else camera.clearViewOffset();
  camera.updateProjectionMatrix();
  snap(r);
}

function setMode(r, id, instant) {
  if (!modeById(r, id)) return false;
  r.st.selected = id;
  if (!r.st.shot) transition(r, instant);
  return true;
}

function shot(r, id, instant) {
  if (id !== null && !modeById(r, id)) return false;
  r.st.shot = id;
  transition(r, instant);
  return true;
}

function follow(r, ball) {
  r.st.ball = ball && Number.isFinite(ball.x) && Number.isFinite(ball.y) ? { x: ball.x, y: ball.y, h: ball.h ?? 0 } : null;
}

/**
 * @param {object} look  a resolved Look; its cameras.modes, default, moveMs and ease drive the rig
 * @param {{ reducedMotion?: boolean }} [opts]
 */
export function createCameraRig(look, { reducedMotion = false } = {}) {
  const cfg = look.cameras;
  const camera = new THREE.PerspectiveCamera(cfg.modes[0].fov, 16 / 9, NEAR, FAR);
  const r = { cfg, camera, st: { selected: cfg.default, shot: null, ctx: EMPTY_VIEW, ball: null,
    view: safeView({ width: 1, height: 1 }), pose: null, tween: null, reduced: Boolean(reducedMotion) } };
  return {
    camera,
    modes: () => cfg.modes.map(({ id, label }) => ({ id, label })),
    mode: () => r.st.selected,
    activeMode: () => active(r).id,
    setMode: (id, { instant = false } = {}) => setMode(r, id, instant),
    shot: (id, { instant = false } = {}) => shot(r, id, instant),
    view(ctx, { instant = false } = {}) {
      r.st.ctx = { ...EMPTY_VIEW, ...ctx };
      if (instant || r.st.reduced || !r.st.pose) snap(r);
    },
    follow: (ball) => follow(r, ball),
    setView: (opts) => setView(r, opts),
    setReducedMotion(on) {
      r.st.reduced = Boolean(on);
      if (r.st.reduced && r.st.tween) snap(r);
    },
    step: (dtMs) => step(r, dtMs),
    snap: () => snap(r),
    pose: () => copyPose(r.st.pose ?? desired(r)),
    /** v1.4 (A5 part 2): the pose the camera is settling on (world units), so field text is laid out for the view
     * it will land in, not the one mid-glide. */
    goalPose: () => copyPose(desired(r)),
    lens: () => ({ fov: camera.fov, aspect: camera.aspect, view: camera.view?.enabled ? { ...camera.view } : null }),
    moving: () => Boolean(r.st.tween),
    dispose() {
      r.st.tween = null;
      r.st.ball = null;
    },
  };
}
