// The neutral world (ui-architecture.md 2.7; owner A10; restructure-v2.md 1, 2 and 4 by the home frame): deliberately
// plain, so the app is usable and testable before any world exists (?world=neutral). Its look is NEUTRAL_LOOK with the
// GameCast's two cameras (Wide, the default, following the ball sideways, and Blimp), its tokens are
// css/worlds/neutral/tokens.css (system fonts, G28), and its arrange builds the plain page that css/layout.css styles:
// the top bar and the scoreboard across the top, then a main column and a rail. It has no settings menu.

/** Main column and rail, top to bottom. The DOM order is the tab order, so it stays logical. */
export const MAIN_COLUMN = Object.freeze(["field", "call"]);
export const RAIL = Object.freeze(["wp", "drives", "plays"]);

/** restructure-v2.md 4: two views only, toggled with V. Wide is the neutral look's sideline view; Blimp is the stadium
 * world's rig through a longer lens, which fills this page's shorter field band (at 30 degrees the field sat small in
 * it and 95 of 156 plays' words fell on their own play; at 20 it is 8, as under the lights: play-label.test.mjs). */
const CAMERAS = Object.freeze({
  modes: Object.freeze([
    Object.freeze({ id: "wide", label: "Wide", rig: "sideline", fov: 24, height: 32, back: 75, follow: "pan", cut: false }),
    Object.freeze({ id: "blimp", label: "Blimp", rig: "blimp", fov: 20, height: 300, back: 140, follow: "none",
      cut: false }),
  ]),
  default: "wide",
});

function column(app, cls) {
  const found = [...app.children].find((node) => node.getAttribute("class") === cls);
  if (found) return found;
  const node = app.ownerDocument.createElement("div");
  node.setAttribute("class", cls);
  app.appendChild(node);
  return node;
}

/** Wrap the regions in the two columns (idempotent; never removes or renames a region or an id). */
function arrange(app, regions) {
  const main = column(app, "sc-col sc-col-main");
  const rail = column(app, "sc-col sc-col-rail");
  for (const name of MAIN_COLUMN) if (regions[name]) main.appendChild(regions[name]);
  for (const name of RAIL) if (regions[name]) rail.appendChild(regions[name]);
  app.appendChild(main);
  app.appendChild(rail);
  app.setAttribute("data-layout", "neutral");
}

export default Object.freeze({
  id: "neutral",
  label: "Neutral",
  look: Object.freeze({ cameras: CAMERAS }),
  css: Object.freeze(["/static/css/worlds/neutral/tokens.css"]),
  arrange,
});
