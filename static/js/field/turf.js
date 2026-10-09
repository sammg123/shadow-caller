// The turf: grass, mow stripes, end zones and every painted line in one shader (three-recipe 4.3; owner A5).
// A MeshStandardMaterial whose albedo (<map_fragment>) is computed per pixel, so lights, shadows, fog and tone
// mapping all still apply and the paint is lit exactly like the grass. Lines are drawn at least one pixel wide and
// fade by their true coverage (after Ben Golus), so they stay crisp at every zoom and never shimmer at 80 yards.
// World space: the caller's goal line at x = -50, the near sideline at z = +26.667 (DC A5). Fog (the world's haze
// for the stands) never touches the field: it fades in only on the apron far beyond the border.
import * as THREE from "three";
import { hashInnerZ } from "./field-spec.js";

const GLSL = /* glsl */`
varying vec3 vWorldP;
float scFogMask = 1.0;
uniform vec3 uGrassA, uGrassB, uPaint, uEndL, uEndR, uApron, uYellow;
uniform float uHalfW, uGoalX, uEndX, uBorder, uLineW, uGoalW, uHashZ, uHashLen, uRestrainZ, uCoachZ;
uniform float uStripe, uStripeYd, uPaintOpacity, uHashes, uGrain, uPatX;

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float lineAA(float d, float h, float fw) {
  float drawH = max(h, fw * 0.5);
  float cov = 1.0 - smoothstep(drawH - fw * 0.5, drawH + fw * 0.5, d);
  return cov * clamp(h / drawH, 0.0, 1.0);
}
float spanAA(float x, float a, float b, float fw) { return clamp(min(x - a, b - x) / max(fw, 1e-4) + 0.5, 0.0, 1.0); }
float nearestDist(float x, float period) { return abs(x - period * floor(x / period + 0.5)); }

vec3 grassOf(vec2 p, vec3 V, float fwx, out float n, out float sheen) {
  float band = floor((p.x + 50.0) / uStripeYd);
  float lean = mod(band, 2.0) < 1.0 ? 1.0 : -1.0;
  float inPlay = spanAA(p.x, -uEndX, uEndX, fwx) * spanAA(abs(p.y), -1.0, uHalfW, fwx);
  sheen = lean * (0.35 + 0.65 * clamp(V.z, 0.0, 1.0)) * inPlay;
  n = vnoise(p * 0.9) * 0.6 + vnoise(p * 0.21) * 0.4;
  float near = 1.0 - smoothstep(0.03, 0.22, fwx);                          // detail fades before it aliases
  float fine = (vnoise(p * 4.3) - 0.5) * near + (vnoise(p * 17.0) - 0.5) * near * near * 0.6;
  vec3 grass = mix(uGrassA, uGrassB, 0.5 + 0.5 * sheen * uStripe);
  grass *= 0.95 + 0.1 * n + (0.06 + 0.1 * uGrain) * fine;
  float between = 1.0 - smoothstep(uHashZ - 1.0, uHashZ + 2.0, abs(p.y));   // play wears the turf between the hashes
  float wear = uGrain * between * spanAA(abs(p.x), -1.0, uGoalX - 3.0, fwx) * (0.4 + 0.6 * vnoise(p * 0.35));
  return mix(grass, grass * vec3(1.16, 1.08, 0.82), wear * 0.35);
}

float paintOf(vec2 p, float ax, float az, float fwx, float fwz) {
  float fieldZ = spanAA(az, -1.0, uHalfW, fwz);
  float paint = lineAA(nearestDist(p.x, 5.0), uLineW * 0.5, fwx) * fieldZ * step(ax, uGoalX - 1.0);   // yard lines
  paint = max(paint, spanAA(ax, uGoalX, uGoalX + uGoalW, fwx) * fieldZ);                            // goal lines
  float tick = lineAA(nearestDist(p.x, 1.0), uLineW * 0.5, fwx) * (1.0 - step(nearestDist(p.x, 5.0), 0.5))
    * step(ax, uGoalX - 0.5) * uHashes;
  paint = max(paint, tick * spanAA(az, uHashZ, uHashZ + uHashLen, fwz));                            // inbounds marks
  paint = max(paint, tick * spanAA(az, uHalfW - uHashLen, uHalfW, fwz));                            // sideline marks
  float cross = lineAA(abs(az - (uHashZ + uHashLen * 0.5)), uLineW * 0.5, fwz)
    * spanAA(nearestDist(p.x, 5.0), -1.0, uHashLen * 0.5, fwx) * uHashes;
  paint = max(paint, cross * step(ax, uGoalX - 1.0));                                               // the 5-yd crosses
  paint = max(paint, lineAA(abs(ax - uPatX), uLineW * 0.5, fwx) * spanAA(abs(p.y), -1.0, 0.5, fwz)); // PAT marks
  float outside = max(spanAA(az, uHalfW, uHalfW + uBorder, fwz) * spanAA(ax, -1.0, uEndX + uBorder, fwx),
                      spanAA(ax, uEndX, uEndX + uBorder, fwx) * spanAA(az, -1.0, uHalfW + uBorder, fwz));
  return max(paint, outside);                                                                       // the border
}

vec3 turfAlbedo(vec3 wp, vec3 V) {
  vec2 p = wp.xz;
  float ax = abs(p.x), az = abs(p.y);
  float fwx = max(fwidth(p.x), 1e-4), fwz = max(fwidth(p.y), 1e-4);
  float n, sheen;
  vec3 col = grassOf(p, V, fwx, n, sheen);
  float ez = spanAA(ax, uGoalX, uEndX, fwx) * spanAA(az, -1.0, uHalfW, fwz);
  col = mix(col, (p.x < 0.0 ? uEndL : uEndR) * (0.93 + 0.1 * n), ez);
  float inBounds = spanAA(az, -1.0, uHalfW + uBorder, fwz) * spanAA(ax, -1.0, uEndX + uBorder, fwx);
  col = mix(uApron * (0.88 + 0.2 * n), col, inBounds);
  float paint = paintOf(p, ax, az, fwx, fwz) * uPaintOpacity;
  col = mix(col, uPaint * (0.96 + 0.06 * n), paint);
  float dash = step(fract(p.x), 0.6667);                                                             // 2 ft dash, 1 ft gap
  float yel = lineAA(abs(az - uRestrainZ), 0.111, fwz) * spanAA(ax, -1.0, uEndX, fwx) * dash;
  yel = max(yel, lineAA(abs(az - uCoachZ), 0.111, fwz) * spanAA(ax, -1.0, 18.0, fwx));
  col = mix(col, uYellow, yel * uHashes * uPaintOpacity);
  scFogMask = smoothstep(uHalfW + uBorder + 4.0, uHalfW + uBorder + 24.0, max(az, ax - (uEndX - uHalfW)));
  return col * (1.0 + sheen * 0.04 * paint);
}
`;

