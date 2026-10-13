// field/shadow-style.js: a prediction on the 3D field is a thin dashed line (about 2.5 px at 1440x900, scaled with the
// view), short dashes with clear gaps, a small arrowhead or tick at its end, coloured by rank (#1 amber, #2 warm
// white), never a filled lane, a thick block, a broad arrow or a landing ring (play-drawing.md 4b).
import assert from "node:assert/strict";
import test from "node:test";

import { PLAY_LOOK, resolvePlayLook } from "../../static/js/field/play-style.js";
import {
  SHADOW_SCALE, rankColor, shadowOpacity, shadowParts, shadowScale,
} from "../../static/js/field/shadow-style.js";
import { buildShadowPlays, shadowForLeaf } from "../../static/js/field/shadows.js";
import { resolveLook } from "../../static/js/theme/look-schema.js";
import { NEUTRAL_LOOK } from "../../static/js/theme/neutral-look.js";
import { look as ULS } from "../../static/js/theme/worlds/under-the-lights/look.js";

const D25 = Object.freeze({ ballX: 25, ltgX: 35, dir: 1, poss: "DAL", kind: "snap", goalToGo: false, down: 1, togo: 10 });
const EPS = 1e-9;
const envFor = (look) => ({ plays: resolvePlayLook(look) });
const own = (list) => list.filter((p) => p.layer !== "casing");
const shadowsOf = (hover = null) => buildShadowPlays({ leaves: [{ leaf: "run_inside", p: 0.28 },
  { leaf: "pa_short", p: 0.16 }, { leaf: "dropback_deep", p: 0.05 }] }, D25, { hover });

test("thin: a px-wide dashed stroke of plays.shadowPx, short dashes, scaled with the view", () => {
  const [run, pa] = shadowsOf().map((s) => own(shadowParts(s, NEUTRAL_LOOK, envFor(NEUTRAL_LOOK))));
  for (const [stroke] of [run, pa]) {
    assert.equal(stroke.units, "px", "screen pixels: as thin at midfield as at the goal line");
    assert.equal(stroke.width, PLAY_LOOK.shadowPx);
    assert.deepEqual(stroke.dash, [...PLAY_LOOK.shadowDash]);
    assert.ok(stroke.dash[0] <= 0.6 && stroke.dash[1] >= 0.4, "short dashes, clear gaps");
  }
  const [big] = own(shadowParts(shadowsOf()[0], NEUTRAL_LOOK, envFor(NEUTRAL_LOOK), { scale: 1.2 }));
  assert.ok(Math.abs(big.width - PLAY_LOOK.shadowPx * 1.2) < EPS);
  assert.equal(shadowScale(900), 1);
  assert.ok(Math.abs(shadowScale(1080) - 1.2) < EPS);
  assert.equal(shadowScale(4000), SHADOW_SCALE.max);
  assert.equal(shadowScale(300), SHADOW_SCALE.min);
  assert.equal(shadowScale(Number.NaN), 1);
});

test("a small end mark, no ring: a run's arrowhead at its tip, a pass's tick across where it lands", () => {
  const [run, pa] = shadowsOf().map((s) => own(shadowParts(s, NEUTRAL_LOOK, envFor(NEUTRAL_LOOK))));
  const [runShadow, paShadow] = shadowsOf();
  assert.equal(run.length, 2);
  const arrow = run[1];
  assert.equal(arrow.path.points.length, 3);
  assert.deepEqual([arrow.path.points[1].x, arrow.path.points[1].y], [runShadow.drawing.steps[0].to.x,
    runShadow.drawing.steps[0].to.y], "its tip at the end of the run");
  assert.ok(arrow.path.length < 2 * PLAY_LOOK.targetYd + EPS, "small");
  assert.equal(arrow.width, run[0].width, "as thin as its line: never a broad arrow");
  const tick = pa[1];
  assert.equal(tick.path.points.length, 2, "a tick, not a ring or an ellipse");
  const to = paShadow.drawing.steps[0].to;
  const mid = { x: (tick.path.points[0].x + tick.path.points[1].x) / 2, y: (tick.path.points[0].y + tick.path.points[1].y) / 2 };
  assert.ok(Math.hypot(mid.x - to.x, mid.y - to.y) < EPS, "centered where it lands");
  assert.ok(tick.path.points.every((p) => p.h === 0), "on the turf");
  assert.ok(Math.abs(tick.path.points[0].x - tick.path.points[1].x) < EPS, "square to its way down the field");
  for (const p of [...run, ...pa]) assert.equal(p.type, "stroke");
  assert.ok(arrow.lag > 0 && tick.lag > 0, "drawn once the stroke is out");
});

