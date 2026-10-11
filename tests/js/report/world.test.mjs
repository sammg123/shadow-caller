// The Model Report's worlds (static/js/report/world.js): the stylesheets and fonts each world loads for this page
// (the world's own tokens and component skins, never its 3D scene modules), the team-paint rule, and the GameCast link
// that keeps the world the report was opened in.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { NEUTRAL_LOOK } from "../../../static/js/theme/neutral-look.js";
import { look as ULS_LOOK } from "../../../static/js/theme/worlds/under-the-lights/look.js";
import { DEFAULT_WORLD, WORLDS } from "../../../static/js/theme/worlds/index.js";
import { REPORT_DEFAULT_WORLD, REPORT_WORLDS, chooseReportWorld, gamecastHref, reportWorld }
  from "../../../static/js/report/world.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const onDisk = (href) => existsSync(join(ROOT, href.replace(/^\//, "")));

test("the GameCast's worlds and default, without importing its world loaders", () => {
  assert.deepEqual(Object.keys(REPORT_WORLDS).sort(), Object.keys(WORLDS).sort());
  assert.equal(REPORT_DEFAULT_WORLD, DEFAULT_WORLD);
  assert.equal(reportWorld(DEFAULT_WORLD).id, "under-the-lights");
  assert.equal(reportWorld("neutral").id, "neutral");
  assert.equal(reportWorld("no-such-world").id, "neutral", "an unknown id falls back to the plain world");
});

test("the choice runs as the GameCast's: the address, then the stored choice, then the default", () => {
  assert.deepEqual(chooseReportWorld({ query: "neutral", stored: "under-the-lights" }), { id: "neutral", ignored: [] });
  assert.deepEqual(chooseReportWorld({ query: null, stored: "neutral" }), { id: "neutral", ignored: [] });
  assert.deepEqual(chooseReportWorld({}), { id: "under-the-lights", ignored: [] });
  assert.deepEqual(chooseReportWorld({ query: "mars", stored: "venus" }),
    { id: "under-the-lights", ignored: ["mars", "venus"] });
});

test("every stylesheet and font a world lists exists, inside that world's own folders", () => {
  for (const world of Object.values(REPORT_WORLDS)) {
    for (const href of world.css) {
      assert.ok(href.startsWith(`/static/css/worlds/${world.id}/`), href);
      assert.ok(onDisk(href), `${href} is missing`);
    }
    for (const href of world.fonts) {
      assert.ok(href.startsWith(`/static/fonts/${world.id}/`), href);
      assert.ok(onDisk(href), `${href} is missing`);
    }
  }
});

test("Under the Lights brings its tokens, the shared LED parts, the reused boards' skins, then the report's own", () => {
  const css = REPORT_WORLDS["under-the-lights"].css.map((href) => href.replace("/static/css/worlds/under-the-lights/", ""));
  assert.equal(css[0], "tokens.css");
  assert.deepEqual(css.slice(-2), ["report/report.css", "report/boards.css"], "the report's skins win ties");
  for (const part of ["motion.css", "components/masthead.css", "components/scoreboard.css", "components/scorecard.css",
    "components/tendencies.css", "components/box-score.css", "components/win-prob.css", "components/drive-chart.css",
    "components/boot-screen.css", "components/conn-banner.css"]) assert.ok(css.includes(part), part);
  assert.ok(!css.some((href) => href === "layout.css" || href === "booth.css"), "no stadium layout on this page");
  assert.equal(REPORT_WORLDS["under-the-lights"].ambient, "dark");
});

test("team paint follows each world's own legibility rule, the one its look gives the GameCast", () => {
  assert.deepEqual(REPORT_WORLDS["under-the-lights"].teamColor, ULS_LOOK.teamColor);
  assert.deepEqual(REPORT_WORLDS.neutral.teamColor, NEUTRAL_LOOK.teamColor);
});

test("the GameCast link keeps a world named in the address, and only a known one", () => {
  assert.equal(gamecastHref(""), "/");
  assert.equal(gamecastHref("?world=neutral"), "/?world=neutral");
  assert.equal(gamecastHref("?world=under-the-lights&x=1"), "/?world=under-the-lights");
  assert.equal(gamecastHref("?world=javascript:alert(1)"), "/");
  assert.equal(gamecastHref("?world=mars"), "/");
});
