// The video board's view model (restructure-v2.md section 3): one card that always shows PREVIOUS PLAY (his most
// recent call, its result and its verdict), NEXT CALL (the call, or who has the ball, or FINAL) and his LAST 6 with
// his night so far, in every game state. Real captures only (model-fixtures.mjs), plus two watched pre-snaps:
//   tests/fixtures/state_tb_dal_watch_126.json  /api/state from an offline sandbox, the saved TB at DAL watch paused
//     after 126 plays: his last call "Short pass left · +11" (Q3 2:52, top pick 19%), next call Inside run 21%
//   tests/fixtures/state_tb_dal_watch_151.json  paused after 151 plays: "Short pass left · +15" (Q4 8:04, a miss,
//     his #4 Intermediate at 10%), next call (snap 41) Short (0–9 air yds) 47%, then Intermediate 11%
import test from "node:test";
import assert from "node:assert/strict";
import { predictionVm, hotOf } from "../../static/js/model/vm-prediction.js";
import { makePv, state, timeline, tlOf, patch, isDeepFrozen, readFixture } from "./model-fixtures.mjs";

const watched = (n) => readFixture(`state_tb_dal_watch_${n}.json`);
const LOG = () => state.final().log;
const EMPTY_TL = { rows: [], drives: [], status: { state: "pre", poss: null, ball_kind: null }, box: null,
  unlinked: [], wpStart: null, teams: null, field: null, meta: null, source: "espn" };

/** The timeline drawn through `seq`, with ESPN's status as it stood (the capture's own status is the final one). */
function tlAt(seq, status = {}) {
  const body = timeline.final();
  return tlOf(patch(body, { status: { ...body.status, state: "in", poss: "DAL", ball_kind: "snap", ...status } }), seq);
}

/** A watched game paused after timeline row `seq`: the log up to his snap there, the given prediction or none. */
function asOf(seq, { status = {}, prediction = null } = {}) {
  const body = timeline.final();
  const logSeq = body.rows.filter((r) => r.seq <= seq && r.pred).map((r) => r.pred.log_seq).pop() ?? 0;
  const presented = patch(state.final(), { log: LOG().filter((r) => r.seq <= logSeq), prediction,
    drive_active: Boolean(prediction) });
  return makePv({ presented, tl: tlAt(seq, status), version: { watch: { state: "paused" } } });
}

const watchPv = (n, seq) => makePv({ presented: watched(n), tl: tlAt(seq), version: { watch: { state: "paused" } } });
const gradeOf = (r) => (r.leaf_rank === 1 ? "top1" : r.leaf_rank <= 3 ? "top3" : "miss");

test("nothing presented yet gives an empty board", () => {
  assert.equal(predictionVm(makePv()).kind, "empty");
  assert.equal(predictionVm(makePv({ presented: patch(state.final(), { game: undefined }) })).kind, "empty");
});

// ---------------------------------------------------------------- before his first snap: no previous play at all
test("at kickoff, before his first snap: no previous play and no last six, and the board says when his call comes",
  () => {
    const presented = patch(state.final(), { log: [], metrics: { n: 0 }, prediction: null, drive_active: false });
    const vm = predictionVm(makePv({ presented, tl: EMPTY_TL, version: { watch: { state: "paused" } } }));
    assert.equal(vm.kind, "offfield");
    assert.deepEqual([vm.previous, vm.recent], [null, null], "absent, not a placeholder");
    assert.deepEqual({ ...vm.next }, { kind: "offfield", plate: "Schottenheimer's next call", heading: "",
      body: "When DAL gets the ball, his next call appears here." });
    assert.equal(vm.spoken, "When DAL gets the ball, his next call appears here.");
  });

test("his first call is up before he has snapped: the call, still no previous play", () => {
  const vm = predictionVm(makePv({ presented: patch(state.drive(), { log: [], metrics: { n: 0 } }), tl: tlAt(1) }));
  assert.equal(vm.kind, "call");
  assert.deepEqual([vm.previous, vm.recent], [null, null]);
  assert.equal(vm.next.call.name, "Deep shot (20+)");
  assert.equal(vm.spoken, "Next call, snap 56: Deep shot (20+), 48 percent. Then Short (0–9 air yds), 25 percent.");
});

