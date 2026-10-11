// The Model Report page as shipped (static/report.html, static/js/report/**, its stylesheets): the regions and links
// the spec asks for, every file it links exists, its module graph never reaches three.js or the 3D engine, its view
// models stay pure, and no user-facing text has an em dash (Sam's rule).
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const STATIC = join(ROOT, "static");
const JS = join(STATIC, "js");
const HTML = readFileSync(join(STATIC, "report.html"), "utf8");
const EM_DASH = "—";
const MAX_LINES = 800;

const filesUnder = (dir, ext) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = join(dir, entry.name);
  if (entry.isDirectory()) return filesUnder(full, ext);
  return entry.name.endsWith(ext) ? [full] : [];
});
const REPORT_JS = filesUnder(join(JS, "report"), ".js");
const REPORT_CSS = [join(STATIC, "css", "report", "report.css"),
  ...filesUnder(join(STATIC, "css", "worlds", "under-the-lights", "report"), ".css")];
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^\\:"'`\w])\/\/.*$/gm, "$1");
const stripHtmlComments = (src) => src.replace(/<!--[\s\S]*?-->/g, "");

test("the page has every board the spec lists, in its reading order, and an empty hidden analyst region", () => {
  const ids = [...HTML.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ["rp-night", "rp-league", "rp-situations", "rp-surprises", "rp-tendencies", "rp-memory", "rp-wp",
    "rp-drives", "rp-box", "rp-calls", "rp-analyst"]);
  const analyst = /<section id="rp-analyst"[^>]*>([\s\S]*?)<\/section>/.exec(HTML);
  assert.match(analyst[0], /\shidden[\s>]/);
  assert.equal(analyst[1].trim(), "", "no placeholder text");
  for (const id of ids.slice(0, -1)) {
    assert.match(HTML, new RegExp(`<section id="${id}"[^>]*aria-labelledby="${id}-plate"`));
  }
});

test("the ribbon links back to the GameCast and to the CSV export, as plain links that work without scripts", () => {
  assert.match(HTML, /<a class="sc-key rp-key" id="rp-back" href="\/"/);
  assert.match(HTML, /<a class="sc-key rp-key" id="rp-csv" href="\/api\/export\.csv" download/);
  assert.match(HTML, /<h1 class="rp-title">Model report<\/h1>/);
  assert.match(HTML, /<html lang="en" data-world="under-the-lights"/, "the default world's first frame");
});

test("every stylesheet, font, icon and script the page links exists", () => {
  const refs = [...HTML.matchAll(/(?:href|src)="(\/static\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length > 10);
  for (const ref of refs) assert.ok(existsSync(join(ROOT, ref.slice(1))), `${ref} is missing`);
  assert.ok(refs.includes("/static/js/report/main.js"));
});

/** Every module report/main.js can load, static and dynamic imports alike. */
function moduleGraph(entry) {
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = stripComments(readFileSync(file, "utf8"));
    const specs = [...src.matchAll(/\bimport\s*(?:[\w*{}\s,$]+\s+from\s+)?\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);
    for (const spec of specs) {
      assert.ok(spec.startsWith("."), `${relative(JS, file)} imports "${spec}"`);
      walk(resolve(dirname(file), spec));
    }
  };
  walk(entry);
  return [...seen].map((file) => relative(JS, file).split(sep).join("/"));
}

/** The engines and the scene: what a page with no 3D field must never be able to load. */
const ENGINE = Object.freeze(["main.js", "core/conductor.js", "shell/engine.js", "field/scene.js", "field/stage.js",
  "field/renderer.js", "field/fallback-2d.js", "field/webgl-support.js"]);

test("no 3D engine on this page: nothing it can load imports three.js, the field, an engine or a world's scene", () => {
  const graph = moduleGraph(join(JS, "report", "main.js"));   // also fails on any bare specifier, "three" included
  assert.ok(graph.includes("report/ui/night.js") && graph.includes("ui/scorecard.js") && graph.includes("core/sync.js"));
  const scene = graph.filter((path) => ENGINE.includes(path) || path.startsWith("field/")
    || path.startsWith("theme/worlds/") || path.startsWith("theme/registry"));
  assert.deepEqual(scene, []);
  assert.doesNotMatch(HTML, /importmap|three/);
});

test("the report's view models are pure: no DOM, clock, timers, storage or randomness", () => {
  const impure = new RegExp([String.raw`(?<![\w$.])(window|document|navigator|location|localStorage|globalThis)\s*\.`,
    String.raw`(?<![\w$.])(fetch|setTimeout|setInterval|requestAnimationFrame)\s*\(`,
    String.raw`\bDate\s*\.\s*now\s*\(`, String.raw`\bMath\s*\.\s*random\s*\(`].join("|"));
  const models = REPORT_JS.filter((file) => file.includes(`${sep}report${sep}model${sep}`) || file.endsWith("world.js")
    || file.endsWith("drain.js") || file.endsWith("bindings.js"));
  assert.ok(models.length >= 12);
  for (const file of models) assert.doesNotMatch(stripComments(readFileSync(file, "utf8")), impure, relative(JS, file));
});

test("no HTML sinks anywhere in the report's code (text only)", () => {
  for (const file of REPORT_JS) {
    const src = stripComments(readFileSync(file, "utf8"));
    assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|console\.log/, relative(JS, file));
  }
});

test("no em dash in anything a viewer reads: the copy, the page, the stylesheets' generated text", () => {
  const copy = stripComments(readFileSync(join(JS, "report", "model", "copy.js"), "utf8"));
  assert.ok(!copy.includes(EM_DASH), "report copy");
  assert.ok(!stripHtmlComments(HTML).includes(EM_DASH), "report.html");
  for (const file of REPORT_CSS) assert.ok(!readFileSync(file, "utf8").includes(EM_DASH), relative(ROOT, file));
});

test("every file is under 800 lines", () => {
  for (const file of [...REPORT_JS, ...REPORT_CSS, join(STATIC, "report.html")]) {
    const lines = readFileSync(file, "utf8").split("\n").length;
    assert.ok(lines <= MAX_LINES, `${relative(ROOT, file)} has ${lines} lines`);
  }
});
