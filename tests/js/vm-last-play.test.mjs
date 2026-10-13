// model/vm-last-play.js: the card's PREVIOUS PLAY and LAST 6 (restructure-v2.md section 3), folded in from the
// last-play panel and the board's recap face. predictionVm's tests cover them on every game state; these pin the
// parts on their own. The panel's retag keys are gone with it (no user input into the game).
import test from "node:test";
import assert from "node:assert/strict";
import { metricsOf } from "../../static/js/model/sides.js";
import { previousOf, previousSpoken, recentOf } from "../../static/js/model/vm-last-play.js";
import { makePv, state, timeline, tlOf, patch } from "./model-fixtures.mjs";

const PLATE = "Schottenheimer so far";
const tallyWords = (recent) => recent.tally.map((t) => `${t.label} ${t.value}`);

/**
 * A night with a sack in it, in the engine's own row shapes (made from Schottenheimer's real rows, the way Coen's
 * first four calls at PHI v JAX went): a miss, his #3, a miss a flag wiped out, then a sack. A sack has no specific
 * play (the called route's depth is unknown, live_calls.py), so it is graded on its play type only (dropback, the
 * board's top type here): it is one of his calls and takes a snap number, but it is never in the specific-play
 * counts (leaf_n). Its scorecard is live.py's over these rows (sides.js metricsOf). `flag: false` leaves the wiped-out
 * call out.
 */
function sackNight({ flag = true } = {}) {
  const log = state.final().log;
  const find = (match) => log.find((r) => match(r));
  const miss = find((r) => !r.nullified && r.leaf_rank > 3);
  const third = find((r) => !r.nullified && r.leaf_rank === 3);
  const wiped = find((r) => r.nullified && r.leaf_rank > 3);
  const pass = find((r) => !r.nullified && r.family === "dropback" && r.fam_top === "dropback" && !r.td && !r.turnover);
  const sack = { ...pass, leaf: null, depth: null, leaf_p: null, leaf_p_league: null, leaf_rank: null,
    leaf_rank_league: null, outcome: "sack", call: "S", name: "Dropback pass, sack", yards: -7, feed_text: null };
  const oldest = flag ? [miss, third, wiped, sack] : [miss, third, sack];
  const rows = oldest.map((r, i) => {
    const before = oldest.slice(0, i).filter((x) => !x.nullified).length;   // a wiped-out call keeps the next number
    return { ...r, seq: i + 1, snap: before + 1, espn_id: null };
  }).reverse();
  return patch(state.final(), { log: rows, metrics: metricsOf(rows) });
}

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

// ---------------------------------------------------------------- a call graded on its play type only
test("a sack is his call and his snap but not a specific play: LAST 6 marks it apart and the note counts every call",
  () => {
    const presented = sackNight();
    assert.deepEqual(presented.log.map((r) => [r.seq, r.snap, r.nullified, r.leaf_rank]),
      [[4, 3, false, null], [3, 3, true, presented.log[1].leaf_rank], [2, 2, false, 3],
        [1, 1, false, presented.log[3].leaf_rank]], "the night as the engine logs it");
    const prev = previousOf(makePv({ presented }));
    assert.deepEqual([prev.snap.text, prev.label, prev.verdict.key, prev.verdict.text],
      ["Snap 3", "Dropback pass, sack", "top1", "Top pick · play type only"],
      "the field's verdict on its play type, saying so beside a tally that counts specific plays");
    assert.equal(previousSpoken(prev), "Previous play, snap 3: Dropback pass, sack. Top pick, play type only.");
    const recent = recentOf(presented, PLATE);
    assert.deepEqual(recent.items.map((i) => [i.key, i.level]),
      [["miss", "leaf"], ["top3", "leaf"], ["miss", "leaf"], ["top1", "family"]],
      "the sack's check is its play type's");
    assert.equal(recent.aria, "Last 6: Miss, In his top 3 (#3), Miss, Top pick (play type only)");
    assert.deepEqual(tallyWords(recent), ["Top pick 0 of 3", "In his top 3 1 of 3"],
      "the scorecard's specific-play counts: the sack is not in them");
    assert.equal(recent.note, "4 calls: 3 snaps and 1 wiped out; 1 graded on play type only",
      "his 4 calls, his 3 snap numbers, and why the tally counts 3");
  });

test("with no flag the note still says why the tally counts fewer calls than his snap number", () => {
  const recent = recentOf(sackNight({ flag: false }), PLATE);
  assert.deepEqual(tallyWords(recent), ["Top pick 0 of 2", "In his top 3 1 of 2"]);
  assert.equal(recent.note, "3 calls: 1 graded on play type only");
  assert.deepEqual(recent.items.map((i) => i.level), ["leaf", "leaf", "family"]);
});

test("his first call a sack: no specific play yet, so no tally, but the note and the mark say what it was", () => {
  const night = sackNight({ flag: false });
  const presented = patch(night, { log: night.log.slice(0, 1), metrics: metricsOf(night.log.slice(0, 1)) });
  const recent = recentOf(presented, PLATE);
  assert.deepEqual(recent.tally, [], "nothing graded on a specific play yet");
  assert.deepEqual(recent.items.map((i) => [i.key, i.level, i.text]),
    [["top1", "family", "Top pick (play type only)"]]);
  assert.equal(recent.note, "1 call: 1 graded on play type only");
});
