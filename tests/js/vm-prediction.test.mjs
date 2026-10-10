import test from "node:test";
import assert from "node:assert/strict";
import { predictionVm, hotOf } from "../../static/js/model/vm-prediction.js";
import { makePv, state, timeline, tlOf, patch, isDeepFrozen } from "./model-fixtures.mjs";

const textOf = (segments) => segments.map((s) => s.text).join("");
const strongOf = (segments) => segments.filter((s) => s.strong).map((s) => s.text);

test("nothing presented yet gives an empty panel", () => {
  assert.equal(predictionVm(makePv()).kind, "empty");
});

test("off the field in manual mode keeps the FI 3.5 copy, with the strong parts marked", () => {
  const vm = predictionVm(makePv({ presented: state.final() }));
  assert.equal(vm.kind, "offfield");
  assert.equal(vm.heading, "DAL is off the field");
  assert.equal(textOf(vm.body),
    "When DAL gets the ball, click Ball on above and type the spot, like D 25. The drive starts and predictions come back. Update the score and clock the same way.");
  assert.deepEqual(strongOf(vm.body), ["Ball on", "D 25"]);
});

test("off the field with the feed on, before his first snap, says the feed starts the drive (G24)", () => {
  const vm = predictionVm(makePv({ presented: patch(state.feedOn(), { log: [] }) }));
  assert.equal(vm.kind, "offfield");
  assert.equal(textOf(vm.body), "When DAL gets the ball, the ESPN feed starts the drive and the next call appears here.");
});

test("off the field during a watch, before his first snap, says the next call appears (G24)", () => {
  const vm = predictionVm(makePv({ presented: patch(state.final(), { log: [] }), version: { watch: { state: "paused" } } }));
  assert.equal(vm.kind, "offfield");
  assert.equal(textOf(vm.body), "When DAL gets the ball in this game, the next call appears here.");
});

test("the spot example uses the shortest prefix that names only the offense", () => {
  const off = (offense, opponent) => {
    const presented = patch(state.final(), { game: { ...state.final().game, offense, opponent } });
    return strongOf(predictionVm(makePv({ presented })).body)[1];
  };
  assert.equal(off("KC", "LV"), "K 25");
  assert.equal(off("NE", "NO"), "NE 25");
  assert.equal(off("NYJ", "NYG"), "NYJ 25");
});

test("the call: top pick, then-line and snap number from the drive state", () => {
  const vm = predictionVm(makePv({ presented: state.drive() }));
  assert.equal(vm.kind, "call");
  assert.equal(vm.heading, "Schottenheimer's next call");
  assert.deepEqual(vm.top.map((t) => [t.leaf, t.name, t.pct]), [
    ["dropback_deep", "Deep shot (20+)", "48%"],
    ["dropback_short", "Short (0–9 air yds)", "25%"],
    ["dropback_mid", "Intermediate (10–19)", "14%"],
  ]);
  assert.deepEqual({ ...vm.call }, { ...vm.top[0] });
  assert.equal(vm.thenLine.lead, "Then");
  assert.deepEqual(vm.thenLine.items.map((t) => `${t.name} ${t.pct}`),
    ["Short (0–9 air yds) 25%", "Intermediate (10–19) 14%"]);
  assert.deepEqual({ ...vm.snap }, { n: 56, text: "Snap 56" });
});

test("pass/run split with the league mark (FI 3.5, #31)", () => {
  const { split } = predictionVm(makePv({ presented: state.drive() }));
  assert.deepEqual([...split.labels], ["Ball thrown or dropback 94%", "League 94% (dashed)", "Handed off or kept 6%"]);
  assert.ok(Math.abs(split.pass - 93.9287) < 1e-3);
  assert.ok(Math.abs(split.league - 94.2506) < 1e-3);
  assert.equal(split.leagueTitle, "League 94%");
  assert.equal(split.ariaLabel, "Pass versus run");
});

