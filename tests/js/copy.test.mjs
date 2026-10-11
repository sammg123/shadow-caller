import test from "node:test";
import assert from "node:assert/strict";
import * as Copy from "../../static/js/model/copy.js";

test("every copy group is frozen", () => {
  for (const [name, group] of Object.entries(Copy)) {
    if (group && typeof group === "object") assert.ok(Object.isFrozen(group), name);
  }
});

// restructure-v2.md 2: the top bar's clear words: who is shadowed, the current game, the playback and the view keys.
test("the top bar says who is shadowed and the current game; its keys say what they do", () => {
  assert.equal(Copy.APP.title, "Shadow Play-Caller");
  assert.equal(Copy.MASTHEAD.whoLabel("Schottenheimer", "DAL"), "Shadowing Schottenheimer · DAL");
  assert.equal(Copy.MASTHEAD.whoTitle("Brian Schottenheimer", "DAL"), "Modelling Brian Schottenheimer (DAL offense)");
  assert.equal(Copy.MASTHEAD.gameDetail(Copy.MASTHEAD.game("TB", "DAL"), "Final"), "TB at DAL · Final");
  assert.deepEqual([Copy.MASTHEAD.report, Copy.MASTHEAD.settings, Copy.MASTHEAD.cameraTitle],
    ["Model Report", "Settings", "Wide or Blimp (V)"]);
  const W = Copy.WATCH;
  assert.deepEqual([W.back, W.play, W.pause, W.forward, W.reset, W.goLive], ["Back", "Play", "Pause", "Forward", "Reset",
    "Go Live"]);
  assert.deepEqual([W.backTitle, W.forwardTitle, W.goLiveTitle], ["One play back (Left arrow)",
    "One play forward (Right arrow)", "Jump to the latest play (Esc)"]);
  assert.equal(W.speedTitle(10, "4"), "Play at 10x (4)");
  assert.deepEqual([W.count(42, 183), W.position(42, 183), W.kickoff, W.final], ["42 / 183", "Play 42 of 183",
    "Kickoff", "Final"]);
});

test("the page takes no user input into the game: no feed, strip, entry, flag, review or scrub copy (restructure-v2.md 1)",
  () => {
    for (const gone of ["FEED", "STRIP", "ENTRY", "FLAGS", "REVIEW", "SCRUB", "CONFIRMS"]) {
      assert.equal(Object.hasOwn(Copy, gone), false, gone);
    }
    for (const gone of ["undo", "exportCsv", "reset", "booth", "scorecard"]) {
      assert.equal(Object.hasOwn(Copy.MASTHEAD, gone), false, gone);
    }
    assert.equal(Copy.SCOREBOARD.est, "est.");
  });

// restructure-v2.md: no user input into the game (a play is shown on the field, never picked), and NEXT CALL says who
// has the ball while he doesn't, never an instruction to type anything.
test("prediction strings match FI 3.5, with no user input into the game (restructure-v2.md)", () => {
  assert.equal(Copy.PREDICTION.legend,
    "▲ ▼ = at least 4 points and 30% above or below the league for this exact situation. Bars are scaled to the top pick. Point at a play to see its shadow on the field.");
  assert.equal(Copy.PREDICTION.leafTitle, "Shows this play's shadow on the field");
  assert.equal(Copy.PREDICTION.script(15), "Opening script: memory switches on after snap 15");
  assert.equal(Copy.PREDICTION.hasBall("TB"), "TB has the ball");
  assert.equal(Copy.PREDICTION.kicksOff("DAL"), "DAL kicks off");
  assert.equal(Copy.PREDICTION.waiting("DAL"), "When DAL gets the ball, his next call appears here.");
  for (const gone of ["offFieldHeading", "offFieldManual", "offFieldFeed", "offFieldWatch"]) {
    assert.equal(Object.hasOwn(Copy.PREDICTION, gone), false, gone);
  }
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
  assert.equal(P.spokenPredicted("Screen", "9 percent"), "Predicted Screen, 9 percent");
  assert.equal(P.recentLabel, "Last 6");
  assert.equal(P.recentTop3(2), "In his top 3 (#2)");
  assert.equal(P.previousPlate, "Previous play");
  assert.equal(P.spokenPrevious(34), "Previous play, snap 34:");
  assert.equal(P.spokenPrevious(null), "Previous play:");
  assert.equal(P.finalPlate, "Final");
  assert.equal(P.finalKey, "Tonight's scorecard");
  assert.equal(P.finalKeyTitle, "The full scorecard is in the Model Report");
});

test("a logged call's legacy words match FI 3.9; the play log itself is the Model Report's (restructure-v2.md 6)", () => {
  assert.deepEqual({ ...Copy.LOG.legacyCall }, { R: "Run", P: "Pass", SC: "Scramble", S: "Sack" });
  assert.deepEqual(Object.keys(Copy.LOG), ["legacyCall"]);
  for (const gone of ["review", "reviewing"]) assert.equal(Object.hasOwn(Copy.PLAYS, gone), false, gone);
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

test("toasts: a request that never reached the server moved nothing; nothing names Dallas (G13)", () => {
  assert.equal(Copy.TOASTS.networkFail, "Can't reach the app server, so the game didn't move. Try again in a moment.");
  assert.equal(Copy.TOASTS.serverError, "The app server refused that.");
  assert.doesNotMatch(JSON.stringify(Object.values(Copy.TOASTS)), /Dallas|DAL/);
});

test("restart and connection strings match FI 3.11 and G11", () => {
  assert.equal(Copy.BOOT.restartHeading, "Restart the server to finish the update");
  assert.equal(Copy.CONN.offline(4), "Can't reach the app server. Retrying in 4 s.");
  assert.equal(Copy.FIELD.legend, "Ball shown mid-field; ESPN gives no hash.");
  assert.equal([Copy.FIELD.ballOn("DAL 25"), Copy.FIELD.downDistance("1st & 10"), Copy.FIELD.lineToGain("DAL 35")].join(" "),
    "Ball on DAL 25. 1st & 10. Line to gain DAL 35.");
});
