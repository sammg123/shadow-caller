// field/camera-plan.js: what each camera must keep in view, and a pose that fits it for any aspect.
import assert from "node:assert/strict";
import test from "node:test";

import {
  CAMERA_PRESETS, FRAME_PRESETS, RIGS, fitDistance, frameBall, frameDrawing, frameDrive, framePoints,
  framePresetFor, frameSituation, nextMode, poseFor, projectToNdc, unionFrame,
} from "../../static/js/field/camera-plan.js";
import { buildGhostSet, ghostInputFromPred } from "../../static/js/field/ghosts.js";
import { buildDrawing, situationFromRow } from "../../static/js/field/paths.js";
import { allRows, rowById } from "./field-rows.mjs";

const C = 26.667;
const ASPECTS = [16 / 9, 16 / 10, 4 / 3, 21 / 9, 390 / 844];
const lo = (f) => f.center.x - f.spanX / 2;
const hi = (f) => f.center.x + f.spanX / 2;
const contains = (f, x, y = C) => x >= lo(f) - 1e-9 && x <= hi(f) + 1e-9
  && y >= f.center.y - f.spanY / 2 - 1e-9 && y <= f.center.y + f.spanY / 2 + 1e-9;

const firstSnap = () => rowById("40187298068");
const situation = (over = {}) => ({ ...situationFromRow(firstSnap()), ...over });

test("frameSituation keeps the line of scrimmage, the line to gain and room ahead", () => {
  const f = frameSituation(situation());
  assert.equal(f.dir, 1);
  assert.ok(contains(f, 30) && contains(f, 40));
  assert.ok(hi(f) >= 30 + FRAME_PRESETS.standard.ahead, "room for the play ahead of the ball");
  assert.ok(lo(f) <= 30 - FRAME_PRESETS.standard.back, "room for the drop behind it");
  assert.ok(f.spanY >= 53.333 - 1e-9, "both sidelines");
  const tb = frameSituation(situationFromRow(rowById("401872980390")));
  assert.equal(tb.dir, -1);
  assert.ok(contains(tb, 73) && contains(tb, 63) && lo(tb) <= 73 - 22);
});

test("the tight frame is smaller but never loses the line to gain", () => {
  const std = frameSituation(situation());
  const tight = frameSituation(situation(), { preset: "tight" });
  assert.ok(tight.spanX < std.spanX && tight.spanY < std.spanY);
  const long = frameSituation(situation({ ltgX: 55, togo: 25 }), { preset: "tight" });
  assert.ok(contains(long, 30) && contains(long, 55));
});

test("frames stay inside the end lines and include every ghost", () => {
  const sit = situation({ ballX: 97, ltgX: 100 });
  const f = frameSituation(sit);
  assert.ok(lo(f) >= -10 && hi(f) <= 110);
  const ghosts = buildGhostSet({ leaves: [{ leaf: "dropback_deep", p: 0.6 }, { leaf: "screen", p: 0.2 }] },
    situation({ ballX: 30, ltgX: 40 }));
  const g = frameSituation(situation(), { ghosts });
  for (const s of ghosts.shapes) assert.ok(contains(g, s.x0) && contains(g, s.x1), s.leaf);
  assert.ok(hi(g) >= 65);
});

test("no situation frames the whole field", () => {
  const f = frameSituation(null);
  assert.deepEqual(f.center, { x: 50, y: 26.6665 });
  assert.equal(f.spanX, 120);
  assert.equal(f.spanY, 53.333);
  assert.deepEqual(frameSituation(situation(), { preset: "wide" }), { ...f, dir: 1 });
});

test("frameDrawing holds the whole play, kick height included", () => {
  const run = frameDrawing(buildDrawing(rowById("4018729802242")));
  assert.ok(contains(run, 86) && contains(run, 14) && contains(run, 90));
  const ko = frameDrawing(buildDrawing(rowById("40187298040")));
  assert.ok(contains(ko, 65) && contains(ko, 3) && contains(ko, 30));
  assert.ok(ko.maxH > 15);
  const admin = frameDrawing(buildDrawing(rowById("401872980353")));
  assert.equal(admin.spanX, 120);
});

test("unionFrame holds both frames: the outer spans, the higher arc, the first frame's attack direction", () => {
  const sit = situationFromRow(rowById("4018729802242"));       // TB's 72-yard run, from TB 14 toward the left
  const live = frameSituation(sit);
  const play = frameDrawing(buildDrawing(rowById("4018729802242")));
  const u = unionFrame(live, play);
  assert.equal(u.dir, live.dir);
  assert.ok(Math.abs(lo(u) - Math.min(lo(live), lo(play))) < 1e-9 && Math.abs(hi(u) - Math.max(hi(live), hi(play))) < 1e-9);
  for (const f of [live, play]) {
    assert.ok(u.center.y - u.spanY / 2 <= f.center.y - f.spanY / 2 + 1e-9);
    assert.ok(u.center.y + u.spanY / 2 >= f.center.y + f.spanY / 2 - 1e-9);
  }
  assert.ok(contains(u, 86) && contains(u, 14), "the line of scrimmage and where the run ended");
  const kick = frameDrawing(buildDrawing(rowById("40187298040")));
  assert.equal(unionFrame(live, kick).maxH, kick.maxH, "a kick's arc height comes along");
  assert.equal(unionFrame(kick, live).maxH, kick.maxH);
  const same = unionFrame(live, live);
  for (const k of ["spanX", "spanY", "maxH"]) assert.ok(Math.abs(same[k] - live[k]) < 1e-9, `a frame with itself: ${k}`);
  assert.ok(Math.abs(same.center.x - live.center.x) < 1e-9 && Math.abs(same.center.y - live.center.y) < 1e-9);
});

