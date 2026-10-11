// Every client-side string (pure). FI sections 1 to 3 verbatim where the current UI says it; new features
// (the top bar, camera, scoreboard, play feed, connection) in the same plain football language. The page takes no
// user input into the game (restructure-v2.md 1), so there is no entry, flag, shorthand or strip copy.
// Team names always come in as arguments: nothing here is specific to Dallas (G13).

export const APP = Object.freeze({
  title: "Shadow Play-Caller",
});

// restructure-v2.md 2: the top bar's nameplate, its current game (phase 2 puts the game picker there) and its view keys
export const MASTHEAD = Object.freeze({
  camera: "Camera",
  cameraTitle: "Wide or Blimp (V)",
  report: "Model Report",
  reportTitle: "How the model did: every call, the scorecard, his tendencies",
  ask: "Ask",
  settings: "Settings",
  settingsTitle: "Display settings",
  // v1.5 (G4-2): the nameplate's short line names the caller this app shadows (his last name, model/vm-masthead.js);
  // the full words ride on the plate's tooltip
  whoLabel: (last, team) => `Shadowing ${last} · ${team}`,
  whoTitle: (caller, team) => `Modelling ${caller} (${team} offense)`,
  game: (away, home) => `${away} at ${home}`,
  gameDetail: (game, detail) => `${game} · ${detail}`,
  viewGroup: "View",
});

export const PREDICTION = Object.freeze({
  // v1.5 (G4-2): the board's plate names the caller it shadows (his last name); a long name falls back to the plain one
  nextCall: (last) => `${last}'s next call`,
  nextCallPlain: "Next call",
  then: "Then",
  snap: (n) => `Snap ${n}`,
  // v1.5 (G4-4): the model has no kick class, so on 4th down the call is the play he'd run if he goes for it
  fourthDown: "4th down · if he goes for it",
  fourthDownTitle: "On 4th down this is the play he'd call if he goes for it. The model has no punt or field-goal "
    + "class, so it can't say whether he kicks.",
  pillTitle: "Pass vs run against the league",
  // v1.5 (G4-6): the tilt tag's words. The server's flag compares his pass rate here with the league's: "no edge"
  // means he calls it like the league does, never that the model has no edge
  flagText: Object.freeze({
    none: "Like the league",
    lean: (side) => (side ? `Leans ${side}` : "Leans"),
    tilt: (side) => (side ? `Tilts ${side}` : "Tilts"),
  }),
  // v1.5 (G4-2): what the board's live region says when a new call lands
  spokenCall: (snap, name, pct) => `Next call${Number.isInteger(snap) ? `, snap ${snap}` : ""}: ${name}, ${pct} percent.`,
  spokenThen: (name, pct) => `Then ${name}, ${pct} percent.`,
  spokenFourth: "Fourth down, if he goes for it.",
  splitAria: "Pass versus run",
  splitPass: (p) => `Ball thrown or dropback ${p}`,
  splitLeague: (p) => `League ${p} (dashed)`,
  splitRun: (p) => `Handed off or kept ${p}`,
  league: (p) => `League ${p}`,
  hotUpGlyph: "▲",
  hotDownGlyph: "▼",
  hotUp: "Well above the league",
  hotDown: "Well below the league",
  // restructure-v2.md: no user input into the game, so a play on the board is shown on the field, never picked
  legend: "▲ ▼ = at least 4 points and 30% above or below the league for this exact situation. Bars are scaled to the top pick. Point at a play to see its shadow on the field.",
  leafTitle: "Shows this play's shadow on the field",
  habits: "pass pts from his habits here",
  scriptPts: "—",
  script: (n) => `Opening script: memory switches on after snap ${n}`,
  scriptNoCount: "Opening script: memory switches on after the opening snaps",
  // restructure-v2.md section 3: NEXT CALL while his offense doesn't have the ball (ESPN's possession)
  hasBall: (team) => `${team} has the ball`,
  kicksOff: (team) => `${team} kicks off`,
  waiting: (off) => `When ${off} gets the ball, his next call appears here.`,
  // restructure-v2.md section 3: PREVIOUS PLAY (his most recent call) and LAST 6 with his night so far
  previousPlate: "Previous play",
  spokenPrevious: (snap) => `Previous play${Number.isInteger(snap) ? `, snap ${snap}` : ""}:`,
  soFar: (last) => `${last} so far`,
  soFarPlain: "So far",
  lead: Object.freeze({ td: "Touchdown", int: "Intercepted", fumble: "Fumble lost", turnover: "Turnover" }),
  predicted: "Predicted",
  tallyTop1: "Top pick",
  tallyTop3: "In his top 3",
  recentLabel: "Last 6",
  recentTop3: (rank) => `In his top 3 (#${rank})`,
  // a call a flag wiped out is graded but has no snap number, so the tally says how its calls split
  callsNote: (calls, snaps, wiped) => `${calls} calls: ${snaps} snaps and ${wiped} wiped out by `
    + (wiped === 1 ? "a flag" : "flags"),
  spokenPredicted: (call, pct) => `Predicted ${call}, ${pct}`,
  // v1.5 (G4-1): at the final whistle NEXT CALL shows the score and the way to the full scorecard, which lives in the
  // Model Report (restructure-v2.md section 6; no SHADOW v LEAGUE numbers on the home page)
  finalPlate: "Final",
  finalKey: "Tonight's scorecard",
  finalKeyTitle: "The full scorecard is in the Model Report",
});

