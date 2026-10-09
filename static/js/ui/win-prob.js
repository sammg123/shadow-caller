// Win probability (ui-architecture.md 2.6, 5.4; owner A8). Renders wpVm: ESPN's win probability after each drawn
// play, on the caller's side (DC B6.7), as a line over the game clock from ESPN's opening value, with the 50% line,
// quarter marks, a dot on every score and turnover, and the current value as the readout. The area between the line
// and 50% takes the caller's team color above and the opponent's below (runtime --sc-team-* tokens, through CSS).
// Hand-entered games have no win probability and say so. The SVG stretches with the region (non-scaling strokes).
import { clear, el, setAttr, setData, setHidden, setText, svgEl } from "./dom.js";

const W = 360;
const H = 100;
const QUARTER_S = 900;
const REGULATION_S = 3600;
let instances = 0;

const finite = (v) => typeof v === "number" && Number.isFinite(v);
const r2 = (v) => Math.round(v * 100) / 100;
const xOf = (t, tMax) => r2((Math.max(0, Math.min(t, tMax)) / tMax) * W);
const yOf = (wp) => r2((1 - Math.max(0, Math.min(1, wp))) * H);

/** The line through ESPN's opening value (at t 0) and every drawn play, as [x, y] pairs. */
function linePoints(vm) {
  const pts = vm.points.filter((p) => finite(p.t) && finite(p.wp)).map((p) => [xOf(p.t, vm.tMax), yOf(p.wp)]);
  return finite(vm.start) ? [[0, yOf(vm.start)], ...pts] : pts;
}

const pathOf = (pts) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");

function areaOf(pts) {
  if (pts.length < 2) return null;
  const last = pts[pts.length - 1];
  return `M${pts[0][0]} ${H / 2} ${pts.map(([x, y]) => `L${x} ${y}`).join(" ")} L${last[0]} ${H / 2} Z`;
}

function clip(id, y) {
  return svgEl("clipPath", { id, class: "sc-wp-clip" }, [svgEl("rect", { x: 0, y, width: W, height: H / 2 })]);
}

function plot() {
  instances += 1;
  const above = `sc-wp-above-${instances}`;
  const below = `sc-wp-below-${instances}`;
  const quarters = svgEl("g", { class: "sc-wp-quarters" });
  const marks = svgEl("g", { class: "sc-wp-marks" });
  const parts = {
    quarters, marks,
    areaUp: svgEl("path", { class: "sc-wp-area sc-wp-area-caller", "clip-path": `url(#${above})` }),
    areaDown: svgEl("path", { class: "sc-wp-area sc-wp-area-opp", "clip-path": `url(#${below})` }),
    line: svgEl("path", { class: "sc-wp-line" }),
    now: svgEl("line", { class: "sc-wp-now" }),
  };
  parts.svg = svgEl("svg", { class: "sc-wp-svg", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none",
    "aria-hidden": "true", focusable: "false" }, [
    svgEl("defs", {}, [clip(above, 0), clip(below, H / 2)]),
    svgEl("rect", { class: "sc-wp-bg", x: 0, y: 0, width: W, height: H }),
    quarters,
    svgEl("line", { class: "sc-wp-even", x1: 0, x2: W, y1: H / 2, y2: H / 2 }),
    parts.areaUp, parts.areaDown, parts.line, marks, parts.now,
  ]);
  return parts;
}

/** Replace a group's children (the marks and quarter lines are a handful of nodes, rebuilt on each render). */
function refill(group, nodes) {
  clear(group);
  for (const node of nodes) group.appendChild(node);
}

const dot = (cls, x, y, data = {}) => {
  const node = svgEl("line", { class: cls, x1: x, x2: x, y1: y, y2: y });
  for (const [k, v] of Object.entries(data)) setData(node, k, v);
  return node;
};

