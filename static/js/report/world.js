// The Model Report's worlds (pure). A world here is only what this page needs: its tokens and the skins of the boards
// the report reuses, then the report's own skin last, so it wins ties. The ids, the default, the order of choice and
// each world's team-paint rule are the GameCast's (theme/worlds/index.js, theme/registry.js, each world's look; a test
// holds them equal), but this module imports none of them: their loaders and looks reach each world's scene and the
// field's modules, and this page ships no 3D engine, not even one import away. Each path stays inside its world's
// folders, as theme/apply.js checks.

const ULS = "under-the-lights";
/** The world the app opens in (theme/worlds/index.js DEFAULT_WORLD) and the one it falls back to. */
export const REPORT_DEFAULT_WORLD = ULS;
const FALLBACK = "neutral";
const ulsCss = (name) => `/static/css/worlds/${ULS}/${name}.css`;
const ulsFont = (path) => `/static/fonts/${ULS}/${path}`;

/** The Under the Lights skins the report reuses: the shared LED parts (key caps, lamps, LED numerals and cells in the
 * masthead skin; digit windows in the scoreboard skin), then each reused board's own skin, then the report's two. */
const ULS_PARTS = Object.freeze(["tokens", "motion", "components/masthead", "components/scoreboard",
  "components/boot-screen", "components/conn-banner", "components/scorecard", "components/tendencies",
  "components/win-prob", "components/drive-chart", "components/box-score", "report/report", "report/boards"]);

export const REPORT_WORLDS = Object.freeze({
  [ULS]: Object.freeze({
    id: ULS,
    label: "Under the Lights",
    css: Object.freeze(ULS_PARTS.map(ulsCss)),
    fonts: Object.freeze([
      ulsFont("big-shoulders-display/big-shoulders-display-latin.woff2"),
      ulsFont("big-shoulders-text/big-shoulders-text-latin.woff2"),
      ulsFont("doto/doto-latin-800-rond60.woff2"),
    ]),
    ambient: "dark",
    // the world's team-paint rule (theme/worlds/under-the-lights/look.js teamColor): turf dark and the night sky
    teamColor: Object.freeze({ minContrast: 3, against: Object.freeze(["#3f8c3b", "#0d1424"]) }),
  }),
  neutral: Object.freeze({
    id: "neutral",
    label: "Neutral",
    css: Object.freeze(["/static/css/worlds/neutral/tokens.css"]),
    fonts: Object.freeze([]),
    ambient: null,
    // the neutral look's rule (theme/neutral-look.js teamColor): its turf and its ground
    teamColor: Object.freeze({ minContrast: 3, against: Object.freeze(["#7c8b7f", "#cfd3d7"]) }),
  }),
});

const known = (id) => typeof id === "string" && Object.hasOwn(REPORT_WORLDS, id);

/** The report's world for an id; an id the report doesn't know is the plain world. */
export function reportWorld(id) {
  return known(id) ? REPORT_WORLDS[id] : REPORT_WORLDS[FALLBACK];
}

/**
 * The world to open in, in the GameCast's order (theme/registry.js chooseWorldId): ?world=, then the stored choice
 * (sc:world), then the default. `ignored` lists the ids given that no world has, for a notice.
 * @param {{ query?: string | null, stored?: string | null }} choice  shell/prefs.js readBootPrefs().world
 */
export function chooseReportWorld({ query = null, stored = null } = {}) {
  const ignored = [query, stored].filter((v) => typeof v === "string" && v !== "" && !known(v));
  const id = [query, stored].find(known) ?? REPORT_DEFAULT_WORLD;
  return { id, ignored };
}

/** The GameCast's address, keeping a world the report's own address names (a known id only, never a raw value). */
export function gamecastHref(search) {
  const world = new URLSearchParams(typeof search === "string" ? search : "").get("world");
  return known(world) ? `/?world=${encodeURIComponent(world)}` : "/";
}
