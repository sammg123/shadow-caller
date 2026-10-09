// Static rules for static/js (ui-architecture.md section 1 and 7.1; owner A0).
// Every file: no HTML sinks, no console.log, no eval, relative imports carry ".js" (G27, section 1).
// Pure modules (the "pure" entries of 1.1): import only other pure modules and touch no DOM, three.js, clock,
// randomness, timers or browser storage, so node can test them and a world can never reach into them.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const JS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "static", "js");

/** Pure modules from ui-architecture.md 1.1. `core/api.js` is pure* (no DOM; it calls the injected fetch). */
const PURE = Object.freeze([
  ...["api", "store", "reducer", "reduce-server", "reduce-timeline", "reduce-anim", "reduce-conn", "reduce-view",
    "timeline-cache", "sync-plan", "present", "anim-queue", "domain", "keymap", "selection", "strip", "flags", "review"]
    .map((m) => `core/${m}.js`),
  ...["coords", "grammar", "paths", "ghosts", "timing", "camera-plan"].map((m) => `field/${m}.js`),
  // v1.2 (A6): the 2D field's drawing data
  ...["fallback-draw", "fallback-ghosts", "fallback-pixels", "fallback-plays", "fallback-steps", "fallback-bowl"]
    .map((m) => `field/${m}.js`),
  // v1.2 (A5 part 1): the 3D stage's numbers: field layout, DPR, safe area, poses, #field hooks
  ...["field-spec", "stage-math", "engine-state"].map((m) => `field/${m}.js`),
  ...["tokens", "look-schema", "neutral-look", "team-colors"].map((m) => `theme/${m}.js`),
  "shell/prefs.js",
]);
const PURE_STAR = new Set(["core/api.js"]);
const isPure = (path) => PURE.includes(path) || (path.startsWith("model/") && path.endsWith(".js"));

