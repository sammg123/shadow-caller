// Under the Lights: a tower's light shaft in the haze (DESIGN.md "Night": "faint additive light shafts from each
// tower, at most 6% opacity, never above the bloom threshold"; owner W1). An open cone from the lamp bank toward the
// field, drawn additively: strongest along the beam's axis as seen from the camera (its edges dissolve), rising out
// of the lamps and thinning out before it reaches the turf, so it reads as light in the air and never as a shape on
// the field. The light dip scales it with the towers (uLevel).
//   shaftMaterial(THREE, { color, opacity }) -> THREE.ShaderMaterial (uniforms uOpacity, uLevel)

const VERTEX = /* glsl */`
varying float vAlong;
varying vec3 vNormalV;
varying vec3 vViewV;
void main() {
  vAlong = 1.0 - uv.y;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormalV = normalize(normalMatrix * normal);
  vViewV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const FRAGMENT = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
uniform float uLevel;
varying float vAlong;
varying vec3 vNormalV;
varying vec3 vViewV;
void main() {
  float facing = abs(dot(normalize(vNormalV), normalize(vViewV)));
  float core = pow(facing, 2.2);
  float along = smoothstep(0.0, 0.12, vAlong) * (1.0 - smoothstep(0.45, 0.98, vAlong));
  float a = uOpacity * uLevel * core * along;
  gl_FragColor = vec4(uColor, a);
}`;

/** An additive, depth-tested, depth-unwritten shaft material (a CylinderGeometry with its narrow top at the lamps). */
export function shaftMaterial(THREE, { color, opacity = 0.05 }) {
  const material = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uLevel: { value: 1 } },
    vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  material.name = "uls-shaft";
  return material;
}
