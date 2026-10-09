// Visible notices from the shell (ui-architecture.md 9.1; owner A0). DOM side, text only (ui/dom.js).
// Two places: a region whose component did not load gets an inline note in its own root, so the page is never
// blank; the page tray (#sc-notices) holds one entry per id: a single summary of the panels that did not load,
// runtime errors per component, world problems, and at most three "something went wrong" bugs.
import { el, setData, setText } from "../ui/dom.js";

const MAX_BUGS = 3;
const SUMMARY_ID = "panels";
const SUMMARY_SHOWN = 4;

const messageOf = (err) => (err && typeof err.message === "string" && err.message ? err.message : String(err ?? ""));

function joinLabels(labels) {
  const shown = labels.slice(0, SUMMARY_SHOWN);
  const more = labels.length - shown.length;
  const list = more > 0 ? [...shown, `${more} more`] : shown;
  return list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : list[0];
}

function entryNode(id, onClose) {
  const text = el("p", { cls: "sc-notice-text" });
  const close = el("button", { cls: "sc-notice-close", attrs: { type: "button", "aria-label": "Dismiss this notice" },
    text: "Dismiss", on: { click: onClose } });
  return { node: el("div", { cls: "sc-notice", data: { notice: id } }, [text, close]), text };
}

// The functions below share one context `c` = { tray, entries: Map<id, {node, text}>, failedLabels, bugs }.
function hide(c, id) {
  c.entries.get(id)?.node.remove();
  c.entries.delete(id);
}

function show(c, id, text, { tone = "warn" } = {}) {
  if (!c.tray) return;
  if (!c.entries.has(id)) {
    const entry = entryNode(id, () => hide(c, id));
    c.entries.set(id, entry);
    c.tray.appendChild(entry.node);
  }
  const entry = c.entries.get(id);
  setText(entry.text, text);
  setData(entry.node, "tone", tone);
}

function regionNote(spec, err) {
  return el("div", { cls: "sc-region-notice", attrs: { role: "note" },
    data: { testid: "region-notice", region: spec.region, component: spec.name } }, [
    el("p", { cls: "sc-region-notice-title", text: `${spec.label} didn't load.` }),
    el("p", { cls: "sc-region-notice-detail", text: messageOf(err) }),
  ]);
}

function regionFailed(c, root, spec, err, { inline = true } = {}) {
  if (root && inline) root.appendChild(regionNote(spec, err));
  if (!c.failedLabels.includes(spec.label)) c.failedLabels.push(spec.label);
  show(c, SUMMARY_ID, `Some panels didn't load: ${joinLabels(c.failedLabels)}. Everything else works.`);
}

function bug(c, err) {
  const id = `bug:${messageOf(err)}`;
  if (c.entries.has(id) || c.bugs >= MAX_BUGS) return;
  c.bugs += 1;
  show(c, id, `Something went wrong: ${messageOf(err)}`, { tone: "error" });
}

/**
 * @param {Document} doc
 * @returns {{ show(id: string, text: string, opts?: { tone?: "warn" | "error" }): void, hide(id: string): void,
 *   has(id: string): boolean, regionFailed(root: Element | null, spec: object, err: unknown, opts?: object): void,
 *   componentError(spec: object, err: unknown): void, bug(err: unknown): void }}
 */
export function createNotices(doc) {
  const c = { tray: doc.getElementById("sc-notices"), entries: new Map(), failedLabels: [], bugs: 0 };
  return {
    show: (id, text, opts) => show(c, id, text, opts),
    hide: (id) => hide(c, id),
    has: (id) => c.entries.has(id),
    regionFailed: (root, spec, err, opts) => regionFailed(c, root, spec, err, opts),
    componentError: (spec, err) => show(c, `error:${spec?.name ?? "app"}`,
      `${spec?.label ?? "The app"} hit a problem: ${messageOf(err)}`, { tone: "error" }),
    bug: (err) => bug(c, err),
  };
}