/** three's fog chunk, scaled by scFogMask: the field and its apron stay clear, the far apron fades into haze. */
const FOG_BEYOND_FIELD = /* glsl */`
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor * scFogMask);
#endif
`;

const YELLOW = "#f2c230";
const STRIPE_CONTRAST = 0.9;

/**
 * The turf material for a resolved Look and a field spec `L` (field-spec.js NFL), end zones in `endZones`
 * ({ left, right } #rrggbb, the defending teams' exact primaries, or the look's turf when neutral).
 * @returns {{ material: THREE.MeshStandardMaterial, uniforms: object, setEndZones(left, right): void, dispose(): void }}
 */
export function createTurf(look, L, endZones) {
  const f = look.field;
  const uniforms = {
    uGrassA: { value: new THREE.Color(f.turf[0]) }, uGrassB: { value: new THREE.Color(f.turf[1]) },
    uPaint: { value: new THREE.Color(f.paint) }, uApron: { value: new THREE.Color(f.surround) },
    uEndL: { value: new THREE.Color(endZones?.left ?? f.turf[0]) },
    uEndR: { value: new THREE.Color(endZones?.right ?? f.turf[0]) },
    uYellow: { value: new THREE.Color(YELLOW) },
    uHalfW: { value: L.halfWidth }, uGoalX: { value: L.goalX }, uEndX: { value: L.endLineX }, uBorder: { value: L.border },
    uLineW: { value: L.lineWidth }, uGoalW: { value: L.goalLineWidth }, uHashZ: { value: hashInnerZ(L) },
    uHashLen: { value: L.hashLength }, uRestrainZ: { value: L.halfWidth + L.border + L.restrainingGap },
    uCoachZ: { value: L.halfWidth + L.border + L.coachLineGap }, uPatX: { value: L.patX },
    uStripe: { value: STRIPE_CONTRAST }, uStripeYd: { value: f.stripeYd }, uPaintOpacity: { value: f.paintOpacity },
    uHashes: { value: f.hashes ? 1 : 0 }, uGrain: { value: f.grain },
  };
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: f.roughness, metalness: f.metalness });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);              // the same objects: later .value changes are live
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorldP;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${GLSL}`)
      .replace("#include <map_fragment>", "diffuseColor.rgb = turfAlbedo(vWorldP, normalize(cameraPosition - vWorldP));")
      .replace("#include <fog_fragment>", FOG_BEYOND_FIELD);
  };
  material.customProgramCacheKey = () => "sc-turf-v1";
  return {
    material, uniforms,
    setEndZones(left, right) {
      uniforms.uEndL.value.set(left);
      uniforms.uEndR.value.set(right);
    },
    dispose: () => material.dispose(),
  };
}

/** The turf plane: the field, its border and the apron out to `size` ([width, depth] in yards), lying flat. */
export function turfGeometry([width, depth]) {
  return new THREE.PlaneGeometry(width, depth, 1, 1).rotateX(-Math.PI / 2);
}
