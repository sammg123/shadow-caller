// Timeline rows for the field-geometry tests (package A4), looked up by ESPN play id.
// The real 183-row capture tests/fixtures/timeline_tb_dal.json is required (ui-architecture.md 7.1). The contract's own
// example rows below (data-contract.md B2, B5, B6 and the G table, TB at DAL) are kept as a cross-check:
// field-rows.test.mjs proves they agree with the capture on every field the geometry reads.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CAPTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "timeline_tb_dal.json");

const RESULT = { yards: null, first_down: false, fd_by: null, td: false, turnover: false, turnover_kind: null,
  downs: false, safety: false, nullified: false, penalty: null };
const KICK = { ez: false, touchback: false, fair_catch: false, downed: false, oob: false, muffed: false, blocked: false,
  ret_yards: null, ret_end_x: null, fumble_rec: null, penalty: false, land_x: null, dist: null };
const CALL = { family: null, leaf: null, outcome: null, depth: null, air: null, air_src: null, air_band: null,
  yac: null, align: null };
const SNAPS = new Set(["play", "penalty", "kneel", "spike", "other", "punt", "fg", "fg_miss"]);

function row(seq, id, drive, team, kind, parts) {
  const { geo, call, result, kick, pre = null, post = null, scoring = null, pred = null, admin } = parts;
  const out = {
    seq, id, src: "espn", drive, team, opp: team === "DAL" ? "TB" : "DAL", kind,
    offense_is_caller: team === "DAL" && SNAPS.has(kind), pre, post,
    geo: geo ? { x_catch: null, lat: null, gap: null, approx: [], ...geo } : null,
    call: call ? { ...CALL, ...call } : null,
    result: kind === "admin" ? null : { ...RESULT, ...result },
    kick: kick ? { ...KICK, ...kick } : null,
    scoring, pred,
  };
  return admin ? { ...out, admin } : out;
}

const pen = (on, foul, yards, atX, noPlay) => ({ on, foul, yards, at_x: atX, no_play: noPlay, status: "enforced",
  note: `${foul.toLowerCase()} on ${on}` });
const sit = (down, togo, yl100, poss) => ({ ...(poss ? { poss } : {}), down, togo, yardline_100: yl100,
  ...(poss ? {} : { goal_to_go: togo >= yl100 }) });

// DC B2: the first DAL snap, full pred included.
const FIRST_DAL_PRED = {
  log_seq: 1, snap: 1, engine_drive: 1, p: 0.4562, p_league: 0.4624, p_habits: 0.4562, flag: "no edge",
  top_leaf: "run_inside", top_leaf_p: 0.2733, top3: ["run_inside", "pa_short", "dropback_short"], fam_top: "run",
  family: "dropback", leaf: "dropback_short", outcome: "incomplete", name: "Short (0–9 air yds), incomplete",
  fam_p: 0.1781, fam_p_league: 0.2004, leaf_p: 0.14, leaf_p_league: 0.1566, leaf_rank: 3, leaf_rank_league: 2,
  dropback: 1, success: 0, retagged: false,
  dist: {
    his_f: [0.51834, 0.1781, 0.22386, 0.02782, 0.05187],
    lg_f: [0.51724, 0.20045, 0.19354, 0.03468, 0.0541],
    his_l: [0.27331, 0.08495, 0.04348, 0.05108, 0.06552, 0.14003, 0.02377, 0.01431, 0.15806, 0.04823, 0.01758,
      0.02782, 0.03759, 0.01428],
    lg_l: [0.24098, 0.06767, 0.05743, 0.06359, 0.08757, 0.15658, 0.02996, 0.0139, 0.12557, 0.04805, 0.01992,
      0.03468, 0.03726, 0.01684],
  },
};

