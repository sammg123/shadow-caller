// Under the Lights: the light dip (DESIGN.md motion grammar "Light dip (20%, 300 ms)": at the pre-snap moment the
// stadium lights fall to 80% and come back at the snap; the LED boards and the two broadcast lines keep their
// brightness; surface brief #4; owner W1). One level for every stadium light: the tower spot lights (the scene's
// named lights whose ids begin with "tower"), the lamp banks, the light shafts and the crowd they light. A new target
// eases from wherever the level is (a snap that comes before the dip finished simply turns it round). Each light's
// full intensity is remembered the first time it is seen, and restore() puts every light back (a rebuilt stadium).
import { EASE } from "../../../../field/timing.js";

const SETTLED = 1e-3;

/** The lights the dip touches: the towers' spots (by id), never the sky or the sun. */
export const isStadiumLight = (light) => typeof light?.name === "string" && light.name.startsWith("tower")
  && Number.isFinite(light.intensity);

/**
 * @param {{ lamps?: { setLevel(k: number): void }, shafts?: { setLevel(k: number): void },
 *   stands?: { setLevel(k: number): void }, crowd?: object }} parts
 * @returns {{ to(level, ms, lights?): void, update(dtMs): boolean, level(): number, restore(): void }}
 */
export function createDim(parts = {}) {
  const st = { level: 1, from: 1, to: 1, t: 0, ms: 0 };
  const base = new Map();

  function track(lights) {
    for (const light of Object.values(lights ?? {})) {
      if (isStadiumLight(light) && !base.has(light)) base.set(light, light.intensity / Math.max(st.level, SETTLED));
    }
  }

  function apply() {
    for (const [light, full] of base) light.intensity = full * st.level;
    parts.lamps?.setLevel(st.level);
    parts.shafts?.setLevel(st.level);
    parts.stands?.setLevel(st.level);
    parts.crowd?.material?.color?.setScalar(st.level * (parts.crowd.material.userData?.base ?? 1));
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
    update(dtMs) {
      if (Math.abs(st.level - st.to) < SETTLED) return false;
      st.t += Math.max(0, dtMs);
      const u = Math.min(1, st.t / st.ms);
      st.level = st.from + (st.to - st.from) * EASE.inOutCubic(u);
      if (u >= 1) st.level = st.to;
      apply();
      return u < 1;
    },
    level: () => st.level,
    restore() {
      Object.assign(st, { level: 1, from: 1, to: 1, t: 0, ms: 0 });
      apply();
      base.clear();
    },
  };
}
