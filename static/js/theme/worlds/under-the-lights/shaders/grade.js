// Under the Lights: the lens (owner W1). A world pass (look.post.extra "uls-lens"; ui-architecture 14.6 passes): run on
// the linear HDR picture after bloom and before tone mapping, it lets the frame fall off toward its corners the way a
// broadcast lens does under stadium lights, centered on the field's free area (the camera's safe-area view offset), so
// the play in the middle of the free area is the brightest thing and the panels' edges sit on a quieter picture.
// Nothing is added: it only scales what is there (no glow, no color of its own). A full-screen triangle pair drawn
// with the props' own THREE, so this module never imports three.js itself.
//   lensPass(THREE, { camera, strength, inner, outer }) -> pass { render(renderer, writeBuffer, readBuffer), ... }

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
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  vec2 d = (vUv - uCenter) * vec2(uAspect, 1.0);
  float k = 1.0 - uStrength * smoothstep(uInner, uOuter, length(d));
  gl_FragColor = vec4(c.rgb * k, c.a);
}`;

/** The optical center of the free area in UV (0..1, y up), from the camera's view offset (the HUD's safe area). */
export function lensCenter(view) {
  if (!view?.enabled || !(view.width > 0) || !(view.height > 0)) return { x: 0.5, y: 0.5 };
  return { x: (view.fullWidth / 2 - view.offsetX) / view.width, y: 1 - (view.fullHeight / 2 - view.offsetY) / view.height };
}

/**
 * @param {object} THREE
 * @param {{ camera?: THREE.PerspectiveCamera | null, strength?: number, inner?: number, outer?: number }} opts
 */
export function lensPass(THREE, { camera = null, strength = 0.3, inner = 0.35, outer = 1.05 } = {}) {
  const uniforms = { tDiffuse: { value: null }, uCenter: { value: new THREE.Vector2(0.5, 0.5) }, uAspect: { value: 1 },
    uStrength: { value: strength }, uInner: { value: inner }, uOuter: { value: outer } };
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
