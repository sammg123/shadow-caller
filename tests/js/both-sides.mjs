// Both sides tracked (restructure-v2.md 11 decision 4), derived from the real TB at DAL captures (model-fixtures.mjs)
// until the engine's both-sides captures exist. DAL's 59 calls are exactly as captured (Brian Schottenheimer's). TB's 70
// plays are ESPN's real rows (situation, result, text), made Zac Robinson's calls, each wearing a stand-in prediction:
// DAL's own predictions in game order, so every grade is a real number from the model, just not his. The state carries
// what the server sends with two sides: `tracked` (away then home), one log in game order (newest first, as
// engine.view() sends it) whose rows carry `team` and `caller`, and a prediction that carries them too; the timeline
// marks both offenses' plays and drives as caller rows (offense_is_caller), while its frame stays the game's, as
// timeline.py sends it: teams[abbr].caller and field.left_team name the game's offense only (DAL attacks +x, TB -x).
// `perSide` puts each caller's scorecard and profile on his `tracked` entry (the engine's contract); without it the
// entries are the bare {team, caller, slug} and the page falls back.
import { deepFreeze, state, timeline, tlOf } from "./model-fixtures.mjs";

export const TB_CALLER = "Zac Robinson";
export const DAL_CALLER = "Brian Schottenheimer";
const CALLERS = Object.freeze({ TB: TB_CALLER, DAL: DAL_CALLER });
const SLUGS = Object.freeze({ TB: "zac-robinson", DAL: "brian-schottenheimer" });

/** The tracked entries, away then home (game-picker.md 3: sides in away-then-home order). */
export const TRACKED = deepFreeze(["TB", "DAL"].map((team) => ({ team, caller: CALLERS[team], slug: SLUGS[team] })));

/** A TB play made Robinson's call: ESPN's facts, DAL's `n`-th prediction standing in for his. */
function standInRow(row, template, snap) {
  const result = row.result || {};
  const pre = row.pre || {};
  return { ...template, espn_id: row.id, team: "TB", caller: TB_CALLER, feed_text: row.text, snap,
    drive: row.drive, qtr: row.qtr, clock: row.clock, down: pre.down, togo: pre.togo,
    yardline_100: pre.yardline_100, yards: result.yards, td: Boolean(result.td),
    turnover: Boolean(result.turnover), nullified: Boolean(result.nullified) };
}

/** One log in game order with both callers' rows, and the timeline rows wearing their predictions. */
function build() {
  const body = timeline.final();
  const dalOldest = [...state.final().log].reverse();
  const dalById = new Map(dalOldest.map((r) => [r.espn_id, r]));
  const dalPred = new Map(body.rows.filter((r) => r.pred).map((r) => [r.id, r.pred]));
  const log = [];
  const preds = new Map();
  let tbCalls = 0;
  let tbSnaps = 0;
  for (const row of body.rows) {
    if (row.team === "DAL" && row.pred && dalById.has(row.id)) {
      log.push({ ...dalById.get(row.id), team: "DAL", caller: DAL_CALLER });
      preds.set(row.id, row.pred);
    } else if (row.team === "TB" && row.kind === "play") {
      const template = dalOldest[tbCalls % dalOldest.length];
      tbCalls += 1;
      if (!(row.result && row.result.nullified)) tbSnaps += 1;
      const snap = row.result && row.result.nullified ? null : tbSnaps;
      log.push(standInRow(row, template, snap));
      preds.set(row.id, { ...dalPred.get(template.espn_id), snap, engine_drive: row.drive });
    }
  }
  const numbered = log.map((r, i) => ({ ...r, seq: i + 1 }));
  const seqOf = new Map(numbered.map((r) => [r.espn_id, r.seq]));
  const rows = body.rows.map((row) => (preds.has(row.id)
    ? { ...row, offense_is_caller: true, pred: { ...preds.get(row.id), log_seq: seqOf.get(row.id) } } : row));
  const drives = body.drives.map((d) => (d.team === "TB" ? { ...d, offense_is_caller: true } : d));
  return deepFreeze({ log: numbered, body: { ...body, rows, drives } });
}

let built = null;
const data = () => (built ??= build());

/** Both callers' calls, oldest first (each with team and caller). */
export const bothLog = () => data().log;

/** The /api/timeline body with both offenses' plays as caller rows. */
export const bothTimeline = () => data().body;

/** A stand-in profile for Robinson: Schottenheimer's model under his name (the terms are not his). */
export function standInProfile(team) {
  const profile = state.final().profile;
  return team === "DAL" ? profile : deepFreeze({ ...profile, caller: CALLERS[team], team });
}

/**
 * /api/state with both sides tracked, as of timeline row `seq` (the calls drawn so far).
 * @param {{ seq?: number, prediction?: object | null, perSide?: boolean, metrics?: object }} [opts]
 *   prediction: the next call (give it `team` and `caller`); perSide: each tracked entry carries `metrics` (from
 *   `metrics[team]`) and `profile`
 */
export function bothState({ seq = Infinity, prediction = null, perSide = true, metrics = {} } = {}) {
  const drawn = new Set(bothTimeline().rows.filter((r) => r.seq <= seq).map((r) => r.id));
  const log = bothLog().filter((r) => drawn.has(r.espn_id)).reverse();
  const tracked = TRACKED.map((t) => (perSide
    ? { ...t, profile: standInProfile(t.team), ...(metrics[t.team] ? { metrics: metrics[t.team] } : {}) } : t));
  return deepFreeze({ ...state.final(), tracked, log, prediction, drive_active: Boolean(prediction) });
}

/** The timeline drawn through `seq`, with ESPN's status as it stood then (`status` overrides it). */
export function bothTl(seq = Infinity, status = {}) {
  const body = bothTimeline();
  const n = Number.isFinite(seq) ? seq : body.n;
  const live = { ...body.status, state: "in", ball_kind: "snap", ...status };
  return tlOf({ ...body, status: Number.isFinite(seq) || Object.keys(status).length ? live : body.status }, n);
}

/** The next call, for `team`: the drive fixture's prediction, his. */
export function nextCallOf(team, snapNext) {
  return deepFreeze({ ...state.drive().prediction, team, caller: CALLERS[team], snap_next: snapNext });
}

/** A caller's calls in the log, newest first (what his LAST 6 reads). */
export const callsOf = (presented, team) => presented.log.filter((r) => r.team === team);