// v1.5 (G4-6): the tag's words say what the flag measures (his tendency here against the league's), so "no edge"
// never reads as "this model has no edge"; the classes keep the three looks apart (#30)
test("tilt tag: TILT PASS reads Tilts pass, lean Leans run, no edge Like the league (#30, G4-6)", () => {
  const { flag } = predictionVm(makePv({ presented: state.tilt() }));
  assert.deepEqual({ ...flag }, { text: "Tilts pass", cls: "tiltpass", kind: "tilt", side: "pass",
    title: "Pass vs run against the league" });
  const noEdge = predictionVm(makePv({ presented: state.drive() })).flag;
  assert.deepEqual([noEdge.text, noEdge.cls, noEdge.kind, noEdge.side], ["Like the league", "noedge", "none", null]);
  const lean = patch(state.drive(), { prediction: { ...state.drive().prediction, flag: "lean run" } });
  const leanFlag = predictionVm(makePv({ presented: lean })).flag;
  assert.deepEqual([leanFlag.text, leanFlag.cls, leanFlag.kind, leanFlag.side], ["Leans run", "leanrun", "lean", "run"]);
  const tiltRun = patch(state.drive(), { prediction: { ...state.drive().prediction, flag: "TILT RUN" } });
  assert.equal(predictionVm(makePv({ presented: tiltRun })).flag.text, "Tilts run");
  const leanPass = patch(state.drive(), { prediction: { ...state.drive().prediction, flag: "lean pass" } });
  assert.equal(predictionVm(makePv({ presented: leanPass })).flag.text, "Leans pass");
});

test("five families in server order with league values and their leaves (#32, #33)", () => {
  const { families } = predictionVm(makePv({ presented: state.drive() }));
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
  const presented = patch(state.drive(), { prediction: { ...p, families } });
  const vm = predictionVm(makePv({ presented }));
  assert.deepEqual([vm.families[0].hot, vm.families[0].hotGlyph, vm.families[0].hotTitle], ["up", "▲", "Well above the league"]);
  const leaf = vm.families[0].leaves[2];
  assert.deepEqual([leaf.hot, leaf.hotGlyph, leaf.hotTitle], ["down", "▼", "Well below the league"]);
  assert.deepEqual([vm.families[1].hot, vm.families[1].hotGlyph, vm.families[1].hotTitle], ["", "", ""]);
  assert.equal(vm.legend.startsWith("▲ ▼ = at least 4 points"), true);
});

test("hotOf is the server rule: 4+ points and 1.3x the other side", () => {
  assert.equal(hotOf(0.30, 0.20), "up");
  assert.equal(hotOf(0.25, 0.20), "");
  assert.equal(hotOf(0.10, 0.15), "down");
  assert.equal(hotOf(0.02, 0.05), "");
  assert.equal(hotOf(null, 0.05), "");
});

test("a hot value the server never sends is ignored", () => {
  const p = state.drive().prediction;
  const families = p.families.map((f) => ({ ...f, hot: "sideways" }));
  const vm = predictionVm(makePv({ presented: patch(state.drive(), { prediction: { ...p, families } }) }));
  assert.equal(vm.families[0].hot, "");
});

test("why lines past the script: habits, then one line per memory term, one decimal (G23)", () => {
  const vm = predictionVm(makePv({ presented: state.drive() }));
  assert.deepEqual(vm.why.map((w) => ({ ...w })), [
    { kind: "habits", pts: "-0.1", sign: "down", text: "pass pts from his habits here" },
    { kind: "memory", pts: "-0.2", sign: "down", text: "Value gap (what's been working)" },
  ]);
  assert.deepEqual({ ...vm.script }, { on: false, text: "" });
});

test("why lines in the opening script (#35, #36)", () => {
  const vm = predictionVm(makePv({ presented: state.tilt() }));
  assert.deepEqual(vm.why.map((w) => ({ ...w })), [
    { kind: "habits", pts: "+16.5", sign: "up", text: "pass pts from his habits here" },
    { kind: "script", pts: "—", sign: "none", text: "Opening script: memory switches on after snap 15" },
  ]);
  assert.deepEqual({ ...vm.script }, { on: true, text: "Opening script: memory switches on after snap 15" });
});

test("memory points always carry one decimal (G23)", () => {
  const p = state.drive().prediction;
  const memory_parts = [{ term: "Repeat last call (stickiness)", pts: 10 }, { term: "After a failed play", pts: 1 }];
  const vm = predictionVm(makePv({ presented: patch(state.drive(), { prediction: { ...p, memory_parts } }) }));
  assert.deepEqual(vm.why.slice(1).map((w) => [w.pts, w.sign]), [["+10.0", "up"], ["+1.0", "up"]]);
});

