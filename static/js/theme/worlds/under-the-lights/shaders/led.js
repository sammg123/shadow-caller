import { hazeDepthGlsl } from "../stadium/haze.js";

// Under the Lights: the LED board material (DESIGN.md "The Unlit Pixel Rule", Bloom: the LED fascia about x1.1;
// directions.md Direction 5 Materials: "LED panels with a visible pixel pitch (a pixel-grid shader)"; owner W1).
// The board's picture is a small canvas (one texel per LED); up close each LED is a round dot, lit in the picture's
// color times the gain or showing its unlit pixel color, on the black panel; once a cell is smaller than about two
// screen pixels the dots average out into the picture itself, so a far board never shimmers. Fogged like the stands.
//   ledMaterial(THREE, { map, cells: [cols, rows], gain, unlit, panel }) -> THREE.ShaderMaterial

const VERTEX = /* glsl */`
#include <common>
#include <fog_pars_vertex>
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
  ${hazeDepthGlsl()}
}`;

const FRAGMENT = /* glsl */`
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uMap;
uniform vec2 uCells;
uniform float uGain;
uniform float uFarGain;
uniform vec3 uUnlit;
uniform vec3 uPanel;
varying vec2 vUv;
float lum(vec3 c) { return max(c.r, max(c.g, c.b)); }
void main() {
  vec2 cell = vUv * uCells;
  vec2 fw = fwidth(cell);
  float perPx = max(fw.x, fw.y);
  vec2 id = floor(cell);
  vec3 lit = textureLod(uMap, (id + 0.5) / uCells, 0.0).rgb;
  float d = length(fract(cell) - 0.5);
  float aa = clamp(perPx, 0.03, 0.5);
  float dotMask = 1.0 - smoothstep(0.4 - aa, 0.4 + aa, d);
  vec3 led = mix(uUnlit, lit * uGain, smoothstep(0.03, 0.2, lum(lit)));
  vec3 nearColor = mix(uPanel, led, dotMask);
  vec3 picture = texture2D(uMap, vUv).rgb;
  vec3 farColor = mix(uPanel + uUnlit * 0.45, picture * uFarGain, smoothstep(0.02, 0.25, lum(picture)));
  vec3 color = mix(nearColor, farColor, smoothstep(0.32, 0.75, perPx));
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/**
 * @param {object} THREE  the three.js namespace
 * @param {{ map: THREE.Texture, cells: [number, number], gain?: number, farGain?: number, unlit: string,
 *   panel: string }} opts  map: one texel per LED (sRGB canvas); cells: LEDs across and down the map
 */
export function ledMaterial(THREE, { map, cells, gain = 1.35, farGain = 1.12, unlit, panel }) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uMap: { value: null }, uCells: { value: new THREE.Vector2(cells[0], cells[1]) }, uGain: { value: gain },
    uFarGain: { value: farGain }, uUnlit: { value: new THREE.Color(unlit) }, uPanel: { value: new THREE.Color(panel) },
  }]);
  uniforms.uMap.value = map;
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, fog: true,
    side: THREE.FrontSide });
  material.name = "uls-led";
  return material;
}
