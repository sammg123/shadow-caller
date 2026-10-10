import assert from "node:assert/strict";
import test from "node:test";

import { NEW_DRIVE_YARD, STRIP_FIELDS, commit, sideSwitch, stripValues } from "../../static/js/core/strip.js";
import { deepFreeze } from "./fixtures.mjs";

const GAME = deepFreeze({ offense: "DAL", opponent: "TB" });
const sit = (over = {}) => deepFreeze({ qtr: 1, clock_str: "15:00", score_off: 0, score_opp: 0, down: 1, togo: 10,
  yardline_100: 75, clock_estimated: false, ...over });

test("STRIP_FIELDS lists the seven inline fields", () => {
  assert.deepEqual([...STRIP_FIELDS], ["iQtr", "iClock", "iOff", "iOpp", "iDown", "iTogo", "iYard"]);
});

test("stripValues shows the fresh game as FI 2.3 says (#4)", () => {
  assert.deepEqual(stripValues(sit(), GAME, null), {
    iQtr: "1", iClock: "15:00", iOff: "0", iOpp: "0", iDown: "1", iTogo: "10", iYard: "25",
    side: { team: "DAL", own: true, title: "Ball on DAL's own side. Click to switch." }, placeholders: {},
  });
});

test("G5-3: with no drive, Ball on is the offense's next start: blank, placeholder 25, chip on its own side", () => {
  // Drive 6 ended with a field goal from TB 5: the served spot is still the last snap's
  const afterFg = sit({ yardline_100: 5, togo: 5 });
  const off = stripValues(afterFg, GAME, null, { driveActive: false });
  assert.equal(off.iYard, "", "the last snap's spot is not where the next drive starts");
  assert.deepEqual(off.placeholders, { iYard: String(NEW_DRIVE_YARD) });
  assert.equal(NEW_DRIVE_YARD, 25);
  assert.deepEqual(off.side, { team: "DAL", own: true, title: "Ball on DAL's own side. Click to switch." });
  assert.equal(stripValues(afterFg, GAME, "TB", { driveActive: false }).side.team, "DAL", "the 50's memory is a drive's");
  const spot = (raw) => commit("iYard", raw, { edited: true, chipTeam: off.side.team }).body.spot;
  assert.equal(spot("25"), "DAL 25", "a bare number starts on Dallas's side");
  assert.equal(spot("t25"), "T 25", "a typed side still picks Tampa Bay");
  assert.equal(spot("T 30"), "T 30");
  // during a drive nothing changes: the spot and its side as served
  const on = stripValues(afterFg, GAME, null, { driveActive: true });
  assert.deepEqual([on.iYard, on.side.team, on.placeholders], ["5", "TB", {}]);
});

test("G5-3: the chip off the field switches the placeholder's 25 to the other side; a typed number wins", () => {
  const afterFg = sit({ yardline_100: 5, togo: 5 });
  assert.deepEqual(sideSwitch({ chipTeam: "DAL", yardText: "", sit: afterFg, game: GAME, driveActive: false }),
    { body: { spot: "TB 25" }, sideAtFifty: null });
  assert.deepEqual(sideSwitch({ chipTeam: "DAL", yardText: "30", sit: afterFg, game: GAME, driveActive: false }),
    { body: { spot: "TB 30" }, sideAtFifty: null });
  assert.deepEqual(sideSwitch({ chipTeam: "TB", yardText: "", sit: afterFg, game: GAME, driveActive: true }),
    { body: { spot: "DAL 5" }, sideAtFifty: null }, "in a drive an empty box still falls back to the served spot");
});

test("stripValues: To go shows G at goal to go; the opponent's side uses its own number (#17)", () => {
  const v = stripValues(sit({ yardline_100: 8, togo: 8, down: 1 }), GAME, null);
  assert.equal(v.iTogo, "G");
  assert.equal(v.iYard, "8");
  assert.deepEqual(v.side, { team: "TB", own: false, title: "Ball on TB's side. Click to switch." });
  assert.equal(stripValues(sit({ yardline_100: 6, togo: 10 }), GAME, null).iTogo, "G", "10 to go at TB 6 is goal");
});

