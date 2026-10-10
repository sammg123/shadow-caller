// Under the Lights: what the LED fascia ribbons say (owner W1; DESIGN.md "LED fascia ribbons", "The Offense Paints the
// Board Rule"; docs/design/play-drawing.md 3: the field's words come from play-label.js). Real TB at DAL rows.
import assert from "node:assert/strict";
import test from "node:test";
import { loadTimeline } from "./fixtures.mjs";
import {
  SEP, TONES, callMessage, gameMessage, idleMessage, logoOf, plainMessage, playMessage, scorerOf, sidesOf, textOf,
  withVerdict,
} from "../../static/js/theme/worlds/under-the-lights/stadium/messages.js";
import { buildGhostSet } from "../../static/js/field/ghosts.js";
import { buildShadowPlays } from "../../static/js/field/shadows.js";

const tl = loadTimeline();
const row = (seq) => tl.row(seq);
const { teams } = tl.body;
const frame = { field: tl.body.field, teams, teamOrder: tl.body.team_order };

test("a play: the offense and the field's own words, warm white for the caller and amber for the opponent", () => {
  const first = playMessage(row(2), teams);
  assert.equal(textOf(first), `DAL${SEP}SHORT PASS MIDDLE${SEP}INCOMPLETE`);
  assert.equal(first.kind, "play");
  assert.deepEqual(first.parts.map((p) => p.tone), ["warm", "warm"]);
  assert.equal(first.holdMs, 0);
  const tb = playMessage(row(95), teams);
  assert.equal(textOf(tb), `TB${SEP}OFF-TACKLE LEFT${SEP}+72`);
  assert.deepEqual(tb.parts.map((p) => p.tone), ["amber", "amber"]);
});

test("a touchdown: TOUCHDOWN and the scorer's name with its logo, held, then the play's own words", () => {
  const td = playMessage(row(12), teams);
  assert.equal(td.kind, "td");
  assert.equal(textOf(td), "TOUCHDOWN COWBOYS");
  assert.deepEqual(td.logos, ["/api/logo/DAL?v=dark"]);
  assert.ok(td.holdMs > 2000);
  assert.equal(textOf(plainMessage(row(12))), `DAL${SEP}INSIDE RUN (UP THE MIDDLE)${SEP}TD`);
  assert.equal(textOf(playMessage(row(35), teams)), "TOUCHDOWN BUCCANEERS");
  assert.equal(scorerOf({ team: "DAL", opp: "TB", kind: "play", result: { td: true, turnover: true } }), "TB");
  assert.equal(scorerOf({ team: "DAL", opp: "TB", kind: "punt", result: { td: true } }), "TB");
});

test("an interception steps in INTERCEPTED and the defense's ball; a flag says FLAG in the flag's yellow", () => {
  const pick = playMessage(row(104), teams);
  assert.equal(pick.kind, "turnover");
  assert.equal(textOf(pick), `INTERCEPTED${SEP}TB BALL`);
  assert.equal(pick.parts[0].tone, "gold", "LED hues are warm white, gold and amber; yellow is the flag's");
  assert.deepEqual(pick.logos, ["/api/logo/TB?v=dark"]);
  const noPlay = playMessage(row(8), teams);
  assert.equal(noPlay.kind, "flag");
  assert.match(textOf(noPlay), /^FLAG · NO PLAY · DEFENSIVE OFFSIDE ON TB$/);
  assert.equal(noPlay.parts[0].tone, "flag");
});

test("admin rows say nothing; a grade joins the caller play's words in its lamp tone", () => {
  assert.equal(playMessage(row(13), teams), null);
  assert.equal(plainMessage(row(13)), null);
  assert.equal(playMessage(null, teams), null);
  const plain = plainMessage(row(3));
  assert.equal(textOf(withVerdict(plain, "top1")), `${textOf(plain)}${SEP}TOP PICK`);
  assert.equal(withVerdict(plain, "top3").parts.at(-1).tone, "amber");
  assert.equal(withVerdict(plain, "miss").parts.at(-1).tone, "red");
  assert.equal(withVerdict(plain, "none"), plain);
  assert.equal(withVerdict(null, "top1"), null);
  assert.equal(TONES.red, "#ff4d3d");
});

test("the resting messages: the product's name, and the game with both logos (only the app's own logo URLs)", () => {
  assert.equal(textOf(idleMessage()), "SHADOW PLAY-CALLER");
  const game = gameMessage(frame);
  assert.equal(textOf(game), "BUCCANEERS AT COWBOYS");
  assert.deepEqual(game.logos, ["/api/logo/TB?v=dark", "/api/logo/DAL?v=dark"]);
  assert.deepEqual(sidesOf(frame), { home: "DAL", away: "TB" });
  assert.equal(textOf(gameMessage(null)), "SHADOW PLAY-CALLER");
  assert.equal(logoOf({ X: { logo: "https://evil.example/x.png" } }, "X"), null);
  assert.equal(logoOf(teams, "NOPE"), null);
});

// ---------------------------------------------------------------- G3-6: the next call on the bowl's fascia
const D46 = Object.freeze({ ballX: 46, ltgX: 56, dir: 1, poss: "DAL", kind: "snap", goalToGo: false, down: 1, togo: 10 });
const CALL = Object.freeze({ leaves: [{ leaf: "run_inside", p: 0.2384 }, { leaf: "pa_short", p: 0.158 },
  { leaf: "dropback_short", p: 0.12 }], all: [{ leaf: "run_inside", p: 0.2384 }, { leaf: "pa_short", p: 0.158 }] });

test("G3-6: the next call, as the shadows show it: his top play and then the second, names warm, odds amber", () => {
  const msg = callMessage(buildGhostSet(CALL, D46));
  assert.equal(textOf(msg), `NEXT CALL${SEP}INSIDE RUN (A/B GAP) 24%${SEP}THEN PA SHORT (0–9) 16%`);
  assert.equal(msg.kind, "call");
  assert.equal(msg.holdMs, 0);
  assert.deepEqual(msg.logos, []);
  const tones = Object.fromEntries(msg.parts.map((p) => [p.text.trim(), p.tone]));
  assert.equal(tones["INSIDE RUN (A/B GAP)"], "warm");
  assert.equal(tones["24%"], "amber");
  assert.equal(tones["PA SHORT (0–9)"], "warm");
  assert.equal(tones["16%"], "amber");
  assert.ok(msg.parts.every((p) => Object.hasOwn(TONES, p.tone)), "LED tones only, never a team color");
});

test("G3-6: the shadow plays themselves, a single play, or nothing to call", () => {
  const plays = buildShadowPlays(CALL, D46);
  assert.equal(textOf(callMessage(plays)), textOf(callMessage(buildGhostSet(CALL, D46))), "ShadowPlays say the same");
  const one = callMessage(buildGhostSet({ leaves: [{ leaf: "screen", p: 0.31 }] }, D46));
  assert.equal(textOf(one), `NEXT CALL${SEP}SCREEN 31%`, "one play: no then");
  assert.equal(callMessage(null), null);
  assert.equal(callMessage(buildGhostSet({ leaves: [] }, D46)), null);
  assert.equal(callMessage({ shapes: [], ballX: 46, dir: 1 }), null);
  const named = callMessage({ source: { leaves: CALL.leaves }, situation: D46, leafNames: { run_inside: "Dive" } });
  assert.match(textOf(named), /^NEXT CALL · DIVE 24%/, "the server's names when it sends its own");
});
