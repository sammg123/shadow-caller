// The material kit (ui-architecture 2.5; three-recipe 5.2, 7.3, 8.3, 10.3; owner A5). One cached material per
// key, marked shared (dispose.js leaves it alone; kit.dispose() frees it once). Layers build geometry and take
// their materials from here, so a world restyles every stroke through its Look and no layer picks a color.
//   paint(team)                 teamPaint for a team abbreviation (DC C2), neutral when unknown
//   stroke(role, team, opts)    a path's light core: the team color mixed 65% toward look.strokes[role].core
//   edge(role, team, opts)      its team-colored edge (a wider line or fill drawn under the core)
//   fill(role, team, opts)      a ground fill in the team's own color (areas, bands)
//   ghost(rank, family, opts)   { fill, stroke } for a prediction zone in look.ghost's style, opacity by rank
//   line("los" | "ltg")         the painted strips; ball() { body, accent }; texture("radial" | "halo")
// Everything here is on the field, so none of it takes the world's fog (the haze is for the stands).
// opts: { ghosted } a nullified play (look ghostedOpacity, colors mixed toward gray); { approx } an estimate, drawn
// in look.strokes[role].approx: dashed (lines), hatch, pixel (a checkerboard of 1-yard cells) or soft.
import * as THREE from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { mixHex, teamPaint } from "../theme/team-colors.js";
import { markShared } from "./dispose.js";
import { setHatchDpr, setOpacity, turfMarkMaterial } from "./shaders.js";

/** Draw order and polygon offset for everything coplanar with the turf (recipe 5.2); larger order draws later. */
export const LAYERS = Object.freeze({
  turf: Object.freeze({ order: 0, factor: 0, units: 0 }),
  decal: Object.freeze({ order: 1, factor: -1, units: -2 }),
  ghostZone: Object.freeze({ order: 2, factor: -1, units: -3 }),
  graphic: Object.freeze({ order: 3, factor: -2, units: -4 }),
  line: Object.freeze({ order: 5, factor: -2, units: -6 }),
  ring: Object.freeze({ order: 6, factor: -3, units: -8 }),
  shadow: Object.freeze({ order: 7, factor: -3, units: -10 }),
  trail: Object.freeze({ order: 8, factor: 0, units: 0 }),
  burst: Object.freeze({ order: 9, factor: 0, units: 0 }),
  ghostLine: Object.freeze({ order: 10, factor: 0, units: 0 }),
  ghostHead: Object.freeze({ order: 11, factor: 0, units: 0 }),
  glow: Object.freeze({ order: 12, factor: 0, units: 0 }),
});

const CORE_MIX = 0.65;          // The Light Core Rule
const GHOSTED_GRAY = "#8a8f96";
const GHOSTED_MIX = 0.6;        // recipe 7.3: colors mixed 60% toward gray
const SOFT = 0.55;              // approx "soft": this share of the stroke's opacity
const EDGE_WIDTH = 2.2;         // a line2 edge is this many times the core's width
const DASH_YD = Object.freeze([1.1, 0.7]);
const TEXTURE_SIZE = Object.freeze({ radial: 64, halo: 128 });

const roleLayer = (role) => (role === "corridor" || role === "band" ? LAYERS.ghostZone : role === "mark" ? LAYERS.ring
  : LAYERS.shadow);

function basicOnTurf(color, opacity, layer) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,
    fog: false, polygonOffset: true, polygonOffsetFactor: layer.factor, polygonOffsetUnits: layer.units });
}

function radialData(size) {
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
  return data;
}

function haloData(size) {
  const data = new Uint8Array(size * 4 * 4);
  for (let x = 0; x < size; x += 1) {
    const d = (x - (size - 1) / 2) / ((size - 1) / 2);
    const v = Math.round(255 * Math.exp(-d * d * 5));
    for (let y = 0; y < 4; y += 1) data.set([v, v, v, 255], (y * size + x) * 4);
  }
  return data;
}

