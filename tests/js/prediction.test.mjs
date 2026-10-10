// ui/prediction.js (owner A7): the next call (FI 3.5; checklist #29 to #37, #122; G18, G24). Rendered from the real
// view model on the real state fixtures; the actions stub records what the hero asks for.
import assert from "node:assert/strict";
import test from "node:test";
import { predictionVm } from "../../static/js/model/vm-prediction.js";
import { makePv, patch, state, timeline, tlOf } from "./model-fixtures.mjs";
import { findAll, fire, focusIn, hasClass, inDoc, mountWith, shellDocument } from "./ui-input-harness.mjs";

const load = () => import("../../static/js/ui/prediction.js");

function setup(results) {
  const { doc, byId } = shellDocument([{ tag: "section", id: "rg-call", children: [{ tag: "div", id: "heroArea" }] }]);
  return load().then((mod) => ({ doc, root: byId("heroArea"), ...mountWith(doc, mod, byId("heroArea"), { results }) }));
}

const vmOf = (presented, view = {}, extra = {}) => predictionVm(makePv({ presented, view, ...extra }));
const leaves = (root) => findAll(root, (n) => hasClass(n, "leaf"));
/** The play button for a leaf (the call's top and the then-line also carry data-leaf). */
const leafButton = (root, key) => leaves(root).find((n) => n.getAttribute("data-leaf") === key);
const visible = (node) => {
  for (let n = node; n && n.nodeType === 1; n = n.parentNode) if (n.hidden) return false;
  return true;
};

/** The drive fixture with a hot family and a hot leaf (the fixtures carry none). */
function hotDrive() {
  const base = state.drive();
  const families = base.prediction.families.map((f, i) => ({
    ...f, hot: i === 0 ? "up" : "",
    leaves: f.leaves.map((l, j) => ({ ...l, hot: i === 1 && j === 0 ? "down" : "" })),
  }));
  return patch(base, { prediction: { ...base.prediction, families } });
}

test("off the field: the off-field heading and the manual copy with its strong parts; no call (#5, G24)", async () => {
  const { doc, root, component } = await setup();
  inDoc(doc, () => component.update(vmOf(state.final())));
  const heading = root.querySelector(".sc-offfield-heading");
  assert.equal(heading.textContent, "DAL is off the field");
  assert.ok(visible(heading));
  const body = root.querySelector(".sc-offfield-body");
  assert.match(body.textContent, /^When DAL gets the ball, click Ball on above and type the spot, like D 25\./);
  assert.deepEqual(findAll(body, (n) => n.localName === "strong").map((n) => n.textContent), ["Ball on", "D 25"]);
  assert.equal(root.querySelector(".sc-call").hidden, true);
  assert.equal(root.getAttribute("data-kind"), "offfield");
  inDoc(doc, () => component.update(vmOf(patch(state.feedOn(), { log: [] }))));
  assert.equal(body.textContent,
    "When DAL gets the ball, the ESPN feed starts the drive and the next call appears here.");
});

