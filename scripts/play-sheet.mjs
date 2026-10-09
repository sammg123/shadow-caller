#!/usr/bin/env node
/**
 * A contact sheet of the play drawings (docs/design/play-drawing.md, binding): one real TB at DAL row of every play
 * kind with the label the field shows, then the top-2 shadow plays for real Dallas pre-snap predictions (each row's
 * own pred.dist), laid out as a renderer would: the previous play's drawing to avoid, a hovered play, and the
 * panel's own label metrics (play-label.labelMetrics). Top-down, the near sideline at the bottom, each panel framed
 * on its play (at most 10 px a yard, about the snap camera's tight shot), an arc's height drawn as lift, labels on top
 * as the app's overlay draws them.
 *
 *   node scripts/play-sheet.mjs [--out /private/tmp/claude-501/play-sheet]
 *
 * Writes <out>/sheet.svg (self-contained; it embeds Big Shoulders Text when static/fonts has it). Any browser
 * renders it to PNG; the build used Playwright. Reads only tests/fixtures/timeline_tb_dal.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { FIELD } from "../static/js/field/coords.js";
import { labelHalfSpanYd } from "../static/js/field/grammar.js";
import { buildDrawing, situationFromRow } from "../static/js/field/paths.js";
import { labelMetrics } from "../static/js/field/play-label.js";
import { buildShadowPlays } from "../static/js/field/shadows.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = join(ROOT, "tests", "fixtures", "timeline_tb_dal.json");
const FONT = join(ROOT, "static", "fonts", "under-the-lights", "big-shoulders-text", "big-shoulders-text-latin.woff2");
const DEFAULT_OUT = "/private/tmp/claude-501/play-sheet";

const PANEL_W = 560;
const PANEL_H = 440;
const MAX_SCALE = 10;                // px per yard: short plays are framed like the snap camera's tight shot
const MIN_SPAN = 44;                 // yards
const PAD_YD = 5;
const HEAD_H = 40;
const GAP = 24;
const COLS = 4;
const CHAR_PX = 6.1;                 // label plate width per character at 13 px Big Shoulders Text 600
const INK = Object.freeze({ bg: "#0D1424", turf: "#3F8C3B", stripe: "#46983F", paint: "#F5F7F2", los: "#4A90FF",
  ltg: "#FFD400", zone: "#2F6E2C", plate: "#0B1220", text: "#FFFFFF", dim: "#B9AD92", gold: "#FFD27A",
  bad: "#FF4D3D", flag: "#FFD400", ball: "#7A4A26", shadow: "#FFF3D1" });
const TEAM = Object.freeze({ DAL: { core: "#EAF0FF", edge: "#2F57B5" }, TB: { core: "#FFE6E1", edge: "#D50A0A" } });
const BADGES = Object.freeze({ int: ["INT", INK.bad], td: ["TD", INK.gold], safety: ["SAF", INK.bad],
  touchback: ["TBK", "#9FB4D9"], fair_catch: ["FC", "#9FB4D9"], downed: ["DN", "#9FB4D9"], oob: ["OB", "#9FB4D9"],
  muffed: ["MUF", INK.bad], blocked: ["BLK", INK.bad], fg_good: ["GOOD", "#7DDB6A"], fg_miss: ["NO", INK.bad] });

// ---------------------------------------------------------------- svg text
const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");
const attrs = (a) => Object.entries(a).filter(([, v]) => v !== null && v !== undefined)
  .map(([k, v]) => ` ${k}="${esc(typeof v === "number" ? Math.round(v * 100) / 100 : v)}"`).join("");
const tag = (name, a = {}, inner = null) => (inner === null ? `<${name}${attrs(a)}/>`
  : `<${name}${attrs(a)}>${inner}</${name}>`);
const text = (x, y, s, a = {}) => tag("text", { x, y, ...a }, esc(s));

// ---------------------------------------------------------------- the field
/** Field yards -> panel px at `s` px a yard: x across, the near sideline (y 0) at the bottom, the center line in the
 * middle, height h drawn as lift toward the top. */
const mapper = (left, top, frame) => ({
  s: frame.s,
  x0: frame.x0,
  x1: frame.x0 + PANEL_W / frame.s,
  px: (x) => left + (x - frame.x0) * frame.s,
  py: (y, h = 0) => top + PANEL_H / 2 - (y - FIELD.CENTER_Y + h) * frame.s,
});

