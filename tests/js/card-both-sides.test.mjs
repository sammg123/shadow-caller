// The video board with both sides tracked (restructure-v2.md 11 decision 4): the card follows the offense with the
// ball and is headed with that caller's name ("ROBINSON'S NEXT CALL"); its PREVIOUS PLAY and LAST 6 with his night so
// far are that same caller's, and wherever "he" would leave it open whose call it is (his previous play, 4th down, the
// live region) the card names him. With one side it behaves exactly as before (vm-prediction.test.mjs and
// prediction.test.mjs hold that, unchanged). Both sides are derived from the real TB at DAL captures (both-sides.mjs),
// plus one capture of the engine itself tracking both sides:
//   tests/fixtures/state_tb_dal_both_watch_25.json  /api/state from an offline sandbox (scripts/sandbox.py): TB at DAL
//     picked with both sides (POST /api/game/select), paused after 25 plays. Robinson has the ball with snap 10 next:
//     his 11 calls are 9 snaps, two of them scrambles, then a sack and a scramble a flag each wiped out (a sack or a
//     scramble has no specific play, so the scorecard grades it on its play type only: 7 specific-play calls)
import assert from "node:assert/strict";
import test from "node:test";
import { predictionVm } from "../../static/js/model/vm-prediction.js";
import { bothState, bothTimeline, bothTl, callsOf, nextCallOf } from "./both-sides.mjs";
import { isDeepFrozen, makePv, patch, readFixture, state, timeline, tlOf } from "./model-fixtures.mjs";
import { findAll, hasClass, inDoc, mountWith, shellDocument } from "./ui-input-harness.mjs";

const gradeOf = (r) => (r.leaf_rank === 1 ? "top1" : r.leaf_rank <= 3 ? "top3" : "miss");
const lastSix = (presented, team) => callsOf(presented, team).slice(0, 6).reverse().map((r) => [gradeOf(r), r.leaf_rank]);
const tally = (vm) => vm.recent.tally.map((t) => `${t.label} ${t.value}`);
const TB_METRICS = Object.freeze({ TB: { n: 49, granular: { leaf_n: 49, leaf_top1: 30, leaf_top3: 41 } } });

/** Paused after timeline row 120 (Q3 5:09, TB's inside run for -5), the given side's call up or none. */
function at120({ poss, prediction = null, perSide = true, changes = {} } = {}) {
  const presented = patch(bothState({ seq: 120, prediction, perSide, metrics: TB_METRICS }), changes);
  return { presented, vm: predictionVm(makePv({ presented, tl: bothTl(120, { poss }),
    version: { watch: { state: "paused" } } })) };
}

// ---------------------------------------------------------------- whose card it is
test("TB has the ball with his call up: ROBINSON'S NEXT CALL, his previous play, his last six, his night", () => {
  const { presented, vm } = at120({ poss: "TB", prediction: nextCallOf("TB", 45) });
  assert.deepEqual([vm.kind, vm.team], ["call", "TB"]);
  assert.deepEqual([vm.next.heading, vm.next.snap.text], ["Robinson's next call", "Snap 45"]);
  assert.deepEqual([vm.previous.plate, vm.previous.snap.text, vm.previous.label, vm.previous.verdict.key],
    ["Robinson's previous play", "Snap 44", "Inside run · −5", "top1"], "the plate says whose play it was");
  assert.equal(vm.recent.plate, "Robinson so far");
  assert.deepEqual(vm.recent.items.map((i) => [i.key, i.rank]), lastSix(presented, "TB"));
  assert.deepEqual(tally(vm), ["Top pick 30 of 49", "In his top 3 41 of 49"], "his scorecard, as the server sent it");
  assert.match(vm.spoken,
    /^Shadowing Robinson\. Previous play, snap 44: Inside run, −5\. Top pick, \d+ percent\. Next call, snap 45: /);
  assert.ok(isDeepFrozen(vm));
});

test("DAL's call up: SCHOTTENHEIMER'S NEXT CALL with his own previous play and last six; none of Robinson's", () => {
  const { presented, vm } = at120({ poss: "DAL", prediction: nextCallOf("DAL", 37), perSide: false });
  assert.deepEqual([vm.team, vm.next.heading, vm.next.snap.text], ["DAL", "Schottenheimer's next call", "Snap 37"]);
  assert.deepEqual([vm.previous.plate, vm.previous.snap.text, vm.previous.label, vm.previous.lead.kind],
    ["Schottenheimer's previous play", "Snap 33", "Pass intercepted · short middle", "int"]);
  assert.equal(vm.recent.plate, "Schottenheimer so far");
  assert.deepEqual(vm.recent.items.map((i) => [i.key, i.rank]), lastSix(presented, "DAL"));
  const dal = callsOf(presented, "DAL");
  assert.deepEqual(tally(vm), [`Top pick ${dal.filter((r) => r.leaf_rank === 1).length} of ${dal.length}`,
    `In his top 3 ${dal.filter((r) => r.leaf_rank <= 3).length} of ${dal.length}`],
  "no scorecard sent for him: counted from his own calls, never the other caller's");
});

