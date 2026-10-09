// Freeing what a scene layer owns (ui-architecture 2.5, 6.1 memory budget; owner A5). Every Object3D the engine
// creates has one owning layer, which calls disposeTree on its root when the layer is cleared or rebuilt.
// Resources the material kit shares (materials.js caches one material per key) carry userData.shared and are never
// disposed here: the kit disposes them once, in its own dispose(). No three.js import: duck-typed, so node tests
// run it on plain objects.

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
