// Under the Lights: the light dip (DESIGN.md motion grammar "Light dip (20%, 300 ms)": at the pre-snap moment the
// stadium lights fall to 80% and come back at the snap; the LED boards and the two broadcast lines keep their
// brightness; surface brief #4; owner W1). One level for every stadium light: the tower spot lights (the scene's
// named lights whose ids begin with "tower"), the lamp banks, the light shafts and the crowd they light. A new target
// eases from wherever the level is (a snap that comes before the dip finished simply turns it round). Each light's
// full intensity is remembered the first time it is seen, and restore() puts every light back (a rebuilt stadium).
// G3-7: a flare lifts the lamp banks (the brightest fixtures, The Fixture Rule) to `peak` times full and back, over the
// dip if one is on, when he is right (TOP PICK) or on a touchdown; their beams in the haze rise with them up to full
// (never past DESIGN.md's 6%), and the spots that light the field keep their level, so the field never flashes.
import { EASE } from "../../../../field/timing.js";

const SETTLED = 1e-3;
/** A flare reaches its peak this far into its time, then falls back for the rest. */
const FLARE_RISE = 0.2;

/** The lights the dip touches: the towers' spots (by id), never the sky or the sun. */
export const isStadiumLight = (light) => typeof light?.name === "string" && light.name.startsWith("tower")
  && Number.isFinite(light.intensity);

/** A flare's envelope at u (0..1 of its time): up fast to 1, then eased back down to 0. */
export function flareEnvelope(u) {
  const k = Math.min(1, Math.max(0, u));
  return k < FLARE_RISE ? EASE.outCubic(k / FLARE_RISE) : 1 - EASE.inOutCubic((k - FLARE_RISE) / (1 - FLARE_RISE));
}

/**
 * @param {{ lamps?: { setLevel(k: number): void }, shafts?: { setLevel(k: number): void },
 *   stands?: { setLevel(k: number): void }, crowd?: object }} parts
 * @returns {{ to(level, ms, lights?): void, flare(peak, ms): void, update(dtMs): boolean, level(): number,
 *   restore(): void }}
 */
export function createDim(parts = {}) {
  const st = { level: 1, from: 1, to: 1, t: 0, ms: 0, flare: null };
  const base = new Map();

  function track(lights) {
    for (const light of Object.values(lights ?? {})) {
      if (isStadiumLight(light) && !base.has(light)) base.set(light, light.intensity / Math.max(st.level, SETTLED));
    }
  }

  /** The lamp banks' (and their beams') level: the dip's, lifted toward the flare's peak by its envelope. */
  function lampLevel() {
    const f = st.flare;
    if (!f) return st.level;
    return st.level + (Math.max(f.peak, st.level) - st.level) * flareEnvelope(f.t / f.ms);
  }

  function apply() {
    for (const [light, full] of base) light.intensity = full * st.level;
    const lamps = lampLevel();
    parts.lamps?.setLevel(lamps);
    parts.shafts?.setLevel(Math.min(1, lamps));                      // the beams never pass DESIGN.md's 6%
    parts.stands?.setLevel(st.level);
    parts.crowd?.material?.color?.setScalar(st.level * (parts.crowd.material.userData?.base ?? 1));
  }

  /** One frame of the dip: true while it still moves. */
  function stepDip(dtMs) {
    if (Math.abs(st.level - st.to) < SETTLED) return false;
    st.t += Math.max(0, dtMs);
    const u = Math.min(1, st.t / st.ms);
    st.level = st.from + (st.to - st.from) * EASE.inOutCubic(u);
    if (u >= 1) st.level = st.to;
    return true;
  }

  /** One frame of the flare: true while it still moves. */
  function stepFlare(dtMs) {
    if (!st.flare) return false;
    st.flare.t += Math.max(0, dtMs);
    if (st.flare.t >= st.flare.ms) st.flare = null;
    return true;
  }

  return {
    /** Ease to `level` over `ms` (at once for 0); `lights` are the moment's named lights. */
    to(level, ms, lights) {
      track(lights);
      Object.assign(st, { from: st.level, to: level, t: 0, ms: Math.max(0, ms) });
      if (!(st.ms > 0)) {
        st.level = level;
        apply();
      }
    },
    /** Flare the lamp banks and their beams to `peak` times full over `ms` and back; nothing without time. */
    flare(peak, ms) {
      if (!(ms > 0) || !Number.isFinite(peak)) return;
      st.flare = { peak, ms, t: 0 };
    },
    update(dtMs) {
      const dipping = stepDip(dtMs);
      const flaring = stepFlare(dtMs);
      if (!dipping && !flaring) return false;
      apply();
      return Math.abs(st.level - st.to) >= SETTLED || st.flare !== null;
    },
    level: () => st.level,
    restore() {
      Object.assign(st, { level: 1, from: 1, to: 1, t: 0, ms: 0, flare: null });
      apply();
      base.clear();
    },
  };
}