export const CONTRACT_ROWS = Object.freeze([
  row(1, "40187298040", 1, "DAL", "kickoff", { post: sit(1, 10, 70, "DAL"),
    geo: { dir: 1, x0: 65, x_end: 30, x_next: 30 },
    kick: { by: "TB", kdir: -1, from_x: 65, dist: 62, land_x: 3, ret_yards: 27, ret_end_x: 30 } }),
  row(2, "40187298068", 1, "DAL", "play", { pre: sit(1, 10, 70), post: sit(2, 10, 70, "DAL"), pred: FIRST_DAL_PRED,
    geo: { dir: 1, x0: 30, x_end: 30, x_next: 30, x_catch: 35, lat: "middle", approx: ["x_catch"] },
    call: { family: "dropback", leaf: "dropback_short", outcome: "incomplete", depth: "short", air: 5, air_src: "est",
      air_band: [1, 10], align: "U" },
    result: { yards: 0 } }),
  row(8, "401872980210", 1, "DAL", "play", { pre: sit(1, 8, 8), post: sit(1, 4, 4, "DAL"),
    geo: { dir: 1, x0: 92, x_end: 93, x_next: 96, lat: "left", gap: "left tackle" },
    call: { family: "run", leaf: "run_ot_left", align: "U" },
    result: { yards: 1, nullified: true, penalty: pen("TB", "Defensive Offside", 4, 92, true) } }),
  row(12, "401872980322", 1, "DAL", "play", { pre: sit(2, 1, 1),
    geo: { dir: 1, x0: 99, x_end: 100, x_next: null, lat: "middle", gap: "up the middle" },
    call: { family: "run", leaf: "run_inside", align: "U" },
    result: { yards: 1, first_down: true, fd_by: "rush", td: true },
    scoring: { team: "DAL", type: "TD", pts: 7, pat: "kick_good" } }),
  row(13, "401872980353", 1, "DAL", "admin", { admin: { what: "official_timeout", by: null } }),
  row(15, "401872980390", 2, "TB", "play", { pre: sit(1, 10, 73), post: sit(2, 7, 70, "TB"),
    geo: { dir: -1, x0: 73, x_end: 70, x_next: 70, x_catch: 74, lat: "left" },
    call: { family: "dropback", leaf: "dropback_short", depth: "short", air: -1, air_src: "yac", yac: 4, align: "U" },
    result: { yards: 3 } }),
  row(17, "401872980442", 2, "TB", "play", { pre: sit(3, 4, 67), post: sit(1, 10, 62, "TB"),
    geo: { dir: -1, x0: 67, x_end: 62, x_next: 62, lat: "right", gap: "right end" },
    call: { family: "dropback", outcome: "scramble", align: "S" },
    result: { yards: 5, first_down: true, fd_by: "rush" } }),
  row(42, "4018729801059", 3, "DAL", "play", { pre: sit(3, 10, 56), post: sit(4, 10, 56, "DAL"),
    geo: { dir: 1, x0: 44, x_end: 44, x_next: 44, x_catch: 67, lat: "left", approx: ["x_catch"] },
    call: { family: "dropback", leaf: "dropback_deep", outcome: "incomplete", depth: "deep", air: 23, air_src: "est",
      air_band: [19, 32], align: "S" },
    result: { yards: 0 } }),
  row(43, "4018729801082", 3, "DAL", "punt", { pre: sit(4, 10, 56), post: sit(1, 10, 97, "TB"),
    geo: { dir: 1, x0: 44, x_end: 97, x_next: 97 },
    kick: { by: "DAL", kdir: 1, from_x: 44, dist: 53, land_x: 97, oob: true } }),
  row(58, "4018729801359", 6, "TB", "play", { pre: sit(1, 10, 90), post: sit(1, 10, 73, "TB"),
    geo: { dir: -1, x0: 90, x_end: 88, x_next: 73, lat: "middle", gap: "up the middle" },
    call: { family: "run", leaf: "run_inside", align: "U" },
    result: { yards: 2, first_down: true, fd_by: "penalty", penalty: pen("DAL", "Face Mask", 15, 88, false) } }),
  row(81, "4018729801915", 9, "DAL", "play", { pre: sit(1, 10, 87), post: sit(1, 10, 39, "DAL"),
    geo: { dir: 1, x0: 13, x_end: 61, x_next: 61, x_catch: 52, lat: "middle" },
    call: { family: "dropback", leaf: "dropback_deep", depth: "deep", air: 39, air_src: "yac", yac: 9, align: "S" },
    result: { yards: 48, first_down: true, fd_by: "pass" } }),
  row(87, "4018729802060", 9, "DAL", "fg", { pre: sit(4, 6, 23),
    geo: { dir: 1, x0: 77, x_end: null, x_next: null },
    kick: { by: "DAL", kdir: 1, from_x: 77, dist: 41, good: true, x_kick: 69, post_x: 110 },
    scoring: { team: "DAL", type: "FG", pts: 3, pat: null } }),
  row(95, "4018729802242", 11, "TB", "play", { pre: sit(1, 10, 86), post: sit(1, 10, 14, "TB"),
    geo: { dir: -1, x0: 86, x_end: 14, x_next: 14, lat: "left", gap: "left tackle" },
    call: { family: "run", leaf: "run_ot_left", align: "U" },
    result: { yards: 72, first_down: true, fd_by: "rush" } }),
  row(104, "4018729802466", 12, "DAL", "play", { pre: sit(3, 3, 27), post: sit(1, 10, 75, "TB"),
    geo: { dir: 1, x0: 73, x_end: 75, x_next: 75, x_catch: 76, lat: "middle" },
    call: { family: "dropback", leaf: "dropback_short", depth: "short", air: 3, air_src: "int_spot", align: "S" },
    result: { yards: 0, turnover: true, turnover_kind: "int" } }),
  row(113, "4018729802667", 14, "DAL", "kickoff", { post: sit(1, 10, 37, "TB"),
    geo: { dir: 1, x0: 65, x_end: 37, x_next: 37 },
    kick: { by: "TB", kdir: -1, from_x: 65, dist: 61, land_x: 4, ret_yards: 24, ret_end_x: 28,
      fumble_rec: { team: "TB", x: 37 } },
    result: { turnover: true, turnover_kind: "fumble" } }),
  row(114, "4018729802713", 15, "TB", "play", { pre: sit(1, 10, 37), post: sit(2, 21, 48, "TB"),
    geo: { dir: -1, x0: 37, x_end: 48, x_next: 48 },
    call: { family: "dropback", outcome: "sack", align: "U" },
    result: { yards: -11 } }),
  row(123, "4018729802919", 15, "TB", "fg", { pre: sit(4, 17, 23),
    geo: { dir: -1, x0: 23, x_end: null, x_next: null },
    kick: { by: "TB", kdir: -1, from_x: 23, dist: 41, good: true, x_kick: 31, post_x: -10 },
    scoring: { team: "TB", type: "FG", pts: 3, pat: null } }),
  row(158, "4018729803719", 18, "DAL", "play", { pre: sit(1, 10, 18), post: sit(2, 10, 18, "DAL"),
    geo: { dir: 1, x0: 82, x_end: 82, x_next: 82, x_catch: 105, lat: "left", approx: ["x_catch"] },
    call: { family: "dropback", leaf: "dropback_deep", outcome: "incomplete", depth: "deep", air: 23, air_src: "est",
      air_band: [19, 32], align: "S" },
    result: { yards: 0 } }),
  row(161, "4018729803781", 19, "TB", "kickoff", { post: sit(1, 10, 65, "TB"),
    geo: { dir: -1, x0: 35, x_end: 100, x_next: 65 },
    kick: { by: "DAL", kdir: 1, from_x: 35, dist: 65, land_x: 100, ez: true, touchback: true } }),
]);

