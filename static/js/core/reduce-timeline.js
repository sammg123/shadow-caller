// timeline/loaded (ui-architecture.md 2.1, 3.6, 3.7; DC B1, B7, E4; owner A1). Pure.
// A reset rebuilds the scene without animation and leaves review; an append queues the new rows; either way the
// cached preds are patched from the newest /api/state log.
import { enqueue, rebuild } from "./anim-queue.js";
import { checkTimelineBody, mergeTimeline, patchPreds } from "./timeline-cache.js";

const LIVE_EDGE = Object.freeze({ seq: null });

function leaveReview(view) {
  return view.review.seq === null ? view : { ...view, review: LIVE_EDGE };
}

export function reduceTimeline(state, event) {
  if (event.type !== "timeline/loaded" || checkTimelineBody(event.resp) !== null) return state;
  const merged = mergeTimeline(state.timeline, event.resp);
  if (merged.cache === state.timeline) return state;
  const rows = patchPreds(merged.cache.rows, state.server?.log);
  const timeline = rows === merged.cache.rows ? merged.cache : { ...merged.cache, rows };
  if (merged.reset) {
    return { ...state, timeline, anim: rebuild(state.anim, timeline.n), view: leaveReview(state.view) };
  }
  if (merged.added.length === 0) return { ...state, timeline };
  const opts = { origin: event.origin === "action" ? "action" : "poll", hidden: Boolean(event.hidden),
    reducedMotion: Boolean(event.reducedMotion) };
  return { ...state, timeline, anim: enqueue(state.anim, merged.added, opts) };
}
