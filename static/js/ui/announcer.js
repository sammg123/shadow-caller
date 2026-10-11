// What assistive tech hears as the game goes (G2-6; ui-architecture 2.6; WCAG 4.1.3 status messages). DOM side, text
// only. Two visually hidden live regions, mounted once by main.js (shell bindings):
//   the log     (role=log, polite, additions) one line per newly drawn play: "Q1 12:41 DAL. Deep pass middle, +21.
//               Miss." The play's own words on the field (field/play-label.js), the verdict on his snaps. Only plays of
//               the game already on screen are read: the first state and another game (a replay, a watch start, an
//               undo's new epoch: the presented state's timeline epoch) read nothing out, and a burst (a hidden tab
//               coming back) only the newest three. The last 20 lines stay.
//   the status  (role=status, polite) what a key just changed: "Camera: Blimp", "Speed 4x", "Paused", "Playing",
//               "Live" (the page follows the live feed, restructure-v2.md 5).
// The board's own call announcement belongs to the prediction panel (G4-2).
import { keyContext, modeOf } from "../core/keymap.js";
import { LABEL_SEP, playLabel } from "../field/play-label.js";
import { qtrText } from "../model/format.js";
import { verdictOf, verdictText } from "../model/verdict.js";
import { el, setText } from "./dom.js";

const BURST = 3;                      // plays read out at most per update
const LOG_KEPT = 20;
const SESSION = new Set(["playing", "paused"]);
const LIVE_WORDS = "Live";
const FILLER = " ";              // repeated words still change the node, so they are heard again

const sentence = (text) => (/[.!?]$/.test(text) ? text : `${text}.`);

/** One play as a sentence: "{time} {team}. {play words}, {result}. {verdict}." ("" for a row that draws nothing). */
export function playLine(row) {
  const words = row && typeof row === "object" ? playLabel(row) : "";
  if (!words) return "";
  const when = [qtrText(row.qtr), typeof row.clock === "string" ? row.clock : "", row.team ?? ""]
    .filter((p) => typeof p === "string" && p !== "").join(" ");
  const verdict = row.offense_is_caller && row.pred ? verdictText(verdictOf(row.pred).key) : "";
  return [when, words.split(LABEL_SEP).join(", "), verdict].filter(Boolean).map(sentence).join(" ");
}

/**
 * What the announcer follows, from the presented view (pv, with the scheduler's extras: cameraModes). Pure.
 * @returns {{ epoch: string | null, drawnThrough: number, rows: object[], camera: string | null,
 *   watch: { state: string, speed: number | null } | null, live: boolean }}
 */
export function announcerVm(pv) {
  const ctx = keyContext({ server: pv.presented ?? null, version: pv.version ?? null, view: pv.view });
  const watch = pv.version?.watch ?? null;
  const modes = Array.isArray(pv.cameraModes) ? pv.cameraModes : [];
  const mode = modes.find((m) => m?.id === pv.view.camera);
  return Object.freeze({
    epoch: pv.presented?.timeline?.epoch ?? null, drawnThrough: pv.anim.drawnThrough, rows: pv.tl?.rows ?? [],
    camera: mode?.label ?? pv.view.camera ?? null,
    watch: watch ? Object.freeze({ state: watch.state ?? "idle", speed: watch.speed ?? null }) : null,
    live: modeOf(ctx) === "feed",
  });
}

/** Plays drawn since `prev`, when both show the same game (a known, unchanged epoch). */
function newLines(prev, next) {
  const sameGame = prev && prev.epoch !== null && next.epoch === prev.epoch;
  if (!sameGame || next.drawnThrough <= prev.drawnThrough) return [];
  return next.rows.filter((r) => r.seq > prev.drawnThrough && r.seq <= next.drawnThrough).map(playLine)
    .filter(Boolean).slice(-BURST);
}

function watchWords(prev, next) {
  const [a, b] = [prev.watch, next.watch];
  if (!a || !b || !SESSION.has(a.state) || !SESSION.has(b.state)) return [];
  const words = [];
  if (b.state !== a.state) words.push(b.state === "paused" ? "Paused" : "Playing");
  if (b.speed !== a.speed && Number.isFinite(b.speed)) words.push(`Speed ${b.speed}x`);
  return words;
}

function statusWords(prev, next) {
  if (!prev) return null;
  const words = [
    ...(next.camera && prev.camera && next.camera !== prev.camera ? [`Camera: ${next.camera}`] : []),
    ...watchWords(prev, next),
    ...(next.live && !prev.live ? [LIVE_WORDS] : []),
  ];
  return words.length ? words.join(". ") : null;
}

/** The lines to add to the log and the status words (or null) from one view to the next. Pure. */
export function announce(prev, next) {
  return { lines: newLines(prev, next), status: statusWords(prev, next), vm: next };
}

/**
 * @param {Document} doc
 * @param {Element} [parent]  where the two regions live (default: the body)
 * @returns {{ update(vm: ReturnType<typeof announcerVm>): void, destroy(): void }}
 */
export function mountAnnouncer(doc, parent = doc.body) {
  const log = el("div", { cls: "sr-only", data: { testid: "announcer-log" }, attrs: { role: "log",
    "aria-live": "polite", "aria-relevant": "additions", "aria-label": "Plays as they happen" } });
  const status = el("p", { cls: "sr-only", data: { testid: "announcer-status" },
    attrs: { role: "status", "aria-live": "polite" } });
  parent.appendChild(log);
  parent.appendChild(status);
  let prev = null;
  return {
    update(vm) {
      if (!vm) return;
      const out = announce(prev, vm);
      prev = out.vm;
      for (const line of out.lines) log.appendChild(el("p", { text: line }));
      while (log.childNodes.length > LOG_KEPT) log.firstChild.remove();
      if (out.status) setText(status, status.textContent === out.status ? `${out.status}${FILLER}` : out.status);
    },
    destroy() {
      log.remove();
      status.remove();
    },
  };
}