test("4th down names him: the caveat says whose call it is when two callers are tracked", () => {
  const sit = { ...state.final().sit, down: 4, togo: 2 };
  const { vm } = at120({ poss: "TB", prediction: nextCallOf("TB", 45), changes: { sit } });
  assert.equal(vm.next.heading, "4th down · if Robinson goes for it");
  assert.equal(vm.next.fourth.on, true);
  assert.match(vm.spoken, /^Shadowing Robinson\. .* Fourth down, if he goes for it\. Next call, snap 45: /);
});

test("TB has the ball between snaps: his card waits under his name and says he has it, his calls stay up", () => {
  const { vm } = at120({ poss: "TB" });
  assert.deepEqual([vm.kind, vm.team], ["offfield", "TB"]);
  assert.deepEqual([vm.next.plate, vm.next.heading, vm.next.body], ["Robinson's next call", "TB has the ball", ""],
    "his own offense has the ball, so never \"when TB gets the ball\"");
  assert.equal(vm.previous.label, "Inside run · −5");
  assert.equal(vm.recent.plate, "Robinson so far");
});

test("kicking off after his touchdown it is still his card: the touchdown is his previous play", () => {
  const presented = bothState({ seq: 13 });
  const vm = predictionVm(makePv({ presented, tl: bothTl(13, { poss: "DAL", ball_kind: "kickoff" }) }));
  assert.deepEqual([vm.kind, vm.next.plate, vm.next.heading], ["offfield", "Schottenheimer's next call",
    "DAL kicks off"]);
  assert.deepEqual([vm.previous.label, vm.previous.lead.kind], ["Inside run (up the middle) · TD", "td"]);
});

test("before anyone has the ball: the first side named, waiting for his offense", () => {
  const vm = predictionVm(makePv({ presented: bothState({ seq: 0 }), tl: bothTl(0, { poss: null, ball_kind: null }) }));
  assert.deepEqual([vm.kind, vm.team, vm.next.plate, vm.next.heading], ["offfield", "TB", "Robinson's next call", ""]);
  assert.equal(vm.next.body, "When TB gets the ball, his next call appears here.");
  assert.deepEqual([vm.previous, vm.recent, vm.spoken], [null, null,
    "Shadowing Robinson. When TB gets the ball, his next call appears here."]);
});

test("at the final whistle: FINAL, with the last caller's previous play and last six", () => {
  const presented = bothState();
  const vm = predictionVm(makePv({ presented, tl: tlOf(bothTimeline()) }));
  assert.equal(vm.kind, "final");
  assert.equal(presented.log[0].team, "TB");
  assert.deepEqual([vm.previous.label, vm.recent.plate], ["Inside run · +22", "Robinson so far"]);
  assert.deepEqual(vm.recent.items.map((i) => [i.key, i.rank]), lastSix(presented, "TB"));
});

test("no name is built in: another pair of callers heads the card with theirs; a long name keeps the plain plates", () => {
  const { presented } = at120({ poss: "TB", prediction: nextCallOf("TB", 45) });
  const named = (tb) => patch(presented, { tracked: presented.tracked.map((t) => ({ ...t,
    caller: t.team === "TB" ? tb : "Ben Johnson" })) });
  const vm = predictionVm(makePv({ presented: named("Kevin O'Connell"), tl: bothTl(120, { poss: "TB" }) }));
  assert.deepEqual([vm.next.heading, vm.previous.plate, vm.recent.plate],
    ["O'Connell's next call", "O'Connell's previous play", "O'Connell so far"]);
  const long = predictionVm(makePv({ presented: named("Pat Abcdefghijklmnopqrstu"), tl: bothTl(120, { poss: "TB" }) }));
  assert.deepEqual([long.next.heading, long.previous.plate, long.recent.plate],
    ["Next call", "Previous play", "So far"], "a name too long for a plate leaves every plate plain");
  assert.doesNotMatch(long.spoken, /^Shadowing/);
});

test("one side, as before: no team, the plain previous-play plate, nothing spoken first", () => {
  const vm = predictionVm(makePv({ presented: state.final(), tl: tlOf(timeline.final()) }));
  assert.equal(vm.team, null);
  assert.equal(vm.previous.plate, "Previous play");
  assert.match(vm.spoken, /^Previous play, snap /);
});

// ---------------------------------------------------------------- on the board
function setup() {
  const { doc, byId } = shellDocument([{ tag: "section", id: "rg-call", children: [{ tag: "div", id: "heroArea" }] }]);
  return import("../../static/js/ui/prediction.js").then((mod) => ({ doc, root: byId("heroArea"),
    ...mountWith(doc, mod, byId("heroArea")) }));
}
const one = (root, cls) => findAll(root, (n) => hasClass(n, cls))[0] ?? null;
const words = (node) => node.textContent.replace(/\s+/g, " ").trim();

