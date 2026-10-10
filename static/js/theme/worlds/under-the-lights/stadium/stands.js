// Under the Lights: the stands' mesh and material (DESIGN.md "The bowl": dark low-poly rings in steel and haze tones;
// owner W1). The rows, walls, fascia bodies and the four towers' steel share one vertex-colored, lit material, so the
// whole stadium structure is one draw call. The bowl is never pitch black: its concourses and aisles glow faintly
// (a self-light of each part's own tone), so the tiers read from every camera, and the towers' spill lights them on
// top; both fall with the stadium lights in the dip (setLevel). The haze is the bowl's own (haze.js).
import { createBuilder } from "./builder.js";
import { addStands } from "./bowl.js";
import { bowlHaze } from "./haze.js";
import { addTowerSteel } from "./towers.js";

export const SELF_LIGHT = Object.freeze({ night: 0.55, day: 0.12 });
const LITE_GAIN = Object.freeze({ night: 0.9, day: 2.4 });

function standsMaterial(THREE, base) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.05 });
  const self = { value: base };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSelfLight = self;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uSelfLight;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n  totalEmissiveRadiance += vColor.rgb * uSelfLight;");
  };
  material.customProgramCacheKey = () => "uls-stands";
  bowlHaze(material);
  return { material, self };
}

/** A software rasterizer's stands: the same tones, unlit (no per-pixel lights to pay for). */
function liteMaterial(THREE, day) {
  const material = bowlHaze(new THREE.MeshBasicMaterial({ vertexColors: true }));
  material.color.setScalar(day ? LITE_GAIN.day : LITE_GAIN.night);
  const base = material.color.r;
  const self = { set value(k) { material.color.setScalar(k * base / SELF_LIGHT.night); } };
  return { material, self };
}

/**
 * The stands and the towers' steel as one mesh; by day the self-light is a little bounce, not the concourse lights.
 * @returns {{ mesh: THREE.Mesh, setLevel(k: number): void, dispose(): void }}
 */
export function createStands(THREE, frames, { day = false, lite = false } = {}) {
  const b = createBuilder();
  addStands(b, { day });
  addTowerSteel(b, frames);
  const base = day ? SELF_LIGHT.day : SELF_LIGHT.night;
  const { material, self } = lite ? liteMaterial(THREE, day) : standsMaterial(THREE, base);
  const mesh = new THREE.Mesh(b.build(THREE), material);
  mesh.name = "uls-stands";
  return {
    mesh,
    setLevel(k) { self.value = base * k; },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}
