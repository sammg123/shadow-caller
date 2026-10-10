// Under the Lights: the HUD component skins and pixel glyphs (owner W2; DESIGN.md Components, Named Rules; ui-architecture
// v1.4). Every skin is registered after W3's sheets; the HUD stays flat hardware (no shadows, glass, blur or decorative
// gradients; radii from tokens); no neon and no team color ever lights an LED; Doto only at 40 px and up; every
// animation is a hardware step with a reduced-motion state; every url() resolves; the glyphs are clean 9 x 9 masks.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import world from "../../static/js/theme/worlds/under-the-lights/index.js";
import { contrast } from "../../static/js/theme/team-colors.js";

const ROOT = join(fileURLToPath(new URL("../..", import.meta.url)));
const ID = "under-the-lights";
const SKIN_DIR = join(ROOT, "static", "css", "worlds", ID, "components");
const IMG_DIR = join(ROOT, "static", "img", "worlds", ID);
const W2_SKINS = ["masthead", "prediction", "board", "scoreboard", "scorecard", "play-feed", "drive-chart", "win-prob",
  "situation-strip", "feed-bar", "toast", "conn-banner", "boot-screen", "review-banner", "field-host", "box-score",
  "tendencies", "play-log"];
const GLYPHS = ["check", "three", "x", "td", "inc", "first", "flag", "turnover", "hot-up", "hot-down", "ref-touchdown",
  "ref-turnover"];
