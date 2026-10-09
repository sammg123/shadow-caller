import test from "node:test";
import assert from "node:assert/strict";
import { makePv, state, timeline, tlOf, patch, isDeepFrozen } from "./model-fixtures.mjs";

// Every view model (ui-architecture 2.3).
const VMS = [
  ["vm-masthead.js", "mastheadVm"], ["vm-feed.js", "feedVm"], ["vm-prediction.js", "predictionVm"],
  ["vm-last-play.js", "lastPlayVm"], ["vm-scorecard.js", "scorecardVm"], ["vm-tendencies.js", "tendenciesVm"],
  ["vm-log.js", "logVm"], ["vm-scoreboard.js", "scoreboardVm"], ["vm-plays.js", "playsVm"],
  ["vm-drives.js", "drivesVm"], ["vm-wp.js", "wpVm"], ["vm-box.js", "boxVm"], ["vm-transport.js", "transportVm"],
  ["vm-review.js", "reviewVm"], ["vm-situation.js", "situationVm"], ["vm-entry.js", "entryVm"],
  ["vm-flags.js", "flagsVm"], ["vm-field.js", "fieldVm"], ["vm-conn.js", "connVm"], ["vm-conn.js", "bootVm"],
];

const EMPTY_TL = { rows: [], drives: [], status: null, box: null, unlinked: [], wpStart: null, teams: null, field: null,
  meta: null };

// States the screen really meets: boot before anything loads, an old server (no keys, no timeline), a new epoch
// with nothing drawn yet, a timeline that arrived before the state, a watch in progress, a review of a past play.
const STATES = [
  ["nothing loaded", () => makePv()],
  ["old server without keys or timeline", () => makePv({ presented: patch(state.final(), { keys: undefined }) })],
  ["new epoch, nothing drawn", () => makePv({ presented: state.drive(), tl: EMPTY_TL })],
  ["timeline before state", () => makePv({ tl: tlOf(timeline.at104()) })],
  ["watch paused mid-game", () => makePv({ presented: state.final(), tl: tlOf(timeline.at104()),
    version: { version: 1, feed: { on: false }, watch: { state: "paused", idx: 104, total: 183, speed: 4 } } })],
  ["reviewing with a pick and the flag panel open", () => makePv({ presented: state.tilt(), tl: tlOf(timeline.final()),
    view: { review: { seq: 104 }, pick: { k: "O", i: 1, out: "incomplete" }, flag: { open: true, gen: 2 } } })],
];

for (const [file, name] of VMS) {
  test(`${name} survives every partial state and returns frozen data`, async () => {
    const vm = (await import(`../../static/js/model/${file}`))[name];
    for (const [label, build] of STATES) {
      const pv = build();
      const out = vm(pv);
      assert.ok(out && typeof out === "object", `${name}: ${label}`);
      assert.ok(isDeepFrozen(out), `${name} output frozen: ${label}`);
      assert.ok(isDeepFrozen(pv), `${name} input untouched: ${label}`);
    }
  });
}
