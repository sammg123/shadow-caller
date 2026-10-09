// Engine events and world moments (ui-architecture 2.5 on(), 2.7 WorldModule.moments; owner A5). The event bus
// isolates listeners (one that throws is reported and the rest still run). A moment is a world's authored beat at
// presnap, snap, verdict or a possession change (the light dip, a board flash); it gets a small context with the
// scene, the camera rig, the named lights and a tween on the render loop, never runs under reduced motion, and a
// moment that throws or rejects is a warning, not an engine failure.

/** on(event, fn) -> unsubscribe; emit(event, payload). */
export function createBus() {
  const listeners = new Map();
  return {
    on(event, fn) {
      if (typeof fn !== "function") return () => {};
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event)?.delete(fn);
    },
    emit(event, payload) {
      for (const fn of [...(listeners.get(event) ?? [])]) {
        try {
          fn(payload);
        } catch (err) {
          globalThis.reportError?.(err);
        }
      }
    },
  };
}

/**
 * Run fn(u) for u from 0 to 1 over `ms` on the render loop (keepAlive), resolving at the end; at once (fn(1))
 * under reduced motion or for ms <= 0. `alive()` false stops it early (the engine was disposed).
 */
export function tween({ keepAlive, reduced, alive = () => true }, ms, fn) {
  if (reduced || !(ms > 0)) {
    fn(1);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let t = 0;
    const stop = keepAlive((dt) => {
      t += dt;
      const u = Math.min(1, t / ms);
      fn(u);
      if (u < 1 && alive()) return true;
      stop();
      resolve();
      return false;
    });
  });
}

/**
 * Call world.moments[name](ctx, ...args) when the world has it and motion is not reduced. `stage` gives the
 * context: { THREE, scene, camera, rig, lights, requestRender, tween(ms, fn), reducedMotion, look, frame }.
 */
export function runMoment({ stage, reduced, alive, warn }, name, ...args) {
  const fn = stage.world?.moments?.[name];
  if (typeof fn !== "function" || reduced || !alive()) return;
  const ctx = { THREE: stage.THREE, scene: stage.scene, camera: stage.cams.camera, rig: stage.cams, lights: stage.lights(),
    requestRender: () => stage.requestRender(), reducedMotion: reduced, look: stage.look, frame: stage.frame,
    tween: (ms, f) => tween({ keepAlive: (g) => stage.keepAlive(g), reduced, alive }, ms, f) };
  try {
    Promise.resolve(fn(ctx, ...args)).catch(warn);
  } catch (err) {
    warn(err);
  }
}
