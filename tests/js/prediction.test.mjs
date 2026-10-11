// ui/prediction.js: the video board (restructure-v2.md section 3): PREVIOUS PLAY, NEXT CALL and LAST 6 on screen at
// once, never switching faces; NEXT CALL is the call (FI 3.5; checklist #29 to #36), who has the ball, or FINAL.
// Rendered from the real view model on the real state fixtures (vm-prediction.test.mjs names the two watched ones);
// the actions stub records what the board asks for. Text only (G27); a play is shown on the field, never picked.
import assert from "node:assert/strict";
import test from "node:test";
import { predictionVm } from "../../static/js/model/vm-prediction.js";
import { makePv, patch, readFixture, state, timeline, tlOf } from "./model-fixtures.mjs";
import { findAll, fire, focusIn, hasClass, inDoc, mountWith, shellDocument } from "./ui-input-harness.mjs";

const load = () => import("../../static/js/ui/prediction.js");

function setup(results, ctx = {}) {
  const { doc, byId } = shellDocument([{ tag: "section", id: "rg-call", children: [{ tag: "div", id: "heroArea" }] }]);
  return load().then((mod) => ({ doc, root: byId("heroArea"),
    ...mountWith(doc, mod, byId("heroArea"), { results, ctx }) }));
}

const vmOf = (presented, view = {}, extra = {}) => predictionVm(makePv({ presented, view, ...extra }));
const leaves = (root) => findAll(root, (n) => hasClass(n, "leaf"));
/** The play button for a leaf (the call's top and the then-line also carry data-leaf). */
const leafButton = (root, key) => leaves(root).find((n) => n.getAttribute("data-leaf") === key);
const visible = (node) => {
  for (let n = node; n && n.nodeType === 1; n = n.parentNode) if (n.hidden) return false;
  return true;
};
const one = (root, cls) => findAll(root, (n) => hasClass(n, cls))[0] ?? null;
const words = (node) => node.textContent.replace(/\s+/g, " ").trim();

function tlAt(seq, status = {}) {
  const body = timeline.final();
  return tlOf(patch(body, { status: { ...body.status, state: "in", poss: "DAL", ball_kind: "snap", ...status } }), seq);
}

/** Sam's two watched pre-snaps: paused after 126 plays (a top pick) and after 151 (a miss). */
const watchVm = (n, extra = {}) => predictionVm(makePv({ presented: readFixture(`state_tb_dal_watch_${n}.json`),
  tl: tlAt(n), version: { watch: { state: "paused" } }, ...extra }));

/** TB on the ball after the interception: his previous call stays up, NEXT CALL says who has it. */
function tbBallVm() {
  const presented = patch(state.final(), { log: state.final().log.filter((r) => r.seq <= 36), prediction: null,
    drive_active: false });
  return predictionVm(makePv({ presented, tl: tlOf(timeline.at104()), version: { watch: { state: "paused" } } }));
}

const finalVm = () => predictionVm(makePv({ presented: state.final(), tl: tlOf(timeline.final()) }));

/** The drive fixture with a hot family and a hot leaf (the fixtures carry none). */
function hotDrive() {
  const base = state.drive();
  const families = base.prediction.families.map((f, i) => ({
    ...f, hot: i === 0 ? "up" : "",
    leaves: f.leaves.map((l, j) => ({ ...l, hot: i === 1 && j === 0 ? "down" : "" })),
  }));
  return patch(base, { prediction: { ...base.prediction, families } });
}

// ---------------------------------------------------------------- every section at once
test("before the first state nothing shows and nothing throws", async () => {
  const { doc, root, component } = await setup();
  inDoc(doc, () => component.update(predictionVm(makePv())));
  for (const cls of ["sc-prev", "sc-offfield", "sc-call", "sc-final", "sc-recent"]) {
    assert.equal(one(root, cls).hidden, true, cls);
  }
  assert.equal(root.getAttribute("data-kind"), "empty");
  inDoc(doc, () => component.update(null));
  assert.equal(root.getAttribute("data-kind"), "empty");
  component.destroy();
  assert.equal(root.childNodes.length, 0);
});

