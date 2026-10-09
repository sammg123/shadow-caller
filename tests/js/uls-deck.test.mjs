// Under the Lights: the W5 deck skins, components/watch-transport.css and components/scrub.css (owner W5; DESIGN.md
// "Watch transport", Named Rules; ui-architecture.md v1.4, section 19). Registered after every other skin; flat
// hardware; the world's tokens only, never a team color on LED; Doto only at LED sizes; no motion (the deck moves like
// hardware: a state change, never a tween); the play counter's ghost and width agree with its seven Doto cells, and the
// stadium's message board takes exactly the rest of the counter's row.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import world from "../../static/js/theme/worlds/under-the-lights/index.js";
import { contrast } from "../../static/js/theme/team-colors.js";

const ROOT = join(fileURLToPath(new URL("../..", import.meta.url)));
const ID = "under-the-lights";
const DECK = ["components/watch-transport", "components/scrub"];
const MAX_LINES = 400;
const DOTO_CELL_EM = 0.6;
const COUNTER_CELLS = 7;                   // "888/888"
const path = (name) => join(ROOT, "static", "css", "worlds", ID, `${name}.css`);
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "");
const raw = (name) => readFileSync(path(name), "utf8");
const skin = (name) => stripComments(raw(name));
const TOKENS = readFileSync(path("tokens"), "utf8");
const palette = Object.fromEntries([...TOKENS.matchAll(/(--uls-[a-z0-9-]+):\s*(#[0-9a-fA-F]{6});/g)]
  .map((m) => [m[1], m[2].toLowerCase()]));

/** [selector, body] for every rule (one level of @media nesting is enough here). */
const rules = (css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);

test("both deck skins are registered in order after the world's keys and the booth, and stay under 400 lines", () => {
  const listed = world.css.map((href) => href.replace(`/static/css/worlds/${ID}/`, "").replace(/\.css$/, ""));
  const [transport, scrub] = DECK.map((name) => listed.indexOf(name));
  assert.ok(transport >= 0 && scrub === transport + 1, "the transport's skin, then the scrub's");
  for (const before of ["motion", "components/masthead", "booth", "components/last-play"]) {
    assert.ok(listed.indexOf(before) < transport, `${before} loads first`);
  }
  for (const name of DECK) {
    const lines = raw(name).split("\n").length;
    assert.ok(lines <= MAX_LINES, `${name}.css has ${lines} lines`);
  }
});

test("the Flat Hardware Rule: no shadow, glass, blur or decorative gradient; square LED, steel radii from tokens", () => {
  for (const name of DECK) {
    const css = skin(name);
    assert.doesNotMatch(css, /box-shadow|backdrop-filter|filter:\s*blur|drop-shadow|text-shadow/, name);
    assert.deepEqual([...css.matchAll(/(linear|conic|repeating-[a-z]+)-gradient\(/g)].map((m) => m[0]), [], name);
    for (const m of css.matchAll(/radial-gradient\(([^;]*)/g)) {
      assert.match(m[1], /^circle at 2px 2px/, `${name}: a radial gradient is only ever the 4 px pixel grid`);
    }
    assert.doesNotMatch(css, /border-radius:[ \t]*(?![ \t]|0[;\s]|0px|var\(--sc-radius|50%)/, `${name}: radii`);
  }
});

test("the world's tokens only: no raw hex, no named hue, no team color on the deck's LEDs", () => {
  for (const name of DECK) {
    const css = skin(name);
    assert.deepEqual([...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]), [], `${name}: raw hex`);
    assert.doesNotMatch(css, /var\(--sc-team-/, name);
    const named = [...css.matchAll(/(?<![-\w])(red|cyan|magenta|lime|aqua|fuchsia|blue|green|purple|violet)(?![-\w])/g)];
    assert.deepEqual(named.map((m) => m[1]), [], `${name}: named hues`);
  }
});

test("Doto only at 40 px and up: the counter is the deck's one LED numeral, at the readout size", () => {
  const led = DECK.flatMap((name) => rules(skin(name)).filter(([, body]) => /font-family:[^;]*--uls-led-(num|font)/.test(body)));
  assert.equal(led.length, 1);
  assert.match(led[0][0], /\.sc-transport-progress$/);
  assert.match(led[0][1], /font-size:\s*var\(--uls-size-led-readout\)/);
});

test("no motion: the knob, the veil and the keys change state at once, never by a tween or a loop", () => {
  for (const name of DECK) {
    const css = skin(name);
    assert.doesNotMatch(css, /animation(-name)?:\s*(?!none)[a-z]/, name);
    assert.doesNotMatch(css, /transition(-duration)?:\s*(?!none)[^;]*\d+m?s/, name);
  }
});

test("the counter: seven Doto cells, its ghost 888/888 behind and in the hidden copy, and its width on the token", () => {
  const css = skin("components/watch-transport");
  assert.equal([...css.matchAll(/content:\s*"888\/888"\s*\/\s*""/g)].length, 2, "the ghost and its hidden copy");
  assert.match(css, new RegExp(`--uls-deck-count-w:\\s*calc\\(var\\(--uls-size-led-readout\\) \\* ${COUNTER_CELLS * DOTO_CELL_EM}`
    + " \\+ 2 \\* var\\(--sc-space-2\\)\\)"));
  assert.match(css, /\.sc-transport-progress\s*\{[^}]*width:\s*var\(--uls-deck-count-w\)/);
  assert.match(css, /--uls-ghost/, "W2's unlit-8 color, so a lit 7 beside an unlit 8 never reads 87");
});

test("the stadium's board fills the counter's row exactly, and the transport's plate stands down there", () => {
  const scrub = skin("components/scrub");
  const transport = skin("components/watch-transport");
  const stadium = /@media \(min-width: 1200px\) and \(min-height: 640px\)\s*\{([\s\S]*)\}\s*$/;
  assert.match(scrub.match(stadium)?.[1] ?? "", /width:\s*calc\(100% - var\(--uls-deck-count-w\) - var\(--uls-deck-gap/);
  assert.match(scrub.match(stadium)?.[1] ?? "", /height:\s*var\(--uls-size-led-readout\)/);
  assert.match(transport.match(stadium)?.[1] ?? "", /\.sc-transport::before\s*\{\s*content:\s*none;\s*\}/);
});

test("the deck's LED inks clear 4.5:1 on the panel and its words 4.5:1 on steel", () => {
  const panel = palette["--uls-led-panel"];
  for (const ink of ["--uls-led-warm", "--uls-led-amber", "--uls-led-dim", "--uls-segment-lit"]) {
    assert.ok(contrast(palette[ink], panel) >= 4.5, ink);
  }
  for (const ink of ["--uls-led-warm", "--uls-led-dim"]) {
    assert.ok(contrast(palette[ink], palette["--uls-steel-raised"]) >= 4.5, `${ink} on a key cap`);
  }
  assert.ok(contrast(palette["--uls-caption-white"], palette["--uls-steel-raised"]) >= 4.5, "the plate");
});
