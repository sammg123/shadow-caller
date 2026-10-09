// theme/tokens.js (ui-architecture.md 2.7; owner A10): the CSS custom properties every world defines.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  REQUIRED_TOKENS, RUNTIME_TOKENS, TOKEN_GROUPS, TOKEN_KIND, checkTokenValue, missingTokens, parseTokenBlocks,
  tokenProblems, tokensFor,
} from "../../static/js/theme/tokens.js";

const NEUTRAL_CSS = new URL("../../static/css/worlds/neutral/tokens.css", import.meta.url);

test("REQUIRED_TOKENS is the 2.7 table: 54 names in five groups, no duplicates", () => {
  assert.equal(REQUIRED_TOKENS.length, 54);
  assert.equal(new Set(REQUIRED_TOKENS).size, 54);
  assert.deepEqual(Object.keys(TOKEN_GROUPS), ["ground", "meaning", "type", "space", "motion"]);
  assert.deepEqual(TOKEN_GROUPS.ground, ["--sc-bg", "--sc-surface", "--sc-surface-2", "--sc-surface-raised", "--sc-scrim",
    "--sc-ink", "--sc-ink-muted", "--sc-ink-inverse", "--sc-rule", "--sc-rule-strong"]);
  assert.deepEqual(TOKEN_GROUPS.meaning, ["--sc-pass", "--sc-run", "--sc-rpo", "--sc-gain", "--sc-los", "--sc-good",
    "--sc-bad", "--sc-warn", "--sc-live", "--sc-focus"]);
  assert.equal(TOKEN_GROUPS.type.length, 16);
  assert.ok(TOKEN_GROUPS.space.includes("--sc-space-6") && TOKEN_GROUPS.space.includes("--sc-field-aspect"));
  assert.deepEqual(TOKEN_GROUPS.motion, ["--sc-dur-fast", "--sc-dur-med", "--sc-dur-slow", "--sc-ease-out", "--sc-ease-in-out"]);
  assert.ok(Object.isFrozen(REQUIRED_TOKENS) && Object.isFrozen(TOKEN_GROUPS.type));
});

test("RUNTIME_TOKENS are the nine team tokens theme/apply.js sets", () => {
  assert.deepEqual(RUNTIME_TOKENS, ["--sc-team-caller", "--sc-team-caller-alt", "--sc-team-caller-ink", "--sc-team-opp",
    "--sc-team-opp-alt", "--sc-team-opp-ink", "--sc-team-off", "--sc-team-off-ink", "--sc-team-def"]);
  assert.equal(REQUIRED_TOKENS.some((t) => RUNTIME_TOKENS.includes(t)), false);
});

test("every required token has a kind", () => {
  for (const name of REQUIRED_TOKENS) assert.ok(TOKEN_KIND[name], name);
  assert.equal(TOKEN_KIND["--sc-pass"], "color");
  assert.equal(TOKEN_KIND["--sc-dur-med"], "duration");
  assert.equal(TOKEN_KIND["--sc-ease-out"], "easing");
  assert.equal(TOKEN_KIND["--sc-field-aspect"], "ratio");
});

test("missingTokens lists the names whose value is empty, unreadable or blank", () => {
  const values = Object.fromEntries(REQUIRED_TOKENS.map((t) => [t, "1px"]));
  assert.deepEqual(missingTokens((n) => values[n] ?? ""), []);
  const partial = { ...values, "--sc-bg": "  ", "--sc-ink": "" };
  assert.deepEqual(missingTokens((n) => partial[n]), ["--sc-bg", "--sc-ink"]);
  assert.deepEqual(missingTokens(() => { throw new Error("no"); }).length, 54);
});

