// The situation painted on the field (ui-architecture 2.5 showSituation; DESIGN.md "The lines"; three-recipe 5.1,
// 5.4; owner A5): the line of scrimmage and the line to gain as strips of paint from sideline to sideline, coplanar
// with the turf (polygon offset, never a y lift), so the ball and the posts occlude them like the real thing; the
// ball at rest on the line, mid-field (ESPN gives no hash), inside a white ring, with a soft contact shadow. The
// line to gain hides on goal to go; a kickoff shows only the ball, standing on its tee. Between snaps everything
// glides to the new spot (step(dtMs) returns true while it moves). The materials come from the kit (shared).
import * as THREE from "three";
import { FIELD } from "./coords.js";
import { LAYERS } from "./materials.js";

const GLIDE = 9;                 // per second: about half a second from snap to snap
const SETTLED = 1e-3;
const BALL_LONG = 0.66;          // a football at 2.2x real size reads from the broadcast camera (recipe 7.4)
const BALL_WIDE = 0.42;
const RING = Object.freeze({ inner: 0.78, outer: 0.98 });
const TEE_H = 0.08;
const SHADOW = Object.freeze({ w: 1.5, d: 1.0, opacity: 0.42 });

function strip(widthYd, material) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(widthYd, FIELD.WIDTH).rotateX(-Math.PI / 2), material);
  mesh.renderOrder = LAYERS.line.order;
  mesh.visible = false;
  mesh.userData.width = widthYd;
  return mesh;
}

function flatOnTurf(geometry, material, layer) {
  const mesh = new THREE.Mesh(geometry.rotateX(-Math.PI / 2), material);
  mesh.renderOrder = layer.order;
  mesh.visible = false;
  return mesh;
}

/** The ball at rest: a football (laces up, long axis down the field), a dot or a puck, per look.ball. */
function restingBall(look, kit) {
  const s = look.ball.scale;
  const { body, accent } = kit.ball();
  const group = new THREE.Group();
  group.name = "ball-at-rest";
  if (look.ball.kind === "football") {
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 16).scale(BALL_WIDE * s, BALL_WIDE * s, BALL_LONG * s)
      .rotateY(Math.PI / 2), body);
    const laces = new THREE.Mesh(new THREE.BoxGeometry(0.2 * s, 0.03 * s, 0.05 * s), accent);
    laces.position.y = (BALL_WIDE / 2) * s;
    shell.castShadow = true;
    group.add(shell, laces);
    group.userData.rest = (BALL_WIDE / 2) * s;
  } else {
    const geometry = look.ball.kind === "dot" ? new THREE.SphereGeometry(0.35 * s, 24, 12)
      : new THREE.CylinderGeometry(0.5 * s, 0.5 * s, 0.15 * s, 32);
    group.add(new THREE.Mesh(geometry, body));
    group.userData.rest = look.ball.kind === "dot" ? 0.35 * s : 0.075 * s;
  }
  group.visible = false;
  return group;
}

function turfBasic(params, layer) {
  return new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, fog: false, polygonOffset: true,
    polygonOffsetFactor: layer.factor, polygonOffsetUnits: layer.units, ...params });
}

/** The meshes: { group, los, ltg, ring, shadow, ball, owned: materials this module owns }. */
function buildParts(look, kit) {
  const group = new THREE.Group();
  group.name = "situation-lines";
  const ringMaterial = turfBasic({ color: look.field.paint, opacity: 0.92 }, LAYERS.ring);
  const shadowMaterial = turfBasic({ color: 0x000000, alphaMap: kit.texture("radial"), opacity: SHADOW.opacity },
    LAYERS.shadow);
  const parts = {
    group, los: strip(look.lines.los.widthYd, kit.line("los")), ltg: strip(look.lines.ltg.widthYd, kit.line("ltg")),
    ring: flatOnTurf(new THREE.RingGeometry(RING.inner, RING.outer, 48), ringMaterial, LAYERS.ring),
    shadow: flatOnTurf(new THREE.PlaneGeometry(SHADOW.w, SHADOW.d), shadowMaterial, LAYERS.shadow),
    ball: restingBall(look, kit), owned: [ringMaterial, shadowMaterial],
  };
  group.add(parts.los, parts.ltg, parts.ring, parts.shadow, parts.ball);
  return parts;
}

