// Fading the field's materials (three-recipe 8.3; owner A5). Every material the action layer and the kit build keeps
// its full strength as userData.opacity; setOpacity(material, k) is the one way to fade any of them to a share of it,
// a shader's uOpacity uniform or a built-in material's opacity. v1.4 (G3-9): the turf-mark shaders (the pixel grid,
// the hatch and the feathered zone of the zone, corridor and band drawings) are gone with them.

/** Fade a material to `k` (0..1) times its base opacity (userData.opacity), shader or built-in; returns the value. */
export function setOpacity(material, k) {
  const base = material?.userData?.opacity ?? 1;
  const value = base * Math.min(1, Math.max(0, k));
  if (material?.uniforms?.uOpacity) material.uniforms.uOpacity.value = value;
  else if (material) material.opacity = value;
  return value;
}
