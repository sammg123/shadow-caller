// Animation queue bookkeeping from the conductor (ui-architecture.md 2.1, 3.4, 3.5; owner A1). Pure.
// Engine callbacks carry the token they started under; anything from before a rebuild is ignored.
import { flushAll, markDone, markRebuilt, markStarted } from "./anim-queue.js";

function nextAnim(anim, event) {
  switch (event.type) {
    case "anim/started": {
      if (event.token !== anim.token) return anim;
      return markStarted(anim, { seq: event.seq, durationMs: event.durationMs ?? 0 }, event.now);
    }
    case "anim/done":
      return markDone(anim, event.seq, event.token);
    case "anim/rebuilt":
      return markRebuilt(anim, event.token);
    case "anim/flush":
      return flushAll(anim);
    default:
      return anim;
  }
}

export const ANIM_EVENTS = Object.freeze(["anim/started", "anim/done", "anim/rebuilt", "anim/flush"]);

export function reduceAnim(state, event) {
  const anim = nextAnim(state.anim, event);
  return anim === state.anim ? state : { ...state, anim };
}
