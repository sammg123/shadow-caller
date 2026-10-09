// WebGL2 detection (ui-architecture 2.5, 6.2; package A5). three r185 needs WebGL2; a probe context is released at
// once. A software rasterizer still counts as WebGL2 (the e2e browser runs SwiftShader on purpose), but the engine
// drops to its low quality tier there.
import assert from "node:assert/strict";
import test from "node:test";
import { hasWebGL2, gpuName, isSoftwareGpu } from "../../static/js/field/webgl-support.js";

function fakeDoc(context, { name = "ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max)" } = {}) {
  const calls = { lost: 0, kinds: [] };
  const gl = {
    getExtension: (n) => {
      if (n === "WEBGL_lose_context") return { loseContext: () => { calls.lost += 1; } };
      if (n === "WEBGL_debug_renderer_info") return { UNMASKED_RENDERER_WEBGL: 37446 };
      return null;
    },
    getParameter: (p) => (p === 37446 ? name : null),
  };
  const doc = {
    createElement: (tag) => {
      assert.equal(tag, "canvas");
      return { getContext: (kind) => { calls.kinds.push(kind); if (context === "throw") throw new Error("blocked"); return context ? gl : null; } };
    },
  };
  return { doc, calls };
}

test("WebGL2 present: true, and the probe context is released", () => {
  const { doc, calls } = fakeDoc(true);
  assert.equal(hasWebGL2(doc), true);
  assert.deepEqual(calls.kinds, ["webgl2"]);
  assert.equal(calls.lost, 1);
});

test("no WebGL2, a throwing canvas or no document: false", () => {
  assert.equal(hasWebGL2(fakeDoc(false).doc), false);
  assert.equal(hasWebGL2(fakeDoc("throw").doc), false);
  assert.equal(hasWebGL2(null), false);
  assert.equal(hasWebGL2({}), false);
});

test("the GPU name comes from the debug extension; software rasterizers are recognized", () => {
  assert.match(gpuName(fakeDoc(true).doc), /Apple M4 Max/);
  assert.equal(gpuName(fakeDoc(false).doc), null);
  assert.equal(isSoftwareGpu("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0)), SwiftShader driver)"), true);
  assert.equal(isSoftwareGpu("llvmpipe (LLVM 15.0.7, 256 bits)"), true);
  assert.equal(isSoftwareGpu("Microsoft Basic Render Driver"), true);
  assert.equal(isSoftwareGpu("ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max)"), false);
  assert.equal(isSoftwareGpu(null), false);
});
