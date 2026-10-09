// shell/prefs.js (ui-architecture.md 3.1 step 1, 9.5; owner A0): URL and stored choices -> boot prefs. Pure.
import assert from "node:assert/strict";
import test from "node:test";
import { STORAGE_KEYS, readBootPrefs } from "../../static/js/shell/prefs.js";

test("defaults: full motion, automatic scene, no ambient or world asked for (the world's defaults apply)", () => {
  assert.deepEqual(readBootPrefs({}), {
    prefs: { motion: "full", scene: "auto" }, ambient: null,
    world: { query: null, stored: null }, camera: null, capture: false, debug: false,
  });
});

test("the URL asks for a world, the 2D scene, dark ambient, capture and debug", () => {
  const boot = readBootPrefs({ search: "?world=neutral&scene=2d&ambient=dark&capture=1&debug=1" });
  assert.equal(boot.world.query, "neutral");
  assert.equal(boot.prefs.scene, "2d");
  assert.equal(boot.ambient, "dark");
  assert.equal(boot.capture, true);
  assert.equal(boot.debug, true);
});

test("stored choices fill in what the URL leaves out; the URL wins", () => {
  const stored = { [STORAGE_KEYS.world]: "under-the-lights", [STORAGE_KEYS.camera]: "endzone", [STORAGE_KEYS.ambient]: "dark" };
  const boot = readBootPrefs({ search: "?ambient=room", stored });
  assert.deepEqual(boot.world, { query: null, stored: "under-the-lights" });
  assert.equal(boot.camera, "endzone");
  assert.equal(boot.ambient, "room");
  assert.equal(readBootPrefs({ stored }).ambient, "dark");
});

test("reduced motion comes from the media query", () => {
  assert.equal(readBootPrefs({ reducedMotion: true }).prefs.motion, "reduced");
});

test("malformed values are dropped, never passed on", () => {
  const boot = readBootPrefs({
    search: "?scene=webgl&ambient=bright&capture=yes&world=",
    stored: { [STORAGE_KEYS.camera]: "<img src=x>", [STORAGE_KEYS.ambient]: 7, [STORAGE_KEYS.world]: "../../x" },
  });
  assert.equal(boot.prefs.scene, "auto");
  assert.equal(boot.ambient, null);
  assert.equal(boot.capture, false);
  assert.equal(boot.camera, null);
  assert.deepEqual(boot.world, { query: null, stored: "../../x" }, "world ids are checked against the registry, not here");
});

test("storage keys are namespaced sc:", () => {
  for (const key of Object.values(STORAGE_KEYS)) assert.match(key, /^sc:/);
});
