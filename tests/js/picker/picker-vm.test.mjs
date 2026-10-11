// The game picker's view model (static/js/picker/picker-vm.js; docs/design/game-picker.md): the week list, the team
// filter, the chosen game's sides and the pasted game link, from GET /api/games and the panel's own state. Pure.
import assert from "node:assert/strict";
import test from "node:test";
import { FIND_ID_HELP, INITIAL, REF_MAX, pickerReduce, pickerVm, selectionOf } from "../../../static/js/picker/picker-vm.js";

const SCHOTT = Object.freeze({ name: "Brian Schottenheimer", role: "HC", model: true });
const team = (abbr, name, short, score = null, caller = null) => ({ abbr, nflverse: abbr, name, short, score, caller });
const game = (over = {}) => ({
  event_id: "401872980", season: 2026, season_type: 2, week: 5, game_id: "2026_05_TB_DAL",
  kickoff: "2026-10-09T00:15:00Z", time_valid: true, neutral: false, status: "post", detail: "Final", completed: true,
  clock: null, period: null, away: team("TB", "Tampa Bay Buccaneers", "Buccaneers", 24),
  home: team("DAL", "Dallas Cowboys", "Cowboys", 16, SCHOTT), ...over,
});
const LONDON = game({ event_id: "401872981", game_id: "2026_05_PHI_JAX", kickoff: "2026-10-11T13:30:00Z", neutral: true,
  status: "pre", detail: "10/11 - 9:30 AM EDT", completed: false, away: team("PHI", "Philadelphia Eagles", "Eagles"),
  home: team("JAX", "Jacksonville Jaguars", "Jaguars") });
const LIVE = game({ event_id: "401872990", game_id: "2026_05_CHI_GB", kickoff: "2026-10-11T17:00:00Z", status: "in",
  detail: "12:34 - 2nd", completed: false, clock: "12:34", period: 2, away: team("CHI", "Chicago Bears", "Bears", 3),
  home: team("GB", "Green Bay Packers", "Packers", 7) });
const WEEK6_DAL = game({ event_id: "401873001", week: 6, game_id: "2026_06_DAL_WAS", kickoff: "2026-10-18T20:25:00Z",
  status: "pre", detail: "10/18 - 4:25 PM EDT", completed: false, away: team("DAL", "Dallas Cowboys", "Cowboys", null,
    SCHOTT), home: team("WSH", "Washington Commanders", "Commanders") });
const week = (n, games, over = {}) => ({ key: `2-${n}`, season_type: 2, week: n, label: `Week ${n}`,
  detail: { 4: "Sep 30-Oct 6", 5: "Oct 7-13", 6: "Oct 14-20" }[n], current: n === 5, stale: false, error: null, games,
  ...over });
const DATA = Object.freeze({ season: 2026, current: "2-5", offline: false,
  weeks: [week(5, [game(), LONDON, LIVE]), week(4, [game({ event_id: "401872964", week: 4 })]), week(6, [WEEK6_DAL])] });
const NY = { timeZone: "America/New_York" };
const loaded = (over = {}) => ({ ...pickerReduce(INITIAL, { type: "loaded", data: DATA }), open: true, ...over });
const rowsOf = (vm, i = 0) => vm.weeks[i].games;

function isDeepFrozen(value) {
  if (value === null || typeof value !== "object") return true;
  return Object.isFrozen(value) && Object.values(value).every(isDeepFrozen);
}

test("this week comes first and open; every game is a row with its matchup, score and status", () => {
  const vm = pickerVm(loaded(), NY);
  assert.deepEqual(vm.weeks.map((w) => [w.key, w.title, w.detail, w.open]), [
    ["2-5", "This week · Week 5", "Oct 7-13", true], ["2-4", "Week 4", "Sep 30-Oct 6", false],
    ["2-6", "Week 6", "Oct 14-20", false]]);
  const [final, london, live] = rowsOf(vm);
  assert.deepEqual([final.kind, final.matchup, final.status, final.away.score, final.home.score],
    ["final", "TB at DAL", "Final", "24", "16"]);
  assert.deepEqual([london.kind, london.matchup, london.status, london.away.score], ["upcoming", "PHI vs JAX",
    "Sun 9:30 AM", ""]);
  assert.deepEqual([live.kind, live.status, live.away.score, live.home.score], ["live", "Live · Q2 12:34", "3", "7"]);
  assert.equal(final.label, "Tampa Bay Buccaneers 24 at Dallas Cowboys 16. Final.");
  assert.equal(london.label, "Philadelphia Eagles vs Jacksonville Jaguars. Sun 9:30 AM.");
  assert.equal(live.label, "Chicago Bears 3 at Green Bay Packers 7. Live · Q2 12:34.");
  assert.equal(final.caller, "Shadow: Schottenheimer (DAL)", "a row says whose calls it can shadow");
  assert.equal(london.caller, null);
});

