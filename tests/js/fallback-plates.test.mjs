// field/fallback-plates.js (4b): the 2D field's tagged plates: "NEXT 1" on a tab in its prediction's colour, then the
// words; "LAST" and its verdict on a second line; laid out around the plate's own origin so placing it is a translate.
import assert from "node:assert/strict";
import test from "node:test";

import { PLATE, plateLayout, plateNode } from "../../static/js/field/fallback-plates.js";

const walk = (n, out = []) => {
  out.push(n);
  for (const c of n.children ?? []) walk(c, out);
  return out;
};

test("a plate's spec: leader (hidden), plate, tab and its tag, a hidden separator, the words, a second line", () => {
  const spec = plateNode({ tag: "LAST", body: "Short pass left · +11", sub: "Top pick · 19%", tab: "#a9acb2",
    tone: "muted", part: "play-label", role: "last", cls: "sc-label sc-fb-play-label is-last" });
  assert.equal(spec.attrs.class, "sc-fb-tag sc-fb-plate sc-label sc-fb-play-label is-last");
  assert.deepEqual([spec.attrs["data-plate"], spec.attrs["data-tag"], spec.attrs["data-part"]], ["last", "LAST",
    "play-label"]);
  assert.deepEqual(spec.children.map((c) => c.attrs["data-role"]), ["leader", "plate", "tab", "tab-text", "sep",
    "body", "sep", "sub"]);
  assert.equal(spec.children[0].attrs.display, "none");
  assert.equal(spec.children[2].attrs.fill, "#a9acb2", "the tab wears its colour");
  const words = walk(spec).filter((n) => n.tag === "text").map((n) => n.text).join("");
  assert.equal(words, "LAST · Short pass left · +11 · Top pick · 19%", "the plate reads as one line of text");
  const bare = plateNode({ body: "Screen · 5%", part: "shadow-label" });
  assert.deepEqual(bare.children.map((c) => c.attrs["data-role"]), ["leader", "plate", "body"]);
});

test("plateLayout: centered on its origin, the tab inside its left end, the words after it, a second line under", () => {
  const box = plateLayout({ tab: { w: 30, h: 16 }, body: { w: 150, h: 18 }, sub: { w: 90, h: 14 } });
  const w = PLATE.padX + 30 + 2 * PLATE.tabPadX + PLATE.gapX + 150 + PLATE.padX;
  const h = PLATE.padY + 18 + PLATE.subGap + 14 + PLATE.padY;
  assert.deepEqual([box.w, box.h], [w, h]);
  assert.deepEqual(box.plate, { x: -w / 2, y: -h / 2, width: w, height: h });
  assert.ok(box.tab.x > box.plate.x && box.tab.x + box.tab.width < box.body.x, "the tab, then the words");
  assert.ok(box.body.x + 150 <= w / 2 + 1e-9, "the words fit inside");
  assert.ok(box.sub.y > box.body.y, "the verdict under them");
  const plain = plateLayout({ body: { w: 100, h: 18 } });
  assert.equal(plain.tab, null);
  assert.equal(plain.sub, null);
  assert.equal(plain.body.x, -plain.w / 2 + PLATE.padX);
  assert.equal(plateLayout({ body: { w: 10, h: 10 }, sub: { w: 300, h: 10 } }).w, 2 * PLATE.padX + 300,
    "a long verdict sets the width");
});
