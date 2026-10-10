// disposeTree (ui-architecture 2.5; package A5): frees what a layer owns, never what the material kit shares.
import assert from "node:assert/strict";
import test from "node:test";
import { disposeTree, markShared, isShared, keepPrograms, keptKinds, programKind, releasePrograms }
  from "../../static/js/field/dispose.js";

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

// ---------------------------------------------------------------- the program keeper (G7-1)
const attrs = (spec) => Object.fromEntries(Object.entries(spec).map(([name, itemSize]) => [name, { itemSize }]));
const STRIP = { position: 3, prev: 3, next: 3, side: 1, dist: 1, alpha: 1 };
const PLANE = { position: 3, normal: 3, uv: 2 };

function material(extra = {}) {
  return disposable({ type: "MeshBasicMaterial", isMaterial: true, transparent: true, side: 2, fog: false,
    vertexColors: false, blending: 1, alphaTest: 0, premultipliedAlpha: false, toneMapped: true, defines: undefined,
    ...extra });
}
const shader = (extra = {}) => material({ type: "ShaderMaterial", isShaderMaterial: true, vertexShader: "void main(){}",
  fragmentShader: "void main(){ gl_FragColor = vec4(1.0); }", defines: {}, ...extra });
const mesh = (mat, spec, extra = {}) => node({ isMesh: true, material: mat, geometry: disposable({ attributes: attrs(spec) }),
  ...extra });
/** What three's renderer does after it draws an object: its onAfterRender. */
const render = (root) => root.traverse((o) => o.onAfterRender?.({}, {}, {}, o.geometry, o.material, null));

test("programKind: what decides a material's shader program, as the action layer varies it", () => {
  const kind = (m, spec, extra) => programKind(m, mesh(m, spec, extra));
  const px = kind(shader(), STRIP);
  assert.equal(px, kind(shader(), STRIP), "the same shader on the same layout: one kind");
  assert.notEqual(px, kind(shader({ defines: { WORLD_UNITS: "" } }), STRIP), "turf-wide strips");
  assert.notEqual(px, kind(shader({ vertexColors: true }), { ...STRIP, color: 3 }), "residue's per-path colors");
  assert.notEqual(px, kind(shader({ fragmentShader: "void main(){}" }), STRIP), "another shader");
  const basic = kind(material(), { position: 3 });
  assert.notEqual(basic, kind(material(), PLANE), "a plane has normals and uvs; an arrowhead does not");
  assert.notEqual(kind(material({ vertexColors: true }), { position: 3, color: 4 }),
    kind(material({ vertexColors: true }), { position: 3, color: 3 }), "RGBA vertex colors");
  assert.notEqual(kind(material({ alphaMap: {} }), PLANE), kind(material(), PLANE), "a glyph mask");
  assert.notEqual(kind(material({ alphaMap: {} }), PLANE, { isInstancedMesh: true, instanceColor: {} }),
    kind(material({ alphaMap: {} }), PLANE), "instanced marks");
  assert.notEqual(kind(material({ type: "SpriteMaterial", map: {} }), {}, { isMesh: false, isSprite: true }),
    kind(material({ type: "SpriteMaterial", alphaMap: {} }), {}, { isMesh: false, isSprite: true }));
});

test("keepPrograms: the first material of each kind drawn is kept (shared: its art leaves it), one per kind", () => {
  const owner = {};
  const first = shader();
  const twin = shader();
  const other = material();
  const art1 = node({}, [mesh(first, STRIP), mesh(other, { position: 3 })]);
  const art2 = node({}, [mesh(twin, STRIP)]);
  keepPrograms(owner, art1);
  keepPrograms(owner, art2);
  assert.equal(keptKinds(owner), 0, "nothing until the frame draws them (a program is made at the first draw)");
  render(art1);
  render(art2);
  assert.equal(keptKinds(owner), 2);
  assert.ok(isShared(first) && isShared(other) && !isShared(twin), "one per kind");
  disposeTree(art1);
  disposeTree(art2);
  assert.deepEqual([first.disposed, other.disposed, twin.disposed], [0, 0, 1], "a kept material outlives its play");
  assert.equal(art1.children[0].geometry.disposed, 1, "its geometry still goes");
  assert.equal(Object.hasOwn(art1.children[0], "onAfterRender"), false, "the hook is gone after the first draw");
  releasePrograms(owner);
  assert.deepEqual([first.disposed, other.disposed], [1, 1], "the engine's end frees them");
  assert.equal(keptKinds(owner), 0);
});

test("keepPrograms: a play freed before it was ever drawn keeps nothing; an object's own hook still runs", () => {
  const owner = {};
  const never = shader();
  const art = node({}, [mesh(never, STRIP)]);
  keepPrograms(owner, art);
  disposeTree(art);
  assert.equal(keptKinds(owner), 0);
  assert.equal(never.disposed, 1);
  let own = 0;
  const hooked = mesh(shader(), STRIP, { onAfterRender() { own += 1; } });
  keepPrograms(owner, node({}, [hooked]));
  render(hooked);
  render(hooked);
  assert.equal(own, 2);
  assert.equal(keptKinds(owner), 1);
  keepPrograms(null, art);
  releasePrograms({});
});

test("a dispose that throws does not stop the rest of the tree", () => {
  const bad = { dispose() { throw new Error("gl gone"); }, userData: {} };
  const good = disposable();
  const errors = [];
  disposeTree(node({}, [node({ geometry: bad }), node({ geometry: good })]), { onError: (e) => errors.push(e.message) });
  assert.equal(good.disposed, 1);
  assert.deepEqual(errors, ["gl gone"]);
});
