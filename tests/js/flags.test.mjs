import assert from "node:assert/strict";
import test from "node:test";

import { FLAG_KEYS, FLAG_ORDER, KEY_OF_CODE, flagLabel, flagNote, penaltySummary } from "../../static/js/core/flags.js";
import { EMPTY_PICK, tap, toggleOutcome } from "../../static/js/core/selection.js";
import { FAMILY_NAMES, KEYS, loadState } from "./fixtures.mjs";

// live.py PENALTIES as /api/state serves them (label, against, yards, first, lod, presnap).
const PENALTIES = {
  OFFSIDE: { label: "Offside / encroachment / neutral zone", against: "def", yards: 5, first: false, lod: false, presnap: true },
  DH: { label: "Defensive holding", against: "def", yards: 5, first: true, lod: false, presnap: false },
  IC: { label: "Illegal contact", against: "def", yards: 5, first: true, lod: false, presnap: false },
  DPI: { label: "Defensive pass interference", against: "def", yards: "spot", first: true, lod: false, presnap: false },
  RTP: { label: "Roughing the passer", against: "def", yards: 15, first: true, lod: false, presnap: false },
  URD: { label: "Unnecessary roughness on defense", against: "def", yards: 15, first: true, lod: false, presnap: false },
  FM: { label: "Face mask", against: "def", yards: 15, first: true, lod: false, presnap: false },
  "12D": { label: "Too many men on defense", against: "def", yards: 5, first: false, lod: false, presnap: true },
  FS: { label: "False start", against: "off", yards: 5, first: false, lod: false, presnap: true },
  DOG: { label: "Delay of game", against: "off", yards: 5, first: false, lod: false, presnap: true },
  ILF: { label: "Illegal formation / shift", against: "off", yards: 5, first: false, lod: false, presnap: false },
  OH: { label: "Offensive holding", against: "off", yards: 10, first: false, lod: false, presnap: false },
  OPI: { label: "Offensive pass interference", against: "off", yards: 10, first: false, lod: false, presnap: false },
  IBB: { label: "Illegal block in the back", against: "off", yards: 10, first: false, lod: false, presnap: false },
  IG: { label: "Intentional grounding", against: "off", yards: 10, first: false, lod: true, presnap: false },
  URO: { label: "Unnecessary roughness on offense", against: "off", yards: 15, first: false, lod: false, presnap: false },
  OFFSET: { label: "Offsetting penalties, replay the down", against: null, yards: 0, first: false, lod: false, presnap: false },
  OTHER_D: { label: "Penalty on defense", against: "def", yards: "box", first: false, lod: false, presnap: false },
  OTHER_O: { label: "Penalty on offense", against: "off", yards: "box", first: false, lod: false, presnap: false },
};

test("the test penalty table equals the one the server serves", () => {
  assert.deepEqual(loadState("final").penalties, PENALTIES);
});

test("FLAG_KEYS and FLAG_ORDER follow FI 1.6", () => {
  assert.deepEqual({ ...FLAG_KEYS }, { O: "OFFSIDE", H: "DH", C: "IC", D: "DPI", R: "RTP", U: "URD", M: "FM", Z: "12D",
    F: "FS", G: "DOG", E: "ILF", L: "OH", P: "OPI", B: "IBB", I: "IG", N: "URO", W: "OFFSET" });
  assert.deepEqual([...FLAG_ORDER], ["OFFSIDE", "DH", "IC", "DPI", "RTP", "URD", "FM", "12D", "FS", "DOG", "ILF", "OH",
    "OPI", "IBB", "IG", "URO"]);
  assert.equal(KEY_OF_CODE.DPI, "D");
  assert.equal(KEY_OF_CODE.OTHER_D, undefined, "Other is mouse only");
});

test("penaltySummary gives the FI 1.6 summary for every code", () => {
  const expected = {
    OFFSIDE: "5 yds, pre-snap", DH: "5 yds, auto 1st", IC: "5 yds, auto 1st",
    DPI: "ball at the spot, auto 1st (Yards = past the line)", RTP: "15 yds, auto 1st", URD: "15 yds, auto 1st",
    FM: "15 yds, auto 1st", "12D": "5 yds, pre-snap", FS: "5 yds, pre-snap", DOG: "5 yds, pre-snap", ILF: "5 yds",
    OH: "10 yds", OPI: "10 yds", IBB: "10 yds", IG: "10 yds, loss of down", URO: "15 yds",
    OFFSET: "replay the down", OTHER_D: "yards from the Yards box", OTHER_O: "yards from the Yards box",
  };
  for (const [code, p] of Object.entries(PENALTIES)) assert.equal(penaltySummary(p), expected[code], code);
  assert.equal(penaltySummary(null), "");
});

test("flagLabel drops the side words (FI 1.6)", () => {
  assert.equal(flagLabel(PENALTIES.URD), "Unnecessary roughness");
  assert.equal(flagLabel(PENALTIES.URO), "Unnecessary roughness");
  assert.equal(flagLabel(PENALTIES["12D"]), "Too many men");
  assert.equal(flagLabel(PENALTIES.DH), "Defensive holding");
  assert.equal(flagLabel(undefined), "");
});

test("flagNote follows the current pick (#65, G25)", () => {
  const aa = tap(tap(EMPTY_PICK, "A"), "A");
  assert.equal(flagNote(aa, KEYS, FAMILY_NAMES),
    "Your pick (PA intermediate (10–19)) is wiped out but still scored as his call. Pre-snap fouls ignore it.");
  assert.equal(flagNote(EMPTY_PICK, KEYS, FAMILY_NAMES), "No play picked: the flag just moves the ball.");
  assert.equal(flagNote(toggleOutcome(EMPTY_PICK, "sack"), KEYS, FAMILY_NAMES),
    "Your pick (Dropback pass, sack) is wiped out but still scored as his call. Pre-snap fouls ignore it.");
  assert.equal(flagNote(tap(aa, "P"), KEYS, FAMILY_NAMES),
    "Your pick (Short (0–9 air yds)) is wiped out but still scored as his call. Pre-snap fouls ignore it.",
    "a pick changed with the panel open changes the note");
});
