// Module resolve hooks for node tests of the scene engine (package A5): the browser's import map, in node.
// "three" and "three/addons/..." resolve to the vendored r185 files, exactly as static/index.html maps them.
// Registered by tests/js/three-env.mjs; never imported by app code.
import { fileURLToPath, pathToFileURL } from "node:url";

const VENDOR = fileURLToPath(new URL("../../static/vendor/three/", import.meta.url));
const ADDONS = "three/addons/";

export async function resolve(specifier, context, next) {
  if (specifier === "three") {
    return { url: pathToFileURL(`${VENDOR}build/three.module.min.js`).href, shortCircuit: true };
  }
  if (specifier.startsWith(ADDONS)) {
    return { url: pathToFileURL(`${VENDOR}addons/${specifier.slice(ADDONS.length)}`).href, shortCircuit: true };
  }
  return next(specifier, context);
}
