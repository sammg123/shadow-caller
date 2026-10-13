// model/sides.js: who the app shadows, one play-caller or both sides (restructure-v2.md 11 decision 4), and each side's
// slice of the state, read the way the card and the Model Report read one caller. One side: the state is its own
// slice, so everything reads exactly as before. Real captures, plus both sides derived from them (both-sides.mjs).
import assert from "node:assert/strict";
import test from "node:test";
import { ballSide, bothSides, metricsOf, sideSlice, trackedSides } from "../../static/js/model/sides.js";
import { DAL_CALLER, TB_CALLER, bothState, bothTl, callsOf, nextCallOf, standInProfile } from "./both-sides.mjs";
import { isDeepFrozen, makePv, patch, readFixture, state, timeline, tlOf } from "./model-fixtures.mjs";

const CLOSE = 1e-12;

// ---------------------------------------------------------------- who is tracked
test("one side, as before: the game's offense and the profile's caller; nothing before the first state", () => {
  assert.deepEqual(trackedSides(state.final()).map((s) => ({ ...s })),
    [{ team: "DAL", caller: DAL_CALLER, last: "Schottenheimer", slug: null }]);
  assert.equal(bothSides(state.final()), false);
  assert.deepEqual([...trackedSides(null)], []);
  assert.deepEqual([...trackedSides(patch(state.final(), { game: { ...state.final().game, offense: "" } }))], []);
});

test("both sides from the server's `tracked`, in its order (away then home), with their last names", () => {
  const sides = trackedSides(bothState());
  assert.deepEqual(sides.map((s) => [s.team, s.caller, s.last, s.slug]),
    [["TB", TB_CALLER, "Robinson", "zac-robinson"], ["DAL", DAL_CALLER, "Schottenheimer", "brian-schottenheimer"]]);
  assert.equal(bothSides(bothState()), true);
  assert.ok(isDeepFrozen(sides));
});

test("one tracked entry is one side: the state reads as it always did", () => {
  const one = patch(state.final(), { tracked: [{ team: "DAL", caller: DAL_CALLER, slug: "brian-schottenheimer" }] });
  assert.equal(bothSides(one), false);
  assert.equal(sideSlice(one, "DAL"), one, "the same object: nothing is filtered or recomputed");
  assert.equal(trackedSides(one)[0].slug, "brian-schottenheimer");
});

test("a broken `tracked` keeps what it can: entries need a team, a team counts once", () => {
  const tracked = [null, { team: "" }, { team: "TB", caller: 7 }, { team: "TB", caller: TB_CALLER },
    { team: "DAL", caller: DAL_CALLER }, "DAL"];
  const sides = trackedSides(patch(state.final(), { tracked }));
  assert.deepEqual(sides.map((s) => [s.team, s.caller, s.last]), [["TB", "", ""], ["DAL", DAL_CALLER, "Schottenheimer"]]);
  assert.deepEqual(trackedSides(patch(state.final(), { tracked: "TB" })).map((s) => s.team), ["DAL"],
    "not a list: the one side the game names");
});

// ---------------------------------------------------------------- a side's slice
test("a side's slice: his calls only, newest first, his scorecard and profile from his tracked entry", () => {
  const metrics = { TB: { n: 70, granular: { leaf_n: 70, leaf_top1: 1, leaf_top3: 2 } } };
  const both = bothState({ metrics });
  const tb = sideSlice(both, "TB");
  assert.deepEqual(tb.log.map((r) => r.seq), callsOf(both, "TB").map((r) => r.seq));
  assert.ok(tb.log.every((r) => r.team === "TB" && r.caller === TB_CALLER));
  assert.equal(tb.metrics, both.tracked[0].metrics, "the server's own numbers when it sends them");
  assert.equal(tb.profile.caller, TB_CALLER);
  assert.deepEqual([tb.leaf_names, tb.game], [both.leaf_names, both.game], "the rest of the state as it is");
  assert.equal(sideSlice(both, "TB"), tb, "the same slice for the same state (one per render)");
});

