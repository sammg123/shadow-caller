// NEUTRAL_LOOK (ui-architecture.md 2.7; owner A10). Pure. The scene look every world starts from: resolveLook
// deep-merges a world's partial look over it. Deliberately plain: a gray, flatly lit field, no bloom, no fog,
// camera modes sideline, end zone and overhead. Positions are field yards [x, y, height] (DC A, coords.toWorld).
import { deepFreeze } from "../core/domain.js";
import { DEFAULT_MOTION } from "../field/timing.js";

const GROUND = "#cfd3d7";
const TURF = ["#7c8b7f", "#768579"];
const WHITE = "#ffffff";

const stroke = (geometry, extra) => ({
  geometry, core: WHITE, edge: "team", opacity: 1, dash: null, ghostedOpacity: 0.35, approx: "dashed", ...extra,
});

export const NEUTRAL_LOOK = deepFreeze({
  id: "neutral",
  version: 1,
  renderer: {
    toneMapping: "neutral", exposure: 1, shadows: "off", shadowMapSize: 1024, antialias: "msaa",
    clear: GROUND, clearAlpha: 1,
  },
  environment: { background: GROUND, fog: null, ibl: null, iblIntensity: 0 },
  lights: [
    { id: "ambient", kind: "ambient", color: WHITE, intensity: 0.6 },
    { id: "sky", kind: "hemisphere", color: "#f2f4f7", groundColor: "#7f8a80", intensity: 0.9 },
    { id: "key", kind: "directional", color: WHITE, intensity: 1.3, position: [30, -40, 80], target: [50, 26.667, 0],
      castShadow: false },
  ],
  field: {
    turf: TURF, stripeYd: 5, paint: "#f4f6f4", paintOpacity: 0.9, surround: "#a3aaa5",
    endZones: "team", endZoneText: "name", numerals: true, hashes: true, plinth: null,
    roughness: 0.95, metalness: 0, grain: 0,
  },
  lines: {
    los: { color: "#2f74d6", widthYd: 0.35, opacity: 1, mode: "paint" },
    ltg: { color: "#e2b100", widthYd: 0.35, opacity: 1, mode: "paint" },
  },
  ball: {
    kind: "football", color: "#7a4a26", accent: WHITE, scale: 1,
    trail: { kind: "ribbon", color: "team", widthPx: 4, fadeMs: 600 },
  },
  strokes: {
    arc: stroke("line2", { widthPx: 4 }),
    ground: stroke("line2", { widthPx: 5 }),
    corridor: stroke("ribbon", { widthYd: 3, opacity: 0.55, ghostedOpacity: 0.25, approx: "soft" }),
    area: stroke("decal", { widthYd: 5, opacity: 0.6, ghostedOpacity: 0.25, approx: "soft" }),
    band: stroke("decal", { opacity: 0.35, ghostedOpacity: 0.2, approx: "hatch" }),
    mark: stroke("decal", { widthYd: 2, ghostedOpacity: 0.4, approx: "soft" }),
  },
  ghost: {
    fill: "neutral", stroke: WHITE, opacity: [0.5, 0.3, 0.18], style: "zone", afterSnapOpacity: 0, labels: true,
  },
  lastPlay: { keep: "until-next-snap", dimOpacity: 0.5 },
  residue: { keep: "drive", opacity: 0.3 },
  labels: { renderer: "css2d", className: "sc-label", result: true },
  post: { bloom: null, extra: [] },
  cameras: {
    modes: [
      { id: "sideline", label: "Sideline", rig: "sideline", fov: 24, height: 32, back: 75, follow: "none", cut: false },
      { id: "endzone", label: "End zone", rig: "endzone", fov: 40, height: 14, back: 30, follow: "none", cut: false },
      { id: "overhead", label: "Overhead", rig: "overhead", fov: 30, height: 100, back: 0, follow: "none", cut: true },
    ],
    default: "sideline", moveMs: 600, ease: "inOutCubic", orbit: null, inset: null,
  },
  motion: { ...DEFAULT_MOTION, ghostInMs: 300, ghostOutMs: 200, verdictMs: 1500 },
  teamColor: { minContrast: 3, against: [TURF[0], GROUND] },
});