test("checkTokenValue accepts each kind's CSS and names the problem otherwise", () => {
  const ok = [
    ["--sc-bg", "#0d1424"], ["--sc-bg", "#fff"], ["--sc-scrim", "rgb(13 20 36 / 0.6)"], ["--sc-ink", "oklch(0.9 0.02 90)"],
    ["--sc-rule", "color-mix(in srgb, #fff 20%, transparent)"], ["--sc-focus", "var(--sc-gain)"],
    ["--sc-font-text", "\"Big Shoulders Text\", system-ui, sans-serif"], ["--sc-size-call", "clamp(2rem, 4vw, 5.5rem)"],
    ["--sc-size-m", "15px"], ["--sc-weight-display", "800"], ["--sc-case-label", "uppercase"],
    ["--sc-tracking-label", "0.06em"], ["--sc-tracking-label", "normal"], ["--sc-leading-body", "1.45"],
    ["--sc-space-1", "4px"], ["--sc-border-w", "0"], ["--sc-gutter", "max(16px, 2vw)"], ["--sc-field-aspect", "16 / 9"],
    ["--sc-field-aspect", "2.25"], ["--sc-dur-fast", "120ms"], ["--sc-dur-slow", "0.4s"],
    ["--sc-ease-out", "cubic-bezier(0.22, 1, 0.36, 1)"], ["--sc-ease-in-out", "steps(4, end)"], ["--sc-ease-out", "ease-out"],
  ];
  for (const [name, value] of ok) assert.equal(checkTokenValue(name, value), null, `${name}: ${value}`);
  const bad = [
    ["--sc-bg", "navy-ish"], ["--sc-bg", "#12345"], ["--sc-size-m", "big"], ["--sc-weight-strong", "heavy"],
    ["--sc-case-label", "shout"], ["--sc-dur-fast", "120"], ["--sc-ease-out", "bouncy"], ["--sc-field-aspect", "wide"],
    ["--sc-font-text", "x; } body { color: red"], ["--sc-space-2", ""],
  ];
  for (const [name, value] of bad) assert.match(checkTokenValue(name, value) ?? "", /./, `${name}: ${value}`);
  assert.match(checkTokenValue("--sc-nope", "1px"), /not a required token/);
});

test("parseTokenBlocks reads --sc-* declarations per block, with the at-rules around them", () => {
  const css = `/* --sc-bg: #000; in a comment */
    :root[data-world="x"] { --sc-bg: #0d1424; --sc-ink:#f4f1e6; color: red }
    @media (prefers-reduced-motion: reduce) {
      :root[data-world="x"] { --sc-dur-fast: 0ms; }
    }
    :root[data-world="x"][data-ambient="dark"], .other { --sc-bg: #000000; }`;
  const blocks = parseTokenBlocks(css);
  assert.equal(blocks.length, 4);
  assert.deepEqual(blocks[0], { selector: ':root[data-world="x"]', context: [],
    tokens: { "--sc-bg": "#0d1424", "--sc-ink": "#f4f1e6" } });
  assert.deepEqual(blocks[1].context, ["@media (prefers-reduced-motion: reduce)"]);
  assert.deepEqual(blocks[1].tokens, { "--sc-dur-fast": "0ms" });
  assert.deepEqual(blocks[2].tokens, {}, "the @media block itself declares nothing");
  assert.deepEqual(tokensFor(css, ":root[data-world='x']"), { "--sc-bg": "#0d1424", "--sc-ink": "#f4f1e6" });
  assert.deepEqual(tokensFor(css, ':root[data-world="x"][data-ambient="dark"]'), { "--sc-bg": "#000000" });
});

test("tokenProblems flags missing, invalid and runtime tokens a world defines", () => {
  const values = Object.fromEntries(REQUIRED_TOKENS.map((t) => [t, TOKEN_KIND[t] === "color" ? "#000000" : "x"]));
  const problems = tokenProblems({ ...values, "--sc-team-caller": "#002a5c", "--sc-bg": undefined });
  assert.ok(problems.includes("--sc-bg is missing"));
  assert.ok(problems.some((p) => p.startsWith("--sc-team-caller is a runtime token")));
  assert.ok(problems.some((p) => p.startsWith("--sc-size-m must be a CSS length")));
});

test("the neutral world's tokens.css defines every required token with a valid value", () => {
  const css = readFileSync(NEUTRAL_CSS, "utf8");
  const tokens = tokensFor(css, ':root[data-world="neutral"]');
  assert.deepEqual(tokenProblems(tokens), []);
  const dark = tokensFor(css, ':root[data-world="neutral"][data-ambient="dark"]');
  for (const [name, value] of Object.entries(dark)) assert.equal(checkTokenValue(name, value), null, name);
  assert.ok(Object.keys(dark).length >= 8, "the dark ambient redefines the ground and ink");
});
