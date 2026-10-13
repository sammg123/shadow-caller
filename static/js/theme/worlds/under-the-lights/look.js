// Under the Lights: the scene look (DESIGN.md "The stadium (3D art direction)", "Plays on the field", Colors;
// docs/design/play-drawing.md; ui-architecture.md 2.7, 14.6, 20.4; owner W1). A partial Look that resolveLook merges
// over NEUTRAL_LOOK: the bowl at night under four tower banks (only the two home-side towers cast shadows), the field
// lit brightest at its center, bowl-haze FogExp2 for the stands (the field itself never takes fog), bloom above 1.05
// only, so the tower lamps, the LED fascia and the ball's tracer are the only things that glow. Every drawn path has
// a light core (light-cone white) with the team color on its edge (The Light Core Rule), and the shadow plays are thin
// dashed lines, his #1 in LED amber and #2 in LED warm white, the previous play beside them in muted steel
// (play-drawing.md 4b). look.world.day re-lights a day kickoff in afternoon sun; look.world.plays tunes the action
// layer (play-style PLAY_LOOK); look.world.uls is this world's own data for props.js and moments.js. Pure data.
import { deepFreeze } from "../../../core/domain.js";
import { DEFAULT_MOTION } from "../../../field/timing.js";

/** DESIGN.md colors (frontmatter), lowercase as the look schema writes hex. */
export const ULS = Object.freeze({
  nightSky: "#0d1424", bowlHaze: "#26314c", lightCone: "#f4f1e6", turfDark: "#3f8c3b", turfLight: "#46983f",
  paint: "#f5f7f2", ltg: "#ffd400", los: "#4a90ff", daySky: "#a9c4df", dayHaze: "#d6e0ea", sun: "#fff1da",
  ledPanel: "#0f1114", ledUnlit: "#2a2622", ledWarm: "#fff3d1", ledGold: "#ffd27a", ledAmber: "#ffb21e",
  fasciaSteel: "#1c2333", steelRaised: "#283149", steelSeam: "#2e374d", steelEdge: "#4a5571",
  tallyRed: "#ff4d3d", lampGreen: "#7ddb6a",
  // 4b: the previous play while his next call is up, a muted slate with a steel edge (never amber or warm white): the
  // steel frame #6f7c9d mixed 40% toward LED warm white, as the plates' CSS mixes it
  lastSlate: "#a9acb2",
});

/** The four light towers, in field yards [x, y, height] (x from the caller's goal line, y from the home sideline).
 * The two home-side towers (y < 0, behind the default camera) are the only shadow casters (DESIGN.md: 2 at most). */
export const TOWERS = Object.freeze([
  Object.freeze({ id: "tower-home-left", at: Object.freeze([-46, -43.3, 50]), aim: Object.freeze([44, 30, 0]), cast: true }),
  Object.freeze({ id: "tower-home-right", at: Object.freeze([146, -43.3, 50]), aim: Object.freeze([56, 30, 0]), cast: true }),
  Object.freeze({ id: "tower-far-left", at: Object.freeze([-48, 110.7, 52]), aim: Object.freeze([44, 23, 0]), cast: false }),
  Object.freeze({ id: "tower-far-right", at: Object.freeze([148, 110.7, 52]), aim: Object.freeze([56, 23, 0]), cast: false }),
]);

const TOWER_INTENSITY = 29000;
const TOWER_ANGLE = 0.39;
const TOWER_PENUMBRA = 1;

const spot = (t) => ({ id: t.id, kind: "spot", color: ULS.lightCone, intensity: TOWER_INTENSITY, position: [...t.at],
  target: [...t.aim], castShadow: t.cast, angle: TOWER_ANGLE, penumbra: TOWER_PENUMBRA });

const stroke = (geometry, extra) => ({ geometry, core: ULS.lightCone, edge: "team", opacity: 1, dash: null,
  ghostedOpacity: 0.38, approx: "dashed", ...extra });

/** Afternoon sun from the west-southwest, about 30 degrees up, low behind the far stands on the left, so the
 * upper deck's rim lays its shadow line across the far part of the field (field yards). */
export const SUN = Object.freeze({ at: Object.freeze([-20.6, 189.1, 93.8]), aim: Object.freeze([50, 26.667, 0]) });

/** A day kickoff (timeline game.light === "day"): sun and sky instead of the towers (stage.js lookForGame). */
const DAY = {
  renderer: { exposure: 1, shadows: "pcf", shadowMapSize: 2048 },
  environment: { background: ULS.daySky, fog: { kind: "exp2", color: ULS.dayHaze, density: 0.0021 }, ibl: "room",
    iblIntensity: 0.18 },
  lights: [
    { id: "sky", kind: "hemisphere", color: "#d4e3f4", groundColor: "#4c6a3d", intensity: 1.2 },
    { id: "sun", kind: "directional", color: ULS.sun, intensity: 2.6, position: [...SUN.at], target: [...SUN.aim],
      castShadow: true },
  ],
};