test("the picked play and the hovered play are marked", () => {
  const leafOf = (vm, key) => vm.families.flatMap((f) => f.leaves).find((l) => l.key === key);
  const picked = predictionVm(makePv({ presented: state.drive(), view: { pick: { k: "J", i: 1, out: null } } }));
  assert.equal(leafOf(picked, "run_edge_left").picked, true);
  assert.equal(picked.families.flatMap((f) => f.leaves).filter((l) => l.picked).length, 1);
  const wrapped = predictionVm(makePv({ presented: state.drive(), view: { pick: { k: "P", i: 3, out: null } } }));
  assert.equal(leafOf(wrapped, "dropback_short").picked, true);
  const hovered = predictionVm(makePv({ presented: state.drive(), view: { hoverLeaf: "dropback_deep" } }));
  assert.equal(leafOf(hovered, "dropback_deep").highlighted, true);
  assert.equal(leafOf(hovered, "dropback_mid").highlighted, false);
  assert.equal(hovered.leafTitle, "Click to log this as the play he called");
});

test("the view model is deep-frozen and leaves its input alone", () => {
  const pv = makePv({ presented: state.drive() });
  const vm = predictionVm(pv);
  assert.ok(isDeepFrozen(vm));
  assert.ok(isDeepFrozen(pv));
});

test("an offense whose abbreviation starts the opponent's uses the whole abbreviation", () => {
  const presented = patch(state.final(), { game: { ...state.final().game, offense: "NY", opponent: "NYG" } });
  assert.equal(strongOf(predictionVm(makePv({ presented })).body)[1], "NY 25");
});

test("a thin prediction still renders: dashes, no families, no call", () => {
  const p = state.drive().prediction;
  const thin = { flag: "mystery", p: null, p_league: undefined, p_habits: 0.5, memory_parts: [], script: true,
    snap_next: null, top: [], families: undefined };
  const vm = predictionVm(makePv({ presented: patch(state.drive(), { prediction: thin, memory: {} }) }));
  assert.deepEqual([...vm.split.labels], ["Ball thrown or dropback —", "League — (dashed)", "Handed off or kept —"]);
  assert.deepEqual([vm.split.pass, vm.split.league, vm.call, vm.families.length, vm.snap.text], [0, 0, null, 0, ""]);
  assert.deepEqual([vm.flag.text, vm.flag.cls, vm.flag.kind], ["Mystery", "", "none"], "a flag the server never sends "
    + "keeps its own words");
  assert.equal(vm.script.text, "Opening script: memory switches on after the opening snaps");
  assert.equal(p.top.length, 3);
});

test("leaves without a hot flag get one from the server's rule", () => {
  const p = state.drive().prediction;
  const families = p.families.map((f) => ({ ...f, hot: undefined,
    leaves: f.leaves.map((l) => ({ ...l, hot: undefined, p: 0.3, p_league: 0.2 })) }));
  const vm = predictionVm(makePv({ presented: patch(state.drive(), { prediction: { ...p, families } }) }));
  assert.equal(vm.families[0].leaves[0].hot, "up");
});

// ---------------------------------------------------------------- v1.5 (G4-2, G4-4): the plate and the spoken call
test("the plate names the caller it shadows, from the profile; a long name falls back to Next call (G4-2)", () => {
  const vm = predictionVm(makePv({ presented: state.drive() }));
  assert.equal(vm.heading, "Schottenheimer's next call");
  const named = (caller) => predictionVm(makePv({ presented: patch(state.drive(),
    { profile: { ...state.drive().profile, caller } }) })).heading;
  assert.equal(named("Matt Nagy"), "Nagy's next call");
  assert.equal(named("Somebody Withaverylongsurname"), "Next call");
  assert.equal(named(""), "Next call");
});

test("the spoken call: snap, the call and its percent, then the next one, in words (G4-2)", () => {
  const vm = predictionVm(makePv({ presented: state.drive() }));
  assert.equal(vm.spoken, "Next call, snap 56: Deep shot (20+), 48 percent. Then Short (0–9 air yds), 25 percent.");
});

