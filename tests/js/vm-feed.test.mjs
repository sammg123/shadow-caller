import test from "node:test";
import assert from "node:assert/strict";
import { feedVm, feedOf, inputMode } from "../../static/js/model/vm-feed.js";
import { makePv, state, patch, isDeepFrozen } from "./model-fixtures.mjs";

const textOf = (vm) => vm.status.map((s) => s.text).join("");
const strongOf = (vm) => vm.status.filter((s) => s.strong).map((s) => s.text);
const withFeed = (feed) => patch(state.final(), { feed: { ...state.final().feed, ...feed } });

test("feed off (FI 3.2)", () => {
  const vm = feedVm(makePv({ presented: state.final() }));
  assert.deepEqual([vm.on, vm.state, vm.buttonText, vm.eventId], [false, "off", "ESPN live: off", "401872980"]);
  assert.equal(textOf(vm), "Off: enter plays by hand, or turn it on and plays log themselves.");
  assert.deepEqual(strongOf(vm), []);
});

test("feed live: updated time and the last ESPN play (#94)", () => {
  const vm = feedVm(makePv({ presented: state.feedOn() }));
  assert.deepEqual([vm.on, vm.state, vm.buttonText], [true, "live", "ESPN live: on"]);
  assert.equal(textOf(vm), "Updated 03:22:28 · Last: END GAME");
  assert.deepEqual(strongOf(vm), ["Last:"]);
});

test("the version poll's feed is fresher than the state's (Appendix A, #95)", () => {
  const version = { version: 329, feed: { ...state.feedOn().feed, last_poll: "03:23:00" } };
  const vm = feedVm(makePv({ presented: state.feedOn(), version }));
  assert.equal(textOf(vm), "Updated 03:23:00 · Last: END GAME");
  assert.equal(vm.eventId, "401872980");
});

test("the last play and a skipped play come from the presented state, never ahead of the ball (decision 2)", () => {
  const presented = withFeed({ on: true, state: "live", last_poll: "03:22:28", last_play: "END GAME", skipped: null });
  const version = { version: 330, feed: { on: true, state: "live", last_poll: "03:23:00", plays_logged: 99,
    last_play: "D.Prescott pass INTERCEPTED by A.Winfield", skipped: "J.Daniels pass (no spot)" } };
  const vm = feedVm(makePv({ presented, version }));
  assert.equal(textOf(vm), "Updated 03:23:00 · Last: END GAME", "the poll time is fresh; the play is the drawn one");
  assert.equal(feedOf(makePv({ presented, version })).plays_logged, presented.feed.plays_logged);
  assert.equal(textOf(feedVm(makePv({ version }))), "Updated 03:23:00", "nothing presented yet: no play text at all");
});

test("starting with no poll yet, and a skipped play to enter by hand (#102)", () => {
  const vm = feedVm(makePv({ presented: withFeed({ on: true, state: "starting", last_poll: null, last_play: null,
    skipped: "J.Daniels pass (no spot)" }) }));
  assert.equal(textOf(vm), "Updated … · Skipped, enter it by hand: J.Daniels pass (no spot)");
  assert.deepEqual(strongOf(vm), ["Skipped, enter it by hand:"]);
});

test("feed error says it keeps trying (#101)", () => {
  const vm = feedVm(makePv({ presented: withFeed({ on: true, state: "error", detail: "HTTP 404" }) }));
  assert.deepEqual([vm.state, vm.buttonText], ["retrying", "ESPN live: retrying"]);
  assert.equal(textOf(vm), "Can't reach ESPN (HTTP 404). Still trying every few seconds.");
});

test("a skipped note never shows with the feed off", () => {
  const vm = feedVm(makePv({ presented: withFeed({ on: false, skipped: "x" }) }));
  assert.equal(textOf(vm), "Off: enter plays by hand, or turn it on and plays log themselves.");
});

test("watch start shows only when the server can watch and no session runs", () => {
  const show = (watch) => feedVm(makePv({ presented: state.final(), version: watch ? { watch } : null })).watchStartVisible;
  assert.equal(show(null), false);
  assert.equal(show({ state: "idle" }), true);
  assert.equal(show({ state: "done" }), true);
  assert.equal(show({ state: "playing" }), false);
  assert.equal(show({ state: "paused" }), false);
});

test("background messages from the feed go to the polite region (G12)", () => {
  const vm = feedVm(makePv({ presented: state.final(), view: { bgMessage: { text: "Drive 3 started (ESPN).", at: 1 } } }));
  assert.equal(vm.bgMessage, "Drive 3 started (ESPN).");
  assert.equal(feedVm(makePv({ presented: state.final() })).bgMessage, "");
});

test("feedOf merges version over state; inputMode orders watch, then feed, then manual", () => {
  assert.equal(feedOf(makePv()).on, false);
  assert.equal(inputMode(makePv({ presented: state.final() })), "manual");
  assert.equal(inputMode(makePv({ presented: state.feedOn() })), "feed");
  assert.equal(inputMode(makePv({ presented: state.feedOn(), version: { watch: { state: "playing" } } })), "watch");
  assert.equal(inputMode(makePv({ presented: state.final(), version: { watch: { state: "stopped" } } })), "manual");
});

test("nothing presented yet: feed off, deep-frozen", () => {
  const vm = feedVm(makePv());
  assert.deepEqual([vm.on, vm.state, vm.eventId], [false, "off", ""]);
  assert.ok(isDeepFrozen(vm));
});
