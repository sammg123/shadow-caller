// Under the Lights: the scene look (owner W1; DESIGN.md "The stadium (3D art direction)", Colors, Named Rules;
// docs/design/play-drawing.md 4; ui-architecture.md 2.7, 8.2 W1 acceptance, 14.6, 20.4).
import assert from "node:assert/strict";
import test from "node:test";
import look, { SUN, TOWERS, ULS } from "../../static/js/theme/worlds/under-the-lights/look.js";
import { resolveLook, validateLook } from "../../static/js/theme/look-schema.js";
import { contrast, teamPaint } from "../../static/js/theme/team-colors.js";
import { resolvePlayLook } from "../../static/js/field/play-style.js";

const night = resolveLook(look);
const day = resolveLook(look.world.day, night);
const TB = { color: "#bd1c36", alt_color: "#3e3a35" };
const DAL = { color: "#002a5c", alt_color: "#b0b7bc" };

test("the look validates, is frozen, and keeps the world's own data under world (day, plays, uls)", () => {
  assert.deepEqual(validateLook(night).errors, []);
  assert.ok(Object.isFrozen(look) && Object.isFrozen(look.world.day));
  assert.equal(night.id, "under-the-lights");
  assert.deepEqual(Object.keys(look.world).sort(), ["day", "plays", "uls"]);
  assert.deepEqual(validateLook(day).errors, [], "the day look merges cleanly over the night");
});

test("a night-blue bowl, never black: the sky, the clear color and the haze are DESIGN.md's", () => {
  assert.equal(night.environment.background, ULS.nightSky);
  assert.equal(night.renderer.clear, ULS.nightSky);
  assert.notEqual(night.renderer.clear, "#000000");
  assert.equal(night.environment.fog.kind, "exp2");
  assert.equal(night.environment.fog.color, ULS.bowlHaze);
  assert.equal(night.renderer.toneMapping, "neutral");
});

test("four towers light the night; only the two home-side towers cast shadows (DESIGN.md budget: 2)", () => {
  const spots = night.lights.filter((l) => l.kind === "spot");
  assert.deepEqual(spots.map((l) => l.id), TOWERS.map((t) => t.id));
  assert.deepEqual(spots.filter((l) => l.castShadow).map((l) => l.id), ["tower-home-left", "tower-home-right"]);
  for (const s of spots) {
    assert.equal(s.color, ULS.lightCone);
    assert.ok(s.position[2] > 30, "the banks stand high above the stands");
    assert.ok(s.position[1] < 0 || s.position[1] > 53.333, "outside the field, behind the stands");
  }
  assert.equal(night.renderer.shadowMapSize, 2048);
});

test("bloom catches only what is pushed past 1.0 (fixtures and the tracer); the lens is a world pass", () => {
  assert.ok(night.post.bloom.threshold > 1);
  assert.deepEqual(night.post.extra, ["uls-lens"]);
  assert.ok(look.world.plays.headGlow > night.post.bloom.threshold, "the ball's tracer head blooms");
});

test("The Light Core Rule: every drawn path has a light-cone-white core and the team color on its edge", () => {
  for (const role of ["arc", "ground", "mark"]) {
    assert.equal(night.strokes[role].core, ULS.lightCone, role);
    assert.equal(night.strokes[role].edge, "team", role);
  }
  assert.equal(night.ball.trail.color, "team", "the trail is the carrier's light core");
  for (const team of [TB, DAL]) {
    const paint = teamPaint(team, night.teamColor.against, night.teamColor.minContrast);
    assert.ok(contrast(paint.core, ULS.turfDark) >= 3 || contrast(paint.core, ULS.nightSky) >= 3, "a core reads");
  }
  assert.ok(contrast(TB.color, ULS.turfDark) < 2, "TB red alone would vanish on the turf");
  assert.ok(contrast(DAL.color, ULS.nightSky) < 2, "DAL navy alone would vanish at night");
  assert.deepEqual(night.teamColor.against, [ULS.turfDark, ULS.nightSky]);
});

