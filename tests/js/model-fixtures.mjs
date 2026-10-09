// Test data for the view-model tests (package A3). Real captures only:
//   tests/fixtures/state_tb_dal_*.json      /api/state from an offline sandbox (scripts/sandbox.py), never the live game
//     final     after "Replay this game" on ESPN 401872980 (59 logged rows, DAL 16 TB 24, Q4 0:00, no drive)
//     drive     final, then shorthand "new D25": a drive with memory terms, past the opening script
//     tilt      fresh, then "new D25 | Q1 15:00 | DAL 0 TB 14", "K -3", "3&2 T20" (FI #30: TILT PASS, opening script)
//     feedOn    fresh, then the feed turned on: the offline poller applied the whole game (59 rows)
//   tests/fixtures/timeline_tb_dal.json      /api/timeline?since=0 after the replay (183 rows)
//   tests/fixtures/timeline_tb_dal_104.json  the same game after 104 applied plays (watch mode, DC C5 and G22)
import { readFileSync } from "node:fs";

const FIXTURES = new URL("../fixtures/", import.meta.url);

export const NOW = 1791504000000;

export function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

export function isDeepFrozen(value) {
  if (!value || typeof value !== "object") return true;
  return Object.isFrozen(value) && Object.keys(value).every((key) => isDeepFrozen(value[key]));
}

const cache = new Map();
export function readFixture(name) {
  if (!cache.has(name)) {
    cache.set(name, deepFreeze(JSON.parse(readFileSync(new URL(name, FIXTURES), "utf8"))));
  }
  return cache.get(name);
}

export const state = {
  final: () => readFixture("state_tb_dal_final.json"),
  drive: () => readFixture("state_tb_dal_drive_d25.json"),
  tilt: () => readFixture("state_tb_dal_tilt_pass.json"),
  feedOn: () => readFixture("state_tb_dal_feed_on.json"),
};

export const timeline = {
  final: () => readFixture("timeline_tb_dal.json"),
  at104: () => readFixture("timeline_tb_dal_104.json"),
};

// What core/present.presentedTimeline returns: rows drawn so far plus the matching drives, status and box.
export function tlOf(body, drawnThrough = body.n) {
  return deepFreeze({
    rows: body.rows.filter((row) => row.seq <= drawnThrough),
    drives: body.drives,
    status: body.status,
    box: body.box,
    unlinked: body.unlinked,
    wpStart: body.wp_start,
    teams: body.teams,
    field: body.field,
    meta: body.meta,
  });
}

export const DEFAULT_VIEW = Object.freeze({
  pick: { k: null, i: 0, out: null },
  flag: { open: false, gen: 0 },
  booth: { open: false, auto: false },
  scorecardOpen: false,
  camera: null,
  review: { seq: null },
  sideAtFifty: null,
  stripRejected: {},
  hoverLeaf: null,
  toast: null,
  bgMessage: null,
});

// pv as the scheduler builds it (ui-architecture 2.3); deep-frozen so a VM that mutates its input throws.
export function makePv({ presented = null, tl = null, version = null, view = {}, prefs = {}, conn = {},
  boot = {}, anim = {}, now = NOW, ...rest } = {}) {
  return deepFreeze({
    presented,
    tl,
    version,
    view: { ...DEFAULT_VIEW, ...view },
    prefs: { motion: "full", world: "neutral", ambient: "room", scene: "auto", watchSpeed: 4, ...prefs },
    conn: { failures: 0, lastOkAt: null, retryAt: null, lastError: null, ...conn },
    boot: { phase: "ready", attempts: 1, error: null, ...boot },
    anim: { token: 0, queue: [], playing: null, drawnThrough: 0, rebuilding: false, ...anim },
    now,
    ...rest,
  });
}

// A copy of a fixture body with some top-level keys replaced (inputs stay untouched).
export function patch(body, changes) {
  return deepFreeze({ ...body, ...changes });
}

export function rowBySeq(body, seq) {
  return body.rows.find((row) => row.seq === seq);
}
