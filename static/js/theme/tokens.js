// The CSS custom properties a world defines (ui-architecture.md 2.7; owner A10). Pure.
// A world defines every REQUIRED_TOKENS name under :root[data-world="<id>"] in css/worlds/<id>/tokens.css.
// RUNTIME_TOKENS come from the game's teams (DC C2) and are set by theme/apply.js: worlds read them, never define
// them. Names only here; the values are each world's. The helpers check a world's tokens.css in node
// (parseTokenBlocks, tokensFor, tokenProblems) and in the page (missingTokens over getComputedStyle).

const freezeAll = (groups) => Object.freeze(Object.fromEntries(Object.entries(groups)
  .map(([k, v]) => [k, Object.freeze(v)])));

/** The 2.7 table, in its order. Comments say what each name is for, so a world can pick values. */
export const TOKEN_GROUPS = freezeAll({
  ground: [
    "--sc-bg",              // page ground behind everything
    "--sc-surface",         // panels and regions
    "--sc-surface-2",       // a second, quieter panel level (rows, wells)
    "--sc-surface-raised",  // things above the page: toast, menus, the booth drawer
    "--sc-scrim",           // backdrop behind an open overlay
    "--sc-ink",             // main text
    "--sc-ink-muted",       // secondary text, captions
    "--sc-ink-inverse",     // text on --sc-ink or a strong fill
    "--sc-rule",            // hairlines and separators
    "--sc-rule-strong",     // section rules, table heads
  ],
  meaning: [
    "--sc-pass", "--sc-run", "--sc-rpo",   // play families (FI 0 keeps the meaning; the world picks the value)
    "--sc-gain",                           // line to gain
    "--sc-los",                            // line of scrimmage
    "--sc-good", "--sc-bad",               // better / worse, right / wrong
    "--sc-warn",                           // estimated values, retrying feed
    "--sc-live",                           // live indicator (ESPN on, watch playing)
    "--sc-focus",                          // keyboard focus ring
  ],
  type: [
    "--sc-font-display", "--sc-font-text", "--sc-font-num",
    "--sc-size-call",   // the next call: the largest text on screen (PRODUCT principle 1)
    "--sc-size-xl", "--sc-size-l", "--sc-size-m", "--sc-size-s", "--sc-size-xs",
    "--sc-weight-regular", "--sc-weight-strong", "--sc-weight-display",
    "--sc-case-label",     // text-transform for labels and captions
    "--sc-tracking-label", // letter-spacing for labels and captions
    "--sc-leading-tight", "--sc-leading-body",
  ],
  space: [
    "--sc-space-1", "--sc-space-2", "--sc-space-3", "--sc-space-4", "--sc-space-5", "--sc-space-6",
    "--sc-radius-s", "--sc-radius-m", "--sc-radius-l",
    "--sc-border-w", "--sc-focus-w",
    "--sc-gutter",        // page side gutter (16px or more at phone width)
    "--sc-field-aspect",  // aspect-ratio of the field host, "16 / 9"
  ],
  motion: ["--sc-dur-fast", "--sc-dur-med", "--sc-dur-slow", "--sc-ease-out", "--sc-ease-in-out"],
});

export const REQUIRED_TOKENS = Object.freeze(Object.values(TOKEN_GROUPS).flat());

/** Set by theme/apply.js from the teams (fill, alternate, ink on the fill; offense and defense follow possession). */
export const RUNTIME_TOKENS = Object.freeze([
  "--sc-team-caller", "--sc-team-caller-alt", "--sc-team-caller-ink",
  "--sc-team-opp", "--sc-team-opp-alt", "--sc-team-opp-ink",
  "--sc-team-off", "--sc-team-off-ink", "--sc-team-def",
]);

function kindOf(name) {
  if (TOKEN_GROUPS.ground.includes(name) || TOKEN_GROUPS.meaning.includes(name)) return "color";
  if (name.startsWith("--sc-font-")) return "font";
  if (name.startsWith("--sc-size-")) return "length";
  if (name.startsWith("--sc-weight-")) return "weight";
  if (name.startsWith("--sc-leading-")) return "leading";
  if (name.startsWith("--sc-dur-")) return "duration";
  if (name.startsWith("--sc-ease-")) return "easing";
  const special = { "--sc-case-label": "case", "--sc-tracking-label": "tracking", "--sc-field-aspect": "ratio" };
  return special[name] ?? "length";
}

/** Value kind per required token: color, font, length, weight, case, tracking, leading, ratio, duration, easing. */
export const TOKEN_KIND = Object.freeze(Object.fromEntries(REQUIRED_TOKENS.map((n) => [n, kindOf(n)])));

const NUM = String.raw`-?(?:\d+\.?\d*|\.\d+)`;
const FN = String.raw`(?:var|calc|clamp|min|max|env)\(.+\)`;
const LENGTH = new RegExp(String.raw`^(?:0|${NUM}(?:px|rem|em|ex|ch|vw|vh|vmin|vmax|dvh|svh|lvh|cqw|cqh|%)|${FN})$`);
const COLOR_FN = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark|var)\(.+\)$/;
const HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const COLOR_WORDS = /^(?:transparent|currentcolor|black|white|canvas|canvastext|[a-z]{3,20})$/;
const VAR_ONLY = /^var\(--[\w-]+(?:\s*,.+)?\)$/;