let captureCache;

/** The real capture (`/api/timeline?since=0` body). Required: a missing file fails loudly, never a quiet fallback. */
export function capture() {
  if (captureCache === undefined) {
    if (!existsSync(CAPTURE)) throw new Error(`${CAPTURE} is missing: the field tests are pinned to the real capture`);
    captureCache = JSON.parse(readFileSync(CAPTURE, "utf8"));
  }
  return captureCache;
}

/** Every row the tests can see: the 183 captured rows. */
export function allRows() {
  return capture().rows;
}

/** One row by ESPN play id, from the capture. */
export function rowById(id) {
  const found = allRows().find((r) => r.id === id);
  if (!found) throw new Error(`no timeline row with id ${id}`);
  return found;
}

/** One row by its seq (1-based arrival index), from the capture. */
export function rowBySeq(seq) {
  const found = allRows().find((r) => r.seq === seq);
  if (!found) throw new Error(`no timeline row with seq ${seq}`);
  return found;
}

/** The canonical leaf and family orders (DC B2 meta). */
export const META_LEAVES = Object.freeze(["run_inside", "run_ot_left", "run_edge_left", "run_ot_right",
  "run_edge_right", "dropback_short", "dropback_mid", "dropback_deep", "pa_short", "pa_mid", "pa_deep", "screen",
  "rpo_run", "rpo_throw"]);
export const META_FAMILIES = Object.freeze(["run", "dropback", "pa", "screen", "rpo"]);

/** A deep-frozen copy, to prove a function never mutates its input. */
export function frozenCopy(value) {
  const copy = structuredClone(value);
  const freeze = (v) => {
    if (v && typeof v === "object") {
      Object.values(v).forEach(freeze);
      Object.freeze(v);
    }
    return v;
  };
  return freeze(copy);
}

/** Every finite-or-not number inside a value, with its path, for NaN and range sweeps. */
export function numbersIn(value, path = "") {
  if (typeof value === "number") return [{ path, value }];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([k, v]) => numbersIn(v, path ? `${path}.${k}` : k));
}

/** A manual-mode row as the server builds it from the engine log (DC D): play-action short, caught, 8 yards. */
export function manualRow(overrides = {}) {
  return {
    seq: 1, id: "log-1", src: "log", drive: 1, team: "DAL", opp: "TB", kind: "play", offense_is_caller: true,
    pre: { down: 1, togo: 10, yardline_100: 75, goal_to_go: false, text: "1st & 10 at DAL 25" },
    post: { poss: "DAL", down: 2, togo: 2, yardline_100: 67, text: "2nd & 2 at DAL 33" },
    geo: { dir: 1, x0: 25, x_end: 33, x_next: 33, x_catch: 28, lat: null, gap: null, approx: ["x_catch", "lat"] },
    call: { family: "pa", leaf: "pa_short", outcome: null, depth: "short", air: 3, air_src: "bucket",
      air_band: [-1, 5], yac: null, align: null },
    result: { ...RESULT, yards: 8 }, kick: null, scoring: null, pred: null,
    ...overrides,
  };
}
