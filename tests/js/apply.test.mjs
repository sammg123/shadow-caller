// theme/apply.js (ui-architecture.md 2.7; owner A10): world CSS, <html> attribute hooks, runtime team tokens.
import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPossession, applyRootAttrs, applyTeams, applyWorld, missingWorldTokens, watchMotion,
} from "../../static/js/theme/apply.js";
import { REQUIRED_TOKENS } from "../../static/js/theme/tokens.js";
import { NEUTRAL_LOOK } from "../../static/js/theme/neutral-look.js";
import { createDocument } from "./fake-dom.mjs";

const TEAMS = {
  DAL: { abbr: "DAL", caller: true, color: "#002a5c", alt_color: "#b0b7bc" },
  TB: { abbr: "TB", caller: false, color: "#bd1c36", alt_color: "#3e3a35" },
};

function docWithWorldLink() {
  const doc = createDocument();
  const comp = doc.createElement("link");
  comp.setAttribute("href", "/static/css/components/toast.css");
  doc.head.appendChild(comp);
  const link = doc.createElement("link");
  link.setAttribute("id", "world-css");
  link.setAttribute("rel", "stylesheet");
  link.setAttribute("data-world-css", "neutral");
  link.setAttribute("href", "/static/css/worlds/neutral/tokens.css");
  doc.head.appendChild(link);
  doc.documentElement.setAttribute("data-world", "neutral");
  return doc;
}

const token = (doc, name) => doc.documentElement.style.getPropertyValue(name);
const loadAll = (doc, type = "load") => [...doc.querySelectorAll("[data-world-css]")]
  .filter((l) => l.getAttribute("data-world-css") !== "neutral").forEach((l) => l.dispatchEvent({ type }));

test("applyRootAttrs writes data-motion, data-ambient and data-scene, ignoring unknown values", () => {
  const doc = createDocument();
  applyRootAttrs(doc, { motion: "reduced", ambient: "dark", scene: "2d", world: "x" });
  const html = doc.documentElement;
  assert.deepEqual([html.getAttribute("data-motion"), html.getAttribute("data-ambient"), html.getAttribute("data-scene")],
    ["reduced", "dark", "2d"]);
  assert.equal(html.hasAttribute("data-world"), false, "the world is applyWorld's");
  applyRootAttrs(doc, { motion: "wild", scene: "webgl" });
  assert.equal(html.getAttribute("data-motion"), "reduced");
  assert.equal(html.getAttribute("data-scene"), "webgl");
});

test("applyWorld adds the world's stylesheets after the current one, then swaps data-world once they load", async () => {
  const doc = docWithWorldLink();
  const world = { id: "under-the-lights", css: ["/static/css/worlds/under-the-lights/tokens.css",
    "/static/css/worlds/under-the-lights/layout.css"], fonts: ["/static/fonts/under-the-lights/doto.woff2"] };
  const done = applyWorld(world, doc, { timeoutMs: 1000 });
  assert.equal(doc.documentElement.getAttribute("data-world"), "neutral", "no swap before the CSS loads");
  const added = [...doc.querySelectorAll("[data-world-css]")];
  assert.deepEqual(added.map((l) => l.getAttribute("href")), ["/static/css/worlds/neutral/tokens.css",
    "/static/css/worlds/under-the-lights/tokens.css", "/static/css/worlds/under-the-lights/layout.css"]);
  loadAll(doc);
  const result = await done;
  assert.deepEqual(result.failed, []);
  assert.equal(result.loaded.length, 2);
  assert.equal(doc.documentElement.getAttribute("data-world"), "under-the-lights");
  const links = [...doc.querySelectorAll("[data-world-css]")];
  assert.deepEqual(links.map((l) => l.getAttribute("data-world-css")), ["under-the-lights", "under-the-lights"]);
  assert.equal(doc.getElementById("world-css"), links[0]);
  const font = doc.querySelector("[data-world-font]");
  assert.equal(font.getAttribute("rel"), "preload");
  assert.equal(font.getAttribute("as"), "font");
  assert.equal(font.getAttribute("href"), "/static/fonts/under-the-lights/doto.woff2");
});

test("a stylesheet that errors or times out is reported as failed; the world still applies", async () => {
  const doc = docWithWorldLink();
  const world = { id: "x", css: ["/static/css/worlds/x/tokens.css", "/static/css/worlds/x/layout.css"] };
  const done = applyWorld(world, doc, { timeoutMs: 20 });
  [...doc.querySelectorAll("[data-world-css]")].find((l) => l.getAttribute("href").endsWith("tokens.css") &&
    l.getAttribute("data-world-css") === "x").dispatchEvent({ type: "error" });
  const result = await done;
  assert.deepEqual(result.failed.sort(), ["/static/css/worlds/x/layout.css", "/static/css/worlds/x/tokens.css"]);
  assert.equal(doc.documentElement.getAttribute("data-world"), "x");
});

