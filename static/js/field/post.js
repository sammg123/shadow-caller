// Post-processing (ui-architecture 2.5 post.js, 6.1; three-recipe 2, 10.2, 10.3; owner A5). r185's own path: the
// renderer draws into a 4x MSAA HalfFloat target and renderer.setEffects([...]) runs the passes on linear HDR before
// tone mapping and the sRGB transform are applied once at the end, so insets look the same and OutputPass is never
// added (it would double-convert). Bloom is selective by brightness only: UnrealBloomPass (half resolution inside)
// with the look's threshold (1.05 by default in the recipe), so only things pushed above 1.0 glow (tower lamps, LED
// fascia, the ball's tracer); white paint, lit to about 0.85, never does. World passes are ShaderPass factories
// named in look.post.extra and found in the WorldModule's `passes`; a name with no factory is reported, not fatal.
// look.renderer.antialias "smaa" and "fxaa" use the MSAA of this path (no sRGB-input pass exists in it).
import * as THREE from "three";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

const BLOOM_SEED = 256;    // the pass resizes itself with the renderer

/**
 * @param {THREE.WebGLRenderer} renderer  created with outputBufferType HalfFloatType
 * @param {object} look  a resolved Look (post.bloom, post.extra)
 * @param {{ scene?: THREE.Scene, camera?: THREE.Camera, passes?: object, bloom?: boolean }} [opts]
 *   passes: the world's ShaderPass factories; bloom false drops bloom (the low quality tier)
 * @returns {{ effects: object[], bloom: object | null, missing: string[], render(): void, setEnabled(on): void,
 *   dispose(): void } | null}  null when the look needs no passes
 */
export function buildPost(renderer, look, { scene = null, camera = null, passes = {}, bloom: allowBloom = true } = {}) {
  const effects = [];
  const missing = [];
  let bloom = null;
  const spec = look.post.bloom;
  if (spec && allowBloom) {
    bloom = new UnrealBloomPass(new THREE.Vector2(BLOOM_SEED, BLOOM_SEED), spec.strength, spec.radius, spec.threshold);
    effects.push(bloom);
  }
  for (const name of look.post.extra) {
    const make = passes && Object.hasOwn(passes, name) ? passes[name] : null;
    const pass = typeof make === "function" ? make({ THREE, renderer, scene, camera, look }) : null;
    if (pass && typeof pass.render === "function") effects.push(pass);
    else missing.push(name);
  }
  if (!effects.length) {
    renderer.setEffects?.(null);
    return null;
  }
  renderer.setEffects(effects);
  return {
    effects, bloom, missing,
    render() { renderer.render(scene, camera); },
    setEnabled(on) { for (const p of effects) p.enabled = Boolean(on); },
    dispose() {
      renderer.setEffects?.(null);
      for (const p of effects) p.dispose?.();
    },
  };
}
