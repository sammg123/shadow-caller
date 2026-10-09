import test from "node:test";
import assert from "node:assert/strict";
import { tendenciesVm, TERM_ORDER } from "../../static/js/model/vm-tendencies.js";
import { makePv, state, patch, isDeepFrozen } from "./model-fixtures.mjs";

const profile = () => state.final().profile;
const withProfile = (p) => patch(state.final(), { profile: p });
const near = (a, b) => Math.abs(a - b) < 1e-6;

test("before the first render the title is generic", () => {
  const vm = tendenciesVm(makePv());
  assert.equal(vm.title, "His tendencies");
  assert.deepEqual([...vm.rows], []);
  assert.deepEqual([...vm.mix], []);
});

test("title uses the caller's last name (#6)", () => {
  assert.equal(tendenciesVm(makePv({ presented: state.final() })).title, "Schottenheimer's tendencies");
});

test("terms come habit first, then memory, in a fixed order (G14)", () => {
  const vm = tendenciesVm(makePv({ presented: state.final() }));
  assert.deepEqual(vm.rows.map((r) => r.key), [
    "early_down", "third_long", "trailing9", "red_zone", "dq", "last", "last_fail", "explosive_prev", "sack_prev",
  ]);
  assert.deepEqual([...TERM_ORDER], vm.rows.map((r) => r.key));
  assert.deepEqual(vm.rows.map((r) => r.label), [
    "Early downs (1st/2nd)", "3rd & 4+", "Trailing by 9+", "Red zone", "Value gap (what's been working)",
    "Repeat last call (stickiness)", "After a failed play", "After a 20+ yard gain", "After a sack",
  ]);
  assert.deepEqual(vm.rows.map((r) => r.group), ["habit", "habit", "habit", "habit", "memory", "memory", "memory", "memory", "memory"]);
});

test("filled exactly when the 90% interval excludes zero (#114)", () => {
  const vm = tendenciesVm(makePv({ presented: state.final() }));
  assert.deepEqual(vm.rows.filter((r) => r.sure).map((r) => r.key), ["early_down", "dq", "last", "explosive_prev"]);
  assert.deepEqual(vm.rows.map((r) => r.sign), ["run", "run", "pass", "pass", "pass", "run", "pass", "run", "run"]);
});

test("positions are fractions of the clamped -1.2 to 1.2 axis", () => {
  const vm = tendenciesVm(makePv({ presented: state.final() }));
  const early = vm.rows[0].pos;
  assert.ok(near(early.lo, 0.132517) && near(early.est, 0.252468) && near(early.hi, 0.38896));
  assert.deepEqual({ ...vm.axis }, { min: -1.2, max: 1.2, zero: 0.5, left: "more run", right: "more pass",
    ariaLabel: "His pass-run tendency terms with 90 percent intervals" });
  const wide = { ...profile().coefs.red_zone, lo: -2, hi: 3 };
  const clamped = tendenciesVm(makePv({ presented: withProfile({ ...profile(), coefs: { ...profile().coefs, red_zone: wide } }) }));
  const rz = clamped.rows.find((r) => r.key === "red_zone").pos;
  assert.deepEqual([rz.lo, rz.hi], [0, 1]);
});

test("unknown terms are appended alphabetically inside their group, intercept never shows", () => {
  const coefs = {
    ...profile().coefs,
    zz_habit: { est: 0.1, lo: -0.1, hi: 0.3, label: "Zed habit", group: "habit" },
    aa_habit: { est: 0.1, lo: -0.1, hi: 0.3, label: "Aa habit", group: "habit" },
    mm_memory: { est: -0.1, lo: -0.3, hi: 0.1, label: "Mem term", group: "memory" },
    odd: { est: 0, lo: -1, hi: 1, label: "No group" },
  };
  const vm = tendenciesVm(makePv({ presented: withProfile({ ...profile(), coefs }) }));
  assert.deepEqual(vm.rows.map((r) => r.key), [
    "early_down", "third_long", "trailing9", "red_zone", "aa_habit", "zz_habit",
    "dq", "last", "last_fail", "explosive_prev", "sack_prev", "mm_memory", "odd",
  ]);
  assert.equal(vm.rows.some((r) => r.key === "intercept"), false);
});

test("the note and headings read like FI 3.8 (#114)", () => {
  const vm = tendenciesVm(makePv({ presented: state.final() }));
  assert.equal(vm.note, "1,351 snaps, 21 games (2025–2026). Filled dots: 90% interval excludes zero.");
  assert.equal(vm.termsHeading, "Pass vs run terms");
  assert.equal(vm.mixHeading, "His play-type mix vs expected");
});

test("play-type mix in the canonical family order, then the held-out check (#115)", () => {
  const vm = tendenciesVm(makePv({ presented: state.final() }));
  assert.deepEqual(vm.mix.map((m) => [m.key, m.name, m.his, m.exp]), [
    ["run", "Run", "34%", "exp. 34%"],
    ["dropback", "Dropback pass", "43%", "exp. 45%"],
    ["pa", "Play-action", "15%", "exp. 12%"],
    ["screen", "Screen", "3%", "exp. 4%"],
    ["rpo", "RPO", "5%", "exp. 5%"],
  ]);
  assert.equal(vm.heldOut,
    "Held-out check: his top pick for the specific play was right 38% of the time; the actual play was in his top 3 66% of the time (1,270 snaps).");
});

test("a profile without the play-type model shows no mix and no held-out line", () => {
  const vm = tendenciesVm(makePv({ presented: withProfile({ ...profile(), granular: null }) }));
  assert.deepEqual([...vm.mix], []);
  assert.equal(vm.heldOut, "");
  assert.ok(isDeepFrozen(vm));
});