test("after a top pick all three sections show at once: previous play, next call, last six (Sam, Q3 2:52)", async () => {
  const { doc, root, component } = await setup();
  inDoc(doc, () => component.update(watchVm(126)));
  assert.equal(root.getAttribute("data-kind"), "call");
  const prev = one(root, "sc-prev");
  assert.ok(visible(prev));
  assert.equal(words(one(prev, "sc-face-kicker")), "Previous play · Snap 34");
  assert.equal(one(prev, "sc-prev-label").textContent, "Short pass left · +11");
  const verdict = one(prev, "sc-prev-verdict");
  assert.deepEqual([verdict.textContent, verdict.getAttribute("data-verdict"), verdict.hidden], ["Top pick · 19%", "top1",
    false]);
  assert.equal(one(prev, "sc-prev-predicted").hidden, true, "a top pick needs no second line");
  assert.equal(one(prev, "sc-prev-play").getAttribute("title"), readFixture("state_tb_dal_watch_126.json").log[0].feed_text);
  const call = one(root, "sc-call");
  assert.ok(visible(call));
  assert.equal(words(one(call, "sc-call-kicker")), "Schottenheimer's next call · Snap 35");
  assert.deepEqual([one(call, "sc-call-name").textContent, one(call, "sc-call-pct").textContent],
    ["Inside run (A/B gap)", "21%"]);
  const thenItems = findAll(call, (n) => hasClass(n, "sc-then-item"));
  assert.deepEqual(thenItems.map((n) => `${one(n, "sc-then-name").textContent} ${one(n, "sc-then-pct").textContent}`),
    ["PA short (0–9) 16%", "Short (0–9 air yds) 15%"]);
  assert.deepEqual(thenItems.map((n) => n.getAttribute("data-family")), ["pa", "dropback"]);
  const recent = one(root, "sc-recent");
  assert.ok(visible(recent));
  assert.equal(one(recent, "sc-face-kicker").textContent, "Schottenheimer so far");
  assert.equal(findAll(recent, (n) => hasClass(n, "sc-recent-dot")).length, 6);
  assert.equal(words(one(recent, "sc-recent-tally")), "Top pick 20 of 37 · In his top 3 30 of 37");
  for (const cls of ["sc-offfield", "sc-final"]) assert.equal(one(root, cls).hidden, true, cls);
  const order = [...root.children].map((n) => n.className.split(" ")[0]);
  assert.deepEqual(order, ["sc-prev", "sc-offfield", "sc-call", "sc-final", "sc-recent", "sr-only"],
    "previous play, next call, last six, top to bottom");
});

test("after a miss: MISS with his rank and odds, and what the board predicted under it (Sam, snap 41)", async () => {
  const { doc, root, component } = await setup();
  inDoc(doc, () => component.update(watchVm(151)));
  const prev = one(root, "sc-prev");
  assert.equal(one(prev, "sc-prev-label").textContent, "Short pass left · +15");
  const verdict = one(prev, "sc-prev-verdict");
  assert.deepEqual([verdict.textContent, verdict.getAttribute("data-verdict"), verdict.getAttribute("data-rank")],
    ["Miss · #4 Intermediate · 10%", "miss", "4"]);
  const predicted = one(prev, "sc-prev-predicted");
  assert.ok(visible(predicted));
  assert.equal(words(predicted), "Predicted Short (0–9 air yds) 45%");
  assert.equal(predicted.getAttribute("data-family"), "dropback");
  assert.deepEqual([one(root, "sc-call-name").textContent, one(root, "sc-call-pct").textContent],
    ["Short (0–9 air yds)", "47%"]);
  assert.equal(words(one(root, "sc-then-item")), "Intermediate (10–19) 11%", "#2 opens the then-line, no separator");
});

