// Every client-side string (pure). FI sections 1 to 3 verbatim where the current UI says it; new features
// (watch, booth, camera, scoreboard, play feed, connection) in the same plain football language.
// Team names always come in as arguments: nothing here is specific to Dallas (G13).

export const APP = Object.freeze({
  title: "Shadow Play-Caller",
});

export const MASTHEAD = Object.freeze({
  undo: "Undo",
  undoTitle: "Undo (U)",
  exportCsv: "Export CSV",
  reset: "Reset game",
  camera: "Camera",
  cameraTitle: "Change the camera (V)",
  booth: "Booth",
  boothTitle: "Open the booth (B)",
  scorecard: "Scorecard",
  scorecardTitle: "Full scorecard (G)",
  whoLabel: (caller, team) => `Modelling ${caller} (${team} offense)`,
  // v1.2 (A9): names of the masthead's two key groups, for assistive tech
  gameGroup: "Game",
  viewGroup: "View",
});

export const FEED = Object.freeze({
  buttonOff: "ESPN live: off",
  buttonOn: "ESPN live: on",
  buttonRetrying: "ESPN live: retrying",
  eventLabel: "ESPN game id",
  eventPlaceholder: "today's game",
  replay: "Replay this game",
  replayTitle: "Rebuild a finished game from ESPN (backs up the current one)",
  watch: "Watch this game",
  watchTitle: "Play a finished game back snap by snap (backs up the current one)",
  statusOff: "Off: enter plays by hand, or turn it on and plays log themselves.",
  updated: (when) => `Updated ${when}`,
  notYet: "…",
  separator: " · ",
  last: "Last:",
  skipped: "Skipped, enter it by hand:",
  error: (detail) => `Can't reach ESPN (${detail}). Still trying every few seconds.`,
});

export const STRIP = Object.freeze({
  qtr: "Qtr",
  clock: "Clock",
  est: "est.",
  estTitle: "Estimated from snaps; type the real clock",
  down: "Down",
  amp: "&",
  togo: "To go",
  ballOn: "Ball on",
  yardAria: "Yard line",
  sideGlyph: "⇄",
  sideTitle: "Click to switch sides of the field",
  scoreAria: (team) => `${team} score`,
  endPunt: "Punt",
  endFg: "FG good",
  endFgMiss: "FG missed",
  endHalf: "Half over",
  note: "Click any number and type; Enter or Tab saves. Click the team to switch sides of the field. Clock takes 8:41 or 841; G in To go means goal.",
  driveInfo: (drive, snap) => `Drive ${drive}, snap ${snap} of the game`,
  offField: (off) => `${off} off the field. Type where they get the ball in Ball on.`,
});

export const PREDICTION = Object.freeze({
  mostLikely: "Most likely call",
  then: "Then",
  snap: (n) => `Snap ${n}`,
  pillTitle: "Pass vs run against the league",
  splitAria: "Pass versus run",
  splitPass: (p) => `Ball thrown or dropback ${p}`,
  splitLeague: (p) => `League ${p} (dashed)`,
  splitRun: (p) => `Handed off or kept ${p}`,
  league: (p) => `League ${p}`,
  hotUpGlyph: "▲",
  hotDownGlyph: "▼",
  hotUp: "Well above the league",
  hotDown: "Well below the league",
  legend: "▲ ▼ = at least 4 points and 30% above or below the league for this exact situation. Bars are scaled to the top pick. Click a play to pick it as what he called.",
  leafTitle: "Click to log this as the play he called",
  habits: "pass pts from his habits here",
  scriptPts: "—",
  script: (n) => `Opening script: memory switches on after snap ${n}`,
  scriptNoCount: "Opening script: memory switches on after the opening snaps",
  offFieldHeading: (off) => `${off} is off the field`,
  offFieldManual: (off, spot) => [
    { text: `When ${off} gets the ball, click ` }, { text: "Ball on", strong: true },
    { text: " above and type the spot, like " }, { text: spot, strong: true },
    { text: ". The drive starts and predictions come back. Update the score and clock the same way." },
  ],
  offFieldFeed: (off) => `When ${off} gets the ball, the ESPN feed starts the drive and the next call appears here.`,
  offFieldWatch: (off) => `When ${off} gets the ball in this game, the next call appears here.`,
});

