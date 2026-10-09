// The Under the Lights world module and its stylesheets (owner W3; DESIGN.md; ui-architecture.md 2.7, 9.4, v1.4).
// index.js passes the registry's checks with W1's look when look.js exists and a palette-only look built on the
// neutral one when it does not; tokens.css defines every required token with DESIGN.md's values; the fonts are
// real self-hosted woff2 files with their licenses (G28); every world stylesheet in the folder is registered; and the
// HUD keeps DESIGN.md's material rules (no shadows, glass, blur or decorative gradients; motion with reduced variants).
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import world, { FALLBACK_LOOK, LOOK_SOURCE, optional, sceneParts } from "../../static/js/theme/worlds/under-the-lights/index.js";
import { resolveLook, validateLook } from "../../static/js/theme/look-schema.js";
import { checkWorld } from "../../static/js/theme/registry.js";
import { REQUIRED_TOKENS, RUNTIME_TOKENS, parseTokenBlocks, tokenProblems, tokensFor } from "../../static/js/theme/tokens.js";
import { contrast } from "../../static/js/theme/team-colors.js";

const ROOT = join(fileURLToPath(new URL("../..", import.meta.url)));
const ID = "under-the-lights";
const SELECTOR = `:root[data-world="${ID}"]`;
const CSS_DIR = join(ROOT, "static", "css", "worlds", ID);
const onDisk = (href) => join(ROOT, ...href.split("/").filter(Boolean));
const css = (name) => readFileSync(join(CSS_DIR, name), "utf8");
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "");

function filesUnder(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}

test("the world module passes the registry's checks", () => {
  const checked = checkWorld(world, ID);
  assert.equal(checked.id, ID);
  assert.equal(checked.ambient, "dark", "DESIGN.md: the room lights are down by default");
  assert.deepEqual([...checked.booth.holds].sort(), ["feed", "flags", "situation"]);
  assert.equal(typeof checked.arrange, "function");
  assert.ok(Object.isFrozen(world));
});

test("its look resolves: W1's look.js when present, else the palette-only look on the neutral one", () => {
  assert.ok(["w1", "fallback"].includes(LOOK_SOURCE));
  const look = resolveLook(world.look);
  assert.equal(look.version, 1);
  assert.deepEqual(validateLook(FALLBACK_LOOK.full).errors, []);
  if (LOOK_SOURCE === "fallback") assert.equal(world.look, FALLBACK_LOOK.partial);
  const fb = FALLBACK_LOOK.full;
  assert.equal(fb.id, ID);
  assert.deepEqual(fb.field.turf, ["#3f8c3b", "#46983f"]);
  assert.equal(fb.environment.background, "#0d1424");
  assert.equal(fb.renderer.clear, "#0d1424");
  assert.equal(fb.lines.los.color, "#4a90ff");
  assert.equal(fb.lines.ltg.color, "#ffd400");
  assert.ok(fb.lines.los.widthYd >= 0.4 && fb.lines.ltg.widthYd >= 0.4, "DESIGN.md: lines at least 0.4 yd wide");
});

test("W1's modules: the look, props, moments and passes are picked by their export names", () => {
  const look = { id: "under-the-lights", post: { bloom: null } };
  const props = () => ({});
  const presnap = () => {};
  const parts = sceneParts({ look: { look, passes: { shafts: () => ({}) } }, props: { default: props },
    moments: { presnap, snap: presnap, unrelated: 1 } });
  assert.equal(parts.look, look);
  assert.equal(parts.props, props);
  assert.deepEqual(Object.keys(parts.moments), ["presnap", "snap"]);
  assert.deepEqual(Object.keys(parts.passes), ["shafts"]);
  assert.deepEqual(sceneParts({ look: { LOOK: look }, moments: { moments: { verdict: presnap } } }).moments, { verdict: presnap });
  assert.equal(sceneParts({ look: { LOOK: look } }).look, look);
  assert.deepEqual(sceneParts(), { look: null, props: null, moments: null, passes: null });
  assert.deepEqual(sceneParts({ look: { look: [1] }, props: { props: {} } }), { look: null, props: null, moments: null, passes: null });
});

test("a W1 module that is missing is skipped quietly; one that is broken is reported", async () => {
  const reported = [];
  const report = (err) => reported.push(err.message);
  const notFound = Object.assign(new Error("Cannot find module './look.js'"), { code: "ERR_MODULE_NOT_FOUND" });
  assert.equal(await optional(() => Promise.reject(notFound), report), null);
  const fetchFail = new TypeError("Failed to fetch dynamically imported module: http://x/look.js");
  assert.equal(await optional(() => Promise.reject(fetchFail), report), null);
  assert.deepEqual(reported, []);
  assert.equal(await optional(() => Promise.reject(new SyntaxError("Unexpected token")), report), null);
  assert.equal(await optional(() => Promise.reject(new TypeError("x is undefined")), report), null);
  assert.deepEqual(reported, ["Unexpected token", "x is undefined"]);
  assert.deepEqual(await optional(() => Promise.resolve({ look: 1 }), report), { look: 1 });
  assert.equal(await optional(() => Promise.reject(new Error("no reporter")), null), null);
});

