// field/fallback-svg.js (A6): spec nodes to SVG, tag panels sized to their text, safe-area insets, label declutter.
import assert from "node:assert/strict";
import test from "node:test";

import {
  INSET_PROPS, REVIEW_LAYERS, STAGE_LAYERS, buildNode, createSurface, declutter, fitTags, readInsets, spreadBoxes,
} from "../../static/js/field/fallback-svg.js";
import { tagNode } from "../../static/js/field/fallback-draw.js";
import { createDocument, withDocument } from "./fake-dom.mjs";

test("spreadBoxes keeps the first box, moves an overlapping one clear, and hides what cannot fit", () => {
  const box = (y) => ({ x: 100, y, width: 60, height: 20 });
  const out = spreadBoxes([box(100), box(105), box(110)], { top: 0, bottom: 400, gap: 2 });
  assert.deepEqual(out[0], { dx: 0, dy: 0, hidden: false });
  assert.equal(out[1].hidden, false);
  assert.ok(Math.abs(out[1].dy) >= 17, "moved clear of the first");
  const placed = out.map((o, i) => 100 + 5 * i + o.dy);
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) assert.ok(Math.abs(placed[i] - placed[j]) >= 22, `${i} ${j}`);
  }
  const cramped = spreadBoxes([box(0), box(0)], { top: 0, bottom: 22, gap: 2 });
  assert.deepEqual(cramped[1], { dx: 0, dy: 0, hidden: true });
  assert.deepEqual(spreadBoxes([{ x: 0, y: 0, width: 10, height: 10 }, { x: 50, y: 0, width: 10, height: 10 }]),
    [{ dx: 0, dy: 0, hidden: false }, { dx: 0, dy: 0, hidden: false }], "boxes apart stay put");
});

test("spreadBoxes slides a long label back inside the free area's sides before spreading", () => {
  const out = spreadBoxes([{ x: 950, y: 100, width: 120, height: 20 }, { x: -30, y: 300, width: 100, height: 20 }],
    { top: 0, bottom: 400, left: 0, right: 984 });
  assert.deepEqual(out, [{ dx: -86, dy: 0, hidden: false }, { dx: 30, dy: 0, hidden: false }]);
  const wide = spreadBoxes([{ x: 10, y: 0, width: 500, height: 20 }], { left: 100, right: 400 });
  assert.equal(wide[0].dx, -10, "wider than the area: centered on it");
  const slid = spreadBoxes([{ x: 900, y: 100, width: 120, height: 20 }, { x: 860, y: 100, width: 120, height: 20 }],
    { top: 0, bottom: 400, left: 0, right: 984, gap: 2 });
  assert.equal(slid[1].dx, 0, "inside already");
  assert.notEqual(slid[1].dy, 0, "and spread clear of the slid one");
});

test("buildNode builds nested SVG with text set as text, never markup", () => withDocument(createDocument(), () => {
  const el = buildNode({ tag: "g", attrs: { "data-part": "x" }, children: [{ tag: "text", attrs: { x: 1 }, text: "<b>+8</b>" }] });
  assert.equal(el.getAttribute("data-part"), "x");
  const text = el.querySelector("text");
  assert.equal(text.textContent, "<b>+8</b>");
  assert.equal(text.childNodes.length, 1);
  assert.equal(text.childNodes[0].nodeType, 3, "a text node");
}));

test("fitTags sizes each panel to its text (estimated where nothing is laid out)", () => withDocument(createDocument(), () => {
  const g = buildNode(tagNode({ at: { px: 200, py: 100 }, text: "INC", anchor: "middle", part: "result-label" }));
  const root = buildNode({ tag: "g", attrs: {} });
  root.appendChild(g);
  fitTags(root);
  const rect = g.querySelector("rect");
  assert.ok(Number(rect.getAttribute("width")) > 12, "wider than the padding alone");
  const x = Number(rect.getAttribute("x"));
  assert.ok(x < 200 && x + Number(rect.getAttribute("width")) > 200, "centered on the anchor");
}));

