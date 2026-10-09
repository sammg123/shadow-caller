// field/play-glyphs.js: the marks' alpha masks (A5 part 2), drawn on a recording fake canvas in node: every glyph has a
// core and an edge ring cut out of it (so a dimmed mark fades evenly), letters are drawn with fillText only, masks are
// cached, shared (disposeTree leaves them alone) and freed by the cache.
import assert from "node:assert/strict";
import test from "node:test";
import { THREE } from "./action-stage.mjs";

const { createGlyphs } = await import("../../static/js/field/play-glyphs.js");
const { isShared } = await import("../../static/js/field/dispose.js");

function fakeDoc() {
  const calls = [];
  const ctx = new Proxy({ calls, globalCompositeOperation: "source-over" }, {
    get(target, name) {
      if (name in target) return target[name];
      if (name === "measureText") return (text) => ({ width: String(text).length * 40 });
      return (...args) => { calls.push([name, ...args.map((a) => (typeof a === "number" ? Math.round(a) : a))]); };
    },
    set(target, name, value) {
      target[name] = value;
      if (name === "globalCompositeOperation") calls.push(["composite", value]);
      return true;
    },
  });
  const created = [];
  const doc = {
    createElement(tag) {
      const canvas = { tag, width: 0, height: 0, getContext: () => ctx };
      created.push(canvas);
      return canvas;
    },
    documentElement: {},
    defaultView: { getComputedStyle: () => ({ getPropertyValue: () => "\"Big Shoulders Display\", sans-serif" }) },
  };
  return { doc, calls, created };
}

test("each glyph is two masks: the core, and the edge with the core cut out of it", () => {
  const { doc, calls, created } = fakeDoc();
  const glyphs = createGlyphs({ doc, maxAnisotropy: 8 });
  const core = glyphs.mask("x", "core");
  const edge = glyphs.mask("x", "edge");
  assert.ok(core instanceof THREE.CanvasTexture && edge instanceof THREE.CanvasTexture);
  assert.notEqual(core, edge);
  assert.equal(core.anisotropy, 8);
  assert.equal(core.colorSpace, THREE.NoColorSpace, "a mask, not a color image");
  assert.ok(isShared(core), "disposeTree leaves the cache's masks alone");
  assert.deepEqual([created[0].width, created[0].height], [128, 128]);
  assert.ok(calls.some((c) => c[0] === "composite" && c[1] === "destination-out"), "the edge is a ring around the core");
  assert.equal(glyphs.mask("x", "core"), core, "cached");
  assert.equal(glyphs.count(), 2);
});

test("every glyph kind draws, filled or stroked; unknown kinds fall back to a square", () => {
  const { doc, calls } = fakeDoc();
  const glyphs = createGlyphs({ doc });
  for (const g of ["dot", "ring", "x", "check", "square", "diamond", "bar", "arrow", "flag", "burst", "nope"]) {
    for (const layer of ["core", "edge"]) assert.ok(glyphs.mask(g, layer), `${g} ${layer}`);
  }
  assert.ok(calls.some((c) => c[0] === "arc") && calls.some((c) => c[0] === "stroke") && calls.some((c) => c[0] === "rect"));
  assert.equal(glyphs.aspect("x"), 1);
});

test("letters: a plate with the words cut out (edge), the words alone (core), in the world's display font", () => {
  const { doc, calls, created } = fakeDoc();
  const glyphs = createGlyphs({ doc });
  glyphs.mask("text", "edge", "INT");
  glyphs.mask("text", "core", "INT");
  assert.equal(created[0].width, 256);
  assert.equal(glyphs.aspect("text"), 2);
  assert.ok(calls.some((c) => c[0] === "roundRect"));
  const texts = calls.filter((c) => c[0] === "fillText").map((c) => c[1]);
  assert.deepEqual(texts, ["INT", "INT"]);
  assert.ok(glyphs.mask("text", "core", "TD") !== glyphs.mask("text", "core", "INT"), "one mask per word");
});

test("no document (node), no masks; dispose frees the cache", () => {
  assert.equal(createGlyphs().mask("x", "core"), null);
  const { doc } = fakeDoc();
  const glyphs = createGlyphs({ doc });
  const tex = glyphs.mask("dot", "core");
  let freed = 0;
  tex.addEventListener("dispose", () => { freed += 1; });
  glyphs.dispose();
  assert.equal(freed, 1);
  assert.equal(glyphs.count(), 0);
  const blank = { createElement: () => ({ getContext: () => null }), documentElement: {}, defaultView: null };
  assert.equal(createGlyphs({ doc: blank }).mask("x", "core"), null, "a canvas without 2D drawing gives no mask");
});