export const SCORECARD = Object.freeze({
  heading: "Tonight's scorecard",
  empty: "Scores appear after the first logged snap.",
  leafTitle: (n) => `Specific play (${n} snaps)`,
  familyTitle: (n) => `Play type (${n} snaps)`,
  passRunTitle: (n) => `Pass vs run (${n} snaps)`,
  of: (hits, n) => `${hits} of ${n}`,
  topPick: "Top pick was right",
  top3: (league) => `Actual play in his top 3 (league ${league})`,
  hisLogloss: "His model, log loss",
  leagueLogloss: "League, log loss",
  familyTop: "Most likely type was right",
  familyLogloss: (league) => `Log loss (league ${league})`,
  passRunLogloss: (league) => `His model, log loss (league ${league})`,
  calledRight: (league) => `Run or pass called right (league ${league})`,   // v1.5 (G4-3): what it measures
  tilts: "Tilts that came true",
  passRate: "Pass rate tonight",
  note: "Lower log loss is better. One game is a pipeline test, not proof.",
  shadow: "Shadow",
  leagueSide: "League",
  // v1.5 (G4-3): "called right" is pass or run only (live.py acc), so the pair says so; the top-3 caption is short
  pairCalledRight: "Run/pass right",
  pairTop3: "Play in top 3",
  pairPassRun: "Pass vs run log loss",
  pairFamily: "Play type log loss",
  pairLeaf: "Specific play log loss",
  basis: (n) => (n === 1 ? "1 snap" : `${n} snaps`),
  // v1.5 (G4-3): the basis said once, under SHADOW v LEAGUE, when every pair counts the same snaps
  basisLine: (basis) => `his model v league baseline · ${basis}`,
  basisLinePlain: "his model v league baseline",
  // v1.2 (A8): the SHADOW v LEAGUE block of the scorecard
  pairsHeading: "Shadow v League",
  pairsLegend: "Shadow is his model. League is the caller-blind league baseline.",
  versus: "v",
  leads: Object.freeze({ shadow: "Shadow leads", league: "League leads", even: "Even" }),
});

export const TENDENCIES = Object.freeze({
  title: (caller) => `${String(caller).trim().split(/\s+/).pop()}'s tendencies`,
  fallbackTitle: "His tendencies",
  termsHeading: "Pass vs run terms",
  plotAria: "His pass-run tendency terms with 90 percent intervals",
  moreRun: "more run",
  morePass: "more pass",
  note: (snaps, games, seasons) => `${snaps} snaps, ${games} games (${seasons}). Filled dots: 90% interval excludes zero.`,
  mixHeading: "His play-type mix vs expected",
  expected: (p) => `exp. ${p}`,
  heldOut: (top1, top3, n) => `Held-out check: his top pick for the specific play was right ${top1} of the time; the actual play was in his top 3 ${top3} of the time (${n} snaps).`,
  // v1.2 (A8): group captions and what each plotted row says to a screen reader
  groups: Object.freeze({ habit: "His habits", memory: "In-game memory" }),
  leans: Object.freeze({ pass: "leans pass", run: "leans run" }),
  sure: "90% interval excludes zero",
  unsure: "90% interval includes zero",
});

// A logged call's words (model/vm-log.js); the play log itself is the Model Report's calls table (restructure-v2.md 6)
export const LOG = Object.freeze({
  legacyCall: Object.freeze({ R: "Run", P: "Pass", SC: "Scramble", S: "Sack" }),
});

export const PLAYS = Object.freeze({
  heading: "Plays",
  verdict: Object.freeze({ top1: "Top pick", top3: "In his top 3", miss: "Miss", none: "" }),
  unlinked: (n) => (n === 1 ? "1 hand-entered play isn't on the field" : `${n} hand-entered plays aren't on the field`),
  // v1.2 (A8): empty feed and row marks (a row retagged before restructure-v2.md says so)
  empty: "Plays appear here as they happen, newest first.",
  noPlay: "No play",
  retagged: "retagged",
  inProgress: "Drive in progress",
});

export const DRIVES = Object.freeze({
  heading: "Drives",
  plays: (n) => `${n} ${n === 1 ? "play" : "plays"}`,
  yards: (n) => `${n} yds`,
  label: (team, result) => (result ? `${team} ${result}` : `${team} drive`),
  // v1.2 (A8): empty chart and what clicking a drive does (restructure-v2.md 5: the game jumps to that play)
  empty: "Drives appear after the first play.",
  review: "Show this drive's first play on the field",
  now: "Now",
});

