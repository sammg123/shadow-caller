// Smaller stage parts (package A5): post-processing from the Look, the plain neutral surroundings, and the renderer
// rig's loop (G7: MSAA by pixel ratio, resize bursts, the cold-start warm-up, the DPR governor) on a fake renderer.
import assert from "node:assert/strict";
import test from "node:test";
import { loadThree, lookWith } from "./three-env.mjs";

const THREE = await loadThree();
const { buildPost } = await import("../../static/js/field/post.js");
const { neutralProps } = await import("../../static/js/field/structures.js");
const { createRig, passMaterials } = await import("../../static/js/field/renderer.js");
const { DPR } = await import("../../static/js/field/stage-math.js");

function fakeRenderer() {
  const calls = [];
  return { calls, setEffects: (list) => calls.push(list === null ? null : list.length), render: () => calls.push("render") };
}

test("post: none for a look without bloom or passes; bloom from the look; world passes by name", async () => {
  const r = fakeRenderer();
  assert.equal(buildPost(r, await lookWith()), null);
  assert.deepEqual(r.calls, [null]);
  const look = await lookWith({ post: { bloom: { strength: 0.5, radius: 0.5, threshold: 1.05 }, extra: ["ledgrid", "nope"] } });
  const made = [];
  const passes = { ledgrid: (ctx) => { made.push(Object.keys(ctx).sort().join()); return { render() {}, dispose() { made.push("disposed"); } }; } };
  const post = buildPost(r, look, { passes });
  assert.equal(post.bloom.strength, 0.5);
  assert.equal(post.bloom.threshold, 1.05);
  assert.equal(post.effects.length, 2);
  assert.deepEqual(post.missing, ["nope"]);
  assert.deepEqual(made, ["THREE,camera,look,renderer,scene"]);
  assert.equal(r.calls.at(-1), 2);
  post.setEnabled(false);
  assert.ok(post.effects.every((p) => p.enabled === false));
  post.render();
  post.dispose();
  assert.equal(r.calls.at(-1), null);
  assert.ok(made.includes("disposed"));
  assert.equal(buildPost(fakeRenderer(), look, { bloom: false, passes: {} }), null, "the low tier drops bloom");
});

test("neutral surroundings: benches on both sidelines and a low wall, one draw call each", async () => {
  const props = neutralProps({ look: await lookWith() });
  const benches = props.object.getObjectByName("benches");
  assert.equal(benches.count, 12);
  const m = new THREE.Matrix4();
  const zs = [...Array(benches.count).keys()].map((i) => { benches.getMatrixAt(i, m); return Math.sign(m.elements[14]); });
  assert.deepEqual([...new Set(zs)].sort(), [-1, 1]);
  assert.ok(props.object.getObjectByName("perimeter-wall").isMesh);
  const scene = new THREE.Scene();
  scene.add(props.object);
  props.dispose();
  assert.equal(props.object.parent, null);
});

// Part 1's placeholder layers (a ball-only player, flat ghost zones) were replaced by the action layer (A5 part 2,
// v1.4): tests/js/action-layers.test.mjs covers player.js, ghost-layer.js, overlays.js and residue.js.

// ---------------------------------------------------------------- the renderer rig (renderer.js) on a fake WebGL
/** A window with a hand-cranked clock: timers, animation frames and performance.now all run on `now`. */
function fakeWin({ dpr = 2, search = "" } = {}) {
  const w = { now: 0, devicePixelRatio: dpr, location: { search }, timers: new Map(), rafs: new Map(), seq: 1 };
  Object.assign(w, {
    performance: { now: () => w.now },
    setTimeout(fn, ms) { const id = w.seq++; w.timers.set(id, { fn, at: w.now + ms }); return id; },
    clearTimeout(id) { w.timers.delete(id); },
    requestAnimationFrame(fn) { const id = w.seq++; w.rafs.set(id, fn); return id; },
    cancelAnimationFrame(id) { w.rafs.delete(id); },
    /** Let `ms` pass: due timers fire in order. */
    wait(ms) {
      const end = w.now + ms;
      for (;;) {
        const due = [...w.timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        w.timers.delete(due[0]);
        w.now = Math.max(w.now, due[1].at);
        due[1].fn();
      }
      w.now = end;
    },
    /** One display frame `dt` ms after the last: every waiting animation frame callback runs. */
    frame(dt = 16.7) {
      w.now += dt;
      const fns = [...w.rafs.values()];
      w.rafs.clear();
      for (const fn of fns) fn(w.now);
      return fns.length;
    },
  });
  return w;
}

/** A WebGLRenderer stand-in that records what the rig asks of it. */
function fakeGl(params) {
  const st = { target: null, ratio: 1, calls: [] };
  const log = (...c) => st.calls.push(c);
  return {
    params, calls: st.calls, toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 1,
    shadowMap: { enabled: false, type: 0, autoUpdate: true, needsUpdate: false },
    info: { autoReset: true, reset() {}, render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 },
      programs: [] },
    extensions: { has: () => true },
    setClearColor() {},
    getPixelRatio: () => st.ratio,
    setPixelRatio(v) { st.ratio = v; log("setPixelRatio", v); },
    setDrawingBufferSize(w, h, v) { st.ratio = v; log("setDrawingBufferSize", w, h, v); },
    setSize(w, h) { log("setSize", w, h, st.ratio); },
    getRenderTarget: () => st.target,
    setRenderTarget(t) { st.target = t; },
    compileAsync(scene) { log("compileAsync", st.target ? st.target.texture.type : null, scene); return Promise.resolve(scene); },
    render(scene) { log("render", scene.isScene && scene.children.length === 0 ? "empty" : "scene", st.target); },
    setEffects(list) { log("setEffects", list === null ? null : list.length); },
    dispose() { log("dispose"); },
  };
}

