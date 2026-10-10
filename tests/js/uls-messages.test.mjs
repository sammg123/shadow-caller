// Under the Lights: what the LED fascia ribbons say (owner W1; DESIGN.md "LED fascia ribbons", "The Offense Paints the
// Board Rule"; docs/design/play-drawing.md 3: the field's words come from play-label.js). Real TB at DAL rows.
import assert from "node:assert/strict";
import test from "node:test";
import { loadTimeline } from "./fixtures.mjs";
import {
  SEP, TONES, gameMessage, idleMessage, logoOf, plainMessage, playMessage, scorerOf, sidesOf, textOf, withVerdict,
} from "../../static/js/theme/worlds/under-the-lights/stadium/messages.js";

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