/** The x window that holds every point and every label whole, padded, at most MAX_SCALE px a yard. */
function frameFor(xs, labels) {
  const lo = Math.min(...xs, ...labels.map((l) => l.at.x - labelHalfSpanYd(l.text))) - PAD_YD;
  const hi = Math.max(...xs, ...labels.map((l) => l.at.x + labelHalfSpanYd(l.text))) + PAD_YD;
  const span = Math.max(MIN_SPAN, hi - lo, PANEL_W / MAX_SCALE);
  return { x0: (lo + hi) / 2 - span / 2, s: PANEL_W / span };
}

function fieldArt(m) {
  const top = m.py(FIELD.WIDTH);
  const turf = (x, w, fill) => tag("rect", { x: m.px(x), y: top, width: w * m.s, height: FIELD.WIDTH * m.s, fill });
  const out = [turf(FIELD.X_MIN, FIELD.X_MAX - FIELD.X_MIN, INK.turf)];
  for (let x = 0; x < 100; x += 10) out.push(turf(x, 5, INK.stripe));
  out.push(turf(FIELD.X_MIN, 10, INK.zone), turf(100, 10, INK.zone));
  for (let x = 0; x <= 100; x += 5) {
    out.push(tag("line", { x1: m.px(x), y1: top, x2: m.px(x), y2: m.py(0), stroke: INK.paint,
      "stroke-opacity": x % 10 === 0 ? 0.7 : 0.35, "stroke-width": x === 0 || x === 100 ? 2 : 1 }));
    if (x % 10 === 0 && x > 0 && x < 100) {
      const n = String(x <= 50 ? x : 100 - x);
      out.push(text(m.px(x), m.py(9), n, { class: "num" }),
        text(m.px(x), m.py(FIELD.WIDTH - 11), n, { class: "num" }));
    }
  }
  const ticks = FIELD.HASH_Y.flatMap((hy) => Array.from({ length: 99 }, (_, i) => i + 1)
    .map((x) => `M${m.px(x)} ${m.py(hy) - 2}v4`));
  out.push(tag("path", { d: ticks.join(""), stroke: INK.paint, "stroke-opacity": 0.35 }));
  return out.join("");
}

function scrimmageLines(m, sit) {
  if (!sit) return "";
  const line = (x, color) => tag("line", { x1: m.px(x), y1: m.py(FIELD.WIDTH), x2: m.px(x), y2: m.py(0),
    stroke: color, "stroke-width": 2.5, "stroke-opacity": 0.9 });
  return line(sit.ballX, INK.los) + (sit.ltgX === null || sit.ltgX === undefined ? "" : line(sit.ltgX, INK.ltg));
}

const ball = (m, p) => (p ? tag("ellipse", { cx: m.px(p.x), cy: m.py(p.y), rx: 4.6, ry: 3, fill: INK.ball,
  stroke: "#FFFFFF", "stroke-width": 0.8 }) : "");

// ---------------------------------------------------------------- strokes and marks
function arrow(m, from, to, color) {
  const [ax, ay, bx, by] = [m.px(from.x), m.py(from.y), m.px(to.x), m.py(to.y)];
  const len = Math.hypot(bx - ax, by - ay);
  if (len < 8) return "";
  const [ux, uy] = [(bx - ax) / len, (by - ay) / len];
  const pts = [[bx + ux * 3, by + uy * 3], [bx - ux * 6 - uy * 4, by - uy * 6 + ux * 4],
    [bx - ux * 6 + uy * 4, by - uy * 6 - ux * 4]];
  return tag("path", { d: `M${pts.map((p) => p.join(" ")).join("L")}Z`, fill: color });
}

function strokeArt(m, step, paint, style) {
  const a = { x: m.px(step.from.x), y: m.py(step.from.y) };
  const b = { x: m.px(step.to.x), y: m.py(step.to.y, step.t === "arc" ? step.endH : 0) };
  const dash = style.dash ?? (step.approx ? "3 3" : null);
  const common = { fill: "none", "stroke-linecap": "round", opacity: style.opacity };
  if (step.t === "arc") {
    const lift = 2 * step.apex * m.s;
    const c = { x: (a.x + b.x) / 2, y: (a.y + m.py(step.to.y)) / 2 - lift };
    const shadow = tag("line", { x1: a.x, y1: a.y, x2: m.px(step.to.x), y2: m.py(step.to.y), stroke: "#000000",
      "stroke-opacity": 0.3, "stroke-dasharray": "2 4", opacity: style.opacity });
    const d = `M${a.x} ${a.y}Q${c.x} ${c.y} ${b.x} ${b.y}`;
    return shadow + tag("path", { d, ...common, stroke: paint.edge, "stroke-width": 5 })
      + tag("path", { d, ...common, stroke: paint.core, "stroke-width": 2.4, "stroke-dasharray": dash });
  }
  const line = { x1: a.x, y1: a.y, x2: b.x, y2: b.y, ...common };
  return tag("line", { ...line, stroke: paint.edge, "stroke-width": 5.5 })
    + tag("line", { ...line, stroke: paint.core, "stroke-width": 2.6, "stroke-dasharray": dash })
    + (style.dash ? "" : `<g opacity="${style.opacity}">${arrow(m, step.from, step.to, paint.core)}</g>`);
}