test("stripValues at the 50 follows the remembered chip side (FI 5.5, #19)", () => {
  const at50 = sit({ yardline_100: 50 });
  assert.equal(stripValues(at50, GAME, null).side.team, "DAL");
  assert.equal(stripValues(at50, GAME, "DAL").side.team, "DAL");
  assert.equal(stripValues(at50, GAME, "TB").side.team, "TB");
  assert.equal(stripValues(at50, GAME, "TB").iYard, "50");
});

test("commit: untouched or empty fields send nothing and restore (G1, #22, #24)", () => {
  assert.deepEqual(commit("iQtr", "3", { edited: false, chipTeam: "DAL" }), { body: null, restore: true });
  assert.deepEqual(commit("iQtr", "   ", { edited: true, chipTeam: "DAL" }), { body: null, restore: true });
  assert.deepEqual(commit("iNope", "3", { edited: true, chipTeam: "DAL" }), { body: null, restore: true });
  assert.deepEqual(commit("constructor", "3", { edited: true, chipTeam: "DAL" }), { body: null, restore: true });
});

test("commit: an edited field sends even when the text equals the shown value (G2, #10)", () => {
  assert.deepEqual(commit("iYard", "25", { edited: true, chipTeam: "DAL" }), { body: { spot: "DAL 25" }, restore: false });
  assert.deepEqual(commit("iYard", " 20 ", { edited: true, chipTeam: "TB" }), { body: { spot: "TB 20" }, restore: false });
});

test("commit: a leading side in Ball on is sent as typed, uppercased with one space (G3)", () => {
  const spot = (raw) => commit("iYard", raw, { edited: true, chipTeam: "TB" }).body.spot;
  assert.equal(spot("D 25"), "D 25");
  assert.equal(spot("d25"), "D 25");
  assert.equal(spot("dal  25"), "DAL 25");
  assert.equal(spot(" t8 "), "T 8");
  assert.equal(spot("x"), "TB x", "anything else goes to the server as today, which explains the error");
});

test("commit maps the other fields 1:1 to the FI 2.3 payloads", () => {
  const body = (id, raw) => commit(id, raw, { edited: true, chipTeam: "DAL" }).body;
  assert.deepEqual(body("iQtr", "2"), { qtr: "2" });
  assert.deepEqual(body("iClock", " 841 "), { clock: "841" });
  assert.deepEqual(body("iOff", "14"), { score_off: "14" });
  assert.deepEqual(body("iOpp", "-3"), { score_opp: "-3" });
  assert.deepEqual(body("iDown", "2"), { down: "2" });
  assert.deepEqual(body("iTogo", "g"), { togo: "g" });
});

test("sideSwitch mirrors the spot to the other team (#12, #18)", () => {
  const at40 = sit({ yardline_100: 60 });
  assert.deepEqual(sideSwitch({ chipTeam: "DAL", yardText: "40", sit: at40, game: GAME }),
    { body: { spot: "TB 40" }, sideAtFifty: null });
  assert.deepEqual(sideSwitch({ chipTeam: "TB", yardText: "40", sit: sit({ yardline_100: 40 }), game: GAME }),
    { body: { spot: "DAL 40" }, sideAtFifty: null });
  assert.deepEqual(sideSwitch({ chipTeam: "DAL", yardText: "", sit: at40, game: GAME }),
    { body: { spot: "TB 40" }, sideAtFifty: null }, "an empty box falls back to the served spot");
});

test("sideSwitch at the 50 remembers the side (FI 5.5, #19)", () => {
  assert.deepEqual(sideSwitch({ chipTeam: "DAL", yardText: "50", sit: sit({ yardline_100: 50 }), game: GAME }),
    { body: { spot: "TB 50" }, sideAtFifty: "TB" });
});
