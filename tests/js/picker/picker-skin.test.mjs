// The game picker's stylesheets (static/css/picker/picker.css, the plain one, linked by the GameCast; the Under the
// Lights skin at static/css/worlds/under-the-lights/picker/picker.css, registered in the world's css, game-picker.md 5):
// the plain one is tokens only; the skin keeps the world's rules the W2 skins keep (uls-skins.test.mjs): flat
// hardware, no neon, no team color on LED, radii from tokens, Doto never, no motion, and it wins the cascade.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import world from "../../../static/js/theme/worlds/under-the-lights/index.js";
import { cascadeLosses } from "../css-cascade.mjs";

const ROOT = new URL("../../../", import.meta.url);
const SKIN_HREF = "/static/css/worlds/under-the-lights/picker/picker.css";
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "");
const PLAIN_RAW = readFileSync(new URL("static/css/picker/picker.css", ROOT), "utf8");
const PLAIN = stripComments(PLAIN_RAW);
const SKIN_RAW = readFileSync(new URL(SKIN_HREF.slice(1), ROOT), "utf8");
const SKIN = stripComments(SKIN_RAW);
const INDEX = readFileSync(new URL("static/index.html", ROOT), "utf8");

test("the plain picker is structure and tokens only: no raw color, no world's own token", () => {
  assert.deepEqual([...PLAIN.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g)].map((m) => m[0]), []);
  assert.doesNotMatch(PLAIN, /--uls-/);
  assert.doesNotMatch(PLAIN, /:root\[data-world/, "a world's skin lives in that world's folder");
});

test("game-picker.md 5: the plain sheet is a page link; the skin loads with the world, after its keys", () => {
  const link = /<link rel="stylesheet" href="\/static\/css\/picker\/picker\.css">/.exec(INDEX);
  assert.ok(link, "index.html links the plain picker");
  assert.ok(INDEX.indexOf(link[0]) > INDEX.lastIndexOf('href="/static/css/components/'), "after the component sheets");
  assert.ok(INDEX.indexOf(link[0]) < INDEX.indexOf("data-world-css"), "before the world's sheets");
  const at = world.css.indexOf(SKIN_HREF);
  for (const before of ["components/masthead", "booth"]) {
    assert.ok(world.css.indexOf(`/static/css/worlds/under-the-lights/${before}.css`) < at, `after ${before}`);
  }
  assert.equal(at, world.css.length - 2, "just before the playback row's skin, which stays last (uls-deck.test.mjs)");
  assert.doesNotMatch(INDEX, /picker-under-the-lights/, "the old page-side skin is gone");
});

test("the Under the Lights skin is flat hardware: no shadow but the focus gutter, no glass, blur or gradient", () => {
  assert.doesNotMatch(SKIN, /backdrop-filter|filter:\s*blur|drop-shadow|text-shadow|gradient\(/);
  const shadows = [...SKIN.matchAll(/box-shadow:\s*([^;]+);/g)].map((m) => m[1].trim());
  assert.ok(shadows.every((s) => s === "0 0 0 2px var(--sc-bg)"), shadows.join(" | "));
  assert.doesNotMatch(SKIN, /border-radius:[ \t]*(?![ \t]|0[;\s]|0px|var\(--sc-radius|50%)/, "radii from tokens");
});

// restructure-v2.md 11 item 5: a world's skin wins the cascade. The plain sheet's checked side recolored the skin's
// steel light-catch, and its live state's weight outranked the skin's type.
test("the skin wins the cascade: no plain rule outranks it where it restyles", () => {
  assert.deepEqual(cascadeLosses(PLAIN_RAW, SKIN_RAW), []);
});

test("its colors are the world's tokens: no raw hex, no team color on LED, no neon, gold only for the RPO family", () => {
  assert.deepEqual([...SKIN.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]), []);
  assert.doesNotMatch(SKIN, /var\(--sc-team-/);
  assert.doesNotMatch(SKIN, /(?<![-\w])(red|cyan|magenta|lime|aqua|fuchsia|blue|green|purple|violet)(?![-\w])/);
  assert.doesNotMatch(SKIN, /--uls-led-gold/);
});

test("G5-8: no rule makes the page the subject of a :has() (it would restyle the app on every DOM change)", () => {
  const rooted = /(?:#app|:root|\bhtml|\bbody)(?:\[[^\]]*\]|:not\([^()]*\)|:is\([^()]*\))*:has\(/;
  for (const css of [PLAIN, SKIN]) {
    const selectors = [...css.matchAll(/([^{}]+){/g)].map((m) => m[1].trim()).filter((sel) => !sel.startsWith("@"));
    assert.deepEqual(selectors.filter((sel) => rooted.test(sel)), []);
  }
});

test("no Doto (every word here is under 40 px), no animation, every rule scoped to the world", () => {
  assert.doesNotMatch(SKIN, /--uls-led-(num|font)/);
  assert.doesNotMatch(SKIN, /animation|transition:\s*(?!none)/);
  const selectors = [...SKIN.matchAll(/([^{}@]+)\{/g)].map((m) => m[1].trim()).filter((s) => !s.startsWith("@"));
  assert.ok(selectors.length > 20);
  for (const s of selectors) {
    if (/^media\b|\(max-width/.test(s)) continue;   // an @media block's own head
    assert.match(s, /:root\[data-world="under-the-lights"\]/, s);
  }
});

test("both files stay small, the plain one's lines short, and no em dash anywhere", () => {
  assert.deepEqual(PLAIN_RAW.split("\n").filter((l) => l.length > 120), []);
  for (const [name, text] of [["picker.css", PLAIN_RAW], ["uls picker.css", SKIN_RAW]]) {
    assert.ok(text.split("\n").length <= 400, name);
    assert.doesNotMatch(text, /—/, `${name}: no em dashes`);
  }
});
