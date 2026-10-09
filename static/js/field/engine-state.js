/**
 * What the WebGL engine reports about itself (ui-architecture 2.5 debugState, 5.3 #field hooks). Pure.
 *
 * The situation hooks (data-ball-x, data-ltg-x, data-los, data-ltg, data-poss, aria-label) are the same facts
 * model/vm-field.js gives the field host, derived the same way from the Situation the engine was shown, so either
 * writer leaves identical values (tests/js/engine-state.test.mjs checks them against fieldVm). los and ltg are the
 * yardline_100 of the team in possession (#27, #28): 1st & 10 at DAL 25 gives 75 and 65; goal to go gives LTG 0.
 */
import { deepFreeze } from "../core/domain.js";
import { FIELD as COPY } from "../model/copy.js";
import { downDistance, spotText } from "../model/format.js";
import { yardline100FromX } from "./coords.js";
import { isFiniteNum } from "./grammar.js";

export const NO_HOOKS = deepFreeze({ ballX: null, ltgX: null, los: null, ltg: null, poss: null });

const ANIM_STATES = Object.freeze(["rebuilding", "playing", "reviewing"]);

function labelOf(sit, h, caller, opp) {
  if (!sit) return COPY.offField(caller);
  const other = sit.poss === caller ? opp : caller;
  const spot = spotText(h.los, sit.poss, other);
  if (sit.kind === "kickoff") return COPY.kickoff(sit.poss, spot);
  const dd = downDistance(sit.down, sit.togo, h.los);
  const ltg = h.ltg === null ? "" : sit.goalToGo ? COPY.goalLine : spotText(h.ltg, sit.poss, other);
  return [COPY.ballOn(spot), dd ? COPY.downDistance(dd) : "", ltg ? COPY.lineToGain(ltg) : ""].filter(Boolean).join(" ");
}

/**
 * The #field facts for a Situation (2.4) on a game frame (DC A1 `field`: left_team is always the caller). With no
 * frame yet the label is null: the engine leaves the host's own label alone until it knows the teams.
 */
export function hookValues(sit, field) {
  const caller = typeof field?.left_team === "string" ? field.left_team : null;
  const opp = typeof field?.right_team === "string" ? field.right_team : null;
  if (!sit || !isFiniteNum(sit.ballX) || typeof sit.poss !== "string") {
    return { ...NO_HOOKS, ariaLabel: caller ? COPY.offField(caller) : null };
  }
  const ref = caller ?? sit.poss;
  const ltgX = isFiniteNum(sit.ltgX) ? sit.ltgX : null;
  const h = { ballX: sit.ballX, ltgX, poss: sit.poss, los: yardline100FromX(sit.poss, sit.ballX, ref),
    ltg: ltgX === null ? null : yardline100FromX(sit.poss, ltgX, ref) };
  return { ...h, ariaLabel: caller ? labelOf(sit, h, caller, opp) : null };
}

/** data-anim-state: rebuilding, then playing, then reviewing, else idle. */
export function animStateOf(flags) {
  return ANIM_STATES.find((name) => Boolean(flags?.[name])) ?? "idle";
}

/** The leaves of a GhostSet (2.4) in rank order. */
export function ghostLeaves(set) {
  if (!Array.isArray(set?.shapes)) return [];
  return [...set.shapes].sort((a, b) => a.rank - b.rank).map((s) => s.leaf).filter((leaf) => typeof leaf === "string");
}

const num = (v) => (isFiniteNum(v) ? String(Math.round(v * 1000) / 1000) : null);

/**
 * Every 5.3 attribute the engine owns, as strings, or null to remove it. aria-label is left out entirely when
 * there is none to write. data-drawn-seq, data-queue, data-epoch and data-drive-active are store facts the field
 * host mirrors; the engine never writes them.
 */
export function hostAttrs({ ready, animState, playingSeq, camera, frames, ghosts, highlight, reviewSeq, hooks }) {
  const h = hooks ?? NO_HOOKS;
  const out = {
    "data-scene": "webgl", "data-scene-ready": String(Boolean(ready)), "data-anim-state": animState ?? "idle",
    "data-playing-seq": num(playingSeq), "data-camera": camera ?? null, "data-frames": String(frames ?? 0),
    "data-ghosts": (ghosts ?? []).join(" "), "data-ghost-highlight": highlight ?? "", "data-review-seq": num(reviewSeq),
    "data-ball-x": num(h.ballX), "data-ltg-x": num(h.ltgX), "data-los": num(h.los), "data-ltg": num(h.ltg),
    "data-poss": h.poss ?? "",
  };
  return typeof h.ariaLabel === "string" ? { ...out, "aria-label": h.ariaLabel } : out;
}

/** debugState() (2.5): the engine's own facts plus renderer.info's counters; `extra` adds engine-specific keys. */
export function debugRecord({ ready = false, frames = 0, animState = "idle", playingSeq = null, ghosts = [],
  highlight = null, camera = null, situation = null, info = null, dpr = 1, extra = {} } = {}) {
  return {
    kind: "webgl", ready: Boolean(ready), frames, animState, playingSeq, ghosts: [...ghosts], highlight, camera,
    situation, drawCalls: info?.render?.calls ?? 0, triangles: info?.render?.triangles ?? 0,
    geometries: info?.memory?.geometries ?? 0, textures: info?.memory?.textures ?? 0, dpr, ...extra,
  };
}
