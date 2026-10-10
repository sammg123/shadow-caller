// Freeing what a scene layer owns (ui-architecture 2.5, 6.1 memory budget; owner A5). Every Object3D the engine
// creates has one owning layer, which calls disposeTree on its root when the layer is cleared or rebuilt.
// Resources the material kit shares (materials.js caches one material per key) carry userData.shared and are never
// disposed here: the kit disposes them once, in its own dispose(). So do the materials the program keeper holds
// (keepPrograms, below: one per shader program, so three never deletes and relinks a program between plays).
// No three.js import: duck-typed, so node tests run it on plain objects.

const TEXTURE_KEYS_SKIP = new Set(["userData"]);

/** Mark a geometry, material or texture as shared (owned by the kit, not by the layer that uses it). */
export function markShared(resource) {
  if (resource && typeof resource === "object") resource.userData = { ...(resource.userData ?? {}), shared: true };
  return resource;
}

export function isShared(resource) {
  return Boolean(resource?.userData?.shared);
}

function texturesOf(material) {
  return Object.entries(material).filter(([key, v]) => !TEXTURE_KEYS_SKIP.has(key) && v?.isTexture).map(([, v]) => v)
    .concat(Object.values(material.uniforms ?? {}).map((u) => u?.value).filter((v) => v?.isTexture));
}

function freeOnce(resource, seen, counts, key, onError) {
  if (!resource || seen.has(resource) || isShared(resource)) return;
  seen.add(resource);
  try {
    resource.dispose?.();
    counts[key] += 1;
  } catch (err) {
    onError(err);
  }
}

function freeMaterial(material, seen, counts, onError) {
  if (!material || seen.has(material) || isShared(material)) return;
  for (const tex of texturesOf(material)) freeOnce(tex, seen, counts, "textures", onError);
  freeOnce(material, seen, counts, "materials", onError);
}

/**
 * Dispose every geometry, material, texture and render target under `root` that is not shared, remove CSS2D
 * label elements from the DOM, and take `root` out of its parent. Returns what was freed; a dispose that throws
 * goes to `onError` and the rest of the tree is still freed.
 */
export function disposeTree(root, { onError = () => {} } = {}) {
  const counts = { geometries: 0, materials: 0, textures: 0, elements: 0 };
  if (!root || typeof root.traverse !== "function") return counts;
  const seen = new Set();
  root.traverse((o) => {
    freeOnce(o.geometry, seen, counts, "geometries", onError);
    for (const m of [].concat(o.material ?? [])) freeMaterial(m, seen, counts, onError);
    if (o.userData?.renderTarget?.isRenderTarget) freeOnce(o.userData.renderTarget, seen, counts, "textures", onError);
    if (o.isCSS2DObject && o.element?.remove) {
      o.element.remove();
      counts.elements += 1;
    }
  });
  if (root.parent) root.removeFromParent?.();
  return counts;
}

// ---------------------------------------------------------------- the program keeper (G7-1)
// three deletes a shader program when the last material drawing with it is disposed, and compiles and links it again
// (25 to 45 ms on the main thread) for the next material of the same kind: the action layer's plays, shadows and
// residue come and go every few seconds. The keeper holds, per owner (the stage), the first material of each kind the
// frame draws (adopted after its first draw, when it holds its programs), marked shared so its play leaves it alone.

const KEEPERS = new WeakMap();
const SOURCES = new Map();
const sourceId = (src) => {
  if (!SOURCES.has(src)) SOURCES.set(src, SOURCES.size);
  return SOURCES.get(src);
};

const layoutOf = (geometry) => Object.entries(geometry?.attributes ?? {})
  .map(([name, attr]) => `${name}:${attr?.itemSize ?? 0}`).sort().join(",");

const objectKind = (o) => (o.isInstancedMesh ? `instanced${o.instanceColor ? "+color" : ""}`
  : o.isSprite ? "sprite" : o.isPoints ? "points" : o.isLine ? "line" : "mesh");

const NORMAL_BLENDING = 1;      // THREE.NormalBlending: only an opaque material's blending reaches its program

/**
 * What decides a material's shader program as the action layer varies it (three r185's program cache key: the
 * shader, its defines, vertex colors and the geometry's attributes, texture slots, side and the two passes of a
 * transparent double-sided material, opacity, the object's kind). Two materials of one kind share one program; the
 * keeper keeps one material per kind.
 */
export function programKind(material, object) {
  const shaderOf = material.isShaderMaterial ? `${sourceId(material.vertexShader)}/${sourceId(material.fragmentShader)}`
    : "";
  const opaque = material.transparent === false && material.blending === NORMAL_BLENDING && !material.alphaToCoverage;
  return [material.type, shaderOf, JSON.stringify(material.defines ?? {}), material.vertexColors, material.side,
    material.transparent, Boolean(material.forceSinglePass), opaque, material.fog, material.alphaTest > 0,
    Boolean(material.alphaHash), material.premultipliedAlpha, material.toneMapped, Boolean(material.map),
    Boolean(material.alphaMap), objectKind(object), layoutOf(object.geometry)].join("|");
}

function keeperOf(owner) {
  if (!KEEPERS.has(owner)) KEEPERS.set(owner, new Map());
  return KEEPERS.get(owner);
}

function adopt(kinds, object) {
  for (const material of [].concat(object.material ?? [])) {
    if (!material || isShared(material)) continue;
    const kind = programKind(material, object);
    if (!kinds.has(kind)) kinds.set(kind, markShared(material));
  }
}

/**
 * Keep the shader programs `root`'s objects draw with for as long as `owner` lives: each object's material is
 * adopted after its first draw (onAfterRender, then the hook is gone) when nothing of its kind is kept yet.
 * @param {object} owner  the stage (one keeper per renderer)
 * @param {object} root  an Object3D just added to the scene (a play's art, residue, the ball in play)
 */
export function keepPrograms(owner, root) {
  if (!owner || typeof root?.traverse !== "function") return;
  const kinds = keeperOf(owner);
  root.traverse((o) => {
    if (!(o.isMesh || o.isSprite || o.isPoints || o.isLine) || !o.material || o.userData?.keeping) return;
    const own = Object.hasOwn(o, "onAfterRender") ? o.onAfterRender : null;
    o.userData = { ...(o.userData ?? {}), keeping: true };
    o.onAfterRender = function keepAfterFirstDraw(...args) {
      if (own) o.onAfterRender = own;
      else delete o.onAfterRender;
      adopt(kinds, o);
      own?.apply(this, args);
    };
  });
}

/** How many kinds of program `owner` keeps (a hook for tests and debugging). */
export const keptKinds = (owner) => KEEPERS.get(owner)?.size ?? 0;

/** The owner's end (the engine's dispose): free the kept materials, and with them their programs. */
export function releasePrograms(owner) {
  const kinds = KEEPERS.get(owner);
  if (!kinds) return;
  KEEPERS.delete(owner);
  for (const material of kinds.values()) material.dispose?.();
}
