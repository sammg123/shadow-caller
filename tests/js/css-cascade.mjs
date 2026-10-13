// Does a world's skin win the cascade over the plain sheet it skins? (restructure-v2.md 11 item 5: "the Under the
// Lights chat skin wins the cascade".) A skin loads after its plain sheet and scopes every rule with
// :where(:root[data-world]) (zero specificity), so it wins a tie on order alone; a plain rule more specific than every
// skin rule that restyles the same property on the same element still wins, and leaks the plain look into the world
// (the drawer's soft shadow did). cascadeLosses lists each such declaration. Selector support is what these sheets use:
// classes, attributes, pseudo-classes (:where, :is, :not, :has), pseudo-elements, types and combinators; @keyframes
// are left out and @media or @container blocks are read as plain rules (a skin mirrors the plain sheet's blocks).

const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "");
const KEYFRAMES = /@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g;
const FUNCTIONAL = /:(where|is|not|has)\(((?:[^()]|\([^()]*\))*)\)/g;
/** A shorthand and the longhands it sets (only the ones these sheets use). */
const SHORTHANDS = Object.freeze({
  border: /^border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-(width|style|color))?$/,
  "border-top": /^border-top-(width|style|color)$/,
  "border-inline-end": /^border-inline-end-(width|style|color)$/,
  "border-inline-start": /^border-inline-start-(width|style|color)$/,
  font: /^(font-(family|size|weight|style|variant|stretch)|line-height)$/,
  inset: /^(top|right|bottom|left|inset-(block|inline)(-(start|end))?)$/,
  background: /^background-/,
  padding: /^padding-/,
  margin: /^margin-/,
  outline: /^outline-(width|style|color)$/,
  "grid-area": /^grid-(row|column)(-(start|end))?$/,
});

/** Split on top-level commas (never inside parentheses). */
export function splitList(text, sep = ",") {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const c of text) {
    if (c === "(") depth += 1;
    if (c === ")") depth -= 1;
    if (c === sep && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

const order = (x, y) => (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]);

/** [ids, classes and attributes and pseudo-classes, types and pseudo-elements] of one selector. */
export function specificity(selector) {
  const sum = [0, 0, 0];
  const add = (s) => s.forEach((v, i) => { sum[i] += v; });
  let s = selector.replace(FUNCTIONAL, (_, fn, args) => {
    if (fn !== "where") add(splitList(args).map(specificity).sort((x, y) => order(y, x))[0] ?? [0, 0, 0]);
    return " ";
  });
  const count = (re, i) => {
    s = s.replace(re, () => {
      sum[i] += 1;
      return " ";
    });
  };
  count(/\[[^\]]*\]/g, 1);
  count(/::[\w-]+/g, 2);
  count(/#[\w-]+/g, 0);
  count(/\.[\w-]+/g, 1);
  count(/:[\w-]+/g, 1);
  for (const t of s.replace(/[>+~]/g, " ").split(/\s+/)) if (/^[a-z][\w-]*$/i.test(t)) sum[2] += 1;
  return sum;
}

/** The compound a selector styles (its last one), outside any :where(). */
function lastCompound(selector) {
  const bare = selector.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, " ").trim();
  const parts = bare.split(/\s*[\s>+~]\s*(?![^(]*\))/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

/** What a compound styles: its pseudo-element, the classes it requires (or its type), its attribute values. */
function targetOf(selector) {
  const last = lastCompound(selector);
  const plain = last.replace(/::[\w-]+/g, "").replace(FUNCTIONAL, " ");
  const classes = [...plain.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const type = /^[a-z][\w-]*/i.exec(plain)?.[0] ?? "";
  return {
    pseudo: /::[\w-]+/.exec(last)?.[0] ?? "",
    keys: new Set(classes.length ? classes : [type]),
    attrs: Object.fromEntries([...plain.matchAll(/\[([\w-]+)="([^"]*)"\]/g)].map((m) => [m[1], m[2]])),
  };
}

/** Two compounds that can style one element: one pseudo-element, a shared class (or type), no attribute that differs. */
function sameElement(a, b) {
  if (a.pseudo !== b.pseudo || ![...a.keys].some((k) => b.keys.has(k))) return false;
  return Object.keys(b.attrs).every((k) => !(k in a.attrs) || a.attrs[k] === b.attrs[k]);
}

const sets = (prop, wanted) => prop === wanted || Boolean(SHORTHANDS[prop]?.test(wanted))
  || Boolean(SHORTHANDS[wanted]?.test(prop));

/** Every style rule: one entry per selector of its list, with the properties it sets. */
export function styleRules(css) {
  const text = stripComments(css).replace(KEYFRAMES, "");
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap((m) => {
    const head = m[1].trim();
    if (!head || head.startsWith("@")) return [];
    const props = m[2].split(";").map((d) => d.slice(0, d.indexOf(":")).trim()).filter(Boolean);
    return splitList(head.replace(/\s+/g, " ")).map((selector) => ({ selector, props, spec: specificity(selector),
      target: targetOf(selector) }));
  });
}

/**
 * The plain sheet's declarations the skin restyles on the same element but loses to: for each, the plain selector and
 * property, and the skin's selectors that set it there (all less specific). Empty when the skin wins everywhere it
 * restyles.
 * @param {string} plainCss
 * @param {string} skinCss
 * @returns {string[]}
 */
export function cascadeLosses(plainCss, skinCss) {
  const skin = styleRules(skinCss);
  const losses = [];
  for (const rule of styleRules(plainCss)) {
    for (const prop of rule.props) {
      const rivals = skin.filter((s) => sameElement(rule.target, s.target) && s.props.some((p) => sets(p, prop)));
      if (rivals.length && rivals.every((s) => order(s.spec, rule.spec) < 0)) {
        losses.push(`${rule.selector} { ${prop} } beats ${rivals.map((s) => s.selector).join(" | ")}`);
      }
    }
  }
  return losses;
}