test("before his first snap: no previous play and no last six, not even a placeholder", async () => {
  const { doc, root, component } = await setup();
  const presented = patch(state.final(), { log: [], metrics: { n: 0 }, prediction: null, drive_active: false });
  inDoc(doc, () => component.update(predictionVm(makePv({ presented, tl: tlAt(0, { state: "pre", poss: null }) }))));
  assert.equal(root.getAttribute("data-kind"), "offfield");
  assert.deepEqual([one(root, "sc-prev").hidden, one(root, "sc-recent").hidden], [true, true]);
  const off = one(root, "sc-offfield");
  assert.equal(one(off, "sc-face-kicker").textContent, "Schottenheimer's next call");
  assert.equal(one(off, "sc-offfield-heading").hidden, true);
  assert.equal(one(off, "sc-offfield-body").textContent, "When DAL gets the ball, his next call appears here.");
  assert.doesNotMatch(words(root), /type|click|Ball on/i, "no instruction to enter anything");
});

test("TB has the ball: NEXT CALL reads so, his previous call and his last six stay up", async () => {
  const { doc, root, component } = await setup();
  inDoc(doc, () => component.update(tbBallVm()));
  assert.equal(root.getAttribute("data-kind"), "offfield");
  const off = one(root, "sc-offfield");
  assert.ok(visible(off));
  assert.equal(one(off, "sc-offfield-heading").textContent, "TB has the ball");
  assert.equal(one(off, "sc-offfield-body").hidden, true);
  assert.equal(one(root, "sc-call").hidden, true);
  const play = one(root, "sc-prev-play");
  assert.deepEqual([play.getAttribute("data-lead"), one(play, "sc-prev-label").textContent],
    ["int", "Pass intercepted · short middle"]);
  assert.ok(visible(one(root, "sc-recent")));
});

test("FINAL: the plate, the score and the way to the Model Report; no Shadow v League numbers", async () => {
  const { doc, root, component, calls } = await setup();
  inDoc(doc, () => component.update(finalVm()));
  assert.equal(root.getAttribute("data-kind"), "final");
  const face = one(root, "sc-final");
  assert.ok(visible(face));
  assert.equal(one(face, "sc-face-kicker").textContent, "Final");
  const teams = findAll(face, (n) => hasClass(n, "sc-final-team"));
  assert.deepEqual(teams.map((t) => [t.getAttribute("data-team"), t.getAttribute("data-caller"),
    one(t, "sc-final-abbr").textContent, one(t, "sc-digits-value").textContent]),
  [["TB", "false", "TB", "24"], ["DAL", "true", "DAL", "16"]]);
  assert.equal(findAll(face, (n) => hasClass(n, "sc-final-line")).length, 0, "Sam: no league numbers on this screen");
  assert.doesNotMatch(face.textContent, /league|log loss|top 3|run\/pass/i);
  const link = one(face, "sc-key");
  assert.deepEqual([link.localName, link.getAttribute("href"), link.getAttribute("title"), one(link, "sc-key-name").textContent],
    ["a", "/report", "The full scorecard is in the Model Report", "Tonight's scorecard"]);
  fire(link, "click");
  assert.deepEqual(calls, [], "a link, not an action on the game");
  assert.equal(one(root, "sc-prev-label").textContent, "Pass intercepted · short middle");
  assert.ok(visible(one(root, "sc-recent")));
});

test("FINAL's link goes where the top bar's Model Report key goes (main.js keeps the page's world on it)", async () => {
  const { doc, root, component } = await setup({}, { reportHref: "/report?world=neutral" });
  inDoc(doc, () => component.update(finalVm()));
  assert.equal(one(one(root, "sc-final"), "sc-key").getAttribute("href"), "/report?world=neutral");
});

test("the sections never stack two NEXT CALL faces: FINAL, a call, then off the field", async () => {
  const { doc, root, component } = await setup();
  inDoc(doc, () => component.update(finalVm()));
  inDoc(doc, () => component.update(predictionVm(makePv({ presented: state.drive(), tl: tlOf(timeline.final()) }))));
  assert.equal(root.getAttribute("data-kind"), "call");
  assert.equal(one(root, "sc-final").hidden, true);
  inDoc(doc, () => component.update(tbBallVm()));
  assert.equal(root.getAttribute("data-kind"), "offfield");
  assert.deepEqual(["sc-call", "sc-final"].map((cls) => one(root, cls).hidden), [true, true]);
  assert.equal(findAll(root, (n) => ["sc-offfield", "sc-call", "sc-final"].some((c) => hasClass(n, c)) && !n.hidden)
    .length, 1);
});

