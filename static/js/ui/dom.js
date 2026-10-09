// The only way components touch the DOM (ui-architecture.md 2.6; owner A0 since v1.2, was A9).
// Text always goes in as text (G27): there is no HTML path here. Attribute writes are guarded: no event-handler
// attributes, no srcdoc, no script URLs. Writes are skipped when the value is already there, so a render that
// changes nothing touches nothing. `reconcile` updates keyed lists in place and keeps focus (G18, FI 4.3).
const SVG_NS = "http://www.w3.org/2000/svg";
const EL_OPTIONS = new Set(["id", "cls", "attrs", "data", "text", "on"]);
const ATTR_NAME = /^[A-Za-z_][\w:.-]*$/;
const DATA_KEY = /^[a-z][A-Za-z0-9-]*$/;
const URL_ATTRS = new Set(["href", "src", "action", "formaction", "xlink:href", "poster", "cite", "ping", "background"]);
const SAFE_DATA_URL = /^data:image\/(png|gif|jpeg|webp);/;
const SCRIPT_SCHEME = /^(javascript|vbscript|data):/;
const URL_NOISE = /[\u0000- \u007f]/g;
/** Keyed children per list parent: Map<key, node>, written by reconcile only. */
const KEYED = new WeakMap();

const doc = () => globalThis.document;

function classText(cls) {
  const list = Array.isArray(cls) ? cls : [cls];
  return list.filter((c) => typeof c === "string" && c !== "").join(" ");
}

function isUnsafeUrl(value) {
  const plain = String(value).replace(URL_NOISE, "").toLowerCase();
  return SCRIPT_SCHEME.test(plain) && !SAFE_DATA_URL.test(plain);
}

function checkAttr(name, value) {
  if (typeof name !== "string" || !ATTR_NAME.test(name)) throw new TypeError(`bad attribute name "${name}"`);
  const lower = name.toLowerCase();
  if (lower.startsWith("on")) throw new TypeError(`"${name}" is an event handler attribute; use el(..., { on })`);
  if (lower === "srcdoc") throw new TypeError("srcdoc is an HTML sink");
  if (URL_ATTRS.has(lower) && value !== null && value !== undefined && isUnsafeUrl(value)) {
    throw new TypeError(`unsafe URL in ${name}`);
  }
}

/** Set an attribute: null, undefined or false removes it, true sets "", anything else becomes a string. */
export function setAttr(node, name, value) {
  checkAttr(name, value);
  if (value === null || value === undefined || value === false) {
    if (node.hasAttribute(name)) node.removeAttribute(name);
    return;
  }
  const text = value === true ? "" : String(value);
  if (node.getAttribute(name) !== text) node.setAttribute(name, text);
}

const kebab = (key) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/**
 * Set data-<key> (camelCase keys become kebab-case: sceneReady → data-scene-ready). Booleans are written as
 * "true" / "false" (the 5.3 and 5.4 hooks read them that way); null or undefined removes the attribute.
 */
export function setData(node, key, value) {
  if (typeof key !== "string" || !DATA_KEY.test(key)) throw new TypeError(`bad data key "${key}"`);
  const name = `data-${kebab(key)}`;
  if (value === null || value === undefined) {
    if (node.hasAttribute(name)) node.removeAttribute(name);
    return;
  }
  const text = String(value);
  if (node.getAttribute(name) !== text) node.setAttribute(name, text);
}

/** textContent; null or undefined becomes "". Never parses markup. */
export function setText(node, text) {
  const value = text === null || text === undefined ? "" : String(text);
  if (node.textContent !== value) node.textContent = value;
}

export function setHidden(node, hidden) {
  const want = Boolean(hidden);
  if (node.hidden !== want) node.hidden = want;
}