/** A canvas whose getContext records the attributes asked for. */
const canvas = () => {
  const c = { asked: [], addEventListener() {}, removeEventListener() {} };
  c.getContext = (kind, attrs) => { c.asked.push([kind, attrs]); return { kind, attrs }; };
  return c;
};

async function rigWith({ dpr = 2, search = "", tier = "high", look = {}, on = canvas() } = {}) {
  const win = fakeWin({ dpr, search });
  const made = [];
  const events = [];
  const rig = createRig(on, await lookWith(look), { tier, win, emit: (e, p) => events.push([e, p]),
    makeRenderer: (params) => { const r = fakeGl(params); made.push(r); return r; } });
  return { rig, win, gl: made[0], events, canvas: on };
}

const sizes = (gl) => gl.calls.filter((c) => c[0] === "setSize");

test("rig (G7-4): the scene keeps 4x MSAA; the canvas's own buffer, which only takes the output copy, has none", async () => {
  const { gl, canvas: c } = await rigWith({ dpr: 2 });
  assert.equal(gl.params.antialias, true, "the HDR target the scene draws into: MSAA at every pixel ratio");
  assert.equal(gl.params.outputBufferType, THREE.HalfFloatType);
  assert.deepEqual(c.asked.map(([kind]) => kind), ["webgl2"]);
  const [, attrs] = c.asked[0];
  assert.deepEqual([attrs.antialias, attrs.depth, attrs.stencil], [false, false, false],
    "no multisampled or depth buffer behind a full-screen copy (165 MB at 1440x900 at 2x)");
  assert.equal(gl.params.context.attrs, attrs, "three draws through that context");
  assert.equal((await rigWith({ dpr: 1, tier: "low" })).gl.params.antialias, false, "software rendering: never");
  assert.equal((await rigWith({ look: { renderer: { antialias: "none" } } })).gl.params.antialias, false);
  const direct = await rigWith({ look: { renderer: { toneMapping: "none" } } });
  assert.equal(direct.gl.params.context, undefined, "no output pass: the scene draws into the canvas, three makes it");
  assert.equal(direct.canvas.asked.length, 0);
  const noDom = await rigWith({ on: { addEventListener() {}, removeEventListener() {} } });
  assert.equal(noDom.gl.params.context, undefined);
});

test("rig: a resize burst reallocates the drawing buffer once, when it ends; a few pixels is CSS scaling", async () => {
  const { rig, win, gl } = await rigWith({ dpr: 2 });
  assert.equal(rig.setSize(1440, 900), true);
  assert.deepEqual(sizes(gl), [["setSize", 1440, 900, 2]], "the first size at once");
  for (let w = 1430; w >= 1200; w -= 10) rig.setSize(w, Math.round(w * 0.625));
  assert.equal(sizes(gl).length, 1, "nothing reallocated while the window moves");
  assert.deepEqual(rig.viewSize(), { width: 1200, height: 750 }, "the camera already frames the new size");
  assert.deepEqual(rig.size(), { width: 1440, height: 900 }, "the old drawing buffer, scaled by CSS meanwhile");
  win.wait(60);
  rig.setSize(1180, 738);
  win.wait(100);
  assert.equal(sizes(gl).length, 1, "a step 60 ms later restarts the wait");
  win.wait(50);
  assert.deepEqual(sizes(gl).at(-1), ["setSize", 1180, 738, 2]);
  assert.equal(sizes(gl).length, 2, "one reallocation for the whole burst");
  rig.setSize(1181, 737);
  win.wait(500);
  assert.equal(sizes(gl).length, 2, "a pixel either way keeps the buffer");
  assert.deepEqual(rig.viewSize(), { width: 1181, height: 737 });
  assert.equal(rig.setSize(1181, 737), false, "the same size again is nothing");
  assert.equal(gl.calls.filter((c) => c[0] === "setPixelRatio" || c[0] === "setDrawingBufferSize").length, 1,
    "the pixel ratio is set when it changes, not on every resize");
});

