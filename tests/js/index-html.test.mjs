// static/index.html as the integrated page (v1.4, W6): it opens with the direction contract, word for word, so anyone
// reading the page's source meets the world's thesis first (docs/design/direction-contract.md), and the default world
// it boots into is Sam's choice, Under the Lights (directions.md Direction 5), with ?world=neutral still honored.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DEFAULT_WORLD, FALLBACK_WORLD, WORLDS } from "../../static/js/theme/worlds/index.js";
import { createRegistry } from "../../static/js/theme/registry.js";

const INDEX = readFileSync(new URL("../../static/index.html", import.meta.url), "utf8");
const CONTRACT = readFileSync(new URL("../../docs/design/direction-contract.md", import.meta.url), "utf8");
const SOURCE_LINE = "docs/design/direction-contract.md, verbatim:";

/** The page's first comment, with the tag's own whitespace trimmed. */
function openingComment(html) {
  const start = html.indexOf("<!--");
  const end = html.indexOf("-->", start);
  assert.ok(start >= 0 && end > start, "index.html has an opening comment");
  return { start, body: html.slice(start + 4, end).trim() };
}

test("the doctype comes first, so the page renders in standards mode", () => {
  assert.match(INDEX, /^<!doctype html>\n/i);
});

test("the opening comment is the direction contract, word for word, before <html>", () => {
  const { start, body } = openingComment(INDEX);
  assert.ok(start < INDEX.indexOf("<html"), "the contract comes before the document element");
  const lines = body.split("\n");
  assert.equal(lines[0], SOURCE_LINE, "the comment names its source");
  assert.equal(lines.slice(1).join("\n").trim(), CONTRACT.trim());
});

test("the contract can sit in a comment as it is: nothing in it closes or breaks the comment", () => {
  assert.doesNotMatch(CONTRACT, /--!?>|<!--/);
  assert.doesNotMatch(CONTRACT, /^\s*-?>/);
});

test("Under the Lights is the default world; neutral stays the fallback and loads with ?world=neutral", () => {
  assert.equal(DEFAULT_WORLD, "under-the-lights");
  assert.equal(FALLBACK_WORLD, "neutral");
  const reg = createRegistry(WORLDS);
  assert.deepEqual(reg.chooseWorldId({}), { id: "under-the-lights", source: "default", ignored: [] });
  assert.deepEqual(reg.chooseWorldId({ query: "neutral" }), { id: "neutral", source: "query", ignored: [] });
  assert.deepEqual(reg.chooseWorldId({ query: "nope" }), { id: "under-the-lights", source: "default", ignored: ["nope"] });
});

// ---------------------------------------------------------------- G2-8: the first painted frame is the stadium
const tagOf = (re) => INDEX.match(re)?.[0] ?? "";
const attrOf = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null;
const worldLinks = () => [...INDEX.matchAll(/<link\b[^>]*\bdata-world-css="[^"]*"[^>]*>/g)].map((m) => m[0]);

test("G2-8: the page ships in Under the Lights, so its first frame is the night sky, not a neutral screen", () => {
  const html = tagOf(/<html\b[^>]*>/);
  assert.equal(attrOf(html, "data-world"), DEFAULT_WORLD);
  const links = worldLinks();
  assert.ok(links.length >= 1, "the default world's sheets are linked by the page itself");
  for (const link of links) {
    assert.equal(attrOf(link, "data-world-css"), DEFAULT_WORLD);
    assert.match(attrOf(link, "href"), /^\/static\/css\/worlds\/under-the-lights\/[\w/-]+\.css$/);
  }
  assert.equal(attrOf(links[0], "href"), "/static/css/worlds/under-the-lights/tokens.css", "its tokens first");
  assert.equal(attrOf(links[0], "id"), "world-css");
  assert.equal(links.filter((l) => attrOf(l, "id") === "world-css").length, 1);
  const lastComponent = INDEX.lastIndexOf('href="/static/css/components/');
  assert.ok(INDEX.indexOf(links[0]) > lastComponent, "after every component sheet, as theme/apply.js would put them");
});

test("G2-8: the loading board before any script runs is the boot screen's own board, lamp lit", () => {
  const holder = tagOf(/<div\b[^>]*\bdata-boot-static="true"[^>]*>/);
  const classes = (attrOf(holder, "class") ?? "").split(/\s+/);
  assert.ok(classes.includes("sc-boot-static") && classes.includes("sc-boot"), classes.join(" "));
  assert.equal(attrOf(holder, "data-phase"), "loading", "the loading lamp (amber in Under the Lights)");
  assert.equal(attrOf(holder, "role"), "status");
  for (const cls of ["sc-boot-board", "sc-boot-plate", "sc-lamp", "sc-boot-heading", "sc-boot-static-text",
    "sc-boot-static-stuck"]) {
    assert.match(INDEX, new RegExp(`class="[^"]*\\b${cls}\\b[^"]*"`), cls);
  }
  assert.match(INDEX, /class="[^"]*\bsc-boot-static-text\b[^"]*">Loading the game…</);
});

test("G2-8 (with G1-7): no inline script runs before main.js: the import map and the module are all", () => {
  const scripts = [...INDEX.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  for (const [, attrs, body] of scripts) {
    const type = attrs.match(/\btype="([^"]*)"/)?.[1] ?? "";
    if (type === "importmap") continue;
    assert.match(attrs, /\bsrc="\/static\/js\/main\.js"/, `an inline or extra script: <script${attrs}>`);
    assert.equal(body.trim(), "");
  }
});