test("kickoff times are the viewer's own; a time ESPN hasn't set says TBD", () => {
  const la = pickerVm(loaded(), { timeZone: "America/Los_Angeles" });
  assert.equal(rowsOf(la)[1].status, "Sun 6:30 AM");
  const tbd = { ...DATA, weeks: [week(5, [{ ...LONDON, time_valid: false }])] };
  assert.equal(rowsOf(pickerVm(loaded({ data: tbd }), NY))[0].status, "Time TBD");
  const bad = { ...DATA, weeks: [week(5, [{ ...LONDON, kickoff: "soon" }])] };
  assert.equal(rowsOf(pickerVm(loaded({ data: bad }), NY))[0].status, "10/11 - 9:30 AM EDT", "ESPN's own words");
});

test("live games read like the scoreboard: halftime, overtime; postponed and final in overtime keep ESPN's words", () => {
  const rows = (games) => rowsOf(pickerVm(loaded({ data: { ...DATA, weeks: [week(5, games)] } }), NY));
  const [half, ot, postponed, finalOt] = rows([{ ...LIVE, clock: null, detail: "Halftime" },
    { ...LIVE, event_id: "1", clock: "3:12", period: 5 }, { ...LONDON, event_id: "2", status: "post", detail: "Postponed" },
    { ...game(), event_id: "3", detail: "Final/OT" }]);
  assert.deepEqual([half.kind, half.status], ["live", "Live · Halftime"]);
  assert.equal(ot.status, "Live · OT 3:12");
  assert.deepEqual([postponed.kind, postponed.status, postponed.away.score], ["off", "Postponed", ""]);
  assert.deepEqual([finalOt.kind, finalOt.status], ["final", "Final/OT"]);
});

test("the team filter keeps that team's games and opens every week that has one", () => {
  const vm = pickerVm(loaded({ filter: "DAL" }), NY);
  assert.deepEqual(vm.weeks.map((w) => [w.key, w.open, w.games.map((g) => g.id)]), [
    ["2-5", true, ["401872980"]], ["2-4", true, ["401872964"]], ["2-6", true, ["401873001"]]]);
  assert.deepEqual(vm.filter.options.slice(0, 3), [{ value: "", label: "All teams" },
    { value: "CHI", label: "Chicago Bears" }, { value: "DAL", label: "Dallas Cowboys" }]);
  assert.equal(vm.filter.options.length, 8, "each team once");
  assert.equal(vm.filter.value, "DAL");
  const none = pickerVm(loaded({ filter: "KC" }), NY);
  assert.deepEqual([none.weeks.length, none.empty], [0, "No games for that team in this list."]);
});

test("a week the user opened or closed stays that way", () => {
  let ui = loaded();
  ui = pickerReduce(ui, { type: "toggleWeek", key: "2-6", open: true });
  ui = pickerReduce(ui, { type: "toggleWeek", key: "2-5", open: false });
  assert.deepEqual(pickerVm(ui, NY).weeks.map((w) => w.open), [false, false, true]);
});

