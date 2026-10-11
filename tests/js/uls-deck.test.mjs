// Under the Lights: the top bar's playback row, components/watch-transport.css (restructure-v2.md 2; DESIGN.md "Watch
// transport", Named Rules; owner: home frame). Registered last; flat hardware; the world's tokens only, never a team
// color on LED; no Doto under 40 px (the count is in the ribbon's numerals); no motion (the row moves like hardware: a
// state change, never a tween); the progress strip lit cell by cell to the game's position with its drive, quarter
// and score ticks readable on both its lit and unlit parts; Play lit while the game plays, Go Live's lamp at the live
// edge. The old desk's scrub and its Doto counter are gone (restructure-v2.md 1).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import world from "../../static/js/theme/worlds/under-the-lights/index.js";
import { contrast } from "../../static/js/theme/team-colors.js";

const ROOT = join(fileURLToPath(new URL("../..", import.meta.url)));
const ID = "under-the-lights";
const DECK = "components/watch-transport";
const MAX_LINES = 400;
const TEXT_MIN = 4.5;
const GRAPHIC_MIN = 3;
const path = (name) => join(ROOT, "static", "css", "worlds", ID, `${name}.css`);
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "");
const raw = readFileSync(path(DECK), "utf8");
const css = stripComments(raw);
const TOKENS = readFileSync(path("tokens"), "utf8");
const palette = Object.fromEntries([...TOKENS.matchAll(/(--uls-[a-z0-9-]+):\s*(#[0-9a-fA-F]{6});/g)]
  .map((m) => [m[1], m[2].toLowerCase()]));

/** [selector, body] for every rule (one level of @media nesting is enough here). */
const rules = (text) => [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
/** The body of the rule whose selector ends with `tail` (the world's :where() prefix comes first). */
const bodyOf = (tail) => rules(css).find(([sel]) => sel.endsWith(tail))?.[1] ?? "";
/** A var(--uls-*) a declaration names, resolved to its hex. */
const hexOf = (body, prop) => palette[new RegExp(`${prop}:\\s*var\\((--uls-[a-z0-9-]+)\\)`).exec(body)?.[1]];

test("the playback row's skin is registered last, after the world's keys and the settings menu, under 400 lines", () => {
  const listed = world.css.map((href) => href.replace(`/static/css/worlds/${ID}/`, "").replace(/\.css$/, ""));
  assert.equal(listed.at(-1), DECK);
  for (const before of ["motion", "components/masthead", "booth"]) {
    assert.ok(listed.indexOf(before) >= 0 && listed.indexOf(before) < listed.indexOf(DECK), `${before} loads first`);
  }
  assert.equal(listed.includes("components/scrub"), false, "the desk's scrub is gone");
  assert.equal(existsSync(path("components/scrub")), false);
  assert.ok(raw.split("\n").length <= MAX_LINES, `${DECK}.css has ${raw.split("\n").length} lines`);
});

test("the Flat Hardware Rule: no shadow, glass, blur or decorative gradient; radii from tokens", () => {
  assert.doesNotMatch(css, /box-shadow|backdrop-filter|filter:\s*blur|drop-shadow|text-shadow/);
  assert.deepEqual([...css.matchAll(/(linear|conic|repeating-[a-z]+|radial)-gradient\(/g)].map((m) => m[0]), [],
    "the strip's pixels come from the world's LED tokens (--uls-led-face, --uls-lit), never a gradient of its own");
  assert.doesNotMatch(css, /border-radius:[ \t]*(?![ \t]|0[;\s]|0px|var\(--sc-radius|50%)/);
});

test("the world's tokens only: no raw hex, no named hue, no team color on the row's LEDs", () => {
  assert.deepEqual([...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]), []);
  assert.doesNotMatch(css, /var\(--sc-team-/);
  const named = [...css.matchAll(/(?<![-\w])(red|cyan|magenta|lime|aqua|fuchsia|blue|green|purple|violet)(?![-\w])/g)];
  assert.deepEqual(named.map((m) => m[1]), []);
});

test("Doto only at 40 px and up: the row sets no LED numeral; the count is in the ribbon's numerals", () => {
  assert.doesNotMatch(css, /--uls-led-(num|font)|Doto/);
  assert.match(bodyOf(".sc-progress-count"), /var\(--sc-font-num\)/);
  assert.doesNotMatch(css, /content:\s*"888/, "no unlit-8 counter behind the count");
});

test("no motion: the knob, the strip and the keys change state at once, never by a tween or a loop", () => {
  assert.doesNotMatch(css, /animation(-name)?:\s*(?!none)[a-z]/);
  assert.doesNotMatch(css, /transition(-duration)?:\s*(?!none)[^;]*\d+m?s/);
});

test("the progress strip: an LED face, the played part lit cell by cell, the knob at the game's position", () => {
  assert.match(bodyOf(".sc-progress-track"), /background:\s*var\(--uls-led-face\)/);
  const fill = bodyOf(".sc-progress-fill");
  assert.match(fill, /(^|[^-])mask:\s*var\(--uls-lit\)/, "the world's LED pitch, so the lit part is cells");
  assert.match(fill, /-webkit-mask:\s*var\(--uls-lit\)/);
  assert.match(bodyOf(".sc-progress-knob"), /inset-inline-start:\s*calc\(var\(--sc-at, 0\) \* 100%/);
  for (const kind of ["quarter", "score"]) assert.ok(bodyOf(`.sc-progress-mark[data-kind="${kind}"]`), kind);
  assert.ok(bodyOf('.sc-progress-mark[data-caller="true"]'), "the caller's drives stand out from the other team's");
});

test("every tick reads on both parts of the strip: 3:1 on the unlit panel, and a panel-black edge on the lit part", () => {
  const panel = palette["--uls-led-panel"];
  const lit = palette["--uls-segment-lit"];
  assert.match(bodyOf(".sc-progress-mark"), /border-inline:\s*1px solid var\(--uls-led-panel\)/);
  assert.ok(contrast(panel, lit) >= GRAPHIC_MIN, "the edge against the lit cells");
  const drive = hexOf(bodyOf(".sc-progress-mark"), "background");
  const quarter = hexOf(bodyOf('.sc-progress-mark[data-kind="quarter"]'), "background");
  const score = hexOf(bodyOf('.sc-progress-mark[data-kind="score"]'), "background");
  for (const [name, hex] of Object.entries({ drive, quarter, score })) {
    assert.ok(hex, `${name} tick color is a world token`);
    assert.ok(contrast(hex, panel) >= GRAPHIC_MIN, `${name} tick on the unlit panel: ${contrast(hex, panel)}`);
  }
});

test("Play is lit while the game plays and Go Live's lamp at the live edge, both in the world's lights", () => {
  const playing = bodyOf('.sc-transport-play[data-playing="true"] .sc-key-cap');
  const window = hexOf(playing, "background");
  const ink = hexOf(playing, "color");
  assert.ok(window && ink, "the lit window and its ink are world tokens");
  assert.ok(contrast(ink, window) >= TEXT_MIN, "the cap's key name on the lit window");
  assert.match(bodyOf('.sc-transport-live .sc-lamp[data-on="true"]'), /background:\s*var\(--uls-tally-red\)/);
});

test("the row's words clear 4.5:1: the count on steel, the keys' names on their caps", () => {
  const steel = hexOf(bodyOf(".sc-transport"), "background");
  const count = hexOf(bodyOf(".sc-progress-count"), "color");
  assert.ok(steel && count);
  assert.ok(contrast(count, steel) >= TEXT_MIN, `the count: ${contrast(count, steel)}`);
  for (const ink of ["--uls-led-warm", "--uls-led-dim"]) {
    assert.ok(contrast(palette[ink], palette["--uls-steel-raised"]) >= TEXT_MIN, `${ink} on a key cap`);
  }
});
