// Under the Lights: the camera choreography, carried out (DESIGN.md "Camera by altitude"; surface brief #1, #3;
// owner W1). choreo-plan.js decides the shot; this moves the camera there on its own clock. The engine's camera rig
// still owns where every shot looks (its framing honors the HUD's safe area, follows the ball, glides with the
// situation): a new shot is taken at once in the rig (shot(id, { instant })), so the shadow plays' words are laid
// out for the view the camera lands in, and the visible camera then blends from where it was to wherever the rig is
// each frame, over the shot's own time (a 650 ms push at the snap, a 1.7 s rise to the blimp). Between drives in
// Watch this game the blimp drifts (drift.js: out to the whole bowl, then a slow sweep, at most 2.4 degrees a second,
// then it holds still: no frames are drawn while nothing moves). props.js runs update() after the rig each frame;
// reduced motion drops it all at once.
import { EASE } from "../../../../field/timing.js";
import { SHOTS, onLanded, onPlay, onPresnap } from "./choreo-plan.js";
import { DRIFT, blendPose, driftPose } from "./drift.js";

function applyPose(camera, pose) {
  camera.position.set(pose.position.x, pose.position.y, pose.position.z);
  camera.up.set(pose.up.x, pose.up.y, pose.up.z);
  camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
  if (camera.fov !== pose.fov) {
    camera.fov = pose.fov;
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld();
}

/**
 * @param {{ timing?: object, reduced?: () => boolean, requestRender?: () => void }} opts  timing: look.world.uls.camera
 * @returns {{ attach(ctx), play(row, env), landed(row, env), presnap(env), update(dtMs): boolean, state(), reset() }}
 */
export function createChoreo({ timing = {}, reduced = () => false, requestRender = () => {} } = {}) {
  const st = { rig: null, camera: null, shot: null, blend: null, drift: null, visible: null, sign: 1 };

  function reset() {
    if (st.shot && st.rig) st.rig.shot(null, { instant: true });
    Object.assign(st, { shot: null, blend: null, drift: null, visible: null });
  }

  function carry(d) {
    if (!d || !st.rig) return;
    const from = st.visible ?? st.rig.pose();
    st.rig.shot(d.shot, { instant: true });
    st.shot = d.shot;
    st.blend = d.ms > 0 ? { from, t: 0, ms: d.ms } : null;
    if (d.drift && !st.drift) {
      st.drift = { t: 0, sign: st.sign };
      st.sign = -st.sign;
    } else if (!d.drift) st.drift = null;
    if (!st.blend && !st.drift) st.visible = null;
    requestRender();
  }

  const state = () => ({ shot: st.shot, drifting: Boolean(st.drift) });

  function update(dtMs) {
    if (!st.rig || (!st.blend && !st.drift)) return false;
    if (reduced()) {
      reset();
      return false;
    }
    let pose = st.rig.pose();
    let busy = false;
    if (st.blend) {
      st.blend.t += Math.max(0, dtMs);
      const u = Math.min(1, st.blend.t / st.blend.ms);
      pose = blendPose(st.blend.from, pose, EASE.inOutCubic(u));
      busy = u < 1;
      if (!busy) st.blend = null;
    }
    if (st.drift) {
      st.drift.t += Math.max(0, dtMs);
      const d = driftPose(pose, st.drift.t, st.drift.sign, { ...DRIFT, ...timing });
      pose = d.pose;
      busy = busy || d.moving;
    }
    applyPose(st.camera, pose);
    st.visible = st.blend || st.drift ? pose : null;
    return busy;
  }

  return {
    /** The moment's context: the engine's camera rig and camera (the first moment hands them over). */
    attach(ctx) {
      if (ctx?.rig && ctx?.camera && st.rig !== ctx.rig) Object.assign(st, { rig: ctx.rig, camera: ctx.camera, shot: null });
    },
    play: (row, env) => carry(onPlay(state(), row, env, timing)),
    landed: (row, env) => carry(onLanded(state(), row, env, timing)),
    presnap: (env) => carry(onPresnap(state(), env, timing)),
    update,
    state,
    reset,
    shots: SHOTS,
  };
}
