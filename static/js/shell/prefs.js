// Boot prefs from the URL and stored choices (ui-architecture.md 3.1 step 1, 9.5; owner A0). Pure: main.js reads
// location.search, localStorage and matchMedia and passes the values in. Everything here is untrusted input, so
// only known values pass; world ids are checked later against the registry's static map.

/** localStorage keys (every access in main.js is wrapped in try/catch: private mode throws). */
export const STORAGE_KEYS = Object.freeze({ world: "sc:world", camera: "sc:camera", ambient: "sc:ambient" });

const AMBIENTS = Object.freeze(["room", "dark"]);
const MODE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

const text = (v) => (typeof v === "string" && v !== "" ? v : null);
const oneOf = (v, allowed) => (allowed.includes(v) ? v : null);

/**
 * @param {{ search?: string, stored?: Record<string, unknown>, reducedMotion?: boolean }} input
 * @returns {{ prefs: { motion: "full" | "reduced", scene: "auto" | "2d" }, ambient: "room" | "dark" | null,
 *   world: { query: string | null, stored: string | null }, camera: string | null, capture: boolean, debug: boolean }}
 *   ambient is null when neither the URL nor a stored choice names one: the world's own default applies then.
 */
export function readBootPrefs({ search = "", stored = {}, reducedMotion = false } = {}) {
  const params = new URLSearchParams(typeof search === "string" ? search : "");
  const saved = stored ?? {};
  const camera = text(saved[STORAGE_KEYS.camera]);
  return {
    prefs: {
      motion: reducedMotion === true ? "reduced" : "full",
      scene: params.get("scene") === "2d" ? "2d" : "auto",
    },
    ambient: oneOf(params.get("ambient"), AMBIENTS) ?? oneOf(saved[STORAGE_KEYS.ambient], AMBIENTS),
    world: { query: text(params.get("world")), stored: text(saved[STORAGE_KEYS.world]) },
    camera: camera && MODE_ID.test(camera) ? camera : null,
    capture: params.get("capture") === "1",
    debug: params.get("debug") === "1",
  };
}