function badge(x, y, label, color, opacity) {
  const w = label.length * 6.4 + 8;
  return `<g opacity="${opacity}">${tag("rect", { x: x - w / 2, y: y - 7, width: w, height: 14, rx: 2, fill: color })}`
    + `${text(x, y + 4, label, { class: "badge" })}</g>`;
}

const cross = (x, y) => `M${x - 6} ${y - 6}L${x + 6} ${y + 6}M${x + 6} ${y - 6}L${x - 6} ${y + 6}`;

/** Glyphs for the marks that are shapes; every other mark is a lettered badge (BADGES). */
const GLYPHS = Object.freeze({
  catch: (x, y, paint, o) => tag("circle", { cx: x, cy: y, r: 3.6, fill: paint.core, stroke: paint.edge,
    "stroke-width": 1.5, opacity: o }),
  incomplete: (x, y, paint, o) => xMark(x, y, "#FFFFFF", o),
  turnover: (x, y, paint, o) => xMark(x, y, INK.bad, o),
  flag: (x, y, paint, o) => tag("path", { d: `M${x} ${y + 7}L${x} ${y - 8}L${x + 9} ${y - 5}L${x} ${y - 2}`,
    fill: INK.flag, stroke: INK.flag, "stroke-width": 1.6, opacity: o }),
  sack: (x, y, paint, o) => tag("path", { d: starPath(x, y), fill: INK.bad, opacity: o }),
});

function xMark(x, y, color, o) {
  const d = cross(x, y);
  return tag("path", { d, stroke: "#000000", "stroke-width": 5, "stroke-linecap": "round", opacity: o * 0.6 })
    + tag("path", { d, stroke: color, "stroke-width": 2.6, "stroke-linecap": "round", opacity: o });
}

function markArt(m, step, paint, style) {
  const lift = step.role === "fg_good" || step.role === "fg_miss" ? 3.333 : 0;
  const [x, y] = [m.px(step.at.x), m.py(step.at.y, lift)];
  const glyph = GLYPHS[step.role];
  if (glyph) return glyph(x, y, paint, style.opacity);
  const [label, color] = BADGES[step.role] ?? [step.role.toUpperCase(), "#9FB4D9"];
  return badge(x, y - 11, label, color, style.opacity);
}

function starPath(x, y) {
  const pts = Array.from({ length: 16 }, (_, i) => {
    const r = i % 2 === 0 ? 8 : 3.5;
    const a = (Math.PI * i) / 8;
    return `${x + r * Math.cos(a)} ${y + r * Math.sin(a)}`;
  });
  return `M${pts.join("L")}Z`;
}

/** Who carries each step: possession flips after a turnover or INT mark and after a kick's flight. */
function carriers(row, drawing) {
  const other = (t) => (t === row.team ? row.opp : row.team);
  const start = row.kind === "kickoff" ? row.kick?.by ?? row.opp : row.team;
  return drawing.steps.reduce((acc, s) => {
    const flips = (s.t === "mark" && (s.role === "turnover" || s.role === "int"))
      || (s.t === "arc" && (s.role === "punt" || s.role === "kickoff"));
    return { team: flips ? other(acc.team) : acc.team, out: [...acc.out, acc.team] };
  }, { team: start, out: [] }).out;
}

function stepsArt(m, steps, teams, { opacity = 1, dash = null, paint: fixed = null } = {}) {
  return steps.map((s, i) => {
    const paint = fixed ?? TEAM[teams[i]] ?? TEAM.DAL;
    const style = { opacity: opacity * (s.ghosted ? 0.45 : 1), dash: dash ?? (s.ghosted ? "6 4" : null) };
    return s.t === "mark" ? markArt(m, s, paint, style) : strokeArt(m, s, paint, style);
  }).join("");
}

function labelArt(m, label, { opacity = 1, color = INK.text } = {}) {
  if (!label) return "";
  const [x, y] = [m.px(label.at.x), m.py(label.at.y)];
  const w = label.text.length * CHAR_PX + 12;
  return `<g opacity="${opacity}">${tag("rect", { x: x - w / 2, y: y - 10, width: w, height: 20, rx: 2,
    fill: INK.plate, "fill-opacity": 0.82 })}${text(x, y + 4.5, label.text, { class: "label", fill: color })}</g>`;
}

