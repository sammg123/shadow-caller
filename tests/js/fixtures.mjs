// Loads tests/fixtures/*.json for the node unit tests (ui-architecture.md 7.1, owner A1).
// Timeline data: the real 183-row capture (timeline_tb_dal.json), required; timeline_contract_rows.json (real rows
// from the saved game, built by scripts/capture_ui_fixtures.py) only when SC_TIMELINE_FIXTURE=contract asks for it.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const CAPTURE = "timeline_tb_dal.json";
const CONTRACT = "timeline_contract_rows.json";

export function fixturePath(name) {
  return join(FIXTURE_DIR, name);
}

export function hasFixture(name) {
  return existsSync(fixturePath(name));
}

export function loadJson(name) {
  return JSON.parse(readFileSync(fixturePath(name), "utf8"));
}

function indexRows(body) {
  const bySeq = new Map(body.rows.map((r) => [r.seq, r]));
  const row = (seq) => {
    const r = bySeq.get(seq);
    if (!r) throw new Error(`fixture has no row with seq ${seq}`);
    return r;
  };
  const rows = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => row(from + i));
  return { body, row, rows };
}

/**
 * The timeline fixture: { name, body, row(seq), rows(from, to) }. The real capture is required, so a missing file
 * fails loudly instead of quietly testing less. SC_TIMELINE_FIXTURE=contract opts into the contract rows (both
 * fixtures hold seqs 1-15, 41-44, 85-88, 100-108, 112-115, 159-162 and 183).
 */
export function loadTimeline() {
  if (process.env.SC_TIMELINE_FIXTURE === "contract") return { name: CONTRACT, ...indexRows(loadJson(CONTRACT)) };
  if (!hasFixture(CAPTURE)) {
    throw new Error(`tests/fixtures/${CAPTURE} is missing; set SC_TIMELINE_FIXTURE=contract to run on the contract rows`);
  }
  return { name: CAPTURE, ...indexRows(loadJson(CAPTURE)) };
}

/** Always the contract rows fixture (it carries the snapshots at n 104 and 183). */
export function loadContractRows() {
  return { name: CONTRACT, ...indexRows(loadJson(CONTRACT)) };
}

/** A /api/state fixture by short name ("fresh", "drive_d25", "final", "feed_on"). A missing one fails loudly. */
export function loadState(name) {
  for (const file of [`state_${name}.json`, `state_tb_dal_${name}.json`]) {
    if (hasFixture(file)) return loadJson(file);
  }
  throw new Error(`tests/fixtures/state_${name}.json is missing (scripts/capture_ui_fixtures.py writes it)`);
}

/** A /api/timeline response body for tests: since 0 (reset) by default, or an append from `since`. */
export function timelineBody(base, { epoch = base.epoch, n, since = 0, rows, reset = since === 0, snapshot,
  mode = base.mode ?? "replay", source = base.source ?? "espn" } = {}) {
  const snap = snapshot ?? { drives: base.drives ?? [], status: base.status ?? null, box: base.box ?? null, unlinked: [] };
  const lastSeq = rows.length ? rows[rows.length - 1]?.seq : undefined;
  const body = {
    epoch, n: n ?? lastSeq ?? since, since, reset, source, mode, rows,
    drives: snap.drives, status: snap.status, box: snap.box, wp_start: base.wp_start ?? null, unlinked: snap.unlinked ?? [],
  };
  if (since !== 0 && !reset) return body;
  return { ...body, field: base.field, teams: base.teams, team_order: base.team_order, meta: base.meta };
}

/** Minimal stand-in rows (seq, id, kind) for filling a cache before real rows are appended. */
export function stubRows(from, to, kind = "play") {
  const out = [];
  for (let s = from; s <= to; s += 1) out.push({ seq: s, id: `stub-${s}`, kind, src: "espn", pred: null });
  return out;
}

export function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/** Tap cycles exactly as /api/state `keys` serves them (FI 1.4), for tests that run without a state fixture. */
export const KEYS = deepFreeze({
  J: [{ leaf: "run_ot_left", name: "Off-tackle left" }, { leaf: "run_edge_left", name: "Outside left (edge)" }],
  K: [{ leaf: "run_inside", name: "Inside run (A/B gap)" }],
  R: [{ leaf: "run_inside", name: "Inside run (A/B gap)" }],
  L: [{ leaf: "run_ot_right", name: "Off-tackle right" }, { leaf: "run_edge_right", name: "Outside right (edge)" }],
  P: [{ leaf: "dropback_short", name: "Short (0–9 air yds)" }, { leaf: "dropback_mid", name: "Intermediate (10–19)" },
      { leaf: "dropback_deep", name: "Deep shot (20+)" }],
  A: [{ leaf: "pa_short", name: "PA short (0–9)" }, { leaf: "pa_mid", name: "PA intermediate (10–19)" },
      { leaf: "pa_deep", name: "PA deep shot (20+)" }],
  N: [{ leaf: "screen", name: "Screen" }],
  O: [{ leaf: "rpo_run", name: "RPO, handed off or kept" }, { leaf: "rpo_throw", name: "RPO, thrown" }],
});

export const FAMILY_NAMES = deepFreeze({ dropback: "Dropback pass", pa: "Play-action", rpo: "RPO", run: "Run", screen: "Screen" });

/** A small /api/state body (FI Appendix A field names) for reducer and action tests. */
export function stateBody(overrides = {}) {
  return {
    game: { offense: "DAL", opponent: "TB", label: "Buccaneers at Cowboys, Thursday Night Football, Oct 8", espn_event: "401872980" },
    sit: { down: 1, togo: 10, yardline_100: 75, qtr: 1, clock: 900, clock_str: "15:00", score_off: 0, score_opp: 0, clock_estimated: false },
    drive_active: false, drive_n: 0, prediction: null, keys: KEYS, family_names: FAMILY_NAMES,
    log: [], metrics: { n: 0 }, version: 1, message: "Set the start of Dallas's first drive.",
    feed: { state: "off", on: false, last_poll: null, last_play: null, plays_logged: 0, skipped: null, event_id: "401872980" },
    ...overrides,
  };
}

/**
 * A function that behaves like a browser timer or clock under WebIDL: called as a method of anything but the global
 * object it throws "Illegal invocation", as Chromium does for `{ setTimeout }.setTimeout()` and
 * `{ now: performance.now }.now()`. Node never checks, so tests wrap their fakes with this to see the browser's rule.
 */
export function browserLike(fn) {
  return function strict(...args) {
    if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
    return fn(...args);
  };
}

/** The same fake timers with browser-strict setTimeout and clearTimeout (see browserLike). */
export function browserTimers(base) {
  return { ...base, setTimeout: browserLike(base.setTimeout), clearTimeout: browserLike(base.clearTimeout) };
}
