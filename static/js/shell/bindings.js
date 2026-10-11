// The component table (ui-architecture.md 2.6 and 9.1; owner A0): where each component mounts, how it loads, the
// view model it renders and the deps that decide when it re-renders. main.js mounts the entries in this order and
// hands them to the scheduler. Loaders are functions, so a component module is fetched only by main.js and a broken
// one never breaks this module. deps(state, env) lists the state values the view model reads (compared by
// identity); env = { now, extras }. `fallback` names a built-in stand-in (shell/mount.js) for the two pieces that
// must never go missing: the boot screen and the toast.
// restructure-v2.md 1 and 2: the home page is the GameCast and the prediction. The top bar (#rg-masthead) holds three
// components in reading order: the nameplate and current game, the view keys (camera, Model Report, settings), then
// the playback, which a world lays out as the bar's second row.
import { bootVm, connVm } from "../model/vm-conn.js";
import { drivesVm } from "../model/vm-drives.js";
import { fieldVm } from "../model/vm-field.js";
import { mastheadVm } from "../model/vm-masthead.js";
import { playsVm } from "../model/vm-plays.js";
import { predictionVm } from "../model/vm-prediction.js";
import { scoreboardVm } from "../model/vm-scoreboard.js";
import { transportVm } from "../model/vm-transport.js";
import { viewKeysVm } from "../model/vm-view-keys.js";
import { wpVm } from "../model/vm-wp.js";

const MS_PER_S = 1000;

/** The seconds a retry countdown shows ("Retrying in N s"), 0 while none is pending: a dep that changes when the
 * text would, so countdowns tick on time and nothing else re-renders. */
export const retryCountdown = (s, env) => (s.conn.retryAt === null ? 0
  : Math.max(0, Math.ceil((s.conn.retryAt - env.now) / MS_PER_S)));

/** Panels that read the presented timeline (rows drawn so far and their drives, status and box). */
const timelineDeps = (s) => [s.presented, s.timeline, s.anim.drawnThrough];

/** v1.2 (A9): the field host's view: fieldVm plus the store facts its #field hooks report (5.3): the drawn seq,
 * the queue, the playing seq and a rebuild (anim), and the presented epoch. */
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
    epoch: typeof epoch === "string" && epoch !== "" ? epoch : null,
  });
}

const entry = (spec) => Object.freeze(spec);

/** Ids index.html provides (5.2, 9.1). A component must never remove one; shell/mount.js checks after each mount. */
export const SHELL_IDS = Object.freeze(["app", "rg-masthead", "rg-plays", "rg-scoreboard", "rg-field", "rg-call",
  "heroArea", "rg-drives", "rg-wp", "rg-conn", "rg-boot", "toast", "sc-notices"]);

export const COMPONENTS = Object.freeze([
  entry({ name: "boot-screen", region: "boot", root: "#rg-boot", label: "Loading screen", fallback: "boot",
    load: () => import("../ui/boot-screen.js"), select: bootVm,
    deps: (s, e) => [s.boot, s.conn, s.view.playback, retryCountdown(s, e)] }),
  entry({ name: "conn-banner", region: "conn", root: "#rg-conn", label: "Connection banner",
    load: () => import("../ui/conn-banner.js"), select: connVm, deps: (s, e) => [s.conn, retryCountdown(s, e)] }),
  entry({ name: "toast", region: "toast", root: "#toast", label: "Messages", fallback: "toast",
    load: () => import("../ui/toast.js"), select: (pv) => pv.view.toast, deps: (s) => [s.view.toast] }),
  entry({ name: "masthead", region: "masthead", root: "#rg-masthead", label: "Header",
    load: () => import("../ui/masthead.js"), select: mastheadVm,
    deps: (s) => [s.presented, s.timeline.teams] }),   // the game's status rides on /api/state's watch only
  entry({ name: "view-keys", region: "masthead", root: "#rg-masthead", label: "View keys",
    load: () => import("../ui/view-keys.js"), select: viewKeysVm,
    deps: (s, e) => [s.view.camera, s.view.settingsOpen, e.extras] }),
  entry({ name: "watch-transport", region: "masthead", root: "#rg-masthead", label: "Playback controls",
    load: () => import("../ui/watch-transport.js"), select: transportVm,
    deps: (s) => [s.version, s.presented, s.prefs.watchSpeed, s.view.playback, s.timeline.teams] }),
  entry({ name: "play-feed", region: "plays", root: "#rg-plays", label: "Play feed",
    load: () => import("../ui/play-feed.js"), select: playsVm, deps: timelineDeps }),
  entry({ name: "scoreboard", region: "scoreboard", root: "#rg-scoreboard", label: "Scoreboard",
    load: () => import("../ui/scoreboard.js"), select: scoreboardVm, deps: timelineDeps }),
  // v1.2 (A9): fieldHostVm and the anim deps, so #field[data-drawn-seq], [data-queue] and the rest move.
  entry({ name: "field-host", region: "field", root: "#rg-field", label: "Field",
    load: () => import("../ui/field-host.js"), select: fieldHostVm,
    deps: (s, e) => [...timelineDeps(s), s.anim, e.extras] }),
  // restructure-v2.md section 3: the board shows his previous play (the drawn rows' words), the next call (or who has
  // the ball, ESPN's status) and his last six at once; it reads no input mode and nothing typed
  entry({ name: "prediction", region: "call", root: "#heroArea", label: "Next call",
    load: () => import("../ui/prediction.js"), select: predictionVm,
    deps: (s) => [s.presented, s.view.hoverLeaf, s.timeline, s.anim.drawnThrough] }),
  entry({ name: "drive-chart", region: "drives", root: "#rg-drives", label: "Drive chart",
    load: () => import("../ui/drive-chart.js"), select: drivesVm, deps: timelineDeps }),
  entry({ name: "win-prob", region: "wp", root: "#rg-wp", label: "Win probability",
    load: () => import("../ui/win-prob.js"), select: wpVm, deps: timelineDeps }),
]);