// ---------------------------------------------------------------- panels
const SHADOW_PAINT = Object.freeze({ core: INK.shadow, edge: "#5A4A22" });

function panelFrame(left, top, title, sub, frame, body) {
  const m = mapper(left, top + HEAD_H, frame);
  const id = `c${left}-${top}`;
  return [text(left, top + 15, title, { class: "title" }), text(left, top + 32, sub, { class: "sub" }),
    `<clipPath id="${id}">${tag("rect", { x: left, y: top + HEAD_H, width: PANEL_W, height: PANEL_H })}</clipPath>`,
    `<g clip-path="url(#${id})">${tag("rect", { x: left, y: top + HEAD_H, width: PANEL_W, height: PANEL_H,
      fill: "#16223A" })}${fieldArt(m)}${body(m)}</g>`].join("");
}

const pointsOf = (steps) => steps.flatMap((s) => (s.t === "mark" ? [s.at.x] : [s.from.x, s.to.x]));
const clip = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}\u2026` : t);

function playPanel(row, left, top) {
  const d = buildDrawing(row);
  const sit = situationFromRow(row);
  const frame = frameFor([...pointsOf(d.steps), sit?.ballX ?? 50], d.label ? [d.label] : []);
  const title = `#${row.seq} ${row.team} ${row.kind}${d.ghosted ? " (no play)" : ""}`;
  return panelFrame(left, top, title, clip(row.text.replace(/\s+/g, " ").trim(), 92), frame,
    (m) => scrimmageLines(m, sit) + stepsArt(m, d.steps, carriers(row, d)) + ball(m, d.ballEnd)
      + labelArt(m, d.label));
}

/** Shadow strokes, dashed and translucent (the hovered one lit); their labels go on top of every stroke. */
function shadowStrokes(m, shadows) {
  return shadows.map((s) => stepsArt(m, s.drawing.steps, [], {
    opacity: s.hovered ? 0.8 : s.drawing.opacity, dash: "7 5", paint: SHADOW_PAINT })).join("");
}

const shadowLabels = (m, shadows) => shadows.map((s) => labelArt(m, s.label,
  { opacity: s.hovered ? 1 : 0.92, color: INK.shadow })).join("");

/** This sheet's own view as label metrics (play-label.labelMetrics): top-down, a height drawn as lift. */
const sheetMetrics = (frame, at) => labelMetrics((p) => ({ x: (p.x - frame.x0) * frame.s,
  y: -(p.y - FIELD.CENTER_Y + (p.h ?? 0)) * frame.s }), at, { charPx: CHAR_PX, linePx: 24, padPx: 12 });

function previousArt(m, row) {
  if (!row) return { strokes: "", label: "" };
  const d = buildDrawing(row);
  return { strokes: `<g opacity="0.35">${stepsArt(m, d.steps, carriers(row, d))}</g>`,
    label: labelArt(m, d.label, { opacity: 0.45 }) };
}

/** The shadows as the app lays them out: one call with the previous play's drawing to avoid and the hovered play,
 * in this panel's own label metrics (the frame comes from a first layout in the default ones). */
function shadowPanel(spec, rows, left, top) {
  const row = rows.find((r) => r.seq === spec.seq);
  const sit = situationFromRow(row);
  const prev = spec.previous ? buildDrawing(rows.find((r) => r.seq === spec.previous)) : null;
  const opts = { avoid: prev ? [prev] : [], hover: spec.hover ?? null };
  const draft = buildShadowPlays(row.pred, sit, opts);
  const xs = [sit.ballX, ...draft.flatMap((s) => pointsOf(s.drawing.steps)), ...(prev ? pointsOf(prev.steps) : [])];
  const frame = frameFor(xs, [...draft.map((s) => s.label), ...(prev?.label ? [prev.label] : [])]);
  const all = buildShadowPlays(row.pred, sit, { ...opts,
    metrics: sheetMetrics(frame, { x: sit.ballX, y: FIELD.CENTER_Y }) });
  const hovered = all.find((s) => s.hovered);
  const sub = [row.pre.text, "before the snap", spec.previous ? `previous play #${spec.previous} dimmed` : "",
    hovered ? `hovering ${hovered.name}` : ""].filter(Boolean).join(" \u00b7 ");
  return panelFrame(left, top, spec.title, sub, frame, (m) => {
    const before = previousArt(m, rows.find((r) => r.seq === spec.previous));
    return scrimmageLines(m, sit) + before.strokes + shadowStrokes(m, all)
      + ball(m, { x: sit.ballX, y: FIELD.CENTER_Y }) + before.label + shadowLabels(m, all);
  });
}

