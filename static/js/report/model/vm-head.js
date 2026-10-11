// The Model Report's ribbon (pure): who the page shadows ("Shadowing Schottenheimer · DAL"), the game, the
// score away first with the teams' logos (both variants, from the app's own logo proxy only, DC C2), and a status
// lamp: final, a watch playing back or paused, the ESPN feed live, or the game clock. `word` is the status without the
// clock: what the page says aloud when it changes (the clock ticks on screen, not in a screen reader's ear).
import { freezeDeep } from "../../model/format.js";
import { lastNameOf } from "../../model/vm-masthead.js";
import { isFinal, scoreboardVm } from "../../model/vm-scoreboard.js";
import { watchOf } from "../../model/vm-transport.js";
import { REPORT } from "./copy.js";

const SPEED_DECIMALS = 10;
const str = (v) => (typeof v === "string" ? v : "");
const speedText = (speed) => (Number.isFinite(speed)
  ? String(Math.round(speed * SPEED_DECIMALS) / SPEED_DECIMALS) : "");

function clockOf(board) {
  return board.state === "in" ? [board.qtrText, board.clock].filter(Boolean).join(" ") : "";
}

const status = (tone, word, clock = "") => ({ tone, text: [word, clock].filter(Boolean).join(" · "), word });

function feedLive(pv) {
  const feed = (pv && pv.version && pv.version.feed) || (pv && pv.presented && pv.presented.feed) || null;
  return Boolean(feed && feed.on && feed.state === "live");
}

/** Final, then a watch playing back or paused, then the ESPN feed, then the game clock. */
function statusOf(pv, board) {
  const clock = clockOf(board);
  const watch = watchOf(pv);
  if (isFinal(pv)) return status("final", REPORT.status.final);
  if (watch && watch.state === "playing") return status("live", REPORT.status.watching(speedText(watch.speed)), clock);
  if (watch && watch.state === "paused") return status("paused", REPORT.status.paused, clock);
  if (feedLive(pv)) return status("live", REPORT.status.live, clock);
  if (board.state === "pre" && board.teams.length) return status("idle", REPORT.status.pre);
  return { tone: "idle", text: clock, word: "" };
}

function whoOf(presented) {
  const profile = presented && presented.profile;
  const last = lastNameOf(profile && profile.caller);
  return last ? REPORT.who(last, str(profile.team)) : "";
}

/**
 * @param {object} pv  presented view
 * @returns {object} frozen {who, game, teams: {abbr, score, logo, logoDark, caller}[], status: {tone, text, word},
 *   spoken}
 */
export function headVm(pv) {
  const presented = pv && pv.presented;
  const board = scoreboardVm(pv);
  const teams = board.teams.map((t) => ({ abbr: t.abbr, score: t.score, logo: t.logo, logoDark: t.logoDark,
    caller: t.caller }));
  const now = statusOf(pv, board);
  const score = teams.filter((t) => t.score !== "").map((t) => `${t.abbr} ${t.score}`).join(", ");
  return freezeDeep({
    who: whoOf(presented), game: str(presented && presented.game && presented.game.label),
    teams, status: now, spoken: REPORT.spoken(score, now.word),
  });
}