// ---------------------------------------------------------------- LAST 6
test("his last six as glyphs: a check, his rank in his top 3, or an X; one picture with its words", async () => {
  const { doc, root, component } = await setup();
  inDoc(doc, () => component.update(predictionVm(makePv({ presented: state.final(), tl: tlAt(128) }))));
  const vm = predictionVm(makePv({ presented: state.final(), tl: tlAt(128) }));
  const dots = findAll(root, (n) => hasClass(n, "sc-recent-dot"));
  assert.deepEqual(dots.map((d) => [d.getAttribute("data-verdict"), d.getAttribute("data-rank")]),
    vm.recent.items.map((i) => [i.key, i.key === "top3" ? String(i.rank) : null]));
  const strip = one(root, "sc-recent-glyphs");
  assert.deepEqual([strip.getAttribute("role"), strip.getAttribute("aria-label")], ["img", vm.recent.aria]);
  assert.equal(one(root, "sc-recent-label").textContent, "Last 6");
});

test("his night so far says why its calls outnumber his snaps, only once a flag has wiped one out", async () => {
  const { doc, root, component } = await setup();
  inDoc(doc, () => component.update(finalVm()));
  const note = one(root, "sc-recent-note");
  assert.ok(visible(note));
  assert.equal(note.textContent, "59 calls: 55 snaps and 4 wiped out by flags");
  assert.equal(words(one(root, "sc-recent-tally")), "Top pick 32 of 59 · In his top 3 47 of 59", "the tally as before");
  const early = patch(state.final(), { log: state.final().log.filter((r) => r.seq <= 6),
    metrics: { ...state.final().metrics, granular: { ...state.final().metrics.granular, leaf_n: 6 } } });
  inDoc(doc, () => component.update(predictionVm(makePv({ presented: early, tl: tlAt(7) }))));
  assert.equal(note.hidden, true, "snap 6 beside 6 calls needs no words");
});

// ---------------------------------------------------------------- the call (FI 3.5), as before
test("the call: name, figure, pill, then-line, split labels and the league mark (#29, #30, #31)", async () => {
  const { doc, root, component } = await setup();
  const presented = state.drive();
  inDoc(doc, () => component.update(vmOf(presented)));
  assert.equal(root.querySelector(".sc-call-label").textContent, "Schottenheimer's next call");
  assert.equal(root.querySelector(".sc-call-snap").textContent, "Snap 56");
  assert.equal(root.querySelector(".sc-call-name").textContent, presented.prediction.top[0].name);
  assert.equal(root.querySelector(".sc-call-pct").textContent, "48%");
  assert.equal(root.querySelector(".sc-call-top").getAttribute("data-leaf"), "dropback_deep");
  const pill = root.querySelector(".pill");
  assert.deepEqual([pill.textContent, pill.getAttribute("data-flag"), pill.getAttribute("title")],
    ["Like the league", "noedge", "Pass vs run against the league"]);
  assert.ok(hasClass(pill, "noedge"));
  const then = root.querySelector(".sc-then");
  assert.equal(words(then), "Then Short (0–9 air yds) 25% · Intermediate (10–19) 14%");
  assert.deepEqual(findAll(then, (n) => n.hasAttribute("data-leaf")).map((n) => n.getAttribute("data-leaf")),
    ["dropback_short", "dropback_mid"]);
  const labels = findAll(root.querySelector(".sc-split-labels"), (n) => n.localName === "span").map((n) => n.textContent);
  assert.deepEqual(labels, ["Ball thrown or dropback 94%", "League 94% (dashed)", "Handed off or kept 6%"]);
  assert.equal(root.querySelector(".lgmark").getAttribute("title"), "League 94%");
  const bar = root.querySelector(".sc-split-bar");
  assert.equal(bar.getAttribute("role"), "img");
  assert.match(bar.getAttribute("aria-label"), /^Pass versus run/);
  assert.match(bar.style.getPropertyValue("--sc-share"), /^93\.9\d*%$/);
  assert.match(bar.style.getPropertyValue("--sc-league-share"), /^94\.2\d*%$/);
});

