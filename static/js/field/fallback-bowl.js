/**
 * The stadium around the 2D field (DESIGN.md: the fallback "is the same world seen from straight above"; owner A6).
 * Drawn only when the look lights the field with tower spot lights, which is what a stadium rig declares, so the
 * neutral look stays a plain field while a night world gets its bowl: three tiers of stands rising away from the
 * field (each ring lifted by its height through the same tilt as kick arcs, so the far stands climb and the near ones
 * loom), a seeded crowd tinted by both teams, a tower at each spot light with its lamp bank and glow (the one place a
 * glow belongs: a fixture), and the light pooling on the turf and falling off toward the corners. Pure.
 */
import { mixHex } from "../theme/team-colors.js";
import { FIELD } from "./coords.js";
import { APRON_YD, r2, node, paintOf } from "./fallback-draw.js";

const CENTER = Object.freeze({ x: FIELD.MIDFIELD_X, y: FIELD.CENTER_Y });
const BOWL = Object.freeze({ a0: 72, b0: 40, depthA: 34, depthB: 32, rise: 22, n: 4, samples: 120 });
/** [r0, r1, light (+ toward the light, - toward the night), crowd opacity] per tier, lower bowl first. */
const TIERS = Object.freeze([[0, 0.36, 0.1, 0.5], [0.42, 0.68, 0, 0.38], [0.74, 1, -0.3, 0.28]]);
const ROW_YD = 2;
const TOWER = Object.freeze({ lampW: 6, lampH: 1.8, glowYd: 10, mast: 1.5 });
const CROWD = Object.freeze({ cellYd: 0.5, cols: 9, rows: 9, lit: 0.75, dotYd: 0.3, mute: 0.35 });
const SEED_MOD = 2147483647;

/** A small seeded generator (the crowd must look the same on every draw; pure modules never call Math.random). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `samples` points of |x/a|^n + |y/b|^n = 1, counterclockwise from (a, 0). */
export function superellipse(a, b, n, samples) {
  return Array.from({ length: samples }, (_, k) => {
    const th = (2 * Math.PI * k) / samples;
    const [c, s] = [Math.cos(th), Math.sin(th)];
    return { x: a * Math.sign(c) * Math.abs(c) ** (2 / n), y: b * Math.sign(s) * Math.abs(s) ** (2 / n) };
  });
}

const spotsOf = (look) => look.lights.filter((l) => l.kind === "spot" && Array.isArray(l.position));

function loop(ctx, r, reverse = false) {
  const pts = superellipse(BOWL.a0 + r * BOWL.depthA, BOWL.b0 + r * BOWL.depthB, BOWL.n, BOWL.samples)
    .map((p) => ctx.pt(CENTER.x + p.x, CENTER.y + p.y, r * BOWL.rise));
  return `${(reverse ? pts.reverse() : pts).map((p, i) => `${i ? "L" : "M"}${r2(p.px)} ${r2(p.py)}`).join("")}Z`;
}

function tonesOf(ctx, spots) {
  const env = ctx.look.environment;
  const bg = env.background ?? ctx.look.renderer.clear;
  const haze = env.fog?.color ?? ctx.look.field.surround;
  return { bg, haze, light: spots[0].color, base: mixHex(bg, haze, 0.55) };
}

const tierTone = (t, k) => (k >= 0 ? mixHex(t.base, t.light, k) : mixHex(t.base, t.bg, -k));

function seedOf(ctx) {
  const text = `${ctx.paints.left ?? ""}:${ctx.paints.right ?? ""}`;
  return [...text].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % SEED_MOD, 7);
}

function palette(ctx, t) {
  const shades = (hex) => [0.3, 0.5, 0.15].map((k) => mixHex(mixHex(hex, t.light, k), t.base, CROWD.mute));
  const home = shades(paintOf(ctx, ctx.paints.left).fill);
  const away = shades(paintOf(ctx, ctx.paints.right).fill);
  return [...home, ...home, ...away, mixHex(t.base, t.light, 0.35), mixHex(t.base, t.light, 0.2)];
}

function crowdPattern(ctx, t) {
  const rand = mulberry32(seedOf(ctx));
  const colors = palette(ctx, t);
  const cell = CROWD.cellYd * ctx.layout.px;
  const dot = r2(Math.max(1.2, CROWD.dotYd * ctx.layout.px));
  const dots = [];
  for (let r = 0; r < CROWD.rows; r += 1) {
    for (let c = 0; c < CROWD.cols; c += 1) {
      const lit = rand() < CROWD.lit;
      const color = colors[Math.floor(rand() * colors.length)];
      const jitter = (rand() - 0.5) * cell * 0.3;
      if (lit) {
        dots.push(node("rect", { x: r2(c * cell + (cell - dot) / 2 + jitter), y: r2(r * cell + (cell - dot) / 2),
          width: dot, height: dot, fill: color }));
      }
    }
  }
  const size = r2(CROWD.cols * cell);
  return node("pattern", { id: `${ctx.ids}-crowd`, width: size, height: size, patternUnits: "userSpaceOnUse" }, dots);
}