function maskTexture(name) {
  const size = TEXTURE_SIZE[name];
  const tex = name === "radial" ? new THREE.DataTexture(radialData(size), size, size)
    : new THREE.DataTexture(haloData(size), size, 4);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// The functions below share one kit context `k` = { look, cache, state: { teams, dpr } }.
function cached(k, key, make, teamKey = false) {
  if (!k.cache.has(key)) k.cache.set(key, { value: make(), team: teamKey });
  return k.cache.get(key).value;
}

const teamOf = (k, abbr) => (typeof abbr === "string" && Object.hasOwn(k.state.teams, abbr) ? k.state.teams[abbr] : null);
const paintOf = (k, abbr) => teamPaint(teamOf(k, abbr), k.look.teamColor.against, k.look.teamColor.minContrast);
const ghostedHex = (hex, ghosted) => (ghosted ? mixHex(hex, GHOSTED_GRAY, GHOSTED_MIX) : hex);
const flagsKey = (opts) => `${Boolean(opts.ghosted)}|${Boolean(opts.approx)}`;

function edgeHex(k, role, abbr) {
  const spec = k.look.strokes[role].edge;
  const p = paintOf(k, abbr);
  return spec === "team" ? p.edge : spec === "team-alt" ? p.alt : spec;
}

function strokeOpacity(spec, { ghosted, approx }) {
  const base = ghosted ? spec.ghostedOpacity : spec.opacity;
  return approx && spec.approx === "soft" ? base * SOFT : base;
}

function lineMaterial(spec, hex, opacity, { approx, width }) {
  const dashed = Boolean(spec.dash) || (approx && spec.approx !== "soft");
  const [dashSize, gapSize] = spec.dash ?? DASH_YD;
  const m = new LineMaterial({ color: new THREE.Color(hex), linewidth: width, worldUnits: false, transparent: true,
    opacity, depthWrite: false, dashed, dashSize, gapSize, fog: false });
  m.userData = { ...m.userData, opacity, style: dashed ? "dashed" : "solid" };
  return m;
}

function meshMaterial(k, role, spec, hex, opacity, approx) {
  const layer = roleLayer(role);
  if (spec.geometry === "tube" && !(approx && spec.approx !== "soft")) {
    const m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.45, metalness: 0, transparent: opacity < 1,
      opacity, fog: false });
    m.userData = { ...m.userData, opacity, style: "solid" };
    return m;
  }
  if (approx && (spec.approx === "pixel" || spec.approx === "hatch" || spec.approx === "dashed")) {
    const kind = spec.approx === "pixel" ? "grid" : "hatch";
    const m = turfMarkMaterial(kind, { color: hex, opacity, layer, checker: kind === "grid" });
    m.userData = { ...m.userData, style: spec.approx };
    setHatchDpr(m, k.state.dpr);
    return m;
  }
  const m = basicOnTurf(hex, opacity, layer);
  m.userData = { ...m.userData, opacity, style: "solid" };
  return m;
}

function strokeOf(k, role, hex, opts, width) {
  const spec = k.look.strokes[role];
  if (!spec) throw new TypeError(`no stroke role ${String(role)}`);
  const o = { ghosted: Boolean(opts.ghosted), approx: Boolean(opts.approx) };
  const color = ghostedHex(hex, o.ghosted);
  const opacity = strokeOpacity(spec, o);
  if (spec.geometry === "line2") return lineMaterial(spec, color, opacity, { approx: o.approx, width: width(spec) });
  return meshMaterial(k, role, spec, color, opacity, o.approx);
}

function fillOf(k, role, team, opts) {
  const spec = k.look.strokes[role];
  const m = basicOnTurf(ghostedHex(paintOf(k, team).fill, opts.ghosted), strokeOpacity(spec, opts), roleLayer(role));
  m.userData = { ...m.userData, opacity: m.opacity, style: "solid" };
  return markShared(m);
}

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

function setTeams(k, next) {
  k.state.teams = next ?? {};
  for (const [key, entry] of [...k.cache.entries()]) {
    if (!entry.team) continue;
    disposeValue(entry.value);
    k.cache.delete(key);
  }
}