test("TILT PASS gets its own pill class and the opening-script note shows in the why line (#30, #36)", async () => {
  const { doc, root, component } = await setup();
  inDoc(doc, () => component.update(vmOf(state.tilt())));
  const pill = root.querySelector(".pill");
  assert.equal(pill.textContent, "Tilts pass");
  assert.ok(hasClass(pill, "tiltpass") && !hasClass(pill, "noedge"));
  const why = root.querySelector(".why");
  assert.match(why.textContent, /^\+16\.5 pass pts from his habits here/);
  assert.match(why.textContent, /Opening script: memory switches on after snap 15/);
});

test("five families in server order with his and the league's percentages; leaves under each (#32, #33)", async () => {
  const { doc, root, component } = await setup();
  const presented = state.drive();
  inDoc(doc, () => component.update(vmOf(presented)));
  const fams = findAll(root, (n) => hasClass(n, "fam"));
  assert.deepEqual(fams.map((f) => f.getAttribute("data-family")), presented.prediction.families.map((f) => f.key));
  assert.deepEqual(fams.map((f) => f.querySelector(".sc-fam-pct").textContent), ["86%", "8%", "5%", "1%", "1%"]);
  assert.deepEqual(fams.map((f) => f.querySelector(".sc-fam-league").textContent),
    ["League 87%", "League 7%", "League 5%", "League 1%", "League 1%"]);
  const runLeaves = leaves(fams[1]);
  assert.deepEqual(runLeaves.map((l) => l.getAttribute("data-leaf")),
    ["run_inside", "run_ot_left", "run_edge_left", "run_ot_right", "run_edge_right"]);
  assert.deepEqual(runLeaves.map((l) => l.querySelector(".sc-leaf-pct").textContent), ["4.9%", "0.9%", "0.7%", "0.6%", "0.5%"]);
  const fill = fams[0].querySelector(".sc-fam-bar");
  assert.match(fill.style.getPropertyValue("--sc-share"), /^86\.2\d*%$/);
  assert.match(fill.style.getPropertyValue("--sc-league-share"), /^86\.9\d*%$/);
  assert.equal(leaves(fams[0])[0].style.getPropertyValue("--sc-share"), "100%", "bars are scaled to the top pick");
  assert.equal(root.querySelector(".sc-legend").textContent.startsWith("▲ ▼ = at least 4 points"), true);
});

test("every play is a focusable button that shows its shadow; none is pressed or picked (G18, restructure-v2)",
  async () => {
    const { doc, root, component, calls } = await setup();
    inDoc(doc, () => component.update(vmOf(state.drive())));
    const all = leaves(root);
    assert.equal(all.length, 14);
    for (const leaf of all) {
      assert.equal(leaf.localName, "button");
      assert.equal(leaf.getAttribute("type"), "button");
      assert.equal(leaf.hasAttribute("aria-pressed"), false);
      assert.equal(leaf.getAttribute("title"), "Shows this play's shadow on the field");
    }
    fire(leafButton(root, "run_edge_left"), "click");
    assert.deepEqual(calls, [], "a click logs nothing: no user input into the game");
  });

test("hot arrows: only hot items carry .up or .down with the league titles (#34)", async () => {
  const { doc, root, component } = await setup();
  inDoc(doc, () => component.update(vmOf(hotDrive())));
  const ups = findAll(root, (n) => hasClass(n, "up"));
  const downs = findAll(root, (n) => hasClass(n, "down"));
  assert.deepEqual([ups.length, downs.length], [1, 1]);
  assert.deepEqual([ups[0].getAttribute("title"), ups[0].getAttribute("data-hot"), ups[0].textContent],
    ["Well above the league", "up", "▲"]);
  assert.deepEqual([downs[0].getAttribute("title"), downs[0].textContent], ["Well below the league", "▼"]);
  assert.equal(findAll(root, (n) => hasClass(n, "fam"))[0].getAttribute("data-hot"), "up");
  inDoc(doc, () => component.update(vmOf(state.drive())));
  assert.equal(findAll(root, (n) => hasClass(n, "up") || hasClass(n, "down")).length, 0, "arrows go away with the heat");
});

