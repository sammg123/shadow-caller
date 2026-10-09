// The neutral world (ui-architecture.md 2.7; owner A10): deliberately plain, so the app is usable and testable
// before any world exists (?world=neutral). Its look is NEUTRAL_LOOK itself (an empty partial), its tokens are
// css/worlds/neutral/tokens.css (system fonts, G28), and its arrange builds the plain two-column page that
// css/layout.css styles: masthead, feed bar and scoreboard on top, then a main column and a rail.

/** Main column and rail, top to bottom. The DOM order is the tab order, so it stays logical. */
export const MAIN_COLUMN = Object.freeze(["situation", "field", "transport", "call", "entry", "flags", "log"]);
export const RAIL = Object.freeze(["score", "tendencies", "wp", "drives", "box", "plays"]);

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
  look: Object.freeze({}),
  css: Object.freeze(["/static/css/worlds/neutral/tokens.css"]),
  arrange,
});
