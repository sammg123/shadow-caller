// The picker on the server's real answer: tests/js/picker/games-payload.json is GET /api/games offline on the saved
// 2026 weeks (tests/test_games.py checks it is exactly what games.py sends), read through the view model.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { INITIAL, pickerReduce, pickerVm, selectionOf } from "../../../static/js/picker/picker-vm.js";

const PAYLOAD = JSON.parse(readFileSync(new URL("./games-payload.json", import.meta.url), "utf8"));
const NY = { timeZone: "America/New_York" };
const loaded = () => ({ ...pickerReduce(INITIAL, { type: "loaded", data: PAYLOAD }), open: true });

test("the saved weeks list this week first, every game a row", () => {
  const vm = pickerVm(loaded(), NY);
  assert.deepEqual(vm.weeks.map((w) => [w.title, w.games.length, w.open]), [["This week · Week 5", 15, true],
    ["Week 4", 16, false], ["Week 6", 14, false], ["Week 18", 16, false]]);
  const tbDal = vm.weeks[0].games[0];
  assert.deepEqual([tbDal.matchup, tbDal.status, tbDal.label, tbDal.caller], ["TB at DAL", "Final",
    "Tampa Bay Buccaneers 24 at Dallas Cowboys 16. Final.", "Shadow: Schottenheimer (DAL)"]);
  const london = vm.weeks[0].games[1];
  assert.deepEqual([london.matchup, london.status, london.kind], ["PHI vs JAX", "Sun 9:30 AM", "upcoming"]);
  assert.ok(vm.weeks[3].games.every((g) => g.status === "Time TBD"), "week 18's kickoff times aren't set yet");
  assert.equal(vm.filter.options.length, 33, "All teams and the 32 teams");
  assert.equal(vm.status.text, "Offline: only the saved weeks are listed.");
});

test("picking Tampa Bay at Dallas offers Schottenheimer's side and opens it paused at kickoff", () => {
  const game = PAYLOAD.weeks[0].games.find((g) => g.event_id === "401872980");
  const ui = pickerReduce(loaded(), { type: "pick", game });
  const { chosen } = pickerVm(ui, NY);
  assert.deepEqual([chosen.title, chosen.sub, chosen.go.hint], ["Buccaneers at Cowboys",
    "Week 5 · Final · TB 24, DAL 16", "Finished: opens paused at kickoff."]);
  assert.deepEqual(selectionOf(ui), { event_id: "401872980", sides: ["DAL"] });
});
