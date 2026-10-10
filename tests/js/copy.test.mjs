import test from "node:test";
import assert from "node:assert/strict";
import * as Copy from "../../static/js/model/copy.js";

test("every copy group is frozen", () => {
  for (const [name, group] of Object.entries(Copy)) {
    if (group && typeof group === "object") assert.ok(Object.isFrozen(group), name);
  }
});

test("header strings match FI 3.1", () => {
  assert.equal(Copy.APP.title, "Shadow Play-Caller");
  assert.equal(Copy.MASTHEAD.undoTitle, "Undo (U)");
  assert.equal(Copy.MASTHEAD.exportCsv, "Export CSV");
  assert.equal(Copy.MASTHEAD.reset, "Reset game");
});

// v1.5 (G4-2): the nameplate names the play-caller it shadows, short enough for the plate; the full words stay in its
// tooltip. The B and G keys name their letter, so a voice user can say what they see.
test("the masthead says who is shadowed, and the view keys name their letters (G4-2)", () => {
  assert.equal(Copy.MASTHEAD.whoLabel("Schottenheimer", "DAL"), "Shadowing Schottenheimer · DAL");
  assert.equal(Copy.MASTHEAD.whoTitle("Brian Schottenheimer", "DAL"), "Modelling Brian Schottenheimer (DAL offense)");
  assert.equal(Copy.MASTHEAD.booth, "Booth (B)");
  assert.equal(Copy.MASTHEAD.scorecard, "Scorecard (G)");
});

test("feed bar strings match FI 3.2", () => {
  assert.equal(Copy.FEED.statusOff, "Off: enter plays by hand, or turn it on and plays log themselves.");
  assert.equal(Copy.FEED.error("timed out"), "Can't reach ESPN (timed out). Still trying every few seconds.");
  assert.equal(Copy.FEED.eventPlaceholder, "today's game");
  assert.equal(Copy.FEED.replayTitle, "Rebuild a finished game from ESPN (backs up the current one)");
});

test("strip strings match FI 2.3 and 3.4", () => {
  assert.equal(Copy.STRIP.note,
    "Click any number and type; Enter or Tab saves. Click the team to switch sides of the field. Clock takes 8:41 or 841; G in To go means goal.");
  assert.equal(Copy.STRIP.driveInfo(1, 1), "Drive 1 · snap 1");                 // v1.5 (G4-12): one strip row
  assert.equal(Copy.STRIP.driveInfo(9, 32), "Drive 9 · snap 32");
  assert.equal(Copy.STRIP.offField("DAL"), "DAL off the field. Type where they get the ball in Ball on.");
  assert.equal(Copy.STRIP.final, "Final. Replay or watch another game from the booth (B).");   // v1.5 (G4-1)
  assert.equal(Copy.STRIP.estTitle, "Estimated from snaps; type the real clock");
  assert.equal(Copy.STRIP.scoreAria("Dallas"), "Dallas score");
});

test("prediction strings match FI 3.5", () => {
  assert.equal(Copy.PREDICTION.legend,
    "▲ ▼ = at least 4 points and 30% above or below the league for this exact situation. Bars are scaled to the top pick. Click a play to pick it as what he called.");
  assert.equal(Copy.PREDICTION.script(15), "Opening script: memory switches on after snap 15");
  assert.equal(Copy.PREDICTION.offFieldHeading("DAL"), "DAL is off the field");
  assert.equal(Copy.PREDICTION.offFieldFeed("DAL"),
    "When DAL gets the ball, the ESPN feed starts the drive and the next call appears here.");
  assert.equal(Copy.PREDICTION.offFieldWatch("DAL"), "When DAL gets the ball in this game, the next call appears here.");
});

// v1.5 (G4-1, G4-2, G4-4, G4-6): the board's plates, the tilt tag's words, the spoken call, the drive recap and FINAL.
test("the video board's words (G4-1, G4-2, G4-4, G4-6)", () => {
  const P = Copy.PREDICTION;
  assert.equal(P.nextCall("Schottenheimer"), "Schottenheimer's next call");
  assert.equal(P.nextCallPlain, "Next call");
  assert.equal(P.fourthDown, "4th down · if he goes for it");
  assert.match(P.fourthDownTitle, /if he goes for it/);
  assert.match(P.fourthDownTitle, /no punt or field-goal class/);
  assert.deepEqual([P.flagText.none, P.flagText.lean("pass"), P.flagText.lean("run"), P.flagText.tilt("pass"),
    P.flagText.tilt("run")], ["Like the league", "Leans pass", "Leans run", "Tilts pass", "Tilts run"]);
  assert.equal(P.spokenCall(2, "Short (0–9 air yds)", 24), "Next call, snap 2: Short (0–9 air yds), 24 percent.");
  assert.equal(P.spokenCall(null, "Screen", 9), "Next call: Screen, 9 percent.");
  assert.equal(P.spokenThen("Inside run (A/B gap)", 22), "Then Inside run (A/B gap), 22 percent.");
  assert.equal(P.soFar("Schottenheimer"), "Schottenheimer so far");
  assert.equal(P.soFarPlain, "So far");
  assert.deepEqual([P.lead.td, P.lead.int, P.lead.fumble, P.lead.turnover],
    ["Touchdown", "Intercepted", "Fumble lost", "Turnover"]);
  assert.equal(P.predicted, "Predicted");
  assert.deepEqual([P.tallyTop1, P.tallyTop3], ["Top pick", "In his top 3"]);
  assert.equal(P.spokenFourth, "Fourth down, if he goes for it.");
  assert.equal(P.spokenPredicted("Screen", 9), "Predicted Screen, 9 percent");
  assert.equal(P.recentLabel, "Last 6");
  assert.equal(P.finalPlate, "Final");
  assert.equal(P.finalKey, "Tonight's scorecard");
  assert.equal(P.finalKeyTitle, "Full scorecard (G)");
});

