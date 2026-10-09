// What the WebGL engine writes on its #field host (ui-architecture 5.3) and reports from debugState (2.5). Pure.
// The situation hooks must agree with model/vm-field.js exactly, because the field host writes the same ones.
import assert from "node:assert/strict";
import test from "node:test";
import {
  hookValues, animStateOf, ghostLeaves, hostAttrs, debugRecord, NO_HOOKS,
} from "../../static/js/field/engine-state.js";
import { fieldVm } from "../../static/js/model/vm-field.js";
import { makePv, patch, state, timeline, tlOf } from "./model-fixtures.mjs";

const FIELD = timeline.final().field;
const vmOf = (presented, tl) => fieldVm(makePv({ presented, tl }));
const withSit = (sit) => patch(state.drive(), { sit: { ...state.drive().sit, ...sit } });

function agrees(vm) {
  const h = hookValues(vm.situation, FIELD);
  assert.deepEqual([h.ballX, h.ltgX, h.los, h.ltg, h.poss],
    [vm.facts.ballX, vm.facts.ltgX, vm.facts.los, vm.facts.ltg, vm.facts.poss]);
  assert.equal(h.ariaLabel, vm.ariaLabel);
}

test("a caller drive at DAL 25: LOS 75, LTG 65 and the field-host label, word for word (#27)", () => {
  const vm = vmOf(state.drive(), tlOf(timeline.final()));
  agrees(vm);
  assert.equal(hookValues(vm.situation, FIELD).ariaLabel, "Ball on DAL 25. 1st & 10. Line to gain DAL 35.");
});

test("goal to go reports LTG 0 (#28), the opponent's ball and a kickoff agree with fieldVm", () => {
  agrees(vmOf(withSit({ down: 1, togo: 8, yardline_100: 8 })));
  agrees(vmOf(state.final(), tlOf(timeline.at104())));
  const body = timeline.final();
  const tl = tlOf(patch(body, { status: { ...body.status, state: "in", poss: "DAL", ball_x: 35, ball_kind: "kickoff",
    down_text: null, last_seq: 12 } }), 12);
  agrees(vmOf(state.final(), tl));
});

test("no situation: no numbers, and the off-field label once the game frame is known", () => {
  const h = hookValues(null, FIELD);
  assert.deepEqual(h, { ...NO_HOOKS, ariaLabel: "DAL off the field." });
  assert.equal(hookValues(null, null).ariaLabel, null, "before setGameFrame the engine leaves the label alone");
  assert.equal(hookValues({ ballX: Number.NaN, dir: 1, poss: "DAL" }, FIELD).los, null);
});

test("anim state: rebuilding beats playing beats reviewing beats idle (5.3)", () => {
  assert.equal(animStateOf({}), "idle");
  assert.equal(animStateOf({ reviewing: true }), "reviewing");
  assert.equal(animStateOf({ reviewing: true, playing: true }), "playing");
  assert.equal(animStateOf({ reviewing: true, playing: true, rebuilding: true }), "rebuilding");
});

test("ghost leaves in rank order, space separated in the hook", () => {
  const set = { shapes: [{ rank: 2, leaf: "pa_short" }, { rank: 1, leaf: "run_inside" }, { rank: 3, leaf: "dropback_short" }] };
  assert.deepEqual(ghostLeaves(set), ["run_inside", "pa_short", "dropback_short"]);
  assert.deepEqual(ghostLeaves(null), []);
  assert.deepEqual(ghostLeaves({ shapes: "x" }), []);
});

test("host attributes: every 5.3 hook the engine owns, absent values removed", () => {
  const vm = vmOf(state.drive(), tlOf(timeline.final()));
  const attrs = hostAttrs({ ready: true, animState: "idle", playingSeq: null, camera: "wide", frames: 12,
    ghosts: ["run_inside"], highlight: null, reviewSeq: null, hooks: hookValues(vm.situation, FIELD) });
  assert.deepEqual(attrs, {
    "data-scene": "webgl", "data-scene-ready": "true", "data-anim-state": "idle", "data-playing-seq": null,
    "data-camera": "wide", "data-frames": "12", "data-ghosts": "run_inside", "data-ghost-highlight": "",
    "data-review-seq": null, "data-ball-x": "25", "data-ltg-x": "35", "data-los": "75", "data-ltg": "65",
    "data-poss": "DAL", "aria-label": "Ball on DAL 25. 1st & 10. Line to gain DAL 35.",
  });
  const bare = hostAttrs({ ready: false, animState: "playing", playingSeq: 105, camera: null, frames: 0, ghosts: [],
    highlight: "pa_short", reviewSeq: 40, hooks: { ...NO_HOOKS, ariaLabel: null } });
  assert.equal(bare["data-scene-ready"], "false");
  assert.equal(bare["data-playing-seq"], "105");
  assert.equal(bare["data-review-seq"], "40");
  assert.equal(bare["data-los"], null);
  assert.equal(bare["data-poss"], "");
  assert.equal("aria-label" in bare, false, "no label to write: leave the host's own");
});

test("debugState: the 2.5 shape, numbers from renderer.info", () => {
  const rec = debugRecord({ ready: true, frames: 3, animState: "idle", playingSeq: null, ghosts: ["a"], highlight: null,
    camera: "wide", situation: null, info: { render: { calls: 41, triangles: 9000 }, memory: { geometries: 30, textures: 9 } },
    dpr: 2, extra: { tier: "high" } });
  assert.deepEqual(rec, { kind: "webgl", ready: true, frames: 3, animState: "idle", playingSeq: null, ghosts: ["a"],
    highlight: null, camera: "wide", situation: null, drawCalls: 41, triangles: 9000, geometries: 30, textures: 9,
    dpr: 2, tier: "high" });
  assert.equal(debugRecord({}).drawCalls, 0);
});
