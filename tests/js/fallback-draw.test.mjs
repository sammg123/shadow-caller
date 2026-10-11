// field/fallback-draw.js (A6): the 2D field's layout, team paints, static field and situation, as plain node specs.
import assert from "node:assert/strict";
import test from "node:test";

import {
  APRON_YD, DRIVE_FRAME, OBLIQUE, ballNodes, driveFrame, fieldNodes, layoutPlane, lerpBox, paintsFor, planePoint,
  sceneContext, situationNodes, tagSize, unionBox, viewBoxFor,
} from "../../static/js/field/fallback-draw.js";
import { resolveLook } from "../../static/js/theme/look-schema.js";
import { NEUTRAL_LOOK } from "../../static/js/theme/neutral-look.js";
import { capture } from "./field-rows.mjs";

const near = (a, b, label = "", eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${label} ${a} != ${b}`);
const T = capture();
const ctxFor = (look = NEUTRAL_LOOK, size = { width: 1440, height: 900 }) => sceneContext({
  look, layout: layoutPlane(size), field: T.field, teams: T.teams, teamOrder: T.team_order, ids: "t1" });

function walk(nodes, out = []) {
  for (const node of nodes ?? []) {
    out.push(node);
    walk(node.children, out);
  }
  return out;
}
const parts = (nodes, part) => walk(nodes).filter((n) => n.attrs?.["data-part"] === part);
const texts = (nodes) => walk(nodes).filter((n) => n.tag === "text").map((n) => n.text);

test("the field fits the host with its apron, centered, true 120 by 53.3 proportions", () => {
  const L = layoutPlane({ width: 1440, height: 900 });
  near(L.px, 1440 / (120 + 2 * APRON_YD), "px per yard");
  near(L.rect.w, 120 * L.px, "w");
  near(L.rect.h, 53.333 * L.px, "h");
  near(L.rect.x, (1440 - L.rect.w) / 2, "x");
  near(L.rect.y, (900 - L.rect.h) / 2, "y");
});

test("safe-area insets keep the field inside the free area the HUD leaves", () => {
  const L = layoutPlane({ width: 1440, height: 900, insets: { top: 44, right: 456, bottom: 184, left: 0 } });
  assert.deepEqual(L.free, { x: 0, y: 44, w: 984, h: 672 });
  near(L.px, 984 / (120 + 2 * APRON_YD), "px per yard");
  assert.ok(L.rect.x >= 0 && L.rect.x + L.rect.w <= 984 + 1e-9);
  assert.ok(L.rect.y >= 44 && L.rect.y + L.rect.h <= 716 + 1e-9);
});

test("insets that leave too little room, and missing sizes, fall back to the whole host or a default", () => {
  const L = layoutPlane({ width: 390, height: 300, insets: { right: 300 } });
  assert.deepEqual(L.free, { x: 0, y: 0, w: 390, h: 300 });
  const D = layoutPlane({ width: 0, height: NaN });
  assert.ok(D.width > 0 && D.height > 0 && D.px > 0);
  const N = layoutPlane({ width: 800, height: 450, insets: { top: -20, left: "x" } });
  assert.deepEqual(N.free, { x: 0, y: 0, w: 800, h: 450 });
});

test("the Wide view: a field box fitted to the free area's aspect, centered on it; the whole field without one", () => {
  const box = { x0: 22, x1: 50, y0: 15, y1: 35 };
  const L = layoutPlane({ width: 1440, height: 900, insets: { right: 456, bottom: 140 }, frame: box });
  near(L.px, Math.min(984 / 28, 760 / 20), "the box fills the free area one way");
  const mid = planePoint(L, 36, 25);
  near(mid.px, 984 / 2, "centered across the free area");
  near(mid.py, 760 / 2, "and down it");
  assert.deepEqual(L.view, box);
  const whole = layoutPlane({ width: 1440, height: 900, frame: null });
  assert.equal(whole.view, null);
  near(whole.px, 1440 / (120 + 2 * APRON_YD), "no box: the whole field, as before");
  for (const bad of [{ x0: 10, x1: 10, y0: 0, y1: 5 }, { x0: "a" }, { x0: 0, x1: 20, y0: 9, y1: Number.NaN }]) {
    assert.equal(layoutPlane({ width: 800, height: 450, frame: bad }).view, null, JSON.stringify(bad));
  }
});

test("driveFrame: the snap with his shadows and their words, never smaller than DRIVE_FRAME's spans", () => {
  const sit = { ballX: 30, ltgX: 40, dir: 1, poss: "DAL", kind: "snap" };
  const run = { from: { x: 30, y: 26.667 }, to: { x: 34, y: 26.667 }, apex: 0 };
  const pass = { from: { x: 30, y: 26.667 }, to: { x: 55, y: 26.667 }, apex: 4.5 };
  const f = driveFrame(sit, [run, pass]);
  assert.ok(f.x0 <= 30 - DRIVE_FRAME.back && f.x1 >= 55, `from behind the line to the deep shot: ${JSON.stringify(f)}`);
  assert.ok(f.y1 >= 26.667 + 4.5 && f.y0 <= 26.667 - DRIVE_FRAME.below, "the arc's lift above, the words below");
  assert.ok(f.x1 - f.x0 >= DRIVE_FRAME.minSpanX && f.y1 - f.y0 >= DRIVE_FRAME.minSpanY);
  const short = driveFrame(sit, [run]);
  near(short.x1 - short.x0, DRIVE_FRAME.minSpanX, "a short shadow still shows the drive around it");
  const away = driveFrame({ ...sit, ballX: 70, dir: -1, ltgX: 60 }, []);
  assert.ok(away.x0 <= 60 && away.x1 >= 70 + DRIVE_FRAME.back, "the other way");
  const goal = driveFrame({ ...sit, ballX: 105 }, []);
  assert.ok(goal.x1 <= 110 + APRON_YD && goal.x1 - goal.x0 >= DRIVE_FRAME.minSpanX, "kept on the field and its apron");
  assert.equal(driveFrame(null, []), null);
  assert.equal(driveFrame({ ...sit, kind: "kickoff" }, []), null, "a kickoff: the whole field");
  const both = unionBox(short, { x0: 0, x1: 80, y0: 10, y1: 40 });
  assert.deepEqual(both, { x0: 0, x1: 80, y0: Math.min(short.y0, 10), y1: Math.max(short.y1, 40) });
  assert.equal(unionBox(null, short), short);
  const half = lerpBox({ x0: 0, x1: 10, y0: 0, y1: 10 }, { x0: 10, x1: 30, y0: 10, y1: 30 }, 0.5);
  assert.deepEqual(half, { x0: 5, x1: 20, y0: 5, y1: 20 });
});

test("the static field shows the Wide view through a viewBox over its whole-field drawing", () => {
  const top = layoutPlane({ width: 1440, height: 900 });
  const view = layoutPlane({ width: 1440, height: 900, frame: { x0: 22, x1: 50, y0: 15, y1: 35 } });
  const [x, y, w, h] = viewBoxFor(top, view).split(" ").map(Number);
  const k = top.px / view.px;
  near(w, 1440 * k, "", 0.01);
  near(h, 900 * k, "", 0.01);
  const p = planePoint(top, 36, 25);
  const q = planePoint(view, 36, 25);
  near((p.px - x) / k, q.px, "a field point lands on the same screen spot in both layers", 0.01);
  near((p.py - y) / k, q.py, "", 0.01);
  assert.equal(viewBoxFor(top, top), "0 0 1440 900");
});

test("planePoint: caller's end zone on the left, near sideline at the bottom, height lifts toward the far side", () => {
  const L = layoutPlane({ width: 1440, height: 900 });
  const goal = planePoint(L, 0, 0);
  near(goal.px, L.rect.x + 10 * L.px, "goal line x");
  near(goal.py, L.rect.y + L.rect.h, "near sideline y");
  const far = planePoint(L, 110, 53.333);
  near(far.px, L.rect.x + L.rect.w, "end line");
  near(far.py, L.rect.y, "far sideline");
  const up = planePoint(L, 50, 26.667, 10);
  near(planePoint(L, 50, 26.667).py - up.py, 10 * OBLIQUE * L.px, "10 yd of height");
});

test("team paints from the timeline teams: caller on the left, validated colors, neutral when missing", () => {
  const paints = paintsFor(NEUTRAL_LOOK, T.field, T.teams, T.team_order);
  assert.equal(paints.left, "DAL");
  assert.equal(paints.right, "TB");
  assert.equal(paints.byTeam.DAL.fill, "#002a5c");
  assert.equal(paints.byTeam.TB.fill, "#bd1c36");
  assert.equal(paints.names.DAL, "Cowboys");
  const bad = paintsFor(NEUTRAL_LOOK, null, { DAL: { color: "red; x", name: 5 }, "<b>": { color: "#ffffff" } }, []);
  assert.equal(bad.byTeam.DAL.neutral, true);
  assert.equal(bad.names.DAL, "DAL");
  assert.equal(bad.byTeam["<b>"], undefined, "a key that is not a team abbreviation is dropped");
  const none = paintsFor(NEUTRAL_LOOK, null, null, null);
  assert.equal(none.left, null);
  assert.equal(none.neutral.neutral, true);
});

test("the static field: ground, turf stripes, team end zones with names, paint, numerals, hashes, posts", () => {
  const ctx = ctxFor();
  const nodes = fieldNodes(ctx);
  const ground = parts(nodes, "ground")[0];
  assert.deepEqual([ground.attrs.width, ground.attrs.height, ground.attrs.fill], [1440, 900, "#cfd3d7"]);
  const stripes = parts(nodes, "stripes");
  assert.deepEqual(stripes.map((s) => s.attrs.fill), ["#7c8b7f", "#768579"]);
  const zones = parts(nodes, "end-zone");
  assert.deepEqual(zones.map((z) => [z.attrs["data-team"], z.attrs.fill]), [["DAL", "#002a5c"], ["TB", "#bd1c36"]]);
  const left = zones[0];
  near(left.attrs.x, planePoint(ctx.layout, -10, 0).px, "left end zone starts at the end line", 0.01);
  const names = parts(nodes, "end-zone-name");
  assert.deepEqual(names.map((n) => n.text), ["COWBOYS", "BUCCANEERS"]);
  assert.match(names[0].attrs.transform, /rotate\(-90/);
  assert.match(names[1].attrs.transform, /rotate\(90/);
  assert.deepEqual(parts(nodes, "numeral").map((n) => n.text),
    ["10", "20", "30", "40", "50", "40", "30", "20", "10", "10", "20", "30", "40", "50", "40", "30", "20", "10"]);
  assert.ok(parts(nodes, "hashes")[0].attrs.d.length > 1000, "one path of 1-yard ticks");
  assert.equal(parts(nodes, "post").length, 2);
  assert.equal(parts(nodes, "yard-lines").length, 1);
  assert.equal(parts(nodes, "goal-lines").length, 1);
});

test("look switches: neutral end zones with abbreviations, no numerals, no hashes, 10-yard stripes", () => {
  const look = resolveLook({ field: { endZones: "neutral", endZoneText: "abbr", numerals: false, hashes: false,
    stripeYd: 10 } });
  const nodes = fieldNodes(ctxFor(look));
  assert.deepEqual(parts(nodes, "end-zone-name").map((n) => n.text), ["DAL", "TB"]);
  assert.ok(parts(nodes, "end-zone").every((z) => z.attrs.fill === look.field.turf[0]));
  assert.equal(parts(nodes, "numeral").length, 0);
  assert.equal(parts(nodes, "hashes").length, 0);
  const none = fieldNodes(ctxFor(resolveLook({ field: { endZoneText: "none" } })));
  assert.equal(parts(none, "end-zone-name").length, 0);
});

test("fixtures and the home logo: gold posts, eight orange pylons, the home team's logo at midfield", () => {
  const nodes = fieldNodes(ctxFor());
  assert.ok(parts(nodes, "post").every((p) => p.attrs.stroke === "#ffc425"), "NFL gold, as the WebGL field");
  const pylons = parts(nodes, "pylons")[0];
  assert.equal(pylons.attrs.fill, "#ff6a13");
  assert.equal(pylons.attrs.d.match(/M/g).length, 8);
  const logo = parts(nodes, "logo")[0];
  assert.equal(logo.tag, "image");
  assert.equal(logo.attrs.href, "/api/logo/DAL");
  const unsafe = sceneContext({ look: NEUTRAL_LOOK, layout: layoutPlane({ width: 800, height: 450 }), field: T.field,
    teams: { ...T.teams, DAL: { ...T.teams.DAL, logo: "javascript:alert(1)" } }, teamOrder: T.team_order, ids: "t3" });
  assert.equal(parts(fieldNodes(unsafe), "logo").length, 0, "only the app's own logo proxy");
});

test("tags shrink on a small field", () => {
  const phone = ctxFor(NEUTRAL_LOOK, { width: 390, height: 300 });
  const sit = { ballX: 25, ltgX: 35, dir: 1, poss: "DAL", kind: "snap", goalToGo: false, down: 1, togo: 10 };
  const tag = walk(parts(situationNodes(sit, phone), "down-tag")).find((n) => n.tag === "text");
  assert.match(tag.attrs.style, /--sc-size-xs/);
  assert.equal(tagSize(ctxFor(), "m"), "m");
  assert.equal(tagSize(phone, "m"), "xs");
});

test("a ball in the air carries a halo; on the turf it doesn't", () => {
  const ctx = ctxFor();
  assert.equal(parts(ballNodes({ x: 50, y: 26.667, h: 6 }, ctx), "ball-halo").length, 1);
  assert.equal(parts(ballNodes({ x: 50, y: 26.667, h: 0 }, ctx), "ball-halo").length, 0);
});

test("a field without teams still draws (bare end zones, no names)", () => {
  const ctx = sceneContext({ look: NEUTRAL_LOOK, layout: layoutPlane({ width: 800, height: 450 }), field: null,
    teams: null, teamOrder: null, ids: "t2" });
  const nodes = fieldNodes(ctx);
  assert.equal(parts(nodes, "end-zone").length, 2);
  assert.equal(parts(nodes, "end-zone-name").length, 0);
  assert.ok(texts(nodes).every((t) => typeof t === "string"));
});

test("situation: LOS at the ball, LTG ahead, ball on the center line, a down-and-distance tag", () => {
  const ctx = ctxFor();
  const sit = { ballX: 25, ltgX: 35, dir: 1, poss: "DAL", kind: "snap", goalToGo: false, down: 1, togo: 10 };
  const nodes = situationNodes(sit, ctx);
  const los = parts(nodes, "los")[0];
  const ltg = parts(nodes, "ltg")[0];
  near(los.attrs.x + los.attrs.width / 2, planePoint(ctx.layout, 25, 0).px, "LOS centered on the ball", 0.01);
  near(ltg.attrs.x + ltg.attrs.width / 2, planePoint(ctx.layout, 35, 0).px, "LTG at 35", 0.01);
  assert.equal(los.attrs.fill, NEUTRAL_LOOK.lines.los.color);
  assert.equal(ltg.attrs.fill, NEUTRAL_LOOK.lines.ltg.color);
  assert.ok(los.attrs.width >= 2, "at least 2 px wide");
  assert.equal(parts(nodes, "ball").length, 1);
  assert.deepEqual(texts(parts(nodes, "down-tag")), ["1st & 10"]);
});

test("situation: goal to go hides the LTG and says Goal; a kickoff has no line to gain; null is bare", () => {
  const ctx = ctxFor();
  const goal = situationNodes({ ballX: 92, ltgX: 100, dir: 1, poss: "DAL", kind: "snap", goalToGo: true, down: 1,
    togo: 8 }, ctx);
  assert.equal(parts(goal, "ltg").length, 0);
  assert.deepEqual(texts(parts(goal, "down-tag")), ["1st & Goal"]);
  const kick = situationNodes({ ballX: 65, ltgX: null, dir: -1, poss: "TB", kind: "kickoff", goalToGo: false,
    down: null, togo: null }, ctx);
  assert.equal(parts(kick, "ltg").length, 0);
  assert.equal(parts(kick, "down-tag").length, 0);
  assert.equal(parts(kick, "ball").length, 1);
  assert.deepEqual(situationNodes(null, ctx), []);
  assert.equal(parts(situationNodes(null, ctx, { ball: { x: 61, y: 26.667 } }), "ball").length, 1);
});

test("the ball by look kind, lifted by its height, with a shadow on the turf when it flies", () => {
  const ctx = ctxFor();
  const flat = ballNodes({ x: 50, y: 26.667, h: 0 }, ctx);
  assert.equal(parts(flat, "ball-shadow").length, 0);
  const air = ballNodes({ x: 50, y: 26.667, h: 8 }, ctx);
  assert.equal(parts(air, "ball-shadow").length, 1);
  const dot = ballNodes({ x: 50, y: 26.667, h: 0 }, ctxFor(resolveLook({ ball: { kind: "dot" } })));
  assert.equal(walk(dot).some((n) => n.tag === "circle"), true);
  assert.deepEqual(ballNodes({ x: NaN, y: 1 }, ctx), []);
});

test("node specs carry only plain data: finite numbers and strings, no functions", () => {
  const ctx = ctxFor(NEUTRAL_LOOK, { width: 390, height: 844 });
  const all = walk([...fieldNodes(ctx), ...situationNodes({ ballX: 30, ltgX: 40, dir: 1, poss: "DAL", kind: "snap",
    goalToGo: false, down: 2, togo: 10 }, ctx)]);
  for (const node of all) {
    assert.equal(typeof node.tag, "string");
    for (const [k, v] of Object.entries(node.attrs ?? {})) {
      assert.ok(typeof v === "string" || (typeof v === "number" && Number.isFinite(v)), `${node.tag}.${k} = ${v}`);
    }
  }
});