test("entry, flag-panel and log strings match FI 1.6, 3.6 and 3.9 (flag notes are core/flags.js's)", () => {
  assert.equal(Copy.ENTRY.hintManual,
    "Press the play key (tap again to cycle), type yards, Enter. I incomplete, X flag, Esc clears, U undoes. Down, distance and field position advance on their own.");
  assert.equal(Copy.ENTRY.hintFeed,
    "ESPN logs each play, down, distance, spot, clock and score. It can't see play-action, screens or RPOs: press A, N or O to fix the last play. P undoes that, J/K/L change the run gap, U undoes.");
  assert.equal(Copy.FLAGS.hint.startsWith("Flag on the play you picked: that play is wiped out"), true);
  assert.equal(Copy.LOG.empty, "No snaps yet. Each logged play shows his top pick next to what he called.");
  assert.deepEqual([...Copy.LOG.columns],
    ["#", "Time", "Situation", "His top pick", "Actual", "His % on it", "League %", "Rank", "Yds"]);
});

test("scorecard and tendency strings match FI 3.7 and 3.8", () => {
  assert.equal(Copy.SCORECARD.note, "Lower log loss is better. One game is a pipeline test, not proof.");
  assert.equal(Copy.SCORECARD.empty, "Scores appear after the first logged snap.");
  // v1.5 (G4-3): what "called right" measures, a short top-3 caption, a basis said once and in the singular for one
  assert.equal(Copy.SCORECARD.calledRight("81%"), "Run or pass called right (league 81%)");
  assert.equal(Copy.SCORECARD.pairCalledRight, "Run/pass right");
  assert.equal(Copy.SCORECARD.pairTop3, "Play in top 3");
  assert.deepEqual([Copy.SCORECARD.basis(1), Copy.SCORECARD.basis(59)], ["1 snap", "59 snaps"]);
  assert.equal(Copy.SCORECARD.basisLine("59 snaps"), "his model v league baseline · 59 snaps");
  assert.equal(Copy.SCORECARD.basisLinePlain, "his model v league baseline");
  assert.equal(Copy.TENDENCIES.title("Brian Schottenheimer"), "Schottenheimer's tendencies");
  assert.equal(Copy.TENDENCIES.fallbackTitle, "His tendencies");
  assert.equal(Copy.TENDENCIES.plotAria, "His pass-run tendency terms with 90 percent intervals");
});

test("toasts and confirms name the team, not Dallas (G13)", () => {
  assert.equal(Copy.TOASTS.noDrive("Dallas"), "No Dallas drive in progress. Type the ball spot first.");
  assert.equal(Copy.TOASTS.noDrive("Kansas City"), "No Kansas City drive in progress. Type the ball spot first.");
  // v1.5 (G4-12): a reset backs the game up first (app.py /api/reset, watch.backup_game), and the confirm says so
  assert.equal(Copy.CONFIRMS.reset, "Clear every snap logged for this game? A copy is kept in data/.");
  assert.equal(Copy.CONFIRMS.resetFeedOn, "Clear every snap logged for this game? The ESPN feed turns off first, so it "
    + "doesn't log the game again. A copy is kept in data/.");
  assert.equal(Copy.CONFIRMS.replay("401872980"),
    "Rebuild the game log from ESPN game 401872980? The current log is backed up first.");
  assert.equal(Copy.CONFIRMS.watchStart("401872980"),
    "Watch ESPN game 401872980 from the start? Your game is backed up first and comes back when you stop.");
  assert.equal(Copy.CONFIRMS.watchStop, "Stop watching and put your game back?");
});

test("restart and connection strings match FI 3.11 and G11", () => {
  assert.equal(Copy.BOOT.restartHeading, "Restart the server to finish the update");
  assert.equal(Copy.CONN.offline(4), "Can't reach the app server. Retrying in 4 s.");
  assert.equal(Copy.FIELD.legend, "Ball shown mid-field; ESPN gives no hash.");
  assert.equal([Copy.FIELD.ballOn("DAL 25"), Copy.FIELD.downDistance("1st & 10"), Copy.FIELD.lineToGain("DAL 35")].join(" "),
    "Ball on DAL 25. 1st & 10. Line to gain DAL 35.");
});