test("hover and focus light the play's shadow play; leaving clears it; focus outlasts the pointer (G18)", async () => {
  const { doc, root, component, named } = await setup();
  inDoc(doc, () => component.update(vmOf(state.drive())));
  const call = root.querySelector(".sc-call");
  const deep = leafButton(root, "dropback_deep");
  const screen = leafButton(root, "screen");
  inDoc(doc, () => focusIn(deep));
  fire(call, "pointerover", { target: screen.querySelector(".sc-leaf-name") });
  fire(call, "pointerleave");
  fire(deep, "blur");
  assert.deepEqual(named("hoverLeaf"), [["dropback_deep"], ["screen"], ["dropback_deep"], [null]]);
  fire(call, "pointerover", { target: root.querySelector(".sc-call-name") });
  fire(call, "pointerover", { target: root.querySelector(".sc-split-bar") });
  fire(call, "pointerover", { target: root.querySelector(".sc-then-name") });
  assert.deepEqual(named("hoverLeaf").slice(4), [["dropback_deep"], [null], ["dropback_short"]]);
});

test("a family row under the pointer lights its top play; its own plays win inside it", async () => {
  const { doc, root, component, named } = await setup();
  inDoc(doc, () => component.update(vmOf(state.drive())));
  const call = root.querySelector(".sc-call");
  const run = findAll(root, (n) => hasClass(n, "fam")).find((f) => f.getAttribute("data-family") === "run");
  assert.equal(run.getAttribute("data-top-leaf"), "run_inside");
  fire(call, "pointerover", { target: run.querySelector(".sc-fam-pct") });
  fire(call, "pointerover", { target: leafButton(root, "run_edge_left") });
  fire(call, "pointerover", { target: run.querySelector(".sc-fam-bar") });
  fire(call, "pointerover", { target: run.querySelector(".sc-fam-pct") });
  assert.deepEqual(named("hoverLeaf"), [["run_inside"], ["run_edge_left"], ["run_inside"]],
    "moving between parts of one family sends nothing new");
});

test("the previous play and his last six light nothing on the field (the shadows are his next call's)", async () => {
  const { doc, root, component, calls } = await setup();
  inDoc(doc, () => component.update(watchVm(151)));
  for (const cls of ["sc-prev", "sc-recent"]) {
    const node = one(root, cls);
    fire(node, "pointerover", { target: node });
  }
  assert.deepEqual(calls, []);
  assert.equal(findAll(one(root, "sc-prev"), (n) => n.hasAttribute("data-leaf")).length, 0);
});

test("the highlighted play is marked, and a re-render keeps the focused node (#62, G18)", async () => {
  const { doc, root, component } = await setup();
  const presented = state.drive();
  inDoc(doc, () => component.update(vmOf(presented)));
  const edge = leafButton(root, "run_edge_left");
  inDoc(doc, () => focusIn(edge));
  inDoc(doc, () => component.update(vmOf(presented, { hoverLeaf: "screen" })));
  assert.equal(leafButton(root, "run_edge_left"), edge, "the same node survives the render");
  assert.equal(doc.activeElement, edge, "focus survives a background render");
  assert.equal(leafButton(root, "screen").getAttribute("data-highlighted"), "true");
  assert.equal(edge.getAttribute("data-highlighted"), "false");
});

test("leaving the call (his drive over) clears a hover it had lit", async () => {
  const { doc, root, component, named } = await setup();
  inDoc(doc, () => component.update(vmOf(state.drive())));
  fire(root.querySelector(".sc-call"), "pointerover", { target: leafButton(root, "screen") });
  inDoc(doc, () => component.update(tbBallVm()));
  assert.deepEqual(named("hoverLeaf"), [["screen"], [null]]);
  assert.equal(root.getAttribute("data-kind"), "offfield");
});

