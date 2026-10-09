// Loads the vendored three.js into a node test (package A5). Import this module first, then import scene-engine
// modules dynamically (`await import(...)`), so the resolve hooks are registered before "three" is resolved.
// Scene modules that need a canvas or a WebGL context are not loaded here; they are checked in the browser.
import { register } from "node:module";

register(new URL("./three-hooks.mjs", import.meta.url));

/** The three.js namespace, from static/vendor/three (r185). */
export const loadThree = () => import("three");

/** A field-yards look: NEUTRAL_LOOK resolved, optionally with a partial merged over it. */
export async function lookWith(partial = {}) {
  const { resolveLook } = await import("../../static/js/theme/look-schema.js");
  return resolveLook(partial);
}