test("every world stylesheet on disk is registered, in cascade order, and every registered file exists", () => {
  const listed = world.css.map((href) => onDisk(href));
  for (const file of listed) assert.ok(existsSync(file), `${relative(ROOT, file)} exists`);
  const present = filesUnder(CSS_DIR).filter((f) => f.endsWith(".css"));
  assert.deepEqual([...listed].sort(), [...present].sort(), "a stylesheet in the folder that index.js does not list never loads");
  assert.deepEqual(world.css.slice(0, 3), ["tokens", "layout", "motion"]
    .map((n) => `/static/css/worlds/${ID}/${n}.css`), "W3's base sheets load before any component skin");
});

test("fonts are self-hosted woff2 files with their OFL licenses (G28)", () => {
  assert.equal(world.fonts.length, 3);
  for (const href of world.fonts) {
    const file = onDisk(href);
    const head = readFileSync(file).subarray(0, 4).toString("latin1");
    assert.equal(head, "wOF2", `${href} is a real woff2`);
    const license = join(file, "..", "OFL.txt");
    assert.match(readFileSync(license, "utf8"), /SIL Open Font License, Version 1\.1/, `${href} has its OFL.txt`);
  }
});

test("tokens.css defines every required token with a valid value and no runtime token", () => {
  const values = tokensFor(css("tokens.css"), SELECTOR);
  assert.deepEqual(tokenProblems(values), []);
  assert.equal(Object.keys(values).filter((n) => REQUIRED_TOKENS.includes(n)).length, REQUIRED_TOKENS.length);
  assert.deepEqual(RUNTIME_TOKENS.filter((n) => n in values), []);
});

test("the token values are DESIGN.md's: night sky ground, LED and steel surfaces, warm LED meanings", () => {
  const v = tokensFor(css("tokens.css"), SELECTOR);
  const expect = { "--sc-bg": "#0D1424", "--sc-surface": "#1C2333", "--sc-surface-2": "#0F1114",
    "--sc-surface-raised": "#283149", "--sc-ink": "#FFF3D1", "--sc-ink-muted": "#B9AD92", "--sc-pass": "#FFF3D1",
    "--sc-run": "#FFB21E", "--sc-rpo": "#FFD27A", "--sc-gain": "#FFD400", "--sc-los": "#4A90FF",
    "--sc-good": "#7DDB6A", "--sc-bad": "#FF4D3D", "--sc-live": "#FF4D3D", "--sc-focus": "#FFF3D1",
    "--sc-rule": "#2E374D", "--sc-rule-strong": "#4A5571", "--sc-case-label": "uppercase" };
  for (const [name, value] of Object.entries(expect)) assert.equal(v[name]?.toUpperCase(), value.toUpperCase(), name);
  assert.notEqual(v["--sc-bg"].toLowerCase(), "#000000", "never a black ground");
  assert.match(v["--sc-font-display"], /^"Big Shoulders Display"/);
  assert.match(v["--sc-font-text"], /^"Big Shoulders Text"/);
});

test("text on the HUD surfaces clears 4.5:1 (craft floor; DESIGN.md contrast table)", () => {
  const v = tokensFor(css("tokens.css"), SELECTOR);
  const ratio = (ink, ground) => contrast(v[ink].toLowerCase(), v[ground].toLowerCase());
  for (const ground of ["--sc-surface", "--sc-surface-2", "--sc-surface-raised"]) {
    for (const ink of ["--sc-ink", "--sc-ink-muted", "--sc-run", "--sc-rpo", "--sc-good", "--sc-warn", "--sc-gain"]) {
      assert.ok(ratio(ink, ground) >= 4.5, `${ink} on ${ground}: ${ratio(ink, ground).toFixed(2)}`);
    }
  }
  // Tally red is a lamp and LED color (DESIGN.md): words in it sit on the LED panel or painted steel, never on a cap.
  for (const ground of ["--sc-surface", "--sc-surface-2"]) {
    for (const ink of ["--sc-bad", "--sc-live"]) {
      assert.ok(ratio(ink, ground) >= 4.5, `${ink} on ${ground}: ${ratio(ink, ground).toFixed(2)}`);
    }
  }
  assert.ok(ratio("--sc-ink", "--sc-surface-2") >= 17, "LED warm white on the panel: 17.1:1 (measured)");
});

