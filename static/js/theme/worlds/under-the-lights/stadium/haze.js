// Under the Lights: the bowl's haze (DESIGN.md "Night": FogExp2 in bowl-haze softens the stands and towers; owner W1).
// three's fog thickens with the distance from the camera, so the blimp, 300 yards up, would see the whole stadium
// dissolve while the field (which never takes fog) stays crisp. The stadium's own parts measure their haze from the
// middle of the field instead: the air in the bowl, thicker toward the back rows, the upper deck and the towers, the
// same from every camera. It reuses three's fog uniforms (the look's fog color and density), so a day look's haze
// applies too; only the depth it is computed from changes.
//   bowlHaze(material, { reach, lift })  patches a built-in material (onBeforeCompile; the vertex shader's fog depth)
//   HAZE_DEPTH_GLSL                       the same depth for a ShaderMaterial's vertex shader (needs `worldPos`)

/** Haze depth in yards from the field's center: horizontal distance times `reach`, plus height times `lift`. */
export const HAZE = Object.freeze({ reach: 1.35, lift: 2.1 });

export const hazeDepthGlsl = ({ reach = HAZE.reach, lift = HAZE.lift } = {}) => /* glsl */`
#ifdef USE_FOG
  vFogDepth = length(worldPos.xz) * ${reach.toFixed(3)} + max(worldPos.y, 0.0) * ${lift.toFixed(3)};
#endif`;

/** The world position of a vertex in a built-in material's vertex shader (instancing included). */
const WORLD_POS = /* glsl */`
  vec4 worldPos = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    worldPos = instanceMatrix * worldPos;
  #endif
  worldPos = modelMatrix * worldPos;`;

/**
 * Measure a built-in material's fog from the field's center (mutates the material's compile hook; call once, before
 * its first render).
 * @param {THREE.Material} material  a MeshStandardMaterial, MeshBasicMaterial or PointsMaterial with fog on
 */
export function bowlHaze(material, opts = {}) {
  const depth = hazeDepthGlsl(opts);
  const prior = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prior?.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader.replace("#include <fog_vertex>", `${WORLD_POS}\n${depth}`);
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${key ? key() : ""}|uls-haze|${depth.length}`;
  return material;
}
