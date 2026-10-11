// static/js/report/ui/head.js and ui/framed.js: the ribbon's live part (who, the game, the score with LED logos, the
// status lamp, one polite line for news), and the frame that hangs an app board (scorecard, tendencies, win
// probability, drives, team stats) under a report plate without touching the board itself.
import assert from "node:assert/strict";
import test from "node:test";
import { headVm } from "../../../static/js/report/model/vm-head.js";
import { boxVm } from "../../../static/js/model/vm-box.js";
import { framed } from "../../../static/js/report/ui/framed.js";
import { mount as mountHead } from "../../../static/js/report/ui/head.js";
import * as BoxScore from "../../../static/js/ui/box-score.js";
import { all, fakeCtx, inDoc, makePv, one, regionRoot, state, text, timeline, tlOf } from "../game-surfaces-harness.mjs";
import { readFixture } from "../model-fixtures.mjs";

test("the ribbon: who, the game, both teams with logo windows and scores, the status lamp", () => inDoc((doc) => {
  const root = regionRoot(doc, { id: "rp-head-live", tag: "div" });
  const head = mountHead(root, fakeCtx().ctx);
  head.update(headVm(makePv({ presented: state.final(), tl: tlOf(timeline.final()) })));
  assert.equal(text(one(root, ".rp-who")), "Shadowing Schottenheimer · DAL");
  assert.equal(text(one(root, ".rp-game")), "Buccaneers at Cowboys, Thursday Night Football, Oct 8");
  const teams = all(root, ".rp-team");
  assert.deepEqual(teams.map((t) => [t.getAttribute("data-team"), t.getAttribute("data-caller"), text(one(t, ".rp-abbr")),
    text(one(t, ".rp-team-score"))]), [["TB", "false", "TB", "24"], ["DAL", "true", "DAL", "16"]]);
  const logo = one(teams[0], "img");
  assert.deepEqual([logo.getAttribute("src"), logo.getAttribute("alt")], ["/api/logo/TB", ""],
    "no world asks for the dark-background logos here (a world's --sc-logo-variant does)");
  const status = one(root, ".rp-status");
  assert.deepEqual([status.getAttribute("data-tone"), text(one(status, ".rp-status-text"))], ["final", "Final"]);
  assert.equal(text(one(root, ".rp-news")), "TB 24, DAL 16. Final.");
  assert.equal(one(root, ".rp-news").getAttribute("aria-live"), "polite");
}));

test("the ribbon follows a watch: the clock ticks on screen while the news line holds", () => inDoc((doc) => {
  const root = regionRoot(doc, { id: "rp-head-live", tag: "div" });
  const head = mountHead(root, fakeCtx().ctx);
  const version = readFixture("version_watch_playing.json");
  head.update(headVm(makePv({ presented: state.final(), tl: tlOf(timeline.at104()), version })));
  const logo = one(root, "img");
  assert.equal(text(one(root, ".rp-status-text")), "Watching at 4x · Q3 10:51");
  assert.equal(text(one(root, ".rp-news")), "TB 14, DAL 10. Watching at 4x.");
  head.update(headVm(makePv({ presented: state.final(), tl: tlOf(timeline.final()) })));
  assert.equal(one(root, "img"), logo, "the logo windows are kept");
  head.update(headVm(makePv()));
  assert.equal(all(root, ".rp-team").length, 0);
}));

test("a framed board: the report's plate over the app's own component, its own title out of the way", () => inDoc((doc) => {
  const root = regionRoot(doc, { id: "rp-box" });
  const plate = root.appendChild(doc.createElement("h2"));
  plate.setAttribute("class", "rp-plate");
  const mod = framed(BoxScore, { plate: (vm) => vm.heading, testid: "report-box" });
  const board = mod.mount(root, fakeCtx().ctx);
  board.update(boxVm(makePv({ presented: state.final(), tl: tlOf(timeline.final()) })));
  assert.equal(text(one(root, ".rp-plate")), "Team stats");
  assert.equal(all(root, ".rp-plate").length, 1);
  const face = one(root, ".rp-face");
  assert.equal(face.getAttribute("data-testid"), "report-box");
  assert.ok(one(face, '[data-testid="box-score"]'), "the app's table lives in the face");
  board.destroy();
  assert.equal(all(root, '[data-testid="box-score"]').length, 0);
}));

test("the logo a world asks for, and a logo that fails gives way to the team's abbreviation", () => inDoc((doc) => {
  doc.defaultView = { getComputedStyle: () => ({ getPropertyValue: () => " dark" }) };
  const root = regionRoot(doc, { id: "rp-head-live", tag: "div" });
  const head = mountHead(root, fakeCtx().ctx);
  head.update(headVm(makePv({ presented: state.final(), tl: tlOf(timeline.final()) })));
  const img = one(root, "img");
  assert.equal(img.getAttribute("src"), "/api/logo/TB?v=dark");
  img.dispatchEvent({ type: "error" });
  assert.equal(img.hidden, true);
  head.update(headVm(makePv({ presented: state.final(), tl: tlOf(timeline.final()) })));
  assert.equal(img.hidden, true, "a logo that failed stays out");
  assert.equal(text(one(root, ".rp-abbr")), "TB");
}));

test("framed refuses a module with no mount()", () => {
  assert.throws(() => framed({}, { plate: () => "" }), /mount/);
});