// The functions below share one context `l` = { ...parts, st: { ballShown, upright, target, now } }.
function place(l) {
  const { st } = l;
  l.los.position.x = st.now.los;
  l.ltg.position.x = st.now.ltg;
  l.ring.position.x = st.now.ball;
  l.shadow.position.x = st.now.ball;
  l.ball.position.set(st.now.ball, l.ball.userData.rest + (st.upright ? TEE_H : 0), 0);
  l.ball.rotation.set(0, 0, st.upright ? Math.PI / 2 : 0);
}

/** A target x; an element that just appeared, or a cut, jumps there instead of gliding. */
function aim(l, key, x, { visible, wasVisible, instant }) {
  l.st.target[key] = x;
  if (instant || !wasVisible || !visible) l.st.now[key] = x;
}

function setSituation(l, sit, instant) {
  const has = Boolean(sit && Number.isFinite(sit.ballX));
  const kick = has && sit.kind === "kickoff";
  const showLtg = has && !kick && !sit.goalToGo && Number.isFinite(sit.ltgX);
  const bx = has ? sit.ballX - FIELD.MIDFIELD_X : 0;
  aim(l, "los", bx, { visible: has && !kick, wasVisible: l.los.visible, instant });
  aim(l, "ltg", showLtg ? sit.ltgX - FIELD.MIDFIELD_X : bx, { visible: showLtg, wasVisible: l.ltg.visible, instant });
  aim(l, "ball", bx, { visible: has, wasVisible: l.ring.visible, instant });
  l.los.visible = has && !kick;
  l.ltg.visible = showLtg;
  l.ring.visible = has;
  l.shadow.visible = has;
  l.st.upright = kick;
  l.ball.visible = has && l.st.ballShown;
  place(l);
}

function glide(l, dtMs) {
  const k = 1 - Math.exp((-GLIDE * Math.max(0, dtMs)) / 1000);
  let moving = false;
  for (const key of ["los", "ltg", "ball"]) {
    const next = l.st.now[key] + (l.st.target[key] - l.st.now[key]) * k;
    if (Math.abs(l.st.target[key] - next) <= SETTLED) l.st.now[key] = l.st.target[key];
    else {
      l.st.now[key] = next;
      moving = true;
    }
  }
  place(l);
  return moving;
}

function stateOf(l) {
  return {
    los: { visible: l.los.visible, x: l.st.now.los, width: l.los.userData.width, length: FIELD.WIDTH },
    ltg: { visible: l.ltg.visible, x: l.st.now.ltg, width: l.ltg.userData.width, length: FIELD.WIDTH },
    ball: { visible: l.ball.visible, x: l.st.now.ball, z: l.ball.position.z, upright: l.st.upright },
    ring: { visible: l.ring.visible },
  };
}

function disposeLines(l) {
  for (const mesh of [l.los, l.ltg, l.ring, l.shadow]) mesh.geometry.dispose();
  for (const m of l.owned) m.dispose();
  l.ball.traverse((o) => o.geometry?.dispose());
  l.group.removeFromParent();
}

/**
 * @param {object} look  a resolved Look (lines, ball, field.paint)
 * @param {object} kit   the material kit (materials.js)
 */
export function createLines(look, kit) {
  const l = { ...buildParts(look, kit),
    st: { ballShown: true, upright: false, target: { los: 0, ltg: 0, ball: 0 }, now: { los: 0, ltg: 0, ball: 0 } } };
  return {
    group: l.group, ball: l.ball,
    set: (sit, { instant = false } = {}) => setSituation(l, sit, instant),
    step: (dtMs) => glide(l, dtMs),
    setBallVisible(on) {
      l.st.ballShown = Boolean(on);
      l.ball.visible = l.ring.visible && l.st.ballShown;
    },
    /** Where a play left the ball (field x), at once; null hides it until the next set (a TD, a field goal). */
    placeBall(x) {
      if (!Number.isFinite(x)) {
        l.ball.visible = false;
        return;
      }
      l.st.now.ball = x - FIELD.MIDFIELD_X;
      l.st.target.ball = l.st.now.ball;
      place(l);
    },
    ballAt: () => (l.ring.visible ? { x: l.st.now.ball + FIELD.MIDFIELD_X, y: FIELD.CENTER_Y, h: 0 } : null),
    state: () => stateOf(l),
    dispose: () => disposeLines(l),
  };
}