test("unionFrame with nothing to add is the frame it has", () => {
  const live = frameSituation(situation());
  assert.equal(unionFrame(live, null), live);
  assert.equal(unionFrame(null, live), live);
  assert.equal(unionFrame(null, undefined), null);
});

test("frameDrive spans a drive from its kickoff to the touchdown", () => {
  const rows = allRows();
  const f = frameDrive(rows, 1);
  assert.equal(f.dir, 1);
  assert.ok(contains(f, 30) && contains(f, 100) && contains(f, 65));
  assert.equal(frameDrive(rows, 999), null);
  assert.equal(frameDrive([], 1), null);
});

test("frameBall follows the ball and keeps the line when it is close", () => {
  const sit = situation();
  const f = frameBall({ x: 45, y: 30, h: 4 }, sit);
  assert.ok(contains(f, 45, 30) && contains(f, 30));
  const far = frameBall({ x: 95, y: 26.667, h: 0 }, sit);
  assert.ok(contains(far, 95) && !contains(far, 30));
});

test("a camera mode picks its frame: ball-following modes frame tight, the blimp frames the field", () => {
  assert.equal(framePresetFor({ rig: "sideline", follow: "ball" }), "tight");
  assert.equal(framePresetFor({ rig: "blimp", follow: "none" }), "wide");
  assert.equal(framePresetFor({ rig: "endzone", follow: "none" }), "standard");
  assert.equal(framePresetFor(null), "standard");
});

test("nextMode cycles and wraps", () => {
  const ids = ["broadcast", "endzone", "overhead"];
  assert.equal(nextMode(ids, "broadcast"), "endzone");
  assert.equal(nextMode(ids, "overhead"), "broadcast");
  assert.equal(nextMode(ids, null), "broadcast");
  assert.equal(nextMode(ids, "gone"), "broadcast");
  assert.equal(nextMode([], "x"), "x");
  assert.equal(nextMode([], null), "");
});

test("every preset camera fits the situation at every aspect, laptop to phone", () => {
  const frames = [frameSituation(situation()), frameSituation(situationFromRow(rowById("401872980390"))),
    frameSituation(situation(), { preset: "tight" }), frameDrawing(buildDrawing(rowById("40187298040")))];
  for (const mode of CAMERA_PRESETS) {
    for (const aspect of ASPECTS) {
      for (const frame of frames) {
        const pose = poseFor(frame, mode, { aspect });
        assert.ok(pose.position.h > 0, `${mode.id} above the turf`);
        for (const p of framePoints(frame, mode)) {
          const ndc = projectToNdc(p, pose, aspect);
          assert.ok(ndc.depth > 0, `${mode.id} ${aspect} point behind the camera`);
          assert.ok(Math.abs(ndc.x) <= 1 + 1e-6 && Math.abs(ndc.y) <= 1 + 1e-6,
            `${mode.id} @${aspect.toFixed(2)} (${p.x}, ${p.y}, ${p.h}) -> ${ndc.x.toFixed(3)}, ${ndc.y.toFixed(3)}`);
        }
      }
    }
  }
});

test("rig geometry: broadcast on the near side, end zone behind the offense, overhead straight down", () => {
  const f = frameSituation(situation());
  const byId = Object.fromEntries(CAMERA_PRESETS.map((m) => [m.id, m]));
  const broadcast = poseFor(f, byId.broadcast, { aspect: 16 / 9 });
  assert.ok(broadcast.position.y < broadcast.target.y);
  const ez = poseFor(f, byId.endzone, { aspect: 16 / 9 });
  assert.ok(ez.position.x < ez.target.x, "behind DAL, which attacks to the right");
  const ezTb = poseFor(frameSituation(situationFromRow(rowById("401872980390"))), byId.endzone, { aspect: 16 / 9 });
  assert.ok(ezTb.position.x > ezTb.target.x, "behind TB, which attacks to the left");
  const top = poseFor(f, byId.overhead, { aspect: 16 / 9 });
  assert.ok(Math.abs(top.position.x - top.target.x) < 1e-6 && Math.abs(top.position.y - top.target.y) < 1e-6);
  assert.deepEqual([top.up.x, top.up.y].map((v) => Math.round(v * 1e6) / 1e6), [0, 1], "far sideline at the top");
  assert.ok(byId.tight && byId.high && byId.broadcast);
});

test("a narrow screen pushes the camera back or widens the lens", () => {
  const f = frameSituation(situation());
  const wide = poseFor(f, CAMERA_PRESETS[0], { aspect: 16 / 9 });
  const phone = poseFor(f, CAMERA_PRESETS[0], { aspect: 390 / 844 });
  assert.ok(phone.distance > wide.distance || phone.fov > wide.fov);
  const bad = poseFor(f, { rig: "nope" }, { aspect: Number.NaN });
  assert.ok(Number.isFinite(bad.distance) && bad.fov === RIGS.sideline.fov);
});

test("fitDistance is the closest distance that keeps every point inside the margins", () => {
  const forward = { x: 0, y: 0, h: -1 };
  const pts = [{ x: -10, y: 0, h: 0 }, { x: 10, y: 0, h: 0 }];
  const d = fitDistance(pts, { x: 0, y: 0, h: 0 }, forward, { vFovDeg: 90, aspect: 1,
    margins: { left: 0, right: 0, top: 0, bottom: 0 } });
  assert.ok(Math.abs(d - 10) < 1e-6);
});
