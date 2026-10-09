// ESPN feed bar (FI 3.2): button, status line, event id, Watch start, background message (G12).
import { FEED } from "./copy.js";
import { freezeDeep } from "./format.js";
import { isWatchSession, watchOf } from "./vm-transport.js";

const str = (v) => (typeof v === "string" ? v : "");

/** Feed fields that describe applied plays. They come only from the presented state (decision 2, DC E5). */
const PLAY_FIELDS = Object.freeze(["last_play", "skipped", "plays_logged"]);
const withoutPlays = (feed) => Object.fromEntries(Object.entries(feed).filter(([key]) => !PLAY_FIELDS.includes(key)));

/**
 * {...presented.feed, ...version.feed}: the version poll carries the freshest status and poll time (Appendix A, #95),
 * but its last and skipped plays can be ahead of the field, so those stay the presented state's.
 */
export function feedOf(pv) {
  const fromState = (pv && pv.presented && pv.presented.feed) || {};
  const fromVersion = (pv && pv.version && pv.version.feed) || {};
  const merged = { ...fromState, ...withoutPlays(fromVersion) };
  return { ...merged, on: Boolean(merged.on) };
}

/** "watch" while a watched game owns the screen, else "feed" with the feed on, else "manual". */
export function inputMode(pv) {
  const watch = watchOf(pv);
  if (watch && isWatchSession(watch.state)) return "watch";
  return feedOf(pv).on ? "feed" : "manual";
}

function feedState(feed) {
  if (!feed.on) return "off";
  return feed.state === "error" ? "retrying" : "live";
}

const BUTTON = { off: FEED.buttonOff, live: FEED.buttonOn, retrying: FEED.buttonRetrying };

/** " · " then a strong label and its value, or nothing when the value is empty. */
function labelled(label, value) {
  if (!str(value)) return [];
  return [{ text: FEED.separator, strong: false }, { text: label, strong: true }, { text: ` ${value}`, strong: false }];
}

function liveStatus(feed) {
  return [
    { text: FEED.updated(str(feed.last_poll) || FEED.notYet), strong: false },
    ...labelled(FEED.last, feed.last_play),
    ...labelled(FEED.skipped, feed.skipped),
  ];
}

function statusOf(feed, state) {
  if (state === "off") return [{ text: FEED.statusOff, strong: false }];
  if (state === "retrying") return [{ text: FEED.error(str(feed.detail)), strong: false }];
  return liveStatus(feed);
}

/**
 * @param {object} pv  presented view
 * @returns {object} frozen {on, state, buttonText, status: {text, strong}[], eventId, watchStartVisible, bgMessage}
 */
export function feedVm(pv) {
  const feed = feedOf(pv);
  const state = feedState(feed);
  const watch = watchOf(pv);
  const presentedFeed = (pv && pv.presented && pv.presented.feed) || {};
  const bg = pv && pv.view && pv.view.bgMessage;
  return freezeDeep({
    on: state !== "off",
    state,
    buttonText: BUTTON[state],
    status: statusOf(feed, state),
    eventId: str(presentedFeed.event_id),
    watchStartVisible: watch !== null && !["playing", "paused"].includes(watch.state),
    bgMessage: bg ? str(bg.text) : "",
  });
}
