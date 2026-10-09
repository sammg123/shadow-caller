// A small fake DOM for node tests of DOM-side modules (ui/dom.js, theme/apply.js, shell/*). Owner A0
// (ui-architecture.md 1.1, v1.2). It models only what those modules touch: elements and text nodes, attributes,
// `hidden`, `textContent`, child lists, events, focus, and the browser rule that matters for keyed lists: a node
// that leaves the document (including a move with insertBefore) loses focus. Like a browser, `childNodes` and
// `querySelectorAll` return NodeList-likes (index, length, item, forEach, iteration; no map or filter) and
// `children` an HTMLCollection-like (no forEach), so array-only code fails here as it would in the page.
// `doc.moves` counts element insertions, `doc.writes` counts attribute and textContent writes.
const HTML_NS = "http://www.w3.org/1999/xhtml";

function* iterate() {
  for (let i = 0; i < this.length; i += 1) yield this[i];
}

const COLLECTION_PROTO = Object.freeze({ item(i) { return this[i] ?? null; }, [Symbol.iterator]: iterate });
const NODE_LIST_PROTO = Object.freeze({
  item(i) { return this[i] ?? null; },
  forEach(fn) { for (let i = 0; i < this.length; i += 1) fn(this[i], i, this); },
  [Symbol.iterator]: iterate,
});

function listOf(proto, items) {
  const list = Object.create(proto);
  items.forEach((node, i) => { list[i] = node; });
  Object.defineProperty(list, "length", { value: items.length });
  return Object.freeze(list);
}

class FakeNode {
  constructor(doc, nodeType) {
    this.ownerDocument = doc;
    this.nodeType = nodeType;
    this.parentNode = null;
    this.kids = [];
  }

  get childNodes() { return listOf(NODE_LIST_PROTO, this.kids); }

  get firstChild() { return this.kids[0] ?? null; }

  get lastChild() { return this.kids[this.kids.length - 1] ?? null; }

  get nextSibling() {
    const siblings = this.parentNode?.kids ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }

  get isConnected() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node === this.ownerDocument;
  }

  contains(other) {
    for (let node = other; node; node = node.parentNode) if (node === this) return true;
    return false;
  }

  appendChild(child) { return this.insertBefore(child, null); }

  insertBefore(child, ref) {
    if (ref !== null && ref !== undefined && ref.parentNode !== this) throw new Error("insertBefore: ref is not a child");
    if (child.parentNode) child.parentNode.removeChild(child);
    const at = ref === null || ref === undefined ? this.kids.length : this.kids.indexOf(ref);
    this.kids.splice(at, 0, child);
    child.parentNode = this;
    if (child.nodeType === 1) this.ownerDocument.moves += 1;
    return child;
  }

  removeChild(child) {
    const at = this.kids.indexOf(child);
    if (at < 0) throw new Error("removeChild: not a child");
    this.ownerDocument.loseFocusIn(child);
    this.kids.splice(at, 1);
    child.parentNode = null;
    return child;
  }

  remove() { this.parentNode?.removeChild(this); }

  get textContent() { return this.kids.map((c) => c.textContent).join(""); }

  set textContent(value) {
    for (const child of [...this.kids]) this.removeChild(child);
    const text = String(value ?? "");
    if (text) this.appendChild(this.ownerDocument.createTextNode(text));
    this.ownerDocument.writes += 1;
  }
}

class FakeText extends FakeNode {
  constructor(doc, text) {
    super(doc, 3);
    this.data = String(text);
  }

  get textContent() { return this.data; }

  set textContent(value) { this.data = String(value ?? ""); }
}

class FakeElement extends FakeNode {
  constructor(doc, tag, ns = HTML_NS) {
    super(doc, 1);
    this.namespaceURI = ns;
    this.tagName = ns === HTML_NS ? tag.toUpperCase() : tag;
    this.localName = tag;
    this.attrs = new Map();
    this.listeners = new Map();
    this.style = createStyle();
  }

  get id() { return this.getAttribute("id") ?? ""; }

  set id(v) { this.setAttribute("id", v); }

  get hidden() { return this.attrs.has("hidden"); }

