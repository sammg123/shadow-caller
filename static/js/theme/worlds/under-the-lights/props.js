// Under the Lights: the stadium (DESIGN.md "The stadium (3D art direction)"; ui-architecture.md 2.7 props, 14.6;
// owner W1). Called by the engine at every setGameFrame with { THREE, coords, field, teams, look, kickoff, light,
// paint, ambient, requestRender }; returns { object, update(dtMs), dispose() }. The full bowl at night: the stands
// and the four towers' steel (one draw call), the crowd (one), the LED fascia ribbons (one), the lamp banks (one) and
// the towers' light shafts (one); by day the lamps are dark glass, the shafts are gone and the rim caster draws the
// stands' shadow line across the field. The engine's field (turf, paint, end zones, wordmarks, logo, posts, pylons)
// sits inside it. object.userData.uls hands the moments (moments.js) the parts they drive: the light dip, the
// ribbons' messages and the camera choreography; update() runs them after the camera rig each frame, and keeps the
// render loop alive only while something moves (0 frames at rest, ui-architecture 6.1).
import { safeLogoUrl } from "../../../core/domain.js";
import { createChoreo } from "./stadium/choreo.js";
import { createCrowd } from "./stadium/crowd.js";
import { createDim } from "./stadium/dim.js";
import { createRimCaster, createShafts } from "./stadium/air.js";
import { gameMessage, idleMessage } from "./stadium/messages.js";
import { createRibbons } from "./stadium/ribbons.js";
import { createStands } from "./stadium/stands.js";
import { createLamps, towerFrame, towerLights } from "./stadium/towers.js";
import { TOWERS, ULS } from "./look.js";
import { lensPass } from "./shaders/grade.js";
import { gpuName, isSoftwareGpu } from "../../../field/webgl-support.js";

export const STADIUM = "uls-stadium";

/** The towers as spot-light-shaped specs: the look's when it lights the night, else (a day look) this world's own. */
function towerSpecs(look) {
  const spots = towerLights(look);
  return spots.length ? spots : TOWERS.map((t) => ({ id: t.id, position: [...t.at], target: [...t.aim], angle: 0.6 }));
}

function sidesOf(field, teams) {
  const abbrs = Object.keys(teams ?? {});
  const home = typeof field?.home === "string" && abbrs.includes(field.home) ? field.home : abbrs[1] ?? null;
  return { home, away: abbrs.find((a) => a !== home) ?? null, abbrs };
}

const docOf = () => globalThis.document ?? null;
const reducedNow = () => docOf()?.documentElement?.getAttribute?.("data-motion") === "reduced";
const LITE = new WeakMap();

/** A software rasterizer (the engine's low tier, three-recipe 10.4): DESIGN.md's tiers drop the light shafts first,
 * then the crowd; the stands go unlit and the lens pass is skipped. Probed once per document. */
export function liteGpu(doc = docOf()) {
  if (!doc) return false;
  if (!LITE.has(doc)) LITE.set(doc, isSoftwareGpu(gpuName(doc)));
  return LITE.get(doc);
}

function buildParts(ctx, day, lite) {
  const { THREE, look, field, teams } = ctx;
  const specs = towerSpecs(look);
  const frames = specs.map(towerFrame);
  const sides = sidesOf(field, teams);
  const logos = sides.abbrs.map((a) => safeLogoUrl(teams[a]?.logo_dark) ?? safeLogoUrl(teams[a]?.logo)).filter(Boolean);
  const requestRender = typeof ctx.requestRender === "function" ? ctx.requestRender : () => {};
  return {
    stands: createStands(THREE, frames, { day, lite }),
    crowd: lite ? null : createCrowd(THREE, { home: teams?.[sides.home], away: teams?.[sides.away] }, { day }),
    ribbons: createRibbons(THREE, { doc: docOf(), requestRender, instant: reducedNow, logos }),
    lamps: createLamps(THREE, frames, { color: ULS.lightCone, day }),
    shafts: day || lite ? null : createShafts(THREE, specs, { color: ULS.lightCone }),
    caster: day ? createRimCaster(THREE, look) : null,
    frame: { field, teams, teamOrder: [sides.away, sides.home].filter(Boolean) },
    requestRender,
  };
}

function controllerOf(parts, look) {
  const timing = look.world?.uls?.camera ?? {};
  const dim = createDim({ lamps: parts.lamps, shafts: parts.shafts, crowd: parts.crowd, stands: parts.stands });
  const choreo = createChoreo({ timing, reduced: reducedNow, requestRender: parts.requestRender });
  return Object.freeze({ dim, choreo, ribbons: parts.ribbons, frame: parts.frame, look, requestRender: parts.requestRender,
    dip: look.world?.uls?.dip ?? { level: 0.8, ms: 300 } });
}

/**
 * @param {{ THREE: object, field: object | null, teams: object | null, look: object, light?: string,
 *   requestRender?: () => void }} ctx
 * @returns {{ object: THREE.Group, update(dtMs: number): boolean, dispose(): void }}
 */
export function props(ctx) {
  const { THREE } = ctx;
  const day = ctx.light === "day";
  const parts = buildParts(ctx, day, liteGpu());
  const object = new THREE.Group();
  object.name = STADIUM;
  object.add(parts.stands.mesh, parts.ribbons.mesh, parts.lamps.mesh);
  if (parts.crowd) object.add(parts.crowd);
  if (parts.shafts) object.add(parts.shafts.mesh);
  if (parts.caster) object.add(parts.caster.mesh);
  const uls = controllerOf(parts, ctx.look);
  object.userData.uls = uls;
  parts.ribbons.show("A", idleMessage());
  parts.ribbons.show("B", gameMessage(parts.frame));
  return {
    object,
    update(dtMs) {
      const a = parts.ribbons.update(dtMs);
      const b = uls.dim.update(dtMs);
      const c = uls.choreo.update(dtMs);
      return a || b || c;
    },
    dispose() {
      uls.choreo.reset();
      uls.dim.restore();
      parts.ribbons.dispose();
      parts.lamps.dispose();
      parts.shafts?.dispose();
      parts.caster?.dispose();
      parts.stands.dispose();
      parts.crowd?.geometry.dispose();
      parts.crowd?.material.dispose();
      object.removeFromParent();
    },
  };
}

/** World passes named in look.post.extra (ui-architecture 14.6): the lens falloff on the free area. */
export const passes = Object.freeze({
  "uls-lens": ({ THREE, camera }) => {
    const pass = lensPass(THREE, { camera, strength: 0.32, inner: 0.32, outer: 1.0 });
    pass.enabled = !liteGpu();
    return pass;
  },
});

export default props;
