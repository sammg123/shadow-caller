// The static world registry (ui-architecture.md 2.7; owner A10, then W6). One line per world: id -> loader.
// theme/registry.js loads only ids from this map, so nothing is ever imported from a user-supplied path.
// A world module is theme/worlds/<id>/index.js; its default export (or a named `world` export) is the WorldModule.
export const WORLDS = Object.freeze({
  neutral: () => import("./neutral/index.js"),
  "under-the-lights": () => import("./under-the-lights/index.js"),
});

/** The world the app opens in (directions.md Direction 5, Sam's choice). */
export const DEFAULT_WORLD = "under-the-lights";

/** The world used when the chosen one is missing or broken (shown with a visible notice). */
export const FALLBACK_WORLD = "neutral";