export const ENTRY = Object.freeze({
  heading: "What did he call?",
  rows: Object.freeze({ run: "Run", pass: "Pass", rpo: "RPO", result: "Result" }),
  keys: Object.freeze({
    J: Object.freeze({ name: "Left", hint: "JJ: outside edge" }),
    K: Object.freeze({ name: "Inside", hint: "A/B gap (R works too)" }),
    L: Object.freeze({ name: "Right", hint: "LL: outside edge" }),
    P: Object.freeze({ name: "Dropback", hint: "tap again: short, mid, deep" }),
    A: Object.freeze({ name: "Play-action", hint: "tap again: short, mid, deep" }),
    N: Object.freeze({ name: "Screen", hint: "" }),
    O: Object.freeze({ name: "RPO", hint: "OO: he threw it" }),
    I: Object.freeze({ name: "Incomplete", hint: "after P, A, N or OO" }),
    S: Object.freeze({ name: "Sack", hint: "yards lost" }),
    C: Object.freeze({ name: "Scramble", hint: "yards gained" }),
    X: Object.freeze({ name: "Flag", hint: "penalty menu" }),
  }),
  yards: "Yards",
  td: "Touchdown",
  tdKey: "(T)",
  turnover: "Turnover",
  turnoverKey: "(F)",
  logPlay: "Log play",
  shorthandPlaceholder: "Shorthand: JJ 6 | 2&4 D44   ·   PP 0 INC   ·   PPP 35 TD   ·   X DH   ·   X DPI 25   ·   new D25",
  shorthandAria: "Shorthand command",
  shorthandRun: "Run",
  hintManual: "Press the play key (tap again to cycle), type yards, Enter. I incomplete, X flag, Esc clears, U undoes. Down, distance and field position advance on their own.",
  hintFeed: "ESPN logs each play, down, distance, spot, clock and score. It can't see play-action, screens or RPOs: press A, N or O to fix the last play. P undoes that, J/K/L change the run gap, U undoes.",
  hintWatch: "Plays log themselves as the game plays back. A, N or O fix the last play (the playback pauses first). Space pauses or resumes, Left and Right step, 1 to 4 set the speed.",
});

export const FLAGS = Object.freeze({
  title: "Flag.",
  close: "Close (Esc)",
  defHeading: (opp) => `On ${opp} (defense)`,
  offHeading: (off) => `On ${off} (offense)`,
  otherD: (opp) => `Other on ${opp}`,
  otherO: (off) => `Other on ${off}`,
  otherSummary: "yards from the Yards box",
  autoFirst: "automatic 1st down",
  offsetLabel: "Offsetting",
  offsetSummary: "replay the down",
  hint: "Flag on the play you picked: that play is wiped out but still counts as his call for scoring. Flag after a play that stands (late hit): log the play first, then flag. DPI and Other use the Yards box (for DPI, yards past the line). Half the distance applies near the goal line.",
});

