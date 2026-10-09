// The situation paint (ui-architecture 2.5 showSituation; DESIGN.md "The lines"; package A5): the line of
// scrimmage and the line to gain as painted strips across the field, the ball at rest in a white ring, and a
// glide between snaps. Field x in, world x = x - 50 (DC A5).
import assert from "node:assert/strict";
import test from "node:test";
import { loadThree, lookWith } from "./three-env.mjs";

const THREE = await loadThree();
const { createKit } = await import("../../static/js/field/materials.js");
const { createLines } = await import("../../static/js/field/lines.js");

const DAL25 = Object.freeze({ ballX: 25, ltgX: 35, dir: 1, poss: "DAL", kind: "snap", goalToGo: false, down: 1, togo: 10 });

async function setup(partial = {}) {
  const look = await lookWith(partial);
  const kit = createKit(look);
  return { look, kit, lines: createLines(look, kit) };
}

const settle = (lines) => { for (let t = 0; t < 5000; t += 16) if (!lines.step(16)) return t; return 5000; };

test("1st & 10 at DAL 25: the LOS at world -25, the LTG at -15, the ball on the LOS mid-field", async () => {
  const { lines, look } = await setup();
  lines.set(DAL25, { instant: true });
  const s = lines.state();
  assert.deepEqual([s.los.visible, s.ltg.visible, s.ball.visible], [true, true, true]);
  assert.equal(s.los.x, -25);
  assert.equal(s.ltg.x, -15);
  assert.equal(s.ball.x, -25);
  assert.equal(s.ball.z, 0, "ESPN gives no hash: the ball sits mid-field");
  assert.equal(s.los.width, look.lines.los.widthYd);
  assert.ok(Math.abs(s.los.length - 53.333) < 0.01, "sideline to sideline");
});

test("goal to go hides the line to gain (the goal line is the line); a kickoff shows only the ball", async () => {
  const { lines } = await setup();
  lines.set({ ...DAL25, ballX: 92, ltgX: 100, goalToGo: true, togo: 8 }, { instant: true });
  assert.equal(lines.state().ltg.visible, false);
  assert.equal(lines.state().los.visible, true);
  lines.set({ ballX: 35, ltgX: null, dir: 1, poss: "DAL", kind: "kickoff", goalToGo: false, down: null, togo: null },
    { instant: true });
  const s = lines.state();
  assert.deepEqual([s.los.visible, s.ltg.visible, s.ball.visible, s.ball.upright], [false, false, true, true]);
});

test("no situation: a bare field (FI 3.3)", async () => {
  const { lines } = await setup();
  lines.set(DAL25, { instant: true });
  lines.set(null, { instant: true });
  const s = lines.state();
  assert.deepEqual([s.los.visible, s.ltg.visible, s.ball.visible, s.ring.visible], [false, false, false, false]);
});

test("between snaps the lines and the ball glide to the new spot, then stop asking for frames", async () => {
  const { lines } = await setup();
  lines.set(DAL25, { instant: true });
  lines.set({ ...DAL25, ballX: 33, ltgX: 43, down: 2, togo: 2 });
  assert.equal(lines.step(16), true);
  const mid = lines.state().los.x;
  assert.ok(mid > -25 && mid < -17, `moving: ${mid}`);
  const t = settle(lines);
  assert.ok(t > 100 && t < 3000, `settled after ${t} ms`);
  assert.equal(lines.state().los.x, -17);
  assert.equal(lines.state().ltg.x, -7);
  assert.equal(lines.step(16), false);
});

test("a line that appears does not slide in from somewhere else", async () => {
  const { lines } = await setup();
  lines.set(null, { instant: true });
  lines.set(DAL25);
  assert.equal(lines.state().los.x, -25);
  assert.equal(lines.step(16), false);
});

test("the player can take the ball: setBallVisible hides only the resting ball", async () => {
  const { lines } = await setup();
  lines.set(DAL25, { instant: true });
  lines.setBallVisible(false);
  const s = lines.state();
  assert.deepEqual([s.ball.visible, s.los.visible, s.ring.visible], [false, true, true]);
  lines.setBallVisible(true);
  assert.equal(lines.state().ball.visible, true);
});

test("the strips use the kit's paint and lie on the turf; dispose frees only what lines owns", async () => {
  const { lines, kit } = await setup();
  const strips = lines.group.children.filter((o) => o.isMesh && o.material === kit.line("los"));
  assert.equal(strips.length, 1);
  assert.ok(lines.group.children.every((o) => o.position.y >= 0));
  let disposed = 0;
  kit.line("los").addEventListener("dispose", () => { disposed += 1; });
  lines.dispose();
  assert.equal(disposed, 0, "the kit's materials are shared");
  assert.ok(new THREE.Group().children.length === 0);
});