test("TB has the ball before his first snap: NEXT CALL reads so, nothing else shows", () => {
  const presented = patch(state.final(), { log: [], metrics: { n: 0 }, prediction: null, drive_active: false });
  const vm = predictionVm(makePv({ presented, tl: tlAt(1, { poss: "TB" }) }));
  assert.equal(vm.kind, "offfield");
  assert.deepEqual([vm.next.heading, vm.next.body], ["TB has the ball", ""]);
  assert.deepEqual([vm.previous, vm.recent], [null, null]);
});

// ---------------------------------------------------------------- after a top pick (Sam's first capture)
test("after a top pick: his previous call with its result and verdict, the next call, his last six (Sam, Q3 2:52)",
  () => {
    const s = watched(126);
    const vm = predictionVm(watchPv(126, 126));
    assert.equal(vm.kind, "call");
    const prev = vm.previous;
    assert.deepEqual([prev.plate, prev.snap.n, prev.snap.text, prev.seq], ["Previous play", 34, "Snap 34", 37]);
    assert.equal(prev.label, "Short pass left · +11");
    assert.deepEqual({ ...prev.verdict }, { key: "top1", rank: 1, text: "Top pick · 19%" });
    assert.equal(prev.predicted, null, "the top pick was his call, so the verdict says it all");
    assert.equal(prev.lead, null);
    assert.equal(prev.espn, s.log[0].feed_text);
    const next = vm.next;
    assert.equal(next.heading, "Schottenheimer's next call");
    assert.deepEqual({ ...next.snap }, { n: 35, text: "Snap 35" });
    assert.deepEqual([next.call.name, next.call.pct], ["Inside run (A/B gap)", "21%"]);
    assert.deepEqual(next.thenLine.items.map((t) => `${t.name} ${t.pct}`), ["PA short (0–9) 16%", "Short (0–9 air yds) 15%"]);
    assert.equal(next.flag.text, "Leans run");
    assert.equal(next.families.length, 5);
    assert.equal(vm.recent.plate, "Schottenheimer so far");
    assert.equal(vm.recent.label, "Last 6");
    assert.deepEqual(vm.recent.items.map((i) => [i.key, i.rank]),
      s.log.slice(0, 6).reverse().map((r) => [gradeOf(r), r.leaf_rank]));
    assert.deepEqual(vm.recent.tally.map((t) => `${t.label} ${t.value}`), ["Top pick 20 of 37", "In his top 3 30 of 37"]);
    assert.equal(vm.recent.note, "37 calls: 34 snaps and 3 wiped out by flags", "why snap 34 sits beside 37 calls");
  });

// ---------------------------------------------------------------- after a top-3 hit
test("after a top-3 hit: the verdict names his rank, the play and its odds, and what the board predicted", () => {
  const vm = predictionVm(asOf(128, { prediction: state.drive().prediction }));
  const prev = vm.previous;
  assert.equal(prev.label, "Short pass middle · incomplete");
  assert.deepEqual({ ...prev.verdict }, { key: "top3", rank: 2, text: "In his top 3 · #2 Short · 21%" });
  assert.deepEqual({ ...prev.predicted }, { label: "Predicted", leaf: "run_inside", name: "Inside run (A/B gap)",
    pct: "21%", family: "run" });
  assert.equal(vm.recent.items.at(-1).key, "top3", "the newest verdict sits at the right end");
  assert.equal(vm.recent.items.at(-1).rank, 2);
  assert.equal(vm.recent.items.at(-1).text, "In his top 3 (#2)");
});

// ---------------------------------------------------------------- after a miss (Sam's second capture)
test("after a miss: MISS with his rank, the play and its odds, then the next call (Sam, snap 41 after Q4 8:04)", () => {
  const vm = predictionVm(watchPv(151, 151));
  assert.equal(vm.kind, "call");
  const prev = vm.previous;
  assert.deepEqual([prev.snap.text, prev.label], ["Snap 40", "Short pass left · +15"]);
  assert.deepEqual({ ...prev.verdict }, { key: "miss", rank: 4, text: "Miss · #4 Intermediate · 10%" });
  assert.deepEqual({ ...prev.predicted }, { label: "Predicted", leaf: "dropback_short", name: "Short (0–9 air yds)",
    pct: "45%", family: "dropback" });
  assert.deepEqual({ ...vm.next.snap }, { n: 41, text: "Snap 41" });
  assert.deepEqual([vm.next.call.name, vm.next.call.pct], ["Short (0–9 air yds)", "47%"]);
  assert.deepEqual(vm.next.thenLine.items.map((t) => `${t.name} ${t.pct}`),
    ["Intermediate (10–19) 11%", "Inside run (A/B gap) 10%"]);
  assert.equal(vm.recent.items.at(-1).key, "miss");
  assert.equal(vm.spoken, "Previous play, snap 40: Short pass left, +15. Miss, #4 Intermediate, 10 percent. "
    + "Predicted Short (0–9 air yds), 45 percent. "
    + "Next call, snap 41: Short (0–9 air yds), 47 percent. Then Intermediate (10–19), 11 percent.");
});

