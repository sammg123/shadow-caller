// model/vm-last-play.js: the card's PREVIOUS PLAY and LAST 6 (restructure-v2.md section 3), folded in from the
// last-play panel and the board's recap face. predictionVm's tests cover them on every game state; these pin the
// parts on their own. The panel's retag keys are gone with it (no user input into the game).
import test from "node:test";
import assert from "node:assert/strict";
import { previousOf, previousSpoken, recentOf } from "../../static/js/model/vm-last-play.js";
import { makePv, state, timeline, tlOf, patch } from "./model-fixtures.mjs";

const PLATE = "Schottenheimer so far";

test("no previous play and no last six before his first snap; nothing to say either", () => {
  const presented = patch(state.final(), { log: [], metrics: { n: 0 } });
  assert.equal(previousOf(makePv({ presented })), null);
  assert.equal(previousOf(makePv()), null);
  assert.equal(recentOf(presented, PLATE), null);
  assert.equal(recentOf(null, PLATE), null);
  assert.equal(previousSpoken(null), "");
});

test("the previous play keeps ESPN's own words for its tooltip, and the field's for its label", () => {
  const prev = previousOf(makePv({ presented: state.feedOn(), tl: tlOf(timeline.final()) }));
  assert.equal(prev.espn, state.feedOn().log[0].feed_text);
  assert.equal(prev.label, "Pass intercepted · short middle");
  const typed = previousOf(makePv({ presented: patch(state.final(), { log: [{ seq: 3, name: "Screen", yards: 6,
    feed_text: null }] }) }));
  assert.deepEqual([typed.label, typed.espn], ["Screen", ""]);
});

test("his night so far stands even when no call carries a grade", () => {
  const presented = patch(state.final(), { log: [{ seq: 1, call: "P", yards: 3 }] });
  const recent = recentOf(presented, PLATE);
  assert.deepEqual([recent.plate, recent.label, recent.items.length, recent.aria], [PLATE, "Last 6", 0, ""]);
  assert.deepEqual(recent.tally.map((t) => t.id), ["top1", "top3"]);
});