function drawQuarters(p, tMax) {
  const lines = [];
  for (let t = QUARTER_S; t < tMax; t += QUARTER_S) {
    const x = xOf(t, tMax);
    lines.push(svgEl("line", { class: "sc-wp-q", x1: x, x2: x, y1: 0, y2: H }));
  }
  refill(p.quarters, lines);
}

function drawMarks(p, vm) {
  refill(p.marks, vm.markers.filter((m) => finite(m.t) && finite(m.wp))
    .map((m) => dot("sc-wp-mark", xOf(m.t, vm.tMax), yOf(m.wp), { kind: m.kind, team: m.team, seq: m.seq })));
}

function drawLine(p, vm) {
  const pts = linePoints(vm);
  const area = areaOf(pts);
  setAttr(p.line, "d", pts.length ? pathOf(pts) : null);
  setAttr(p.areaUp, "d", area);
  setAttr(p.areaDown, "d", area);
  const last = pts[pts.length - 1];
  for (const [name, v] of [["x1", last?.[0]], ["x2", last?.[0]], ["y1", last?.[1]], ["y2", last?.[1]]]) {
    setAttr(p.now, name, last ? v : null);
  }
  setAttr(p.now, "visibility", last ? null : "hidden");
  return pts.length;
}

function axisLabels(copy) {
  const labels = copy.quarters.map((q) => el("span", { text: q }));
  const ot = el("span", { cls: "sc-wp-ot", text: copy.overtime });
  return { node: el("div", { cls: "sc-wp-axis", attrs: { "aria-hidden": "true" } }, [...labels, ot]), ot };
}

function skeleton(copy) {
  const team = el("span", { cls: "sc-wp-team" });
  const value = el("span", { cls: ["sc-wp-value", "sc-digits", "sc-num"], data: { ghost: "88%" } });
  const p = plot();
  const axis = axisLabels(copy);
  const even = el("span", { cls: "sc-wp-evenlabel", text: copy.even, attrs: { "aria-hidden": "true" } });
  const plotBox = el("div", { cls: "sc-wp-plot" }, [p.svg, even, axis.node]);
  const note = el("p", { cls: "sc-wp-note" });
  const chart = el("div", { cls: "sc-wp", data: { testid: "wp-chart" } },
    [el("div", { cls: "sc-wp-head" }, [team, value]), plotBox, note]);
  return { chart, team, value, p, plotBox, note, axis };
}

function noteText(vm, copy, drawn) {
  if (!vm.available) return vm.note || copy.unavailable;
  return drawn ? "" : copy.waiting;
}

/**
 * @param {HTMLElement} root  #rg-wp
 * @param {{ copy: object }} ctx
 * @returns {{ update(vm: object): void, destroy(): void }}
 */
export function mount(root, ctx) {
  const copy = ctx.copy.WP;
  const title = el("h2", { cls: "sc-panel-title", text: copy.heading });
  const ui = skeleton(copy);
  const box = el("div", { cls: "sc-winprob" }, [title, ui.chart]);
  root.appendChild(box);
  return {
    update(vm) {
      setText(title, vm.heading);
      setData(ui.chart, "available", vm.available);
      setData(ui.chart, "wpCaller", vm.available && finite(vm.current) ? vm.current : null);
      setAttr(ui.chart, "role", vm.available && vm.ariaLabel ? "img" : null);
      setAttr(ui.chart, "aria-label", vm.available && vm.ariaLabel ? vm.ariaLabel : null);
      setText(ui.team, vm.available ? vm.caller : "");
      setText(ui.value, vm.available ? vm.currentText : "");
      setData(ui.plotBox, "ot", vm.tMax > REGULATION_S);
      setHidden(ui.axis.ot, !(vm.tMax > REGULATION_S));
      drawQuarters(ui.p, vm.tMax);
      drawMarks(ui.p, vm);
      const drawn = drawLine(ui.p, vm);
      setHidden(ui.plotBox, !vm.available);
      const note = noteText(vm, copy, drawn);
      setText(ui.note, note);
      setHidden(ui.note, !note);
    },
    destroy() {
      box.remove();
    },
  };
}