test("rig: the cold-start warm-up holds frames back until every program is compiled, as the frame will draw it", async () => {
  const { rig, win, gl } = await rigWith({ dpr: 1, look: { post: { bloom: { strength: 0.5, radius: 0.5, threshold: 1.05 } } } });
  rig.setSize(1440, 900);
  const blur = new THREE.ShaderMaterial();
  const bloomish = { render() {}, highPass: new THREE.ShaderMaterial(), blurs: [blur, blur], basic: new THREE.MeshBasicMaterial() };
  gl.setEffects([bloomish]);
  assert.deepEqual(passMaterials(bloomish).length, 3, "the pass's own materials, each once");
  win.frame();
  const drawn = rig.frames();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const warm = rig.warmUp(scene, camera);
  rig.requestRender();
  win.frame();
  assert.equal(rig.frames(), drawn, "no frame while the shaders compile");
  await warm;
  const compiles = gl.calls.filter((c) => c[0] === "compileAsync");
  assert.equal(compiles[0][1], THREE.HalfFloatType, "programs are keyed by their target: the output pass's HDR one");
  assert.equal(compiles[0][2], scene);
  assert.equal(compiles[1][2].children.length, 3, "then the passes' materials");
  assert.ok(gl.calls.some((c) => c[0] === "render" && c[1] === "empty"), "one empty frame links the output pass");
  assert.equal(gl.getRenderTarget(), null, "the target is put back");
  win.frame();
  assert.equal(rig.frames(), drawn + 1, "frames resume");
  const noFx = await rigWith({ dpr: 1, look: { renderer: { toneMapping: "none" } } });
  noFx.gl.toneMapping = THREE.NoToneMapping;
  await noFx.rig.warmUp(new THREE.Scene(), camera);
  assert.equal(noFx.gl.calls.find((c) => c[0] === "compileAsync")[1], null, "no output pass: the canvas itself");
});

test("rig: a warm-up that never finishes releases its hold; a compile for a swap holds nothing", async () => {
  const { rig, win, gl } = await rigWith({ dpr: 1 });
  rig.setSize(800, 600);
  win.frame();
  gl.compileAsync = () => new Promise(() => {});
  rig.warmUp(new THREE.Scene(), new THREE.PerspectiveCamera());
  rig.requestRender();
  win.frame();
  assert.equal(rig.frames(), 1);
  win.wait(15000);
  win.frame();
  assert.equal(rig.frames(), 2, "drawn anyway after the cap");
  rig.compile(new THREE.Scene(), new THREE.PerspectiveCamera());
  rig.requestRender();
  win.frame();
  assert.equal(rig.frames(), 3, "a swap's compile never holds the frame");
});

test("rig: a warm-up that finishes after the cap never releases a later warm-up's hold", async () => {
  const { rig, win, gl } = await rigWith({ dpr: 1 });
  rig.setSize(800, 600);
  win.frame();
  const done = [];
  gl.compileAsync = () => new Promise((resolve) => { done.push(resolve); });
  const late = rig.warmUp(new THREE.Scene(), new THREE.PerspectiveCamera());
  win.wait(15000);
  const next = rig.warmUp(new THREE.Scene(), new THREE.PerspectiveCamera());
  done[0]();
  await late;
  rig.requestRender();
  win.frame();
  assert.equal(rig.frames(), 1, "still held by the second warm-up");
  done[1]();
  await next;
  win.frame();
  assert.equal(rig.frames(), 2);
});

test("rig: slow GPU frames step the ratio down, frames slow from the engine's own CPU don't; ?dpr= turns it off", async () => {
  const run = async ({ search = "", cpuMs = 0, dtMs = 40 } = {}) => {
    const { rig, win, gl } = await rigWith({ dpr: 2, search });
    rig.setSize(1440, 900);
    rig.keepAlive(() => { win.now += cpuMs; return true; });
    for (let i = 0; i < DPR.WINDOW + 3; i += 1) win.frame(dtMs - cpuMs);
    return { rig, gl };
  };
  assert.equal((await run()).rig.dpr(), 1.75, "the GPU fell behind");
  assert.equal((await run({ cpuMs: 25 })).rig.dpr(), 2, "the engine was busy: not a GPU problem");
  const pinned = await run({ search: "?dpr=1.5" });
  assert.equal(pinned.rig.dpr(), 1.5, "pinned, and never governed");
  const wide = await rigWith({ dpr: 1 });
  wide.rig.setSize(3840, 2160);
  wide.rig.keepAlive(() => true);
  for (let i = 0; i < DPR.WINDOW + 3; i += 1) wide.win.frame(40);
  assert.equal(wide.rig.dpr(), 0.75, "a 4K viewport at 1x still has a step down");
});
