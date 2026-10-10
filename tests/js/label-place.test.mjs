// field/label-place.js: words placed in screen space after projection (play-drawing.md 4b rule 4): spots around each
// anchor nearest first, clear of other labels, the ball, strokes and the free area's edge, a leader line when a label
// had to move off its anchor, and the last layout's choice kept while it is still clear (no jitter).
import assert from "node:assert/strict";
import test from "node:test";

import { PLACE, boxesOverlap, placeLabels, segmentHitsBox } from "../../static/js/field/label-place.js";

const BOUNDS = { x0: 0, y0: 0, x1: 1000, y1: 700 };
const plate = (id, x, y, extra = {}) => ({ id, w: 200, h: 26, anchors: [{ x, y, sides: ["right", "below", "above"] }],
  ...extra });

test("a lone label sits right beside its anchor, on its first side, with no leader", () => {
  const [one] = placeLabels([plate("a", 100, 100)], { bounds: BOUNDS });
  assert.equal(one.clear, true);
  assert.deepEqual(one.choice, { anchor: 0, side: "right", ring: 0 });
  assert.equal(one.box.x0, 100 + PLACE.gapPx);
  assert.equal(one.center.y, 100);
  assert.equal(one.leader, null);
});

test("labels never overlap: the second steps to a free side or ring of its own anchor", () => {
  const [a, b] = placeLabels([plate("a", 100, 100), plate("b", 100, 110)], { bounds: BOUNDS });
  assert.ok(a.clear && b.clear);
  assert.equal(boxesOverlap(a.box, b.box, PLACE.labelGapPx), false);
});

test("the ball and a stroke push a label off its first spot; a far spot gets a leader that crosses nothing", () => {
  const ball = { x0: 100, y0: 80, x1: 340, y1: 120 };   // a wide obstacle just right of the anchor
  const dots = Array.from({ length: 30 }, (_, i) => ({ x: 100 + i * 8, y: 140, r: 4 }));
  const [one] = placeLabels([plate("a", 90, 100)], { boxes: [ball], dots, bounds: BOUNDS });
  assert.notEqual(one.choice.side, "right", "right of its anchor is the ball");
  assert.equal(one.clear, true);
  assert.equal(boxesOverlap(one.box, ball), false);
  assert.ok(dots.every((d) => !(d.x > one.box.x0 - d.r && d.x < one.box.x1 + d.r && d.y > one.box.y0 - d.r
    && d.y < one.box.y1 + d.r)), "no stroke dot under the plate");
  if (one.leader) {
    assert.equal(segmentHitsBox({ x: one.leader.x1, y: one.leader.y1 }, { x: one.leader.x2, y: one.leader.y2 }, ball),
      false, "the leader never crosses the ball");
  }
});

test("labels stay inside the free area: one by the right edge slides along its side to fit, still at its anchor", () => {
  const [one] = placeLabels([plate("a", 960, 300)], { bounds: BOUNDS });
  assert.ok(one.box.x0 < 960 && one.box.x1 > 960, "it still spans its anchor");
  assert.ok(one.box.x1 <= BOUNDS.x1 - PLACE.edgePx && one.box.x0 >= PLACE.edgePx, JSON.stringify(one.box));
  assert.equal(one.clear, true);
});

test("a kept choice wins while it is clear and no farther out (no jitter), and gives way otherwise", () => {
  const keep = { anchor: 0, side: "above", ring: 0 };
  const [kept] = placeLabels([plate("a", 300, 300, { keep })], { bounds: BOUNDS });
  assert.deepEqual(kept.choice, keep, "as near as the first choice: it holds");
  const blocker = { x0: 200, y0: 200, x1: 520, y1: 295 };
  const [moved] = placeLabels([plate("a", 300, 300, { keep })], { boxes: [blocker], bounds: BOUNDS });
  assert.notDeepEqual(moved.choice, keep, "no longer clear: it moves");
  assert.equal(moved.clear, true);
  const far = { anchor: 0, side: "below", ring: 4 };
  const [near] = placeLabels([plate("a", 300, 300, { keep: far })], { bounds: BOUNDS });
  assert.deepEqual(near.choice, { anchor: 0, side: "right", ring: 0 }, "a far kept spot never holds a plate out there");
});

test("hold: while the view moves a kept choice stays as it is, even where it now runs into something", () => {
  const keep = { anchor: 0, side: "right", ring: 0 };
  const blocker = { x0: 300, y0: 280, x1: 600, y1: 320 };
  const [held] = placeLabels([plate("a", 300, 300, { keep })], { boxes: [blocker], bounds: BOUNDS }, { hold: true });
  assert.deepEqual(held.choice, keep);
  assert.equal(held.clear, false);
  const [free] = placeLabels([plate("a", 300, 300, { keep })], { boxes: [blocker], bounds: BOUNDS });
  assert.equal(free.clear, true, "landed: laid out again");
});

test("with no clear spot the label takes the cheapest: never text on text while any spot avoids it", () => {
  const wall = { x0: 0, y0: 0, x1: 1000, y1: 700 };
  const [a] = placeLabels([plate("a", 500, 350)], { boxes: [wall], bounds: BOUNDS });
  assert.equal(a.clear, false);
  const tight = { x0: 0, y0: 0, x1: 460, y1: 120 };
  const placed = placeLabels([plate("a", 20, 40), plate("b", 30, 50)], { bounds: tight });
  assert.equal(boxesOverlap(placed[0].box, placed[1].box), false, "both fit somewhere apart");
});

test("bad labels are skipped and bad input never throws", () => {
  const out = placeLabels([null, { id: "x", w: 0, h: 10, anchors: [{ x: 1, y: 1 }] }, { id: "y", w: 10, h: 10,
    anchors: [{ x: Number.NaN, y: 0 }] }, plate("ok", 50, 50, { anchors: [{ x: 50, y: 50, sides: ["bogus", "below"] }] })],
  { boxes: [null, { x0: 1 }], dots: [{ x: 1 }], bounds: { x0: 0 } });
  assert.deepEqual(out.map((p) => p.id), ["ok"]);
  assert.equal(out[0].choice.side, "below");
  assert.ok(Object.isFrozen(out));
});

test("segmentHitsBox: through, beside, and touching only an edge's line", () => {
  const b = { x0: 0, y0: 0, x1: 10, y1: 10 };
  assert.equal(segmentHitsBox({ x: -5, y: 5 }, { x: 15, y: 5 }, b), true);
  assert.equal(segmentHitsBox({ x: -5, y: 15 }, { x: 15, y: 15 }, b), false);
  assert.equal(segmentHitsBox({ x: -5, y: -5 }, { x: -1, y: -1 }, b), false);
  assert.equal(segmentHitsBox({ x: 5, y: -5 }, { x: 5, y: -5 }, b), false, "a point outside");
});
