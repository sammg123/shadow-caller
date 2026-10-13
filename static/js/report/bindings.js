// The Model Report's component table (shell/bindings.js's shape; restructure-v2.md section 6): where each board
// mounts, how it loads, the view model it renders and the deps that decide when it re-renders. Loaders are functions,
// so a board's module is fetched only by report/main.js and a broken one leaves a visible notice while the rest load.
// The app's own boards (scorecard, tendencies, win probability, drives, team stats) are imported unchanged and hung in
// a report frame (ui/framed.js). deps(state, env) lists the state values a view model reads, compared by identity.
// With both play-callers tracked (restructure-v2.md 11 decision 4) his boards (his night, scorecard, hit rate,
// surprises, tendencies, memory, every call) read the shown caller's view (model/side.js sidePv) and name the viewer's
// pick (env.extras.sideChoice, report/main.js) in their deps, so a switch re-renders them; the win probability, the
// drives and the team stats stay the game's. With one caller sidePv(pv) is pv itself.
import { boxVm } from "../model/vm-box.js";
import { bootVm, connVm } from "../model/vm-conn.js";
import { wpVm } from "../model/vm-wp.js";
import { reportDrivesVm } from "./model/drives.js";
import { sidePv } from "./model/side.js";
import { reportTendenciesVm } from "./model/tendencies.js";
import { callsVm } from "./model/vm-calls.js";
import { headVm } from "./model/vm-head.js";
import { hitRateVm } from "./model/vm-hit-rate.js";
import { leagueVm } from "./model/vm-league.js";
import { memoryVm } from "./model/vm-memory.js";
import { nightVm } from "./model/vm-night.js";
import { surprisesVm } from "./model/vm-surprises.js";

const MS_PER_S = 1000;

/** The seconds a retry countdown shows, 0 while none is pending (shell/bindings.js's rule, for the same screens). */
export const retryCountdown = (s, env) => (s.conn.retryAt === null ? 0
  : Math.max(0, Math.ceil((s.conn.retryAt - env.now) / MS_PER_S)));

/** The viewer's pick of a caller (report/main.js puts it in the scheduler's extras); null until he picks. */
const sideChoiceOf = (env) => (env && env.extras && typeof env.extras.sideChoice === "string"
  ? env.extras.sideChoice : null);

/** Boards that read the presented timeline (his calls, drives, status and box) and the presented state. */
const timelineDeps = (s) => [s.presented, s.timeline, s.anim.drawnThrough];
/** His boards also read whose calls the viewer picked. */
const hisDeps = (s, e) => [...timelineDeps(s), sideChoiceOf(e)];
const hisStateDeps = (s, e) => [s.presented, sideChoiceOf(e)];
/** The ribbon also reads the freshest watch and feed (/api/version), and holds the switch between the callers. */
const headDeps = (s, e) => [...timelineDeps(s), s.version, sideChoiceOf(e)];

/** A board of his: its view model on the shown caller's view. */
const his = (vm) => (pv) => vm(sidePv(pv));

/** An app board in a report frame: the frame and the board's module load together, lazily. */
const framedLoad = (load, opts) => async () => (await import("./ui/framed.js")).framed(await load(), opts);

const entry = (spec) => Object.freeze(spec);

/** Ids report.html provides; a board must never remove one (shell/mount.js checks after each mount). */
export const REPORT_IDS = Object.freeze(["report", "rp-head", "rp-back", "rp-csv", "rp-main", "rp-night", "rp-league",
  "rp-situations", "rp-surprises", "rp-memory", "rp-tendencies", "rp-wp", "rp-drives", "rp-box", "rp-calls",
  "rp-analyst", "rg-conn", "rg-boot", "sc-notices"]);

export const REPORT_COMPONENTS = Object.freeze([
  entry({ name: "boot-screen", region: "boot", root: "#rg-boot", label: "Loading screen", fallback: "boot",
    load: () => import("../ui/boot-screen.js"), select: bootVm,
    deps: (s, e) => [s.boot, s.conn, retryCountdown(s, e)] }),
  entry({ name: "conn-banner", region: "conn", root: "#rg-conn", label: "Connection banner",
    load: () => import("../ui/conn-banner.js"), select: connVm, deps: (s, e) => [s.conn, retryCountdown(s, e)] }),
  entry({ name: "head", region: "head", root: "[data-mount=\"head\"]", label: "Header",
    load: () => import("./ui/head.js"), select: headVm, deps: headDeps }),
  entry({ name: "night", region: "night", root: "#rp-night", label: "His night so far",
    load: () => import("./ui/night.js"), select: his(nightVm), deps: hisDeps }),
  entry({ name: "league", region: "league", root: "#rp-league", label: "Shadow v League",
    load: framedLoad(() => import("../ui/scorecard.js"), { plate: (vm) => vm.plate, testid: "report-league" }),
    select: his(leagueVm), deps: hisStateDeps }),
  entry({ name: "hit-rate", region: "situations", root: "#rp-situations", label: "Hit rate by down and distance",
    load: () => import("./ui/hit-rate.js"), select: his(hitRateVm), deps: hisDeps }),
  entry({ name: "surprises", region: "surprises", root: "#rp-surprises", label: "His biggest surprises",
    load: () => import("./ui/surprises.js"), select: his(surprisesVm), deps: hisDeps }),
  entry({ name: "memory", region: "memory", root: "#rp-memory", label: "In-game memory",
    load: () => import("./ui/memory.js"), select: his(memoryVm), deps: hisDeps }),
  entry({ name: "tendencies", region: "tendencies", root: "#rp-tendencies", label: "His tendencies",
    load: framedLoad(() => import("../ui/tendencies.js"), { plate: (vm) => vm.title, testid: "report-tendencies" }),
    select: his(reportTendenciesVm), deps: hisStateDeps }),
  entry({ name: "win-prob", region: "wp", root: "#rp-wp", label: "Win probability",
    load: framedLoad(() => import("../ui/win-prob.js"), { plate: (vm) => vm.heading, testid: "report-wp" }),
    select: wpVm, deps: timelineDeps }),
  entry({ name: "drive-chart", region: "drives", root: "#rp-drives", label: "Drive chart",
    load: framedLoad(() => import("../ui/drive-chart.js"), { plate: (vm) => vm.heading, testid: "report-drives" }),
    select: reportDrivesVm, deps: timelineDeps }),
  entry({ name: "box-score", region: "box", root: "#rp-box", label: "Team stats",
    load: framedLoad(() => import("../ui/box-score.js"), { plate: (vm) => vm.heading, testid: "report-box" }),
    select: boxVm, deps: timelineDeps }),
  entry({ name: "calls", region: "calls", root: "#rp-calls", label: "Every call v the model",
    load: () => import("./ui/calls.js"), select: his(callsVm), deps: hisDeps }),
]);
