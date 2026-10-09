// disposeTree (ui-architecture 2.5; package A5): frees what a layer owns, never what the material kit shares.
import assert from "node:assert/strict";
import test from "node:test";
import { disposeTree, markShared, isShared } from "../../static/js/field/dispose.js";

function disposable(extra = {}) {
  const o = { disposed: 0, dispose() { this.disposed += 1; }, userData: {}, ...extra };
  return o;
}

function node(fields = {}, children = []) {
  const n = { userData: {}, children, parent: null, removed: 0, ...fields,
    traverse(fn) { fn(this); for (const c of this.children) c.traverse(fn); },
    removeFromParent() { this.removed += 1; } };
  for (const c of children) c.parent = n;
  return n;
}

test("geometries, materials and their textures are disposed once each, even when used twice", () => {
  const tex = disposable({ isTexture: true });
  const mat = disposable({ map: tex, alphaMap: tex, color: { r: 1 } });
  const geo = disposable();
  const tree = node({}, [node({ geometry: geo, material: mat }), node({ geometry: geo, material: [mat] })]);
  const counts = disposeTree(tree);
  assert.deepEqual([geo.disposed, mat.disposed, tex.disposed], [1, 1, 1]);
  assert.deepEqual(counts, { geometries: 1, materials: 1, textures: 1, elements: 0 });
});

test("shared geometries, materials and textures (the kit's cache) are left alone", () => {
  const shared = markShared(disposable());
  const sharedTex = markShared(disposable({ isTexture: true }));
  const own = disposable({ map: sharedTex });
  const tree = node({}, [node({ geometry: markShared(disposable()), material: shared }), node({ material: own })]);
  disposeTree(tree);
  assert.equal(shared.disposed, 0);
  assert.equal(sharedTex.disposed, 0);
  assert.equal(own.disposed, 1);
  assert.equal(isShared(shared), true);
  assert.equal(isShared(own), false);
  assert.equal(isShared(null), false);
});

test("CSS2D labels lose their element, render targets are freed, and the root leaves its parent", () => {
  const element = { removed: 0, remove() { this.removed += 1; } };
  const rt = disposable({ isRenderTarget: true });
  const label = node({ isCSS2DObject: true, element });
  const root = node({ userData: { renderTarget: rt } }, [label]);
  root.parent = {};
  const counts = disposeTree(root);
  assert.equal(element.removed, 1);
  assert.equal(rt.disposed, 1);
  assert.equal(root.removed, 1);
  assert.equal(counts.elements, 1);
  assert.deepEqual(disposeTree(null), { geometries: 0, materials: 0, textures: 0, elements: 0 });
});

test("a dispose that throws does not stop the rest of the tree", () => {
  const bad = { dispose() { throw new Error("gl gone"); }, userData: {} };
  const good = disposable();
  const errors = [];
  disposeTree(node({}, [node({ geometry: bad }), node({ geometry: good })]), { onError: (e) => errors.push(e.message) });
  assert.equal(good.disposed, 1);
  assert.deepEqual(errors, ["gl gone"]);
});