/** Add or remove one class (works on HTML and SVG nodes alike). */
export function setClass(node, cls, on) {
  const current = (node.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
  const has = current.includes(cls);
  if (Boolean(on) === has) return;
  const next = on ? [...current, cls] : current.filter((c) => c !== cls);
  if (next.length) node.setAttribute("class", next.join(" "));
  else node.removeAttribute("class");
}

/** Remove every child. */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function appendAll(node, children) {
  for (const child of children ?? []) {
    if (child === null || child === undefined || child === false) continue;
    const isNode = typeof child === "object" && typeof child.nodeType === "number";
    node.appendChild(isNode ? child : doc().createTextNode(String(child)));
  }
}

function applyOptions(node, opts) {
  for (const name of Object.keys(opts)) if (!EL_OPTIONS.has(name)) throw new TypeError(`el: unknown option "${name}"`);
  const { id, cls, attrs, data, text, on } = opts;
  if (id !== undefined && id !== null) setAttr(node, "id", id);
  if (cls !== undefined && classText(cls)) setAttr(node, "class", classText(cls));
  for (const [name, value] of Object.entries(attrs ?? {})) setAttr(node, name, value);
  for (const [key, value] of Object.entries(data ?? {})) setData(node, key, value);
  if (text !== undefined && text !== null) setText(node, text);
  for (const [type, fn] of Object.entries(on ?? {})) {
    if (typeof fn !== "function") throw new TypeError(`el: on.${type} must be a function`);
    node.addEventListener(type, fn);
  }
}

/**
 * Create an HTML element. opts: { id, cls (string or string[]), attrs, data, text, on: { event: handler } };
 * children: nodes, or strings and numbers (added as text nodes); null, undefined and false are skipped.
 */
export function el(tag, opts = {}, children = []) {
  const node = doc().createElement(tag);
  applyOptions(node, opts ?? {});
  appendAll(node, children);
  return node;
}

/** Create an SVG element with attributes (the same guards as setAttr) and children. */
export function svgEl(tag, attrs = {}, children = []) {
  const node = doc().createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs ?? {})) setAttr(node, name, value);
  appendAll(node, children);
  return node;
}

// ---------------------------------------------------------------- reconcile
/** Indexes of `seq` (current positions, -1 for new nodes) that form a longest increasing run: they stay put. */
function stayingIndexes(seq) {
  const tails = [];
  const prev = new Array(seq.length).fill(-1);
  seq.forEach((v, i) => {
    if (v < 0) return;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]] < v) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  });
  const keep = new Set();
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) keep.add(i);
  return keep;
}

function placeInOrder(parent, nodes) {
  const position = new Map([...parent.childNodes].map((n, i) => [n, i]));
  const keep = stayingIndexes(nodes.map((n) => (position.has(n) ? position.get(n) : -1)));
  let anchor = null;
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i];
    const inPlace = node.parentNode === parent && node.nextSibling === anchor;
    if (!keep.has(i) && !inPlace) parent.insertBefore(node, anchor);
    anchor = node;
  }
}

function nodesFor(parent, items, key, create) {
  const before = KEYED.get(parent) ?? new Map();
  const after = new Map();
  const nodes = items.map((item, i) => {
    const k = String(key(item, i));
    if (after.has(k)) throw new TypeError(`reconcile: duplicate key "${k}"`);
    const kept = before.get(k);
    const node = kept && kept.parentNode === parent ? kept : create(item, i);
    if (!node || typeof node.nodeType !== "number") throw new TypeError("reconcile: create must return a node");
    after.set(k, node);
    return node;
  });
  return { nodes, after };
}

/**
 * Keyed list update. `parent` belongs to the list: every child reconcile did not create is removed. Kept nodes
 * are never rebuilt, only the fewest are moved, and a focused row keeps focus. `update(node, item, index)` runs
 * for every item, right after `create(item, index)` for new ones.
 * @param {Element} parent
 * @param {unknown[]} items
 * @param {{ key: (item, index: number) => string | number, create: (item, index: number) => Node,
 *           update: (node: Node, item, index: number) => void }} fns
 */
export function reconcile(parent, items, { key, create, update }) {
  const owner = parent.ownerDocument ?? doc();
  const active = owner?.activeElement ?? null;
  const hadFocus = Boolean(active && active !== parent && parent.contains(active));
  const { nodes, after } = nodesFor(parent, items ?? [], key, create);
  const wanted = new Set(nodes);
  for (const child of [...parent.childNodes]) if (!wanted.has(child)) parent.removeChild(child);
  placeInOrder(parent, nodes);
  KEYED.set(parent, after);
  nodes.forEach((node, i) => update(node, items[i], i));
  if (hadFocus && owner.activeElement !== active && active.isConnected && typeof active.focus === "function") {
    active.focus({ preventScroll: true });
  }
}
