// theme/team-colors.js (ui-architecture.md 2.7; DC C2; owner A10): WCAG contrast and the team paint rule.
import assert from "node:assert/strict";
import test from "node:test";
import {
  NEUTRAL_TEAM, REFERENCE_BACKGROUNDS, contrast, inkOn, legibility, liftToLuminance, luminance, minContrastAgainst,
  mixHex, teamPaint,
} from "../../static/js/theme/team-colors.js";

const near = (actual, expected, tol = 0.01) => assert.ok(Math.abs(actual - expected) <= tol, `${actual} vs ${expected}`);
const DAL = { color: "#002a5c", alt_color: "#b0b7bc" };
const TB = { color: "#bd1c36", alt_color: "#3e3a35" };
const NIGHT = "#0b0f14";
const TURF = "#2e6b3a";

test("luminance is the WCAG relative luminance", () => {
  assert.equal(luminance("#ffffff"), 1);
  assert.equal(luminance("#000000"), 0);
  near(luminance("#808080"), 0.2159, 0.001);
  assert.throws(() => luminance("red"), /#rrggbb/);
});

test("contrast matches the DC C2 table (each within 0.01)", () => {
  near(contrast("#002a5c", NIGHT), 1.36);
  near(contrast("#b0b7bc", NIGHT), 9.47);
  near(contrast("#bd1c36", TURF), 1.03);
  near(contrast("#002a5c", "#000000"), 1.49);
  near(contrast("#002a5c", TURF), 2.21);
  near(contrast("#b0b7bc", "#000000"), 10.35);
  near(contrast("#b0b7bc", TURF), 3.15);
  near(contrast("#bd1c36", "#000000"), 3.38);
  near(contrast("#bd1c36", NIGHT), 3.10);
  near(contrast("#3e3a35", "#000000"), 1.86);
  near(contrast("#3e3a35", NIGHT), 1.70);
  near(contrast("#3e3a35", TURF), 1.76);
  assert.equal(contrast("#ffffff", "#000000"), 21);
  assert.equal(contrast(NIGHT, "#b0b7bc"), contrast("#b0b7bc", NIGHT), "symmetric");
});

test("minContrastAgainst is the worst case over the backgrounds", () => {
  near(minContrastAgainst("#b0b7bc", [NIGHT, TURF]), 3.15);
  assert.equal(minContrastAgainst("#b0b7bc", []), Infinity);
});

test("teamPaint keeps the primary when it is legible", () => {
  const paint = teamPaint(TB, [NIGHT], 3);
  assert.deepEqual({ fill: paint.fill, edge: paint.edge, usedAlt: paint.usedAlt, needsCore: paint.needsCore },
    { fill: "#bd1c36", edge: "#bd1c36", usedAlt: false, needsCore: false });
});

test("teamPaint falls back to the alternate color: DAL navy on the night scene", () => {
  const paint = teamPaint(DAL, [NIGHT], 3);
  assert.equal(paint.fill, "#002a5c", "the fill keeps the team's own color");
  assert.equal(paint.edge, "#b0b7bc");
  assert.equal(paint.usedAlt, true);
  assert.equal(paint.needsCore, false);
  assert.equal(paint.ink, "#ffffff");
});

test("teamPaint falls back to a light core when neither color reads: TB red on turf", () => {
  const paint = teamPaint(TB, [TURF], 3);
  assert.equal(paint.needsCore, true);
  assert.equal(paint.usedAlt, false, "the glow keeps the team's identity color");
  assert.equal(paint.edge, "#bd1c36");
  assert.equal(paint.core, "#ffffff");
  assert.ok(contrast(paint.core, TURF) >= 3);
});

test("teamPaint picks a dark core and dark ink where light ones would not read", () => {
  const gold = teamPaint({ color: "#ffb612", alt_color: "#ffd25f" }, ["#ffffff"], 3);
  assert.equal(gold.needsCore, true);
  assert.equal(gold.core, "#000000");
  assert.equal(gold.ink, "#000000");
});

test("teamPaint uses the neutral team for missing or malformed colors (DC C2 manual mode)", () => {
  for (const team of [{ color: null, alt_color: null }, {}, null, { color: "red", alt_color: "#12" }]) {
    const paint = teamPaint(team, [NIGHT], 3);
    assert.equal(paint.neutral, true);
    assert.equal(paint.fill, NEUTRAL_TEAM.color);
  }
  const noAlt = teamPaint({ color: "#002a5c", alt_color: "nope" }, [NIGHT], 3);
  assert.equal(noAlt.neutral, false);
  assert.equal(noAlt.usedAlt, false);
  assert.equal(noAlt.needsCore, true);
  assert.equal(teamPaint({ color: "#002A5C", alt_color: null }, [], 3).fill, "#002a5c", "hex is normalized");
});

test("teamPaint with no backgrounds has nothing to fail", () => {
  const paint = teamPaint(DAL);
  assert.equal(paint.edge, "#002a5c");
  assert.equal(paint.needsCore, false);
  assert.ok(Object.isFrozen(paint));
});

test("inkOn picks the text color with the higher contrast on a fill", () => {
  assert.equal(inkOn("#002a5c"), "#ffffff");
  assert.equal(inkOn("#ffb612"), "#000000");
});

test("legibility reports both colors against turf, night and white", () => {
  assert.deepEqual(Object.keys(REFERENCE_BACKGROUNDS), ["turf", "night", "white"]);
  const dal = legibility(DAL);
  near(dal.color.night, 1.36);
  near(dal.color.turf, 2.21);
  near(dal.alt.night, 9.47);
  assert.ok(dal.alt.white < 3);
  assert.equal(legibility({ color: "#002a5c" }).alt, null);
});

test("mixHex and liftToLuminance lift a dark color for a glow (three-recipe 10.3)", () => {
  assert.equal(mixHex("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(mixHex("#002a5c", "#ffffff", 0), "#002a5c");
  const lifted = liftToLuminance("#002a5c", 0.08);
  assert.ok(luminance(lifted) >= 0.08 && luminance(lifted) < 0.09, lifted);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(lifted.slice(i, i + 2), 16));
  assert.ok(b > g && g > r, "still blue");
  assert.equal(liftToLuminance("#b0b7bc", 0.08), "#b0b7bc", "already bright enough");
});