export const WP = Object.freeze({
  heading: "Win probability",
  aria: (team, p) => `${team} win probability ${p}`,
  // at kickoff, before ESPN's first number: no play is applied yet, so the server's timeline isn't ESPN's (DC D)
  unavailable: "Win probability appears after the first play.",
  // v1.2 (A8): the chart's axis words
  quarters: Object.freeze(["Q1", "Q2", "Q3", "Q4"]),
  overtime: "OT",
  even: "50%",
  waiting: "The line starts with the first play.",
});

export const BOX = Object.freeze({
  heading: "Team stats",
  firstDowns: "First downs",
  passFirstDowns: "Passing first downs",
  rushFirstDowns: "Rushing first downs",
  penFirstDowns: "First downs by penalty",
  third: "3rd down",
  fourth: "4th down",
  plays: "Total plays",
  yards: "Total yards",
  passYards: "Passing yards",
  compAtt: "Comp-Att",
  sacks: "Sacks-Yards lost",
  interceptions: "Interceptions thrown",
  rushYards: "Rushing yards",
  rushAtt: "Rushing attempts",
  penalties: "Penalties",
  turnovers: "Turnovers",
  fumblesLost: "Fumbles lost",
  possession: "Possession",
  pair: (a, b) => `${a}-${b}`,
  // v1.2 (A8): which box is showing (ESPN's own when the server sends it, ui-architecture Appendix B), and the empty line
  sourceEspn: "ESPN box score",
  sourceDerived: "Counted from the plays on the field",
  empty: "Team stats appear after the first play.",
});

export const SCOREBOARD = Object.freeze({
  qtr: "Qtr",
  time: "Time",
  est: "est.",
  estTitle: "Estimated from the snaps since ESPN's last clock",
  down: "Down",
  ballOn: "Ball on",
  timeouts: "Timeouts",
  logoAlt: (name) => `${name} logo`,
  // v1.2 (A8)
  aria: "Scoreboard",
  hasBall: "has the ball",
  timeoutsLeft: (n) => `${n} ${n === 1 ? "timeout" : "timeouts"} left`,
  final: "Final",
});

// restructure-v2.md 2: the top bar's playback, clear words a first-time viewer understands; each key's tooltip names
// the keyboard key that does the same
export const WATCH = Object.freeze({
  group: "Playback",
  back: "Back",
  backTitle: "One play back (Left arrow)",
  play: "Play",
  pause: "Pause",
  playTitle: "Play or pause (Space)",
  forward: "Forward",
  forwardTitle: "One play forward (Right arrow)",
  speed: (n) => `${n}x`,
  speedGroup: "Playback speed",
  speedTitle: (n, key) => `Play at ${n}x (${key})`,
  progress: "Game progress",
  progressTitle: "Click or drag to jump to any play",
  count: (idx, total) => `${idx} / ${total}`,
  position: (idx, total) => `Play ${idx} of ${total}`,
  kickoff: "Kickoff",
  final: "Final",
  live: "Live",
  reset: "Reset",
  resetTitle: "Back to kickoff, paused",
  goLive: "Go Live",
  goLiveTitle: "Jump to the latest play (Esc)",
});

export const FIELD = Object.freeze({
  label: "Football field",   // v1.2 (A9): #field's name before a game is loaded
  legend: "Ball shown mid-field; ESPN gives no hash.",
  // play-drawing.md 4b: the style key on the field's edge while his next call is up (last play / next 1 / next 2)
  key: Object.freeze({ last: "Last play", next1: "Next 1", next2: "Next 2" }),
  ballOn: (spot) => `Ball on ${spot}.`,
  downDistance: (text) => `${text}.`,
  lineToGain: (ltg) => `Line to gain ${ltg}.`,
  goalLine: "the goal line",
  kickoff: (team, spot) => `Kickoff, ${team} from ${spot}.`,
  offField: (team) => `${team} off the field.`,
});

export const CONN = Object.freeze({
  retrying: "Reconnecting…",
  offline: (s) => `Can't reach the app server. Retrying in ${s} s.`,
  retryingNow: "Can't reach the app server. Retrying now.",
  retryNow: "Retry now",
});

export const BOOT = Object.freeze({
  loading: "Loading the game…",
  failedHeading: "Can't reach the app server",
  failedText: (s) => (s > 0 ? `Retrying in ${s} s.` : "Retrying now."),
  restartHeading: "Restart the server to finish the update",
  restartBody: Object.freeze([
    Object.freeze({ text: "In Terminal press Ctrl+C, run " }), Object.freeze({ text: "bash start.sh", strong: true }),
    Object.freeze({ text: ", then refresh this page. Your logged snaps are saved." }),
  ]),
});

// restructure-v2.md 5: the top bar only moves the game, so a request that never reached the server changed nothing
export const TOASTS = Object.freeze({
  networkFail: "Can't reach the app server, so the game didn't move. Try again in a moment.",
  serverError: "The app server refused that.",
});