export const LAST_PLAY = Object.freeze({
  fromEspn: "Last play from ESPN",
  byHand: "Last play (entered by hand)",
  waiting: (off) => `Waiting for the first ${off} play`,
  waitingText: "Plays appear here a few seconds after ESPN posts them.",
  td: ", TD",
  turnover: ", turnover",
  yards: (n) => `${n} yds`,
  retagged: " · retagged",
  pass: Object.freeze([["A", "Play-action", "pa"], ["N", "Screen", "screen"], ["O", "RPO, thrown", "rpo"],
    ["P", "Plain dropback", "dropback"]]),
  run: Object.freeze([["O", "RPO, handed off", "rpo"], ["J", "Left (again: edge)", null], ["K", "Inside", null],
    ["L", "Right (again: edge)", null]]),
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
  calledRight: (league) => `Called right (league ${league})`,
  tilts: "Tilts that came true",
  passRate: "Pass rate tonight",
  note: "Lower log loss is better. One game is a pipeline test, not proof.",
  shadow: "Shadow",
  leagueSide: "League",
  pairCalledRight: "Called right",
  pairTop3: "Actual play in his top 3",
  pairPassRun: "Pass vs run log loss",
  pairFamily: "Play type log loss",
  pairLeaf: "Specific play log loss",
  basis: (n) => `${n} snaps`,
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

export const LOG = Object.freeze({
  heading: "Play log",
  empty: "No snaps yet. Each logged play shows his top pick next to what he called.",
  columns: Object.freeze(["#", "Time", "Situation", "His top pick", "Actual", "His % on it", "League %", "Rank", "Yds"]),
  legacyCall: Object.freeze({ R: "Run", P: "Pass", SC: "Scramble", S: "Sack" }),
  pass: "Pass",
  run: "Run",
  flag: "flag",
  time: (qtr, clock) => `Q${qtr} ${clock}`,
});

export const PLAYS = Object.freeze({
  heading: "Plays",
  verdict: Object.freeze({ top1: "Top pick", top3: "In his top 3", miss: "Miss", none: "" }),
  unlinked: (n) => (n === 1 ? "1 hand-entered play isn't on the field" : `${n} hand-entered plays aren't on the field`),
  // v1.2 (A8): empty feed, row marks, and what clicking a row does
  empty: "Plays appear here as they happen, newest first.",
  noPlay: "No play",
  retagged: "retagged",
  review: "Show this play on the field",
  reviewing: "On the field now. Click again to go back to live.",
  inProgress: "Drive in progress",
});

export const DRIVES = Object.freeze({
  heading: "Drives",
  plays: (n) => `${n} ${n === 1 ? "play" : "plays"}`,
  yards: (n) => `${n} yds`,
  label: (team, result) => (result ? `${team} ${result}` : `${team} drive`),
  // v1.2 (A8): empty chart and what clicking a drive does
  empty: "Drives appear after the first play.",
  review: "Show this drive's first play on the field",
  reviewing: "This drive is on the field. Click again to go back to live.",
  now: "Now",
});

export const WP = Object.freeze({
  heading: "Win probability",
  aria: (team, p) => `${team} win probability ${p}`,
  unavailable: "Win probability comes from ESPN; hand-entered games don't have it.",
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

export const WATCH = Object.freeze({
  start: "Watch this game",
  play: "Play",
  pause: "Pause",
  step: "Step",
  stop: "Stop",
  back: "Back to my game",
  again: "Watch again",
  speed: (n) => `${n}x`,
  progress: (idx, total) => `${idx} / ${total}`,
  speedTitle: "Playback speed (1 to 4)",
});

export const REVIEW = Object.freeze({
  text: (who, when, what) => `Reviewing ${who}, ${when}, ${what}. Esc returns to live.`,
  unknown: (seq) => `Reviewing play ${seq}. Esc returns to live.`,
  kickoff: "kickoff",
  // v1.2 (A9): the review banner's keys (Left, Right, Esc), so a mouse or a phone can step and leave review too
  earlier: "Earlier play",
  later: "Later play",
  live: "Back to live",
});

export const FIELD = Object.freeze({
  label: "Football field",   // v1.2 (A9): #field's name before a game is loaded
  legend: "Ball shown mid-field; ESPN gives no hash.",
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

export const TOASTS = Object.freeze({
  noDrive: (team) => `No ${team} drive in progress. Type the ball spot first.`,
  undoRefused: "Undo is off while a game plays back. Stop watching first.",
  networkFail: "Can't reach the app server. Nothing was saved.",
});

export const CONFIRMS = Object.freeze({
  reset: "Clear every snap logged for this game?",
  resetFeedOn: "Clear every snap logged for this game? The ESPN feed turns off first, so it doesn't log the game again.",
  replay: (id) => `Rebuild the game log from ESPN game ${id}? The current log is backed up first.`,
  todaysGame: "(today's)",
  watchStart: (id) => `Watch ESPN game ${id} from the start? Your game is backed up first and comes back when you stop.`,
  watchStop: "Stop watching and put your game back?",
});
