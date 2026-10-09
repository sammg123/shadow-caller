// WebGL2 detection (ui-architecture 2.5, 6.2; owner A5). three.js r185 needs WebGL2 ("WebGL 1 is not supported
// since r163"); addons/capabilities/WebGL.js is not vendored, so the probe is ours. The probe context is released
// at once so it never counts against the browser's context limit. A software rasterizer (SwiftShader, llvmpipe,
// WARP) still has WebGL2, and the e2e browser runs SwiftShader on purpose, so it is not refused here: the engine
// reads gpuName and drops to its low quality tier instead (three-recipe 10.4).

const SOFTWARE_RE = /swiftshader|llvmpipe|softpipe|software|basic render/i;

function probe(doc, read) {
  let gl = null;
  try {
    gl = doc?.createElement?.("canvas")?.getContext?.("webgl2") ?? null;
    return read(gl);
  } catch {
    return read(null);
  } finally {
    try {
      gl?.getExtension?.("WEBGL_lose_context")?.loseContext?.();
    } catch {
      // the probe context is gone either way
    }
  }
}

/** True when the document can create a WebGL2 context. */
export function hasWebGL2(doc) {
  return probe(doc, (gl) => Boolean(gl));
}

/** The unmasked renderer string ("ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max)"), or null. */
export function gpuName(doc) {
  return probe(doc, (gl) => {
    const ext = gl?.getExtension?.("WEBGL_debug_renderer_info");
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
    return typeof name === "string" && name ? name : null;
  });
}

/** True for a CPU rasterizer (20 to 30 times slower than a GPU here, three-recipe 10.11). */
export function isSoftwareGpu(name) {
  return typeof name === "string" && SOFTWARE_RE.test(name);
}