test("4b: his predictions are thin dashed lines coloured by rank, #1 amber and #2 warm white, never a team color", () => {
  assert.equal(night.ghost.fill, "neutral", "no team color, ever (DESIGN.md)");
  const plays = resolvePlayLook(night);
  assert.deepEqual([...plays.ranks], [ULS.ledAmber, ULS.ledWarm], "the board's amber for #1, warm white for #2");
  assert.ok(contrast(ULS.ledAmber, ULS.ledWarm) > 1.2, "#1 and #2 tell apart");
  assert.ok(plays.shadowPx >= 2 && plays.shadowPx <= 3, "about 2 to 3 px at the 1440x900 wide camera");
  assert.ok(plays.shadowDash[0] <= 0.8 && plays.shadowDash[1] >= 0.35, "short dashes, clear gaps");
  assert.deepEqual(plays.casing, { color: ULS.nightSky, opacity: 0.55, width: 2.2 }, "a thin dark ring: dashes hold on paint");
  assert.deepEqual(plays.last, { core: ULS.lastSlate, edge: ULS.steelEdge }, "the previous play in muted steel");
  for (const c of [plays.last.core, plays.last.edge]) {
    assert.ok(!plays.ranks.includes(c), "the previous play is never amber or warm white");
  }
});

test("the shadow plays fade out at the snap; every key of world.plays is taken; a kick on display dims further", () => {
  assert.equal(night.ghost.fill, "neutral");
  assert.equal(night.ghost.stroke, ULS.ledWarm);
  // v1.4 (W6): play-drawing.md 4 (binding) "When the snap happens, the shadows fade out and the real play draws solid";
  // DESIGN.md's "the top call stays at 15% after the snap" was the pixel projection's rule, which it replaced. The 2D
  // field fades them out completely too.
  assert.equal(night.ghost.afterSnapOpacity, 0);
  const plays = resolvePlayLook(night);
  assert.deepEqual(plays.shadowDash, look.world.plays.shadowDash, "every key of world.plays is taken");
  // v1.4 (W6): the kickoff or punt before a drive's first snap stays on, dimmed further, under his shadow plays
  assert.ok(plays.kickDim > 0 && plays.kickDim < 1 && night.lastPlay.dimOpacity * plays.kickDim <= 0.15);
  assert.equal(plays.shadowPx, look.world.plays.shadowPx);
  assert.deepEqual(plays.tones, { good: ULS.lampGreen, bad: ULS.tallyRed, warn: ULS.ltg });
});

test("restructure-v2.md 4: two cameras, Wide (the default, following the ball sideways) and Blimp; no Tight", () => {
  const ids = night.cameras.modes.map((m) => m.id);
  assert.deepEqual(ids, ["wide", "blimp"]);
  assert.equal(night.cameras.default, "wide");
  const [wide, blimp] = night.cameras.modes;
  assert.deepEqual([wide.label, blimp.label], ["Wide", "Blimp"]);
  assert.equal(wide.follow, "pan", "following the ball sideways in Wide is fine");
  assert.equal(blimp.rig, "blimp");
  const pitch = (m) => (Math.atan2(m.height, m.back) * 180) / Math.PI;
  assert.ok(pitch(wide) > 18 && pitch(wide) < 30, `wide looks down ${pitch(wide)}`);
  assert.ok(Math.abs(pitch(blimp) - 65) < 1, "the blimp looks 65 degrees down");
});

test("the light dip and the moments' timings live in world.uls (DESIGN.md: 80% in 300 ms)", () => {
  assert.deepEqual(look.world.uls.dip, { level: 0.8, ms: 300 });
  assert.equal(look.world.uls.camera, undefined, "restructure-v2.md 4: no camera move of the world's own");
  assert.equal(look.world.uls.ribbons.stepMs, 83);
  assert.equal(look.world.uls.ribbons.dwellMs, 1500, "G3-6: a play's words get 1.5 s before the next call steps in");
  assert.deepEqual(look.world.uls.flare, { peak: 1.15, ms: 300 }, "G3-7: the lamp banks flare x1.15 for 300 ms");
  assert.equal(night.motion.ghostInMs, 400, "his shadow plays come up over 400 ms (play-drawing.md 4)");
  assert.equal(night.motion.ghostOutMs, 300);
});

test("a day kickoff: afternoon sun about 35 degrees up casting the shadows, no tower spots, the day sky", () => {
  const sun = day.lights.find((l) => l.kind === "directional");
  assert.equal(sun.color, ULS.sun);
  assert.equal(sun.castShadow, true);
  assert.equal(day.lights.filter((l) => l.kind === "spot").length, 0, "the towers are off by day");
  const [dx, dy, dh] = [SUN.at[0] - SUN.aim[0], SUN.at[1] - SUN.aim[1], SUN.at[2] - SUN.aim[2]];
  const elevation = (Math.atan2(dh, Math.hypot(dx, dy)) * 180) / Math.PI;
  assert.ok(elevation > 25 && elevation < 45, `elevation ${elevation}`);
  assert.equal(day.environment.background, ULS.daySky);
  assert.equal(day.environment.fog.color, ULS.dayHaze);
  assert.deepEqual(day.strokes, night.strokes, "paint and light on the plays stay the night's");
});
