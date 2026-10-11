// The root reducer and the initial state (ui-architecture.md decision 1 and 2.1; owner A1). Pure.
// Each event goes to its slice reducer; then the cross-slice rules run: presentation gating with the lag valve (on
// events that carry `now`), then snapshot pruning.
import { emptyAnim } from "./anim-queue.js";
import { deepFreeze, own } from "./domain.js";
import { advancePresented } from "./present.js";
import { ANIM_EVENTS, reduceAnim } from "./reduce-anim.js";
import { CONN_EVENTS, initialBoot, initialConn, reduceConn } from "./reduce-conn.js";
import { SERVER_EVENTS, initialReq, reduceServer } from "./reduce-server.js";
import { reduceTimeline } from "./reduce-timeline.js";
import { VIEW_EVENTS, initialPrefs, initialView, reduceView } from "./reduce-view.js";
import { emptyTimeline, pruneSnapshots } from "./timeline-cache.js";

const ROUTE = Object.freeze(Object.fromEntries([
  ...CONN_EVENTS.map((t) => [t, reduceConn]),
  ...SERVER_EVENTS.map((t) => [t, reduceServer]),
  ...ANIM_EVENTS.map((t) => [t, reduceAnim]),
  ...VIEW_EVENTS.map((t) => [t, reduceView]),
  ["timeline/loaded", reduceTimeline],
]));

/** Events after which the HUD may catch up with the newest state (3.4). */
const PRESENTING = new Set(["state/loaded", "timeline/loaded", "tick", ...ANIM_EVENTS]);

/** @param {{ prefs?: object }} [overrides] prefs main.js reads at boot (URL, stored choices, media queries) */
export function initialState(overrides = {}) {
  return deepFreeze({
    boot: initialBoot(), conn: initialConn(), server: null, presented: null, presentedSince: null, version: null,
    timeline: emptyTimeline(), anim: emptyAnim(), view: initialView(), prefs: initialPrefs(overrides.prefs),
    req: initialReq(),
  });
}

function pruned(state, prev) {
  if (state.timeline === prev.timeline && state.anim.drawnThrough === prev.anim.drawnThrough) return state;
  const timeline = pruneSnapshots(state.timeline, state.anim.drawnThrough);
  return timeline === state.timeline ? state : { ...state, timeline };
}

function settle(prev, next, event) {
  const state = PRESENTING.has(event.type) && Number.isFinite(event.now) ? advancePresented(next, event.now) : next;
  return pruned(state, prev);
}

/** Returns the same object when nothing changed, so store listeners only run on real changes. */
export function reducer(state, event) {
  const slice = own(ROUTE, event.type);
  if (!slice) return state;
  const next = settle(state, slice(state, event), event);
  return next === state ? state : next;
}
