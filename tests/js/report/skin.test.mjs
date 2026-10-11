// The Model Report's Under the Lights skins (static/css/worlds/under-the-lights/report/*.css) keep the world's own
// rules, the ones tests/js/uls-skins.test.mjs holds the GameCast's skins to (DESIGN.md Named Rules): flat hardware (no
// shadow but the focus ring's gutter, no glass, blur or decorative gradient; radii from tokens), no raw hue and no team
// color on an LED, Doto only at its LED sizes (40 px and up), every url() one of the world's own files, no motion.
// The structure sheet (static/css/report/report.css) references tokens only, as every component's base sheet does.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const ID = "under-the-lights";
const SKIN_FILES = ["report.css", "boards.css"].map((name) => join(ROOT, "static", "css", "worlds", ID, "report", name));
const BASE_FILE = join(ROOT, "static", "css", "report", "report.css");
const MAX_SKIN_LINES = 400;
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "");
const SKIN = SKIN_FILES.map((file) => stripComments(readFileSync(file, "utf8"))).join("\n");
const BASE = stripComments(readFileSync(BASE_FILE, "utf8"));
const rules = (css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);

test("flat hardware: no glow, glass or blur; the focus ring's gutter is the one shadow; radii from tokens", () => {
  for (const css of [SKIN, BASE]) {
    assert.doesNotMatch(css, /backdrop-filter|filter:\s*blur|drop-shadow|text-shadow/);
    const shadows = [...css.matchAll(/box-shadow:\s*([^;]+);/g)].map((m) => m[1].trim());
    assert.ok(shadows.every((s) => /^0 0 0 2px var\(--sc-bg\)$|^none$/.test(s)), shadows.join(" | "));
    assert.deepEqual([...css.matchAll(/(linear|conic|radial|repeating-[a-z]+)-gradient\(/g)].map((m) => m[0]), [],
      "the LED texture comes from the world's own tokens (--uls-led-face, --uls-lit), never a new gradient");
    assert.doesNotMatch(css, /border-radius:[ \t]*(?![ \t]|0[;\s]|0px|var\(--sc-radius|50%)/);
  }
  for (const file of SKIN_FILES) assert.ok(readFileSync(file, "utf8").split("\n").length <= MAX_SKIN_LINES, file);
});

test("no raw hue and no team color on an LED: the world's tokens only", () => {
  for (const css of [SKIN, BASE]) {
    assert.deepEqual([...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]), []);
    assert.doesNotMatch(css, /var\(--sc-team-/);
    const named = [...css.matchAll(/(?<![-\w])(red|cyan|magenta|lime|aqua|fuchsia|blue|green|purple|violet)(?![-\w])/g)];
    assert.deepEqual(named.map((m) => m[1]), []);
  }
});

test("Doto only at its LED sizes (The 40 Pixel Rule)", () => {
  const LED_SIZES = /font-size:\s*var\(--(sc-size-call|sc-size-xl|uls-size-led-readout)\)/;
  const doto = rules(SKIN).filter(([, body]) => /font-family:\s*var\(--uls-led-(num|font)\)/.test(body));
  assert.ok(doto.length >= 3, "the tallies, the surprise numbers and the win probability readout are Doto");
  for (const [selector, body] of doto) assert.match(body, LED_SIZES, selector);
  assert.doesNotMatch(BASE, /--uls-/, "the structure sheet knows no world");
});

test("every url() is one of the world's own glyphs, and nothing moves", () => {
  const urls = [...SKIN.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.ok(urls.length > 0);
  for (const url of urls) {
    assert.match(url, new RegExp(`^/static/img/worlds/${ID}/`));
    assert.ok(existsSync(join(ROOT, ...url.split("/").filter(Boolean))), url);
  }
  for (const css of [SKIN, BASE]) assert.doesNotMatch(css, /animation:|@keyframes|transition:/);
});
