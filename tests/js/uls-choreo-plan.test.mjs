// Under the Lights: the camera choreography's decisions (DESIGN.md "Camera by altitude"; surface brief unresolved
// #3; owner W1). Pure: a moment, the choreography's state and the page's facts in, the next shot out.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  SHOTS, endsDrive, isKick, onLanded, onPlay, onPresnap,
} from "../../static/js/theme/worlds/under-the-lights/stadium/choreo-plan.js";

/** timeline.py's KICKS (the server's kick kinds, DC B5), read from the source: the contract the choreography follows. */
const TIMELINE_KICKS = (() => {
  const src = readFileSync(new URL("../../timeline.py", import.meta.url), "utf8");
  const tuple = src.match(/^KICKS\s*=\s*\(([^)]*)\)/m);
  if (!tuple) throw new Error("timeline.py has no KICKS tuple");
  return Object.freeze([...tuple[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
})();

const WIDE = Object.freeze({ viewerMode: "wide", watch: false });
const WATCH = Object.freeze({ viewerMode: "wide", watch: true });
const T = Object.freeze({ pushMs: 650, settleMs: 900, riseMs: 1700, descendMs: 1100 });
const IDLE = Object.freeze({ shot: null, drifting: false });
const res = (extra = {}) => ({ td: false, turnover: false, downs: false, safety: false, turnover_kind: null, ...extra });
const play = (extra = {}) => ({ seq: 2, kind: "play", team: "DAL", opp: "TB", result: res(), ...extra });

test("kicks are kickoffs, punts and field goals; a drive ends on a score, a turnover, downs, a punt or a field goal", () => {
  assert.equal(isKick(play({ kind: "kickoff" })), true);
  assert.equal(isKick(play({ kind: "punt" })), true);
  assert.equal(isKick(play({ kind: "fg" })), true);
  assert.equal(isKick(play()), false);
  assert.equal(isKick(null), false);
  assert.equal(endsDrive(play({ result: res({ td: true }) })), true);
  assert.equal(endsDrive(play({ result: res({ turnover: true, turnover_kind: "int" }) })), true);
  assert.equal(endsDrive(play({ result: res({ downs: true }) })), true);
  assert.equal(endsDrive(play({ result: res({ safety: true }) })), true);
  assert.equal(endsDrive(play({ kind: "punt" })), true);
  assert.equal(endsDrive(play({ kind: "fg" })), true);
  assert.equal(endsDrive(play({ kind: "kickoff" })), false, "a kickoff starts a drive");
  assert.equal(endsDrive(play()), false);
  assert.equal(endsDrive(play({ result: null })), false);
});

test("the snap pushes in to tight and the ball is followed; a kick rises to the blimp to show its whole flight", () => {
  assert.deepEqual(onPlay(IDLE, play(), WIDE, T), { shot: SHOTS.tight, ms: T.pushMs, drift: false, delayMs: 0 });
  assert.deepEqual(onPlay(IDLE, play({ kind: "punt" }), WIDE, T), { shot: SHOTS.blimp, ms: T.riseMs, drift: false, delayMs: 0 });
  assert.deepEqual(onPlay({ shot: SHOTS.blimp, drifting: true }, play({ kind: "kickoff" }), WATCH, T),
    { shot: SHOTS.blimp, ms: 0, drift: true, delayMs: 0 }, "already up there: hold and keep drifting");
  assert.deepEqual(onPlay({ shot: SHOTS.blimp, drifting: true }, play(), WATCH, T),
    { shot: SHOTS.tight, ms: T.pushMs, drift: false, delayMs: 0 }, "the first snap of a drive comes down to the ball");
});

test("after the play the camera settles back to wide; after a drive ends in Watch it rises to the blimp and drifts", () => {
  const tight = { shot: SHOTS.tight, drifting: false };
  assert.deepEqual(onLanded(tight, play(), WIDE, T), { shot: null, ms: T.settleMs, drift: false, delayMs: 0 });
  assert.deepEqual(onLanded(tight, play({ result: res({ td: true }) }), WIDE, T), { shot: null, ms: T.settleMs,
    drift: false, delayMs: 0 }, "live games never go to the blimp on their own");
  assert.deepEqual(onLanded(tight, play({ result: res({ safety: true }) }), WATCH, T),
    { shot: SHOTS.blimp, ms: T.riseMs, drift: true, delayMs: 0 });
  const blimp = { shot: SHOTS.blimp, drifting: false };
  assert.deepEqual(onLanded(blimp, play({ kind: "punt" }), WATCH, T), { shot: SHOTS.blimp, ms: 0, drift: true, delayMs: 0 },
    "a punt ends the drive where it is: drift");
  assert.deepEqual(onLanded(blimp, play({ kind: "kickoff" }), WATCH, T), { shot: null, ms: T.descendMs, drift: false, delayMs: 0 },
    "a kickoff starts the next drive: come down");
  assert.deepEqual(onLanded(blimp, play({ kind: "punt" }), WIDE, T), { shot: null, ms: T.descendMs, drift: false, delayMs: 0 });
  assert.equal(onLanded(IDLE, play(), WIDE, T), null, "nothing to settle from");
});

test("before a call the camera comes back to wide from wherever the choreography took it", () => {
  assert.deepEqual(onPresnap({ shot: SHOTS.blimp, drifting: true }, WATCH, T), { shot: null, ms: T.descendMs, drift: false, delayMs: 0 });
  assert.deepEqual(onPresnap({ shot: SHOTS.tight, drifting: false }, WIDE, T), { shot: null, ms: T.settleMs, drift: false, delayMs: 0 });
  assert.equal(onPresnap(IDLE, WIDE, T), null);
});

test("a viewer who chose another camera (V) is never overridden; a leftover shot is dropped at once", () => {
  const env = { viewerMode: "blimp", watch: true };
  assert.equal(onPlay(IDLE, play(), env, T), null);
  assert.equal(onLanded(IDLE, play({ result: res({ td: true }) }), env, T), null);
  assert.equal(onPresnap(IDLE, env, T), null);
  assert.deepEqual(onPlay({ shot: SHOTS.tight, drifting: false }, play(), env, T), { shot: null, ms: 0, drift: false, delayMs: 0 });
  assert.deepEqual(onLanded({ shot: SHOTS.blimp, drifting: true }, play(), env, T), { shot: null, ms: 0, drift: false, delayMs: 0 });
});

test("G3-5: every kick kind the server sends (timeline.py KICKS) is a kick here, a missed field goal included", () => {
  assert.ok(TIMELINE_KICKS.length >= 4 && TIMELINE_KICKS.includes("fg_miss"), `timeline.py KICKS: ${TIMELINE_KICKS}`);
  for (const kind of TIMELINE_KICKS) assert.equal(isKick(play({ kind })), true, kind);
  assert.equal(endsDrive({ kind: "fg_miss" }), true, "a missed field goal ends the drive");
  assert.equal(endsDrive(play({ kind: "fg_miss", result: res() })), true);
});

test("G3-5: every kick rises to the blimp for its whole flight; in Watch each one that ends a drive drifts after it", () => {
  for (const kind of TIMELINE_KICKS) {
    assert.deepEqual(onPlay(IDLE, play({ kind }), WATCH, T), { shot: SHOTS.blimp, ms: T.riseMs, drift: false, delayMs: 0 },
      `${kind}: never the tight push on a 40-yard flight`);
    assert.deepEqual(onPlay({ shot: SHOTS.blimp, drifting: true }, play({ kind }), WATCH, T),
      { shot: SHOTS.blimp, ms: 0, drift: true, delayMs: 0 }, `${kind}: already drifting up there, it keeps drifting`);
  }
  for (const kind of TIMELINE_KICKS.filter((k) => k !== "kickoff")) {
    assert.deepEqual(onLanded({ shot: SHOTS.blimp, drifting: false }, play({ kind }), WATCH, T),
      { shot: SHOTS.blimp, ms: 0, drift: true, delayMs: 0 }, `${kind} ends the drive: drift`);
  }
});

test("G3-4: in Watch a touchdown or a turnover holds on the play before the camera rises to the blimp", () => {
  const H = { ...T, holdScoreMs: 2000 };
  const tight = { shot: SHOTS.tight, drifting: false };
  for (const result of [res({ td: true }), res({ turnover: true, turnover_kind: "int" }),
    res({ turnover: true, turnover_kind: "fumble" })]) {
    assert.deepEqual(onLanded(tight, play({ result }), WATCH, H),
      { shot: SHOTS.blimp, ms: H.riseMs, drift: true, delayMs: 2000 }, JSON.stringify(result));
  }
  assert.deepEqual(onLanded(IDLE, play({ result: res({ td: true }) }), WATCH, H),
    { shot: SHOTS.blimp, ms: H.riseMs, drift: true, delayMs: 2000 }, "from the wide camera as well");
  assert.deepEqual(onLanded(tight, play({ result: res({ downs: true }) }), WATCH, H),
    { shot: SHOTS.blimp, ms: H.riseMs, drift: true, delayMs: 0 }, "downs: no score, no hold");
  assert.deepEqual(onLanded(tight, play({ kind: "punt" }), WATCH, H), { shot: SHOTS.blimp, ms: H.riseMs, drift: true,
    delayMs: 0 });
  assert.deepEqual(onLanded({ shot: SHOTS.blimp, drifting: false }, play({ result: res({ td: true }) }), WATCH, H),
    { shot: SHOTS.blimp, ms: 0, drift: true, delayMs: 0 }, "a kick return touchdown is up there already: drift");
  assert.deepEqual(onLanded(tight, play({ result: res({ td: true }) }), WIDE, H),
    { shot: null, ms: H.settleMs, drift: false, delayMs: 0 }, "live games settle back to wide as before");
  assert.equal(onLanded(tight, play({ result: res({ td: true }) }), WATCH, T).delayMs, 2000,
    "DESIGN.md's 2 s when the look gives none");
});

test("timings fall back to DESIGN.md's when the look gives none", () => {
  const d = onPlay(IDLE, play(), WIDE, {});
  assert.equal(d.shot, SHOTS.tight);
  assert.ok(d.ms > 0 && d.ms <= 1100);
  assert.ok(onLanded({ shot: SHOTS.tight, drifting: false }, play(), WIDE, undefined).ms > 0);
});