function fourthDown() {
  const drive = state.drive();
  return patch(drive, { sit: { ...drive.sit, down: 4, togo: 10, yardline_100: 56 } });
}

test("on 4th down the plate says the call is the play if he goes for it (G4-4)", () => {
  const vm = predictionVm(makePv({ presented: fourthDown() }));
  assert.equal(vm.heading, "4th down · if he goes for it");
  assert.deepEqual({ ...vm.fourth }, { on: true,
    title: "On 4th down this is the play he'd call if he goes for it. The model has no punt or field-goal class, so "
      + "it can't say whether he kicks." });
  assert.deepEqual({ ...vm.snap }, { n: 56, text: "Snap 56" }, "the snap number stays on the plate");
  assert.match(vm.spoken, /^Fourth down, if he goes for it\. Next call, snap 56: /);
  const third = predictionVm(makePv({ presented: state.drive() }));
  assert.deepEqual([third.fourth.on, third.fourth.title], [false, ""]);
});

// ---------------------------------------------------------------- v1.5 (G4-1): off the field, his night so far
const LOG = () => state.final().log;
/** The game as it stood after timeline row `seq` was drawn: the log up to its snap, the rows up to it. */
function asOf(seq, { status = "in", mode = "watch" } = {}) {
  const body = timeline.final();
  const logSeq = body.rows.filter((r) => r.seq <= seq && r.pred).map((r) => r.pred.log_seq).pop() ?? 0;
  const presented = patch(state.final(), { log: LOG().filter((r) => r.seq <= logSeq),
    feed: { ...state.final().feed, on: mode === "feed" } });
  const tl = tlOf(patch(body, { status: { ...body.status, state: status } }), seq);
  return makePv({ presented, tl, version: mode === "watch" ? { watch: { state: "paused" } } : null });
}

test("after the interception the board recaps his call, what happened, the verdict and his night (G4-1)", () => {
  const vm = predictionVm(asOf(104));
  assert.equal(vm.kind, "recap");
  assert.equal(vm.plate, "Schottenheimer so far");
  assert.deepEqual({ ...vm.lead }, { kind: "int", text: "Intercepted" });
  assert.deepEqual({ ...vm.call }, { leaf: "dropback_short", name: "Short (0–9 air yds)", pct: "36%",
    family: "dropback" });
  assert.equal(vm.predictedLabel, "Predicted");
  assert.equal(vm.happened, "Pass intercepted · short middle");
  assert.deepEqual({ ...vm.verdict }, { key: "top1", text: "Top pick" });
  assert.deepEqual(vm.tally.map((t) => ({ ...t })), [{ id: "top1", label: "Top pick", value: "32 of 59" },
    { id: "top3", label: "In his top 3", value: "47 of 59" }]);
  assert.equal(vm.recent.label, "Last 6");
  assert.deepEqual(vm.recent.items.map((i) => i.key), LOG().filter((r) => r.seq <= 36).slice(0, 6).reverse()
    .map((r) => (r.leaf_rank === 1 ? "top1" : r.leaf_rank <= 3 ? "top3" : "miss")));
  assert.equal(vm.recent.items.length, 6);
  assert.equal(vm.heading, "DAL is off the field", "the off-field line stays on the face");
  assert.equal(vm.spoken, "Schottenheimer so far. Predicted Short (0–9 air yds), 36 percent. "
    + "Pass intercepted, short middle. Top pick.");
});

test("after his touchdown the recap leads with it (G4-1)", () => {
  const vm = predictionVm(asOf(161));
  assert.equal(vm.kind, "recap");
  assert.deepEqual({ ...vm.lead }, { kind: "td", text: "Touchdown" });
  assert.equal(vm.happened, "Deep pass left · TD");
});

test("after a punt the recap has no lead, and an in-top-3 verdict reads so (G4-1)", () => {
  const vm = predictionVm(asOf(44));
  assert.equal(vm.lead, null);
  assert.equal(vm.happened, "Deep pass left · incomplete");
  assert.deepEqual({ ...vm.verdict }, { key: "top3", text: "In his top 3" });
  assert.deepEqual([vm.call.name, vm.call.pct], ["Short (0–9 air yds)", "47%"]);
});