test("the call: name, figure, pill, then-line, split labels and the league mark (#29, #30, #31)", async () => {
  const { doc, root, component } = await setup();
  const presented = state.drive();
  inDoc(doc, () => component.update(vmOf(presented)));
  const call = root.querySelector(".sc-call");
  assert.ok(visible(call));
  assert.equal(root.querySelector(".sc-offfield").hidden, true);
  assert.equal(root.querySelector(".sc-call-label").textContent, "Schottenheimer's next call");
  assert.equal(root.querySelector(".sc-call-snap").textContent, "Snap 56");
  assert.equal(root.querySelector(".sc-call-name").textContent, presented.prediction.top[0].name);
  assert.equal(root.querySelector(".sc-call-pct").textContent, "48%");
  assert.equal(root.querySelector(".sc-call-top").getAttribute("data-leaf"), "dropback_deep");
  const pill = root.querySelector(".pill");
  assert.equal(pill.textContent, "Like the league");
  assert.ok(hasClass(pill, "noedge"));
  assert.equal(pill.getAttribute("data-flag"), "noedge");
  assert.equal(pill.getAttribute("title"), "Pass vs run against the league");
  const then = root.querySelector(".sc-then");
  assert.equal(then.textContent, "Then Short (0–9 air yds) 25% · Intermediate (10–19) 14%");
  assert.deepEqual(findAll(then, (n) => n.hasAttribute("data-leaf")).map((n) => n.getAttribute("data-leaf")),
    ["dropback_short", "dropback_mid"]);
  const labels = findAll(root.querySelector(".sc-split-labels"), (n) => n.localName === "span").map((n) => n.textContent);
  assert.deepEqual(labels, ["Ball thrown or dropback 94%", "League 94% (dashed)", "Handed off or kept 6%"]);
  const mark = root.querySelector(".lgmark");
  assert.equal(mark.getAttribute("title"), "League 94%");
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
  assert.equal(pill.getAttribute("data-flag"), "tiltpass");
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
  assert.equal(fams[0].querySelector(".sc-fam-name").textContent, "Dropback pass");
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

test("every leaf is a focusable button with aria-pressed and the pick title (#122, G18)", async () => {
  const { doc, root, component } = await setup();
  inDoc(doc, () => component.update(vmOf(state.drive())));
  const all = leaves(root);
  assert.equal(all.length, 14);
  for (const leaf of all) {
    assert.equal(leaf.localName, "button");
    assert.equal(leaf.getAttribute("type"), "button");
    assert.equal(leaf.getAttribute("aria-pressed"), "false");
    assert.equal(leaf.getAttribute("title"), "Click to log this as the play he called");
  }
});

test("hot arrows: only hot items carry .up or .down with the league titles (#34)", async () => {
  const { doc, root, component } = await setup();
  inDoc(doc, () => component.update(vmOf(hotDrive())));
  const ups = findAll(root, (n) => hasClass(n, "up"));
  const downs = findAll(root, (n) => hasClass(n, "down"));
  assert.equal(ups.length, 1);
  assert.equal(downs.length, 1);
  assert.equal(ups[0].getAttribute("title"), "Well above the league");
  assert.equal(ups[0].getAttribute("data-hot"), "up");
  assert.equal(ups[0].textContent, "▲");
  assert.equal(downs[0].getAttribute("title"), "Well below the league");
  assert.equal(downs[0].textContent, "▼");
  assert.equal(findAll(root, (n) => hasClass(n, "fam"))[0].getAttribute("data-hot"), "up");
  inDoc(doc, () => component.update(vmOf(state.drive())));
  assert.equal(findAll(root, (n) => hasClass(n, "up") || hasClass(n, "down")).length, 0, "arrows go away with the heat");
  assert.equal(findAll(root, (n) => n.hasAttribute("title") && /league$/.test(n.getAttribute("title"))
    && !hasClass(n, "pill") && !hasClass(n, "lgmark")).length, 0);
});

test("clicking a leaf picks it; Enter and Space reach it natively as a button (#37, #122)", async () => {
  const { doc, root, component, named } = await setup();
  inDoc(doc, () => component.update(vmOf(state.drive())));
  const edge = leafButton(root, "run_edge_left");
  fire(edge, "click");
  assert.deepEqual(named("pickLeaf"), [["run_edge_left"]]);
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

test("a family row under the pointer lights its top play; its own plays win inside it (DESIGN.md video board)",
  async () => {
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

test("the picked leaf is pressed, the highlighted one is marked, and a re-render keeps the focused node (#62, G18)",
  async () => {
    const { doc, root, component } = await setup();
    const presented = state.drive();
    inDoc(doc, () => component.update(vmOf(presented)));
    const edge = leafButton(root, "run_edge_left");
    inDoc(doc, () => focusIn(edge));
    inDoc(doc, () => component.update(vmOf(presented, { pick: { k: "J", i: 1, out: null }, hoverLeaf: "screen" })));
    assert.equal(leafButton(root, "run_edge_left"), edge, "the same node survives the render");
    assert.equal(doc.activeElement, edge, "focus survives a background render");
    assert.equal(edge.getAttribute("aria-pressed"), "true");
    assert.equal(leafButton(root, "screen").getAttribute("data-highlighted"), "true");
    assert.equal(edge.getAttribute("data-highlighted"), "false");
  });

test("leaving the call (drive over) clears a hover it had lit", async () => {
  const { doc, root, component, named } = await setup();
  inDoc(doc, () => component.update(vmOf(state.drive())));
  fire(root.querySelector(".sc-call"), "pointerover", { target: leafButton(root, "screen") });
  inDoc(doc, () => component.update(vmOf(state.final())));
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
  assert.deepEqual(items.map((i) => i.getAttribute("data-kind")), ["habits", "memory"]);
});

test("a new call re-arms the entrance hook; the same call does not", async () => {
  const { doc, root, component } = await setup();
  const presented = state.drive();
  inDoc(doc, () => component.update(vmOf(presented)));
  const call = root.querySelector(".sc-call");
  const first = call.getAttribute("data-enter");
  assert.ok(first === "a" || first === "b");
  inDoc(doc, () => component.update(vmOf(presented, { hoverLeaf: "screen" })));
  assert.equal(call.getAttribute("data-enter"), first, "a hover is not a new call");
  inDoc(doc, () => component.update(vmOf(state.tilt())));
  assert.notEqual(call.getAttribute("data-enter"), first);
});

test("before the first state nothing shows and nothing throws", async () => {
  const { doc, root, component } = await setup();
  inDoc(doc, () => component.update(predictionVm(makePv())));
  assert.equal(root.querySelector(".sc-call").hidden, true);
  assert.equal(root.querySelector(".sc-offfield").hidden, true);
  assert.equal(root.getAttribute("data-kind"), "empty");
  inDoc(doc, () => component.update(null));
  assert.equal(root.getAttribute("data-kind"), "empty");
  component.destroy();
});

// ---------------------------------------------------------------- v1.5 (G4-2, G4-4): the plate and the spoken call
test("the call speaks one sentence in the board's live region; the visible figures stay quiet (G4-2)", async () => {
  const { doc, root, component } = await setup();
  inDoc(doc, () => component.update(vmOf(state.drive())));
  const spoken = root.querySelector(".sc-board-spoken");
  assert.equal(spoken.parentNode, root, "outside every face, so a face that appears is still heard");
  assert.equal(spoken.hidden, false);
  assert.equal(spoken.textContent,
    "Next call, snap 56: Deep shot (20+), 48 percent. Then Short (0–9 air yds), 25 percent.");
  assert.deepEqual([spoken.getAttribute("aria-live"), spoken.getAttribute("aria-atomic")], ["polite", "true"]);
  assert.ok(hasClass(spoken, "sr-only"));
  assert.equal(root.querySelector(".sc-call-top").hasAttribute("aria-live"), false,
    "the name, figure and tag no longer run together as one announcement");
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

// ---------------------------------------------------------------- v1.5 (G4-1): the recap and FINAL faces
function recapPv(seq) {
  const body = timeline.final();
  const logSeq = body.rows.filter((r) => r.seq <= seq && r.pred).map((r) => r.pred.log_seq).pop();
  const presented = patch(state.final(), { log: state.final().log.filter((r) => r.seq <= logSeq) });
  return makePv({ presented, tl: tlOf(patch(body, { status: { ...body.status, state: "in" } }), seq),
    version: { watch: { state: "paused" } } });
}

test("off the field in a watched game the board recaps his last call and his night (G4-1)", async () => {
  const { doc, root, component } = await setup();
  inDoc(doc, () => component.update(predictionVm(recapPv(104))));
  assert.equal(root.getAttribute("data-kind"), "recap");
  const face = root.querySelector(".sc-recap");
  assert.ok(visible(face));
  for (const sel of [".sc-call", ".sc-offfield", ".sc-final"]) assert.equal(root.querySelector(sel).hidden, true, sel);
  assert.equal(face.querySelector(".sc-face-kicker").textContent, "Schottenheimer so far");
  const lead = face.querySelector(".sc-recap-lead");
  assert.deepEqual([lead.hidden, lead.getAttribute("data-lead"), lead.querySelector(".sc-recap-leadword").textContent],
    [false, "int", "Intercepted"]);
  const call = face.querySelector(".sc-recap-call");
  assert.deepEqual([call.getAttribute("data-family"), call.querySelector(".sc-recap-label").textContent,
    call.querySelector(".sc-recap-name").textContent, call.querySelector(".sc-recap-pct").textContent],
  ["dropback", "Predicted", "Short (0–9 air yds)", "36%"]);
  assert.equal(face.querySelector(".sc-recap-happened").textContent, "Pass intercepted · short middle");
  const verdict = face.querySelector(".sc-recap-verdict");
  assert.deepEqual([verdict.getAttribute("data-verdict"), verdict.textContent], ["top1", "Top pick"]);
  assert.equal(face.querySelector(".sc-recap-tally").textContent, "Top pick 32 of 59 · In his top 3 47 of 59");
  const dots = findAll(face, (n) => hasClass(n, "sc-recap-dot"));
  assert.equal(dots.length, 6);
  const strip = face.querySelector(".sc-recap-glyphs");
  assert.equal(strip.getAttribute("role"), "img");
  assert.match(strip.getAttribute("aria-label"), /^Last 6: (Top pick|In his top 3|Miss)(, (Top pick|In his top 3|Miss)){5}$/);
  assert.equal(face.querySelector(".sc-recap-off").textContent, "DAL is off the field");
  const spoken = root.querySelector(".sc-board-spoken");
  assert.equal(spoken.getAttribute("aria-live"), "polite");
  assert.match(spoken.textContent, /^Schottenheimer so far\. Predicted Short/);
});

test("the recap after his touchdown leads with it; after a punt there is no lead (G4-1)", async () => {
  const { doc, root, component } = await setup();
  inDoc(doc, () => component.update(predictionVm(recapPv(161))));
  const lead = root.querySelector(".sc-recap-lead");
  assert.deepEqual([lead.hidden, lead.getAttribute("data-lead"), lead.textContent], [false, "td", "Touchdown"]);
  inDoc(doc, () => component.update(predictionVm(recapPv(44))));
  assert.equal(lead.hidden, true);
  assert.equal(root.querySelector(".sc-recap-verdict").getAttribute("data-verdict"), "top3");
});

test("FINAL: the plate, the score, three SHADOW v LEAGUE lines and the scorecard key (G4-1)", async () => {
  const { doc, root, component, named } = await setup();
  inDoc(doc, () => component.update(predictionVm(makePv({ presented: state.final(), tl: tlOf(timeline.final()) }))));
  assert.equal(root.getAttribute("data-kind"), "final");
  const face = root.querySelector(".sc-final");
  assert.ok(visible(face));
  assert.equal(face.querySelector(".sc-face-kicker").textContent, "Final");
  const teams = findAll(face, (n) => hasClass(n, "sc-final-team"));
  assert.deepEqual(teams.map((t) => [t.getAttribute("data-team"), t.getAttribute("data-caller"),
    t.querySelector(".sc-final-abbr").textContent, t.querySelector(".sc-digits-value").textContent]),
  [["TB", "false", "TB", "24"], ["DAL", "true", "DAL", "16"]]);
  const lines = findAll(face, (n) => hasClass(n, "sc-final-line"));
  assert.deepEqual(lines.map((l) => [l.getAttribute("data-pair"), l.getAttribute("data-leader"), l.textContent]), [
    ["called_right", "shadow", "Run/pass right 85% v 81%"],
    ["top3", "league", "Play in top 3 47 v 48"],
    ["passrun_logloss", "shadow", "Pass vs run log loss .421 v .424"],
  ]);
  const key = face.querySelector(".sc-key");
  assert.deepEqual([key.getAttribute("aria-keyshortcuts"), key.getAttribute("title"),
    key.querySelector(".sc-key-name").textContent], ["G", "Full scorecard (G)", "Tonight's scorecard"]);
  fire(key, "click");
  assert.deepEqual(named("toggleScorecard"), [[]]);
  assert.equal(root.querySelector(".sc-board-spoken").textContent, "Final. Buccaneers 24, Cowboys 16.");
  assert.doesNotMatch(root.textContent.replace(/\s+/g, " "), /type the spot/, "the hidden faces keep no stale copy in view");
});

test("faces swap cleanly: FINAL, then a typed drive's call, then the off-field copy (G4-1)", async () => {
  const { doc, root, component } = await setup();
  inDoc(doc, () => component.update(predictionVm(makePv({ presented: state.final(), tl: tlOf(timeline.final()) }))));
  inDoc(doc, () => component.update(predictionVm(makePv({ presented: state.drive(), tl: tlOf(timeline.final()) }))));
  assert.equal(root.getAttribute("data-kind"), "call");
  assert.equal(root.querySelector(".sc-final").hidden, true);
  inDoc(doc, () => component.update(vmOf(state.final())));
  assert.equal(root.getAttribute("data-kind"), "offfield");
  for (const sel of [".sc-call", ".sc-recap", ".sc-final"]) assert.equal(root.querySelector(sel).hidden, true, sel);
  assert.equal(root.querySelector(".sc-board-spoken").textContent, "", "the off-field copy is read where it stands");
});