/** look.world.uls: what props.js and moments.js read (plain data; the schema keeps `world` JSON-only). */
const WORLD_ULS = {
  dip: { level: 0.8, ms: 300 },                        // DESIGN.md: the stadium lights fall to 80% in 300 ms
  // LED steps at 12 fps, 5 frames (DESIGN.md motion grammar); G3-6: the next call steps in over a play's words once
  // they have been up dwellMs
  ribbons: { stepMs: 83, steps: 5, holdTdMs: 3200, dwellMs: 1500 },
  flare: { peak: 1.15, ms: 300 },                       // G3-7: the lamp banks when he is right or on a touchdown
};

export const look = deepFreeze({
  id: "under-the-lights",
  version: 1,
  renderer: { toneMapping: "neutral", exposure: 1, shadows: "pcf", shadowMapSize: 2048, antialias: "msaa",
    clear: ULS.nightSky, clearAlpha: 1 },
  environment: { background: ULS.nightSky, fog: { kind: "exp2", color: ULS.bowlHaze, density: 0.0028 }, ibl: "room",
    iblIntensity: 0.06 },
  lights: [
    { id: "sky", kind: "hemisphere", color: "#7f94c4", groundColor: "#10241a", intensity: 0.24 },
    ...TOWERS.map(spot),
  ],
  field: { turf: [ULS.turfDark, ULS.turfLight], stripeYd: 5, paint: ULS.paint, paintOpacity: 0.94, surround: "#2c5a2d",
    endZones: "team", endZoneText: "name", numerals: true, hashes: true, plinth: null, roughness: 0.84, metalness: 0,
    grain: 0.38 },
  lines: {
    los: { color: ULS.los, widthYd: 0.45, opacity: 1, mode: "paint" },
    ltg: { color: ULS.ltg, widthYd: 0.45, opacity: 1, mode: "paint" },
  },
  ball: { kind: "football", color: "#6e3b1c", accent: "#f5f7f2", scale: 2.2,
    trail: { kind: "spark", color: "team", widthPx: 3, fadeMs: 400 } },
  strokes: {
    arc: stroke("line2", { widthPx: 4.5 }),
    ground: stroke("ribbon", { widthYd: 0.62 }),
    mark: stroke("decal", { widthYd: 2.4, ghostedOpacity: 0.42, approx: "soft" }),
  },
  // The shadow plays: thin and dashed (play-drawing.md 4b), never team-colored (DESIGN.md), colour-coded by rank on
  // the board's ramp (world.plays.ranks): #1 amber, #2 warm white. The previous play dims to muted steel.
  ghost: { fill: "neutral", stroke: ULS.ledWarm, style: "outline", afterSnapOpacity: 0, labels: true },
  lastPlay: { keep: "until-next-snap", dimOpacity: 0.6 },
  residue: { keep: "drive", opacity: 0.16 },
  labels: { renderer: "css2d", className: "sc-label", result: true },
  post: { bloom: { strength: 0.55, radius: 0.5, threshold: 1.05 }, extra: ["uls-lens"] },
  // restructure-v2.md 4: two views only, toggled by V: Wide (the TV angle, the default; it follows the ball sideways
  // while a play runs) and Blimp (the overhead stadium view). No Tight, and no move of the camera's own.
  cameras: {
    modes: [
      { id: "wide", label: "Wide", rig: "sideline", fov: 20, height: 38, back: 82, follow: "pan", cut: false },
      { id: "blimp", label: "Blimp", rig: "blimp", fov: 30, height: 300, back: 140, follow: "none", cut: false },
    ],
    default: "wide", moveMs: 1100, ease: "inOutCubic", orbit: null, inset: null,
  },
  motion: { ...DEFAULT_MOTION, minRowMs: 1800, ghostInMs: 400, ghostOutMs: 300, verdictMs: 1500 },
  teamColor: { minContrast: 3, against: [ULS.turfDark, ULS.nightSky] },
  world: {
    day: DAY,
    // 4b: his predictions thin (2.5 px at 1440x900) and dashed, #1 LED amber and #2 LED warm white, each over a thin
    // night-sky ring (1.5 px each side) so the dashes hold over white paint and a light midfield logo: at 0.9 the
    // edge stays 4.5:1 or more against white, paint white, light gray and silver (shadow-style.test.mjs); flat, never a
    // glow. The previous play in steel while they are up
    plays: { headGlow: 3, headYd: 1.5, trackOpacity: 0.2, trackWidthPx: 1.5, trackDash: [0.5, 0.9], arrowYd: 1.8,
      hoverOpacity: 0.95, dimOthers: 0.45, shadowPx: 2.5, shadowDash: [0.7, 0.4], targetYd: 0.75, kickDim: 0.25,
      tones: { good: ULS.lampGreen, bad: ULS.tallyRed, warn: ULS.ltg },
      ranks: [ULS.ledAmber, ULS.ledWarm], last: { core: ULS.lastSlate, edge: ULS.steelEdge },
      casing: { color: ULS.nightSky, opacity: 0.9, width: 2.2 } },
    uls: WORLD_ULS,
  },
});

export default look;
