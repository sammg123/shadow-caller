// Hit rate by down and distance (pure; restructure-v2.md section 6): 1st down; 2nd and 3rd split short (1 to 3 yards
// to go), medium (4 to 6) and long (7 or more); 4th down. Counted on the specific play exactly as the scorecard counts
// it (calls with a leaf rank: live.py metrics), so the total is the scorecard's own and the buckets add up to it. His
// top 3 is set against the league baseline's top 3 on the same snaps (leaf_rank_league), the pair SHADOW v LEAGUE
// already shows. Counts only, never a percentage of a handful (PRODUCT.md: no more precision than the data has).
import { freezeDeep } from "../../model/format.js";
import { callerCalls } from "./calls.js";
import { HIT_RATE } from "./copy.js";

const SHORT_MAX = 3;
const MEDIUM_MAX = 6;
const TOP3_RANK = 3;
const SPLIT_DOWNS = Object.freeze([2, 3]);
const ORDINAL = Object.freeze({ 2: "2nd", 3: "3rd" });
const SIZES = Object.freeze(["short", "medium", "long"]);

/** The buckets in reading order, each with its label and its yards-to-go hint. */
export const BUCKETS = Object.freeze([
  { key: "1st", size: null },
  ...SPLIT_DOWNS.flatMap((down) => SIZES.map((size) => ({ key: `${ORDINAL[down]}-${size}`, size }))),
  { key: "4th", size: null },
].map((b) => Object.freeze({ ...b, label: HIT_RATE.labels[b.key], hint: b.size ? HIT_RATE.hints[b.size] : "" })));

const sizeOf = (togo) => (togo <= SHORT_MAX ? "short" : togo <= MEDIUM_MAX ? "medium" : "long");

/** The bucket key of a down and its yards to go (goal to go counts its yards), or null when either is unknown. */
export function bucketOf(down, togo) {
  if (!Number.isInteger(down) || !Number.isInteger(togo) || togo < 1) return null;
  if (down === 1) return "1st";
  if (down === 4) return "4th";
  return SPLIT_DOWNS.includes(down) ? `${ORDINAL[down]}-${sizeOf(togo)}` : null;
}

const VERDICT_ORDER = Object.freeze({ top1: 0, top3: 1, miss: 2 });

function tallyOf(preds) {
  const top1 = preds.filter((p) => p.leaf_rank === 1).length;
  const top3 = preds.filter((p) => p.leaf_rank <= TOP3_RANK).length;
  const league3 = preds.filter((p) => Number.isInteger(p.leaf_rank_league) && p.leaf_rank_league <= TOP3_RANK).length;
  return { calls: preds.length, top1, top3, league3 };
}

/** His calls as cells: top picks first, then the rest of his top 3, then the misses. */
function cellsOf(preds) {
  return preds.map((p) => (p.leaf_rank === 1 ? "top1" : p.leaf_rank <= TOP3_RANK ? "top3" : "miss"))
    .sort((a, b) => VERDICT_ORDER[a] - VERDICT_ORDER[b]);
}

/** Nothing to count yet: no calls at all, or calls with no specific-play grade. */
const emptyText = (calls, graded) => (graded ? "" : calls ? HIT_RATE.noPlayGrades : HIT_RATE.empty);

const leadOf = (t) => (t.calls === 0 ? null : t.top3 > t.league3 ? "shadow" : t.top3 < t.league3 ? "league" : "even");

function rowOf(bucket, preds) {
  const tally = tallyOf(preds);
  const lead = leadOf(tally);
  return {
    key: bucket.key, label: bucket.label, hint: bucket.hint, ...tally, lead, leadText: lead ? HIT_RATE.leads[lead] : "",
    cells: cellsOf(preds), cellsLabel: HIT_RATE.cellsAria(bucket.label, tally.top1, tally.top3, tally.calls),
  };
}

const onThePlay = (row) => Number.isInteger(row.pred.leaf_rank) && row.pred.leaf_rank > 0;

/** His calls graded on the specific play, each with its bucket (null when the down or the distance is unknown). */
function gradedCalls(calls) {
  return calls.filter(onThePlay)
    .map((row) => ({ key: bucketOf(row.pre && row.pre.down, row.pre && row.pre.togo), pred: row.pred }));
}

/**
 * @param {object} pv  presented view
 * @returns {object} frozen {heading, columns, note, empty, emptyText, rows: {key, label, hint, calls, top1, top3,
 *   league3, lead: "shadow"|"league"|"even"|null, leadText, cells: ("top1"|"top3"|"miss")[], cellsLabel}[], total}
 */
export function hitRateVm(pv) {
  const calls = callerCalls(pv && pv.tl);
  const graded = gradedCalls(calls);
  const rows = BUCKETS.map((b) => rowOf(b, graded.filter((g) => g.key === b.key).map((g) => g.pred)));
  const tally = tallyOf(graded.map((g) => g.pred));
  const lead = leadOf(tally);
  const total = { label: HIT_RATE.total, ...tally, lead, leadText: lead ? HIT_RATE.leads[lead] : "" };
  return freezeDeep({
    heading: HIT_RATE.heading, columns: [...HIT_RATE.columns], note: HIT_RATE.note,
    empty: total.calls === 0, emptyText: emptyText(calls.length, total.calls), rows, total,
  });
}
