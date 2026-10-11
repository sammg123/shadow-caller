// The analyst panel's modules against the codebase's rules (tests/js/static-rules.test.mjs; ui-architecture.md 1.1):
// the pure ones (copy, history, keys, ndjson, state, vm) touch no DOM, clock, randomness, timers or storage and import
// only each other; stream.js reaches the network only through the fetch it is handed; nothing is an HTML sink or a
// console.log; files stay small with short lines; and no user-facing string carries an em dash.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const DIR = new URL("../../../static/js/ask/", import.meta.url);
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".js")).sort();
const source = (f) => readFileSync(new URL(f, DIR), "utf8");
const code = (f) => source(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^\\:"'`\w])\/\/.*$/gm, "$1");
const PURE = ["copy.js", "history.js", "keys.js", "ndjson.js", "state.js", "vm.js"];

const GLOBALS = "window|document|navigator|location|localStorage|sessionStorage|performance|globalThis";
const CALLS = ["fetch", "requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout", "setInterval",
  "clearInterval", "matchMedia"].join("|");
const IMPURE = [
  new RegExp(`(?<![\\w$.])(${GLOBALS})\\s*\\.\\s*[A-Za-z_$]`),
  new RegExp(`(?<![\\w$.])(${CALLS})\\s*\\(`),
  /\bDate\s*\.\s*now\s*\(/, /\bnew\s+Date\s*\(\s*\)/, /\bMath\s*\.\s*random\s*\(/,
];

test("the folder holds the modules the panel is made of", () => {
  assert.deepEqual(FILES, ["copy.js", "history.js", "keys.js", "ndjson.js", "panel.js", "state.js", "stream.js",
    "view.js", "vm.js"]);
});

test("pure modules touch no DOM, clock, randomness, timers or storage, and import only pure modules", () => {
  for (const f of PURE) {
    for (const re of IMPURE) assert.doesNotMatch(code(f), re, `${f}: ${re}`);
    const imports = [...code(f).matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]);
    for (const spec of imports) assert.ok(PURE.includes(spec.replace("./", "")), `${f} imports ${spec}`);
  }
});

test("stream.js reaches the network only through the fetch it is handed, and never the DOM", () => {
  const src = code("stream.js");
  assert.doesNotMatch(src, /(?<![\w$.])fetch\s*\(/);
  assert.doesNotMatch(src, /(?<![\w$.])(window|document)\s*\./);
});

test("no HTML sink, eval or console.log, and imports carry .js", () => {
  for (const f of FILES) {
    const src = code(f);
    assert.doesNotMatch(src, /\binnerHTML\b|\bouterHTML\b|\binsertAdjacentHTML\b|document\s*\.\s*write/, f);
    assert.doesNotMatch(src, /console\s*\.\s*log|(?<![\w$.])eval\s*\(|new\s+Function\s*\(|\bdebugger\b/, f);
    for (const m of src.matchAll(/\bfrom\s+["']([^"']+)["']/g)) assert.match(m[1], /^\.\.?\/.*\.js$/, `${f}: ${m[1]}`);
  }
});

test("small files, short lines, no em dash", () => {
  for (const f of FILES) {
    const lines = source(f).split("\n");
    assert.ok(lines.length <= 400, `${f}: ${lines.length} lines`);
    assert.deepEqual(lines.filter((l) => l.length > 120), [], f);
    assert.doesNotMatch(source(f), /\u2014/, `${f}: no em dashes`);
  }
});