test("picking a game shows both sides with their play-callers; the side with a model is chosen", () => {
  const vm = pickerVm(pickerReduce(loaded(), { type: "pick", game: game() }), NY);
  const { chosen } = vm;
  assert.deepEqual([chosen.id, chosen.title, chosen.sub], ["401872980", "Buccaneers at Cowboys",
    "Week 5 · Final · TB 24, DAL 16"]);
  assert.deepEqual(chosen.sides.map((s) => [s.abbr, s.team, s.caller, s.checked, s.disabled]), [
    ["TB", "Tampa Bay Buccaneers", null, false, true], ["DAL", "Dallas Cowboys", "Brian Schottenheimer (HC)", true,
      false]]);
  assert.deepEqual(chosen.sides.map((s) => s.note), ["Not in the play-caller table yet.", "Model ready."]);
  assert.deepEqual([chosen.both.checked, chosen.both.disabled], [false, true]);
  assert.equal(chosen.both.note, "Needs a play-caller model on both sides.");
  assert.deepEqual([chosen.go.disabled, chosen.go.label, chosen.go.hint], [false, "Open this game",
    "Finished: opens paused at kickoff."]);
  assert.deepEqual(selectionOf(pickerReduce(loaded(), { type: "pick", game: game() })),
    { event_id: "401872980", sides: ["DAL"] });
  assert.equal(rowsOf(vm)[0].picked, true);
});

test("with a model on each side: one side by default, both when ticked, the chosen one back when unticked", () => {
  const both = game({ away: team("TB", "Tampa Bay Buccaneers", "Buccaneers", 24, { name: "Tampa Caller", role: "OC",
    model: true }) });
  let ui = pickerReduce(loaded(), { type: "pick", game: both });
  assert.deepEqual(selectionOf(ui), { event_id: "401872980", sides: ["DAL"] }, "home first when both are ready");
  ui = pickerReduce(ui, { type: "side", abbr: "TB" });
  assert.deepEqual(selectionOf(ui).sides, ["TB"]);
  ui = pickerReduce(ui, { type: "both", on: true });
  assert.deepEqual(selectionOf(ui).sides, ["TB", "DAL"]);
  const vm = pickerVm(ui, NY);
  assert.deepEqual([vm.chosen.both.checked, vm.chosen.both.disabled, vm.chosen.sides.every((s) => s.checked)],
    [true, false, true]);
  assert.equal(vm.chosen.both.label, "Track both sides (separate stats)");
  assert.equal(pickerReduce(ui, { type: "side", abbr: "DAL" }), ui, "a side can't be picked while both are tracked");
  ui = pickerReduce(ui, { type: "both", on: false });
  assert.deepEqual(selectionOf(ui).sides, ["TB"]);
  assert.equal(pickerReduce(ui, { type: "side", abbr: "KC" }), ui, "a team not in the game is ignored");
});

test("no model on either side: Open is off and says why; live and upcoming games say how they open", () => {
  const vm = pickerVm(pickerReduce(loaded(), { type: "pick", game: LONDON }), NY);
  assert.deepEqual([vm.chosen.go.disabled, vm.chosen.go.hint], [true, "No play-caller model for either team yet."]);
  assert.equal(selectionOf(pickerReduce(loaded(), { type: "pick", game: LONDON })), null);
  const live = { ...LIVE, home: team("GB", "Green Bay Packers", "Packers", 7, SCHOTT) };
  assert.equal(pickerVm(pickerReduce(loaded(), { type: "pick", game: live }), NY).chosen.go.hint, "Live: opens live.");
  const soon = { ...LONDON, home: team("JAX", "Jacksonville Jaguars", "Jaguars", null, SCHOTT) };
  assert.equal(pickerVm(pickerReduce(loaded(), { type: "pick", game: soon }), NY).chosen.go.hint,
    "Not started: opens live and follows it from kickoff.");
  const postponed = { ...soon, status: "post", detail: "Postponed" };
  const off = pickerVm(pickerReduce(loaded(), { type: "pick", game: postponed }), NY).chosen.go;
  assert.deepEqual([off.disabled, off.hint], [true, "Postponed: nothing to open."]);
});

test("a model with no caller name still names the team; back returns to the list", () => {
  let ui = pickerReduce(loaded(), { type: "pick", game: game({ away: team("TB", "Tampa Bay Buccaneers", "Buccaneers",
    24, { name: "Tampa Caller", role: null, model: false }) }) });
  const tb = pickerVm(ui, NY).chosen.sides[0];
  assert.deepEqual([tb.caller, tb.note, tb.disabled], ["Tampa Caller", "No model for this play-caller yet.", true]);
  ui = pickerReduce(ui, { type: "back" });
  assert.equal(pickerVm(ui, NY).chosen, null);
});