// ---------------------------------------------------------------- the other team has the ball
test("TB has the ball: NEXT CALL reads so, his previous call and his last six stay up", () => {
  const presented = patch(state.final(), { log: LOG().filter((r) => r.seq <= 36), prediction: null,
    drive_active: false });
  const vm = predictionVm(makePv({ presented, tl: tlOf(timeline.at104()), version: { watch: { state: "paused" } } }));
  assert.equal(vm.kind, "offfield");
  assert.deepEqual({ ...vm.next }, { kind: "offfield", plate: "Schottenheimer's next call", heading: "TB has the ball",
    body: "" });
  assert.equal(vm.previous.label, "Pass intercepted · short middle");
  assert.deepEqual({ ...vm.previous.lead }, { kind: "int", text: "Intercepted" });
  assert.deepEqual({ ...vm.previous.verdict }, { key: "top1", rank: 1, text: "Top pick · 36%" });
  assert.equal(vm.recent.items.length, 6);
  assert.equal(vm.spoken, "Previous play, snap 33: Pass intercepted, short middle. Top pick, 36 percent. "
    + "TB has the ball.");
});

test("after his touchdown, while he kicks off: the previous play leads with it, NEXT CALL says who kicks", () => {
  const vm = predictionVm(asOf(161, { status: { poss: "DAL", ball_kind: "kickoff" } }));
  assert.equal(vm.kind, "offfield");
  assert.deepEqual([vm.next.heading, vm.next.body], ["DAL kicks off", ""]);
  assert.equal(vm.previous.label, "Deep pass left · TD");
  assert.deepEqual({ ...vm.previous.lead }, { kind: "td", text: "Touchdown" });
});

test("after TB scores, TB kicks off to him; at the half nobody has the ball and the board waits", () => {
  const kick = predictionVm(asOf(44, { status: { poss: "TB", ball_kind: "kickoff" } }));
  assert.deepEqual([kick.next.heading, kick.next.body], ["TB kicks off", ""]);
  const half = predictionVm(asOf(44, { status: { poss: null, ball_kind: null } }));
  assert.deepEqual([half.next.heading, half.next.body], ["", "When DAL gets the ball, his next call appears here."]);
  assert.equal(half.previous.label, "Deep pass left · incomplete", "his previous call stays up");
});

// ---------------------------------------------------------------- FINAL
test("at the final whistle NEXT CALL becomes FINAL: the score and the way to the Model Report, no league numbers",
  () => {
    const vm = predictionVm(makePv({ presented: state.final(), tl: tlOf(timeline.final()) }));
    assert.equal(vm.kind, "final");
    const next = vm.next;
    assert.deepEqual(Object.keys(next).sort(), ["kind", "link", "plate", "teams"],
      "Sam: no Shadow v League numbers on the GameCast (they live in the Model Report)");
    assert.equal(next.plate, "Final");
    assert.deepEqual(next.teams.map((t) => [t.abbr, t.score, t.caller]), [["TB", "24", false], ["DAL", "16", true]]);
    assert.deepEqual({ ...next.link }, { text: "Tonight's scorecard", href: "/report",
      title: "The full scorecard is in the Model Report" });
    assert.doesNotMatch(JSON.stringify(vm), /league/i);
    assert.deepEqual([vm.previous.snap.text, vm.previous.label, vm.previous.verdict.text],
      ["Snap 55", "Pass intercepted · short middle", "Top pick · 39%"]);
    assert.deepEqual(vm.recent.tally.map((t) => t.value), ["32 of 59", "47 of 59"]);
    assert.equal(vm.recent.note, "59 calls: 55 snaps and 4 wiped out by flags");
    assert.equal(vm.spoken, "Previous play, snap 55: Pass intercepted, short middle. Top pick, 39 percent. "
      + "Final. Buccaneers 24, Cowboys 16.");
  });

