// field/presnap-layout.js: the words on the field before a Dallas snap, laid out in screen space (play-drawing.md 4b):
// "NEXT 1 · ..." beside its own stroke, "LAST · ..." at the previous play's start or along its path, never at its end;
// no plate on the ball, a stroke or another plate. Swept over all 59 real Dallas pre-snaps through the Under the
// Lights wide camera at 1440x900, 1920x1080 and Sam's MacBook windows.
import assert from "node:assert/strict";
import test from "node:test";

import { boxesOverlap } from "../../static/js/field/label-place.js";
import { LAST_ID, ballBox, nextId, presnapLayout, strokeDots } from "../../static/js/field/presnap-layout.js";
import { verdictChipText } from "../../static/js/model/vm-field.js";
import { capture } from "./field-rows.mjs";
import { dallasPresnaps, plateSize, wideProjector } from "./presnap-scene.mjs";

const C = 26.667;
const SIZES = [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 1512, height: 982 },
  { width: 1728, height: 1117 }];
/** A plain top-down view, 10 px a yard, the near sideline at the bottom (the 2D field's plane). */
const plane = (p) => ({ x: (p.x + 10) * 10, y: (53.333 - p.y - (p.h ?? 0)) * 10 });
const PLANE_BOUNDS = { x0: 0, y0: 0, x1: 1200, y1: 534 };

/** The room every plate keeps around the ball's footprint (px). */
const BALL_ROOM_PX = 4;
const dotUnder = (box, dots) => dots.find((d) => d.x > box.x0 - d.r && d.x < box.x1 + d.r && d.y > box.y0 - d.r
  && d.y < box.y1 + d.r);

/** Every plate's words for a pre-snap: the shadows' tags and bodies, the previous play's LAST plate with its verdict. */
function platesFor(scene, size) {
  const plates = Object.fromEntries(scene.shadows.map((s) => [nextId(s.leaf), plateSize(s.label, size)]));
  const prevRow = scene.last ? capture().rows.find((r) => r.seq === scene.last.seq) : null;
  const sub = prevRow?.pred ? verdictChipText(prevRow.pred, capture().meta.leaf_names) : "";
  if (scene.last?.label) plates[LAST_ID] = plateSize({ tag: "LAST", body: scene.last.label.text, sub }, size);
  return plates;
}

function layoutFor(scene, size) {
  const { project, bounds } = wideProjector(scene.sit, scene.ghosts, size);
  return presnapLayout({ shadows: scene.shadows, last: scene.last ? { drawing: scene.last } : null,
    ball: { x: scene.sit.ballX, y: C }, project, plates: platesFor(scene, size), bounds,
    widths: { shadow: 1.5, last: 5 } });
}

test("a prediction's plate sits beside the end of its own stroke; the previous play's at its start", () => {
  const [first] = dallasPresnaps().filter((p) => p.row.seq === 127);
  const out = presnapLayout({ shadows: first.shadows, last: { drawing: first.last }, ball: { x: first.sit.ballX, y: C },
    project: plane, bounds: PLANE_BOUNDS, plates: platesFor(first, { width: 1440, height: 900 }) });
  assert.deepEqual(out.labels.map((l) => l.id), ["next:run_inside", "next:pa_short", "last"]);
  const [run, pa, last] = out.labels;
  assert.ok(run.clear && pa.clear && last.clear);
  const runEnd = first.shadows[0].drawing.steps[0].to;
  assert.deepEqual([run.at.x, run.at.y], [runEnd.x, runEnd.y], "anchored at the run's end");
  assert.equal(run.choice.side, "right", "past the end, the way the play goes");
  const start = first.last.steps.find((s) => s.from).from;
  assert.ok(Math.hypot(last.at.x - start.x, last.at.y - start.y) < 4, "the previous play's plate at its start");
  for (const [a, b] of [[run, pa], [run, last], [pa, last]]) assert.equal(boxesOverlap(a.box, b.box), false);
  assert.equal(boxesOverlap(last.box, out.ball), false);
});

test("the ball's footprint on screen covers the ball standing in its ring", () => {
  const box = ballBox({ x: 50, y: C }, plane);
  assert.ok(box.x0 < 600 - 9 && box.x1 > 600 + 9 && box.y0 < 266.7 - 10 && box.y1 > 266.7 + 9, JSON.stringify(box));
  assert.equal(ballBox(null, plane), null);
});