const MAX_LINES = 400;
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "");
const skin = (name) => stripComments(readFileSync(join(SKIN_DIR, `${name}.css`), "utf8"));
const raw = (name) => readFileSync(join(SKIN_DIR, `${name}.css`), "utf8");
const motion = stripComments(readFileSync(join(ROOT, "static", "css", "worlds", ID, "motion.css"), "utf8"));
const TOKENS_CSS = readFileSync(join(ROOT, "static", "css", "worlds", ID, "tokens.css"), "utf8");
/** The world's palette by name (--uls-*: #rrggbb) from the first :root block of tokens.css. */
const palette = Object.fromEntries([...TOKENS_CSS.matchAll(/(--uls-[a-z0-9-]+):\s*(#[0-9a-fA-F]{6});/g)]
  .map((m) => [m[1], m[2].toLowerCase()]));

/** Rule bodies with their selectors: [selector, body] (one level of @media nesting is enough here). */
function rules(css) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
}

test("every W2 skin exists, under 400 lines, and loads after W3's sheets with the shared keys first", () => {
  const listed = world.css.map((href) => href.replace(`/static/css/worlds/${ID}/`, "").replace(/\.css$/, ""));
  const mine = listed.filter((n) => W2_SKINS.includes(n.replace(/^components\//, "")));
  assert.deepEqual(mine, W2_SKINS.map((n) => `components/${n}`), "W2's skins in their cascade order");
  assert.ok(listed.indexOf("components/masthead") > listed.indexOf("motion"));
  for (const name of W2_SKINS) {
    const lines = raw(name).split("\n").length;
    assert.ok(lines <= MAX_LINES, `${name}.css has ${lines} lines`);
  }
  const onDisk = readdirSync(SKIN_DIR).filter((f) => f.endsWith(".css")).map((f) => f.replace(/\.css$/, ""));
  for (const name of W2_SKINS) assert.ok(onDisk.includes(name), `${name}.css`);
});

test("the Flat Hardware Rule: no shadow, glass, blur or decorative gradient; radii from tokens", () => {
  for (const name of W2_SKINS) {
    const css = skin(name);
    assert.doesNotMatch(css, /backdrop-filter|filter:\s*blur|drop-shadow|text-shadow/, `${name}: glass, blur or glow`);
    const shadows = [...css.matchAll(/box-shadow:\s*([^;]+);/g)].map((m) => m[1].trim());
    assert.ok(shadows.every((s) => /^0 0 0 2px var\(--sc-bg\)$|^none$/.test(s)), `${name}: ${shadows.join(" | ")}`);
    assert.deepEqual([...css.matchAll(/(linear|conic|repeating-[a-z]+)-gradient\(/g)].map((m) => m[0]), [], name);
    for (const m of css.matchAll(/radial-gradient\(([^;]*)/g)) {
      assert.match(m[1], /^circle at 2px 2px/, `${name}: a radial gradient is only ever the 4 px pixel grid`);
    }
    assert.doesNotMatch(css, /border-radius:[ \t]*(?![ \t]|0[;\s]|0px|var\(--sc-radius|50%)/, `${name}: radii from tokens`);
  }
});

test("no neon and no team color on LED: colors are the world's tokens, never raw hues or --sc-team-*", () => {
  for (const name of W2_SKINS) {
    const css = skin(name);
    assert.deepEqual([...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]), [], `${name}: raw hex`);
    assert.doesNotMatch(css, /var\(--sc-team-/, `${name}: the team color is paint (layout.css), never a skin's light`);
    const named = [...css.matchAll(/(?<![-\w])(red|cyan|magenta|lime|aqua|fuchsia|blue|green|purple|violet)(?![-\w])/g)];
    assert.deepEqual(named.map((m) => m[1]), [], `${name}: named hues`);
  }
});

test("Doto only at 40 px and up: every LED-numeral rule sets an LED size (The 40 Pixel Rule)", () => {
  const LED_SIZES = /font-size:\s*var\(--(sc-size-call|sc-size-xl|uls-size-led-readout)\)/;
  let checked = 0;
  for (const name of W2_SKINS) {
    for (const [selector, body] of rules(skin(name))) {
      if (!/font-family:\s*var\(--uls-led-(num|font)\)/.test(body)) continue;
      checked += 1;
      assert.match(body, LED_SIZES, `${name}: ${selector}`);
    }
  }
  assert.ok(checked >= 4, "the call figure, the scores, the facts and the SHADOW v LEAGUE readouts are Doto");
});

test("every url() resolves to the world's own glyphs or fonts", () => {
  for (const name of W2_SKINS) {
    for (const m of skin(name).matchAll(/url\("([^"]+)"\)/g)) {
      assert.match(m[1], new RegExp(`^/static/(img/worlds|fonts)/${ID}/`), `${name}: ${m[1]}`);
      assert.ok(existsSync(join(ROOT, ...m[1].split("/").filter(Boolean))), `${name}: ${m[1]} exists`);
    }
  }
});

test("motion: hardware steps only, never a loop, each with its reduced-motion state", () => {
  for (const name of W2_SKINS) {
    const css = skin(name);
    const uses = [...css.matchAll(/animation:\s*([a-z0-9-]+)[^;]*;/g)].filter((m) => m[1] !== "none");
    if (!uses.length) continue;
    for (const m of uses) {
      assert.doesNotMatch(m[0], /infinite/, `${name}: ${m[0]}`);
      const defined = new RegExp(`@keyframes\\s+${m[1]}\\b`);
      assert.ok(defined.test(css) || defined.test(motion), `${name}: keyframes ${m[1]}`);
    }
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/, `${name}: the OS setting`);
    assert.match(css, /\[data-motion="reduced"\]/, `${name}: the app's own setting`);
  }
});

test("LED text the skins light clears 4.5:1 on the panel (MISS in tally red, flags in yellow, run in amber)", () => {
  const panel = palette["--uls-led-panel"];
  for (const ink of ["--uls-led-warm", "--uls-led-amber", "--uls-led-gold", "--uls-led-dim", "--uls-tally-red",
    "--uls-line-to-gain", "--uls-lamp-green"]) {
    const ratio = contrast(palette[ink], panel);
    assert.ok(ratio >= 4.5, `${ink}: ${ratio.toFixed(2)}`);
  }
  assert.ok(contrast(palette["--uls-caption-white"], palette["--uls-steel-raised"]) >= 4.5, "caption white on a plate");
});

test("the pixel glyphs are clean 9 x 9 masks: one path, crisp edges, nothing executable", () => {
  for (const name of GLYPHS) {
    const svg = readFileSync(join(IMG_DIR, `${name}.svg`), "utf8");
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 9 9"/, name);
    assert.match(svg, /shape-rendering="crispEdges"/, name);
    assert.doesNotMatch(svg, /<script|\son[a-z]+=|href=|<image|<foreignObject/i, name);
    const coords = [...svg.matchAll(/M(\d+) (\d+)h(\d+)/g)].map((m) => m.slice(1).map(Number));
    assert.ok(coords.length > 0, `${name} lights some pixels`);
    for (const [x, y, w] of coords) assert.ok(x >= 0 && y >= 0 && y < 9 && x + w <= 9, `${name}: ${x},${y} +${w}`);
  }
});