function glowDef(ctx, t) {
  return node("radialGradient", { id: `${ctx.ids}-glow` }, [
    node("stop", { offset: "0", "stop-color": t.light, "stop-opacity": 0.6 }),
    node("stop", { offset: "0.35", "stop-color": t.light, "stop-opacity": 0.18 }),
    node("stop", { offset: "1", "stop-color": t.light, "stop-opacity": 0 }),
  ]);
}

function stands(ctx, t) {
  return TIERS.flatMap(([r0, r1, k, crowd], i) => {
    const d = loop(ctx, r1) + loop(ctx, r0, true);
    const tone = tierTone(t, k);
    const rows = [];
    for (let r = r0 + ROW_YD / BOWL.depthA; r < r1 - 1e-6; r += ROW_YD / BOWL.depthA) rows.push(loop(ctx, r));
    return [
      node("path", { d, fill: tone, "fill-rule": "evenodd", "data-part": "stand", "data-tier": i + 1 }),
      node("path", { d, fill: `url(#${ctx.ids}-crowd)`, "fill-rule": "evenodd", "fill-opacity": crowd }),
      node("path", { d: rows.join(""), fill: "none", stroke: mixHex(tone, "#000000", 0.4), "stroke-width": 1,
        "stroke-opacity": 0.55 }),
    ];
  });
}

function fascia(ctx, t) {
  const d = TIERS.slice(1).map(([r0]) => loop(ctx, r0)).join("");
  return [
    node("path", { d, fill: "none", stroke: mixHex(t.bg, "#000000", 0.45),
      "stroke-width": r2(Math.max(2, ctx.yd(0.9))) }),
    node("path", { d, fill: "none", stroke: t.light, "stroke-opacity": 0.55, "stroke-width": 1,
      "stroke-dasharray": "1 3" }),
  ];
}

function towerNode(ctx, light, t) {
  const [x, y, h] = light.position;
  const base = ctx.pt(x, y);
  const lamp = ctx.pt(x, y, h);
  const [tx, ty] = Array.isArray(light.target) ? light.target : [CENTER.x, CENTER.y];
  const aim = ctx.pt(tx, ty);
  const angle = r2((Math.atan2(aim.py - lamp.py, aim.px - lamp.px) * 180) / Math.PI + 90);
  const [w, hh] = [ctx.yd(TOWER.lampW), ctx.yd(TOWER.lampH)];
  const glow = r2(ctx.yd(TOWER.glowYd));
  return node("g", { "data-part": "tower", "data-light": light.id }, [
    node("path", { d: `M${r2(base.px)} ${r2(base.py)}L${r2(lamp.px)} ${r2(lamp.py)}`,
      stroke: mixHex(t.haze, t.light, 0.25), "stroke-width": TOWER.mast }),
    node("circle", { cx: r2(lamp.px), cy: r2(lamp.py), r: glow, fill: `url(#${ctx.ids}-glow)` }),
    node("rect", { x: r2(lamp.px - w / 2), y: r2(lamp.py - hh / 2), width: r2(w), height: r2(hh), rx: 1, fill: t.light,
      transform: `rotate(${angle} ${r2(lamp.px)} ${r2(lamp.py)})` }),
  ]);
}

function lightOver(ctx, t, count) {
  const pad = ctx.yd(APRON_YD);
  const { rect } = ctx.layout;
  const k = Math.min(1, count / 4);
  const pool = node("radialGradient", { id: `${ctx.ids}-pool`, cx: "0.5", cy: "0.5", r: "0.62" }, [
    node("stop", { offset: "0", "stop-color": t.light, "stop-opacity": r2(0.13 * k) }),
    node("stop", { offset: "0.5", "stop-color": t.light, "stop-opacity": r2(0.05 * k) }),
    node("stop", { offset: "0.8", "stop-color": t.bg, "stop-opacity": 0 }),
    node("stop", { offset: "1", "stop-color": t.bg, "stop-opacity": 0.42 }),
  ]);
  return [node("defs", {}, [pool]), node("rect", { x: r2(rect.x - pad), y: r2(rect.y - pad), width: r2(rect.w + 2 * pad),
    height: r2(rect.h + 2 * pad), fill: `url(#${ctx.ids}-pool)`, "pointer-events": "none", "data-part": "light" })];
}

/**
 * { under, over }: `under` goes beneath the field (defs, the floor, the stands, the fascia, the towers), `over`
 * above it (the light). Both are empty for a look without tower spot lights.
 */
export function bowlNodes(ctx) {
  const spots = spotsOf(ctx.look);
  if (!spots.length) return { under: [], over: [] };
  const t = tonesOf(ctx, spots);
  return {
    under: [
      node("defs", {}, [crowdPattern(ctx, t), glowDef(ctx, t)]),
      node("path", { d: loop(ctx, 0), fill: ctx.look.field.surround, "data-part": "floor" }),
      ...stands(ctx, t), ...fascia(ctx, t), ...spots.map((light) => towerNode(ctx, light, t)),
    ],
    over: lightOver(ctx, t, spots.length),
  };
}