test("applying the world that is already on is a no-op", async () => {
  const doc = docWithWorldLink();
  const result = await applyWorld({ id: "neutral", css: ["/static/css/worlds/neutral/tokens.css"] }, doc);
  assert.deepEqual(result, { loaded: ["/static/css/worlds/neutral/tokens.css"], failed: [] });
  assert.equal(doc.querySelectorAll("[data-world-css]").length, 1);
});

test("when the world is already on, applyWorld still waits for a sheet that is loading", async () => {
  const doc = docWithWorldLink();
  const link = doc.getElementById("world-css");
  link.sheet = null;
  let done = false;
  const pending = applyWorld({ id: "neutral", css: ["/static/css/worlds/neutral/tokens.css"] }, doc, { timeoutMs: 1000 })
    .then((r) => { done = true; return r; });
  await new Promise((r) => setImmediate(r));
  assert.equal(done, false);
  link.dispatchEvent({ type: "load" });
  assert.deepEqual(await pending, { loaded: ["/static/css/worlds/neutral/tokens.css"], failed: [] });
});

test("applyWorld refuses stylesheet paths outside the world's folder", async () => {
  const doc = docWithWorldLink();
  await assert.rejects(applyWorld({ id: "x", css: ["https://evil.example/x.css"] }, doc), /outside/);
  await assert.rejects(applyWorld({ id: "x", css: ["/static/css/worlds/x/../../base.css"] }, doc), /outside/);
});

test("applyTeams sets the runtime team tokens from the teams (DC C2)", () => {
  const doc = createDocument();
  const paints = applyTeams(TEAMS, doc, NEUTRAL_LOOK);
  assert.equal(token(doc, "--sc-team-caller"), "#002a5c");
  assert.equal(token(doc, "--sc-team-caller-alt"), "#b0b7bc");
  assert.equal(token(doc, "--sc-team-caller-ink"), "#ffffff");
  assert.equal(token(doc, "--sc-team-opp"), "#bd1c36");
  assert.equal(token(doc, "--sc-team-opp-alt"), "#3e3a35");
  assert.equal(token(doc, "--sc-team-opp-ink"), "#ffffff");
  assert.equal(token(doc, "--sc-team-off"), "#002a5c", "no possession yet: the caller's offense");
  assert.equal(token(doc, "--sc-team-def"), "#bd1c36");
  assert.equal(paints.caller.fill, "#002a5c");
  assert.equal(paints.opp.fill, "#bd1c36");
});

test("applyPossession moves the offense and defense tokens with the ball", () => {
  const doc = createDocument();
  applyTeams(TEAMS, doc, NEUTRAL_LOOK);
  applyPossession("TB", doc);
  assert.equal(token(doc, "--sc-team-off"), "#bd1c36");
  assert.equal(token(doc, "--sc-team-off-ink"), "#ffffff");
  assert.equal(token(doc, "--sc-team-def"), "#002a5c");
  applyTeams(TEAMS, doc, NEUTRAL_LOOK);
  assert.equal(token(doc, "--sc-team-off"), "#bd1c36", "new teams keep the current possession");
  applyPossession(null, doc);
  assert.equal(token(doc, "--sc-team-off"), "#002a5c");
});

test("teams without colors (manual mode) and no teams at all give the neutral team", () => {
  const doc = createDocument();
  applyTeams({ DAL: { abbr: "DAL", caller: true, color: null, alt_color: null } }, doc, NEUTRAL_LOOK);
  assert.equal(token(doc, "--sc-team-caller"), "#5b6470");
  applyTeams(null, doc, NEUTRAL_LOOK);
  assert.equal(token(doc, "--sc-team-opp"), "#5b6470");
  applyPossession("DAL", createDocument());
});

test("watchMotion reports reduced or full on change and unsubscribes", () => {
  const listeners = new Set();
  const mq = { matches: false, addEventListener: (t, fn) => listeners.add(fn), removeEventListener: (t, fn) => listeners.delete(fn) };
  const seen = [];
  const stop = watchMotion((query) => { assert.equal(query, "(prefers-reduced-motion: reduce)"); return mq; },
    (m) => seen.push(m));
  mq.matches = true;
  listeners.forEach((fn) => fn());
  mq.matches = false;
  listeners.forEach((fn) => fn());
  assert.deepEqual(seen, ["reduced", "full"]);
  stop();
  assert.equal(listeners.size, 0);
  assert.equal(typeof watchMotion(undefined, () => {}), "function");
});

test("missingWorldTokens reads the computed root style", () => {
  const doc = createDocument();
  const values = Object.fromEntries(REQUIRED_TOKENS.map((t) => [t, "1px"]));
  delete values["--sc-bg"];
  doc.defaultView = { getComputedStyle: () => ({ getPropertyValue: (n) => values[n] ?? "" }) };
  assert.deepEqual(missingWorldTokens(doc), ["--sc-bg"]);
  assert.deepEqual(missingWorldTokens(createDocument()).length, REQUIRED_TOKENS.length);
});