test("FINAL in every mode, never an instruction to type anything", () => {
  for (const version of [null, { watch: { state: "done" } }]) {
    const vm = predictionVm(makePv({ presented: state.final(), tl: tlOf(timeline.final()), version }));
    assert.equal(vm.kind, "final");
    assert.doesNotMatch(JSON.stringify(vm), /Ball on|click|type/i);
  }
  assert.equal(predictionVm(makePv({ presented: state.feedOn(), tl: tlOf(timeline.final()) })).kind, "final");
});

test("a prediction wins over the final whistle (a drive started after it is a call)", () => {
  assert.equal(predictionVm(makePv({ presented: state.drive(), tl: tlOf(timeline.final()) })).kind, "call");
});

test("FINAL before any logged snap shows the score and the link, and invents nothing", () => {
  const presented = patch(state.final(), { metrics: { n: 0 }, log: [] });
  const vm = predictionVm(makePv({ presented, tl: tlOf(timeline.final()) }));
  assert.deepEqual([vm.kind, vm.next.teams.length, vm.next.link.href], ["final", 2, "/report"]);
  assert.deepEqual([vm.previous, vm.recent], [null, null]);
});

// ---------------------------------------------------------------- the previous play's edges
test("a call a flag wiped out is still his previous call: no snap number, the field's words", () => {
  const vm = predictionVm(asOf(170));
  assert.deepEqual([vm.previous.seq, vm.previous.snap.text, vm.previous.label], [54, "", "No play · offensive holding on DAL"]);
  assert.deepEqual({ ...vm.previous.verdict }, { key: "miss", rank: 4, text: "Miss · #4 Deep shot · 10%" });
  assert.equal(vm.spoken.startsWith("Previous play: No play, offensive holding on DAL. Miss,"), true);
});

test("a log row the field has not drawn reads the log's own words", () => {
  const pv = asOf(104);
  const vm = predictionVm(makePv({ presented: pv.presented, tl: { ...pv.tl, rows: [] } }));
  assert.equal(vm.previous.label, "Short (0–9 air yds), turnover");
  assert.deepEqual({ ...vm.previous.lead }, { kind: "turnover", text: "Turnover" });
});

test("an old log row with no top pick or rank says only what it knows", () => {
  const presented = patch(state.final(), { log: [{ seq: 1, call: "P", yards: 3, td: false, turnover: false }] });
  const vm = predictionVm(makePv({ presented, tl: { rows: [] } }));
  const prev = vm.previous;
  assert.deepEqual([prev.label, prev.verdict.key, prev.verdict.text, prev.predicted, prev.lead, prev.snap.text],
    ["Pass", "none", "", null, null, ""]);
  assert.deepEqual(vm.recent.items, [], "no grade, no glyph");
  assert.equal(vm.spoken.startsWith("Previous play: Pass."), true);
});