test("a pasted link: busy, then the game it found, or the server's reason; the help says where the id is", () => {
  let ui = pickerReduce(loaded(), { type: "refText", text: "espn.com/nfl/game/_/gameId/401872980" });
  ui = pickerReduce(ui, { type: "refBusy" });
  assert.deepEqual(pickerVm(ui, NY).ref, { text: "espn.com/nfl/game/_/gameId/401872980", busy: true, error: null,
    help: FIND_ID_HELP, label: "Paste an ESPN game link or id", button: "Find" });
  assert.equal(FIND_ID_HELP, "Open the game on espn.com. The number after gameId/ in the address is the game id.");
  const failed = pickerReduce(ui, { type: "refFailed", error: "That address isn't on espn.com." });
  assert.deepEqual([pickerVm(failed, NY).ref.busy, pickerVm(failed, NY).ref.error], [false,
    "That address isn't on espn.com."]);
  const found = pickerReduce(ui, { type: "refFound", game: WEEK6_DAL });
  assert.deepEqual([pickerVm(found, NY).chosen.id, pickerVm(found, NY).ref.busy, pickerVm(found, NY).ref.text],
    ["401873001", false, ""]);
  const helped = pickerReduce(ui, { type: "refFailed", error: `That isn't an espn.com game address. ${FIND_ID_HELP}` });
  assert.equal(pickerVm(helped, NY).ref.error, "That isn't an espn.com game address.",
    "the help line is already under the field: the reason doesn't repeat it");
  const typed = pickerReduce(failed, { type: "refText", text: "x".repeat(REF_MAX + 50) });
  assert.deepEqual([typed.ref.text.length, typed.ref.error], [REF_MAX, null], "typing clears the old reason");
});

test("loading, a failed load, a stale or missing week and offline all say so", () => {
  const loading = pickerVm({ ...pickerReduce(INITIAL, { type: "loading" }), open: true }, NY);
  assert.deepEqual([loading.status.text, loading.status.tone, loading.status.retry, loading.weeks.length],
    ["Loading the schedule…", "info", false, 0]);
  const failed = pickerVm({ ...pickerReduce(INITIAL, { type: "loadFailed", error: "Couldn't reach ESPN." }),
    open: true }, NY);
  assert.deepEqual([failed.status.text, failed.status.tone, failed.status.retry], ["Couldn't reach ESPN.", "error",
    true]);
  const refreshFailed = pickerVm(pickerReduce(loaded(), { type: "loadFailed", error: "Couldn't reach ESPN." }), NY);
  assert.equal(refreshFailed.weeks.length, 3, "a failed refresh keeps the list it has");
  const odd = { ...DATA, offline: true, weeks: [week(5, [game()], { stale: true }), week(6, [], { error: "Couldn't get Week 6 from ESPN." })] };
  const vm = pickerVm(loaded({ data: odd }), NY);
  assert.deepEqual(vm.weeks.map((w) => w.note), ["Not updated: ESPN didn't answer just now.",
    "Couldn't get Week 6 from ESPN."]);
  assert.deepEqual([vm.status.text, vm.status.tone], ["Offline: only the saved weeks are listed.", "info"]);
});

test("a malformed payload never throws and lists what it can", () => {
  for (const data of [null, {}, { weeks: "x" }, { weeks: [null, { key: "2-5" }, { key: "2-6", games: [null, {}] }] }]) {
    const vm = pickerVm(loaded({ data }), NY);
    assert.ok(Array.isArray(vm.weeks));
  }
  const junk = { weeks: [{ key: "2-5", label: "Week 5", games: [{ event_id: "1", away: { abbr: "TB" } }] }] };
  assert.deepEqual(pickerVm(loaded({ data: junk }), NY).weeks[0].games, [], "a game without two teams is left out");
});

test("view models are frozen and reduce never touches its input", () => {
  const ui = loaded({ filter: "DAL" });
  const before = structuredClone(ui);
  const vm = pickerVm(ui, NY);
  pickerReduce(ui, { type: "pick", game: game() });
  pickerReduce(ui, { type: "close" });
  assert.deepEqual(ui, before);
  assert.ok(isDeepFrozen(vm));
  assert.equal(pickerReduce(ui, { type: "nonsense" }), ui);
  const closed = pickerReduce(pickerReduce(ui, { type: "pick", game: game() }), { type: "close" });
  assert.deepEqual([closed.open, closed.chosen, closed.filter], [false, null, "DAL"], "closing keeps the filter");
});
