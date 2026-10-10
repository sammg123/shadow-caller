// ui/scoreboard.js (ui-architecture 2.6, 5.4; owner A8): the game's scoreboard from scoreboardVm.
import assert from "node:assert/strict";
import test from "node:test";
import { scoreboardVm } from "../../static/js/model/vm-scoreboard.js";
import { mount } from "../../static/js/ui/scoreboard.js";
import { all, fakeCtx, inDoc, makePv, one, patch, regionRoot, state, text, timeline, tlOf } from "./game-surfaces-harness.mjs";

const espnVm = (body, presented = state.final()) => scoreboardVm(makePv({ presented, tl: tlOf(body) }));
const team = (root, abbr) => one(root, `[data-team="${abbr}"]`);
const fact = (root, key) => text(one(one(root, `[data-fact="${key}"]`), ".sc-sb-value"));

function setup(doc) {
  const root = regionRoot(doc, { id: "rg-scoreboard" });
  const { ctx } = fakeCtx();
  return { root, sb: mount(root, ctx) };
}

test("the final whistle: both teams away then home, scores, Q4 0:00, Final, timeouts left (5.4 hooks)", () => inDoc((doc) => {
  const { root, sb } = setup(doc);
  sb.update(espnVm(timeline.final()));
  const board = one(root, '[data-testid="scoreboard"]');
  assert.deepEqual([board.getAttribute("data-state"), board.getAttribute("data-poss")], ["post", ""]);
  const scores = all(root, '[data-testid="team-score"]');
  assert.deepEqual(scores.map((s) => [s.getAttribute("data-team"), text(s)]), [["TB", "24"], ["DAL", "16"]]);
  assert.equal(text(one(root, '[data-testid="game-clock"]')), "0:00");
  assert.equal(fact(root, "qtr"), "Q4");
  assert.equal(one(root, ".sc-sb-final").hidden, false);
  assert.equal(text(one(team(root, "TB"), ".sc-sb-name")), "Buccaneers");
  assert.equal(one(team(root, "DAL"), ".sc-sb-tos").getAttribute("aria-label"), "1 timeout left");
  assert.deepEqual(all(team(root, "TB"), ".sc-sb-to").map((l) => l.getAttribute("data-on")), ["true", "true", "false"]);
  assert.equal(team(root, "DAL").getAttribute("data-caller"), "true");
}));

test("logos are the app's own proxy URLs with alt text; the monogram stands in when there is none", () => inDoc((doc) => {
  const { root, sb } = setup(doc);
  sb.update(espnVm(timeline.final()));
  const logos = all(root, '[data-testid="team-logo"]');
  assert.deepEqual(logos.map((img) => [img.getAttribute("src"), img.getAttribute("alt"), img.hidden]),
    [["/api/logo/TB", "Buccaneers logo", false], ["/api/logo/DAL", "Cowboys logo", false]]);
  sb.update(scoreboardVm(makePv({ presented: state.tilt() })));
  const img = one(team(root, "DAL"), "img");
  assert.equal(img.hidden, true);
  assert.equal(img.hasAttribute("src"), false);
  assert.equal(text(one(team(root, "DAL"), ".sc-sb-mono")), "DAL");
}));

test("a logo that fails to load gives way to the monogram, and is not retried until its URL changes", () => inDoc((doc) => {
  const { root, sb } = setup(doc);
  const vm = espnVm(timeline.final());
  sb.update(vm);
  const img = one(team(root, "TB"), "img");
  img.dispatchEvent({ type: "error" });
  assert.equal(img.hidden, true);
  assert.equal(team(root, "TB").getAttribute("data-logo"), "failed");
  sb.update(espnVm(timeline.at104()));
  assert.equal(img.hidden, true, "the same URL stays failed");
}));