const CHECKS = {
  color: (v) => HEX.test(v) || COLOR_FN.test(v) || COLOR_WORDS.test(v.toLowerCase()),
  font: (v) => (/^[\w\s"',.-]+$/.test(v) && /[a-z]/i.test(v)) || VAR_ONLY.test(v),
  length: (v) => LENGTH.test(v),
  weight: (v) => /^(?:[1-9]00|normal|bold|bolder|lighter)$/.test(v) || VAR_ONLY.test(v),
  case: (v) => /^(?:none|uppercase|lowercase|capitalize)$/.test(v) || VAR_ONLY.test(v),
  tracking: (v) => v === "normal" || LENGTH.test(v),
  leading: (v) => v === "normal" || new RegExp(`^${NUM}$`).test(v) || LENGTH.test(v),
  ratio: (v) => new RegExp(String.raw`^${NUM}(?:\s*/\s*${NUM})?$`).test(v) || VAR_ONLY.test(v),
  duration: (v) => new RegExp(String.raw`^(?:0|${NUM}m?s)$`).test(v) || VAR_ONLY.test(v),
  easing: (v) => /^(?:linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end)$/.test(v)
    || /^(?:cubic-bezier|steps|linear|var)\(.+\)$/.test(v),
};

/** A problem with one token's value, or null when it is fine. Names outside REQUIRED_TOKENS are a problem too. */
export function checkTokenValue(name, value) {
  const kind = TOKEN_KIND[name];
  if (!kind) return `${name} is not a required token`;
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return `${name} is empty`;
  if (/[;{}]/.test(text)) return `${name} must not contain ; { or }`;
  return CHECKS[kind](text) ? null : `${name} must be a CSS ${kind}, got "${text}"`;
}

/** Required tokens that resolve to nothing. `read(name)` is getComputedStyle(root).getPropertyValue in a page. */
export function missingTokens(read) {
  return REQUIRED_TOKENS.filter((name) => {
    try {
      const value = read(name);
      return typeof value !== "string" || value.trim() === "";
    } catch {
      return true;
    }
  });
}

/** Every problem with a world's token values: missing, invalid, or a runtime token it must not define. */
export function tokenProblems(values) {
  const given = values ?? {};
  const required = REQUIRED_TOKENS.flatMap((name) => {
    if (given[name] === undefined || given[name] === null) return [`${name} is missing`];
    const problem = checkTokenValue(name, given[name]);
    return problem ? [problem] : [];
  });
  const runtime = RUNTIME_TOKENS.filter((n) => given[n] !== undefined)
    .map((n) => `${n} is a runtime token (theme/apply.js sets it from the teams); worlds read it, never define it`);
  return [...required, ...runtime];
}

// ---------------------------------------------------------------- reading a tokens.css (node checks)
const DECL = /(--sc-[a-z0-9-]+)\s*:\s*([^;]*?)\s*(?:;|$)/g;

function ownText(text, from, to, holes) {
  let out = "";
  let at = from;
  for (const [a, b] of holes) {
    out += text.slice(at, a);
    at = b;
  }
  return out + text.slice(at, to);
}

const declarations = (body) => Object.fromEntries([...body.matchAll(DECL)].map((m) => [m[1], m[2]]));

/**
 * Blocks of a stylesheet in the order they close (an inner block before its @media): { selector, context: the
 * enclosing preludes, outermost first, tokens: the block's own --sc-* declarations }.
 */
export function parseTokenBlocks(cssText) {
  const text = String(cssText ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = [];
  const stack = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "{") {
      stack.push({ prelude: text.slice(start, i).trim(), preludeStart: start, bodyStart: i + 1, holes: [] });
      start = i + 1;
    } else if (ch === "}" && stack.length) {
      const frame = stack.pop();
      const tokens = declarations(ownText(text, frame.bodyStart, i, frame.holes));
      blocks.push({ selector: frame.prelude, context: stack.map((f) => f.prelude), tokens });
      if (stack.length) stack[stack.length - 1].holes.push([frame.preludeStart, i + 1]);
      start = i + 1;
    } else if (ch === ";") {
      start = i + 1;
    }
  }
  return blocks;
}

const normalizeSelector = (s) => s.replace(/'/g, "\"").replace(/\s+/g, " ").trim();

/** The --sc-* values that top-level blocks (outside any at-rule) give `selector`, later blocks winning. */
export function tokensFor(cssText, selector) {
  const want = normalizeSelector(selector);
  return parseTokenBlocks(cssText)
    .filter((b) => b.context.length === 0 && b.selector.split(",").map(normalizeSelector).includes(want))
    .reduce((acc, b) => ({ ...acc, ...b.tokens }), {});
}
