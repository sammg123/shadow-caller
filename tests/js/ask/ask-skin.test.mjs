// The analyst panel's stylesheets (docs/design/analyst-ui.md): static/css/ask/ask.css is structure and tokens only (the
// neutral world's look as it stands); static/css/ask/ask-under-the-lights.css is Under the Lights' skin (beside it, not
// under css/worlds/, which holds only sheets a page already registers: uls-world.test.mjs) and keeps the world's rules
// the other skins keep (uls-skins.test.mjs, picker-skin.test.mjs): flat hardware, no neon, no team color, radii from
// tokens, no Doto (every word here is under 40 px), every rule scoped to the world, so the sheet is inert in any other
// world, and motion that is a hardware step with both reduced-motion states. Every class styled is one the panel
// builds.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cascadeLosses } from "../css-cascade.mjs";

const ROOT = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "");
const PLAIN_RAW = read("static/css/ask/ask.css");
const SKIN_RAW = read("static/css/ask/ask-under-the-lights.css");
const PLAIN = stripComments(PLAIN_RAW);
const SKIN = stripComments(SKIN_RAW);
const JS = ["view.js", "panel.js"].map((f) => read(`static/js/ask/${f}`)).join("\n");

/** Selectors of every style rule, outside @keyframes (whose from/to are frames, not selectors). */
function selectors(css) {
  const noFrames = css.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
  return [...noFrames.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim()).filter((s) => !s.startsWith("@"));
}

test("the plain sheet is structure and tokens only: no raw color, no world's own token, no world selector", () => {
  assert.deepEqual([...PLAIN.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g)].map((m) => m[0]), []);
  assert.doesNotMatch(PLAIN, /--uls-/);
  assert.doesNotMatch(PLAIN, /:root\[data-world/, "a world's skin lives in that world's folder");
  assert.ok(selectors(PLAIN).length > 30);
});

test("Under the Lights is flat hardware: no shadow but the focus gutter, no glass, blur or gradient", () => {
  assert.doesNotMatch(SKIN, /backdrop-filter|filter:\s*blur|drop-shadow|text-shadow|gradient\(/);
  const shadows = [...SKIN.matchAll(/box-shadow:\s*([^;]+);/g)].map((m) => m[1].trim());
  assert.ok(shadows.every((s) => s === "0 0 0 2px var(--sc-bg)" || s === "none"), shadows.join(" | "));
  assert.doesNotMatch(SKIN, /border-radius:[ \t]*(?![ \t]|0[;\s]|0px|var\(--sc-radius|50%)/, "radii from tokens");
});

test("its colors are the world's tokens: no raw hex, no team color, no neon, gold only for the RPO family", () => {
  assert.deepEqual([...SKIN.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g)].map((m) => m[0]), []);
  assert.doesNotMatch(SKIN, /var\(--sc-team-/);
  assert.doesNotMatch(SKIN, /(?<![-\w])(red|cyan|magenta|lime|aqua|fuchsia|blue|green|purple|violet)(?![-\w])/);
  assert.doesNotMatch(SKIN, /--uls-led-gold/);
});

test("no Doto (nothing here is 40 px), every rule scoped to the world", () => {
  assert.doesNotMatch(SKIN, /--uls-led-(num|font)|Doto/);
  const all = selectors(SKIN);
  assert.ok(all.length > 30);
  for (const s of all) assert.match(s, /:root\[data-world="under-the-lights"\]/, s);
});

test("motion is the drawer running out on its rails, once, with both reduced-motion states", () => {
  const uses = [...SKIN.matchAll(/animation:\s*([a-z0-9-]+)[^;]*;/g)].filter((m) => m[1] !== "none");
  assert.ok(uses.length >= 1);
  for (const m of uses) {
    assert.doesNotMatch(m[0], /infinite/);
    assert.match(SKIN, new RegExp(`@keyframes\\s+${m[1]}\\b`));
  }
  assert.match(SKIN, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(SKIN, /\[data-motion="reduced"\]/);
  assert.doesNotMatch(SKIN, /transition:\s*(?!none)/, "steel never fades");
});

test("G5-8: no rule makes the page the subject of a :has()", () => {
  const rooted = /(?:#app|:root|\bhtml|\bbody)(?:\[[^\]]*\]|:not\([^()]*\)|:is\([^()]*\))*:has\(/;
  for (const css of [PLAIN, SKIN]) assert.deepEqual(selectors(css).filter((s) => rooted.test(s)), []);
});

// restructure-v2.md 11 item 5: the stadium skin wins the cascade. The plain sheet's drawer carried a soft shadow on a
// more specific rule than the skin's flat steel, so the shadow showed in Under the Lights; every declaration the skin
// restyles must now win on the same element.
test("the skin wins the cascade: no plain rule outranks it where it restyles (no soft shadow on the drawer)", () => {
  assert.deepEqual(cascadeLosses(PLAIN_RAW, SKIN_RAW), []);
  const slide = /:where\(:root\[data-world="under-the-lights"\]\) \.sc-ask\[data-layout="slide"\]\s*\{([^}]*)\}/
    .exec(SKIN)?.[1] ?? "";
  assert.match(slide, /box-shadow:\s*none/, "the drawer is flat steel");
});

test("the cascade check finds a plain rule that outranks a skin (the shadow this skin had)", () => {
  const plain = '.sc-ask[data-layout="slide"] { box-shadow: 2px 0 18px gray; }';
  const skin = ':where(:root[data-world="under-the-lights"]) .sc-ask { box-shadow: none; }';
  assert.equal(cascadeLosses(plain, skin).length, 1);
  assert.deepEqual(cascadeLosses(plain, `${skin} :where(:root[data-world="under-the-lights"]) `
    + '.sc-ask[data-layout="slide"] { box-shadow: none; }'), []);
  assert.deepEqual(cascadeLosses('.sc-ask[data-layout="embedded"] { border: 1px solid; }',
    ':where(:root) .sc-ask[data-layout="slide"] { border-inline-end: 0; }'), [], "a slide rule never styles the chat");
});

test("the slide-out keeps the play clear of it: open, it widens the field's left inset on the stadium layout", () => {
  assert.match(SKIN, /\[data-ask="open"\] #app\[data-layout="uls"\]\s*\{[^}]*--sc-field-safe-left:/);
});

test("every panel class the sheets style is one the panel builds", () => {
  const styled = new Set([...`${PLAIN}\n${SKIN}`.matchAll(/\.(sc-ask[a-z-]*)/g)].map((m) => m[1]));
  assert.ok(styled.size > 20);
  const missing = [...styled].filter((cls) => !JS.includes(`"${cls}"`));
  assert.deepEqual(missing, []);
});

test("both files stay small, the lines short, and no em dash anywhere", () => {
  for (const [name, text] of [["ask.css", PLAIN_RAW], ["uls ask.css", SKIN_RAW]]) {
    assert.ok(text.split("\n").length <= 400, name);
    assert.deepEqual(text.split("\n").filter((l) => l.length > 120), [], name);
    assert.doesNotMatch(text, /\u2014/, `${name}: no em dashes`);
  }
});
