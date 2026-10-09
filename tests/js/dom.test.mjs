// ui/dom.js (ui-architecture.md 2.6; owner A0 since v1.2): the only way components touch the DOM.
import assert from "node:assert/strict";
import test from "node:test";
import { clear, el, reconcile, setAttr, setClass, setData, setHidden, setText, svgEl } from "../../static/js/ui/dom.js";
import { createDocument, withDocument } from "./fake-dom.mjs";

const inDoc = (fn) => withDocument(createDocument(), () => fn(globalThis.document));

test("el builds an element from id, cls, attrs, data, text, on and children", () => inDoc((doc) => {
  let clicks = 0;
  const child = el("b", { text: "inner" });
  const node = el("button", {
    id: "logBtn", cls: ["key", "on"], attrs: { type: "button", "aria-pressed": true, disabled: false },
    data: { k: "P", driveActive: true }, text: "Log play", on: { click: () => { clicks += 1; } },
  }, [child, "tail", null, 0]);
  assert.equal(node.tagName, "BUTTON");
  assert.equal(node.id, "logBtn");
  assert.equal(node.getAttribute("class"), "key on");
  assert.equal(node.getAttribute("type"), "button");
  assert.equal(node.getAttribute("aria-pressed"), "");
  assert.equal(node.hasAttribute("disabled"), false);
  assert.equal(node.getAttribute("data-k"), "P");
  assert.equal(node.getAttribute("data-drive-active"), "true");
  assert.equal(node.textContent, "Log playinnertail0");
  node.dispatchEvent({ type: "click" });
  assert.equal(clicks, 1);
  assert.equal(doc.body.contains(node), false, "el never attaches the node anywhere");
}));

test("el refuses option names it does not know (catches className and class typos)", () => inDoc(() => {
  assert.throws(() => el("div", { className: "x" }), /unknown option "className"/);
  assert.throws(() => el("div", { class: "x" }), /unknown option "class"/);
}));

test("el takes a class string as given and skips empty class lists", () => inDoc(() => {
  assert.equal(el("p", { cls: "a b" }).getAttribute("class"), "a b");
  assert.equal(el("p", { cls: [] }).hasAttribute("class"), false);
  assert.equal(el("p", { cls: ["a", null, "", "b"] }).getAttribute("class"), "a b");
}));

test("svgEl creates SVG-namespaced nodes with attributes and children", () => inDoc(() => {
  const line = svgEl("line", { x1: 0, y1: 1.5, class: "lgmark" });
  const svg = svgEl("svg", { viewBox: "0 0 10 10", role: "img" }, [line]);
  assert.equal(svg.namespaceURI, "http://www.w3.org/2000/svg");
  assert.equal(svg.getAttribute("viewbox"), "0 0 10 10");
  assert.equal(line.getAttribute("y1"), "1.5");
  assert.equal(line.getAttribute("class"), "lgmark");
  assert.equal(svg.firstChild, line);
}));

test("setText writes textContent, turns null into empty, and skips equal writes", () => inDoc((doc) => {
  const node = el("span");
  setText(node, 42);
  assert.equal(node.textContent, "42");
  setText(node, null);
  assert.equal(node.textContent, "");
  setText(node, "<b>not html</b>");
  assert.equal(node.textContent, "<b>not html</b>");
  assert.equal(node.childNodes.length, 1, "markup stays text");
  const writes = doc.writes;
  setText(node, "<b>not html</b>");
  assert.equal(doc.writes, writes, "an equal value does not touch the DOM");
}));

test("setAttr: null and false remove, true sets empty, values become strings, equal writes are skipped", () => inDoc((doc) => {
  const node = el("input");
  setAttr(node, "aria-invalid", true);
  assert.equal(node.getAttribute("aria-invalid"), "");
  setAttr(node, "aria-invalid", false);
  assert.equal(node.hasAttribute("aria-invalid"), false);
  setAttr(node, "maxlength", 5);
  assert.equal(node.getAttribute("maxlength"), "5");
  const before = doc.writes;
  setAttr(node, "maxlength", "5");
  assert.equal(doc.writes, before);
  setAttr(node, "maxlength", null);
  assert.equal(node.hasAttribute("maxlength"), false);
  setAttr(node, "maxlength", undefined);
  assert.equal(node.hasAttribute("maxlength"), false);
}));