const SINKS = [
  [/\binnerHTML\b/, "innerHTML"], [/\bouterHTML\b/, "outerHTML"], [/\binsertAdjacentHTML\b/, "insertAdjacentHTML"],
  [/\bdocument\s*\.\s*write(ln)?\s*\(/, "document.write"], [/\bconsole\s*\.\s*log\s*\(/, "console.log"],
  [/(?<![\w$.])eval\s*\(/, "eval"], [/\bnew\s+Function\s*\(/, "new Function"], [/(?<![\w$.])debugger\b/, "debugger"],
];

/** Browser and clock globals a pure module must not touch (section 1: time comes in as `now`). */
const IMPURE = [
  [/(?<![\w$.])(window|document|navigator|location|localStorage|sessionStorage|performance|globalThis)\s*\.\s*[A-Za-z_$]/,
    "a browser global"],
  [/(?<![\w$.])(fetch|requestAnimationFrame|cancelAnimationFrame|setTimeout|clearTimeout|setInterval|clearInterval|matchMedia)\s*\(/,
    "a browser function"],
  [/\bDate\s*\.\s*now\s*\(/, "Date.now()"], [/\bnew\s+Date\s*\(\s*\)/, "new Date()"], [/\bMath\s*\.\s*random\s*\(/, "Math.random()"],
];

function jsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return jsFiles(full);
    return entry.name.endsWith(".js") ? [full] : [];
  });
}

const FILES = jsFiles(JS_ROOT).map((full) => ({ path: relative(JS_ROOT, full).split(sep).join("/"), full }));

/** Source without comments, so prose in comments never trips a rule. Strings stay (a sink in a string is still a smell). */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^\\:"'`\w])\/\/.*$/gm, "$1");
}

const code = (full) => stripComments(readFileSync(full, "utf8"));

const STATIC_PATTERNS = [/\bimport\s+(?:[\w*{}\s,$]+\s+from\s+)?["']([^"']+)["']/g,
  /\bexport\s+[\w*{}\s,$]+\s+from\s+["']([^"']+)["']/g];
const DYNAMIC_PATTERN = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

/** Module specifiers: static imports and re-exports, plus dynamic import() unless `dynamic` is false. */
function specifiers(src, { dynamic = true } = {}) {
  const found = [];
  for (const re of dynamic ? [...STATIC_PATTERNS, DYNAMIC_PATTERN] : STATIC_PATTERNS) {
    for (const m of src.matchAll(re)) found.push(m[1]);
  }
  return found;
}

const targetOf = (full, spec) => relative(JS_ROOT, resolve(dirname(full), spec)).split(sep).join("/");

const firstHit = (src, rules) => rules.find(([re]) => re.test(src));

test("the scan sees the modules it is meant to police", () => {
  const paths = FILES.map((f) => f.path);
  for (const must of ["core/store.js", "core/sync.js", "model/vm-feed.js", "field/paths.js"]) assert.ok(paths.includes(must), must);
  assert.ok(PURE.filter((p) => existsSync(join(JS_ROOT, p))).length >= 20, "most pure modules exist");
});

test("no HTML sinks, console.log, eval or debugger anywhere under static/js (G27)", () => {
  const bad = FILES.flatMap(({ path, full }) => {
    const hit = firstHit(code(full), SINKS);
    return hit ? [`${path}: ${hit[1]}`] : [];
  });
  assert.deepEqual(bad, []);
});

test("relative imports carry the .js extension and stay inside static/js", () => {
  const bad = FILES.flatMap(({ path, full }) => specifiers(code(full)).flatMap((spec) => {
    if (spec === "three" || spec.startsWith("three/addons/")) return [];
    if (!spec.startsWith("./") && !spec.startsWith("../")) return [`${path}: bare "${spec}"`];
    if (!spec.endsWith(".js")) return [`${path}: "${spec}" has no .js`];
    const target = resolve(dirname(full), spec);
    return target.startsWith(JS_ROOT + sep) ? [] : [`${path}: "${spec}" leaves static/js`];
  }));
  assert.deepEqual(bad, []);
});

test("pure modules import only pure modules, never three.js", () => {
  const bad = FILES.filter(({ path }) => isPure(path)).flatMap(({ path, full }) => specifiers(code(full)).flatMap((spec) => {
    if (!spec.startsWith(".")) return [`${path}: imports "${spec}"`];
    const target = relative(JS_ROOT, resolve(dirname(full), spec)).split(sep).join("/");
    return isPure(target) ? [] : [`${path}: imports ${target}, which is not pure`];
  }));
  assert.deepEqual(bad, []);
});

test("pure modules touch no DOM, clock, randomness, timers or browser storage", () => {
  const bad = FILES.filter(({ path }) => isPure(path) && !PURE_STAR.has(path)).flatMap(({ path, full }) => {
    const hit = firstHit(code(full), IMPURE);
    return hit ? [`${path}: ${hit[1]}`] : [];
  });
  assert.deepEqual(bad, []);
});

test("the rules catch what they claim to catch", () => {
  assert.ok(firstHit('el.innerHTML = "x"', SINKS));
  assert.ok(firstHit("console.log(1)", SINKS));
  assert.ok(firstHit("const t = Date.now();", IMPURE));
  assert.ok(firstHit("window.addEventListener('x', f)", IMPURE));
  assert.ok(firstHit("setTimeout(f, 1)", IMPURE));
  assert.equal(firstHit("const where = team.location;", IMPURE), undefined, "a property named location is fine");
  assert.equal(firstHit('const text = "Pick a location.";', IMPURE), undefined, "prose is fine");
  assert.equal(stripComments("// window.alert(1)\nconst a = 1; // document.write(2)").includes("window"), false);
  assert.equal(stripComments("/** document.write */ const b = 2;").includes("document"), false);
  assert.equal(stripComments('const u = "https://x.org/a";').includes("https://x.org/a"), true, "URLs in strings survive");
  assert.deepEqual(specifiers('import a from "./a.js";\nexport { b } from "../b.js";\nconst c = import("./c.js");'),
    ["./a.js", "../b.js", "./c.js"]);
});

/** Scene code: the engine (field/, except its pure geometry) and a world's scene modules. Only they touch three.js. */
const isSceneCode = (path) => (path.startsWith("field/") && !isPure(path)) || /^theme\/worlds\/[^/]+\//.test(path);

test("only scene code imports three.js, so the bundle loads only when the engine does (3.1 step 3)", () => {
  const bad = FILES.filter(({ path }) => !isSceneCode(path)).flatMap(({ path, full }) => specifiers(code(full))
    .filter((spec) => spec === "three" || spec.startsWith("three/")).map((spec) => `${path}: imports "${spec}"`));
  assert.deepEqual(bad, []);
});

/** Loaded only through import(): a missing or broken one leaves a notice instead of stopping boot (9.1). */
const isLazy = (target) => (target.startsWith("ui/") && !["ui/dom.js", "ui/scheduler.js"].includes(target))
  || ["field/scene.js", "field/fallback-2d.js", "field/webgl-support.js"].includes(target)
  || /^theme\/worlds\/[^/]+\//.test(target);

test("main.js and shell/ import components, the engine and worlds only dynamically", () => {
  const boot = FILES.filter(({ path }) => path === "main.js" || path.startsWith("shell/") || path === "theme/registry.js");
  assert.ok(boot.some(({ path }) => path === "main.js"), "main.js is scanned");
  const bad = boot.flatMap(({ path, full }) => specifiers(code(full), { dynamic: false })
    .filter((spec) => spec.startsWith(".")).map((spec) => [spec, targetOf(full, spec)])
    .filter(([, target]) => isLazy(target)).map(([spec]) => `${path}: static import of ${spec}`));
  assert.deepEqual(bad, []);
});

test("the boot rules recognize what they police", () => {
  assert.equal(isSceneCode("field/scene.js"), true);
  assert.equal(isSceneCode("field/paths.js"), false, "pure geometry never touches three.js");
  assert.equal(isSceneCode("theme/worlds/under-the-lights/props.js"), true);
  assert.equal(isSceneCode("ui/field-host.js"), false);
  assert.equal(isLazy("ui/masthead.js"), true);
  assert.equal(isLazy("ui/dom.js"), false);
  assert.equal(isLazy("field/scene.js"), true);
  assert.deepEqual(specifiers('import a from "./a.js"; const b = import("./b.js");', { dynamic: false }), ["./a.js"]);
});