/**
 * @param {object} look  a resolved Look (theme/look-schema.js)
 * @param {{ teams?: object, dpr?: number }} [opts]  teams: the timeline's DC C2 `teams`
 */
export function createKit(look, { teams = {}, dpr = 1 } = {}) {
  const k = { look, cache: new Map(), state: { teams: teams ?? {}, dpr } };
  const coreWidth = (s) => s.widthPx ?? 3;
  const edgeWidth = (s) => (s.widthPx ?? 3) * EDGE_WIDTH;
  return {
    paint: (abbr) => paintOf(k, abbr),
    stroke: (role, team, opts = {}) => cached(k, `stroke|${role}|${team}|${flagsKey(opts)}`, () => markShared(strokeOf(k,
      role, mixHex(edgeHex(k, role, team), look.strokes[role].core, CORE_MIX), opts, coreWidth)), true),
    edge: (role, team, opts = {}) => cached(k, `edge|${role}|${team}|${flagsKey(opts)}`,
      () => markShared(strokeOf(k, role, edgeHex(k, role, team), opts, edgeWidth)), true),
    fill: (role, team, opts = {}) => cached(k, `fill|${role}|${team}|${flagsKey(opts)}`, () => fillOf(k, role, team, opts), true),
    ghost: (rank, family, opts = {}) => cached(k, `ghost|${rank}|${family}|${opts.team ?? ""}`,
      () => ghostPair(look, rank, opts.team ? paintOf(k, opts.team) : null, k.state.dpr, markShared), Boolean(opts.team)),
    line: (kind) => lineOf(k, kind),
    ball: () => ballOf(k),
    texture(name) {
      if (!Object.hasOwn(TEXTURE_SIZE, name)) throw new TypeError(`no texture called ${String(name)}`);
      return cached(k, `texture|${name}`, () => markShared(maskTexture(name)));
    },
    fade: (material, f) => setOpacity(material, f),
    setTeams: (next) => setTeams(k, next),
    setDpr(next) {
      k.state.dpr = next;
      for (const { value } of k.cache.values()) for (const m of materialsOf(value)) setHatchDpr(m, next);
    },
    dispose() {
      for (const { value } of k.cache.values()) disposeValue(value);
      k.cache.clear();
    },
  };
}

function materialsOf(value) {
  if (value?.isMaterial || value?.isTexture) return [value];
  return value && typeof value === "object" ? Object.values(value).filter((v) => v?.isMaterial || v?.isTexture) : [];
}

function disposeValue(value) {
  for (const r of materialsOf(value)) r.dispose();
}

/** { fill, stroke } for ghost rank 1 to 3 in look.ghost's style. fill.userData.opacity is the rank's opacity. */
function ghostPair(look, rank, teamPaintValue, dpr, own) {
  const g = look.ghost;
  const opacity = g.opacity[Math.min(3, Math.max(1, rank)) - 1];
  const fillHex = g.fill === "team" ? (teamPaintValue?.edge ?? g.stroke) : g.fill === "neutral" ? g.stroke : g.fill;
  const kind = g.style === "pixel" ? "grid" : g.style === "hatch" ? "hatch" : "zone";
  const fillOpacity = g.style === "outline" ? 0 : opacity;
  const fill = turfMarkMaterial(kind, { color: fillHex, opacity: fillOpacity, layer: LAYERS.ghostZone,
    feather: g.style === "marker" ? 0.02 : 0.08 });
  fill.userData = { ...fill.userData, opacity: fillOpacity };
  setHatchDpr(fill, dpr);
  const stroke = new LineMaterial({ color: new THREE.Color(g.stroke), linewidth: rank === 1 ? 2.5 : 1.5, worldUnits: false,
    transparent: true, opacity, depthWrite: false, dashed: false, fog: false });
  stroke.userData = { ...stroke.userData, opacity, style: "solid" };
  return { fill: own(fill), stroke: own(stroke) };
}
