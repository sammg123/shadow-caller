// Under the Lights (DESIGN.md; docs/design/direction-contract.md; directions.md Direction 5): the stadium is the
// interface. The WorldModule (ui-architecture.md 2.7, 9.4; owner W3). It brings W1's scene modules when they exist
// (look.js, props.js, moments.js in this folder) and, until look.js lands, a palette-only look on the neutral one, so
// the world loads either way. A W1 module that is missing is skipped quietly; one that exists but fails to load is
// reported (reportError) and skipped, so a scene bug never takes the HUD down with it.
import { resolveLook } from "../../look-schema.js";
import { INSET_EVENT, LAYOUT_ID, arrange, hudInsets, readHudInsets } from "./arrange.js";

export { INSET_EVENT, LAYOUT_ID, hudInsets, readHudInsets };

const ID = "under-the-lights";
const CSS = (name) => `/static/css/worlds/${ID}/${name}.css`;
const FONT = (path) => `/static/fonts/${ID}/${path}`;
// v1.4 (W2): the HUD component skins under components/, after W3's sheets; masthead first (the shared keys and lamps).
// v1.5 (G4-1): "board", the video board's other faces, after the call's skin. restructure-v2.md 1: only what the
// GameCast shows (the Model Report links the boards it reuses itself: static/js/report/world.js).
const W2_SKINS = Object.freeze(["masthead", "prediction", "board", "scoreboard", "play-feed", "drive-chart", "win-prob",
  "toast", "conn-banner", "boot-screen", "field-host"]);
/** The settings menu's lamp switches (booth.css) and the board's previous play (last-play.css). */
const W4_BOOTH = Object.freeze(["booth", "components/last-play"]);
/** restructure-v2.md 2: the top bar's playback and its progress bar. */
const W5_DECK = Object.freeze(["components/watch-transport"]);

// DESIGN.md colors (frontmatter), lowercase as the look schema writes hex.
const NIGHT_SKY = "#0d1424";
const BOWL_HAZE = "#26314c";
const TURF = Object.freeze(["#3f8c3b", "#46983f"]);

/** The palette on the neutral look: what the scene shows before W1's look.js lands. */
const FALLBACK_PARTIAL = Object.freeze({
  id: ID,
  renderer: { clear: NIGHT_SKY },
  environment: { background: NIGHT_SKY, fog: { kind: "exp2", color: BOWL_HAZE, density: 0.0035 } },
  field: { turf: [...TURF], paint: "#f5f7f2", surround: BOWL_HAZE },
  lines: {
    los: { color: "#4a90ff", widthYd: 0.4, opacity: 1, mode: "paint" },
    ltg: { color: "#ffd400", widthYd: 0.4, opacity: 1, mode: "paint" },
  },
  teamColor: { minContrast: 3, against: [TURF[0], NIGHT_SKY] },
});

export const FALLBACK_LOOK = Object.freeze({ partial: FALLBACK_PARTIAL, full: resolveLook(FALLBACK_PARTIAL) });

const MISSING = /dynamically imported module|Failed to fetch|Importing a module script failed|Cannot find module/i;
const MOMENT_HOOKS = Object.freeze(["presnap", "snap", "verdict", "possession"]);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isFn = (v) => typeof v === "function";
const firstOf = (mod, names, ok) => names.map((n) => mod?.[n]).find(ok) ?? null;

/**
 * Load a module that may not exist yet: missing resolves null quietly; one that exists but fails to load or throws is
 * passed to `report` (the page's reportError, so it shows in the console), then null.
 */
export async function optional(load, report = globalThis.reportError) {
  try {
    return await load();
  } catch (err) {
    const missing = err?.code === "ERR_MODULE_NOT_FOUND" || (err instanceof TypeError && MISSING.test(err.message));
    if (!missing && typeof report === "function") report(err);
    return null;
  }
}

/** W1's moments: an object export, or the hooks themselves exported by name (ui-architecture 2.7). */
function momentsOf(mod) {
  const named = Object.fromEntries(MOMENT_HOOKS.filter((k) => isFn(mod?.[k])).map((k) => [k, mod[k]]));
  return firstOf(mod, ["moments", "MOMENTS", "default"], isObj) ?? (Object.keys(named).length ? named : null);
}

/**
 * The scene parts W1's modules give (any namespace may be null): look.js exports `look` (or LOOK, or default),
 * props.js `props` (or default), moments.js `moments` (or default, or presnap/snap/verdict/possession by name);
 * `passes` may come from look.js or props.js.
 */
export function sceneParts({ look = null, props = null, moments = null } = {}) {
  return Object.freeze({
    look: firstOf(look, ["look", "LOOK", "default"], isObj),
    props: firstOf(props, ["props", "default"], isFn),
    moments: momentsOf(moments),
    passes: firstOf(look, ["passes"], isObj) ?? firstOf(props, ["passes"], isObj),
  });
}

const [lookMod, propsMod, momentsMod] = await Promise.all([
  optional(() => import("./look.js")),
  optional(() => import("./props.js")),
  optional(() => import("./moments.js")),
]);
const w1 = sceneParts({ look: lookMod, props: propsMod, moments: momentsMod });

/** "w1" when the scene look is W1's look.js, "fallback" while it is the palette-only look. */
export const LOOK_SOURCE = w1.look ? "w1" : "fallback";

export const world = Object.freeze({
  id: ID,
  label: "Under the Lights",
  look: w1.look ?? FALLBACK_PARTIAL,
  // Cascade order: W3's tokens, layout and motion, then the component skins (W2, W4, W5) as they land.
  css: Object.freeze([CSS("tokens"), CSS("layout"), CSS("motion"), ...W2_SKINS.map((n) => CSS(`components/${n}`)),
    ...W4_BOOTH.map((n) => CSS(n)), ...W5_DECK.map((n) => CSS(n))]),
  fonts: Object.freeze([
    FONT("big-shoulders-display/big-shoulders-display-latin.woff2"),
    FONT("big-shoulders-text/big-shoulders-text-latin.woff2"),
    FONT("doto/doto-latin-800-rond60.woff2"),
  ]),
  arrange,
  ...(w1.props ? { props: w1.props } : {}),
  ...(w1.moments ? { moments: w1.moments } : {}),
  ...(w1.passes ? { passes: w1.passes } : {}),
  ambient: "dark",
  hudInsets: () => readHudInsets(globalThis.document),
});

export default world;
