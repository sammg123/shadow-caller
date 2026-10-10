// The field's label layer (ui-architecture 2.5 labels.js, 6.1; package A5): DOM labels over the canvas, text only,
// at most 12 alive, freed with their layer. Canvas renderers (decal, sprite) are checked in the browser.
import assert from "node:assert/strict";
import test from "node:test";
import { loadThree, lookWith } from "./three-env.mjs";

const THREE = await loadThree();
const { createLabels, MAX_LABELS, PLATE_PAD, plateShift } = await import("../../static/js/field/labels.js");

class El {
  constructor(doc, tag) {
    Object.assign(this, { ownerDocument: doc, tagName: tag.toUpperCase(), style: {}, children: [], parentNode: null,
      className: "", attrs: {}, text: "" });
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  appendChild(c) { c.remove(); c.parentNode = this; this.children.push(c); return c; }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
    this.parentNode = null;
  }
  set textContent(v) { this.text = String(v); }
  get textContent() { return this.text + this.children.map((c) => c.textContent).join(""); }
  set innerHTML(v) { throw new Error(`innerHTML used: ${v}`); }
}

function fakeDoc() {
  const doc = { defaultView: { Element: El } };
  doc.createElement = (tag) => new El(doc, tag);
  return doc;
}

async function setup(renderer = "css2d") {
  const look = await lookWith({ labels: { renderer, className: "sc-label" } });
  const doc = fakeDoc();
  const host = doc.createElement("div");
  return { host, labels: createLabels(look.labels, host, { doc }) };
}

test("css2d: a label layer over the canvas, one element per label, text set as text", async () => {
  const { host, labels } = await setup();
  assert.equal(host.children.length, 1);
  assert.equal(host.children[0].className, "sc-field-labels");
  assert.equal(host.children[0].attrs["aria-hidden"], "true");
  const h = labels.add({ x: 30, y: 26.667, h: 2 }, "<b>Sack</b>", "sc-result bad class!");
  assert.equal(h.element.textContent, "<b>Sack</b>");
  assert.equal(h.element.className, "sc-label sc-result bad", "only valid class names pass");
  assert.deepEqual(h.object.position.toArray().map((v) => Math.round(v * 1000) / 1000), [-20, 2, 0]);
  assert.ok(h.object.isCSS2DObject);
  assert.equal(labels.group.children.length, 1);
  h.move({ x: 40, y: 26.667 });
  assert.equal(h.object.position.x, -10);
});

test("at most 12 live labels: the oldest goes first", async () => {
  const { labels } = await setup();
  const first = labels.add({ x: 0, y: 0 }, "first");
  for (let i = 0; i < MAX_LABELS; i += 1) labels.add({ x: i, y: 0 }, `n${i}`);
  assert.equal(labels.count(), MAX_LABELS);
  assert.equal(first.object.parent, null, "evicted");
  assert.equal(first.object.element.parentNode, null);
});

test("remove, clear and dispose free labels and the layer", async () => {
  const { host, labels } = await setup();
  const a = labels.add({ x: 1, y: 1 }, "a");
  labels.add({ x: 2, y: 2 }, "b");
  a.remove();
  assert.equal(labels.count(), 1);
  labels.clear();
  assert.equal(labels.count(), 0);
  labels.dispose();
  assert.equal(host.children.length, 0);
  const scene = new THREE.Scene();
  scene.add(labels.group);
  labels.dispose();
  assert.equal(labels.group.parent, null);
});

test("G3-8: plateShift moves a plate just far enough to sit inside the field, and never one that fits", () => {
  assert.equal(plateShift(195, 100, 390), 0, "in the middle: where it is");
  assert.equal(plateShift(228, 356, 390), 390 - PLATE_PAD - (228 + 178), "off the right edge: back inside it");
  assert.equal(plateShift(20, 100, 390), PLATE_PAD - (20 - 50), "off the left edge: back inside it");
  assert.equal(plateShift(195, 400, 390), 0, "wider than the field: centered on it, as wrapped plates are not");
  assert.equal(plateShift(200, 0, 390), 0, "not laid out (hidden): nothing");
});

test("G3-8: on render each plate is kept inside the field, its own spot otherwise (the inner span moves, not the anchor)",
  async () => {
    const { host, labels } = await setup();
    const scene = new THREE.Scene();
    scene.add(labels.group);
    labels.setSize(390, 300);
    const camera = new THREE.PerspectiveCamera(30, 390 / 300, 0.5, 1500);
    camera.position.set(0, 60, 90);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const wide = labels.add({ x: 78, y: 20 }, "Punt · 41 yds · downed · flag: offensive holding on DAL");
    const small = labels.add({ x: 50, y: 26.667 }, "Kneel · −1");
    wide.element.offsetWidth = 356;
    small.element.offsetWidth = 80;
    labels.render(scene, camera);
    const anchorX = (h) => Number(/translate\(([-\d.]+)px/.exec(h.object.element.style.transform)?.[1]);
    const shiftX = (h) => Number.parseFloat(h.element.style.translate || "0");
    const x = anchorX(wide);
    assert.ok(x + 178 > 390, `the anchor would put the plate past the right edge (${x})`);
    assert.ok(Math.abs(x + shiftX(wide) + 178 - (390 - PLATE_PAD)) <= 0.5, "its right edge back inside, by the pad");
    assert.equal(small.element.style.translate ?? "", "", "a plate that fits stays on its spot");
    assert.ok(host.children.length >= 1);
  });

test("renderer none (or no document): adding does nothing", async () => {
  const { host, labels } = await setup("none");
  assert.equal(labels.add({ x: 1, y: 1 }, "x"), null);
  assert.equal(host.children.length, 0);
  const look = await lookWith();
  assert.equal(createLabels(look.labels, null, { doc: null }).add({ x: 1, y: 1 }, "x"), null);
});
