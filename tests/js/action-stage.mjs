// A WebGL-free stage for the action layer's node tests (A5 part 2): the real material kit, camera rig and situation
// paint (as scene-engine.test.mjs uses), a label layer that records every label as a small fake element, and a
// hand-cranked frame clock: tick(ms) runs the keepAlive updaters the way renderer.js does on each frame.
import { loadJson } from "./fixtures.mjs";
import { loadThree, lookWith } from "./three-env.mjs";

export const THREE = await loadThree();
const { createKit } = await import("../../static/js/field/materials.js");
const { createCameraRig } = await import("../../static/js/field/cameras.js");
const { createLines } = await import("../../static/js/field/lines.js");
const { ROOTS } = await import("../../static/js/field/stage.js");
const { createLayers, LAYER_FACTORIES } = await import("../../static/js/field/layers.js");

export const TL = loadJson("timeline_tb_dal.json");
export function row(seq) {
  const r = TL.rows.find((x) => x.seq === seq);
  if (!r) throw new Error(`no row ${seq}`);
  return r;
}
export const D25 = Object.freeze({ ballX: 25, ltgX: 35, dir: 1, poss: "DAL", kind: "snap", goalToGo: false, down: 1,
  togo: 10 });

function fakeElement(text, cls) {
  const el = {
    textContent: text, className: cls, style: {},
    setAttribute(k, v) { if (k === "class") el.className = v; },
    classList: {
      contains: (c) => el.className.split(/\s+/).includes(c),
      toggle(c, on) {
        const has = el.classList.contains(c);
        const want = on === undefined ? !has : Boolean(on);
        if (want && !has) el.className = `${el.className} ${c}`.trim();
        if (!want && has) el.className = el.className.split(/\s+/).filter((x) => x !== c).join(" ");
        return want;
      },
    },
  };
  return el;
}

/** labels.js's handle shape: { object (visible, center), element (the text span; css2d only), move, remove }. */
export function fakeLabels(kind = "css2d") {
  const live = [];
  const labels = {
    kind, live,
    add(pt, text, cls = "") {
      if (kind === "none") return null;
      const h = { pt, cls, element: kind === "css2d" ? fakeElement(text, cls) : null,
        object: { visible: true, center: { x: 0.5, y: 1, set(x, y) { this.x = x; this.y = y; } },
          material: kind === "css2d" ? undefined : { opacity: 1 } },
        move(next) { h.pt = next; }, remove() { labels.remove(h); } };
      h.text = () => (h.element ? h.element.textContent : text);
      live.push(h);
      return h;
    },
    remove(h) {
      const i = live.indexOf(h);
      if (i >= 0) live.splice(i, 1);
    },
    texts: () => live.map((h) => h.text()),
    byClass: (c) => live.filter((h) => (h.element?.className ?? h.cls).split(/\s+/).includes(c)),
  };
  return labels;
}

/**
 * The stage (ui-architecture 14.3) without WebGL. `look` is a partial Look over NEUTRAL_LOOK.
 * @returns {Promise<{ stage: object, st: object, tick: (ms: number, step?: number) => boolean, layers: () => object }>}
 */
export async function actionStage({ look = {}, reduced = false, labels = "css2d", size = [1440, 900] } = {}) {
  const resolved = await lookWith(look);
  const kit = createKit(resolved, { teams: TL.teams });
  const cams = createCameraRig(resolved);
  cams.setView({ width: size[0], height: size[1] });
  const updaters = new Set();
  const st = { reduced, renders: 0, warnings: [] };
  const stage = {
    THREE, look: resolved, kit, cams, lines: createLines(resolved, kit), labels: fakeLabels(labels), layers: null,
    roots: Object.fromEntries(ROOTS.map((n) => [n, new THREE.Group()])), doc: null, host: null, renderer: null,
    frame: { field: TL.field, teams: TL.teams, teamOrder: TL.team_order, game: null },
    rig: { size: () => ({ width: size[0], height: size[1] }) },
    requestRender() { st.renders += 1; },
    keepAlive(fn) {
      updaters.add(fn);
      return () => updaters.delete(fn);
    },
    reducedMotion: () => st.reduced, visible: () => true, emit: (e, p) => st.warnings.push([e, p]),
  };
  const tick = (ms, step = 16) => {
    let busy = false;
    for (let t = 0; t < ms; t += step) {
      busy = false;
      for (const fn of [...updaters]) busy = fn(step) === true || busy;
    }
    return busy;
  };
  const layers = () => {
    stage.layers = createLayers(stage, LAYER_FACTORIES);
    return stage.layers;
  };
  return { stage, st, tick, layers, updaters };
}

/** Every mesh under `root` drawn with the strip shader (play-strip.js). */
export const stripsUnder = (root) => {
  const out = [];
  root.traverse((o) => { if (o.isMesh && o.material?.uniforms?.uReveal) out.push(o); });
  return out;
};

/** The action layer's art groups (play-art.js) under a root. */
export const artsUnder = (root) => root.children.filter((c) => c.name === "play-art");