test("reduced motion zeroes the motion tokens, both from the OS and from data-motion", () => {
  const blocks = parseTokenBlocks(css("tokens.css"));
  const media = blocks.find((b) => b.context.some((c) => /prefers-reduced-motion:\s*reduce/.test(c)) && "--sc-dur-fast" in b.tokens);
  assert.ok(media, "a prefers-reduced-motion block");
  const attr = tokensFor(css("tokens.css"), `${SELECTOR}[data-motion="reduced"]`);
  for (const t of [media.tokens, attr]) {
    for (const name of ["--sc-dur-fast", "--sc-dur-med", "--sc-dur-slow"]) assert.equal(t[name], "0ms", name);
  }
});

test("the LED face patches Doto's period and colon with Big Shoulders (ULS LED Punct)", () => {
  const text = stripComments(css("tokens.css"));
  const faces = [...text.matchAll(/@font-face\s*{([^}]*)}/g)].map((m) => m[1]);
  const family = (f) => /font-family:\s*"([^"]+)"/.exec(f)?.[1];
  assert.deepEqual(faces.map(family).sort(), ["Big Shoulders Display", "Big Shoulders Text", "Doto", "ULS LED Punct"]);
  const punct = faces.find((f) => family(f) === "ULS LED Punct");
  assert.match(punct, /unicode-range:\s*U\+002E,\s*U\+003A\s*;/);
  for (const face of faces) {
    const url = /url\("([^"]+)"\)/.exec(face)?.[1];
    assert.ok(url && existsSync(onDisk(url)), `${family(face)}: ${url}`);
    assert.ok(world.fonts.includes(url), `${url} is preloaded`);
  }
  assert.match(text, /--uls-led-font:\s*"ULS LED Punct", Doto, ui-monospace, monospace/);
});

test("the HUD keeps the Flat Hardware Rule: no shadows but the focus gutter, no glass, blur or gradient panels", () => {
  for (const name of ["tokens.css", "layout.css", "motion.css"]) {
    const text = stripComments(css(name));
    assert.doesNotMatch(text, /backdrop-filter|filter:\s*blur|drop-shadow/, `${name}: glass or blur`);
    const shadows = [...text.matchAll(/box-shadow:\s*([^;]+);/g)].map((m) => m[1].trim());
    assert.ok(shadows.every((s) => /^0 0 0 2px var\(--sc-bg\)$|^none$/.test(s)), `${name}: ${shadows.join(" | ")}`);
    const gradients = [...text.matchAll(/(linear|conic|repeating-linear)-gradient\(/g)];
    assert.deepEqual(gradients.map((m) => m[0]), [], `${name}: only the radial unlit-pixel grid is a gradient`);
    assert.doesNotMatch(text, /border-radius:[ \t]*(?![ \t]|0[;\s]|0px|var\(--sc-radius|50%)/, `${name}: radii come from tokens`);
  }
});

test("the HUD insets are registered lengths, so the engines read pixels (stage.js, fallback-svg.js)", () => {
  const text = stripComments(css("layout.css"));
  for (const side of ["top", "right", "bottom", "left"]) {
    const prop = `--sc-field-safe-${side}`;
    assert.match(text, new RegExp(`@property ${prop}\\s*{[^}]*syntax:\\s*"<length>"`), `${prop} is registered`);
    assert.match(text, new RegExp(`${prop}:\\s*[^;]+;`), `${prop} is set`);
  }
});

test("motion.css: LED steps, the scanline and the drawer rails, each with a reduced-motion state", () => {
  const text = stripComments(css("motion.css"));
  assert.match(text, /steps\(5,\s*jump-end\)/, "LED copy steps in over 5 frames");
  assert.match(text, /steps\(10,\s*jump-end\)/, "the scanline fades up in 10 rows");
  assert.match(text, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(text, /\[data-motion="reduced"\]/);
  assert.doesNotMatch(text, /animation[^;]*infinite/, "nothing pulses or loops");
});

test("every Doto use sits at 40 px or more: --uls-led-font is only paired with the LED sizes", () => {
  const text = stripComments(["tokens.css", "layout.css", "motion.css"].map(css).join("\n"));
  const rules = [...text.matchAll(/{([^{}]*font-family:\s*var\(--uls-led-font\)[^{}]*)}/g)].map((m) => m[1]);
  for (const body of rules) {
    assert.match(body, /font-size:\s*var\(--(sc-size-call|sc-size-xl|uls-size-led(-readout)?)\)/, body.trim());
  }
  assert.ok(existsSync(join(ROOT, "static", "fonts", ID, "SOURCES.txt")));
  assert.equal(sep.length, 1);
});
