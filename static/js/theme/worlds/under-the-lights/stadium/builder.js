// Under the Lights: a geometry builder for the bowl (owner W1). The stands, walls, fascia bodies, tower masts and
// heads are flat-shaded quads with per-vertex colors, merged into one BufferGeometry, so the whole steel and concrete
// stadium is a single draw call (ui-architecture 6.1: props at most 40). Quads are added with their four corners in
// order; the normal is taken from the corners and turned to face `toward` (a direction or a point), so winding never
// has to be tracked by hand. World units are yards (coords.toWorld: y up, the home sideline at +z).

const EPS = 1e-9;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > EPS ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0];
};

/** "#rrggbb" to linear-ish [r, g, b] in 0..1 (sRGB decoded, as three's Color.set does for vertex colors). */
export function linearRgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  const dec = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [dec((n >> 16) & 255), dec((n >> 8) & 255), dec(n & 255)];
}

/** Mix two [r, g, b] colors. */
export const mixRgb = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

/**
 * A growable list of flat-shaded, vertex-colored quads and triangles.
 * @returns {{ quad(p0, p1, p2, p3, rgb, toward): void, tri(p0, p1, p2, rgb, toward): void, count(): number,
 *   build(THREE): THREE.BufferGeometry }}
 */
export function createBuilder() {
  const pos = [];
  const nrm = [];
  const col = [];
  const idx = [];

  /** `toward`: { dir: [x, y, z] } the side the face shows, or { point: [x, y, z] } a point it faces. */
  function facing(p0, p1, p2, toward) {
    let n = norm(cross(sub(p1, p0), sub(p2, p0)));
    const want = toward?.dir ?? (toward?.point ? sub(toward.point, p0) : null);
    if (want && dot(n, want) < 0) n = [-n[0], -n[1], -n[2]];
    return n;
  }

  function push(points, rgb, n) {
    const base = pos.length / 3;
    for (const p of points) {
      pos.push(p[0], p[1], p[2]);
      nrm.push(n[0], n[1], n[2]);
      col.push(rgb[0], rgb[1], rgb[2]);
    }
    return base;
  }

  /** Two triangles whose winding agrees with the normal (three culls by winding). */
  function wind(base, ids, points, n) {
    const [a, b, c] = ids.map((i) => points[i]);
    const ccw = dot(cross(sub(b, a), sub(c, a)), n) >= 0;
    idx.push(...(ccw ? ids : [ids[0], ids[2], ids[1]]).map((i) => base + i));
  }

  return {
    quad(p0, p1, p2, p3, rgb, toward) {
      const pts = [p0, p1, p2, p3];
      const n = facing(p0, p1, p2, toward);
      const base = push(pts, rgb, n);
      wind(base, [0, 1, 2], pts, n);
      wind(base, [0, 2, 3], pts, n);
    },
    tri(p0, p1, p2, rgb, toward) {
      const pts = [p0, p1, p2];
      const n = facing(p0, p1, p2, toward);
      wind(push(pts, rgb, n), [0, 1, 2], pts, n);
    },
    count: () => pos.length / 3,
    build(THREE) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeBoundingSphere();
      return g;
    },
  };
}

/** A point on the stadium's rounded rectangle: |x/a|^4 + |z/b|^4 = 1 at parameter t (0 at +x, pi/2 at +z). */
export function ringPoint(t, a, b) {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [a * Math.sign(c) * Math.sqrt(Math.abs(c)), b * Math.sign(s) * Math.sqrt(Math.abs(s))];
}

/** Evenly spaced parameters from t0 to t1 (inclusive), `n` intervals. */
export const params = (t0, t1, n) => Array.from({ length: n + 1 }, (_, i) => t0 + ((t1 - t0) * i) / n);