test("no projection or no shadows: nothing to place", () => {
  assert.deepEqual(presnapLayout({ shadows: [], ball: { x: 50, y: C } }).labels, []);
  assert.deepEqual(presnapLayout({}).labels, []);
});

for (const size of SIZES) {
  test(`all 59 Dallas pre-snaps through the wide camera at ${size.width}x${size.height}: no plate on another plate,
the ball, a stroke or a mark; the previous play's plate never at its end`, () => {
    let [snaps, leaders] = [0, 0];
    for (const scene of dallasPresnaps()) {
      const out = layoutFor(scene, size);
      const tag = `#${scene.row.seq} ${size.width}x${size.height}`;
      assert.ok(out.labels.length >= 2, `${tag}: ${out.labels.length} plates`);
      for (const [i, a] of out.labels.entries()) {
        assert.ok(a.clear, `${tag} ${a.id} has no clear spot: ${JSON.stringify(a.choice)}`);
        assert.equal(boxesOverlap(a.box, out.ball, BALL_ROOM_PX), false, `${tag} ${a.id} on the ball, or within `
          + `${BALL_ROOM_PX} px of it (the page lays out to the pixel, the camera settles a pixel or two later)`);
        assert.equal(dotUnder(a.box, out.dots), undefined, `${tag} ${a.id} on a stroke`);
        for (const b of out.labels.slice(i + 1)) assert.equal(boxesOverlap(a.box, b.box), false, `${tag} ${a.id}/${b.id}`);
        leaders += a.leader ? 1 : 0;
      }
      const last = out.labels.find((l) => l.id === LAST_ID);
      const strokes = (scene.last?.steps ?? []).filter((s) => s.from && s.to);
      const length = strokes.reduce((n, s) => n + Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y), 0);
      if (last && length > 2) {
        const end = strokes.at(-1).to;
        assert.ok(Math.hypot(last.at.x - end.x, last.at.y - end.y) >= Math.min(length * 0.4, 2),
          `${tag}: the previous play's plate anchored at its end`);
      }
      snaps += 1;
    }
    assert.equal(snaps, 59);
    assert.ok(leaders <= snaps, `${leaders} leader lines over ${snaps} snaps: most plates sit by their anchors`);
  });
}

/** How many of `dots` lie within `r` px of any of `other` ([x, y] lists, at most 4 px apart along their strokes). */
const alongside = (dots, other, r) => dots.filter(([x, y]) => other.some(([u, v]) => Math.hypot(x - u, y - v) <= r))
  .length;
/** A stroke that crosses another at an angle meets it over a few dots; one lying along it (4b: "on top of the
 * previous play") over many. */
const CROSSING_DOTS = 6;
const TOUCH_PX = 4;

for (const size of SIZES.slice(0, 2)) {
  test(`all 59 at ${size.width}x${size.height}: his predictions never lie along the previous play (a crossing at most)`,
    () => {
      let touching = 0;
      for (const scene of dallasPresnaps()) {
        if (!scene.last) continue;
        const { project } = wideProjector(scene.sit, scene.ghosts, size);
        const last = strokeDots(scene.last.steps, project);
        const worst = Math.max(...scene.shadows.map((s) => alongside(strokeDots(s.drawing.steps, project), last,
          TOUCH_PX)));
        assert.ok(worst <= CROSSING_DOTS, `#${scene.row.seq}: ${worst} dots of a prediction along the previous play`);
        touching += worst > 0 ? 1 : 0;
      }
      assert.ok(touching <= 3, `a prediction touches the previous play before ${touching} of 59 snaps`);
    });
}

test("the same scene lays out the same, and a kept choice holds while it is clear (no jitter)", () => {
  const [scene] = dallasPresnaps().filter((p) => p.row.seq === 152);
  const size = { width: 1440, height: 900 };
  const a = layoutFor(scene, size);
  assert.deepEqual(layoutFor(scene, size), a);
  const keep = Object.fromEntries(a.labels.map((l) => [l.id, l.choice]));
  const { project, bounds } = wideProjector(scene.sit, scene.ghosts, size);
  const nudged = (p) => {
    const q = project(p);
    return q && { x: q.x + 3, y: q.y + 2 };   // the camera a hair off where it lands
  };
  const again = presnapLayout({ shadows: scene.shadows, last: { drawing: scene.last }, ball: { x: scene.sit.ballX, y: C },
    project: nudged, plates: platesFor(scene, size), bounds, keep });
  assert.deepEqual(again.labels.map((l) => l.choice), a.labels.map((l) => l.choice));
});