test("the world can ask for ESPN's dark-background logos (--sc-logo-variant: dark)", () => inDoc((doc) => {
  doc.defaultView = { getComputedStyle: () => ({ getPropertyValue: (name) => (name === "--sc-logo-variant" ? " dark" : "") }) };
  const { root, sb } = setup(doc);
  sb.update(espnVm(timeline.final()));
  assert.deepEqual(all(root, '[data-testid="team-logo"]').map((img) => img.getAttribute("src")),
    ["/api/logo/TB?v=dark", "/api/logo/DAL?v=dark"]);
}));

// v1.5 (G4-11): reading the variant forces a style recalc, so it is read once per world and room-lights setting
test("the logo variant is read once per world and room setting, not on every update (G4-11)", () => inDoc((doc) => {
  let reads = 0;
  doc.defaultView = { getComputedStyle: () => {
    reads += 1;
    return { getPropertyValue: (name) => (name === "--sc-logo-variant" ? (reads > 1 ? "dark" : "") : "") };
  } };
  doc.documentElement.setAttribute("data-world", "neutral");
  doc.documentElement.setAttribute("data-ambient", "room");
  const { root, sb } = setup(doc);
  for (let i = 0; i < 5; i += 1) sb.update(espnVm(i % 2 ? timeline.final() : timeline.at104()));
  assert.equal(reads, 1, "five updates, one read");
  assert.equal(one(team(root, "TB"), "img").getAttribute("src"), "/api/logo/TB");
  doc.documentElement.setAttribute("data-ambient", "dark");
  sb.update(espnVm(timeline.final()));
  assert.equal(reads, 2, "room lights changed: read again");
  assert.equal(one(team(root, "TB"), "img").getAttribute("src"), "/api/logo/TB?v=dark");
  sb.update(espnVm(timeline.final()));
  doc.documentElement.setAttribute("data-world", "under-the-lights");
  sb.update(espnVm(timeline.final()));
  assert.equal(reads, 3, "another world: read again");
}));

test("after the interception TB has the ball at its 25: possession lamp, down and ball on", () => inDoc((doc) => {
  const { root, sb } = setup(doc);
  sb.update(espnVm(timeline.at104()));
  assert.equal(one(root, '[data-testid="scoreboard"]').getAttribute("data-poss"), "TB");
  assert.deepEqual([team(root, "TB").getAttribute("data-poss"), team(root, "DAL").getAttribute("data-poss")], ["true", "false"]);
  assert.equal(text(one(team(root, "TB"), ".sc-sb-poss")), "has the ball");
  assert.equal(text(one(team(root, "DAL"), ".sc-sb-poss")), "");
  assert.equal(fact(root, "down"), "1st & 10");
  assert.equal(fact(root, "ball"), "TB 25");
  assert.equal(one(root, ".sc-sb-final").hidden, true);
}));

test("hand-entered games: no timeouts known, an estimated clock is flagged", () => inDoc((doc) => {
  const { root, sb } = setup(doc);
  const tilt = state.tilt();
  sb.update(scoreboardVm(makePv({ presented: patch(tilt, { sit: { ...tilt.sit, clock_estimated: true } }) })));
  assert.equal(one(team(root, "DAL"), ".sc-sb-tos").hidden, true);
  const est = one(root, ".sc-sb-est");
  assert.deepEqual([est.hidden, text(est)], [false, "est."]);
  assert.equal(one(root, '[data-testid="scoreboard"]').getAttribute("data-source"), "log");
}));

test("updates keep the team nodes; destroy removes the board", () => inDoc((doc) => {
  const { root, sb } = setup(doc);
  sb.update(espnVm(timeline.at104()));
  const before = team(root, "TB");
  sb.update(espnVm(timeline.final()));
  assert.equal(team(root, "TB"), before);
  sb.update(scoreboardVm(makePv()));
  assert.equal(all(root, '[data-testid="team-score"]').length, 0, "nothing presented: no teams");
  sb.destroy();
  assert.equal(root.childNodes.length, 0);
}));