test("setAttr refuses event-handler attributes, srcdoc and script URLs (G27, section 1)", () => inDoc(() => {
  const node = el("a");
  assert.throws(() => setAttr(node, "onclick", "alert(1)"), /event handler/);
  assert.throws(() => setAttr(node, "ONLOAD", "x"), /event handler/);
  assert.throws(() => setAttr(el("iframe"), "srcdoc", "<p>x</p>"), /srcdoc/);
  assert.throws(() => setAttr(node, "href", "javascript:alert(1)"), /unsafe URL/);
  assert.throws(() => setAttr(node, "href", " jAvA\tscript:alert(1)"), /unsafe URL/);
  assert.throws(() => setAttr(node, "href", "data:text/html,<script>"), /unsafe URL/);
  assert.throws(() => setAttr(node, "bad name", "x"), /attribute name/);
  setAttr(node, "href", "/api/export.csv");
  setAttr(el("img"), "src", "/api/logo/DAL?v=dark");
  setAttr(el("img"), "src", "data:image/png;base64,AAAA");
  assert.equal(node.getAttribute("href"), "/api/export.csv");
}));

test("setData writes data-* in kebab case; booleans become true or false; null removes", () => inDoc(() => {
  const node = el("div");
  setData(node, "sceneReady", true);
  assert.equal(node.getAttribute("data-scene-ready"), "true");
  setData(node, "sceneReady", false);
  assert.equal(node.getAttribute("data-scene-ready"), "false");
  setData(node, "seq", 104);
  assert.equal(node.getAttribute("data-seq"), "104");
  setData(node, "ghost-highlight", "");
  assert.equal(node.getAttribute("data-ghost-highlight"), "");
  setData(node, "seq", null);
  assert.equal(node.hasAttribute("data-seq"), false);
  assert.throws(() => setData(node, "Bad Key", 1), /data key/);
}));

test("setHidden toggles the hidden attribute only when it changes", () => inDoc((doc) => {
  const node = el("div");
  setHidden(node, true);
  assert.equal(node.hidden, true);
  const before = doc.writes;
  setHidden(node, 1);
  assert.equal(doc.writes, before);
  setHidden(node, false);
  assert.equal(node.hasAttribute("hidden"), false);
}));

test("setClass adds and removes one class without touching the others", () => inDoc(() => {
  const node = el("button", { cls: "key" });
  setClass(node, "on", true);
  assert.equal(node.getAttribute("class"), "key on");
  setClass(node, "on", true);
  assert.equal(node.getAttribute("class"), "key on");
  setClass(node, "on", false);
  assert.equal(node.getAttribute("class"), "key");
  setClass(svgEl("rect"), "hot", true);
}));

test("clear removes every child", () => inDoc(() => {
  const node = el("ul", {}, [el("li"), el("li"), "x"]);
  clear(node);
  assert.equal(node.childNodes.length, 0);
}));

// ---------------------------------------------------------------- reconcile
function list(doc) {
  const ol = el("ol");
  doc.body.appendChild(ol);
  const created = [];
  const opts = {
    key: (row) => row.seq,
    create: (row) => { created.push(row.seq); return el("li", { data: { seq: row.seq } }); },
    update: (node, row, i) => { setText(node, `${row.text}@${i}`); },
  };
  const keysOf = () => [...ol.childNodes].map((n) => n.getAttribute("data-seq"));
  return { ol, created, opts, keysOf };
}

const rows = (...seqs) => seqs.map((seq) => ({ seq, text: `play ${seq}` }));