test("without a scorecard on his entry, his numbers are live.py's metrics() over his own calls", () => {
  const both = bothState({ perSide: false });
  const tb = sideSlice(both, "TB");
  const calls = callsOf(both, "TB");
  const g = tb.metrics.granular;
  assert.deepEqual([tb.metrics.n, g.leaf_n, g.leaf_top1, g.leaf_top3],
    [calls.length, calls.length, calls.filter((r) => r.leaf_rank === 1).length,
      calls.filter((r) => r.leaf_rank <= 3).length]);
  assert.notEqual(g.leaf_top1, both.metrics.granular.leaf_top1, "never the top-level (one caller's) numbers");
  assert.deepEqual({ ...tb.profile }, { caller: TB_CALLER, team: "TB" },
    "no profile sent: his name only, so the plates still name him");
  const dal = sideSlice(both, "DAL");
  assert.equal(dal.profile, state.final().profile, "the top-level profile when it is his");
});

test("his in-game memory is his entry's when the server sends it (the engine's per-team memory), else the state's", () => {
  const shared = state.final().memory;
  const both = bothState();
  const tracked = both.tracked.map((t) => (t.team === "TB" ? { ...t, memory: { snap_n: 12, value_gap: 0.1, prev: 1 } }
    : t));
  const withMemory = patch(both, { tracked });
  assert.deepEqual({ ...sideSlice(withMemory, "TB").memory },
    { snap_n: 12, value_gap: 0.1, prev: 1, script_plays: shared.script_plays },
    "his own memory; the opening script's length (one number for every caller) from the state when his has none");
  assert.equal(sideSlice(withMemory, "DAL").memory, shared, "no memory sent for him: the state's");
  const own = patch(both, { tracked: tracked.map((t) => (t.team === "TB" ? { ...t, memory: { ...t.memory,
    script_plays: 9 } } : t)) });
  assert.equal(sideSlice(own, "TB").memory.script_plays, 9);
});

test("the prediction stays on its own side's slice only", () => {
  const both = bothState({ prediction: nextCallOf("TB", 31) });
  assert.equal(sideSlice(both, "TB").prediction.team, "TB");
  assert.equal(sideSlice(both, "DAL").prediction, null);
  assert.equal(sideSlice(both, "NYG"), both, "a side nobody tracks: the state as it is");
});

test("metricsOf is live.py's metrics() exactly: the server's scorecard on his 59 calls", () => {
  const s = state.final();
  const m = metricsOf(s.log);
  for (const key of ["n", "tilt_n", "tilt_hits"]) assert.equal(m[key], s.metrics[key], key);
  for (const key of ["logloss_model", "logloss_league", "brier_model", "brier_league", "acc_model", "acc_league",
    "dropback_rate"]) {
    assert.ok(Math.abs(m[key] - s.metrics[key]) < CLOSE, `${key}: ${m[key]} v ${s.metrics[key]}`);
  }
  for (const [key, value] of Object.entries(s.metrics.granular)) {
    assert.ok(Math.abs(m.granular[key] - value) < CLOSE, `granular.${key}: ${m.granular[key]} v ${value}`);
  }
  assert.deepEqual(Object.keys(m.granular).sort(), Object.keys(s.metrics.granular).sort());
  assert.ok(isDeepFrozen(m));
});

test("metricsOf: no calls is {n: 0}; a flag typed with no play is never scored; rows without grades count less", () => {
  assert.deepEqual({ ...metricsOf([]) }, { n: 0 });
  assert.deepEqual({ ...metricsOf(null) }, { n: 0 });
  const rows = state.final().log.slice(0, 3);
  const m = metricsOf([...rows, { kind: "penalty", p: 0.5, p_league: 0.5, dropback: 1, flag: "no edge" }]);
  assert.equal(m.n, 3);
  const bare = metricsOf([{ p: 0.6, p_league: 0.5, dropback: 1, flag: "TILT PASS" }]);
  assert.deepEqual([bare.n, bare.tilt_n, bare.tilt_hits, bare.granular.leaf_n, bare.granular.fam_n], [1, 1, 1, 0, 0]);
  assert.equal("leaf_top1" in bare.granular, false, "no specific-play grades, no specific-play numbers");
});

