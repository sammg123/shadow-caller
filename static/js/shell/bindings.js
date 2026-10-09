// The component table (ui-architecture.md 2.6 and 9.1; owner A0): where each component mounts, how it loads, the
// view model it renders and the deps that decide when it re-renders. main.js mounts the entries in this order and
// hands them to the scheduler. Loaders are functions, so a component module is fetched only by main.js and a broken
// one never breaks this module. deps(state, env) lists the state values the view model reads (compared by
// identity); env = { now, extras }. `fallback` names a built-in stand-in (shell/mount.js) for the two pieces that
// must never go missing: the boot screen and the toast.
import { boxVm } from "../model/vm-box.js";
import { bootVm, connVm } from "../model/vm-conn.js";
import { drivesVm } from "../model/vm-drives.js";
import { entryVm } from "../model/vm-entry.js";
import { feedVm } from "../model/vm-feed.js";
import { fieldVm } from "../model/vm-field.js";
import { flagsVm } from "../model/vm-flags.js";
import { lastPlayVm } from "../model/vm-last-play.js";
import { logVm } from "../model/vm-log.js";
import { mastheadVm } from "../model/vm-masthead.js";
import { playsVm } from "../model/vm-plays.js";
import { predictionVm } from "../model/vm-prediction.js";
import { reviewVm } from "../model/vm-review.js";
import { scrubVm } from "../model/vm-scrub.js";
import { scoreboardVm } from "../model/vm-scoreboard.js";
import { scorecardVm } from "../model/vm-scorecard.js";
import { situationVm } from "../model/vm-situation.js";
import { tendenciesVm } from "../model/vm-tendencies.js";
import { transportVm } from "../model/vm-transport.js";
import { wpVm } from "../model/vm-wp.js";

const MS_PER_S = 1000;

/** What inputMode(pv) reads, as values: the freshest watch state and the effective feed switch (vm-feed.js). */
export function inputModeDeps(s) {
  const watch = s.version?.watch ?? s.presented?.watch ?? null;
  return [watch?.state ?? null, Boolean(s.version?.feed?.on ?? s.presented?.feed?.on)];
}

/** v1.4 (W5): the freshest watch's state and total, as values (the scrub's strip runs to the session's total). */
export function watchTotalDeps(s) {
  const watch = s.version?.watch ?? s.presented?.watch ?? null;
  return [watch?.state ?? null, watch?.total ?? null];
}

/** The seconds a retry countdown shows ("Retrying in N s"), 0 while none is pending: a dep that changes when the
 * text would, so countdowns tick on time and nothing else re-renders. */
export const retryCountdown = (s, env) => (s.conn.retryAt === null ? 0
  : Math.max(0, Math.ceil((s.conn.retryAt - env.now) / MS_PER_S)));

/** Panels that read the presented timeline (rows drawn so far and their drives, status and box). */
const timelineDeps = (s) => [s.presented, s.timeline, s.anim.drawnThrough];
/** v1.2 (A8): panels that link plays to the field and mark the reviewed one (plays, drives, log read view.review). */
const reviewDeps = (s) => [...timelineDeps(s), s.view.review];

/** v1.2 (A9): the field host's view: fieldVm plus the store facts its #field hooks report (5.3): the drawn seq,
 * the queue, the playing seq and a rebuild (anim), the reviewed seq, and the presented epoch. */
export function fieldHostVm(pv) {
  const anim = pv?.anim ?? null;
  const epoch = pv?.presented?.timeline?.epoch;
  return Object.freeze({
    ...fieldVm(pv),
    anim: Object.freeze({
      drawnSeq: Number.isInteger(anim?.drawnThrough) ? anim.drawnThrough : 0,
      queue: Array.isArray(anim?.queue) ? anim.queue.length : 0,
      playingSeq: Number.isInteger(anim?.playing?.seq) ? anim.playing.seq : null,
      rebuilding: Boolean(anim?.rebuilding),
    }),
    reviewSeq: Number.isInteger(pv?.view?.review?.seq) ? pv.view.review.seq : null,
    epoch: typeof epoch === "string" && epoch !== "" ? epoch : null,
  });
}

const entry = (spec) => Object.freeze(spec);

/** Ids index.html provides (5.2, 9.1). A component must never remove one; shell/mount.js checks after each mount. */
export const SHELL_IDS = Object.freeze(["app", "rg-masthead", "rg-feed", "rg-scoreboard", "rg-situation", "rg-field",
  "rg-transport", "rg-call", "heroArea", "entry", "lastPlay", "manualEntry", "entryHint", "rg-flags", "flagPanel",
  "rg-plays", "rg-drives", "rg-wp", "rg-score", "kpiArea", "rg-box", "rg-tendencies", "rg-log", "logArea", "rg-conn",
  "rg-boot", "toast", "sc-notices"]);

