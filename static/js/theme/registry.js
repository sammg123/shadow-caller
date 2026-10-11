// World loading (ui-architecture.md 2.7; owner A10). Ids come only from the static map in worlds/index.js, so
// nothing is imported from a user-supplied path. A loaded module is checked before use (id, label, look, css and
// font paths under the world's own folders, hook types); a missing or broken world falls back to neutral, and the
// caller gets the reason to show (main.js shows a notice). If even neutral fails, a built-in neutral is used.
import { DEFAULT_WORLD, FALLBACK_WORLD, WORLDS } from "./worlds/index.js";

export class WorldError extends Error {
  constructor(id, problems) {
    super(`The "${id}" world can't be used: ${problems.join("; ")}`);
    this.name = "WorldError";
    this.problems = Object.freeze([...problems]);
  }
}

/** RegionName (5.2): the regions a world's arrange receives (restructure-v2.md 1: the GameCast and the prediction). */
export const REGION_NAMES = Object.freeze(["masthead", "plays", "scoreboard", "field", "call", "drives", "wp"]);

const CSS_PATH = (id) => new RegExp(`^/static/css/worlds/${id}/[A-Za-z0-9_-][A-Za-z0-9_./-]*\\.css$`);
const FONT_PATH = (id) => new RegExp(`^/static/fonts/${id}/[A-Za-z0-9_-][A-Za-z0-9_./-]*\\.(woff2|woff|ttf|otf)$`);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const cleanPath = (p) => typeof p === "string" && !p.includes("..") && !p.includes("//");

/** Neutral without its module (no arrange): the last resort when theme/worlds/neutral/index.js won't load. */
export const BUILTIN_NEUTRAL = Object.freeze({
  id: "neutral", label: "Neutral", look: Object.freeze({}), css: Object.freeze(["/static/css/worlds/neutral/tokens.css"]),
  fonts: Object.freeze([]), ambient: null,
});

function pathProblems(list, name, re, what) {
  if (list === undefined && name === "fonts") return [];
  if (!Array.isArray(list)) return [`${name} must be a list of paths`];
  return list.flatMap((p, i) => (cleanPath(p) && re.test(p) ? [] : [`${name}[${i}] must be ${what}`]));
}

function hookProblems(world) {
  const fns = ["arrange", "props"].filter((k) => world[k] !== undefined && typeof world[k] !== "function")
    .map((k) => `${k} must be a function`);
  const groups = ["moments", "passes"].flatMap((k) => {
    if (world[k] === undefined) return [];
    if (!isObj(world[k])) return [`${k} must be an object of functions`];
    return Object.entries(world[k]).filter(([, fn]) => typeof fn !== "function").map(([n]) => `${k}.${n} must be a function`);
  });
  const ambient = world.ambient === undefined || ["room", "dark"].includes(world.ambient) ? []
    : ["ambient must be \"room\" or \"dark\""];
  return [...fns, ...groups, ...ambient];
}

/** Validate a WorldModule for `id`; returns a frozen, normalized copy or throws a WorldError listing problems. */
export function checkWorld(world, id) {
  if (!isObj(world)) throw new WorldError(id, ["the world module exports no world object"]);
  const problems = [
    ...(world.id === id ? [] : [`id must be "${id}"`]),
    ...(typeof world.label === "string" && world.label.trim() ? [] : ["label must be a non-empty string"]),
    ...(isObj(world.look) ? [] : ["look must be an object (a partial Look)"]),
    ...pathProblems(world.css, "css", CSS_PATH(id), `a .css file under /static/css/worlds/${id}/`),
    ...pathProblems(world.fonts, "fonts", FONT_PATH(id), `a font file under /static/fonts/${id}/`),
    ...hookProblems(world),
  ];
  if (problems.length) throw new WorldError(id, problems);
  return Object.freeze({
    id, label: world.label, look: world.look, css: Object.freeze([...world.css]),
    fonts: Object.freeze([...(world.fonts ?? [])]), arrange: world.arrange, props: world.props,
    moments: world.moments, passes: world.passes,
    ambient: world.ambient ?? null,
  });
}

/** default export, a named `world` export, or the module's own fields. */
function worldOf(ns) {
  if (isObj(ns?.default)) return ns.default;
  if (isObj(ns?.world)) return ns.world;
  return ns;
}

/**
 * @param {Record<string, () => Promise<object>>} map  id -> loader (default: worlds/index.js)
 * @param {{ preferred?: string, fallback?: string }} opts
 */
export function createRegistry(map = WORLDS, { preferred = DEFAULT_WORLD, fallback = FALLBACK_WORLD } = {}) {
  const ids = Object.freeze(Object.keys(map));
  const has = (id) => typeof id === "string" && Object.hasOwn(map, id);

  async function loadWorld(id) {
    if (!has(id)) throw new WorldError(String(id), ["no world with that id"]);
    return checkWorld(worldOf(await map[id]()), id);
  }

  async function fallbackWorld() {
    try {
      return await loadWorld(fallback);
    } catch {
      return BUILTIN_NEUTRAL;
    }
  }

  /** { world, requested, fellBack, error }: the world, or the fallback with the reason it was needed. */
  async function loadWithFallback(id) {
    try {
      return { world: await loadWorld(id), requested: id, fellBack: false, error: null };
    } catch (error) {
      const world = id === fallback ? BUILTIN_NEUTRAL : await fallbackWorld();
      return { world, requested: id, fellBack: true, error };
    }
  }

  /** ?world= (map keys only), then the stored choice (sc:world), then the preferred default, then the fallback. */
  function chooseWorldId({ query = null, stored = null } = {}) {
    const ignored = [query, stored].filter((v) => typeof v === "string" && v !== "" && !has(v));
    if (has(query)) return { id: query, source: "query", ignored };
    if (has(stored)) return { id: stored, source: "stored", ignored };
    if (has(preferred)) return { id: preferred, source: "default", ignored };
    return { id: fallback, source: "fallback", ignored };
  }

  return { ids, has, loadWorld, loadWithFallback, chooseWorldId };
}

/** The app's registry over worlds/index.js. */
export const registry = createRegistry();

/** Load a world by id from the static map; rejects unknown ids (2.7). */
export const loadWorld = (id) => registry.loadWorld(id);