test("declutter moves a colliding tag, keeps tags inside the sides, hides one with no room", () => withDocument(createDocument(), () => {
  const surface = createSurface(globalThis.document.body, globalThis.document);
  const stage = surface.live;
  for (const [group, text] of [["tagPlay", "+8"], ["tagGhost", "35%"], ["tagGhost", "19%"]]) {
    stage[group].appendChild(buildNode(tagNode({ at: { px: 300, py: 200 }, text, part: "t" })));
  }
  fitTags(stage.tags);
  declutter(stage, { top: 0, bottom: 1000 });
  assert.equal(stage.tagPlay.querySelector(".sc-fb-tag").getAttribute("transform"), null, "the play's label keeps its spot");
  const moved = [...stage.tagGhost.querySelectorAll(".sc-fb-tag")].map((t) => t.getAttribute("transform"));
  assert.ok(moved.every((m) => /^translate\(0 -?\d/.test(m ?? "")), `the shadow labels move clear: ${moved}`);
  declutter(stage, { top: 0, bottom: 1000, left: 310, right: 1000 });
  const slid = stage.tagPlay.querySelector(".sc-fb-tag").getAttribute("transform");
  assert.match(slid ?? "", /^translate\(\d+ 0\)$/, `slid right to stay on screen: ${slid}`);
  declutter(stage, { top: 190, bottom: 215 });
  const hidden = [...stage.tags.querySelectorAll(".sc-fb-tag")].filter((t) => t.getAttribute("display") === "none");
  assert.equal(hidden.length, 2, "no room: the lower-priority labels hide");
}));

test("readInsets reads the --sc-field-safe-* properties in px and ignores anything else", () => {
  const style = (values) => () => ({ getPropertyValue: (name) => values[name] ?? "" });
  assert.deepEqual(readInsets({}, style({ [INSET_PROPS.right]: " 456px", [INSET_PROPS.top]: "44px",
    [INSET_PROPS.bottom]: "calc(10px + 2px)", [INSET_PROPS.left]: "-3px" })), { top: 44, right: 456, bottom: 0, left: 0 });
  assert.deepEqual(readInsets({}, style({ [INSET_PROPS.top]: "12em", [INSET_PROPS.right]: "30" })),
    { top: 0, right: 0, bottom: 0, left: 0 }, "px only, like the WebGL engine");
  assert.deepEqual(readInsets({}, null), {});
  assert.deepEqual(readInsets({}, () => { throw new Error("detached"); }), {});
  assert.deepEqual(INSET_PROPS, { top: "--sc-field-safe-top", right: "--sc-field-safe-right",
    bottom: "--sc-field-safe-bottom", left: "--sc-field-safe-left" });
});

test("the surface's sheet grows a new shadow out of the line of scrimmage and fades words in", () => withDocument(createDocument(), () => {
  const surface = createSurface(globalThis.document.body, globalThis.document);
  const sheet = surface.svg.querySelector("style").textContent;
  assert.match(sheet, /\.sc-fb-grow \{ animation: sc-fb-grow/);
  assert.match(sheet, /@keyframes sc-fb-grow \{ from \{ opacity: 0; transform: scale\(0\.\d+\); \} \}/);
  assert.match(sheet, /\.sc-fb-in \{ animation: sc-fb-in/);
  assert.doesNotMatch(sheet, /sc-fb-scan/, "the pixel zones' scan went with the zones");
}));

test("live, the shadow plays draw over the ball they come out of; in review, under the play that happened", () => {
  assert.deepEqual(STAGE_LAYERS, ["residue", "lines", "last", "play", "ball", "ghosts", "tags"]);
  assert.deepEqual(REVIEW_LAYERS, ["residue", "lines", "ghosts", "last", "play", "ball", "tags"]);
  withDocument(createDocument(), () => {
    const surface = createSurface(globalThis.document.body, globalThis.document);
    const order = (stage) => [...stage.root.childNodes].map((g) => g.getAttribute("data-layer"));
    assert.deepEqual(order(surface.live), STAGE_LAYERS.map((l) => `live-${l}`));
    assert.deepEqual(order(surface.review), REVIEW_LAYERS.map((l) => `review-${l}`));
    for (const stage of [surface.live, surface.review]) assert.ok(stage.ghosts && stage.tagGhost, "same layers");
  });
});
