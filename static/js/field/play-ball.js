// The ball in play (A5 part 2; DESIGN.md "Plays on the field"; three-recipe 7.4): a football at 2.2x real size that
// flies the drawing's track (timing.ballAt), nose along its velocity, a spiral on passes and punts and end over end on
// kickoffs and field goals; its tracer head (the arc's light core times look.world.plays.headGlow, additive: the one
// thing on the field that blooms); a soft contact shadow under it while it is in the air; and a short trail that fades
// behind it (look.ball.trail: ribbon, comet, spark or none, in the carrier's light core). Every play starts on the
// line of scrimmage, so the ball does too. During the play's hold it slides to the next snap's spot on the center line
// (drawing.ballEnd), where the stage's resting ball takes over when the play ends.
//   createFlight(stage) -> { start(drawing, plan, { teams, env }), update(tMs) -> {x, y, h} | null, current(), hide(),
//                            dispose() }
import * as THREE from "three";
import { toWorld } from "./coords.js";
import { disposeTree } from "./dispose.js";
import { LAYERS } from "./materials.js";
import { trailStyle } from "./play-style.js";
import { stripGeometry, stripMaterial, stripMesh, writeStrip } from "./play-strip.js";
import { EASE, ballAt } from "./timing.js";

const BALL_LONG = 0.66;          // lines.js: 2.2x a real football, so it reads from the broadcast camera
const BALL_WIDE = 0.42;
const TRAIL_POINTS = 14;
const LOOK_AHEAD_MS = 24;
const SPIN_PER_MS = Object.freeze({ pass: 0.035, punt: 0.03, kickoff: 0.02, fg: 0.02 });
const TUMBLE = new Set(["kickoff", "fg"]);
const SHADOW = Object.freeze({ w: 1.5, d: 1.0, base: 0.5, floor: 0.18, grow: 0.09, fade: 0.12, minH: 0.25 });
const HEAD_ON_GROUND = 0.55;     // the head's strength while the ball is carried on the turf
const HEAD_FULL_H = 2;
const TRAIL_OPACITY = 0.85;
const SPARK_DASH = Object.freeze([0.15, 0.45]);
const COMET = 1.5;

const clamp01 = (u) => Math.min(1, Math.max(0, u));
const lerp = (a, b, k) => a + (b - a) * k;

function football(look, kit) {
  const s = look.ball.scale;
  const { body, accent } = kit.ball();
  const group = new THREE.Group();
  group.name = "ball-in-play";
  if (look.ball.kind === "football") {
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 12).scale(BALL_WIDE * s, BALL_WIDE * s,
      BALL_LONG * s), body);
    const laces = new THREE.Mesh(new THREE.BoxGeometry(0.05 * s, 0.03 * s, 0.2 * s), accent);
    laces.position.y = (BALL_WIDE / 2) * s;
    shell.castShadow = true;
    group.add(shell, laces);
    group.userData.rest = (BALL_WIDE / 2) * s;
  } else {
    const r = look.ball.kind === "dot" ? 0.35 * s : 0.5 * s;
    group.add(new THREE.Mesh(look.ball.kind === "dot" ? new THREE.SphereGeometry(r, 20, 10)
      : new THREE.CylinderGeometry(r, r, 0.15 * s, 28), body));
    group.userData.rest = look.ball.kind === "dot" ? r : 0.075 * s;
  }
  return group;
}

function headSprite(kit, color, size) {
  const material = new THREE.SpriteMaterial({ map: kit.texture("radial"), color, blending: THREE.AdditiveBlending,
    transparent: true, depthWrite: false, fog: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(size, size, 1);
  sprite.renderOrder = LAYERS.glow.order;
  return sprite;
}

function contactShadow(kit) {
  const material = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: kit.texture("radial"), transparent: true,
    opacity: SHADOW.base, depthWrite: false, fog: false, polygonOffset: true,
    polygonOffsetFactor: LAYERS.shadow.factor, polygonOffsetUnits: LAYERS.shadow.units });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(SHADOW.w, SHADOW.d).rotateX(-Math.PI / 2), material);
  mesh.renderOrder = LAYERS.shadow.order + 0.5;
  return mesh;
}

function trailOf(spec) {
  const points = Array.from({ length: TRAIL_POINTS }, () => ({ x: 0, y: 0, h: 0 }));
  const material = stripMaterial({ color: spec.color, opacity: TRAIL_OPACITY, units: "px",
    width: spec.widthPx * (spec.kind === "comet" ? COMET : 1), dash: spec.kind === "spark" ? SPARK_DASH : null,
    additive: true });
  return stripMesh(stripGeometry([{ points }]), material, LAYERS.trail.order);
}

// The functions below share one flight context `f` = { stage, root, ball, head, shadow, trail, st }.
/** The ball, its head and its contact shadow, built once per flight (the look's ball and the world's head glow). */
function build(f, env) {
  const { stage } = f;
  const look = stage.look;
  f.ball = football(look, stage.kit);
  const plays = env?.plays;
  const core = new THREE.Color(look.strokes.arc.core).multiplyScalar(plays?.headGlow ?? 2.5);
  f.head = headSprite(stage.kit, core, plays?.headYd ?? 1.3);
  f.shadow = contactShadow(stage.kit);
  f.root.add(f.ball, f.head, f.shadow);
}