test("the feed recaps too; the first drive shows as many verdicts as there were snaps (G4-1)", () => {
  const vm = predictionVm(asOf(14, { mode: "feed" }));
  assert.equal(vm.kind, "recap");
  assert.ok(vm.recent.items.length > 0 && vm.recent.items.length <= 6);
});

test("typing by hand, off the field mid-game, the manual copy stays (G4-1)", () => {
  const vm = predictionVm(asOf(104, { mode: "manual" }));
  assert.equal(vm.kind, "offfield");
  assert.match(textOf(vm.body), /^When DAL gets the ball, click Ball on above/);
});

test("a log row the timeline has not drawn reads the log's own words (G4-1)", () => {
  const pv = asOf(104);
  const vm = predictionVm(makePv({ presented: pv.presented, tl: { ...pv.tl, rows: [] },
    version: { watch: { state: "paused" } } }));
  assert.equal(vm.kind, "recap");
  assert.equal(vm.happened, "Short (0–9 air yds), turnover");
  assert.deepEqual({ ...vm.lead }, { kind: "turnover", text: "Turnover" });
});

// ---------------------------------------------------------------- v1.5 (G4-1): FINAL
test("at the final whistle the board shows FINAL, the score and SHADOW v LEAGUE's three lines (G4-1)", () => {
  const vm = predictionVm(makePv({ presented: state.final(), tl: tlOf(timeline.final()) }));
  assert.equal(vm.kind, "final");
  assert.equal(vm.plate, "Final");
  assert.deepEqual(vm.teams.map((t) => [t.abbr, t.score, t.caller]), [["TB", "24", false], ["DAL", "16", true]]);
  assert.deepEqual(vm.lines.map((l) => [l.id, l.label, l.shadow, l.league, l.leader]), [
    ["called_right", "Run/pass right", "85%", "81%", "shadow"],
    ["top3", "Play in top 3", "47", "48", "league"],
    ["passrun_logloss", "Pass vs run log loss", ".421", ".424", "shadow"],
  ]);
  assert.deepEqual({ ...vm.key }, { cap: "G", name: "Tonight's scorecard", title: "Full scorecard (G)" });
  assert.equal(vm.spoken, "Final. Buccaneers 24, Cowboys 16.");
  assert.equal(vm.empty, "");
});

test("FINAL is never the Ball-on instruction, in any mode (G4-1)", () => {
  for (const version of [null, { watch: { state: "done" } }]) {
    const vm = predictionVm(makePv({ presented: state.final(), tl: tlOf(timeline.final()), version }));
    assert.equal(vm.kind, "final");
    assert.doesNotMatch(JSON.stringify(vm), /Ball on/);
  }
  const fed = predictionVm(makePv({ presented: state.feedOn(), tl: tlOf(timeline.final()) }));
  assert.equal(fed.kind, "final");
});

test("a drive typed after the final whistle is a call again (G4-1)", () => {
  assert.equal(predictionVm(makePv({ presented: state.drive(), tl: tlOf(timeline.final()) })).kind, "call");
});

test("FINAL before any logged snap says the scores come later and invents nothing (G4-1)", () => {
  const vm = predictionVm(makePv({ presented: patch(state.final(), { metrics: { n: 0 } }), tl: tlOf(timeline.final()) }));
  assert.deepEqual([vm.kind, vm.lines.length, vm.empty], ["final", 0, "Scores appear after the first logged snap."]);
});

test("an old log row with no top pick or rank still recaps, saying only what it knows (G4-1)", () => {
  const presented = patch(state.final(), { log: [{ seq: 1, call: "P", yards: 3, td: false, turnover: false }] });
  const vm = predictionVm(makePv({ presented, tl: { rows: [] }, version: { watch: { state: "paused" } } }));
  assert.equal(vm.kind, "recap");
  assert.deepEqual([vm.call, vm.happened, vm.verdict.key, vm.verdict.text, vm.lead], [null, "Pass", "none", "", null]);
  assert.equal(vm.spoken, "Schottenheimer so far. Pass.");
  assert.deepEqual(vm.recent.items.map((i) => i.key), []);
});
