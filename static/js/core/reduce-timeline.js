// timeline/loaded (ui-architecture.md 2.1, 3.6, 3.7; DC B1, B7, E4; owner A1). Pure.
// A reset rebuilds the scene without animation; an append queues the new rows, instantly up to where a jump to this
// game landed (restructure-v2.md 5); either way the cached preds are patched from the newest /api/state log.
import { enqueue, rebuild } from "./anim-queue.js";
import { checkTimelineBody, mergeTimeline, patchPreds } from "./timeline-cache.js";

/** The row a jump to this game landed on (its rows up to it draw instantly), else 0. */
const jumpedTo = (anim, epoch) => (anim.jump && anim.jump.epoch === epoch ? anim.jump.n : 0);

export function reduceTimeline(state, event) {
  if (event.type !== "timeline/loaded" || checkTimelineBody(event.resp) !== null) return state;
  const merged = mergeTimeline(state.timeline, event.resp);
  if (merged.cache === state.timeline) return state;
  const rows = patchPreds(merged.cache.rows, state.server?.log);
  const timeline = rows === merged.cache.rows ? merged.cache : { ...merged.cache, rows };
  if (merged.reset) return { ...state, timeline, anim: rebuild(state.anim, timeline.n) };
  if (merged.added.length === 0) return { ...state, timeline };
  const opts = { origin: event.origin === "action" ? "action" : "poll", hidden: Boolean(event.hidden),
    reducedMotion: Boolean(event.reducedMotion), instantThrough: jumpedTo(state.anim, timeline.epoch) };
  return { ...state, timeline, anim: enqueue(state.anim, merged.added, opts) };
}