export const COMPONENTS = Object.freeze([
  entry({ name: "boot-screen", region: "boot", root: "#rg-boot", label: "Loading screen", fallback: "boot",
    load: () => import("../ui/boot-screen.js"), select: bootVm, deps: (s, e) => [s.boot, s.conn, retryCountdown(s, e)] }),
  entry({ name: "conn-banner", region: "conn", root: "#rg-conn", label: "Connection banner",
    load: () => import("../ui/conn-banner.js"), select: connVm, deps: (s, e) => [s.conn, retryCountdown(s, e)] }),
  entry({ name: "toast", region: "toast", root: "#toast", label: "Messages", fallback: "toast",
    load: () => import("../ui/toast.js"), select: (pv) => pv.view.toast, deps: (s) => [s.view.toast] }),
  entry({ name: "masthead", region: "masthead", root: "#rg-masthead", label: "Header",
    load: () => import("../ui/masthead.js"), select: mastheadVm,
    deps: (s, e) => [s.presented, s.view.camera, s.view.booth, s.view.scorecardOpen, e.extras] }),
  entry({ name: "feed-bar", region: "feed", root: "#rg-feed", label: "ESPN feed bar",
    load: () => import("../ui/feed-bar.js"), select: feedVm, deps: (s) => [s.presented, s.version, s.view.bgMessage] }),
  entry({ name: "scoreboard", region: "scoreboard", root: "#rg-scoreboard", label: "Scoreboard",
    load: () => import("../ui/scoreboard.js"), select: scoreboardVm, deps: timelineDeps }),
  entry({ name: "situation-strip", region: "situation", root: "#rg-situation", label: "Situation strip",
    load: () => import("../ui/situation-strip.js"), select: situationVm,
    deps: (s) => [s.presented, s.view.sideAtFifty, s.view.stripRejected, s.timeline, s.anim.drawnThrough] }),
  // v1.2 (A9): fieldHostVm and the anim and review deps, so #field[data-drawn-seq], [data-queue] and the rest move.
  entry({ name: "field-host", region: "field", root: "#rg-field", label: "Field",
    load: () => import("../ui/field-host.js"), select: fieldHostVm,
    deps: (s, e) => [...timelineDeps(s), s.anim, s.view.review, e.extras] }),
  entry({ name: "review-banner", region: "field", root: "#rg-field", label: "Review banner",
    load: () => import("../ui/review-banner.js"), select: reviewVm,
    deps: (s) => [s.view.review, s.timeline, s.anim.drawnThrough] }),
  entry({ name: "watch-transport", region: "transport", root: "#rg-transport", label: "Watch controls",
    load: () => import("../ui/watch-transport.js"), select: transportVm, deps: (s) => [s.version, s.presented, s.prefs] }),
  // v1.4 (W5): the replay scrub appends after the transport in its region (as the review banner does beside the
  // field); it reads the drawn rows, the review cursor and the watch's state and total, nothing else.
  entry({ name: "scrub", region: "transport", root: "#rg-transport", label: "Replay scrub",
    load: () => import("../ui/scrub.js"), select: scrubVm,
    deps: (s) => [s.timeline, s.anim.drawnThrough, s.view.review, ...watchTotalDeps(s)] }),
  entry({ name: "prediction", region: "call", root: "#heroArea", label: "Next call",
    load: () => import("../ui/prediction.js"), select: predictionVm,
    deps: (s) => [s.presented, s.view.pick, s.view.hoverLeaf, ...inputModeDeps(s)] }),
  // v1.2 (A7): view.flag is a dep, so #flagBtn lights while the flag panel is open (entryVm.flagOpen).
  entry({ name: "entry-pad", region: "entry", root: "#entry", label: "Play entry pad",
    load: () => import("../ui/entry-pad.js"), select: entryVm,
    deps: (s) => [s.presented, s.view.pick, s.view.flag, ...inputModeDeps(s)] }),
  entry({ name: "last-play", region: "entry", root: "#lastPlay", label: "Last play",
    load: () => import("../ui/last-play.js"), select: lastPlayVm, deps: (s) => [s.presented, ...inputModeDeps(s)] }),
  entry({ name: "shorthand", region: "entry", root: "[data-mount=\"shorthand\"]", label: "Shorthand bar",
    load: () => import("../ui/shorthand.js"), select: () => null, deps: () => [] }),
  entry({ name: "flag-panel", region: "flags", root: "#flagPanel", label: "Flag panel",
    load: () => import("../ui/flag-panel.js"), select: flagsVm,
    deps: (s) => [s.presented, s.view.flag, s.view.pick, ...inputModeDeps(s)] }),
  entry({ name: "play-feed", region: "plays", root: "#rg-plays", label: "Play feed",
    load: () => import("../ui/play-feed.js"), select: playsVm, deps: reviewDeps }),
  entry({ name: "drive-chart", region: "drives", root: "#rg-drives", label: "Drive chart",
    load: () => import("../ui/drive-chart.js"), select: drivesVm, deps: reviewDeps }),
  entry({ name: "win-prob", region: "wp", root: "#rg-wp", label: "Win probability",
    load: () => import("../ui/win-prob.js"), select: wpVm, deps: timelineDeps }),
  entry({ name: "scorecard", region: "score", root: "#kpiArea", label: "Scorecard",
    load: () => import("../ui/scorecard.js"), select: scorecardVm, deps: (s) => [s.presented, s.view.scorecardOpen] }),
  entry({ name: "box-score", region: "box", root: "#rg-box", label: "Box score",
    load: () => import("../ui/box-score.js"), select: boxVm, deps: timelineDeps }),
  entry({ name: "tendencies", region: "tendencies", root: "#rg-tendencies", label: "Tendencies",
    load: () => import("../ui/tendencies.js"), select: tendenciesVm, deps: (s) => [s.presented] }),
  entry({ name: "play-log", region: "log", root: "#logArea", label: "Play log",
    load: () => import("../ui/play-log.js"), select: logVm, deps: reviewDeps }),
]);