  set hidden(v) { if (v) this.setAttribute("hidden", ""); else this.removeAttribute("hidden"); }

  get className() { return this.getAttribute("class") ?? ""; }

  get children() { return listOf(COLLECTION_PROTO, this.kids.filter((c) => c.nodeType === 1)); }

  setAttribute(name, value) { this.attrs.set(String(name).toLowerCase(), String(value)); this.ownerDocument.writes += 1; }

  getAttribute(name) { return this.attrs.get(String(name).toLowerCase()) ?? null; }

  hasAttribute(name) { return this.attrs.has(String(name).toLowerCase()); }

  removeAttribute(name) { this.attrs.delete(String(name).toLowerCase()); this.ownerDocument.writes += 1; }

  addEventListener(type, fn) {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(type, [...list, fn]);
  }

  removeEventListener(type, fn) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn));
  }

  dispatchEvent(event) {
    const evt = { target: this, ...event };
    for (const fn of this.listeners.get(evt.type) ?? []) fn(evt);
    return true;
  }

  focus() { if (this.isConnected) this.ownerDocument.activeElement = this; }

  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }

  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }

  /** Supports "#id", "tag", ".cls", "[attr]" and "[attr=\"v\"]" (one simple selector), enough for tests. */
  querySelectorAll(sel) {
    const test = matcher(sel);
    const out = [];
    const walk = (node) => {
      for (const child of node.kids) {
        if (child.nodeType !== 1) continue;
        if (test(child)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return listOf(NODE_LIST_PROTO, out);
  }
}

function createStyle() {
  const props = new Map();
  return {
    setProperty(name, value) { props.set(name, String(value)); },
    getPropertyValue(name) { return props.get(name) ?? ""; },
    removeProperty(name) { props.delete(name); },
    props,
  };
}

function matcher(sel) {
  const s = sel.trim();
  if (s.startsWith("#")) return (n) => n.id === s.slice(1);
  if (s.startsWith(".")) return (n) => n.className.split(/\s+/).includes(s.slice(1));
  const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(s);
  if (attr) return (n) => n.hasAttribute(attr[1]) && (attr[2] === undefined || n.getAttribute(attr[1]) === attr[2]);
  return (n) => n.localName === s.toLowerCase();
}

/** A fresh document with <html>, <head> and <body>. */
export function createDocument() {
  const doc = new FakeNode(null, 9);
  doc.ownerDocument = doc;
  doc.moves = 0;
  doc.writes = 0;
  doc.createElement = (tag) => new FakeElement(doc, tag);
  doc.createElementNS = (ns, tag) => new FakeElement(doc, tag, ns);
  doc.createTextNode = (text) => new FakeText(doc, text);
  doc.listeners = new Map();
  doc.addEventListener = FakeElement.prototype.addEventListener.bind(doc);
  doc.removeEventListener = FakeElement.prototype.removeEventListener.bind(doc);
  doc.getElementById = (id) => doc.documentElement.querySelector(`#${id}`);
  doc.querySelector = (sel) => doc.documentElement.querySelector(sel);
  doc.querySelectorAll = (sel) => doc.documentElement.querySelectorAll(sel);
  doc.loseFocusIn = (node) => {
    if (doc.activeElement && node.contains(doc.activeElement)) doc.activeElement = doc.body;
  };
  doc.documentElement = doc.appendChild(doc.createElement("html"));
  doc.head = doc.documentElement.appendChild(doc.createElement("head"));
  doc.body = doc.documentElement.appendChild(doc.createElement("body"));
  doc.activeElement = doc.body;
  doc.moves = 0;
  doc.writes = 0;
  return doc;
}

/** Run `fn` with globalThis.document set to `doc` (until its promise settles, for async fns), then restore it. */
export function withDocument(doc, fn) {
  const had = Object.hasOwn(globalThis, "document");
  const before = globalThis.document;
  const restore = () => {
    if (had) globalThis.document = before;
    else delete globalThis.document;
  };
  globalThis.document = doc;
  let result;
  try {
    result = fn();
  } catch (err) {
    restore();
    throw err;
  }
  if (result && typeof result.then === "function") return result.finally(restore);
  restore();
  return result;
}
