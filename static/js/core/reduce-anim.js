// Animation queue bookkeeping from the conductor (ui-architecture.md 2.1, 3.4, 3.5; owner A1). Pure.
// Engine callbacks carry the token they started under; anything from before a rebuild is ignored. anim/jump comes from
// core/actions.js when a playback request lands (restructure-v2.md 5): the server's row it landed on, and its game.
import { flushAll, markDone, markJump, markRebuilt, markStarted } from "./anim-queue.js";

const isLanding = (event) => typeof event.epoch === "string" && event.epoch !== "" && Number.isInteger(event.n)
  && event.n >= 0;

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
    case "anim/jump":
      return isLanding(event) ? markJump(anim, event.epoch, event.n) : anim;
    default:
      return anim;
  }
}

export const ANIM_EVENTS = Object.freeze(["anim/started", "anim/done", "anim/rebuilt", "anim/flush", "anim/jump"]);

export function reduceAnim(state, event) {
  const anim = nextAnim(state.anim, event);
  return anim === state.anim ? state : { ...state, anim };
}