test("the board's plates name the caller with the ball, and change with the ball", async () => {
  const { doc, root, component } = await setup();
  inDoc(doc, () => component.update(at120({ poss: "TB", prediction: nextCallOf("TB", 45) }).vm));
  assert.equal(root.getAttribute("data-team"), "TB");
  assert.equal(words(one(root, "sc-call-kicker")), "Robinson's next call · Snap 45");
  assert.equal(words(one(one(root, "sc-prev"), "sc-face-kicker")), "Robinson's previous play · Snap 44");
  assert.equal(words(one(one(root, "sc-recent"), "sc-face-kicker")), "Robinson so far");
  assert.equal(one(root, "sc-prev-label").textContent, "Inside run · −5");
  assert.equal(findAll(root, (n) => hasClass(n, "sc-recent-dot")).length, 6);
  const enter = one(root, "sc-prev").getAttribute("data-enter");
  inDoc(doc, () => component.update(at120({ poss: "DAL", prediction: nextCallOf("DAL", 37) }).vm));
  assert.equal(root.getAttribute("data-team"), "DAL");
  assert.equal(words(one(root, "sc-call-kicker")), "Schottenheimer's next call · Snap 37");
  assert.equal(words(one(one(root, "sc-recent"), "sc-face-kicker")), "Schottenheimer so far");
  assert.equal(one(root, "sc-prev-label").textContent, "Pass intercepted · short middle");
  assert.notEqual(one(root, "sc-prev").getAttribute("data-enter"), enter, "another caller's previous play enters");
});

test("the call enters again when the ball changes hands, even on the same snap number and the same top pick", async () => {
  const { doc, root, component } = await setup();
  const call = one(root, "sc-call");
  inDoc(doc, () => component.update(at120({ poss: "TB", prediction: nextCallOf("TB", 40) }).vm));
  const first = call.getAttribute("data-enter");
  inDoc(doc, () => component.update(at120({ poss: "TB", prediction: nextCallOf("TB", 40) }).vm));
  assert.equal(call.getAttribute("data-enter"), first, "the same call re-rendered: no entrance");
  inDoc(doc, () => component.update(at120({ poss: "DAL", prediction: nextCallOf("DAL", 40) }).vm));
  assert.notEqual(call.getAttribute("data-enter"), first, "his call, not the other caller's: it enters");
});

test("one side: the board carries no team", async () => {
  const { doc, root, component } = await setup();
  inDoc(doc, () => component.update(predictionVm(makePv({ presented: state.drive(), tl: tlOf(timeline.final()) }))));
  assert.equal(root.hasAttribute("data-team"), false);
  assert.equal(root.getAttribute("data-kind"), "call");
});

// ---------------------------------------------------------------- the engine's own capture: sacks and scrambles
const engineVm = () => predictionVm(makePv({ presented: readFixture("state_tb_dal_both_watch_25.json"),
  version: { watch: { state: "paused" } } }));

test("on the engine's capture his note counts every call he made, and his sacks and scrambles sit apart", () => {
  const vm = engineVm();
  assert.deepEqual([vm.team, vm.next.heading, vm.next.snap.text], ["TB", "Robinson's next call", "Snap 10"]);
  assert.deepEqual([vm.previous.plate, vm.previous.snap.text, vm.previous.verdict.key, vm.previous.verdict.text],
    ["Robinson's previous play", "", "miss", "Miss · play type only"],
    "his scramble a flag wiped out: no snap number, and graded on its play type only");
  assert.deepEqual(tally(vm), ["Top pick 3 of 7", "In his top 3 4 of 7"], "his scorecard's specific-play counts");
  assert.equal(vm.recent.note, "11 calls: 9 snaps and 2 wiped out; 4 graded on play type only",
    "snap 10 is next after 9 snaps; 11 calls less 4 graded on play type is the tally's 7");
  assert.deepEqual(vm.recent.items.map((i) => [i.key, i.level]),
    [["top1", "family"], ["top1", "leaf"], ["top1", "leaf"], ["top1", "leaf"], ["top1", "family"], ["miss", "family"]],
    "his scramble, three top picks, then the wiped-out sack and scramble, graded on their play type");
  assert.equal(vm.recent.aria, "Last 6: Top pick (play type only), Top pick, Top pick, Top pick, "
    + "Top pick (play type only), Miss (play type only)");
});

test("on the board a call graded on its play type only says so in data-level; the note says how his calls split",
  async () => {
    const { doc, root, component } = await setup();
    inDoc(doc, () => component.update(engineVm()));
    const dots = findAll(root, (n) => hasClass(n, "sc-recent-dot"));
    assert.deepEqual(dots.map((d) => [d.getAttribute("data-verdict"), d.getAttribute("data-level")]),
      [["top1", "family"], ["top1", "leaf"], ["top1", "leaf"], ["top1", "leaf"], ["top1", "family"],
        ["miss", "family"]]);
    const note = one(root, "sc-recent-note");
    assert.equal(note.hidden, false);
    assert.equal(note.textContent, "11 calls: 9 snaps and 2 wiped out; 4 graded on play type only");
    inDoc(doc, () => component.update(at120({ poss: "TB", prediction: nextCallOf("TB", 45) }).vm));
    assert.deepEqual(findAll(root, (n) => hasClass(n, "sc-recent-dot")).map((d) => d.getAttribute("data-level")),
      Array(6).fill("leaf"), "every call graded on its specific play: no mark set apart");
  });
