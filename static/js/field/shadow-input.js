/**
 * What the ghost layer draws for a call (A5 part 2; moved out of play-style.js for 4b, unchanged): buildShadowPlays'
 * source and situation from what showGhosts or showReview receives (the conductor's GhostSet, ShadowPlays, or
 * { source, situation? }), as the 2D field takes it (fallback-ghosts shadowInput). Pure: no DOM, no three.js.
 * play-style.js re-exports shadowInputOf, so its importers keep working.
 */
import { isPlainObject } from "../core/domain.js";
import { isFiniteNum } from "./grammar.js";

/** The snap the shadows start at; on 4th down its down too (shadows.js: "If he goes", drawn quieter). */
const snapOf = (sit) => (isPlainObject(sit) && sit.kind !== "kickoff" && isFiniteNum(sit.ballX)
  && (sit.dir === 1 || sit.dir === -1) ? { ballX: sit.ballX, dir: sit.dir, kind: "snap", poss: sit.poss ?? null,
    ...(sit.down === 4 ? { down: 4 } : {}) } : null);
const pairOf = (e) => ({ leaf: e?.leaf, p: e?.p });
const keyOf = (sit, leaves) => [sit.ballX, sit.dir, leaves.map((e) => `${e.leaf}:${Number(e.p).toFixed(4)}`).join(",")]
  .join("|");

/** A GhostSet (ghosts.js, what the conductor sends): its shapes in his order and every play's odds; the live snap
 * names the team when it is the same snap, else `poss` (the caller). */
function fromGhostSet(set, live, poss) {
  if (!set.shapes.length) return null;
  const here = live && live.ballX === set.ballX && live.dir === set.dir;
  const same = here && typeof live.poss === "string";
  return { key: String(set.key ?? ""), source: { leaves: set.shapes.map(pairOf),
    all: (Array.isArray(set.leafZones) ? set.leafZones : []).map(pairOf) },
  situation: snapOf({ ballX: set.ballX, dir: set.dir, poss: same ? live.poss : poss, down: here ? live.down : null }) };
}

/** ShadowPlays built already (shadows.js): their plays, odds and names, from the snap they start at. */
function fromShadowPlays(list) {
  const drawing = list.find((sp) => isFiniteNum(sp?.drawing?.steps?.[0]?.from?.x))?.drawing;
  if (!drawing) return null;
  const leaves = list.map((sp) => ({ ...pairOf(sp), name: sp?.name }));
  const ballX = isFiniteNum(drawing.snapX) ? drawing.snapX : drawing.steps[0].from.x;
  const situation = snapOf({ ballX, dir: drawing.dir, poss: drawing.team ?? null });
  return situation ? { key: keyOf(situation, leaves), source: { leaves }, situation } : null;
}

/** A request of its own: { source (/api/state prediction, a row's pred, a ghost input), situation?, leafNames?,
 * leafOrder?, key? }; with no situation it is for the live snap. */
function fromRequest(req, live) {
  const situation = snapOf(req.situation ?? live);
  if (!situation || !isPlainObject(req.source)) return null;
  const leaves = Array.isArray(req.source.leaves) ? req.source.leaves : Array.isArray(req.source.top)
    ? req.source.top.map((t) => ({ leaf: t?.key, p: t?.p })) : [];
  return { key: typeof req.key === "string" ? req.key : keyOf(situation, leaves), source: req.source, situation,
    ...(req.leafNames ? { leafNames: req.leafNames } : {}), ...(Array.isArray(req.leafOrder)
      ? { leafOrder: req.leafOrder } : {}) };
}

/**
 * What the ghost layer draws for a call: buildShadowPlays' source and situation (and leafNames, leafOrder) from what
 * showGhosts or showReview receives, as the 2D field takes it (fallback-ghosts shadowInput): the conductor's GhostSet,
 * ShadowPlays, or { source, situation? }. `live` is the snap on the field; `poss` names the team when nothing else
 * does (a GhostSet carries none: the caller). Null when there is nothing to draw.
 */
export function shadowInputOf(set, { live = null, poss = null } = {}) {
  if (!set || typeof set !== "object") return null;
  if (Array.isArray(set)) return fromShadowPlays(set);
  if (Array.isArray(set.shapes)) {
    const out = fromGhostSet(set, live, poss);
    return out?.situation ? out : null;
  }
  return isPlainObject(set.source) ? fromRequest(set, live) : null;
}
