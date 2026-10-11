// Every string the Model Report shows (pure; docs/design/restructure-v2.md section 6), in the app's plain football
// language (model/copy.js's voice). Team and caller names always come in as arguments: nothing here is specific to
// Dallas. Sentence case here; a world sets captions in caps with text-transform (DESIGN.md, The Caps Rule). The page's
// fixed words (its title, the GameCast and CSV keys, the boards' first plates) are in static/report.html, so they read
// before any script runs.

/** The one empty line every board of his calls shows before his first snap (restructure-v2 section 6). */
const NO_CALLS = "No calls yet: his first snap hasn't happened.";
/** Calls, but none graded on the specific play (a model of run or pass only, or a game file from before). */
const NO_PLAY_GRADES = "No call graded on the specific play yet.";

export const REPORT = Object.freeze({
  who: (last, team) => [`Shadowing ${last}`, team].filter(Boolean).join(" · "),
  status: Object.freeze({
    final: "Final",
    live: "ESPN live",
    watching: (speed) => `Watching at ${speed}x`,
    paused: "Paused",
    pre: "Before kickoff",
  }),
  /** When and where a call came: "Snap 47 · Q4 5:35 · 1st & 10 at TB 18" (a play a flag wiped out has no snap). */
  when: (snap, time, situation) => [snap ? `Snap ${snap}` : "", time, situation].filter(Boolean).join(" · "),
  /** The words a screen reader hears for the score line: "TB 24, DAL 16. Final." */
  spoken: (score, status) => [score, status].filter(Boolean).map((s) => `${s}.`).join(" "),
});

export const NIGHT = Object.freeze({
  heading: (last) => `${last} so far`,
  headingPlain: "His night so far",
  top1: "Top pick",
  top3: "In his top 3",
  of: (n) => (n === 1 ? "of 1 call" : `of ${n} calls`),
  recent: "Last 6",
  marks: Object.freeze({ top1: "✓", miss: "✗" }),
  verdict: Object.freeze({ top1: "Top pick", top3: "In his top 3", miss: "Miss" }),
  inTop3: (rank) => `In his top 3, #${rank}`,
  trackTitle: "Every call, in order",
  trackAria: "Every call he made, in order. Bar height is the model's chance on the play he called.",
  bar: (snap, time, verdict, called, chance) =>
    `${snap ? `Snap ${snap}, ` : ""}${time}: ${verdict}. ${called}: ${chance}.`,
  legendNote: "Bar height: the model's chance on the play he called. Numbers: his biggest surprises.",
  empty: NO_CALLS,
});

export const LEAGUE = Object.freeze({
  plate: (last) => `${last}'s scorecard`,
});

export const CALLS = Object.freeze({
  heading: "Every call v the model",
  count: (n) => (n === 1 ? "1 call" : `${n} calls`),
  columns: Object.freeze(["#", "Time", "Situation", "His top 3", "He called", "Rank", "Verdict"]),
  caption: "Every snap he called: the model's top 3 before it with their chances, what he called, its rank among "
    + "the specific plays, and how it graded.",
  drive: (label, summary) => [label, summary].filter(Boolean).join(" · "),
  calledMark: "He called this",
  noPlay: "No play",
  empty: NO_CALLS,
});

export const HIT_RATE = Object.freeze({
  heading: "Hit rate by down and distance",
  columns: Object.freeze(["Situation", "Calls", "Top pick", "In his top 3", "League top 3"]),
  labels: Object.freeze({
    "1st": "1st down", "2nd-short": "2nd & short", "2nd-medium": "2nd & medium", "2nd-long": "2nd & long",
    "3rd-short": "3rd & short", "3rd-medium": "3rd & medium", "3rd-long": "3rd & long", "4th": "4th down",
  }),
  hints: Object.freeze({ short: "1 to 3 yds", medium: "4 to 6 yds", long: "7+ yds" }),
  total: "All downs",
  leads: Object.freeze({ shadow: "His model leads", league: "League leads", even: "Even" }),
  cellsAria: (label, top1, top3, calls) => `${label}: ${top1} top picks and ${top3} in his top 3, of ${calls} calls`,
  note: "Counted on the specific play, as the scorecard counts it. League top 3 is the caller-blind league baseline's "
    + "top 3 on the same snaps.",
  empty: NO_CALLS,
  noPlayGrades: NO_PLAY_GRADES,
});

export const SURPRISES = Object.freeze({
  heading: "His biggest surprises",
  sub: "The calls the model gave the lowest chance.",
  called: "He called",
  modelPick: "Model's pick",
  rankOf: (rank, total) => (total > 0 ? `#${rank} of ${total}` : `#${rank}`),
  empty: NO_CALLS,
  noPlayGrades: NO_PLAY_GRADES,
});

export const MEMORY = Object.freeze({
  heading: "In-game memory",
  sub: "Snaps where the model tilted his call away from the league: his habits and the game so far, in points of "
    + "pass chance.",
  tilt: Object.freeze({ pass: "Tilts pass", run: "Tilts run" }),
  habits: "His habits",
  memory: "In-game memory",
  pts: (x) => `${x} pts`,
  called: "He called",
  side: Object.freeze({ pass: "pass", run: "run" }),
  outcome: Object.freeze({ true: "Came true", missed: "Didn't come true" }),
  tilts: "Tilts that came true",
  of: (hits, n) => `${hits} of ${n}`,
  script: (n) => `Memory switches on after snap ${n}.`,
  noTilts: "No tilts yet: memory hasn't pushed a call away from the league.",
  empty: NO_CALLS,
});

/** The drive chart's button words on this page (every drive's tooltip, so true of an opponent's disabled drive too):
 * a drive of his jumps to its calls in the table. */
export const DRIVE_LINKS = Object.freeze({
  review: "His drives open their calls in the table below",
});
