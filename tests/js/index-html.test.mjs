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
