// Under the Lights: the lens (owner W1). A world pass (look.post.extra "uls-lens"; ui-architecture 14.6 passes): run on
// the linear HDR picture after bloom and before tone mapping, it lets the frame fall off toward the top and the corners
// the way a broadcast lens does under stadium lights, centered on the field's free area (the camera's safe-area view
// offset), so the play in the middle of the free area is the brightest thing and the panels' edges sit on a quieter
// picture. Above the optical center the falloff is a little stronger and below it much gentler (G3-2: `above`,
// `below`), so the near stands and the plaza along the bottom edge keep their light instead of sinking into a slab. Nothing is added: it only scales what is there (no
// glow, no color of its own). A full-screen triangle pair drawn with the props' own THREE, so this module never
// imports three.js itself.
//   lensPass(THREE, { camera, strength, inner, outer, above, below }) -> pass { render(renderer, writeBuffer, readBuffer) }
//   lensGain(uv, { center, aspect, strength, inner, outer, above, below }) -> the same gain in JS (tests, checks)

/** DESIGN.md's lens: how much the edges fall, where the fall starts and ends, and how much of it below the center. */
export const LENS = Object.freeze({ strength: 0.32, inner: 0.32, outer: 1.0, above: 1.25, below: 0.35 });

const VERTEX = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRAGMENT = /* glsl */`
uniform sampler2D tDiffuse;
uniform vec2 uCenter;
uniform float uAspect;
uniform float uStrength;
uniform float uInner;
uniform float uOuter;
uniform float uAbove;
uniform float uBelow;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  vec2 d = (vUv - uCenter) * vec2(uAspect, 1.0);
  d.y *= d.y < 0.0 ? uBelow : uAbove;
  float k = 1.0 - uStrength * smoothstep(uInner, uOuter, length(d));
  gl_FragColor = vec4(c.rgb * k, c.a);
}`;

const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** The lens's gain at `uv` (0..1, y up): the fragment shader's falloff, in JS. */
export function lensGain(uv, { center = { x: 0.5, y: 0.5 }, aspect = 1, strength = LENS.strength, inner = LENS.inner,
  outer = LENS.outer, above = LENS.above, below = LENS.below } = {}) {
  const dx = (uv.x - center.x) * aspect;
  const dy = (uv.y - center.y) * (uv.y < center.y ? below : above);
  return 1 - strength * smoothstep(inner, outer, Math.hypot(dx, dy));
}

/** The optical center of the free area in UV (0..1, y up), from the camera's view offset (the HUD's safe area). */
export function lensCenter(view) {
  if (!view?.enabled || !(view.width > 0) || !(view.height > 0)) return { x: 0.5, y: 0.5 };
  return { x: (view.fullWidth / 2 - view.offsetX) / view.width, y: 1 - (view.fullHeight / 2 - view.offsetY) / view.height };
}

/**
 * @param {object} THREE
 * @param {{ camera?: THREE.PerspectiveCamera | null, strength?: number, inner?: number, outer?: number,
 *   above?: number, below?: number }} opts
 */
export function lensPass(THREE, { camera = null, strength = LENS.strength, inner = LENS.inner, outer = LENS.outer,
  above = LENS.above, below = LENS.below } = {}) {
  const uniforms = { tDiffuse: { value: null }, uCenter: { value: new THREE.Vector2(0.5, 0.5) }, uAspect: { value: 1 },
    uStrength: { value: strength }, uInner: { value: inner }, uOuter: { value: outer }, uAbove: { value: above },
    uBelow: { value: below } };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, depthTest: false,
    depthWrite: false });
  material.name = "uls-lens";
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return {
    name: "uls-lens", enabled: true, needsSwap: true, renderToScreen: false,
    setSize() {},
    render(renderer, writeBuffer, readBuffer) {
      const c = lensCenter(camera?.view ?? null);
      uniforms.uCenter.value.set(c.x, c.y);
      uniforms.uAspect.value = readBuffer.height > 0 ? readBuffer.width / readBuffer.height : 1;
      uniforms.tDiffuse.value = readBuffer.texture;
      renderer.setRenderTarget(writeBuffer);
      renderer.render(scene, ortho);
    },
    dispose() {
      material.dispose();
      quad.geometry.dispose();
    },
  };
}
