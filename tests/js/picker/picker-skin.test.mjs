// The game picker's stylesheets (static/css/picker/picker.css, static/css/picker/picker-under-the-lights.css):
// the plain one is tokens only; the Under the Lights skin keeps the world's rules the W2 skins keep (uls-skins.test.mjs):
// flat hardware, no neon, no team color on LED, radii from tokens, Doto never, no motion.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ROOT = new URL("../../../", import.meta.url);
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "");
const PLAIN = stripComments(readFileSync(new URL("static/css/picker/picker.css", ROOT), "utf8"));
const SKIN_RAW = readFileSync(new URL("static/css/picker/picker-under-the-lights.css", ROOT), "utf8");
const SKIN = stripComments(SKIN_RAW);

test("the plain picker is structure and tokens only: no raw color, no world's own token", () => {
  assert.deepEqual([...PLAIN.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g)].map((m) => m[0]), []);
  assert.doesNotMatch(PLAIN, /--uls-/);
  assert.doesNotMatch(PLAIN, /:root\[data-world/, "a world's skin lives in that world's folder");
});

test("the Under the Lights skin is flat hardware: no shadow but the focus gutter, no glass, blur or gradient", () => {
  assert.doesNotMatch(SKIN, /backdrop-filter|filter:\s*blur|drop-shadow|text-shadow|gradient\(/);
  const shadows = [...SKIN.matchAll(/box-shadow:\s*([^;]+);/g)].map((m) => m[1].trim());
  assert.ok(shadows.every((s) => s === "0 0 0 2px var(--sc-bg)"), shadows.join(" | "));
  assert.doesNotMatch(SKIN, /border-radius:[ \t]*(?![ \t]|0[;\s]|0px|var\(--sc-radius|50%)/, "radii from tokens");
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
  const plain = readFileSync(new URL("static/css/picker/picker.css", ROOT), "utf8");
  assert.deepEqual(plain.split("\n").filter((l) => l.length > 120), []);
  for (const [name, text] of [["picker.css", plain], ["uls picker.css", SKIN_RAW]]) {
    assert.ok(text.split("\n").length <= 400, name);
    assert.doesNotMatch(text, /\u2014/, `${name}: no em dashes`);
  }
});