// ---------------------------------------------------------------- the sheet
/** One real row of every kind of play: passes, runs, sack, scramble, kneel, kicks, flags (play-drawing.md 2). */
const PLAY_SEQS = Object.freeze([2, 3, 101, 7, 159, 158, 104, 15, 5, 41, 95, 28, 96, 9, 114, 17, 181, 43, 74, 87,
  1, 161, 113, 8, 65, 58]);
const SHADOW_SPECS = Object.freeze([
  { seq: 2, title: "Shadows · first DAL snap: run or play-action?" },
  { seq: 175, title: "Shadows · short or deep (DAL drive 21)" },
  { seq: 11, title: "Shadows · goal line, capped in the end zone" },
  { seq: 3, previous: 2, title: "Shadows · the previous play (solid, dimmed) and its words" },
  { seq: 2, hover: "screen", title: "Shadows · hovering the screen: the top 2's text steps clear" },
  { seq: 2, hover: "run_edge_right", title: "Shadows · hovering the outside run right" },
  { seq: 85, previous: 84, title: "Shadows · text under its shadows, over the dimmed throw" },
  { seq: 126, title: "Shadows · same shape twice: the later arc flies higher" },
]);

function fontFace() {
  if (!existsSync(FONT)) return "";
  const data = readFileSync(FONT).toString("base64");
  return `@font-face{font-family:"BST";src:url(data:font/woff2;base64,${data}) format("woff2");font-weight:100 900;}`;
}

function styles() {
  const rules = [
    'text{font-family:"BST","Big Shoulders Text","Arial Narrow",sans-serif}',
    ".title{font-size:15px;font-weight:700;fill:#FFF3D1;letter-spacing:.02em}",
    `.sub{font-size:12px;fill:${INK.dim}}`,
    ".label{font-size:13px;font-weight:600;text-anchor:middle}",
    ".badge{font-size:10px;font-weight:800;fill:#0B1220;text-anchor:middle}",
    `.num{font-size:12px;font-weight:700;fill:${INK.paint};fill-opacity:.55;text-anchor:middle}`,
    ".h1{font-size:24px;font-weight:800;fill:#FFF3D1;letter-spacing:.03em}",
    `.h2{font-size:14px;fill:${INK.dim}}`,
  ];
  return `<style>${fontFace()}${rules.join("")}</style>`;
}

function grid(items, top, render) {
  const cellH = HEAD_H + PANEL_H + GAP;
  const out = items.map((item, i) => render(item, GAP + (i % COLS) * (PANEL_W + GAP),
    top + Math.floor(i / COLS) * cellH));
  return { svg: out.join(""), bottom: top + Math.ceil(items.length / COLS) * cellH };
}

export function buildSheet(body) {
  const rows = body.rows;
  const width = GAP + COLS * (PANEL_W + GAP);
  const head = text(GAP, 40, "Play drawing · TB at DAL · every play starts on the line of scrimmage", { class: "h1" })
    + text(GAP, 62, "Pass = arc (lift = its height), X = incomplete, run = flat line; real plays solid, no-plays "
      + "dimmed and dashed; labels as drawn on the field, clear of their own arcs.", { class: "h2" });
  const plays = grid(PLAY_SEQS, 84, (seq, x, y) => playPanel(rows.find((r) => r.seq === seq), x, y));
  const title = text(GAP, plays.bottom + 30, "Before each Dallas snap: his top 2 as shadow plays (dashed, 50% and 35%)",
    { class: "h1" });
  const shadows = grid(SHADOW_SPECS, plays.bottom + 48, (spec, x, y) => shadowPanel(spec, rows, x, y));
  const height = shadows.bottom + GAP;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `${styles()}${tag("rect", { width, height, fill: INK.bg })}${head}${plays.svg}${title}${shadows.svg}</svg>`;
}

function outDir(argv) {
  const i = argv.indexOf("--out");
  return i >= 0 && argv[i + 1] ? argv[i + 1] : DEFAULT_OUT;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = outDir(process.argv.slice(2));
  mkdirSync(out, { recursive: true });
  const file = join(out, "sheet.svg");
  writeFileSync(file, buildSheet(JSON.parse(readFileSync(FIXTURE, "utf8"))));
  process.stdout.write(`${file}\n`);
}