test("memory parts list one why item each, with one-decimal signed points (#36, G23)", async () => {
  const { doc, root, component } = await setup();
  inDoc(doc, () => component.update(vmOf(state.drive())));
  const items = findAll(root.querySelector(".why"), (n) => hasClass(n, "sc-why-item"));
  assert.deepEqual(items.map((i) => i.textContent), ["-0.1 pass pts from his habits here",
    "-0.2 Value gap (what's been working)"]);
  assert.deepEqual(items.map((i) => i.getAttribute("data-sign")), ["down", "down"]);
});

test("a new call re-arms its entrance; a new previous play re-arms its own; a hover re-arms neither", async () => {
  const { doc, root, component } = await setup();
  inDoc(doc, () => component.update(watchVm(126)));
  const call = root.querySelector(".sc-call");
  const prev = one(root, "sc-prev");
  const first = [call.getAttribute("data-enter"), prev.getAttribute("data-enter")];
  assert.ok(first.every((v) => v === "a" || v === "b"), String(first));
  inDoc(doc, () => component.update(watchVm(126, { view: { hoverLeaf: "screen" } })));
  assert.deepEqual([call.getAttribute("data-enter"), prev.getAttribute("data-enter")], first);
  inDoc(doc, () => component.update(watchVm(151)));
  assert.notEqual(call.getAttribute("data-enter"), first[0]);
  assert.notEqual(prev.getAttribute("data-enter"), first[1]);
});

// ---------------------------------------------------------------- the plate, the spoken board, 4th down
test("the board speaks one sentence in its live region, outside every section (G4-2)", async () => {
  const { doc, root, component } = await setup();
  inDoc(doc, () => component.update(watchVm(126)));
  const spoken = root.querySelector(".sc-board-spoken");
  assert.equal(spoken.parentNode, root);
  assert.equal(spoken.hidden, false);
  assert.equal(spoken.textContent, "Previous play, snap 34: Short pass left, +11. Top pick, 19 percent. "
    + "Next call, snap 35: Inside run (A/B gap), 21 percent. Then PA short (0–9), 16 percent.");
  assert.deepEqual([spoken.getAttribute("aria-live"), spoken.getAttribute("aria-atomic")], ["polite", "true"]);
  assert.ok(hasClass(spoken, "sr-only"));
  assert.equal(root.querySelector(".sc-call-top").hasAttribute("aria-live"), false);
});

test("on 4th down the plate says the call is if he goes for it, with the reason as its tooltip (G4-4)", async () => {
  const { doc, root, component } = await setup();
  const drive = state.drive();
  inDoc(doc, () => component.update(vmOf(patch(drive, { sit: { ...drive.sit, down: 4 } }))));
  assert.equal(root.querySelector(".sc-call-label").textContent, "4th down · if he goes for it");
  assert.equal(root.querySelector(".sc-call-snap").textContent, "Snap 56");
  assert.match(root.querySelector(".sc-call-kicker").getAttribute("title"), /no punt or field-goal class/);
  assert.equal(root.querySelector(".sc-call").getAttribute("data-fourth"), "true");
  inDoc(doc, () => component.update(vmOf(drive)));
  assert.equal(root.querySelector(".sc-call").getAttribute("data-fourth"), "false");
  assert.equal(root.querySelector(".sc-call-kicker").hasAttribute("title"), false);
});

// ---------------------------------------------------------------- G27: labels are text, never HTML
test("ESPN's words and every label go in as text, never as markup (G27)", async () => {
  const { doc, root, component } = await setup();
  const hostile = "<img src=x onerror=alert(1)>Screen";
  const log = [{ ...state.final().log[0], espn_id: null, seq: 98, name: hostile, feed_text: hostile }];
  inDoc(doc, () => component.update(predictionVm(makePv({ presented: patch(state.final(), { log }), tl: tlAt(10) }))));
  const play = one(root, "sc-prev-play");
  assert.equal(one(play, "sc-prev-label").textContent, `${hostile}, turnover`);
  assert.equal(play.getAttribute("title"), hostile);
  assert.equal(findAll(root, (n) => n.localName === "img").length, 0);
});
