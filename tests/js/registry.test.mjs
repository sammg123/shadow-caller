// theme/registry.js, theme/worlds/index.js, theme/worlds/neutral/index.js (ui-architecture.md 2.7; owner A10).
import assert from "node:assert/strict";
import test from "node:test";
import { BUILTIN_NEUTRAL, WorldError, checkWorld, createRegistry } from "../../static/js/theme/registry.js";
import { DEFAULT_WORLD, FALLBACK_WORLD, WORLDS } from "../../static/js/theme/worlds/index.js";
import { createDocument, withDocument } from "./fake-dom.mjs";

const world = (id, extra = {}) => ({ id, label: `World ${id}`, look: {}, css: [`/static/css/worlds/${id}/tokens.css`], ...extra });

test("the static map holds neutral and under-the-lights; under-the-lights is the default, neutral the fallback", () => {
  assert.deepEqual(Object.keys(WORLDS), ["neutral", "under-the-lights"]);
  assert.equal(DEFAULT_WORLD, "under-the-lights");
  assert.equal(FALLBACK_WORLD, "neutral");
  assert.ok(Object.isFrozen(WORLDS));
});

test("the neutral world loads from the real map and validates", async () => {
  const neutral = await createRegistry().loadWorld("neutral");
  assert.equal(neutral.id, "neutral");
  assert.equal(neutral.label, "Neutral");
  assert.deepEqual(neutral.css, ["/static/css/worlds/neutral/tokens.css"]);
  assert.equal(typeof neutral.arrange, "function");
  assert.equal(neutral.booth, undefined, "restructure-v2.md 1: no world has a control-room drawer");
});

test("restructure-v2.md 4: each world ships two cameras, Wide (the default) and Blimp", async () => {
  for (const id of Object.keys(WORLDS)) {
    const loaded = await createRegistry().loadWorld(id);
    const cameras = loaded.look.cameras;
    assert.deepEqual(cameras.modes.map((m) => [m.id, m.label]), [["wide", "Wide"], ["blimp", "Blimp"]], id);
    assert.equal(cameras.default, "wide", id);
  }
});

test("loadWorld rejects ids outside the map (nothing is imported from a user-supplied path)", async () => {
  const reg = createRegistry({ neutral: async () => ({ default: world("neutral") }) });
  for (const id of ["../../evil", "__proto__", "toString", "", "nope"]) {
    await assert.rejects(reg.loadWorld(id), WorldError);
  }
});

test("a world may set its default room lights (ambient); none means the app default", async () => {
  const reg = createRegistry({ a: async () => ({ default: world("a", { ambient: "dark" }) }),
    b: async () => ({ default: world("b") }) });
  assert.equal((await reg.loadWorld("a")).ambient, "dark");
  assert.equal((await reg.loadWorld("b")).ambient, null);
});

test("a world module may export default, a named `world`, or its fields directly", async () => {
  const reg = createRegistry({
    a: async () => ({ default: world("a") }),
    b: async () => ({ world: world("b") }),
    c: async () => ({ ...world("c") }),
  });
  for (const id of ["a", "b", "c"]) assert.equal((await reg.loadWorld(id)).id, id);
});

test("checkWorld lists every problem with a world module", () => {
  assert.throws(() => checkWorld(world("x", { id: "y" }), "x"), /id must be "x"/);
  const bad = world("x", {
    label: "", look: [], css: ["/static/css/worlds/other/tokens.css", "/static/css/worlds/x/../neutral/a.css", "https://cdn/x.css"],
    fonts: ["/static/fonts/x/a.exe"], arrange: "nope", moments: { snap: 3 }, passes: { led: null }, ambient: "dim",
  });
  assert.throws(() => checkWorld(bad, "x"), (err) => {
    assert.ok(err instanceof WorldError);
    for (const want of ["label must be a non-empty string", "look must be an object", "css[0] must be a .css file under",
      "css[1] must be a .css file under", "css[2] must be a .css file under", "fonts[0] must be a font file under",
      "arrange must be a function", "moments.snap must be a function", "passes.led must be a function",
      "ambient must be \"room\" or \"dark\""]) {
      assert.ok(err.problems.some((p) => p.includes(want)), `${want}: ${err.problems}`);
    }
    return true;
  });
  assert.throws(() => checkWorld(null, "x"), /world module/);
});

test("loadWithFallback falls back to neutral with the reason when a world is missing or broken", async () => {
  const reg = createRegistry({
    neutral: async () => ({ default: world("neutral") }),
    missing: async () => { throw new TypeError("Failed to fetch dynamically imported module"); },
    broken: async () => ({ default: world("broken", { css: "nope" }) }),
  });
  const ok = await reg.loadWithFallback("neutral");
  assert.deepEqual([ok.world.id, ok.fellBack, ok.error], ["neutral", false, null]);
  const missing = await reg.loadWithFallback("missing");
  assert.equal(missing.world.id, "neutral");
  assert.equal(missing.fellBack, true);
  assert.match(missing.error.message, /Failed to fetch/);
  assert.equal(missing.requested, "missing");
  const broken = await reg.loadWithFallback("broken");
  assert.equal(broken.world.id, "neutral");
  assert.ok(broken.error instanceof WorldError);
});

test("when even the fallback fails, the built-in neutral world is used", async () => {
  const reg = createRegistry({ neutral: async () => { throw new Error("gone"); } });
  const res = await reg.loadWithFallback("neutral");
  assert.equal(res.world, BUILTIN_NEUTRAL);
  assert.equal(res.fellBack, true);
  assert.equal(BUILTIN_NEUTRAL.arrange, undefined);
});

test("chooseWorldId: ?world= (map keys only), then the stored choice, then the default, then neutral", () => {
  const reg = createRegistry({ neutral: async () => ({}), "under-the-lights": async () => ({}) });
  assert.deepEqual(reg.chooseWorldId({ query: "neutral", stored: "under-the-lights" }),
    { id: "neutral", source: "query", ignored: [] });
  assert.deepEqual(reg.chooseWorldId({ query: null, stored: "neutral" }), { id: "neutral", source: "stored", ignored: [] });
  assert.deepEqual(reg.chooseWorldId({ query: "../x", stored: "bogus" }),
    { id: "under-the-lights", source: "default", ignored: ["../x", "bogus"] });
  assert.deepEqual(createRegistry({ neutral: async () => ({}) }).chooseWorldId({}),
    { id: "neutral", source: "fallback", ignored: [] });
});

test("the neutral arrange puts the regions in a main column and a rail, keeping every id", () => withDocument(createDocument(), async () => {
  const doc = globalThis.document;
  const app = doc.createElement("div");
  doc.body.appendChild(app);
  const names = ["masthead", "scoreboard", "field", "call", "plays", "drives", "wp"];
  const regions = Object.fromEntries(names.map((n) => {
    const node = doc.createElement("section");
    node.setAttribute("data-region", n);
    app.appendChild(node);
    return [n, node];
  }));
  const neutral = await createRegistry().loadWorld("neutral");
  neutral.arrange(app, regions);
  neutral.arrange(app, regions);
  assert.equal(app.getAttribute("data-layout"), "neutral");
  const order = (node) => [...node.children].map((c) => c.getAttribute("data-region") ?? c.getAttribute("class"));
  assert.deepEqual(order(app), ["masthead", "scoreboard", "sc-col sc-col-main", "sc-col sc-col-rail"]);
  assert.deepEqual(order(app.children[2]), ["field", "call"]);
  assert.deepEqual(order(app.children[3]), ["wp", "drives", "plays"]);
}));