test("reconcile creates, updates and orders keyed rows", () => inDoc((doc) => {
  const { ol, created, opts, keysOf } = list(doc);
  reconcile(ol, rows(3, 2, 1), opts);
  assert.deepEqual(keysOf(), ["3", "2", "1"]);
  assert.deepEqual(created, [3, 2, 1]);
  assert.equal(ol.childNodes[0].textContent, "play 3@0");
}));

test("reconcile keeps nodes by key: prepending a row creates one node and moves none", () => inDoc((doc) => {
  const { ol, created, opts, keysOf } = list(doc);
  reconcile(ol, rows(2, 1), opts);
  const [n2, n1] = ol.childNodes;
  const moves = doc.moves;
  reconcile(ol, rows(3, 2, 1), opts);
  assert.deepEqual(keysOf(), ["3", "2", "1"]);
  assert.deepEqual(created, [2, 1, 3]);
  assert.equal(ol.childNodes[1], n2);
  assert.equal(ol.childNodes[2], n1);
  assert.equal(doc.moves - moves, 1, "only the new row is inserted");
  assert.equal(ol.childNodes[1].textContent, "play 2@1", "kept rows are updated with their new index");
}));

test("reconcile removes rows whose key is gone, and any child it did not create", () => inDoc((doc) => {
  const { ol, opts, keysOf } = list(doc);
  ol.appendChild(el("li", { text: "stray" }));
  reconcile(ol, rows(1, 2, 3), opts);
  assert.deepEqual(keysOf(), ["1", "2", "3"]);
  reconcile(ol, rows(1, 3), opts);
  assert.deepEqual(keysOf(), ["1", "3"]);
  reconcile(ol, [], opts);
  assert.equal(ol.childNodes.length, 0);
}));

test("reconcile reorders with the fewest moves (one row to the end is one move)", () => inDoc((doc) => {
  const { ol, opts, keysOf } = list(doc);
  reconcile(ol, rows(1, 2, 3, 4), opts);
  const moves = doc.moves;
  reconcile(ol, rows(2, 3, 4, 1), opts);
  assert.deepEqual(keysOf(), ["2", "3", "4", "1"]);
  assert.equal(doc.moves - moves, 1);
  reconcile(ol, rows(4, 3, 2, 1), opts);
  assert.deepEqual(keysOf(), ["4", "3", "2", "1"]);
}));

test("reconcile keeps focus on a focused row, even when that row has to move (G18)", () => inDoc((doc) => {
  const { ol, opts } = list(doc);
  reconcile(ol, rows(1, 2, 3), opts);
  const focused = ol.childNodes[0];
  focused.focus();
  reconcile(ol, rows(2, 3, 1, 4), opts);
  assert.equal(doc.activeElement, focused, "focus survives the move of row 1");
  reconcile(ol, rows(5, 2, 3, 1, 4), opts);
  assert.equal(doc.activeElement, focused);
}));

test("reconcile does not steal focus that sits outside the list", () => inDoc((doc) => {
  const { ol, opts } = list(doc);
  const outside = el("input");
  doc.body.appendChild(outside);
  reconcile(ol, rows(1, 2), opts);
  outside.focus();
  reconcile(ol, rows(2, 1), opts);
  assert.equal(doc.activeElement, outside);
}));

test("reconcile refuses duplicate keys and a create that returns no node", () => inDoc((doc) => {
  const { ol, opts } = list(doc);
  assert.throws(() => reconcile(ol, rows(1, 1), opts), /duplicate key "1"/);
  assert.throws(() => reconcile(el("ul"), rows(1), { ...opts, create: () => null }), /create must return a node/);
}));

test("two lists reconcile independently", () => inDoc((doc) => {
  const a = list(doc);
  const b = list(doc);
  reconcile(a.ol, rows(1, 2), a.opts);
  reconcile(b.ol, rows(1), b.opts);
  assert.deepEqual(a.keysOf(), ["1", "2"]);
  assert.deepEqual(b.keysOf(), ["1"]);
}));