function orient(f, pos, t) {
  const { drawing, plan } = f.st;
  const ahead = ballAt(drawing, plan, Math.min(plan.totalMs, t + LOOK_AHEAD_MS));
  const behind = ballAt(drawing, plan, Math.max(0, t - LOOK_AHEAD_MS));
  const [a, b] = ahead && Math.hypot(ahead.x - pos.x, ahead.y - pos.y, ahead.h - pos.h) > 1e-4 ? [pos, ahead]
    : [behind ?? pos, pos];
  const from = toWorld(a.x, a.y, a.h);
  const to = toWorld(b.x, b.y, b.h);
  const dir = new THREE.Vector3(to.x - from.x, to.y - from.y, to.z - from.z);
  if (dir.lengthSq() < 1e-8) return;
  f.ball.lookAt(f.ball.position.clone().add(dir));
  const role = drawing.steps[f.st.index]?.role;
  const spin = (SPIN_PER_MS[role] ?? 0) * t;
  if (TUMBLE.has(role)) f.ball.rotateX(spin);
  else f.ball.rotateZ(spin);
}

/** Where the ball is at t: on its track, then (the hold) sliding to the next snap's spot. */
function positionAt(f, t) {
  const { drawing, plan } = f.st;
  const b = ballAt(drawing, plan, t);
  if (!b) return null;
  f.st.index = Math.max(0, b.index);
  const lastEnd = plan.steps.at(-1)?.endMs ?? 0;
  const end = drawing.ballEnd;
  if (!end || t <= lastEnd || plan.totalMs <= lastEnd) return { x: b.x, y: b.y, h: b.h, settle: 0 };
  const u = EASE.inOutCubic(clamp01((t - lastEnd) / (plan.totalMs - lastEnd)));
  return { x: lerp(b.x, end.x, u), y: lerp(b.y, end.y, u), h: b.h * (1 - u), settle: u };
}

function placeTrail(f, t) {
  const { drawing, plan, spec } = f.st;
  if (!f.trail) return;
  const back = (k) => Math.max(0, t - (spec.fadeMs * (TRAIL_POINTS - 1 - k)) / (TRAIL_POINTS - 1));
  const pts = Array.from({ length: TRAIL_POINTS }, (_, k) => ballAt(drawing, plan, back(k)));
  if (pts.some((p) => !p)) {
    f.trail.visible = false;
    return;
  }
  const alphas = pts.map((_, k) => (k / (TRAIL_POINTS - 1)) ** 1.5);
  writeStrip(f.trail.geometry, pts.map((p) => ({ x: p.x, y: p.y, h: p.h + f.ball.userData.rest })), alphas);
  const team = f.st.teams[f.st.index];
  if (team !== f.st.trailTeam) {                 // the carrier changed (a kick's return, an interception)
    f.st.trailTeam = team;
    f.trail.material.uniforms.uColor.value.set(trailStyle(f.stage.look, f.st.env?.paint?.(team) ?? null).color);
  }
  f.trail.visible = pts.some((p, k) => k > 0 && Math.hypot(p.x - pts[0].x, p.y - pts[0].y, p.h - pts[0].h) > 0.05);
}

function place(f, pos, t) {
  const rest = f.ball.userData.rest;
  const w = toWorld(pos.x, pos.y, pos.h + rest);
  f.ball.position.set(w.x, w.y, w.z);
  f.ball.visible = true;
  orient(f, pos, t);
  f.head.position.copy(f.ball.position);
  f.head.material.opacity = (1 - pos.settle) * lerp(HEAD_ON_GROUND, 1, clamp01(pos.h / HEAD_FULL_H));
  f.head.visible = f.head.material.opacity > 0.01;
  const g = toWorld(pos.x, pos.y, 0);
  f.shadow.position.set(g.x, g.y, g.z);
  f.shadow.scale.setScalar(1 + pos.h * SHADOW.grow);
  f.shadow.material.opacity = Math.max(SHADOW.floor, SHADOW.base / (1 + pos.h * SHADOW.fade));
  f.shadow.visible = pos.h > SHADOW.minH;
  placeTrail(f, t);
}

function hide(f) {
  for (const o of [f.ball, f.head, f.shadow, f.trail]) if (o) o.visible = false;
  f.st.pos = null;
}

/**
 * The ball of one play at a time. `start` takes the drawing, its plan (timing.fitPlan), the team on each step
 * (play-style.carriersOf, for the trail's color) and the layer's env ({ paint, plays }).
 */
export function createFlight(stage) {
  const root = new THREE.Group();
  root.name = "flight";
  stage.roots.plays.add(root);
  const f = { stage, root, ball: null, head: null, shadow: null, trail: null, st: { pos: null, teams: [], index: 0 } };
  return {
    start(drawing, plan, { teams = [], env = null } = {}) {
      if (!f.ball) build(f, env);
      if (f.trail) disposeTree(f.trail);
      const spec = trailStyle(stage.look, env?.paint?.(teams[0]) ?? null);
      f.trail = spec.kind === "none" || !(spec.fadeMs > 0) || !(spec.widthPx > 0) ? null : trailOf(spec);
      if (f.trail) root.add(f.trail);
      f.st = { drawing, plan, teams, env, spec, index: 0, pos: null, trailTeam: teams[0] };
      hide(f);
    },
    update(tMs) {
      if (!f.st.plan) return null;
      const t = Math.min(f.st.plan.totalMs, Math.max(0, tMs));
      const pos = positionAt(f, t);
      if (!pos) {
        hide(f);
        return null;
      }
      place(f, pos, t);
      f.st.pos = { x: pos.x, y: pos.y, h: pos.h };
      return f.st.pos;
    },
    current: () => f.st.pos,
    hide: () => hide(f),
    dispose() {
      hide(f);
      disposeTree(root);
    },
  };
}