// ---------------------------------------------------------------- whose card it is
test("one side: the card reads the state as it is (no side)", () => {
  assert.equal(ballSide(makePv({ presented: state.final(), tl: tlOf(timeline.final()) })), null);
  assert.equal(ballSide(makePv()), null);
});

test("both sides: the card follows the offense with the ball, his call first, else ESPN's possession", () => {
  const pv = (presented, tl) => makePv({ presented, tl });
  assert.equal(ballSide(pv(bothState({ seq: 120, prediction: nextCallOf("TB", 31) }), bothTl(120, { poss: "DAL" })))
    .team, "TB", "his call is up: it is his card");
  assert.equal(ballSide(pv(bothState({ seq: 120 }), bothTl(120, { poss: "DAL" }))).caller, DAL_CALLER);
  assert.equal(ballSide(pv(bothState({ seq: 120 }), bothTl(120, { poss: "DAL", ball_kind: "kickoff" }))).team, "DAL",
    "kicking off after his score, it is still his card: his touchdown is his previous play");
});

test("both sides, nobody has the ball (the half, the final whistle): the last caller to call a play", () => {
  const presented = bothState({ seq: 120 });
  assert.equal(presented.log[0].team, "TB");
  assert.equal(ballSide(makePv({ presented, tl: bothTl(120, { poss: null, ball_kind: null }) })).team, "TB");
  assert.equal(ballSide(makePv({ presented: bothState(), tl: tlOf(timeline.final()) })).team,
    bothState().log[0].team);
  const kickoff = bothState({ seq: 0 });
  assert.equal(ballSide(makePv({ presented: kickoff, tl: bothTl(0, { poss: null }) })).team, "TB",
    "before anyone has called a play, and nothing says who receives: the first side named");
  assert.equal(ballSide(makePv({ presented: kickoff, tl: bothTl(0, { poss: "NYG" }) })).team, "TB",
    "a team nobody tracks never takes the card");
});

// The progress bar's real marks for TB at DAL (watch.marks): Dallas, the home team, receives the opening kickoff.
const MARKS = readFixture("state_tb_dal_both_watch_25.json").watch.marks;
const atKickoff = (marks = MARKS, n = 0) => patch(bothState({ seq: 0 }), {
  watch: { state: "paused", idx: n, total: 183, marks }, timeline: { n, epoch: "e-1", source: "espn", mode: "watch" } });

test("both sides at kickoff: the card is the receiving team's, not the away team's", () => {
  const pv = (presented, status = { poss: null, ball_kind: null }) => makePv({ presented, tl: bothTl(0, status) });
  const side = ballSide(pv(atKickoff()));
  assert.equal(side.team, "DAL", "Dallas receives: the next drive on the progress bar is Dallas's");
  assert.equal(side.caller, DAL_CALLER);
  const tbReceives = MARKS.map((m) => (m.kind === "drive" && m.idx === 0 ? { ...m, team: "TB" } : m));
  assert.equal(ballSide(pv(atKickoff(tbReceives))).team, "TB", "the away team when it receives");
  assert.equal(ballSide(pv(atKickoff(MARKS, 13))).team, "TB", "the next drive from where the game stands");
  assert.equal(ballSide(pv(atKickoff([]))).team, "TB", "no marks (live before kickoff): the first side named");
  const stray = [{ idx: 0, kind: "drive", team: "NYG", label: "NYG ball" }, null, { idx: "0", kind: "drive",
    team: "DAL" }];
  assert.equal(ballSide(pv(atKickoff(stray))).team, "TB", "a mark for a team nobody tracks, or a broken one, never");
  assert.equal(ballSide(pv(atKickoff(), { poss: "TB", ball_kind: "snap" })).team, "TB",
    "once someone has the ball, the ball decides");
  const prediction = nextCallOf("TB", 1);
  assert.equal(ballSide(pv(patch(atKickoff(), { prediction }))).team, "TB", "and a call that is up comes first");
});

test("a stand-in profile is his name on another model: the fixture says so", () => {
  assert.equal(standInProfile("TB").caller, TB_CALLER);
  assert.equal(standInProfile("TB").coefs, state.final().profile.coefs);
});
