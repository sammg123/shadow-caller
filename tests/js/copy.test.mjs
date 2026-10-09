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
  assert.equal(Copy.MASTHEAD.whoLabel("Brian Schottenheimer", "DAL"), "Modelling Brian Schottenheimer (DAL offense)");
  assert.equal(Copy.MASTHEAD.undoTitle, "Undo (U)");
  assert.equal(Copy.MASTHEAD.exportCsv, "Export CSV");
  assert.equal(Copy.MASTHEAD.reset, "Reset game");
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
  assert.equal(Copy.STRIP.driveInfo(1, 1), "Drive 1, snap 1 of the game");
  assert.equal(Copy.STRIP.offField("DAL"), "DAL off the field. Type where they get the ball in Ball on.");
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
  assert.equal(Copy.TENDENCIES.title("Brian Schottenheimer"), "Schottenheimer's tendencies");
  assert.equal(Copy.TENDENCIES.fallbackTitle, "His tendencies");
  assert.equal(Copy.TENDENCIES.plotAria, "His pass-run tendency terms with 90 percent intervals");
});

test("toasts and confirms name the team, not Dallas (G13)", () => {
  assert.equal(Copy.TOASTS.noDrive("Dallas"), "No Dallas drive in progress. Type the ball spot first.");
  assert.equal(Copy.TOASTS.noDrive("Kansas City"), "No Kansas City drive in progress. Type the ball spot first.");
  assert.equal(Copy.CONFIRMS.reset, "Clear every snap logged for this game?");
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
