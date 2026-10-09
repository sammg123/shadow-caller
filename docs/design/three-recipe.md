# GameCast 3D: three.js r185 recipe (field, overlays, cameras, play animation)

Status: implementation recipe. Every code block below was built and run as a working prototype against the
vendored three.js r185 (`static/vendor/three`, `REVISION "185"`), loaded through the same import map the app will
use, in headless Chromium (Playwright 1.60) on two GL backends (ANGLE Metal on Apple M4 Max, and SwiftShader), fed by the saved
TB at DAL game (`data/espn/summary_401872980_final.json`) and a real engine prediction taken from the sandbox
(`scripts/sandbox.py --port 5098`, replay, then a drive started at DAL 35). Nothing in the app was changed.

Companion docs, which this recipe obeys:

- `docs/design/data-contract.md`: field coordinates (A), timeline rows (B), teams and the logo proxy (C2), Watch
  pacing (E3, E4). The animation input below is a contract row, not raw ESPN JSON.
- `docs/design/directions.md`: the shared approximation grammar (section 1) and the five visual directions. The
  engine here is direction-neutral; section 4.9 maps each direction onto its knobs.

---

## 0. Decisions at a glance

| # | Decision | Why (evidence) |
| --- | --- | --- |
| 1 | 1 world unit = 1 yard. `world.x = x - 50` (contract x: -10..110 from the caller's goal line), `world.z = 26.667 - y`, y up. Caller always attacks +x. | Same frame as data-contract A1 to A5. The near sideline (+z) faces the default camera. |
| 2 | Renderer: `new WebGLRenderer({ antialias: true, outputBufferType: HalfFloatType })` plus `renderer.setEffects([bloom])`. No EffectComposer, no OutputPass, no FXAA. | New in r185 and used by the official r185 examples (`webgl_shaders_ocean`, `webgl_watch`). 4x MSAA on the HDR target, tone mapping and sRGB applied once at the end, insets get the same treatment. |
| 3 | `NeutralToneMapping`, exposure 1.0. | Khronos PBR Neutral is the identity below 0.76 linear (after a 0.04 toe), so ESPN team hexes stay close to themselves. ACES/AgX shift hues. |
| 4 | Every painted line (yard lines, 1-yard ticks, hashes, goal lines, borders, PAT mark, yellow restraining and coaches' lines) is computed per pixel in the turf shader. | Crisp at every zoom with no texture memory; sub-pixel lines fade by true coverage instead of shimmering. |
| 5 | Decals only where a glyph is needed: numerals and arrows (one merged mesh, one draw call, alphaMap atlas), end zone wordmarks, midfield logo, the down-and-distance graphic. | 55 to 65 draw calls for the whole stadium with bloom (measured). |
| 6 | Selective bloom by brightness: `UnrealBloomPass(res, 0.5, 0.5, 1.05)`; only materials pushed above 1.0 in linear HDR glow. | No layers, no second composer. White paint is lit to about 0.85, so it never blooms. |
| 7 | Fat lines are `Line2`/`LineMaterial`. Never `THREE.Line` with `linewidth`. | r185 `LineSegments2.onBeforeRender` sets `resolution` itself; `linewidth` on core lines is ignored (1 px). |
| 8 | Labels are DOM via `CSS2DRenderer` with a screen-space declutter. | Crisp at any DPR, accessible, CSS-styled per direction, no texture churn. |
| 9 | Animation = pure keyframe timeline per contract row, 2.2 to 4.0 s per play at 1x, squeezed to `0.8 * (watch.next_at - now)` in Watch mode. | Testable in node; contract E4 rule. |
| 10 | Measured facts are drawn solid; estimates (drop, mesh, lateral lanes, incompletion depth, kick heights) carry `approx` and are drawn dimmer or hatched. | PRODUCT principle 3 and the directions grammar. No players, routes or formations, ever. |
| 11 | Render on demand: the loop runs only while something moves, then `setAnimationLoop(null)`. | 0 frames in 1.5 s at rest (measured), so a 3-hour live game doesn't burn the GPU between snaps. |
| 12 | `stage.warmUp()` = `renderer.compileAsync(scene, camera)` at startup. | Worst frame during the first plays fell from 108.8 ms to 10.4 ms (measured). |
| 13 | No WebGL2, or a software rasterizer (SwiftShader, llvmpipe, WARP): keep the existing 2D SVG field. | SwiftShader runs the scene at 4 to 6 fps (p50 250 ms high tier, 158 ms low tier, measured). |

---

## 1. Research and reuse

### 1.1 GitHub search

Queries run with `gh search repos` (three.js american football field, threejs football field, gridiron three.js,
football play visualizer three, nfl 3d field threejs, american football 3d webgl, gamecast, big data bowl three,
football field shader, virtual first down line, stadium threejs, sports broadcast threejs, plus topic searches
`threejs`+`football`/`nfl`) and `gh search code` (`lineOfScrimmage`, `firstDownLine`, `yardsToEndzone`,
`endZoneDepth`, `hashMarks`, `lineToGain`, filtered to JS and TS). Result: **no license-compatible three.js
American football field exists.** Every relevant repo is unlicensed, so nothing was copied; only techniques.

| Repo | License | What it does | Taken / rejected |
| --- | --- | --- | --- |
| [schulerj89/football-threejs](https://github.com/schulerj89/football-threejs) | none | three.js football game: `fieldSpec.ts` (1 unit = 1 yd, 70'9" hashes), layout as pure data with a validator, static markings merged per material, `CameraMath.ts` exponential smoothing with speed and angle limits | **Taken (technique):** layout as pure data + tests; merge static marks; damped camera. |
| [mmongan/mmongan.github.io](https://github.com/mmongan/mmongan.github.io) `src/field/markings.ts` | NOASSERTION | Babylon.js field: hash offsets per level (NFL, NCAA, HS), ticks merged into one mesh | **Taken:** per-level presets (section 4.2). |
| [themathgeek13/skystudio_airlab](https://github.com/themathgeek13/skystudio_airlab) `src/sports/FootballField.js` | none | three.js field drawn with `THREE.Line` and `linewidth` | **Rejected:** core lines are 1 px on every platform and alias at distance (pitfall 3). |
| [aneurycasado/gridiron-rampage](https://github.com/aneurycasado/gridiron-rampage) `Ground.jsx` | none | R3F field with stacked planes at y 0.01 / 0.02 | **Rejected:** y-offset stacking z-fights at broadcast distance (pitfall 4). |
| [benmerz/full_game_animation_nfl](https://github.com/benmerz/full_game_animation_nfl) | none | SVG field in yards, 70'9" hashes | Confirms conventions only. |
| [jthomas0786/The-Sports-Outpost](https://github.com/jthomas0786/The-Sports-Outpost) `playstage` | none | DOM/CSS GameCast | No 3D. |

Primary references (MIT or published technique):

- three.js r185 examples (MIT), read at tag `r185`: `webgl_shaders_ocean.html` and `webgl_watch.html` (outputBufferType
  + setEffects + UnrealBloomPass + Timer), `webgl_postprocessing_unreal_bloom_selective.html` (layers approach, not
  used), `webgl_lines_fat.html`, `css2d_label.html`.
- Ben Golus, [The Best Darn Grid Shader (Yet)](https://bgolus.medium.com/the-best-darn-grid-shader-yet-727f9278b9d8):
  draw lines at least one pixel wide and scale them by true coverage. Our `lineAA()` is an independent adaptation.
- Rory Driscoll, [frame-rate independent damping](http://www.rorydriscoll.com/2016/03/07/frame-rate-independent-damping-using-lerp/)
  (the formula behind `THREE.MathUtils.damp`).
- Field facts: NFL rulebook field markings ([operations.nfl.com](https://operations.nfl.com/the-rules/nfl-rulebook/))
  and [Wikipedia, American football field](https://en.wikipedia.org/wiki/American_football_field). Table in 4.1.

### 1.2 What the saved game taught us (checked in the JSON)

- `start.yardLine`/`end.yardLine` are measured from the home goal line (332 of 366 spots match; the misses are
  timeouts and one DAL punt whose `yardsToEndzone` is wrong). The contract already turns this into `geo.x0`.
- ESPN logo PNGs on `a.espncdn.com` send `access-control-allow-origin: *` (curl, 2026-10-09), so a canvas can read
  them, but the contract's `/api/logo/<abbr>` proxy is still the source to use (offline demos, no hotlinking).
- Team colors: DAL `#002a5c` on a night scene and TB `#bd1c36` on turf (WCAG 1.03 against `#2e6b3a`) both vanish.
  Paths therefore get a light core with the team color as glow, never team color alone (data-contract C2).

---

## 2. r185 API facts, verified against `static/vendor/three`

The build is minified, so names were checked by grepping `build/three.core.min.js` / `three.module.min.js` and the
unminified addons, and behavior was read in the r185 sources at the `r185` tag.

| API | How to use it in r185 | Gotcha |
| --- | --- | --- |
| Color management | `ColorManagement.enabled` is `true`; working space `LinearSRGBColorSpace`; `renderer.outputColorSpace` defaults to `SRGBColorSpace`. `new Color(0x2e6b3a)` reads hex as sRGB and stores linear. | `CanvasTexture`/`Texture` default to `NoColorSpace`: set `SRGBColorSpace` on color images, leave masks as they are. |
| HDR output | `new WebGLRenderer({ antialias: true, outputBufferType: HalfFloatType })`, then `renderer.setEffects([pass, ...])` or `setEffects(null)`. | `setEffects` errors unless `outputBufferType` is Half/Float. Passing an `OutputPass` warns ("not needed in setEffects()"). The internal target is MSAA x4 when `antialias` is true. |
| Tone mapping | `renderer.toneMapping = THREE.NeutralToneMapping` (also `AgX`, `ACESFilmic`). | In any post chain (setEffects or EffectComposer) the scene renders untonemapped and everything is tone mapped once at the end, so `material.toneMapped = false` has **no effect**. |
| `UnrealBloomPass(resolution, strength = 1, radius, threshold)` | Pass `radius` and `threshold` explicitly (no defaults). Internal targets are HalfFloat at half size; `needsSwap = false`; blends additively into the read buffer. | `threshold` compares linear HDR luminance: 1.05 means "only things pushed above 1.0". |
| `EffectComposer(renderer, renderTarget)` | For MSAA pass `new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 })`; then `composer.setPixelRatio(dpr); composer.setSize(w, h)`. Order: `RenderPass`, bloom, `OutputPass`, then `SMAAPass`/FXAA (they need sRGB input). | Default target has no MSAA. `SMAAPass()` takes **no arguments** in r185. Verified working, same image as the setEffects path. |
| `Line2` / `LineMaterial` | `geo.setPositions(flatXYZ)`, `new LineMaterial({ linewidth: px, worldUnits: false, ... })`, `line.computeLineDistances()` before `dashed`. | `LineSegments2.onBeforeRender` copies `renderer.getViewport()` into `material.resolution`: no manual resize code. Screen-space raycasts need `raycaster.camera` (setFromCamera sets it). |
| `CSS2DRenderer` / `CSS2DObject(el)` | `labels.setSize(w, h)`, `labels.render(scene, camera)` after every WebGL render; `obj.center.set(0.5, 1)` anchors bottom-center. | It writes the element's `transform` every frame: offset an inner child, never the element. Labels are not in `canvas.toDataURL()`. |
| Shadows | `shadowMap.type = PCFShadowMap`, soften with `light.shadow.radius` (5-tap Vogel disk + interleaved gradient noise). | `PCFSoftShadowMap` is **deprecated**: it warns "WebGLShadowMap: PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead." |
| Loop | `renderer.setAnimationLoop(fn)`; `setAnimationLoop(null)` stops it. | Use it, not `requestAnimationFrame`, so XR and context handling stay correct. |
| `Timer` (core) | `timer.connect(document)`; `timer.update(timestamp)` each frame; `getDelta()`, `getElapsed()`, `reset()`, `setTimescale()`, `dispose()`. | `Clock` is deprecated since r183 and warns on construction. Call `reset()` when restarting an on-demand loop. |
| Context loss | three.js listens to `webglcontextlost`/`restored`, calls `preventDefault()`, re-inits GL and re-uploads lazily. Test with `renderer.forceContextLoss()` / `forceContextRestore()`. | `render()` is a no-op while lost; stop your own loop and show a notice. |
| WebGL1 | Throws "WebGL 1 is not supported since r163". | `addons/capabilities/WebGL.js` is not vendored: probe `getContext('webgl2')` yourself. |
| `renderer.info` | Set `renderer.info.autoReset = false` and `info.reset()` once per frame. | With effects, the internal output render resets the counters: you'd read `calls: 1` (measured) instead of 56. |
| `compileAsync(scene, camera)` | Promise; uses `KHR_parallel_shader_compile`. | Only compiles materials already in the scene: pre-create pooled FX objects. |
| Anisotropy, sizes | `renderer.capabilities.getMaxAnisotropy()`, `.maxTextureSize`. | |
| `DataTexture` | Defaults to `NearestFilter`, no mipmaps, `flipY = false`. | For mipmapped ImageData use `new THREE.Texture(imageData)` (defaults: mipmaps, linear filters, flipY). |
| Addon constructors | `RoomEnvironment()` (no args), `RoundedBoxGeometry(w, h, d, segments = 2, radius = 0.1)`, `BufferGeometryUtils.mergeGeometries(geos, useGroups)`, `OrbitControls(camera, domElement)`. | Older tutorials: `RoomEnvironment(renderer)`, `mergeBufferGeometries`, `SMAAPass(w, h)`. |
| `OrbitControls` | `update(dt)` returns `true` while the camera moves; `'change'` event; `maxTargetRadius`, `maxPolarAngle`, `enableDamping`. | Don't call `listenToKeyEvents` (arrow keys are app keys). |
| `PerspectiveCamera.setViewOffset(fullW, fullH, x, y, w, h)` | Off-center projection for safe areas; `clearViewOffset()`. | CSS2D labels and raycasts follow it automatically. |
| `scene.environmentIntensity` | Global scale for `scene.environment`. | |
| Raycaster | Tests `object.layers` only, never `visible`. | Invisible pick meshes work; put them on their own layer. |
| Shader chunks | `#include <common>`, `<begin_vertex>`, `<project_vertex>`, `<map_fragment>`, `<color_fragment>` all present (`onBeforeCompile`, `customProgramCacheKey` exist). | |

---

## 3. Architecture

### 3.1 Files (proposed, no build step)

```
static/gamecast/
  core/            pure, no three.js import: node --test runs them
    field-spec.js  dimensions and layouts (numbers, ticks, pylons) per level
    coords.js      contract x / sides -> world
    row-spec.js    timeline row (data-contract B) -> PlaySpec
    paths.js       PlaySpec -> keyframed timeline, sampling, trail points
    ghosts.js      prediction -> ghost shapes and depth zones
    camera-fit.js  shot presets, frustum fitting
    alpha-bleed.js, easing.js
  three/           everything that touches WebGL or the DOM
    stage.js       renderer, effects, render-on-demand loop, resize, context loss, tiers
    turf.js        procedural grass and painted lines (shader)
    decals.js      numerals atlas, wordmarks, logo, down graphic
    structures.js  goalposts, pylons, benches, bowl, crowd, ribbon boards, light banks, sky, lights
    overlays.js    line of scrimmage, line to gain, spot ring, chain crew
    play-anim.js   ball, comet head, shadow, trail, effects, queue
    ghost-view.js  ghost lanes, arcs, zones, labels, picking, DOM linkage
    camera-rig.js  shots, cuts, follow, safe area, free orbit
  index.js         mount(container, opts) -> { setTimeline, setPrediction, cut, skip, dispose }
tests/js/*.test.mjs
```

### 3.2 Bootstrapping

```html
<script type="importmap">
{ "imports": {
  "three": "/static/vendor/three/build/three.module.min.js",
  "three/addons/": "/static/vendor/three/addons/"
} }
</script>
<script type="module">
  import { mount } from '/static/gamecast/index.js';
  import { webgl2Available, softwareRenderer } from '/static/gamecast/three/stage.js';
  const force = new URLSearchParams(location.search).has('gl');     // tests: ?gl=force
  if (webgl2Available() && (force || !softwareRenderer())) mount(document.getElementById('field3d'));
  // else: keep drawField() (the existing SVG strip) as the field
</script>
```

`three.module.min.js` imports `./three.core.min.js` relatively, so both files must stay side by side in `build/`.

### 3.3 Coordinates

```js
// core/coords.js
export const fieldX = (ayl) => ayl - 50;                         // contract x (0..100 + end zones) -> world x
export const aylFromYardline100 = (yl100, attacksRight) => (attacksRight ? 100 - yl100 : yl100);   // engine sit
export const aylFromEspnYardLine = (yardLine, callerIsHome) => (callerIsHome ? yardLine : 100 - yardLine);
export function aylFromSpotText(text, leftAbbr) {                // "TB 24" -> 76 when DAL owns the left goal
  const m = /\b([A-Z]{2,3})\s+(\d{1,2})\b/.exec(text || '');
  if (!m) return null;
  const yd = Number(m[2]);
  return yd === 50 ? 50 : m[1] === leftAbbr ? yd : 100 - yd;
}
/** "left"/"right" in play text are the OFFENSE's. Facing +x with y up, its right hand points to +z. */
export const sideZ = (side, dir) => (side === 'right' ? 1 : side === 'left' ? -1 : 0) * dir;
```

The ball's lateral spot is unknown: it is always drawn centered (`z = 0`), as the directions grammar requires.

### 3.4 Contract row to PlaySpec

The 3D layer never re-parses ESPN text: `espn_feed.classify` is validated against nflverse, and the contract rows
carry everything else (spots, side, gap, air, YAC, kicks, penalties). One pure adapter:

```js
// core/row-spec.js
const W = (x) => (x == null ? null : x - 50);
const GAPS = ['end', 'tackle', 'guard', 'middle'];
const runOf = (geo) => ({ side: geo.lat || 'middle', gap: GAPS.find((k) => (geo.gap || '').toLowerCase().includes(k)) || 'middle' });

export function specFromRow(row) {
  if (!row || row.kind === 'admin') return null;
  const g = row.geo || {}, c = row.call || {}, r = row.result || {}, k = row.kick || {};
  const pen = r.penalty;
  const base = {
    id: row.id, team: row.team, dir: g.dir, losX: W(g.x0), snapZ: 0,
    td: !!r.td, turnover: !!r.turnover, nullified: !!r.nullified, approx: g.approx || [],
    shotgun: c.align === 'S' ? true : c.align === 'U' ? false : null,
    flag: pen ? { text: pen.foul, yards: pen.yards, noPlay: !!pen.no_play, atX: W(pen.at_x) } : null,
    respotX: (r.nullified || row.kind === 'penalty') && g.x_next != null ? W(g.x_next) : null,   // enforcement walk
  };
  switch (row.kind) {
    case 'play': {
      if (c.outcome === 'sack') return { ...base, kind: 'sack', gain: r.yards ?? (g.x_end - g.x0) * g.dir };
      if (c.outcome === 'scramble') return { ...base, kind: 'scramble', gain: r.yards ?? 0, run: runOf(g) };
      if (c.family === 'run' || c.leaf === 'rpo_run') return { ...base, kind: 'run', gain: r.yards ?? 0, run: runOf(g) };
      const intercepted = r.turnover_kind === 'int';
      return { ...base, kind: 'pass', family: c.family, gain: r.yards ?? 0,
        pass: { side: g.lat, depth: c.depth, air: c.air, airBand: c.air_band, yac: c.yac,
          complete: c.outcome !== 'incomplete' && !intercepted, intercepted },
        intX: intercepted ? W(g.x_catch) : undefined, retEndX: intercepted ? W(g.x_end) : undefined };
    }
    case 'kneel': return { ...base, kind: 'kneel', gain: r.yards ?? 0 };
    case 'spike': return { ...base, kind: 'spike', gain: 0 };
    case 'penalty': case 'other': return { ...base, kind: 'penalty', gain: 0 };
    case 'punt': return { ...base, kind: 'punt', dir: k.kdir ?? g.dir,
      kick: { yards: k.dist, landX: W(k.land_x), retEndX: W(k.ret_end_x ?? null) } };
    case 'kickoff':   // row.team is the RECEIVING team; the ball travels along kick.kdir
      return { ...base, kind: 'kickoff', dir: k.kdir, losX: W(k.from_x ?? g.x0),
        kick: { fromX: W(k.from_x ?? g.x0), landX: W(k.land_x), retEndX: k.touchback ? null : W(k.ret_end_x ?? g.x_end) },
        respotX: k.touchback && g.x_next != null ? W(g.x_next) : base.respotX };
    case 'fg': case 'fg_miss': return { ...base, kind: 'fg', dir: k.kdir ?? g.dir,
      kick: { good: !!k.good, xKick: W(k.x_kick), postX: W(k.post_x), miss: k.good ? null : (k.miss || null) } };
    default: return null;
  }
}
```

Verified with the contract's own example rows (unit test in 11.1): the first DAL snap maps to `losX -20`, an
incompletion with `airBand [1, 10]`; the opening kickoff flies from world 15 to -47 and the return ends at -20; the
DAL FG kicks from world 19 (holder 8 yd back) at posts 60; the touchback kickoff walks the ball out to world 15.
`pred` fields follow retags (contract B7); geometry never does.

---

## 4. Field construction

### 4.1 Dimensions (NFL)

| Element | Value | World (yd) | Source |
| --- | --- | --- | --- |
| Field | 120 x 53.333 yd (360 x 160 ft) | x -60..60, z -26.667..26.667 | rule |
| Border | solid white, 6 ft, outside sidelines and end lines (out of bounds) | 2 yd | rule |
| Lines | 4 in wide; goal line 8 in | 0.111 / 0.222 | rule |
| Inbounds (hash) marks | 70 ft 9 in from each sideline to the inner edge, 2 ft x 4 in, every yard; 18 ft 6 in apart | inner edge at \|z\| 3.083 | rule |
| Sideline marks | 2 ft x 4 in every yard, inside each sideline | \|z\| 26.0..26.667 | rule |
| Numerals | 6 ft tall, bottom edge 12 yd from the sideline, tops face the nearer sideline; 4 ft wide (NCAA maximum, a convention for the NFL); the yard line runs between the digits | center \|z\| 15.667 | rule + convention |
| Direction arrows | triangle 36, 36, 18 in, beside the top of each numeral (not the 50), 18 in side starting 15 in below the top and 6 in from the goalward edge, pointing to the nearer goal | depth 0.968 | rule |
| PAT mark | 3 ft line at the center of the 2-yard line | x +-48, \|z\| < 0.5 | rule |
| Goalposts | in the plane of the end line; crossbar 18 ft 6 in long, top 10 ft up; uprights 35 ft above it; bright gold; orange ribbon 4 x 42 in on each top; single-standard post offset behind the end line | crossbar top 3.333, tops 15.0 | rule; the offset (2 yd here) is not in the text |
| Pylons | NFL text: the four goal line/sideline corners, inside edge of the lines; 4 x 4 x 18 in orange at all 8 corners is the NCAA/NFHS spec and standard practice | 0.111 x 0.5 | rule + practice |
| Restraining line | broken yellow, 8 in, 2 ft dashes, 1 ft gaps, 9 ft 4 in outside the border | \|z\| 31.78 | rule |
| Coaches' line | solid yellow 8 in, 6 ft behind the border (drawn between the 32s here) | \|z\| 30.667 | rule (extent assumed) |
| Benches | anywhere between the 30-yard lines | x -20..20 | rule |

Level presets keep the port to college cheap (PRODUCT "any team, any level"): NCAA hashes 60 ft (20 yd) in,
NFHS 53 ft 4 in.

### 4.2 `core/field-spec.js` (pure)

```js
export const FT = 1 / 3;
export const IN = 1 / 36;

const BASE = Object.freeze({
  goalX: 50, endLineX: 60, halfWidth: 80 * FT, border: 6 * FT,
  lineWidth: 4 * IN, goalLineWidth: 8 * IN, hashLength: 2 * FT,
  numberHeight: 6 * FT, digitWidth: 4 * FT, digitGap: 1.5 * FT,
  arrow: Object.freeze({ side: 36 * IN, base: 18 * IN, fromTop: 15 * IN, fromEdge: 6 * IN }),
  patMarkLength: 3 * FT, restrainingGap: (9 * 12 + 4) * IN, coachLineGap: 6 * FT,
  goalpost: Object.freeze({ crossbarHeight: 10 * FT, innerWidth: 18.5 * FT, aboveCrossbar: 35 * FT,
    ribbon: [4 * IN, 42 * IN], baseBehindEndLine: 2 }),
  pylon: Object.freeze({ size: 4 * IN, height: 18 * IN }),
});

export const LEVELS = Object.freeze({
  nfl: Object.freeze({ ...BASE, hashFromSideline: 70.75 * FT, numberBottomFromSideline: 12 }),
  ncaa: Object.freeze({ ...BASE, hashFromSideline: 60 * FT, numberBottomFromSideline: 11, goalLineWidth: 4 * IN }),
  hs: Object.freeze({ ...BASE, hashFromSideline: (53 * 12 + 4) * IN, numberBottomFromSideline: 11, goalLineWidth: 4 * IN }),
});

export const hashInnerZ = (L) => L.halfWidth - L.hashFromSideline;      // NFL 3.083

/** 18 numerals: x -40..40 every 10 yd, a near row (tops face +z) and a far row (tops face -z). */
export function numberLayout(L) {
  const rows = [];
  const zMid = L.halfWidth - L.numberBottomFromSideline + L.numberHeight / 2;
  const zTop = L.halfWidth - L.numberBottomFromSideline + L.numberHeight;
  const h = Math.sqrt(L.arrow.side ** 2 - (L.arrow.base / 2) ** 2);
  for (let x = -40; x <= 40; x += 10) {
    const label = 50 - Math.abs(x);
    const goalward = Math.sign(x);
    for (const side of [1, -1]) {
      // the far row reads upright from the camera (tens digit at smaller x); the near row is turned 180 degrees
      const off = L.digitGap / 2 + L.digitWidth / 2;
      const digits = [{ char: String(label / 10), x: x + side * off }, { char: '0', x: x - side * off }];
      const entry = { x, label, side, z: side * zMid, width: L.digitWidth, height: L.numberHeight, digits, arrow: null };
      if (goalward !== 0) {
        const baseX = x + goalward * (L.digitGap / 2 + L.digitWidth) + goalward * L.arrow.fromEdge;
        const zBase = side * (zTop - L.arrow.fromTop - L.arrow.base / 2);
        entry.arrow = { tip: [baseX + goalward * h, zBase], a: [baseX, zBase - L.arrow.base / 2], b: [baseX, zBase + L.arrow.base / 2] };
      }
      rows.push(entry);
    }
  }
  return rows;
}

export function tickLayout(L) {            // 1-yard marks (the 5-yard lines cross the whole field instead)
  const ticks = [], zIn = hashInnerZ(L);
  for (let x = -49; x <= 49; x += 1) {
    if (x % 5 === 0) continue;
    for (const s of [1, -1]) {
      ticks.push({ x, z0: s * zIn, z1: s * (zIn + L.hashLength), kind: 'hash' });
      ticks.push({ x, z0: s * (L.halfWidth - L.hashLength), z1: s * L.halfWidth, kind: 'sideline' });
    }
  }
  return ticks;
}

export function pylonLayout(L) {           // 8 corners: goal lines and end lines, both sidelines
  const p = [], o = L.pylon.size / 2;
  for (const sx of [1, -1]) for (const x of [L.goalX, L.endLineX]) for (const sz of [1, -1]) {
    p.push([sx * (x + (x === L.goalX ? o : -o)), sz * (L.halfWidth + o)]);
  }
  return p;
}
```

`tickLayout` is not drawn (the shader draws ticks); it exists for tests and for a geometry fallback.

### 4.3 Turf: grass, mow stripes and every painted line in one shader

Why a shader and not a texture: at the broadcast angle the far side is viewed at 70 to 80 degrees from the normal, so
a 4096 x 2048 field texture (34 texels per yard) either blurs (mipmaps) or shimmers (no mipmaps), and costs about
43 MB with mips. Per-pixel distance-to-line math with `fwidth` antialiasing is exact at every zoom and costs nothing.
The material stays `MeshStandardMaterial` (lights, shadows from the goalposts, fog, tone mapping all still work);
only `<map_fragment>` is replaced.

Mow stripes are view-dependent: blades in alternate 5-yard bands lean toward opposite sidelines, so the contrast
is strongest from the sideline camera, weaker from the end zone, and flips when the camera crosses the field.

```js
// three/turf.js
import * as THREE from 'three';
import { hashInnerZ } from '../core/field-spec.js';

const GLSL_HEADER = /* glsl */`
varying vec3 vWorldP;
uniform vec3 uGrassA, uGrassB, uPaint, uEndL, uEndR, uApron, uYellow;
uniform float uHalfW, uGoalX, uEndX, uBorder, uLineW, uGoalW, uHashZ, uHashLen, uRestrainZ, uCoachZ, uStripe;

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
// Line of half width h at distance d, pixel footprint fw: never thinner than a pixel; a sub-pixel line fades by its
// true coverage instead of flickering (after Golus).
float lineAA(float d, float h, float fw) {
  float drawH = max(h, fw * 0.5);
  float cov = 1.0 - smoothstep(drawH - fw * 0.5, drawH + fw * 0.5, d);
  return cov * clamp(h / drawH, 0.0, 1.0);
}
float spanAA(float x, float a, float b, float fw) { return clamp(min(x - a, b - x) / max(fw, 1e-4) + 0.5, 0.0, 1.0); }
float nearestDist(float x, float period) { return abs(x - period * floor(x / period + 0.5)); }

vec3 turfAlbedo(vec3 wp, vec3 V) {
  vec2 p = wp.xz;
  float ax = abs(p.x), az = abs(p.y);
  float fwx = max(fwidth(p.x), 1e-4), fwz = max(fwidth(p.y), 1e-4);

  float band = floor((p.x + 50.0) / 5.0);
  float lean = mod(band, 2.0) < 1.0 ? 1.0 : -1.0;
  float inPlay = spanAA(p.x, -uGoalX, uGoalX, fwx);
  float sheen = lean * (0.3 + 0.7 * V.z) * inPlay;                  // V.z > 0: camera on the near side
  float n = vnoise(p * 0.9) * 0.6 + vnoise(p * 0.21) * 0.4;
  float fine = (vnoise(p * 4.3) - 0.5) * (1.0 - smoothstep(0.04, 0.25, fwx));   // fades out before it aliases
  vec3 grass = mix(uGrassA, uGrassB, 0.5 + 0.5 * sheen * uStripe);
  grass *= 0.9 + 0.2 * n + 0.08 * fine;

  float ez = spanAA(ax, uGoalX, uEndX, fwx);                         // end zones in the defending team's color
  vec3 col = mix(grass, (p.x < 0.0 ? uEndL : uEndR) * (0.92 + 0.12 * n), ez);
  float inBounds = spanAA(az, -1.0, uHalfW + uBorder, fwz) * spanAA(ax, -1.0, uEndX + uBorder, fwx);
  col = mix(uApron * (0.85 + 0.25 * n), col, inBounds);

  float fieldZ = spanAA(az, -1.0, uHalfW, fwz), fieldX = spanAA(ax, -1.0, uGoalX + 0.01, fwx);
  float paint = lineAA(nearestDist(p.x, 5.0), uLineW * 0.5, fwx) * fieldZ * fieldX * step(ax, uGoalX - 1.0);   // yard lines
  paint = max(paint, spanAA(ax, uGoalX, uGoalX + uGoalW, fwx) * fieldZ);                                       // goal lines
  float tick = lineAA(nearestDist(p.x, 1.0), uLineW * 0.5, fwx) * (1.0 - step(nearestDist(p.x, 5.0), 0.5)) * step(ax, uGoalX - 0.5);
  paint = max(paint, tick * spanAA(az, uHashZ, uHashZ + uHashLen, fwz));                                       // inbounds marks
  paint = max(paint, tick * spanAA(az, uHalfW - uHashLen, uHalfW, fwz));                                       // sideline marks
  float cross = lineAA(abs(az - (uHashZ + uHashLen * 0.5)), uLineW * 0.5, fwz) * spanAA(nearestDist(p.x, 5.0), -1.0, uHashLen * 0.5, fwx);
  paint = max(paint, cross * step(ax, uGoalX - 1.0));                // the small cross on each 5-yard line
  paint = max(paint, lineAA(abs(ax - 48.0), uLineW * 0.5, fwx) * spanAA(abs(p.y), -1.0, 0.5, fwz));             // PAT mark
  paint = max(paint, max(spanAA(az, uHalfW, uHalfW + uBorder, fwz) * spanAA(ax, -1.0, uEndX + uBorder, fwx),
                         spanAA(ax, uEndX, uEndX + uBorder, fwx) * spanAA(az, -1.0, uHalfW + uBorder, fwz)));     // border
  col = mix(col, uPaint * (0.97 + 0.05 * n), paint);

  float dash = step(fract(p.x), 0.6667);                              // 2 ft dash, 1 ft gap
  float yel = lineAA(abs(az - uRestrainZ), 0.111, fwz) * spanAA(ax, -1.0, uEndX, fwx) * dash;
  yel = max(yel, lineAA(abs(az - uCoachZ), 0.111, fwz) * spanAA(ax, -1.0, 18.0, fwx));
  col = mix(col, uYellow, yel);
  return col * (1.0 + sheen * 0.04 * paint);                          // paint shows the mow pattern a little
}
`;

export function createTurf(L, colors) {
  const uniforms = {
    uGrassA: { value: new THREE.Color(colors.grassA) }, uGrassB: { value: new THREE.Color(colors.grassB) },
    uPaint: { value: new THREE.Color(colors.paint) }, uApron: { value: new THREE.Color(colors.apron) },
    uEndL: { value: new THREE.Color(colors.endLeft) }, uEndR: { value: new THREE.Color(colors.endRight) },
    uYellow: { value: new THREE.Color(colors.yellow) },
    uHalfW: { value: L.halfWidth }, uGoalX: { value: L.goalX }, uEndX: { value: L.endLineX },
    uBorder: { value: L.border }, uLineW: { value: L.lineWidth }, uGoalW: { value: L.goalLineWidth },
    uHashZ: { value: hashInnerZ(L) }, uHashLen: { value: L.hashLength },
    uRestrainZ: { value: L.halfWidth + L.border + L.restrainingGap },
    uCoachZ: { value: L.halfWidth + L.border + L.coachLineGap },
    uStripe: { value: colors.stripe ?? 0.85 },
  };
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);              // same objects: later .value changes are live
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldP;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_HEADER}`)
      .replace('#include <map_fragment>', 'diffuseColor.rgb = turfAlbedo(vWorldP, normalize(cameraPosition - vWorldP));');
  };
  material.customProgramCacheKey = () => 'turf-v1';
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(150, 84).rotateX(-Math.PI / 2), material);
  mesh.receiveShadow = true;
  return { mesh, uniforms, setEndZones(left, right) { uniforms.uEndL.value.set(left); uniforms.uEndR.value.set(right); } };
}
```

Night broadcast values used for every screenshot: `grassA 0x2b6a32`, `grassB 0x3d8a43`, `paint 0xf4f6f2`,
`apron 0x1f4a29`, `yellow 0xf2c230`, end zones = each defending team's ESPN `color`.

Texture budget for the whole field, by technique:

| Element | Technique | Resolution | Memory |
| --- | --- | --- | --- |
| Grass, stripes, all lines | shader math | per pixel | 0 |
| Numerals + arrows | one alphaMap atlas, mipmaps, max anisotropy | 2048 x 512 (cell 256 x 384 per 4 x 6 ft digit, about 64 texels per foot) | 5.6 MB with mips |
| Wordmarks | two alpha masks per end zone | 2048 x 384 | 4 x 4.2 MB |
| Midfield logo | color ImageData texture | 512 x 512 | 1.4 MB |
| Down graphic | canvas, redrawn on change | 1024 x 256 | 1.4 MB |

### 4.4 Numerals and arrows: one atlas, one merged mesh

White glyphs on an **opaque black** canvas, used as `alphaMap` (reads the green channel). A transparent canvas would
store black in its alpha-0 pixels and mipmaps would drag that black into the edges (dark fringe at distance).
Digits are stretched to fill the 4 x 6 ft block, which is how field numerals look. Arrows are real triangles that
sample a solid white atlas cell, so their edges get MSAA instead of texture blur.

```js
// three/decals.js (part)
export const FIELD_FONT = '"Barlow Condensed", "Arial Narrow", sans-serif';
const ATLAS_CELLS = 8, CELL_W = 256, CELL_H = 384, ATLAS_W = ATLAS_CELLS * CELL_W, ATLAS_H = 512, WHITE_CELL = 6;

export async function loadFieldFont() {        // canvas text drawn before the web font loads keeps the fallback forever
  await Promise.all([document.fonts.load(`700 200px ${FIELD_FONT}`), document.fonts.load(`600 200px ${FIELD_FONT}`)]);
}

export function tuneTexture(tex, renderer, { srgb = false } = {}) {
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();   // the far side is seen at 70-80 degrees
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function drawFittedGlyph(ctx, char, x, y, w, h, pad = 0.06) {
  ctx.save();
  ctx.font = `700 400px ${FIELD_FONT}`;
  const m = ctx.measureText(char);
  const gw = m.actualBoundingBoxLeft + m.actualBoundingBoxRight, gh = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  ctx.translate(x + w * pad, y + h * pad);
  ctx.scale((w * (1 - 2 * pad)) / gw, (h * (1 - 2 * pad)) / gh);
  ctx.fillText(char, m.actualBoundingBoxLeft, m.actualBoundingBoxAscent);
  ctx.restore();
}

export function numberAtlas(renderer) {
  const c = Object.assign(document.createElement('canvas'), { width: ATLAS_W, height: ATLAS_H });
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, ATLAS_W, ATLAS_H);
  ctx.fillStyle = '#fff';
  for (let d = 0; d <= 5; d++) drawFittedGlyph(ctx, String(d), d * CELL_W, 0, CELL_W, CELL_H);
  ctx.fillRect(WHITE_CELL * CELL_W + 16, 16, CELL_W - 32, CELL_H - 32);
  return tuneTexture(new THREE.CanvasTexture(c), renderer);
}

export function numberGeometryArrays(L) {      // pure-ish: testable arrays
  const pos = [], uv = [], idx = [];
  const vTop = 1, vBot = 1 - CELL_H / ATLAS_H;                // CanvasTexture flipY: canvas top row is v = 1
  for (const n of numberLayout(L)) {
    const zt = n.z + n.side * n.height / 2, zb = n.z - n.side * n.height / 2;
    for (const d of n.digits) {
      const u0 = Number(d.char) / ATLAS_CELLS, u1 = (Number(d.char) + 1) / ATLAS_CELLS;
      const xAt = (u) => d.x + (u - 0.5) * n.width * -n.side;   // u runs +x on the far row, -x on the near row
      const base = pos.length / 3;
      for (const [x, z] of [[xAt(0), zb], [xAt(1), zb], [xAt(1), zt], [xAt(0), zt]]) pos.push(x, 0, z);
      uv.push(u0, vBot, u1, vBot, u1, vTop, u0, vTop);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    if (n.arrow) {
      const base = pos.length / 3, w = (WHITE_CELL + 0.5) / ATLAS_CELLS, v = (vTop + vBot) / 2;
      for (const p of [n.arrow.a, n.arrow.b, n.arrow.tip]) { pos.push(p[0], 0, p[1]); uv.push(w, v); }
      idx.push(base, base + 1, base + 2);
    }
  }
  return { pos, uv, idx };
}

export function paintMaterial(color, alphaMap) {
  return new THREE.MeshStandardMaterial({
    color, alphaMap, transparent: true, depthWrite: false, roughness: 0.92, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,    // wins against the coplanar turf
  });
}

export function createNumbers(L, renderer, paint) {
  const { pos, uv, idx } = numberGeometryArrays(L);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  faceUp(g);                         // flip any triangle whose normal points down (quads of the near row are mirrored)
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, paintMaterial(paint, numberAtlas(renderer)));
  mesh.renderOrder = 1;
  mesh.receiveShadow = true;
  return mesh;
}

function faceUp(g) {
  const p = g.attributes.position, ix = g.index.array;
  for (let i = 0; i < ix.length; i += 3) {
    const a = ix[i], b = ix[i + 1], c = ix[i + 2];
    const ux = p.getX(b) - p.getX(a), uz = p.getZ(b) - p.getZ(a), vx = p.getX(c) - p.getX(a), vz = p.getZ(c) - p.getZ(a);
    if (uz * vx - ux * vz < 0) { ix[i + 1] = c; ix[i + 2] = b; }
  }
}
```

Paint is lit by the same lights and has the same roughness as the turf, so shader lines and decal numerals match.

### 4.5 End zones: team color plus wordmark

The fill is in the turf shader (`uEndL`, `uEndR`, each the color of the team that **defends** that end zone, so
the offense always drives toward the opponent's color). The wordmark is two alpha masks (outline, fill) so any two
colors work without fringes; letters' tops face the end line, reading from the field.

```js
/** A flat decal whose texture "up" points along `up` and whose text runs along `right` (unit vectors on the ground). */
export function groundDecal(width, height, center, right, up, material) {
  const g = new THREE.PlaneGeometry(width, height);
  const r = new THREE.Vector3(...right), u = new THREE.Vector3(...up), n = new THREE.Vector3().crossVectors(r, u);
  g.applyMatrix4(new THREE.Matrix4().makeBasis(r, u, n));      // local X -> right, Y -> up, Z -> +y
  const mesh = new THREE.Mesh(g, material);
  mesh.position.set(center[0], 0, center[2]);
  return mesh;
}

export function wordmarkMasks(text, renderer, { w = 2048, h = 384, stroke = 26, tracking = 0.08 } = {}) {
  const make = (mode) => {
    const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    ctx.font = `700 ${Math.round(h * 0.78)}px ${FIELD_FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.letterSpacing = `${Math.round(h * tracking)}px`;
    const fit = Math.min(1, (w * 0.9) / ctx.measureText(text).width);
    ctx.translate(w / 2, h / 2 + h * 0.04); ctx.scale(fit, 1);
    if (mode === 'outline') { ctx.lineJoin = 'round'; ctx.lineWidth = stroke; ctx.strokeStyle = '#fff'; ctx.strokeText(text, 0, 0); }
    ctx.fillStyle = '#fff'; ctx.fillText(text, 0, 0);
    return tuneTexture(new THREE.CanvasTexture(c), renderer);
  };
  return { outline: make('outline'), fill: make('fill') };
}

export function createWordmark(L, renderer, text, side, colors) {      // side -1 = left end zone
  const { outline, fill } = wordmarkMasks(text.toUpperCase(), renderer);
  const depth = L.endLineX - L.goalX, center = [side * (L.goalX + depth / 2), 0, 0];
  const right = side < 0 ? [0, 0, -1] : [0, 0, 1], up = [side, 0, 0];
  const group = new THREE.Group();
  const o = groundDecal(L.halfWidth * 2 * 0.92, depth * 0.78, center, right, up, paintMaterial(colors.outline, outline));
  const f = groundDecal(L.halfWidth * 2 * 0.92, depth * 0.78, center, right, up, paintMaterial(colors.fill, fill));
  o.renderOrder = 1; f.renderOrder = 2;
  group.add(o, f);
  return group;
}
// usage: createWordmark(L, renderer, teams.DAL.name, -1, { fill: 0xffffff, outline: teams.DAL.alt_color })
```

### 4.6 Midfield logo

Full-color PNGs need real alpha, and a 2D canvas cannot keep color in alpha-0 pixels (it stores premultiplied).
So: draw, `getImageData`, bleed edge colors outward (alpha stays 0), and upload the **ImageData** itself, which
WebGL takes unpremultiplied. Home team's logo at midfield, as in the NFL.

```js
// core/alpha-bleed.js (pure)
export function bleedAlpha(data, width, height, passes = 6) {
  const next = new Uint8ClampedArray(data), filled = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) filled[i] = data[i * 4 + 3] > 0 ? 1 : 0;
  for (let pass = 0; pass < passes; pass++) {
    const newly = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (filled[i]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= width || yy >= height || !filled[yy * width + xx]) continue;
        const j = (yy * width + xx) * 4; r += next[j]; g += next[j + 1]; b += next[j + 2]; n++;
      }
      if (n) { next[i * 4] = r / n; next[i * 4 + 1] = g / n; next[i * 4 + 2] = b / n; newly.push(i); }
    }
    if (!newly.length) break;
    for (const i of newly) filled[i] = 1;
  }
  data.set(next);
  return data;
}

// three/decals.js (part)
export async function loadLogoTexture(url, renderer, size = 512) {   // url: '/api/logo/DAL' (contract C2)
  const img = new Image();
  img.crossOrigin = 'anonymous';             // before src, or the canvas is tainted and getImageData throws
  img.src = url;
  await img.decode();
  const c = Object.assign(document.createElement('canvas'), { width: size, height: size });
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size);
  bleedAlpha(data.data, size, size, 8);
  return tuneTexture(new THREE.Texture(data), renderer, { srgb: true });   // not DataTexture: no mips, Nearest, flipY false
}

export function createLogoDecal(texture, size = 10) {
  const mat = new THREE.MeshStandardMaterial({ map: texture, transparent: true, depthWrite: false, roughness: 0.9,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  const mesh = groundDecal(size, size, [0, 0, 0], [1, 0, 0], [0, 0, -1], mat);   // upright from the camera side
  mesh.renderOrder = 1;
  return mesh;
}
```

On 404 from the proxy (offline cache miss), skip the decal; the field reads fine without it.

### 4.7 Goalposts, pylons, benches

```js
// three/structures.js (part)
export function createGoalpost(L, side, padColor) {
  const gp = L.goalpost, g = new THREE.Group(), r = 0.07;                  // about 5 in uprights
  const mat = new THREE.MeshStandardMaterial({ color: 0xffc425, roughness: 0.38, metalness: 0.25 });
  const xLine = side * L.endLineX, xBase = side * (L.endLineX + gp.baseBehindEndLine), barY = gp.crossbarHeight - r;
  const neck = new THREE.CatmullRomCurve3([                                  // single-standard gooseneck
    new THREE.Vector3(xBase, 0, 0), new THREE.Vector3(xBase, barY - 0.9, 0),
    new THREE.Vector3(xBase - side * 0.35, barY - 0.15, 0), new THREE.Vector3(xLine, barY, 0)]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(neck, 40, 0.12, 12), mat));
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 2, 20), new THREE.MeshStandardMaterial({ color: padColor, roughness: 0.8 }));
  pad.position.set(xBase, 1, 0);
  const half = gp.innerWidth / 2 + r;                                        // 18 ft 6 in between inner faces
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 2 * half, 12).rotateX(Math.PI / 2), mat);
  bar.position.set(xLine, barY, 0);
  const upGeo = new THREE.CylinderGeometry(r, r, gp.aboveCrossbar, 12).translate(0, gp.aboveCrossbar / 2, 0);
  const ribbonMat = new THREE.MeshStandardMaterial({ color: 0xff6a13, roughness: 0.7, side: THREE.DoubleSide });
  for (const s of [-1, 1]) {
    const up = new THREE.Mesh(upGeo, mat);
    up.position.set(xLine, barY, s * half);
    const rib = new THREE.Mesh(new THREE.PlaneGeometry(gp.ribbon[0] * 2.5, gp.ribbon[1]).translate(0, -gp.ribbon[1] / 2, 0), ribbonMat);
    rib.position.set(xLine, barY + gp.aboveCrossbar, s * half);              // sway it only while the loop runs
    g.add(up, rib);
  }
  g.add(pad, bar);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export function createPylons(L) {
  const p = L.pylon;
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(p.size, p.height, p.size).translate(0, p.height / 2, 0),
    new THREE.MeshStandardMaterial({ color: 0xff5e14, roughness: 0.6, emissive: 0x3a1000 }), 8);
  const m = new THREE.Matrix4();
  pylonLayout(L).forEach(([x, z], i) => mesh.setMatrixAt(i, m.makeTranslation(x, 0, z)));
  return mesh;
}

export function createBenches(L, { perSide = 6, length = 5.5 } = {}) {      // neutral: the feed doesn't say whose sideline
  const geo = new RoundedBoxGeometry(length, 0.55, 0.7, 2, 0.12).translate(0, 0.28, 0);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x2a3340, roughness: 0.7 }), perSide * 2);
  const m = new THREE.Matrix4();
  let i = 0;
  for (const side of [1, -1]) for (let k = 0; k < perSide; k++) {
    mesh.setMatrixAt(i++, m.makeTranslation(-17 + k * (34 / (perSide - 1)), 0, side * (L.halfWidth + L.border + L.coachLineGap + 4.5)));
  }
  return mesh;
}
```

Goalpost shadows: one directional key light with a 2048 map over the field, `shadowMap.autoUpdate = false`, and
`renderer.shadowMap.needsUpdate = true` once after building static casters (and after context restore).

### 4.8 Stadium surround (atmosphere without assets)

| Piece | Recipe | Cost |
| --- | --- | --- |
| Bowl | superellipse rings (exponent 5 = rounded rectangle, a 84, b 50 yd), 30 rows rising 0.7 yd and stepping out 1.05 yd; one BufferGeometry with vertex colors alternating by row | 1 draw call |
| Crowd | 24,000 `Points` on the rows, `PointsMaterial({ size: 0.55, vertexColors: true, sizeAttenuation: true })`, tints from both teams at 25-60% brightness, seeded RNG so screenshots are stable | 1 draw call |
| LED ribbon boards | a 4096 x 64 canvas of alternating team panels (`color` fill, nickname in white), mapped along the bowl's front edge at y 0.3 to 1.45; `MeshBasicMaterial({ map, color: 1.1 })`, **FrontSide** (from behind they'd read mirrored) | 1 |
| Light banks | four masts at the corners (x +-90, z +-60, 34 yd high), emissive panels at `Color(1, 0.97, 0.9) * 9` so only they bloom | 8 |
| Sky | inverted sphere, ShaderMaterial gradient `#16233a` at the horizon to `#03060c` overhead, `depthWrite: false` | 1 |
| Haze | `scene.fog = new THREE.Fog(0x0a1220, 160, 520)` (Direction 5 wants `FogExp2`) | 0 |

```js
export function createCrowd({ a = 84, b = 50, rows = 30, rowRise = 0.7, rowDepth = 1.05, count = 24000,
  tints = [0x8a96a8, 0x2f3a4a, 0xd8dee8, 0x3b5b8f, 0x9b2335] } = {}) {
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), tmp = new THREE.Color();
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < count; i++) {
    const t = rnd() * Math.PI * 2, r = Math.floor(rnd() * rows), cs = Math.cos(t), sn = Math.sin(t);
    const ex = Math.sign(cs) * Math.abs(cs) ** 0.4, ez = Math.sign(sn) * Math.abs(sn) ** 0.4;     // superellipse n = 5
    const grow = r * rowDepth + rowDepth * 0.5;
    pos.set([ex * (a + grow), 1.6 + r * rowRise + 0.45, ez * (b + grow)], i * 3);
    tmp.set(tints[Math.floor(rnd() * tints.length)]).multiplyScalar(0.25 + 0.35 * rnd());
    col.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ size: 0.55, vertexColors: true, sizeAttenuation: true }));
}

export function createLights(scene, renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;   // reflections on posts and ball
  scene.environmentIntensity = 0.12;              // keeps white paint below the bloom threshold
  pmrem.dispose();
  const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x1d3a22, 0.6);
  const key = new THREE.DirectionalLight(0xfff4e6, 1.9);
  key.position.set(-30, 80, 45);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 3;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  Object.assign(key.shadow.camera, { left: -75, right: 75, top: 45, bottom: -45, near: 10, far: 220 });
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.5);
  fill.position.set(40, 60, -50);
  scene.add(hemi, key, fill);
}
```

Exposure rule that makes selective bloom work: white paint must land near 0.85 linear. With three's physical
lights, Lambert radiance is `albedo * I * cos / PI`; key 1.9 + hemi 0.6 + fill 0.5 + environment 0.12 gives about
0.85. The first prototype pass used key 2.3, hemi 0.9, env 0.35, and every white line bloomed into a haze.

Portrait phones put the near stands right under the camera, where 0.55-yd crowd points become big squares: hide
the crowd (or cap point size) when `aspect < 1`.

### 4.9 Knobs per visual direction (`directions.md`)

The engine is the same for all five; a direction is a theme object.

| Knob | Booth Sheet | Cut-Up | Network Package | Install Room | Under the Lights |
| --- | --- | --- | --- | --- | --- |
| Tone mapping | Neutral | Neutral, no bloom | ACES, exposure lifted (its call; it shifts team hues) | Neutral | Neutral |
| Lights | 4 spot banks, soft shadows (PCF + radius) | hemi + high key, shadows off | 2 rigs, goalpost shadows | RoomEnvironment + key at 40 deg, PCF + radius (not PCFSoftShadowMap) | 4 spots, haze `FogExp2` |
| Bloom | fixtures only (threshold above 1) | off | off ("no glow") | off | fixtures + ball tracer |
| Post | none | projector `ShaderPass` (corner falloff, white lift) | none | SMAA if desired (EffectComposer path, 10.2) | LED pixel-grid shader on boards |
| Ghost zone style | grease-pencil fill/strokes | chalk (white dashed) | screen-space hatch (8.3) | marker strokes | low-res pixel projection (quantize world xz) |
| Trail | Line2 6 px, fade 0.6 s | Line2 4 px | comet, fade 0.5 s + landing ring | tube 0.3 yd, `castShadow` (shadow map updates each animated frame) | tracer + short sparks |
| Camera presets | booth: 28 m up, 45 m back, HFOV 34 | SL + EZ inset (two viewports, verified in 10.2) | broadcast HFOV 28 + SkyCam 12 m behind the QB, 700 ms moves | table view 50 deg elevation, limited orbit | wide HFOV 34, tight, blimp |

Directions quote horizontal FOV; `PerspectiveCamera.fov` is vertical: `vfov = 2 * atan(tan(hfov / 2) / aspect)`.

---

## 5. Broadcast overlays painted on the turf

### 5.1 Line of scrimmage and line to gain

Each line is a crisp core strip (about 1 ft wide, color pushed just over 1.0 so it gets a faint bloom) plus a soft
halo strip (gaussian alpha mask, additive). Coplanar with the turf, separated by `polygonOffset` only, so the ball
and the goalposts occlude them like the real 1st-and-10 line. Hide the line to gain on goal to go.

```js
// three/overlays.js
export const OVERLAY_COLORS = { los: 0x2f7bff, ltg: 0xffd21f };

function haloMask() {                       // 1D gaussian in RGB (alphaMap reads green): fringe-free on any color
  const c = Object.assign(document.createElement('canvas'), { width: 128, height: 4 });
  const ctx = c.getContext('2d'), img = ctx.createImageData(128, 4);
  for (let x = 0; x < 128; x++) {
    const d = (x - 63.5) / 63.5, v = Math.round(255 * Math.exp(-d * d * 5));
    for (let y = 0; y < 4; y++) { const i = (y * 128 + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  }
  ctx.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}

function strip(width, length, color, hdr, order, alphaMap = null, opacity = 1, blending = THREE.NormalBlending) {
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(hdr), alphaMap, transparent: true, opacity, blending,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, length).rotateX(-Math.PI / 2), mat);   // thin along x
  mesh.renderOrder = order;
  return mesh;
}

export function createOverlays(L) {
  const len = L.halfWidth * 2, mask = haloMask();
  const make = (color) => {
    const g = new THREE.Group();
    const core = strip(0.4, len, color, 1.25, 5, null, 0.95);
    const halo = strip(2.6, len, color, 1.0, 4, mask, 0.38, THREE.AdditiveBlending);
    g.add(halo, core);
    g.userData = { core, halo };
    return g;
  };
  const los = make(OVERLAY_COLORS.los), ltg = make(OVERLAY_COLORS.ltg);
  const spot = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.72, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(1.6), transparent: true, opacity: 0.9,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -8 }));
  spot.renderOrder = 6;
  const group = new THREE.Group();
  group.add(los, ltg, spot);
  return {
    group,
    set({ losX, ltgX, ballZ = 0 }) {          // ltgX null on goal to go: the goal line is the line to gain
      los.position.x = losX;
      ltg.visible = ltgX != null;
      if (ltgX != null) ltg.position.x = ltgX;
      spot.position.set(losX, 0, ballZ);
    },
  };
}
```

From the engine: `losX = fieldX(aylFromYardline100(sit.yardline_100, true))`, `ltgX = togo >= yardline_100 ? null :
losX + dir * togo`. Animate the move between snaps with the same damping as the camera (both lines slide together).

### 5.2 Layering on a plane (no y offsets)

Everything that lies on the grass is a separate coplanar mesh. Order is decided by `renderOrder` among transparents
and `polygonOffset` against the opaque turf. `depthWrite: false` on all of them so they never cut each other.

| Layer | renderOrder | polygonOffset (factor, units) | Blending |
| --- | --- | --- | --- |
| Turf (opaque) | 0 | none | normal |
| Numerals, wordmarks, logo | 1 to 2 | -1, -2 | normal |
| Ghost depth zones | 2 | -1, -3 | additive (glow) or normal (hatch) |
| Down graphic | 3 | -2, -4 | normal |
| LOS / LTG halo, core | 4, 5 | -2, -6 | additive, normal |
| Spot ring, drive trail | 6 | -3, -8 | normal |
| Ball shadow, carrier ring | 7 | -3, -10 | normal |
| Play trail, bursts | 8, 9 | n/a (in the air) | additive |
| Ghost lanes, arrowheads | 10, 11 | n/a | normal |
| Ball glow sprite | 12 | n/a | additive |

`polygonOffsetFactor` scales with the depth slope, which is exactly what grows at grazing broadcast angles; a
constant y lift (0.01 yd) does not, and flickers at 80 yards. Near plane 0.5 and far 900 keep depth precision fine.

### 5.3 Down-and-distance graphic and the chain crew

```js
export function createDownGraphic(renderer) {   // "2ND & 7" lying on the turf behind the ball, like the TV graphic
  const c = Object.assign(document.createElement('canvas'), { width: 1024, height: 256 });
  const ctx = c.getContext('2d');
  const tex = tuneTexture(new THREE.CanvasTexture(c), renderer, { srgb: true });
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.92,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const mesh = groundDecal(11, 2.75, [0, 0, 0], [1, 0, 0], [0, 0, -1], mat);
  mesh.renderOrder = 3;
  let last = '';
  return { mesh, set(text, accent) {
    if (text === last) return;                    // redraw only on change
    last = text;
    ctx.clearRect(0, 0, 1024, 256);
    ctx.fillStyle = 'rgba(8,14,24,0.78)'; ctx.beginPath(); ctx.roundRect(8, 40, 1008, 176, 22); ctx.fill();
    ctx.fillStyle = accent; ctx.fillRect(8, 40, 22, 176);
    ctx.fillStyle = '#fff'; ctx.font = `700 150px ${FIELD_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text.toUpperCase(), 530, 134);
    tex.needsUpdate = true;
  } };
}
// place: mesh.position.set(losX - dir * 7.5, 0, -9.5)  (between the far hash and the far numerals, behind the ball)
```

The graphic is oriented for the sideline camera only; in the end-zone shot rotate it 90 degrees or hide it.

The chain crew (orange 8-ft rods at the series start and the line to gain, the chain on the ground, the down box
with its number at the line of scrimmage) sits on the far sideline at `z = -(halfWidth + border + 0.8)`:

```js
export function createChainCrew(L, { color = 0xff6a13 } = {}) {
  const rodMat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, emissive: 0x2a0d00 });
  const rodGeo = new THREE.CylinderGeometry(0.05, 0.05, 2.67, 8).translate(0, 1.335, 0);
  const capGeo = new THREE.BoxGeometry(0.12, 0.5, 0.5).translate(0, 2.9, 0);
  const rod = () => { const g = new THREE.Group(); g.add(new THREE.Mesh(rodGeo, rodMat), new THREE.Mesh(capGeo, rodMat)); return g; };
  const start = rod(), end = rod(), box = rod();
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 6).rotateZ(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xd9dde3, metalness: 0.6, roughness: 0.4 }));
  chain.position.y = 0.06;
  const c = Object.assign(document.createElement('canvas'), { width: 128, height: 128 }), ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const digit = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
  digit.scale.setScalar(1.1); digit.position.y = 3.7;
  box.add(digit);
  const group = new THREE.Group();
  group.add(start, end, chain, box);
  group.position.z = -(L.halfWidth + L.border + 0.8);
  return { group, set({ losX, ltgX, down, goalToGo }) {
    start.visible = end.visible = chain.visible = !goalToGo && ltgX != null;
    if (start.visible) {
      const s = ltgX - Math.sign(ltgX - losX || 1) * 10;
      start.position.x = s; end.position.x = ltgX; chain.position.x = (s + ltgX) / 2; chain.scale.x = Math.abs(ltgX - s);
    }
    box.position.x = losX;
    ctx.clearRect(0, 0, 128, 128); ctx.fillStyle = '#ff6a13'; ctx.fillRect(8, 8, 112, 112);
    ctx.fillStyle = '#111'; ctx.font = `700 104px ${FIELD_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(down), 64, 70);
    tex.needsUpdate = true;
  } };
}
```

### 5.4 Ball spot

Before the snap the ball sits on the line, centered, with a white ring (above). The legend line from the
directions grammar goes in the DOM: "Ball shown mid-field; ESPN gives no hash".

---

## 6. Cameras

### 6.1 Shots

| Shot | Pitch | Vertical FOV | Frames (x) | Frames (z) | Distance | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `broadcast` (default) | 23 deg | 22 deg | LOS - 12 to LOS + 24 | both sidelines | fitted, 70 to 88 | pans up to 16 deg toward the ball like the fixed midfield camera |
| `all22` | 50 deg | 28 deg | LOS - 14 to LOS + 30 | both sidelines | fitted, 60 to 130 | high and wide |
| `endzone` | 17 deg | 40 deg | LOS - 8 to LOS + 22 | the numbers (+-15) | fitted, 26 to 70 | behind the offense; yaw = 90 deg * dir |
| `free` | user | user | | | 12 to 220 | OrbitControls, damped, polar max 84 deg |

During a play the frame follows the ball (`ctx.follow`): ball +-16 yd, plus the line while it's within 28 yd.
Before the snap it also holds every visible ghost (endpoints and labels). Past `maxDist` the camera would leave
the press box, so the lens widens instead (1 degree steps, up to 60).

### 6.2 Framing math (`core/camera-fit.js`, pure)

For a camera looking along unit `f` at `target`, a point at `v = p - target` has camera coordinates
`ax = v.right`, `ay = v.up`, depth `af + d`. It is inside the frame when `|ax| <= (d + af) tanH (1 - 2m)` and
the same for y, so the smallest distance is the max over points of `|ax| / (kx tanH) - af` and
`|ay| / (ky tanV) - af`. Margins can differ per side (title-safe, DOM panels).

```js
const DEG = Math.PI / 180;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export function forwardFrom(yawDeg, pitchDeg) {   // yaw 0 looks toward -z, 90 toward +x; pitch looks down
  const y = yawDeg * DEG, p = pitchDeg * DEG;
  return norm([Math.sin(y) * Math.cos(p), -Math.sin(p), -Math.cos(y) * Math.cos(p)]);
}
export function basis(forward, up = [0, 1, 0]) {
  const f = norm(forward), right = norm(cross(f, up));
  return { f, right, up: cross(right, f) };
}
export function fitDistance(points, target, forward, { vFovDeg, aspect, margins = {}, near = 1 }) {
  const { f, right, up } = basis(forward);
  const tanV = Math.tan((vFovDeg * DEG) / 2), tanH = tanV * aspect;
  const m = { left: 0.04, right: 0.04, top: 0.06, bottom: 0.06, ...margins };
  let d = near;
  for (const p of points) {
    const v = sub(p, target), ax = dot(v, right), ay = dot(v, up), af = dot(v, f);
    const kx = (ax >= 0 ? 1 - 2 * m.right : 1 - 2 * m.left) * tanH;
    const ky = (ay >= 0 ? 1 - 2 * m.top : 1 - 2 * m.bottom) * tanV;
    d = Math.max(d, Math.abs(ax) / kx - af, Math.abs(ay) / ky - af, near - af);
  }
  return d;
}
export function projectNdc(p, pos, forward, { vFovDeg, aspect }) {   // tests and label culling
  const { f, right, up } = basis(forward), v = sub(p, pos), z = dot(v, f), tanV = Math.tan((vFovDeg * DEG) / 2);
  return [dot(v, right) / (z * tanV * aspect), dot(v, up) / (z * tanV), z];
}

export const SHOTS = {
  broadcast: { vFov: 22, pitch: 23, back: 12, ahead: 24, width: 'field', pan: 0.32, maxPan: 16, minDist: 70, maxDist: 88 },
  all22: { vFov: 28, pitch: 50, back: 14, ahead: 30, width: 'field', pan: 0, maxPan: 0, minDist: 60, maxDist: 130 },
  endzone: { vFov: 40, pitch: 17, back: 8, ahead: 22, width: 'numbers', pan: 0, maxPan: 0, minDist: 26, maxDist: 70, behind: true },
};

export function shotFramePoints(name, ctx) {
  const s = SHOTS[name], hw = (ctx.halfWidth ?? 80 / 3) + 1;
  const zs = s.width === 'field' ? [-hw - 1, hw] : [-15, 15];
  let xs = [ctx.losX - ctx.dir * s.back, ctx.losX + ctx.dir * s.ahead];
  if (ctx.follow) {
    const fx = ctx.follow[0];
    xs = [fx - 16, fx + 16];
    if (Math.abs(fx - ctx.losX) < 28) xs.push(ctx.losX - ctx.dir * 6);
    return [...xs.flatMap((x) => zs.map((z) => [x, 0, z])), [fx, ctx.follow[1], ctx.follow[2]]];
  }
  return [...xs.flatMap((x) => zs.map((z) => [x, 0, z])), ...(ctx.points || [])];
}

export function shotPose(name, ctx) {
  const s = SHOTS[name], pts = shotFramePoints(name, ctx);
  const xMin = Math.min(...pts.map((p) => p[0])), xMax = Math.max(...pts.map((p) => p[0]));
  const target = [(xMin + xMax) / 2, 0, s.behind ? ctx.ballZ * 0.5 : 0];
  const yaw = s.behind ? 90 * ctx.dir : Math.max(-s.maxPan, Math.min(s.maxPan, target[0] * s.pan));
  const forward = forwardFrom(yaw, s.pitch);
  let fov = s.vFov;
  let dist = Math.max(s.minDist, fitDistance(pts, target, forward, { vFovDeg: fov, aspect: ctx.aspect, margins: ctx.margins }));
  while (dist > s.maxDist && fov < 60) {
    fov += 1;
    dist = Math.max(s.minDist, fitDistance(pts, target, forward, { vFovDeg: fov, aspect: ctx.aspect, margins: ctx.margins }));
  }
  return { position: target.map((t, i) => t - forward[i] * dist), target, fov, dist };
}
```

Unit-tested: for all three shots at 16:9, 16:10 and 4:3, every framing point projects inside NDC.

### 6.3 Rig: eased cuts, damped follow, safe area, free orbit

Position and target are interpolated separately and the camera `lookAt`s every frame (no quaternion slerp, no
roll). Cuts are a 1.1 s ease-in-out toward the **live** desired pose, so a cut that starts while the line moves
still lands on the right framing. Between cuts the pose is damped toward the shot (lambda 3.2, frame-rate
independent). The rig reports "busy" while it moves, which keeps the render loop alive and then lets it stop.

```js
// three/camera-rig.js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { shotPose } from '../core/camera-fit.js';
import { easeInOutCubic } from '../core/easing.js';

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);

export function createCameraRig(stage, { margins } = {}) {
  const { camera, renderer } = stage;
  const controls = new OrbitControls(camera, renderer.domElement);
  Object.assign(controls, { enabled: false, enableDamping: true, dampingFactor: 0.08, screenSpacePanning: false,
    minDistance: 12, maxDistance: 220, maxPolarAngle: THREE.MathUtils.degToRad(84), maxTargetRadius: 80 });
  controls.addEventListener('change', () => stage.invalidate());

  const pose = { pos: new THREE.Vector3(0, 40, 90), target: new THREE.Vector3(), fov: 24 };
  let shot = 'broadcast', ctx = { losX: 0, dir: 1, ballZ: 0, points: [] }, tween = null, safeRight = 0;

  // Safe area: a DOM panel covers `right` px. Render a wider virtual frame and show its left part, so the optical
  // center sits in the middle of the free area; CSS2D labels and raycasts follow the view offset automatically.
  function applySafeArea() {
    const W = renderer.domElement.clientWidth, H = renderer.domElement.clientHeight;
    if (!safeRight) { camera.clearViewOffset(); camera.aspect = W / H; camera.updateProjectionMatrix(); return; }
    camera.aspect = (W + safeRight) / H;
    camera.setViewOffset(W + safeRight, H, safeRight, 0, W, H);
    camera.updateProjectionMatrix();
  }
  stage.onResize(() => applySafeArea());          // stage.resize() resets aspect; re-apply after it
  function fitMargins() {
    if (!safeRight) return margins;
    const W = renderer.domElement.clientWidth, side = (1 - (W - safeRight) / (W + safeRight)) / 2;
    return { ...margins, left: side + 0.03, right: side + 0.03 };
  }
  function computeDesired() {
    if (shot === 'free') return null;
    const p = shotPose(shot, { ...ctx, aspect: camera.aspect, margins: fitMargins() });
    return { pos: V(p.position), target: V(p.target), fov: p.fov };
  }
  function apply() {
    camera.position.copy(pose.pos);
    camera.lookAt(pose.target);
    if (camera.fov !== pose.fov) { camera.fov = pose.fov; camera.updateProjectionMatrix(); }
  }
  function update(dt) {
    if (shot === 'free') return controls.update(dt);          // true while damping
    const desired = computeDesired();
    if (tween) {
      tween.t += dt;
      const u = easeInOutCubic(Math.min(1, tween.t / tween.dur));
      pose.pos.lerpVectors(tween.from.pos, desired.pos, u);
      pose.target.lerpVectors(tween.from.target, desired.target, u);
      pose.fov = THREE.MathUtils.lerp(tween.from.fov, desired.fov, u);
      if (u >= 1) tween = null;
      apply();
      return true;
    }
    const k = 1 - Math.exp(-3.2 * dt);
    const moving = pose.pos.distanceToSquared(desired.pos) > 1e-4 || pose.target.distanceToSquared(desired.target) > 1e-4;
    pose.pos.lerp(desired.pos, k);
    pose.target.lerp(desired.target, k);
    pose.fov = THREE.MathUtils.damp(pose.fov, desired.fov, 3.2, dt);
    apply();
    return moving;
  }
  stage.addUpdater(update);

  return {
    controls,
    get shot() { return shot; },
    setSafeArea({ right = 0 } = {}) { safeRight = right; applySafeArea(); stage.invalidate(); },
    setContext(next) { ctx = { ...ctx, ...next }; stage.invalidate(); },
    cut(name, { duration = 1.1, instant = false } = {}) {
      const leavingFree = shot === 'free';
      shot = name;
      controls.enabled = name === 'free';
      if (name === 'free') { controls.target.copy(pose.target); stage.invalidate(); return; }
      const from = leavingFree ? { pos: camera.position.clone(), target: controls.target.clone(), fov: camera.fov }
        : { pos: pose.pos.clone(), target: pose.target.clone(), fov: pose.fov };
      if (instant) { const d = computeDesired(); pose.pos.copy(d.pos); pose.target.copy(d.target); pose.fov = d.fov; apply(); tween = null; }
      else tween = { from, t: 0, dur: duration };
      stage.invalidate();
    },
    snap() { const d = computeDesired(); if (d) { pose.pos.copy(d.pos); pose.target.copy(d.target); pose.fov = d.fov; apply(); } },
  };
}
```

Wiring the follow: while a play animates, `rig.setContext({ follow: ball.position.toArray() })` every frame; on
the animator's `end` event, `rig.setContext({ follow: null })` and the damping glides back to the pre-snap frame.

### 6.4 Laptop, TV, phone

- Fitting is aspect-driven, so 16:10 laptops and 16:9 TVs get the same content framed, not cropped.
- TV (1920x1080 at DPR 1, or 4K at DPR 2): bigger title-safe margins (`top/bottom 0.08`, `left/right 0.06`) and
  CSS label size `clamp(14px, 1.1vw, 24px)`; the pixel cap in 10.4 keeps 4K at 8.3 MP.
- A side panel (the prediction rail) over the canvas: `rig.setSafeArea({ right: panelWidthPx })`. Verified: the
  line, ghosts and labels center in the free 77% instead of hiding under the panel.
- Portrait (`aspect < 1`): the broadcast shot must fit 53 yards of width into a narrow frame and ends up far away
  with the stands under the camera (measured at 390x844). Default to `endzone` there, frame `z` to the hashes
  (+-8) instead of the numbers, and hide the crowd points.

### 6.5 Keys and motion preferences

- `V` cycles broadcast, end zone, all-22, free (directions.md reserves V). Guard it with the existing "not inside an
  input" check. Never call `controls.listenToKeyEvents()`: arrows are the Watch step keys.
- `prefers-reduced-motion: reduce`: cuts are instant (`cut(name, { instant: true })`), follow damping off (snap),
  plays show their end state and full trail at once, no bursts. Check with
  `matchMedia('(prefers-reduced-motion: reduce)')` and listen for changes.

---

## 7. Play animation

### 7.1 Model

A play is a list of **segments** on one track (the ball): `line` (eased), `arc` (parabola over the chord, constant
horizontal speed), `hold`. Each segment carries `approx` when its shape is an estimate. Plus **events** (snap,
handoff, release, catch, tackle, incomplete, int, sack, td, kick, land, good, nogood, flag, spot) that fire effects.
Everything is pure data, so the same timeline drives the animation, the trail, camera framing, the drive trail,
seeking for screenshots, and the unit tests.

Physics that keep arcs believable without tracking data:

- Pass flight time `t = 0.35 + 0.055 * dist` s; apex above the chord `H = g t^2 / 8` with `g = 10.73 yd/s^2`. A
  10-yard throw rises 1.2 yd, a 46-yard throw 11 yd. Release height 2.1 yd, catch 1.5 yd.
- Kicks: true distances from the row, generic heights: punts apex `0.33 * dist + 4` (10 to 26), kickoffs
  `0.36 * dist + 4`, field goals `0.2 * dist + 6` (9 to 17); a good FG crosses the end-line plane above the
  crossbar and between the uprights (unit-tested).
- Read time: every play is scaled into 2.2 to 4.0 s at 1x; Watch mode squeezes further (7.6).

### 7.2 `core/paths.js` (pure)

```js
import { clamp, lerp3, EASE } from './easing.js';   // easeInOutCubic etc.; EASE = { linear, inOut, out, in }
import { sideZ } from './coords.js';

const G = 10.73, RELEASE_H = 2.1, CATCH_H = 1.5, CARRY_H = 0.9, GROUND_H = 0.12, HALF_W = 80 / 3;
export const READ_TIME = { min: 2.2, max: 4.0 };
export const passFlightTime = (dist) => 0.35 + 0.055 * dist;
export const apexForHang = (t) => (G * t * t) / 8;
const GAP_OFFSET = { middle: 0, guard: 2, tackle: 4, end: 8 };   // data-contract A4, drawn as approximate
const PASS_LATERAL = 12;
const DEPTH_AIR = { short: 5, mid: 14, deep: 23 };              // fallback only: rows carry call.air (contract B6)

const seg = (t0, dur, kind, a, b, extra = {}) => ({ t0, t1: t0 + dur, kind, a, b, ...extra });

export function sampleTrack(segs, t) {
  let s = segs[0];
  for (const x of segs) { if (t >= x.t0) s = x; else break; }
  const u = s.t1 > s.t0 ? clamp((t - s.t0) / (s.t1 - s.t0), 0, 1) : 1;
  if (s.kind === 'hold') return s.a.slice();
  const e = EASE[s.ease || (s.kind === 'arc' ? 'linear' : 'inOut')](u);
  const p = lerp3(s.a, s.b, e);
  if (s.kind === 'arc') p[1] += 4 * s.apex * e * (1 - e);
  return p;
}
export function sampleHeading(segs, t, dt = 1 / 60) {
  const a = sampleTrack(segs, t - dt), b = sampleTrack(segs, t + dt);
  return [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
}

function backfield({ losX, dir, snapZ, shotgun }) {
  const depth = shotgun === false ? 0.7 : 5;          // unknown alignment: shotgun, the most common snap
  return { qb: [losX - dir * depth, CARRY_H, snapZ], depth };
}

function runPath(spec, t0, from) {                    // lateral to the gap (approx), then straight upfield (no cutbacks)
  const { losX, dir, snapZ, gain } = spec;
  const gap = spec.run?.gap || 'middle', sz = sideZ(spec.run?.side || 'middle', dir);
  const aim = [gap === 'end' ? losX - dir * 0.8 : losX, CARRY_H, snapZ + sz * GAP_OFFSET[gap]];
  let endZ = aim[2] + sz * clamp(Math.abs(gain) * 0.15, 0, gap === 'end' ? 4 : 2);
  if (spec.outOfBounds) endZ = (sz || 1) * (HALF_W - 0.3);
  const end = [losX + dir * gain, CARRY_H, clamp(endZ, -HALF_W + 0.3, HALF_W - 0.3)];
  const tLat = clamp(Math.hypot(aim[0] - from[0], aim[2] - from[2]) / 7, 0.35, 0.9);
  const tRun = clamp(Math.hypot(end[0] - aim[0], end[2] - aim[2]) / 8.5, 0.35, 2.2);
  return { segs: [seg(t0, tLat, 'line', from, aim, { ease: 'in', approx: true }), seg(t0 + tLat, tRun, 'line', aim, end, { ease: 'out' })],
    end, tEnd: t0 + tLat + tRun };
}

function passTarget(spec) {
  const p = spec.pass || {}, air = p.air ?? DEPTH_AIR[p.depth] ?? DEPTH_AIR.short;
  const z = clamp(spec.snapZ + sideZ(p.side, spec.dir) * PASS_LATERAL, -HALF_W + 1, HALF_W - 1);
  return [spec.losX + spec.dir * air, CATCH_H, z];
}

export function buildTimeline(spec) {
  const { losX, dir, snapZ, gain = 0, kind } = spec;
  const center = [losX, GROUND_H + 0.1, snapZ], ball = [], events = [{ t: 0, type: 'snap', at: center }];
  let t = 0;
  const { qb, depth } = backfield(spec);
  const snapTo = (to, dur = depth > 1 ? 0.28 : 0.12) => {
    ball.push(seg(t, dur, depth > 1 ? 'arc' : 'line', center, to, { apex: depth > 1 ? 0.25 : 0, approx: true, ease: 'linear' }));
    t += dur;
  };

  if (kind === 'run' || kind === 'kneel') {
    snapTo(qb);
    if (kind === 'kneel') {
      const down = [losX - dir * (depth > 1 ? 5 : 1.2), GROUND_H + 0.1, snapZ];
      ball.push(seg(t, 0.5, 'line', qb, down, { approx: true })); t += 0.5;
      events.push({ t, type: 'down', at: down });
    } else {
      const mesh = [losX - dir * (depth > 1 ? 4.4 : 4.2), CARRY_H, snapZ + sideZ(spec.run?.side, dir) * 0.7];
      ball.push(seg(t, 0.32, 'line', qb, mesh, { approx: true })); t += 0.32;
      events.push({ t, type: 'handoff', at: mesh });
      const r = runPath(spec, t, mesh);
      ball.push(...r.segs); t = r.tEnd;
      events.push({ t, type: spec.td ? 'td' : spec.fumble ? 'fumble' : 'tackle', at: r.end });
    }
  } else if (['pass', 'sack', 'scramble', 'spike'].includes(kind)) {
    snapTo(qb);
    const dropTo = [losX - dir * Math.max(depth + 1.5, 6.5), RELEASE_H, snapZ];
    if (spec.family === 'pa') {                          // fake handoff: rides toward the back, then sets
      const fake = [qb[0] + dir * 0.3, CARRY_H, snapZ + 0.9];
      ball.push(seg(t, 0.3, 'line', qb, fake, { approx: true }), seg(t + 0.3, 0.35, 'line', fake, dropTo, { approx: true }));
      t += 0.65;
    } else {
      const d = kind === 'spike' ? 0.1 : 0.55;
      ball.push(seg(t, d, 'line', qb, dropTo, { approx: true })); t += d;
    }
    if (kind === 'spike') {
      const ground = [losX - dir * 0.5, GROUND_H, snapZ];
      ball.push(seg(t, 0.25, 'line', dropTo, ground, { ease: 'in' })); t += 0.25;
      events.push({ t, type: 'spike', at: ground });
    } else if (kind === 'sack') {
      const hold = spec.pass?.depth === 'deep' ? 0.9 : 0.75;
      ball.push(seg(t, hold, 'hold', dropTo, dropTo, { approx: true })); t += hold;
      const at = [losX + dir * gain, CARRY_H * 0.6, snapZ + 0.6];          // gain is negative: pushed back
      ball.push(seg(t, 0.4, 'line', dropTo, at, { ease: 'out' })); t += 0.4;
      events.push({ t, type: 'sack', at });
    } else if (kind === 'scramble') {
      ball.push(seg(t, 0.5, 'hold', dropTo, dropTo, { approx: true })); t += 0.5;
      const r = runPath({ ...spec, run: { side: spec.run?.side || 'middle', gap: spec.run?.gap || 'end' } }, t, dropTo);
      ball.push(...r.segs); t = r.tEnd;
      events.push({ t, type: spec.td ? 'td' : 'tackle', at: r.end });
    } else {
      const p = spec.pass || {};
      const hold = p.depth === 'deep' || (p.air ?? 0) >= 20 ? 0.55 : 0.25;
      ball.push(seg(t, hold, 'hold', dropTo, dropTo, { approx: true })); t += hold;
      events.push({ t, type: 'release', at: dropTo });
      let target = passTarget(spec);
      if (p.intercepted && spec.intX != null) target = [spec.intX, CATCH_H, target[2]];
      const flight = passFlightTime(Math.hypot(target[0] - dropTo[0], target[2] - dropTo[2]));
      if (p.complete) {
        ball.push(seg(t, flight, 'arc', dropTo, target, { apex: apexForHang(flight) })); t += flight;
        events.push({ t, type: 'catch', at: target });
        const end = [losX + dir * gain, CARRY_H, clamp(target[2] + Math.sign(target[2] || 1) * Math.min(3, (p.yac ?? 0) * 0.2), -HALF_W + 0.3, HALF_W - 0.3)];
        if (spec.outOfBounds) end[2] = Math.sign(target[2] || 1) * (HALF_W - 0.3);
        const yacT = clamp(Math.hypot(end[0] - target[0], end[2] - target[2]) / 8.5, 0.25, 2.0);
        ball.push(seg(t, yacT, 'line', target, end, { ease: 'out' })); t += yacT;   // YAC: one straight stroke
        events.push({ t, type: spec.td ? 'td' : 'tackle', at: end });
      } else if (p.intercepted) {
        ball.push(seg(t, flight, 'arc', dropTo, target, { apex: apexForHang(flight) })); t += flight;
        events.push({ t, type: 'int', at: target });
        const ret = [spec.retEndX ?? target[0], CARRY_H, target[2] * 0.8];
        const retT = clamp(Math.abs(ret[0] - target[0]) / 8.5, 0.3, 2.2);
        ball.push(seg(t, retT, 'line', target, ret, { ease: 'out', team: 'defense' })); t += retT;
        events.push({ t, type: spec.defTd ? 'td' : 'tackle', at: ret, team: 'defense' });
      } else {                                           // incompletion: into the depth band, two decaying bounces
        const land = [target[0] + dir * 2.2, GROUND_H, target[2]];
        const tFly = passFlightTime(Math.hypot(land[0] - dropTo[0], land[2] - dropTo[2]));
        ball.push(seg(t, tFly, 'arc', dropTo, land, { apex: apexForHang(tFly), approx: true })); t += tFly;
        events.push({ t, type: 'incomplete', at: land, band: p.airBand });
        let a = land, hop = 0.9, d = 1.6;
        for (let i = 0; i < 2; i++) {
          const b = [a[0] + dir * d, GROUND_H, a[2]];
          ball.push(seg(t, 0.22 + 0.08 * hop, 'arc', a, b, { apex: hop, approx: true }));
          t += 0.22 + 0.08 * hop; a = b; hop *= 0.4; d *= 0.5;
        }
      }
    }
  } else if (['punt', 'fg', 'kickoff'].includes(kind)) {
    const k = spec.kick || {};
    let foot;
    if (kind === 'kickoff') {
      foot = [k.fromX ?? losX, GROUND_H + 0.15, 0];
      ball.push(seg(0, 0.6, 'hold', foot, foot, { approx: true })); t = 0.6;
    } else {
      foot = [kind === 'fg' && k.xKick != null ? k.xKick : losX - dir * (kind === 'punt' ? 15 : 8), kind === 'punt' ? 1.1 : GROUND_H + 0.2, snapZ];
      const snapT = kind === 'punt' ? 0.75 : 0.4;
      ball.push(seg(0, snapT, 'line', center, foot, { approx: true, ease: 'linear' }), seg(snapT, 0.25, 'hold', foot, foot, { approx: true }));
      t = snapT + 0.25;
    }
    events.push({ t, type: 'kick', at: foot });
    if (kind === 'fg') {
      const postX = k.postX ?? dir * 60, short = k.miss === 'short' || k.miss === 'blocked';
      const missZ = k.miss === 'left' || k.miss === 'right' ? sideZ(k.miss, dir) * 4.6 : 0;
      const over = [dir * (short ? 56 : 66), short ? GROUND_H : 4.5, short ? 0 : missZ * 1.15];
      const dist = Math.abs(over[0] - foot[0]), hang = clamp(0.9 + dist * 0.035, 1.2, 3.0);
      ball.push(seg(t, hang, 'arc', foot, over, { apex: short ? clamp(0.12 * dist + 3, 4, 8) : clamp(0.2 * dist + 6, 9, 17) }));
      events.push({ t: t + hang * clamp(Math.abs(postX - foot[0]) / dist, 0, 1), type: k.good ? 'good' : 'nogood', at: [postX, 4.5, missZ] });
      t += hang;
    } else {
      const land = [k.landX ?? losX + dir * (k.yards ?? 40), GROUND_H + 0.6, clamp(snapZ * 0.5, -10, 10)];
      const dist = Math.abs(land[0] - foot[0]);
      const hang = kind === 'punt' ? clamp(3.2 + dist * 0.02, 3.6, 4.8) : clamp(2.8 + dist * 0.02, 3.2, 4.4);
      ball.push(seg(t, hang, 'arc', foot, land, { apex: clamp((kind === 'punt' ? 0.33 : 0.36) * dist + 4, 10, 26) })); t += hang;
      events.push({ t, type: 'land', at: land });
      if (k.retEndX != null && Math.abs(k.retEndX - land[0]) > 0.5) {
        const ret = [k.retEndX, CARRY_H, land[2] * 0.6], rt = clamp(Math.abs(ret[0] - land[0]) / 8.5, 0.4, 2.4);
        ball.push(seg(t, rt, 'line', [land[0], CARRY_H, land[2]], ret, { ease: 'out', team: 'receiving' })); t += rt;
        events.push({ t, type: spec.td ? 'td' : 'tackle', at: ret });
      }
    }
  } else {                                               // penalty with no call: the flag is the play
    ball.push(seg(0, 0.4, 'hold', center, center, { approx: true })); t = 0.4;
  }

  if (spec.respotX != null && Math.abs(spec.respotX - sampleTrack(ball, t)[0]) > 0.25) {   // enforcement or touchback
    const from = sampleTrack(ball, t), to = [spec.respotX, GROUND_H + 0.1, 0];
    ball.push(seg(t + 0.35, 0.7, 'line', [from[0], GROUND_H + 0.1, from[2]], to, { ease: 'inOut', respot: true }));
    t += 1.05;
    events.push({ t, type: 'spot', at: to });
  }
  if (spec.flag) events.push({ t: Math.max(0.3, t * 0.55), type: 'flag', at: [losX + dir * 3, GROUND_H, clamp(snapZ + 4, -HALF_W, HALF_W)], label: spec.flag.text });
  events.sort((a, b) => a.t - b.t);
  return scaleTimeline({ duration: t, ball, events });
}

export function scaleTimeline(tl, range = READ_TIME) {
  const k = tl.duration > 0 ? clamp(tl.duration, range.min, range.max) / tl.duration : 1;
  return { duration: tl.duration * k, scale: k,
    ball: tl.ball.map((s) => ({ ...s, t0: s.t0 * k, t1: s.t1 * k })), events: tl.events.map((e) => ({ ...e, t: e.t * k })) };
}
export const sampleTimeline = (tl, n = 90) => Array.from({ length: n + 1 }, (_, i) => sampleTrack(tl.ball, (i / n) * tl.duration));
export function pathPoints(tl, { skipApprox = true, perSeg = 16 } = {}) {   // measured part only: the drive trail
  const pts = [];
  for (const s of tl.ball) {
    if (s.kind === 'hold' || (skipApprox && s.approx)) continue;
    for (let i = 0; i <= perSeg; i++) pts.push(sampleTrack([s], s.t0 + ((s.t1 - s.t0) * i) / perSeg));
  }
  return pts;
}
```

```js
// core/easing.js
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const EASE = { linear: (t) => t, inOut: easeInOutCubic, out: (t) => 1 - (1 - t) ** 3, in: (t) => t * t * t };
export const bezier2 = (p0, p1, p2, t) => [0, 1, 2].map((i) => (1 - t) ** 2 * p0[i] + 2 * (1 - t) * t * p1[i] + t * t * p2[i]);
export const sample = (fn, n) => Array.from({ length: n + 1 }, (_, i) => fn(i / n));
```

### 7.3 Per kind: what is exact and what is drawn as an estimate

| Kind | Exact (from the row) | Estimated (`approx`, drawn dim or hatched) | Effects |
| --- | --- | --- | --- |
| Run | line, gain, gap and side, TD, OB | QB/RB alignment, mesh point, lateral lane (L 2/4/8), end lateral | handoff, tackle ring or TD |
| Completion | line, air yards (`air_src: yac`), YAC, side third | release point, catch lateral (L 12), arc height | catch ring (white), tackle ring |
| Incompletion | line, side third, short/deep | depth inside `air_band` (draw the band), arc | gray ring, "Incomplete" |
| Interception | line, INT spot, return end | lateral, arc height | ball turns defense color, "Intercepted" |
| Sack | line, sack spot | drop depth, hold time | red burst (5.5 yd), "Sack" |
| Scramble | line, gain, scramble side | drop, lane | as a run |
| Punt / kickoff | spots, distances, return end, touchback | snap depth, heights, lateral | land, tackle; touchback walks out to `x_next` |
| Field goal | kick spot (8 yd back), posts, good/miss | arc height, miss side when the text has none | good/no good at the posts |
| Penalty, no play | flag, foul, yards, enforced spot | flag landing point | the wiped play animates as a ghost, then the ball walks to `x_next` |

Nullified plays use the same timeline with a ghost style: trail opacity 0.35, colors mixed 60% toward gray, no TD
burst, then the enforcement walk. That is the directions grammar ("ghosted play is visibly not counted").

### 7.4 The animator: ball, comet head, shadow, carrier ring, trail

- The ball is 2.2x real size (0.66 x 0.42 yd prolate spheroid) so it reads from the broadcast camera; it faces its
  velocity (`lookAt(p + heading)`) and spins about its long axis.
- A small additive sprite (HDR 2.5x) is the comet head: a 4-pixel ball stays findable at TV distance.
- The ground shadow is a radial alpha blob that grows and fades with height but never below 0.2 opacity, so a
  25-yard punt still shows where it will land.
- The trail is known in full when the play starts: build the `Line2` geometry once, reveal it with
  `geometry.instanceCount`. Vertex colors carry the honesty (approximate segments at 0.3) and the fade (older points
  at 45%). Additive blending plus colors above 1.0 make it glow through the bloom pass.
- A light core with the team color as glow (data-contract C2): trail core `mix(teamColor, white, 0.65)`.

```js
// three/play-anim.js (core)
function radialMask(size = 128, falloff = 3.2) {          // gray radial gradient: alphaMap or additive sprite map
  const c = Object.assign(document.createElement('canvas'), { width: size, height: size });
  const ctx = c.getContext('2d'), img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x - size / 2 + 0.5) / (size / 2), dy = (y - size / 2 + 0.5) / (size / 2), r2 = dx * dx + dy * dy;
    const v = r2 < 1 ? Math.round(255 * Math.exp(-r2 * falloff)) : 0, i = (y * size + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}

export function createBall() {
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 16).scale(0.42, 0.42, 0.66),
    new THREE.MeshStandardMaterial({ color: 0x7a4322, roughness: 0.5, emissive: 0x2a1206 }));
  const laces = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.2), new THREE.MeshStandardMaterial({ color: 0xffffff }));
  laces.position.set(0, 0.205, 0);
  ball.add(laces);
  return ball;
}

export function createPlayAnimator(stage, { teamColor, defColor, tailFade = 0 }) {
  const root = new THREE.Group();
  stage.scene.add(root);
  const ball = createBall();
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialMask(64, 4), color: new THREE.Color(0xcfe6ff).multiplyScalar(2.5),
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  glow.scale.setScalar(2.2); glow.renderOrder = 12;
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: radialMask(), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -10 }));
  shadow.renderOrder = 7;
  const carrier = new THREE.Mesh(new THREE.RingGeometry(0.75, 1.0, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(teamColor).multiplyScalar(2.2), transparent: true, opacity: 0.9,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -10 }));
  carrier.renderOrder = 7;
  root.add(ball, glow, shadow, carrier);

  const trailMat = new LineMaterial({ linewidth: 3.5, vertexColors: true, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, worldUnits: false });
  let trail = null, cur = null, paused = false;
  const fx = [], queue = [], listeners = new Set();

  function buildTrail(tl, color, samples = 120) {
    if (trail) { root.remove(trail); trail.geometry.dispose(); }
    const pts = sampleTimeline(tl, samples);
    const c = new THREE.Color(color).multiplyScalar(1.6), base = new Float32Array(pts.length * 3);
    pts.forEach((_, i) => {
      const t = (i / samples) * tl.duration;
      const s = tl.ball.findLast((x) => x.t0 <= t) || tl.ball[0];
      const k = (s.approx ? 0.3 : 1) * (0.45 + 0.55 * (i / samples));
      base[i * 3] = c.r * k; base[i * 3 + 1] = c.g * k; base[i * 3 + 2] = c.b * k;
    });
    const geo = new LineGeometry();
    geo.setPositions(pts.flat());
    geo.setColors(Array.from(base));
    trail = new Line2(geo, trailMat);
    trail.computeLineDistances();
    trail.frustumCulled = false;
    trail.renderOrder = 8;
    trail.userData = { total: geo.instanceCount, base };
    geo.instanceCount = 0;                       // reveal as the ball travels
    root.add(trail);
  }

  function place(t) {
    const p = sampleTrack(cur.tl.ball, t), h = sampleHeading(cur.tl.ball, t);
    ball.position.set(p[0], p[1], p[2]);
    glow.position.copy(ball.position);
    if (Math.hypot(h[0], h[1], h[2]) > 1e-4) ball.lookAt(p[0] + h[0], p[1] + h[1], p[2] + h[2]);
    ball.rotateZ(t * 18);                        // spiral
    const height = Math.max(0, p[1] - 0.2);
    shadow.position.set(p[0], 0, p[2]);
    shadow.scale.setScalar(1 + height * 0.09);
    shadow.material.opacity = Math.max(0.2, 0.6 / (1 + height * 0.12));
    carrier.visible = p[1] < 1.3;                // the ring marks "carried", not a player
    carrier.position.set(p[0], 0, p[2]);
    const { total, base } = trail.userData;
    const shown = Math.max(0, Math.min(total, Math.floor(clamp(t / cur.tl.duration, 0, 1) * total)));
    trail.geometry.instanceCount = shown;
    if (tailFade > 0) {   // comet tail: rewrite the instanced color buffer in place (no reallocation, no GC)
      const buf = trail.geometry.attributes.instanceColorStart.data, a = buf.array, dtSeg = cur.tl.duration / total;
      for (let i = 0; i < shown; i++) {
        const f0 = clamp(1 - (t - i * dtSeg) / tailFade, 0, 1), f1 = clamp(1 - (t - (i + 1) * dtSeg) / tailFade, 0, 1);
        for (let k = 0; k < 3; k++) { a[i * 6 + k] = base[i * 3 + k] * f0; a[i * 6 + 3 + k] = base[(i + 1) * 3 + k] * f1; }
      }
      buf.needsUpdate = true;                    // instanceColorStart/End share one InstancedInterleavedBuffer, stride 6
    }
  }
  // ... fire(), update(), enqueue(), skip(), seek() in 7.5 and 7.6
}
```

`setPositions`/`setColors` allocate new buffers on every call: fine once per play, wrong per frame. For anything
updated per frame, write into `attributes.instanceStart.data.array` (or `instanceColorStart.data.array`) and set
`.data.needsUpdate = true`, as above.

### 7.5 Events to effects

```js
  const LABELS = { incomplete: 'Incomplete', int: 'Intercepted', sack: 'Sack', td: 'Touchdown', fumble: 'Fumble', good: 'Good', nogood: 'No good' };

  function burst(at, color, { r0 = 0.6, r1 = 4, life = 0.8 } = {}) {   // expanding ground ring, additive HDR
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3), transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -10 });
    const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 64).rotateX(-Math.PI / 2), mat);
    m.position.set(at[0], 0, at[2]);
    m.renderOrder = 9;
    root.add(m);
    fx.push({ obj: m, age: 0, life, update: (k) => { m.scale.setScalar(r0 + (r1 - r0) * (1 - (1 - k) ** 3)); mat.opacity = 1 - k; } });
  }

  function flagThrow(at) {                     // yellow flag tossed in from the official's side, lands flat
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9),
      new THREE.MeshStandardMaterial({ color: 0xffd400, emissive: 0x6a5200, side: THREE.DoubleSide }));
    root.add(flag);
    const from = [at[0] + 6, 3.5, at[2] + 9];
    fx.push({ obj: flag, age: 0, life: 1.6, keep: true, update: (k) => {
      const u = clamp(k / 0.55, 0, 1);
      flag.position.set(from[0] + (at[0] - from[0]) * u, from[1] * (1 - u) + 2.2 * Math.sin(Math.PI * u) + 0.05, from[2] + (at[2] - from[2]) * u);
      flag.rotation.set(u < 1 ? k * 14 : -Math.PI / 2, k * 9, 0);
    } });
  }

  function label(text, at, cls) {               // CSS2D tag above the spot, fades after 2.1 s
    const el = Object.assign(document.createElement('div'), { className: cls, textContent: text });
    const obj = new CSS2DObject(el);
    obj.position.set(at[0], at[1] + 2.2, at[2]);
    obj.center.set(0.5, 1);
    root.add(obj);
    fx.push({ obj, age: 0, life: 2.6, update: (k) => { el.style.opacity = String(k < 0.8 ? 1 : (1 - k) / 0.2); } });
  }

  function fire(e, spec) {
    const team = e.team ? defColor : teamColor;
    if (e.type === 'catch' || e.type === 'tackle') burst(e.at, e.type === 'catch' ? 0xffffff : team, { r1: 2.6, life: 0.6 });
    if (e.type === 'int') { ball.material.color.set(defColor); burst(e.at, defColor, { r1: 4.5 }); }
    if (e.type === 'sack') burst(e.at, 0xff3b30, { r1: 5.5, life: 0.9 });
    if (e.type === 'incomplete') burst(e.at, 0x9aa7b8, { r1: 2.2, life: 0.7 });
    if (e.type === 'td' && !spec.nullified) { burst(e.at, team, { r1: 9, life: 1.4 }); burst(e.at, 0xffffff, { r1: 5, life: 1.0 }); }
    if (e.type === 'flag') flagThrow(e.at);
    if (LABELS[e.type] || e.type === 'flag') label(e.type === 'flag' ? `Flag: ${e.label || ''}` : LABELS[e.type], e.at, `gc-tag gc-${e.type}`);
    for (const fn of listeners) fn(e, spec);    // the UI hooks verdict slabs, ribbon text, sound here
  }
```

TD extra (all cheap, all reverted after 2 s): brighten the scoring end zone (`turf.uniforms.uEndR.value` times 1.4
then back), switch the ribbon boards' `color` to the scorer's color, burst at the goal line crossing.

Pool the rings, flag and label elements created at startup (hidden), so `compileAsync` sees their materials and the
first sack doesn't compile a shader mid-play.

### 7.6 Queue, Watch pacing, skip, replay angle

Contract E4: a new row arrives when `timeline_n` grows. The animation length is
`min(normal, 0.8 * (watch.next_at - now))`, and when more than 3 rows are waiting the older ones are drawn instantly
(their final state, trail and drive trail, no animation). Watch pacing at 1x is 7 s per caller snap, 4 s per
opponent snap, 5 s per kick (E3), so at 10x a snap gets 0.4 to 0.7 s: the timeline just compresses into a quick
stroke that leaves its trail behind.

```js
  function start(spec, budgetSec = Infinity) {
    for (const f of fx.splice(0)) { root.remove(f.obj); f.obj.geometry?.dispose(); f.obj.material?.dispose(); f.obj.element?.remove(); }
    let tl = buildTimeline(spec);
    if (budgetSec < tl.duration) tl = scaleTimeline(tl, { min: 0, max: Math.max(0.25, budgetSec) });
    ball.material.color.set(0x7a4322);
    const team = new THREE.Color(spec.dir === 1 ? teamColor : defColor);
    buildTrail(tl, team.lerp(new THREE.Color(0xffffff), 0.65));   // light core; the team color goes in the glow/ring
    cur = { tl, t: 0, spec, fired: 0 };
    stage.invalidate();
  }

  function update(dt) {
    let busy = false;
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i];
      f.age += dt;
      const k = clamp(f.age / f.life, 0, 1);
      f.update(k);
      if (k >= 1 && !f.keep) { root.remove(f.obj); f.obj.geometry?.dispose(); f.obj.material?.dispose(); f.obj.element?.remove(); fx.splice(i, 1); }
      else if (k < 1) busy = true;
    }
    if (cur && !paused) {
      cur.t += dt;
      while (cur.fired < cur.tl.events.length && cur.tl.events[cur.fired].t <= cur.t) fire(cur.tl.events[cur.fired++], cur.spec);
      place(Math.min(cur.t, cur.tl.duration));
      busy = true;
      if (cur.t >= cur.tl.duration + 0.6) {
        const done = cur;
        cur = null;
        for (const fn of listeners) fn({ type: 'end' }, done.spec);
        if (queue.length) { const next = queue.shift(); start(next.spec, next.budget); }
      }
    }
    return busy;                                 // false = nothing animating: the stage may stop its loop
  }
  stage.addUpdater(update);

  return {
    root, ball,
    /** budgetSec: Watch mode passes 0.8 * (watch.next_at - Date.now()) / 1000. */
    enqueue(spec, budgetSec = Infinity) {
      if (queue.length >= 3) { for (const q of queue.splice(0)) for (const fn of listeners) fn({ type: 'instant' }, q.spec); }
      if (!cur) start(spec, budgetSec); else queue.push({ spec, budget: budgetSec });
    },
    skip() { queue.length = 0; if (cur) { cur.t = cur.tl.duration; stage.invalidate(); } },   // Right arrow / Skip button
    seek(spec, t) {                              // deterministic pose: tests, screenshots, scrubbing
      if (!cur || cur.spec !== spec) start(spec);
      paused = true;
      cur.t = t;
      while (cur.fired < cur.tl.events.length && cur.tl.events[cur.fired].t <= t) fire(cur.tl.events[cur.fired++], cur.spec);
      place(Math.min(t, cur.tl.duration));
      stage.invalidate();
      return cur.tl;
    },
    resume() { paused = false; stage.invalidate(); },
    onEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get current() { return cur; },
  };
```

- `'instant'` listeners must still append the row to the drive trail and move the lines; only the motion is skipped.
- Epoch change (contract B1): drop the queue, rebuild the scene from `since=0` with no animation.
- **Replay angle** (free, because timelines are deterministic): after a caller snap, `rig.cut('endzone')` and
  `anim.seek(spec, 0)` then `resume()`; the same play runs again from behind the offense, then cut back. Offer it on
  a key in live mode and automatically on TDs and turnovers in Watch mode when the budget allows.
- Hidden tab: `Timer.connect(document)` already zeroes the delta while hidden; on return, more than 3 queued rows
  collapse to instant per the rule above.

---

## 8. Ghost predictions before the snap

### 8.1 What each of the 14 plays may draw

The model predicts categories, so ghosts are lanes and zones, never routes (directions grammar). Pass leaves carry
a depth bucket and **no side**: their arcs aim down the middle and their zone spans the field width.

| Leaf | Shape | Color (night) |
| --- | --- | --- |
| `run_inside` | lane from the back through the A/B gap (L 2), 5 yd past the line | run `#ffa63d` |
| `run_ot_left` / `run_ot_right` | lane through the C gap (L 4) on that side (offense's left = far side when attacking right) | run |
| `run_edge_left` / `run_edge_right` | lane bending outside (L 8 then 10.5), 4 yd past the line | run |
| `dropback_short` / `_mid` / `_deep` | flight arc from the QB (6.5 yd deep) to the bucket center (5, 15, 26 yd); zone 0-10, 10-20, 20-40 | dropback `#5aa2ff` |
| `pa_short` / `_mid` / `_deep` | same, dashed, offset 2.4 yd from the dropback arc so both stay visible | PA `#7fd3ff` |
| `screen` | two low arcs to both flats behind the line (no side), half weight each | screen `#5ef0c8` |
| `rpo_run` | inside lane plus a read marker at the mesh point, dashed | RPO `#b18cff` |
| `rpo_throw` | quick arc 5 yd past the line, dashed | RPO |

These are the app's hues (`--run`, `--pass`, `--rpo`) lifted for a night scene. The LOS is blue too, so pass
ghosts float as arcs while the LOS is a ground strip; the hatch style (8.3) avoids the clash entirely.

Weight `w = p / p_top` (the DOM bars use the same scale). Shown: the top 6 or any leaf at 4% or more; labelled: the
top 3, the rest on hover. Opacity `0.18 + 0.72 w`, line width `1.5 + 4.5 w` px, the top pick at HDR 1.8x so it is the
only ghost that blooms.

### 8.2 `core/ghosts.js` (pure)

```js
import { clamp, bezier2, sample } from './easing.js';
import { sideZ } from './coords.js';
import { passFlightTime, apexForHang } from './paths.js';

export const LEAF_SHAPE = Object.freeze({
  run_inside: { family: 'run', kind: 'run', side: 'middle', gap: 'guard' },
  run_ot_left: { family: 'run', kind: 'run', side: 'left', gap: 'tackle' },
  run_edge_left: { family: 'run', kind: 'run', side: 'left', gap: 'end' },
  run_ot_right: { family: 'run', kind: 'run', side: 'right', gap: 'tackle' },
  run_edge_right: { family: 'run', kind: 'run', side: 'right', gap: 'end' },
  dropback_short: { family: 'dropback', kind: 'pass', depth: 'short' },
  dropback_mid: { family: 'dropback', kind: 'pass', depth: 'mid' },
  dropback_deep: { family: 'dropback', kind: 'pass', depth: 'deep' },
  pa_short: { family: 'pa', kind: 'pass', depth: 'short' },
  pa_mid: { family: 'pa', kind: 'pass', depth: 'mid' },
  pa_deep: { family: 'pa', kind: 'pass', depth: 'deep' },
  screen: { family: 'screen', kind: 'screen' },
  rpo_run: { family: 'rpo', kind: 'run', side: 'middle', gap: 'guard', read: true },
  rpo_throw: { family: 'rpo', kind: 'quick' },
});
export const DEPTH_RANGE = Object.freeze({ short: [0, 10], mid: [10, 20], deep: [20, 40] });   // the model's buckets
const GAP = { middle: 0, guard: 2, tackle: 4, end: 8 }, H = 0.25;

export const leavesOf = (prediction) => prediction.families.flatMap((f) => f.leaves.map((l) => ({ key: l.key, name: l.name, p: l.p, hot: l.hot })));

export function ghostSpecs(prediction, { losX, dir, snapZ = 0, topN = 6, minP = 0.04, labelTop = 3 }) {
  const leaves = leavesOf(prediction).sort((a, b) => b.p - a.p);
  const pMax = leaves[0]?.p || 1;
  const ghosts = leaves.map((leaf, rank) => {
    const shape = LEAF_SHAPE[leaf.key];
    const out = { ...leaf, ...shape, rank, w: leaf.p / pMax, shown: rank < topN || leaf.p >= minP, labelled: rank < labelTop,
      dashed: shape.family === 'pa' || shape.family === 'rpo' };
    const qb = [losX - dir * 6.5, 2.1, snapZ];
    if (shape.kind === 'run') {
      const sz = sideZ(shape.side, dir), edge = shape.gap === 'end';
      const start = [losX - dir * 5.2, H, snapZ - sz * 0.8];
      const ctrl = [losX - dir * (edge ? 1.5 : 1.0), H, snapZ + sz * GAP[shape.gap] * (edge ? 1.25 : 1)];
      const end = [losX + dir * (edge ? 4 : 5), H, snapZ + sz * (GAP[shape.gap] + (edge ? 2.5 : 0.6))];
      out.points = sample((t) => bezier2(start, ctrl, end, t), 24);
      if (shape.read) out.marker = [losX - dir * 4.4, H, snapZ];
    } else if (shape.kind === 'pass') {
      const [d0, d1] = DEPTH_RANGE[shape.depth], mid = shape.depth === 'deep' ? 26 : (d0 + d1) / 2;
      const end = [losX + dir * mid, 1.2, clamp(snapZ + (shape.family === 'pa' ? 1.2 : -1.2), -20, 20)];
      const apex = apexForHang(passFlightTime(Math.hypot(end[0] - qb[0], end[2] - qb[2])));
      out.points = sample((t) => [qb[0] + (end[0] - qb[0]) * t, qb[1] + (end[1] - qb[1]) * t + 4 * apex * t * (1 - t), qb[2] + (end[2] - qb[2]) * t], 32);
      out.band = { depth: shape.depth, x0: losX + dir * d0, x1: losX + dir * d1 };
    } else if (shape.kind === 'screen') {
      out.split = [-1, 1].map((s) => {
        const end = [losX - dir * 1.5, 1.0, clamp(snapZ + s * 11, -24, 24)];
        return sample((t) => bezier2(qb, [(qb[0] + end[0]) / 2, 2.4, (qb[2] + end[2]) / 2], end, t), 16);
      });
      out.points = out.split[0];
    } else {
      out.points = sample((t) => bezier2([losX - dir * 4.4, 1.9, snapZ], [losX, 2.6, snapZ], [losX + dir * 5, 1.4, snapZ], t), 16);
      out.marker = [losX - dir * 4.4, H, snapZ];
    }
    const along = shape.kind === 'pass' ? out.points[Math.round(out.points.length * 0.72)] : out.points[out.points.length - 1];
    out.labelAt = [along[0], along[1] + 1.4, along[2]];       // throws: the label rides the arc
    return out;
  });
  const bands = Object.keys(DEPTH_RANGE).map((depth) => {      // total share of throws per depth (dropback + PA)
    const p = ghosts.filter((g) => g.kind === 'pass' && g.depth === depth).reduce((s, g) => s + g.p, 0);
    const [d0, d1] = DEPTH_RANGE[depth];
    return { depth, p, w: p / pMax, x0: losX + dir * d0, x1: losX + dir * d1 };
  });
  return { ghosts, bands, pMax };
}

export function ghostFramePoints(spec) {                       // feed to rig.setContext({ points })
  return spec.ghosts.filter((g) => g.shown).flatMap((g) => [g.points[0], g.points[g.points.length - 1], g.labelAt]);
}
```

Live input is `state.prediction` (`families[].leaves[]` with `key`, `name`, `p`); after the snap the same tree is on
the timeline row as `pred.dist.his_l` in canonical leaf order (contract B2), which drives the verdict (8.4).

### 8.3 `three/ghost-view.js`: lanes, zones, labels, picking, DOM linkage

```js
export const GHOST_COLORS = { run: 0xffa63d, dropback: 0x5aa2ff, pa: 0x7fd3ff, screen: 0x5ef0c8, rpo: 0xb18cff };
export const HIT_LAYER = 2;                       // invisible pick tubes live here; the camera never renders layer 2

/** Estimate zone: team color at 40% with 45-degree white hatching at a constant pixel pitch (gl_FragCoord), so
 *  the hatch never shimmers or scales with distance. The Network Package's "estimate hatch". */
export function hatchMaterial(color, { alpha = 0.4, pitchPx = 6, dpr = 1 } = {}) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -3,
    uniforms: { uColor: { value: new THREE.Color(color) }, uAlpha: { value: alpha }, uPitch: { value: pitchPx * dpr } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 uColor; uniform float uAlpha, uPitch; varying vec2 vUv;
      void main(){
        float stripe = smoothstep(0.35, 0.5, abs(fract((gl_FragCoord.x + gl_FragCoord.y) / uPitch) - 0.5));
        float edge = smoothstep(0.0, 0.04, vUv.x) * smoothstep(1.0, 0.96, vUv.x) * smoothstep(0.0, 0.04, vUv.y) * smoothstep(1.0, 0.96, vUv.y);
        gl_FragColor = vec4(mix(uColor, vec3(1.0), stripe * 0.85), uAlpha * edge);
      }`,
  });
}

function glowZoneMaterial(color) {               // soft additive zone (the night directions)
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -3,
    uniforms: { uColor: { value: new THREE.Color(color) }, uAlpha: { value: 0.2 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 uColor; uniform float uAlpha; varying vec2 vUv;
      void main(){ float e = smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.92, vUv.y) * smoothstep(0.0, 0.1, vUv.x) * smoothstep(1.0, 0.9, vUv.x);
      gl_FragColor = vec4(uColor * uAlpha * e, 1.0); }`,
  });
}

function arrowHead(color) {                      // flat triangle on the ground, pointing -z before rotation
  const s = new THREE.Shape();
  s.moveTo(0, 0.75); s.lineTo(-0.5, -0.35); s.lineTo(0.5, -0.35); s.closePath();
  return new THREE.Mesh(new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false }));
}

export function createGhostView(stage, L, { onHover, onPick, zoneStyle = 'glow', zoneColor = 0x5aa2ff } = {}) {
  const root = new THREE.Group();
  stage.scene.add(root);
  let items = [], bands = [], hovered = null;
  function clear() {
    for (const o of [...items.flatMap((it) => it.objects), ...bands]) { root.remove(o); o.geometry?.dispose(); o.material?.dispose(); o.element?.remove(); }
    items = []; bands = [];
  }
  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2(), v = new THREE.Vector3();
  raycaster.layers.set(HIT_LAYER);

  function set(prediction, { losX, dir, ballZ = 0 }) {
    clear();
    const spec = ghostSpecs(prediction, { losX, dir, snapZ: ballZ });
    for (const g of spec.ghosts.filter((x) => x.shown)) {
      const color = GHOST_COLORS[g.family], objects = [], lineMats = [];
      for (const pts of g.split || [g.points]) {
        const geo = new LineGeometry();
        geo.setPositions(pts.flat());
        const mat = new LineMaterial({ color: new THREE.Color(color).multiplyScalar(g.rank === 0 ? 1.8 : 1.15),
          linewidth: 2, transparent: true, depthWrite: false, dashed: g.dashed, dashSize: 1.1, gapSize: 0.7 });
        const line = new Line2(geo, mat);
        line.computeLineDistances();             // required before dashes show
        line.renderOrder = 10;
        lineMats.push(mat);
        const hit = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 24, 1.1, 6),
          new THREE.MeshBasicMaterial());       // fat invisible tube: robust hover, no screen-space line raycasts
        hit.layers.set(HIT_LAYER);
        hit.userData.leaf = g.key;
        objects.push(line, hit);
      }
      const tip = g.points[g.points.length - 1], prev = g.points[g.points.length - 3];
      const head = arrowHead(new THREE.Color(color).multiplyScalar(1.2));      // flat triangle, points -z by default
      head.position.set(tip[0], Math.max(0.05, tip[1] - 0.2), tip[2]);
      head.rotation.y = Math.atan2(-(tip[0] - prev[0]), -(tip[2] - prev[2]));
      head.scale.setScalar(0.8 + 0.8 * g.w);
      head.renderOrder = 11;
      const el = document.createElement('div');            // CSS2DRenderer owns this element's transform...
      const pill = document.createElement('div');          // ...so declutter moves the inner pill
      pill.className = `gc-ghost gc-${g.family}`;
      pill.innerHTML = `<b>${g.name}</b> <span>${Math.round(g.p * 100)}%</span>`;
      el.appendChild(pill);
      const label = new CSS2DObject(el);
      label.position.set(...g.labelAt);
      label.center.set(0.5, 1);
      objects.push(head, label);
      root.add(...objects);
      items.push({ g, objects, lineMats, head, label });
    }
    for (const b of spec.bands) {                // depth zones; shown while a throw is in focus (or always, per direction)
      const mat = zoneStyle === 'hatch' ? hatchMaterial(zoneColor, { dpr: stage.renderer.getPixelRatio() }) : glowZoneMaterial(GHOST_COLORS.dropback);
      if (zoneStyle !== 'hatch') mat.uniforms.uAlpha.value = 0.05 + 0.12 * b.w;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(Math.abs(b.x1 - b.x0), L.halfWidth * 2 - 6).rotateX(-Math.PI / 2), mat);
      m.position.set((b.x0 + b.x1) / 2, 0, 0);
      m.renderOrder = 2;
      m.userData.depth = b.depth;
      m.visible = false;
      root.add(m);
      bands.push(m);
    }
    highlight(null);
    return spec;
  }

  function highlight(key) {                      // DOM hover -> 3D, and 3D hover -> DOM via onHover
    hovered = key;
    for (const it of items) {
      const base = 0.18 + 0.72 * it.g.w, on = key === it.g.key, dim = key && !on;
      for (const m of it.lineMats) { m.opacity = dim ? base * 0.25 : on ? 1 : base; m.linewidth = (1.5 + 4.5 * it.g.w) * (on ? 1.6 : 1); }
      it.head.material.opacity = dim ? base * 0.25 : on ? 1 : base;
      it.label.visible = on || (!key && it.g.labelled);
      it.label.element.firstChild.classList.toggle('on', on);
    }
    const focus = items.find((it) => it.g.key === key)?.g;
    for (const b of bands) b.visible = !!focus && focus.kind === 'pass' && focus.depth === b.userData.depth;
    stage.invalidate();
  }

  stage.addUpdater(() => {                       // screen-space declutter: highest p keeps its spot, others stack up
    const W = stage.renderer.domElement.clientWidth, Hc = stage.renderer.domElement.clientHeight, placed = [];
    for (const it of items.filter((x) => x.label.visible).sort((a, b) => b.g.p - a.g.p)) {
      v.copy(it.label.position).project(stage.camera);
      const el = it.label.element, w = el.offsetWidth || 140, h = el.offsetHeight || 26;
      const x = ((v.x + 1) / 2) * W - w / 2, y0 = ((1 - v.y) / 2) * Hc - h;
      let y = y0;
      for (let guard = 0; guard < 16; guard++) {
        const hit = placed.find((r) => x < r.x + r.w + 6 && x + w + 6 > r.x && y < r.y + r.h + 4 && y + h + 4 > r.y);
        if (!hit) break;
        y = hit.y - h - 4;
      }
      placed.push({ x, y, w, h });
      el.firstChild.style.transform = y0 - y ? `translateY(${y - y0}px)` : '';
      el.firstChild.style.setProperty('--lead', `${y0 - y}px`);     // CSS ::after draws the leader line
    }
    return false;                                // never keeps the loop alive by itself
  });

  function pick(clientX, clientY) {
    const r = stage.renderer.domElement.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, stage.camera);
    return raycaster.intersectObject(root, true)[0]?.object.userData.leaf ?? null;
  }
  const canvas = stage.renderer.domElement;
  canvas.addEventListener('pointermove', (e) => {
    const k = pick(e.clientX, e.clientY);
    if (k !== hovered) { highlight(k); onHover?.(k); }
    canvas.style.cursor = k ? 'pointer' : '';
  });
  canvas.addEventListener('click', (e) => { const k = pick(e.clientX, e.clientY); if (k) onPick?.(k); });
  return { root, set, clear, highlight, pick, setVisible(on) { root.visible = on; stage.invalidate(); } };
}
```

Linking to the existing panel, which renders the 14 leaves as `.leaf[data-leaf]` and calls `pickLeaf(leaf)` on click:

```js
const ghosts = createGhostView(stage, L, {
  onHover: (k) => document.querySelectorAll('.leaf[data-leaf]').forEach((el) => el.classList.toggle('hot', el.dataset.leaf === k)),
  onPick: (k) => pickLeaf(k),                    // clicking a ghost = clicking its row (manual entry)
});
document.addEventListener('pointerover', (e) => { const el = e.target.closest?.('.leaf[data-leaf]'); if (el) ghosts.highlight(el.dataset.leaf); });
document.addEventListener('pointerout', (e) => { if (e.target.closest?.('.leaf[data-leaf]')) ghosts.highlight(null); });
```

The panel re-renders with `innerHTML`, so use delegation (above), not per-element listeners. Verified both ways in
Playwright: hovering the `pa_short` row outlines "PA short (0-9) 14%" on the field; moving the mouse onto the inside
run lane gives `.leaf.hot` on `run_inside`.

Label CSS used in the prototype (style per direction):

```css
.gc-ghost { position: relative; font: 600 15px/1 "Barlow Condensed", sans-serif; color: #fff; white-space: nowrap;
  background: rgba(10,16,26,.82); border-left: 3px solid currentColor; padding: 5px 8px 5px 7px; border-radius: 3px; }
.gc-ghost span { font-variant-numeric: tabular-nums; color: currentColor; }
.gc-ghost.on { outline: 2px solid currentColor; }
.gc-ghost::after { content: ''; position: absolute; left: 50%; top: 100%; width: 1px; height: var(--lead, 0px); background: currentColor; opacity: .55; }
.gc-run { color: #ffa63d; } .gc-dropback { color: #5aa2ff; } .gc-pa { color: #7fd3ff; } .gc-screen { color: #5ef0c8; } .gc-rpo { color: #b18cff; }
```

### 8.4 Choreography: prediction, snap, verdict

1. A new prediction (`state.version` bump with a drive active): ghosts fade in over 300 to 400 ms (ramp `uAlpha` and
   line opacity in an updater; the loop runs only for the fade).
2. The row for that snap arrives: the top pick stays at 15% and everything else fades out in 250 ms; the play runs
   over it, so predicted and actual sit side by side (Booth Sheet's rule).
3. On the animator's `end` event: if `pred.leaf_rank === 1` the surviving ghost flashes and the DOM verdict says HIT;
   otherwise the actual leaf's ghost (from `pred.dist.his_l`) draws briefly with its pre-snap % so the miss is
   honest ("Called: Off-tackle left 8%, his #4").
4. Opponent snaps (`offense_is_caller` false) have no ghost; they animate in the opponent's colors.

---

## 9. Drive trail

Draw the current drive's previous snaps on the field from `pathPoints(tl)`: only the measured part of each play
(the air arc and YAC stroke of a completion, the upfield part of a run, a return), never the estimated drop or mesh,
so the trail reads as clean strokes instead of scribbles (the first prototype drew whole timelines and looked
like spaghetti). Passes keep half their arc height; runs lie on the ground.

```js
function buildDriveTrail(rows, { teamColor }) {          // rows: this drive's applied rows, oldest first
  const group = new THREE.Group();
  const plays = rows.map(specFromRow).filter((s) => s && !['kickoff', 'penalty'].includes(s.kind));
  plays.forEach((s, i) => {
    const pts = pathPoints(buildTimeline(s)).map(([x, y, z]) => [x, Math.max(0.06, y * 0.5), z]);
    if (pts.length < 2) return;
    const age = (plays.length - 1 - i) / Math.max(1, plays.length - 1);          // 0 = newest
    const color = new THREE.Color(s.kind === 'pass' ? GHOST_COLORS.dropback : GHOST_COLORS.run).multiplyScalar(0.55 + 0.45 * (1 - age));
    const geo = new LineGeometry();
    geo.setPositions(pts.flat());
    const line = new Line2(geo, new LineMaterial({ color, linewidth: 2.2, transparent: true, depthWrite: false,
      opacity: (s.nullified ? 0.35 : 1) * (0.35 + 0.5 * (1 - age)), dashed: s.nullified, dashSize: 0.8, gapSize: 0.6 }));
    if (s.nullified) line.computeLineDistances();
    line.renderOrder = 6;
    group.add(line);
  });
  return group;                                         // dispose geometries and materials when the drive changes
}
```

- Rebuild on every new row of the drive (a few dozen segments: cheap) or keep one `LineSegments2` per drive and
  append; either way dispose the old geometry.
- Add a small end-of-play dot (the tackle spot) and, at drive end, a result tag at the last spot (TD, FG, PUNT,
  INT, DOWNS from `drives[].result`, only once the drive is complete per contract C3).
- Drive recap shot: on a completed drive, `rig.cut('all22')` with `points` = every trail point, hold 2 s, cut back.
- Booth Sheet keeps the predicted zone at 15% under each real path for the rest of the drive; Install Room fades
  each finished play to an 8% ghost: both are opacity rules on this same group.

---

## 10. Rendering quality and performance

### 10.1 `three/stage.js`

```js
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

export function webgl2Available() {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
}
/** CPU rasterizers run this scene at 4-6 fps: use the 2D field instead. */
export function softwareRenderer() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
    gl?.getExtension('WEBGL_lose_context')?.loseContext();          // free the probe context right away
    return /swiftshader|llvmpipe|software|basic render/i.test(name) ? name : null;
  } catch { return null; }
}

export const TIERS = [
  { name: 'high', maxDpr: 2, bloom: true, shadows: true },
  { name: 'medium', maxDpr: 1.5, bloom: true, shadows: false },
  { name: 'low', maxDpr: 1, bloom: false, shadows: false },
];
const MAX_PIXELS = 3840 * 2160;                                        // never more than a 4K frame

export function createStage(container, { tier = 0, preserveDrawingBuffer = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, outputBufferType: THREE.HalfFloatType,
    powerPreference: 'high-performance', preserveDrawingBuffer });
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;                               // static casters; set needsUpdate when they change
  renderer.info.autoReset = false;                                     // effects render internally; count whole frames
  renderer.domElement.style.display = 'block';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(24, 16 / 9, 0.5, 900);
  const labels = new CSS2DRenderer();
  Object.assign(labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  container.appendChild(labels.domElement);

  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.5, 1.05);   // only HDR > 1.0 blooms
  const state = { tier, frames: 0, needsFrames: 0, running: false, contextLost: false, updaters: new Set(), onResize: new Set() };
  const timer = new THREE.Timer();
  timer.connect(document);
  const extraViews = [];                                               // picture-in-picture: { camera, rect }

  function applyTier(i) {
    state.tier = Math.max(0, Math.min(TIERS.length - 1, i));
    renderer.setEffects(TIERS[state.tier].bloom ? [bloom] : null);
    renderer.shadowMap.enabled = TIERS[state.tier].shadows;
    resize();
  }
  function resize() {
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, TIERS[state.tier].maxDpr, Math.sqrt(MAX_PIXELS / (w * h)));
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, true);                                     // also resizes the HDR target and the effects
    labels.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    for (const fn of state.onResize) fn(w, h);
    invalidate();
  }
  function draw() {
    renderer.info.reset();
    renderer.render(scene, camera);
    if (extraViews.length) {                                          // e.g. Cut-Up's EZ inset
      const size = renderer.getSize(new THREE.Vector2());
      renderer.setScissorTest(true);
      for (const v of extraViews) { renderer.setViewport(...v.rect); renderer.setScissor(...v.rect); renderer.render(scene, v.camera); }
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, size.x, size.y);
    }
    labels.render(scene, camera);
  }
  function frame(time) {                                              // render on demand
    timer.update(time);
    const dt = Math.min(timer.getDelta(), 1 / 20);
    let busy = false;
    for (const u of state.updaters) busy = u(dt, timer.getElapsed()) || busy;
    if (state.contextLost) return;
    draw();
    state.frames++;
    if (busy) state.needsFrames = Math.max(state.needsFrames, 2);
    if (--state.needsFrames <= 0) { renderer.setAnimationLoop(null); state.running = false; }
  }
  function invalidate(frames = 2) {
    state.needsFrames = Math.max(state.needsFrames, frames);
    if (!state.running && !state.contextLost) { state.running = true; timer.reset(); renderer.setAnimationLoop(frame); }
  }
  function renderNow() { for (const u of state.updaters) u(0, timer.getElapsed()); draw(); state.frames++; }   // tests

  renderer.domElement.addEventListener('webglcontextlost', () => {   // three.js already calls preventDefault()
    state.contextLost = true; renderer.setAnimationLoop(null); state.running = false; container.dataset.gl = 'lost';
  });
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    state.contextLost = false; container.dataset.gl = 'ok'; renderer.shadowMap.needsUpdate = true; invalidate();
  });

  const ro = new ResizeObserver(resize);
  ro.observe(container);
  applyTier(tier);

  return {
    renderer, scene, camera, labels, bloom, state, timer, extraViews, invalidate, renderNow, resize, applyTier,
    addUpdater(fn) { state.updaters.add(fn); invalidate(); return () => state.updaters.delete(fn); },
    onResize(fn) { state.onResize.add(fn); return () => state.onResize.delete(fn); },
    warmUp() { return renderer.compileAsync(scene, camera); },        // before the first play
    dispose() {
      ro.disconnect(); renderer.setAnimationLoop(null); timer.dispose();
      scene.traverse((o) => {
        o.geometry?.dispose();
        for (const m of [].concat(o.material || [])) { for (const v of Object.values(m)) if (v?.isTexture) v.dispose(); m.dispose(); }
      });
      bloom.dispose(); renderer.dispose(); renderer.domElement.remove(); labels.domElement.remove();
    },
  };
}
```

Updaters return `true` while they still need frames (an animation, a tween, damping not yet settled, OrbitControls
inertia); everything else calls `invalidate()` on change (new data, hover, resize, texture loaded).

### 10.2 Pipeline: `setEffects` (default) or EffectComposer (when a direction needs sRGB-input passes)

Both were run on the same scene and produce the same image.

| | `outputBufferType: HalfFloatType` + `setEffects([bloom])` | `EffectComposer` |
| --- | --- | --- |
| Setup | renderer option + one call | `new EffectComposer(renderer, new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 }))`, then `RenderPass`, `UnrealBloomPass`, `OutputPass`, `SMAAPass()`; `composer.setPixelRatio(dpr)` and `composer.setSize(w, h)` on resize; render with `composer.render(dt)` |
| Anti-aliasing | 4x MSAA on the HDR target (from `antialias: true`) | MSAA only if you pass `samples`; SMAA/FXAA after OutputPass |
| Insets / scissor viewports | each `renderer.render()` goes through the HDR target and tone mapping: an inset looks like the main view (verified) | a plain `renderer.render()` for the inset skips bloom, MSAA and the composer: it looks different (verified) |
| Passes that need sRGB input (SMAA, FXAA, Cut-Up's projector look) | run before the output transform, on linear HDR: not what they're designed for | correct order is possible |

Use `setEffects` unless a direction needs an sRGB-space pass; then switch the whole stage to the composer and give
insets their own composer. Never add `OutputPass` to `setEffects` (it warns and double-converts).

### 10.3 Bloom, tone mapping and team colors

- Bloom by brightness: threshold 1.05 on linear HDR, strength 0.5, radius 0.5. Things that glow are pushed above 1:
  LOS/LTG cores (1.25x), the top ghost (1.8x), trails (1.6x vertex colors, additive), the ball glow (2.5x), bursts
  (3x), light banks (9x), ribbon boards (1.1x). Everything lit stays under 1 by exposure (4.8).
- The official layer-swap "selective bloom" example needs a second composer and material swapping; not worth it.
- Neutral tone mapping keeps ESPN colors; but dark primaries still vanish at night (DAL navy, contrast 1.36 against
  the night background) and TB red matches turf luminance. Rule from the contract: light core, team color as glow
  or fill. For any color used as an emissive glow, lift it until its relative luminance is at least 0.08
  (`color.lerp(white, k)`); for fills on turf, outline them in white.
- `toneMapped: false` does nothing in this pipeline (2). Keep exact brand colors in the DOM layer.

### 10.4 Anti-aliasing, DPR, tiers, software GL

- `antialias: true` with the HDR output = 4x MSAA everywhere (MSAA also smooths thin goalpost uprights and pylons).
  The turf lines don't depend on it: the shader antialiases them analytically.
- DPR: `min(devicePixelRatio, tier.maxDpr, sqrt(3840*2160 / cssPixels))`. A Retina laptop at 1440x900 renders 2x
  (5.2 MP); a 4K TV at DPR 2 is capped to 4K worth of pixels.
- Tiers: high (DPR 2, bloom, shadows), medium (1.5, bloom), low (1, none). Auto-downgrade when the p95 frame time
  over the last 60 animated frames exceeds 22 ms; never auto-upgrade during a game (avoid flapping).
- Software rasterizer detected (`softwareRenderer()` above): keep the 2D SVG field. Measured with SwiftShader at
  1440x900: p50 250 ms per frame on the high tier, 158 ms on the low tier.

### 10.5 Render on demand

The live game has 25 to 40 s between snaps; a 60 fps loop at idle heats the laptop that also drives the TV. With
the stage above, the loop starts on `invalidate()` and stops two frames after the last busy updater. Measured: **0
frames in 1.5 s** once settled, `state.running === false`. Remember to `invalidate()` after async loads (logo
texture, fonts) and on DOM-driven hover.

### 10.6 Shadows

- Static casters only (goalposts, benches, chain rods): `autoUpdate = false`, one `needsUpdate = true` after building
  and after context restore. Cost at rest: zero.
- The ball never casts a real shadow; its blob shadow is cheaper and stays readable at any height.
- A direction that wants moving cast shadows (Install Room's marker tubes) sets `needsUpdate = true` on each animated
  frame only, and accepts one extra depth pass per frame.

### 10.7 Text

| Text | Technique | Why |
| --- | --- | --- |
| Field numerals, wordmarks, "1ST & 10" on the turf | canvas textures on ground decals | they are paint: lit, occluded, perspective |
| Ghost labels, result tags ("Sack", "Touchdown", "Flag: Defensive Holding") | CSS2D | crisp at any DPR, CSS per direction, screen readers, no texture uploads |
| Down box digit | Sprite with a canvas texture | always faces the camera, occluded by the bowl |

CSS2D labels are not occluded by 3D objects and are not in `canvas.toDataURL()`: use `page.screenshot` when a test
needs them. Keep fewer than about 40 visible.

### 10.8 Memory and disposal

Everything per-play is disposed when replaced (trail geometry, FX meshes and materials, CSS2D elements via the
`removed` event). Measured after seeking through 156 plays: geometries 56 to 62, textures 26 to 28 (flat, the deltas
are the persistent ball, glow and pooled objects), DOM nodes in the container 14. Ghost sets dispose on every new
prediction. Shared textures (atlas, masks) are created once. A test asserts `renderer.info.memory` stays flat
(11.2).

### 10.9 Context loss

three.js handles `preventDefault` and re-initialization, and re-uploads geometry and textures lazily from their CPU
copies (canvas and ImageData sources survive). The stage stops its loop, sets `data-gl="lost"` for a CSS notice, and
on restore sets `shadowMap.needsUpdate` and invalidates. Verified with `forceContextLoss()` and
`forceContextRestore()`: "lost", then "ok", and the next frame has correct pixels.

### 10.10 Fallback

No WebGL2, software GL, or an exception during `mount()`: keep the existing `drawField()` SVG strip (it already
shows line of scrimmage, line to gain and ball). Log the reason once; never show a broken canvas.

### 10.11 Measured (prototype, headless Chromium via Playwright 1.60, 1440x900, DPR 1)

| Metric | ANGLE Metal (M4 Max) | SwiftShader |
| --- | --- | --- |
| Scene build (fonts loaded, all canvases) | 180 to 315 ms | 200 ms |
| `compileAsync` warm-up | 97 ms | n/a |
| Draw calls per frame (high tier, ghosts on) | 55 to 65 | same |
| Triangles | 15k to 19k | same |
| Frame time while 6 plays animate | p50 8.3 ms, p95 9.3 ms, max 10.4 ms (vsync 120 Hz) | p50 250 ms |
| Worst frame without warm-up | 108.8 ms (first trail and FX shaders compiling) | |
| Idle frames per 1.5 s | 0 | 0 |

Measure again on Sam's laptop at DPR 2 driving the TV; the FPS script is in 11.2. Headless numbers are capped by
the display's refresh rate, so they prove "no hitches", not headroom.

---

## 11. Testing

### 11.1 Pure modules with `node --test`

Everything under `static/gamecast/core/` imports nothing from three.js or the DOM, so Node 24 runs it directly as ES
modules. Arrays in, arrays out.

```
node --test 'tests/js/**/*.test.mjs'                      # Node >= 21: a glob, NOT a bare directory
node --test --experimental-test-coverage --test-coverage-include='static/gamecast/core/**' 'tests/js/**/*.test.mjs'
```

`node --test tests/js` fails on Node 24 ("Cannot find module .../tests/js"): pass a glob. The prototype suite (12
tests) runs in 40 ms; core coverage 85% lines before per-kind tests were added (target 80%+ per ECC, aim higher on
`paths.js`).

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, hashInnerZ, numberLayout, tickLayout, pylonLayout } from '../../static/gamecast/core/field-spec.js';
import { buildTimeline, sampleTrack, READ_TIME } from '../../static/gamecast/core/paths.js';
import { ghostSpecs } from '../../static/gamecast/core/ghosts.js';
import { shotPose, shotFramePoints, projectNdc } from '../../static/gamecast/core/camera-fit.js';
import { specFromRow } from '../../static/gamecast/core/row-spec.js';
const L = LEVELS.nfl;
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('NFL hashes are 70 ft 9 in from each sideline and 18 ft 6 in apart', () => {
  close(2 * hashInnerZ(L) * 3, 18.5);
});

test('numerals: bottom edge 12 yd in; arrows point to the nearer goal; the near row is turned', () => {
  const rows = numberLayout(L);
  assert.equal(rows.length, 18);
  for (const n of rows) {
    close(L.halfWidth - (Math.abs(n.z) - n.height / 2), 12);
    if (n.x === 0) assert.equal(n.arrow, null); else assert.equal(Math.sign(n.arrow.tip[0] - n.arrow.a[0]), Math.sign(n.x));
  }
  const near40 = rows.find((n) => n.x === -10 && n.side === 1);
  assert.ok(near40.digits[0].x > near40.digits[1].x);
});

test('a run ends at line + gain, on the far side when it goes left attacking right, in 2.2-4 s', () => {
  const tl = buildTimeline({ kind: 'run', losX: -15, dir: 1, snapZ: 0, gain: 7, run: { side: 'left', gap: 'tackle' } });
  const end = sampleTrack(tl.ball, tl.duration);
  close(end[0], -8, 1e-9);
  assert.ok(end[2] < 0);
  assert.ok(tl.duration >= READ_TIME.min && tl.duration <= READ_TIME.max);
});

test('a good field goal crosses the end line above the crossbar, between the uprights', () => {
  const tl = buildTimeline({ kind: 'fg', losX: 27, dir: 1, snapZ: 0, kick: { good: true } });
  const arc = tl.ball.find((s) => s.kind === 'arc');
  let p = null;
  for (let t = arc.t0; t <= arc.t1 && !p; t += 0.005) { const q = sampleTrack(tl.ball, t); if (q[0] >= 60) p = q; }
  assert.ok(p[1] > 10 / 3 && Math.abs(p[2]) < 18.5 / 6);
});

test('every framing point is inside the frame for every shot and aspect', () => {
  for (const shot of ['broadcast', 'all22', 'endzone']) for (const aspect of [16 / 9, 16 / 10, 4 / 3]) {
    const ctx = { losX: -15, dir: 1, ballZ: 0, aspect, points: [[10, 6, 4]] };
    const pose = shotPose(shot, ctx), fwd = pose.target.map((v, i) => v - pose.position[i]);
    for (const p of shotFramePoints(shot, ctx)) {
      const [x, y, z] = projectNdc(p, pose.position, fwd, { vFovDeg: pose.fov, aspect });
      assert.ok(z > 0 && Math.abs(x) <= 1.0001 && Math.abs(y) <= 1.0001);
    }
  }
});

test('contract rows: kickoff flies along kdir and ends at the return; touchback walks out', () => {
  const ko = specFromRow({ kind: 'kickoff', geo: { dir: 1, x0: 65, x_end: 30, x_next: 30 },
    kick: { kdir: -1, from_x: 65, dist: 62, land_x: 3, ret_end_x: 30 }, result: {} });
  const tl = buildTimeline(ko);
  close(sampleTrack(tl.ball, tl.duration)[0], -20, 1e-9);
});
```

Also in the prototype suite: tick and pylon counts, coordinate helpers (`aylFromSpotText('INTERCEPTED by Y.Diaby at
TB 24', 'DAL') === 76`, `sideZ`), completion catch at `losX + air` and end at `losX + gain`, `H = g t^2 / 8`, the 14
ghosts with `w` relative to the top pick and bands for throws (from the real sandbox prediction), alpha bleed. Add
one test per kind in 7.3 and one per contract example row in data-contract B2/B5 (they double as contract tests).

### 11.2 Canvas tests with Playwright

Launch: `NODE_PATH=/Users/samgoldfeder/counsel-ai-landing/spa/node_modules node script.cjs` (Playwright 1.60, Chromium
cached), or the Python Playwright the repo's `tests/e2e` already uses.

```js
const { chromium } = require('playwright');
const GPU = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];          // real GPU in headless on macOS
const SOFT = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];   // deterministic, slow
const browser = await chromium.launch({ args: GPU });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`${base}/?gl=force`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__gc?.ready);       // the app sets this after build + warmUp
```

The page exposes a small test hook (only behind `?gl=force` or a debug flag): `window.__gc = { ready, stage, rig,
anim, ghosts, frames: () => stage.state.frames, seekRow(i, t), snapshot() }`.

| Check | How | Verified result |
| --- | --- | --- |
| No console errors, right backend | collect `pageerror`/console errors; read `UNMASKED_RENDERER_WEBGL` | `[]`; "ANGLE Metal Renderer: Apple M4 Max" / "SwiftShader" |
| Pixels without `preserveDrawingBuffer` | in one `evaluate`: `stage.renderNow(); return canvas.toDataURL()` (same task, buffer not yet cleared) | 1.58 MB PNG |
| Pixel probe | project a world point (`new Vector3(losX, 0, 8).project(camera)`), decode the PNG in a 2D canvas, read RGB | LOS blue (64, 124, 245) |
| Render on demand | `frames()` now and 1.5 s later after settling | 0 new frames, `running === false` |
| DOM to 3D hover | `page.hover('.leaf[data-leaf="pa_short"]')`, read `.gc-ghost.on` | "PA short (0-9) 14%" |
| 3D to DOM hover | project a point of the `run_inside` pick tube, `page.mouse.move` there, read `.leaf.hot` | `run_inside` |
| Context loss | `renderer.forceContextLoss()`, wait, `forceContextRestore()`, probe pixels | `data-gl` "lost" then "ok", correct pixels |
| Leak | seek through every row three times, compare `renderer.info.memory` | flat (56 to 62 geometries over 156 plays) |
| Play poses | `seekRow(i, fraction)` then `page.screenshot` (includes CSS2D labels) | kinds and event times returned for each seek |
| Frame times | enqueue 6 plays, record rAF timestamps for 6 s, p50/p95/max | 8.3 / 9.3 / 10.4 ms with warm-up |

```js
const fps = await page.evaluate(async () => {
  const { anim } = window.__gc;
  for (const i of [70, 82, 76, 38, 11, 90]) anim.enqueue(window.__gc.specs[i]);
  const ts = [];
  await new Promise((done) => { const t0 = performance.now();
    const tick = (t) => { ts.push(t); t - t0 < 6000 ? requestAnimationFrame(tick) : done(); }; requestAnimationFrame(tick); });
  const d = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b), q = (k) => d[Math.floor(d.length * k)];
  return { frames: d.length, p50: q(0.5), p95: q(0.95), max: d[d.length - 1] };
});
```

Screenshots for review: seek poses rather than sleeping (`seekRow(70, 0.5)` = a 39-air-yard ball at the top of its
arc), take them at 1440x900, 1920x1080 and 390x844, and compare by eye or with loose pixel probes. Never diff whole
frames across GPUs (MSAA and dithering differ).

### 11.3 Hooking into the repo's pytest e2e

`tests/e2e/conftest.py` launches Chromium with SwiftShader flags. With the software-GL fallback, that path renders
the 2D field, which keeps the existing smoke test fast and valid. Add `test_gamecast3d.py` that opens
`/?gl=force`, waits for `window.__gc.ready`, asserts no console errors, probes one pixel of the line of scrimmage and
one of the end zone color, and runs one `seekRow` per kind. Use `pg.wait_for_function` with a 30 s timeout under
SwiftShader. The sandbox rule stands: the server fixture runs `scripts/sandbox.py` on a free port, never `app.py`
against `data/`.

---

## 12. Pitfalls (each one hit or verified while building the prototype)

1. **White paint blooms.** With key 2.3, hemi 0.9 and environment 0.35, white lines reached about 1.3 linear and
   the whole field glowed. Light the scene so white paint sits near 0.85; only emissive things exceed 1.0.
2. **`material.toneMapped = false` is ignored** in both post pipelines; the scene renders untonemapped and everything
   is tone mapped once at the end.
3. **`THREE.Line` with `linewidth`** draws 1 px on every platform and shimmers at distance. Use `Line2`, or the shader.
4. **Stacking decals with tiny y offsets** (0.01, 0.02) z-fights at broadcast distance. Coplanar meshes plus
   `polygonOffset` and `renderOrder`, `depthWrite: false`.
5. **Dark fringes on decals.** Transparent canvas pixels are black; mipmaps blend that in. Single-color paint:
   white on opaque black as `alphaMap`. Full-color logos: bleed colors into alpha-0 pixels and upload the ImageData.
6. **A canvas can't keep color at alpha 0** (premultiplied storage), so bleeding then `putImageData` loses it. Upload
   the ImageData itself with `new THREE.Texture(imageData)`.
7. **`DataTexture` defaults**: Nearest filtering, no mipmaps, `flipY = false`. It shimmered as a logo.
8. **Forgetting `colorSpace = SRGBColorSpace`** on canvas color textures washes them out; setting it on masks
   (alphaMap, halo, radial) darkens them. Color images sRGB, data linear.
9. **Canvas text before the web font loads** bakes the fallback font into the atlas for the whole session. Await
   `document.fonts.load(...)` first. Vendor the fonts for offline demos.
10. **Tainted canvas**: `crossOrigin = 'anonymous'` must be set before `src`. Prefer the same-origin logo proxy.
11. **Near-row numerals mirrored or upside down.** Tops face the nearer sideline: on TV the near row reads upside
    down and the far row upright, and the near row's digit order flips in world x. Unit-test it.
12. **Offense left/right.** Play text sides are the offense's. Attacking +x, its right is +z (toward the camera).
    `sideZ(side, dir)`; tests check both directions.
13. **`yardsToEndzone`** is wrong on home punts (data-contract A3). Always `geo.x0` from `yardLine`.
14. **Kickoff rows**: `row.team` is the receiving team; the ball travels along `kick.kdir`.
15. **`PCFSoftShadowMap`** warns and falls back in r185; use `PCFShadowMap` with `shadow.radius`.
16. **`Clock`** warns since r183; use `THREE.Timer`, `connect(document)`, and `reset()` when an on-demand loop restarts
    (or the first delta is the whole idle time).
17. **`renderer.info` shows 1 draw call** with effects unless `autoReset = false` plus a manual reset per frame.
18. **First-play hitch** (108.8 ms measured): `compileAsync` after building, and pool FX objects so their materials
    are compiled too.
19. **`setPositions`/`setColors` allocate** new buffers each call; per-frame updates write into the interleaved
    arrays and set `needsUpdate`.
20. **Dashed `LineMaterial`** shows solid until `computeLineDistances()` is called.
21. **CSS2DRenderer overwrites the element's `transform`** every frame; animate or offset an inner child.
22. **CSS2D labels are DOM**: not occluded by geometry and not in `toDataURL()`; use `page.screenshot` for them.
23. **`toDataURL()` returns a blank image** after the frame was presented unless you render and read in the same
    task (or set `preserveDrawingBuffer: true`, tests only: it costs bandwidth).
24. **Software GL** (SwiftShader, llvmpipe, WARP) is 20 to 30 times slower; detect it and use the 2D field. The repo's
    e2e browser uses SwiftShader on purpose: force 3D there only in dedicated tests.
25. **`camera.aspect` reset on resize** discards a safe-area view offset; re-apply it in an `onResize` hook after the
    stage's resize.
26. **Directions quote horizontal FOV**; `PerspectiveCamera.fov` is vertical.
27. **Camera outside the bowl**: a fitted distance past about 88 yd puts the broadcast camera behind the near
    stands; mirrored LED text showed it. Cap the distance and widen the lens; make boards FrontSide.
28. **Portrait screens**: point crowds right under the camera become squares and the field gets tiny. Switch to the
    end-zone shot and hide the crowd below aspect 1.
29. **`node --test tests/js`** fails on Node 24; pass a glob.
30. **Arrow keys belong to the app** (Watch step). Never `OrbitControls.listenToKeyEvents()`; shot keys must honor the
    "not inside an input" guard.
31. **Team colors as the only signal** disappear (DAL navy at night, TB red on turf, WCAG 1.03). Light cores, white
    outlines, glows.
32. **Ghost passes with a side** would invent precision the model doesn't have. Depth zones span the width; arcs aim
    down the middle; labels name the bucket ("Short (0-9 air yds)").
33. **Hit testing fat lines**: screen-space `Line2` raycasts need `raycaster.camera` and pixel thresholds; invisible
    tubes on their own layer are simpler and stable across DPRs.
34. **Render-on-demand forgetfulness**: anything async (logo decoded, font loaded, hover from the DOM, data arrived)
    must call `stage.invalidate()`, or the screen shows stale state until the next mouse move.
35. **Drawing whole timelines in the drive trail** makes spaghetti from the estimated drop and mesh segments; draw
    `pathPoints()` (measured segments only).