test("colour-coded by rank, never by team: #1 amber, #2 warm white (fainter), a hovered third warm white, lit", () => {
  const env = envFor(ULS);
  const [one, two, three] = shadowsOf("dropback_deep").map((s) => own(shadowParts(s, ULS, env)));
  assert.equal(one[0].color, "#ffb21e");
  assert.equal(two[0].color, "#fff3d1");
  assert.ok(two[0].opacity < one[0].opacity, "#2 slightly fainter");
  assert.ok(Math.abs(one[0].opacity - 0.95) < EPS && Math.abs(two[0].opacity - 0.83) < EPS, "thin lines carry ink");
  assert.equal(shadowOpacity(0.25, env.plays), env.plays.shadowBase + env.plays.shadowGain * 0.25, "4th down quieter");
  assert.equal(shadowOpacity(2, env.plays), 1);
  assert.equal(three[0].color, "#fff3d1");
  assert.equal(three[0].opacity, env.plays.hoverOpacity);
  assert.equal(rankColor(1, env.plays), env.plays.ranks[0]);
  assert.equal(rankColor(null, env.plays), env.plays.ranks[1]);
  assert.equal(rankColor(7, { ranks: ["#111111"] }), "#111111", "one colour given: everyone takes it");
  const team = resolveLook({ ghost: { fill: "team" } });
  assert.equal(own(shadowParts(shadowsOf()[0], team, envFor(team)))[0].color, PLAY_LOOK.ranks[0],
    "a world's ghost.fill never makes a prediction team-coloured");
});

test("a casing is thin and optional: one ring per part, under it, the stroke's colour never darkened", () => {
  const look = resolveLook({ world: { plays: { casing: { color: "#0d1424", opacity: 0.3, width: 2 } } } });
  const parts = shadowParts(shadowsOf()[1], look, envFor(look));
  const casings = parts.filter((p) => p.layer === "casing");
  assert.equal(casings.length, 2);
  casings.forEach((c, i) => {
    const p = own(parts)[i];
    assert.equal(c.width, p.width * 2);
    assert.ok(c.order < p.order && c.inner === 0.5 && c.path === p.path);
  });
  assert.equal(shadowParts(shadowsOf()[1], NEUTRAL_LOOK, envFor(NEUTRAL_LOOK)).filter((p) => p.layer === "casing")
    .length, 0, "none by default");
});

// Colour in linear light, as the scene blends it (its render target is linear until the output pass): a part at
// opacity a over a turf or logo pixel is a * part + (1 - a) * pixel; relative luminance and contrast as WCAG 2.2 has them.
const linear = (c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const rgb = (hex) => [1, 3, 5].map((i) => linear(Number.parseInt(hex.slice(i, i + 2), 16)));
const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const over = (top, a, under) => luminance(rgb(top).map((v, i) => a * v + (1 - a) * rgb(under)[i]));
const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
// A light midfield logo's paint: white, the stadium's paint white, light gray, silver (the Raiders' shield).
const LIGHT_LOGOS = ["#ffffff", "#f4f1e6", "#c4c8cc", "#a5acaf"];

test("Under the Lights: over a light midfield logo every dash keeps a thin dark edge, flat (no glow, no blur)", () => {
  const env = envFor(ULS);
  for (const parts of shadowsOf().slice(0, 2).map((s) => shadowParts(s, ULS, env))) {
    const stroke = own(parts)[0];
    const ring = parts.find((p) => p.layer === "casing" && p.path === stroke.path);
    assert.ok(ring, `${stroke.color} is cased`);
    assert.ok((ring.width - stroke.width) / 2 <= 2, "thin: at most 2 px of edge each side at 1440x900");
    assert.ok(ring.inner > 0 && ring.order < stroke.order, "a ring under the stroke, its colour never darkened");
    assert.deepEqual(Object.keys(ring).sort(), Object.keys(stroke).sort(), "the same flat strip: no glow, no blur");
    assert.deepEqual(ring.dash, stroke.dash, "dashed with it");
    for (const logo of LIGHT_LOGOS) {
      // the edge stands off the logo (4.5:1), and the dash off its edge (3:1, WCAG 1.4.11 for graphics); the old
      // 0.55 ring gave 2.08:1 and 1.92:1 for the warm-white #2 on white: the logo swallowed it
      const edge = over(ring.color, ring.opacity, logo);
      const offLogo = contrast(edge, luminance(rgb(logo)));
      const offEdge = contrast(edge, over(stroke.color, stroke.opacity, logo));
      assert.ok(offLogo >= 4.5, `${stroke.color}'s edge on ${logo}: ${offLogo.toFixed(2)}:1`);
      assert.ok(offEdge >= 3, `${stroke.color} off its edge on ${logo}: ${offEdge.toFixed(2)}:1`);
    }
  }
});

test("nothing drawable: no parts; no end mark when targetYd is 0", () => {
  assert.deepEqual(shadowParts(null, NEUTRAL_LOOK, envFor(NEUTRAL_LOOK)), []);
  const none = resolveLook({ world: { plays: { targetYd: 0 } } });
  assert.equal(shadowParts(shadowForLeaf("run_inside", 0.2, D25, 1), none, envFor(none)).length, 1);
});
