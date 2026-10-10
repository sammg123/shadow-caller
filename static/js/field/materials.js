// The material kit (ui-architecture 2.5; three-recipe 5.2, 10.3; owner A5). One cached material per key, marked shared
// (dispose.js leaves it alone; kit.dispose() frees it once), and the render layers everything on the turf draws in.
//   paint(team)                 teamPaint for a team abbreviation (DC C2), neutral when unknown
//   line("los" | "ltg")         the painted strips; ball() { body, accent }; texture("radial") the soft round mask
// How a play and a shadow play look is play-style.js, built by the action layer (play-art.js, play-strip.js); v1.4
// (G3-9) took out the kit's stroke, edge, fill, ghost and fade, which only the zone, corridor and band drawings used.
// Everything here is on the field, so none of it takes the world's fog (the haze is for the stands).
import * as THREE from "three";
import { teamPaint } from "../theme/team-colors.js";
import { markShared } from "./dispose.js";

/** Draw order and polygon offset for everything coplanar with the turf (recipe 5.2); larger order draws later. */
export const LAYERS = Object.freeze({
  turf: Object.freeze({ order: 0, factor: 0, units: 0 }),
  decal: Object.freeze({ order: 1, factor: -1, units: -2 }),
  graphic: Object.freeze({ order: 3, factor: -2, units: -4 }),
  line: Object.freeze({ order: 5, factor: -2, units: -6 }),
  ring: Object.freeze({ order: 6, factor: -3, units: -8 }),
  shadow: Object.freeze({ order: 7, factor: -3, units: -10 }),
  trail: Object.freeze({ order: 8, factor: 0, units: 0 }),
  glow: Object.freeze({ order: 12, factor: 0, units: 0 }),
});

const RADIAL_SIZE = 64;

function basicOnTurf(color, opacity, layer) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,
    fog: false, polygonOffset: true, polygonOffsetFactor: layer.factor, polygonOffsetUnits: layer.units });
}

/** A soft round mask (the ball's contact shadow, its tracer head): bright in the middle, gone at the rim. */
function radialTexture(size = RADIAL_SIZE) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x - size / 2 + 0.5) / (size / 2);
      const dy = (y - size / 2 + 0.5) / (size / 2);
      const r2 = dx * dx + dy * dy;
      const v = r2 < 1 ? Math.round(255 * Math.exp(-r2 * 3.2) * (1 - r2)) : 0;
      data.set([v, v, v, 255], (y * size + x) * 4);
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// The functions below share one kit context `k` = { look, cache, state: { teams } }.
function cached(k, key, make) {
  if (!k.cache.has(key)) k.cache.set(key, make());
  return k.cache.get(key);
}

const teamOf = (k, abbr) => (typeof abbr === "string" && Object.hasOwn(k.state.teams, abbr) ? k.state.teams[abbr] : null);
const paintOf = (k, abbr) => teamPaint(teamOf(k, abbr), k.look.teamColor.against, k.look.teamColor.minContrast);

function lineOf(k, kind) {
  if (kind !== "los" && kind !== "ltg") throw new TypeError("line() takes los or ltg");
  return cached(k, `line|${kind}`, () => {
    const spec = k.look.lines[kind];
    const m = basicOnTurf(spec.color, spec.opacity, LAYERS.line);
    m.transparent = spec.opacity < 1;
    m.depthTest = spec.mode === "paint";
    m.userData = { ...m.userData, opacity: spec.opacity, style: "solid" };
    return markShared(m);
  });
}

function ballOf(k) {
  const make = (color, roughness) => markShared(new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, fog: false }));
  return cached(k, "ball", () => ({ body: make(k.look.ball.color, 0.55), accent: make(k.look.ball.accent, 0.6) }));
}

function materialsOf(value) {
  if (value?.isMaterial || value?.isTexture) return [value];
  return value && typeof value === "object" ? Object.values(value).filter((v) => v?.isMaterial || v?.isTexture) : [];
}

/**
 * @param {object} look  a resolved Look (theme/look-schema.js)
 * @param {{ teams?: object }} [opts]  teams: the timeline's DC C2 `teams`
 */
export function createKit(look, { teams = {} } = {}) {
  const k = { look, cache: new Map(), state: { teams: teams ?? {} } };
  return {
    paint: (abbr) => paintOf(k, abbr),
    line: (kind) => lineOf(k, kind),
    ball: () => ballOf(k),
    texture(name) {
      if (name !== "radial") throw new TypeError(`no texture called ${String(name)}`);
      return cached(k, "texture|radial", () => markShared(radialTexture()));
    },
    setTeams(next) { k.state.teams = next ?? {}; },
    /** The stage reports every DPR change; nothing in the kit is drawn at a pixel pitch since G3-9. */
    setDpr() {},
    dispose() {
      for (const value of k.cache.values()) for (const r of materialsOf(value)) r.dispose();
      k.cache.clear();
    },
  };
}