// ---------------------------------------------------------------- his last six
test("his last six: graded calls only, oldest first, a top-3 hit carrying its rank", () => {
  const log = [{ seq: 99, call: "P", yards: 1 }, ...LOG()];
  const vm = predictionVm(makePv({ presented: patch(state.final(), { log }), tl: tlOf(timeline.final()) }));
  assert.equal(vm.recent.items.length, 6, "an ungraded row never costs a glyph");
  assert.deepEqual(vm.recent.items.map((i) => i.key), LOG().slice(0, 6).reverse().map(gradeOf));
  for (const item of vm.recent.items) {
    assert.equal(item.text, { top1: "Top pick", top3: `In his top 3 (#${item.rank})`, miss: "Miss" }[item.key]);
  }
  assert.match(vm.recent.aria, /^Last 6: (Top pick|In his top 3 \(#[23]\)|Miss)(, (Top pick|In his top 3 \(#[23]\)|Miss)){5}$/);
});

test("on his first drive the last six holds as many calls as he has made", () => {
  const pv = asOf(4);
  assert.equal(pv.presented.log.length, 3);
  assert.equal(predictionVm(pv).recent.items.length, 3);
});

test("his calls and his snap numbers agree, or the board says why: a call a flag wiped out has no snap number", () => {
  const counted = (seq) => {
    const pv = asOf(seq);
    const graded = pv.presented.log.filter((r) => Number.isInteger(r.leaf_rank));
    const presented = patch(pv.presented, { metrics: { ...pv.presented.metrics,
      granular: { ...pv.presented.metrics.granular, leaf_n: graded.length,
        leaf_top1: graded.filter((r) => r.leaf_rank === 1).length,
        leaf_top3: graded.filter((r) => r.leaf_rank <= 3).length } } });
    return predictionVm(makePv({ presented, tl: pv.tl, version: pv.version }));
  };
  const clean = counted(7);
  assert.equal(clean.previous.snap.text, `Snap ${clean.previous.seq}`, "no flag yet: his snap is his call count");
  assert.equal(clean.recent.note, "", "nothing to explain");
  const one = counted(9);
  assert.equal(one.previous.snap.n, one.previous.seq - 1);
  assert.equal(one.recent.note, `${one.previous.seq} calls: ${one.previous.seq - 1} snaps and 1 wiped out by a flag`);
  assert.equal(predictionVm(watchPv(151, 151)).recent.note, "43 calls: 40 snaps and 3 wiped out by flags");
});

// ---------------------------------------------------------------- the next call itself (FI 3.5), as before
test("the call: top pick, then-line and snap number from the drive state", () => {
  const { next } = predictionVm(makePv({ presented: state.drive() }));
  assert.equal(next.kind, "call");
  assert.equal(next.heading, "Schottenheimer's next call");
  assert.deepEqual(next.top.map((t) => [t.leaf, t.name, t.pct]), [
    ["dropback_deep", "Deep shot (20+)", "48%"],
    ["dropback_short", "Short (0–9 air yds)", "25%"],
    ["dropback_mid", "Intermediate (10–19)", "14%"],
  ]);
  assert.deepEqual({ ...next.call }, { ...next.top[0] });
  assert.equal(next.thenLine.lead, "Then");
  assert.deepEqual(next.thenLine.items.map((t) => `${t.name} ${t.pct}`),
    ["Short (0–9 air yds) 25%", "Intermediate (10–19) 14%"]);
  assert.deepEqual({ ...next.snap }, { n: 56, text: "Snap 56" });
});

test("pass/run split with the league mark (FI 3.5, #31)", () => {
  const { split } = predictionVm(makePv({ presented: state.drive() })).next;
  assert.deepEqual([...split.labels], ["Ball thrown or dropback 94%", "League 94% (dashed)", "Handed off or kept 6%"]);
  assert.ok(Math.abs(split.pass - 93.9287) < 1e-3);
  assert.ok(Math.abs(split.league - 94.2506) < 1e-3);
  assert.equal(split.leagueTitle, "League 94%");
  assert.equal(split.ariaLabel, "Pass versus run");
});

// v1.5 (G4-6): the tag's words say what the flag measures (his tendency here against the league's)
test("tilt tag: TILT PASS reads Tilts pass, lean Leans run, no edge Like the league (#30, G4-6)", () => {
  const flagOf = (presented) => predictionVm(makePv({ presented })).next.flag;
  assert.deepEqual({ ...flagOf(state.tilt()) }, { text: "Tilts pass", cls: "tiltpass", kind: "tilt", side: "pass",
    title: "Pass vs run against the league" });
  const noEdge = flagOf(state.drive());
  assert.deepEqual([noEdge.text, noEdge.cls, noEdge.kind, noEdge.side], ["Like the league", "noedge", "none", null]);
  const withFlag = (flag) => flagOf(patch(state.drive(), { prediction: { ...state.drive().prediction, flag } }));
  const lean = withFlag("lean run");
  assert.deepEqual([lean.text, lean.cls, lean.kind, lean.side], ["Leans run", "leanrun", "lean", "run"]);
  assert.equal(withFlag("TILT RUN").text, "Tilts run");
  assert.equal(withFlag("lean pass").text, "Leans pass");
});

test("five families in server order with league values and their leaves (#32, #33)", () => {
  const { families } = predictionVm(makePv({ presented: state.drive() })).next;
  assert.deepEqual(families.map((f) => [f.key, f.name, f.pct, f.leagueText]), [
    ["dropback", "Dropback pass", "86%", "League 87%"],
    ["run", "Run", "8%", "League 7%"],
    ["screen", "Screen", "5%", "League 5%"],
    ["rpo", "RPO", "1%", "League 1%"],
    ["pa", "Play-action", "1%", "League 1%"],
  ]);
  assert.deepEqual(families[1].leaves.map((l) => l.pct1), ["4.9%", "0.9%", "0.7%", "0.6%", "0.5%"]);
  assert.equal(families[0].leaves[0].barPct, 100);
  assert.ok(Math.abs(families[1].leaves[0].barPct - 10.3914) < 1e-3);
  assert.equal(families.flatMap((f) => f.leaves).length, 14);
});

test("hot arrows follow the server flags, with titles (#34)", () => {
  const p = state.drive().prediction;
  const families = p.families.map((f, i) => (i === 0
    ? { ...f, hot: "up", leaves: f.leaves.map((l, j) => (j === 2 ? { ...l, hot: "down" } : l)) } : f));
  const { next } = predictionVm(makePv({ presented: patch(state.drive(), { prediction: { ...p, families } }) }));
  assert.deepEqual([next.families[0].hot, next.families[0].hotGlyph, next.families[0].hotTitle],
    ["up", "▲", "Well above the league"]);
  const leaf = next.families[0].leaves[2];
  assert.deepEqual([leaf.hot, leaf.hotGlyph, leaf.hotTitle], ["down", "▼", "Well below the league"]);
  assert.deepEqual([next.families[1].hot, next.families[1].hotGlyph, next.families[1].hotTitle], ["", "", ""]);
  assert.equal(next.legend.startsWith("▲ ▼ = at least 4 points"), true);
});

test("hotOf is the server rule: 4+ points and 1.3x the other side", () => {
  assert.equal(hotOf(0.30, 0.20), "up");
  assert.equal(hotOf(0.25, 0.20), "");
  assert.equal(hotOf(0.10, 0.15), "down");
  assert.equal(hotOf(0.02, 0.05), "");
  assert.equal(hotOf(null, 0.05), "");
});

test("a hot value the server never sends is ignored; leaves without one get the server's rule", () => {
  const p = state.drive().prediction;
  const odd = p.families.map((f) => ({ ...f, hot: "sideways" }));
  assert.equal(predictionVm(makePv({ presented: patch(state.drive(), { prediction: { ...p, families: odd } }) }))
    .next.families[0].hot, "");
  const bare = p.families.map((f) => ({ ...f, hot: undefined,
    leaves: f.leaves.map((l) => ({ ...l, hot: undefined, p: 0.3, p_league: 0.2 })) }));
  assert.equal(predictionVm(makePv({ presented: patch(state.drive(), { prediction: { ...p, families: bare } }) }))
    .next.families[0].leaves[0].hot, "up");
});

test("why lines past the script: habits, then one line per memory term, one decimal (G23)", () => {
  const { next } = predictionVm(makePv({ presented: state.drive() }));
  assert.deepEqual(next.why.map((w) => ({ ...w })), [
    { kind: "habits", pts: "-0.1", sign: "down", text: "pass pts from his habits here" },
    { kind: "memory", pts: "-0.2", sign: "down", text: "Value gap (what's been working)" },
  ]);
  assert.deepEqual({ ...next.script }, { on: false, text: "" });
});

test("why lines in the opening script (#35, #36)", () => {
  const { next } = predictionVm(makePv({ presented: state.tilt() }));
  assert.deepEqual(next.why.map((w) => ({ ...w })), [
    { kind: "habits", pts: "+16.5", sign: "up", text: "pass pts from his habits here" },
    { kind: "script", pts: "—", sign: "none", text: "Opening script: memory switches on after snap 15" },
  ]);
  assert.deepEqual({ ...next.script }, { on: true, text: "Opening script: memory switches on after snap 15" });
});

test("memory points always carry one decimal (G23)", () => {
  const p = state.drive().prediction;
  const memory_parts = [{ term: "Repeat last call (stickiness)", pts: 10 }, { term: "After a failed play", pts: 1 }];
  const { next } = predictionVm(makePv({ presented: patch(state.drive(), { prediction: { ...p, memory_parts } }) }));
  assert.deepEqual(next.why.slice(1).map((w) => [w.pts, w.sign]), [["+10.0", "up"], ["+1.0", "up"]]);
});

test("the hovered play is marked; plays are shown, never picked (no user input into the game)", () => {
  const leafOf = (vm, key) => vm.next.families.flatMap((f) => f.leaves).find((l) => l.key === key);
  const hovered = predictionVm(makePv({ presented: state.drive(), view: { hoverLeaf: "dropback_deep" } }));
  assert.equal(leafOf(hovered, "dropback_deep").highlighted, true);
  assert.equal(leafOf(hovered, "dropback_mid").highlighted, false);
  assert.equal(hovered.next.leafTitle, "Shows this play's shadow on the field");
  assert.doesNotMatch(hovered.next.legend, /click|pick it/i);
  assert.equal("picked" in leafOf(hovered, "dropback_deep"), false);
});

test("the view model is deep-frozen and leaves its input alone", () => {
  for (const pv of [makePv({ presented: state.drive() }), watchPv(151, 151), asOf(104),
    makePv({ presented: state.final(), tl: tlOf(timeline.final()) })]) {
    const vm = predictionVm(pv);
    assert.ok(isDeepFrozen(vm));
    assert.ok(isDeepFrozen(pv));
  }
});

test("a thin prediction still renders: dashes, no families, no call", () => {
  const p = state.drive().prediction;
  const thin = { flag: "mystery", p: null, p_league: undefined, p_habits: 0.5, memory_parts: [], script: true,
    snap_next: null, top: [], families: undefined };
  const { next } = predictionVm(makePv({ presented: patch(state.drive(), { prediction: thin, memory: {} }) }));
  assert.deepEqual([...next.split.labels], ["Ball thrown or dropback —", "League — (dashed)", "Handed off or kept —"]);
  assert.deepEqual([next.split.pass, next.split.league, next.call, next.families.length, next.snap.text], [0, 0, null, 0, ""]);
  assert.deepEqual([next.flag.text, next.flag.cls, next.flag.kind], ["Mystery", "", "none"], "a flag the server never "
    + "sends keeps its own words");
  assert.equal(next.script.text, "Opening script: memory switches on after the opening snaps");
  assert.equal(p.top.length, 3);
});

// ---------------------------------------------------------------- v1.5 (G4-2, G4-4): the plates and the spoken call
test("the plates name the caller it shadows, from the profile; a long name falls back to the plain words (G4-2)", () => {
  const named = (caller) => predictionVm(makePv({ presented: patch(state.drive(),
    { profile: { ...state.drive().profile, caller } }) }));
  assert.equal(named("Matt Nagy").next.heading, "Nagy's next call");
  assert.equal(named("Matt Nagy").recent.plate, "Nagy so far");
  assert.equal(named("Somebody Withaverylongsurname").next.heading, "Next call");
  assert.equal(named("Somebody Withaverylongsurname").recent.plate, "So far");
  assert.equal(named("").next.heading, "Next call");
});

function fourthDown() {
  const drive = state.drive();
  return patch(drive, { sit: { ...drive.sit, down: 4, togo: 10, yardline_100: 56 } });
}

test("on 4th down the plate says the call is the play if he goes for it (G4-4)", () => {
  const vm = predictionVm(makePv({ presented: fourthDown() }));
  assert.equal(vm.next.heading, "4th down · if he goes for it");
  assert.deepEqual({ ...vm.next.fourth }, { on: true,
    title: "On 4th down this is the play he'd call if he goes for it. The model has no punt or field-goal class, so "
      + "it can't say whether he kicks." });
  assert.deepEqual({ ...vm.next.snap }, { n: 56, text: "Snap 56" }, "the snap number stays on the plate");
  assert.match(vm.spoken, /Fourth down, if he goes for it\. Next call, snap 56: /);
  const third = predictionVm(makePv({ presented: state.drive() }));
  assert.deepEqual([third.next.fourth.on, third.next.fourth.title], [false, ""]);
});

test("the spoken board: his previous call, then the next one, in words, the field's dots read as pauses (G4-2)", () => {
  const vm = predictionVm(watchPv(126, 126));
  assert.equal(vm.spoken, "Previous play, snap 34: Short pass left, +11. Top pick, 19 percent. "
    + "Next call, snap 35: Inside run (A/B gap), 21 percent. Then PA short (0–9), 16 percent.");
  assert.doesNotMatch(vm.spoken, / · /);
});
