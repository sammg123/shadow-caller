// The last play and its retag keys (FI 1.7, 2.8, 3.6; ui-architecture.md 2.6, G19; checklist #96, #97, #100, #103;
// owner A7). DOM side, text only (G27: ESPN's play text is external data). Shown with the feed on and during a watch:
// the row a retag edits (newest standing row of any source), its yards, ESPN's text, and the retag keys, the one
// matching the row's family marked current (.cur, aria-current). A retag key clicked while a watched game plays
// pauses it first (DC E2.8). World hooks: #lastPlay[data-kind="waiting" | "play"], and #lastPlay[data-fresh="true"]
// for RETAG_FRESH_MS after each new caller play (DESIGN.md: the retag keys light amber for 8 s, then rest).
import { el, reconcile, setAttr, setClass, setData, setHidden, setText } from "./dom.js";
import { act, keyCap, setKeyCap } from "./input-kit.js";

export const RETAG_FRESH_MS = 8000;

const browserTimers = Object.freeze({
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id),
});

function build(onRetag) {
  const heading = el("h2", { cls: "sc-last-heading" });
  const name = el("p", { cls: "sc-last-name" });
  const yards = el("p", { cls: ["sc-last-yards", "sc-num"] });
  const text = el("p", { cls: "sc-last-text" });
  const keys = el("div", { cls: "sc-retag", attrs: { role: "group" } });
  return { nodes: [heading, name, yards, text, keys], heading, name, yards, text, keys, onRetag };
}

function renderKeys(view, buttons) {
  setHidden(view.keys, buttons.length === 0);
  reconcile(view.keys, buttons, {
    key: (b) => b.key,
    create: (b) => keyCap({ key: b.key, name: b.label, cls: ["sc-retag-key"], data: { retag: b.key },
      on: { click: () => view.onRetag(b.key) } }),
    update: (node, b) => {
      setKeyCap(node, { key: b.key, name: b.label });
      setData(node, "tone", b.tone);
      setClass(node, "cur", Boolean(b.current));
      setAttr(node, "aria-current", b.current ? "true" : null);
    },
  });
}

/** data-fresh: true for RETAG_FRESH_MS after the row becomes a newer play; the play shown at load, a retag (same row)
 * and an undo (an older row) are not news. */
function createFreshness(root, timers) {
  const s = { seq: undefined, timer: null };
  const stop = () => {
    if (s.timer !== null) timers.clearTimeout(s.timer);
    s.timer = null;
  };
  return {
    see(seq) {
      const first = s.seq === undefined;
      const newer = !first && seq !== null && (s.seq === null || seq > s.seq);
      s.seq = seq;
      if (!newer) {
        if (s.timer === null) setData(root, "fresh", false);   // a lit window runs out on its own
        return;
      }
      stop();
      setData(root, "fresh", true);
      s.timer = timers.setTimeout(() => {
        s.timer = null;
        setData(root, "fresh", false);
      }, RETAG_FRESH_MS);
    },
    stop,
  };
}

/**
 * @param {HTMLElement} root  #lastPlay
 * @param {{ actions: object, timers?: { setTimeout: Function, clearTimeout: Function } }} ctx
 *   timers: injected by tests; the page uses the browser's, called bare
 * @returns {{ update(vm: object | null): void, destroy(): void }}
 */
export function mount(root, ctx) {
  const state = { pauseFirst: false, ariaLabel: "" };
  const view = build((key) => act(() => ctx.actions.retag(key, { pauseFirst: state.pauseFirst })));
  for (const node of view.nodes) root.appendChild(node);
  setAttr(root, "role", "region");
  const fresh = createFreshness(root, ctx.timers ?? browserTimers);
  return {
    update(vm) {
      const v = vm ?? { hidden: true, kind: "waiting", buttons: [] };
      state.pauseFirst = Boolean(v.pauseFirst);
      setHidden(root, v.hidden !== false);
      setData(root, "kind", v.kind === "play" ? "play" : "waiting");
      setText(view.heading, v.heading ?? "");
      setText(view.name, v.name ?? "");
      setHidden(view.name, !v.name);
      setText(view.yards, v.yardsText ?? "");
      setHidden(view.yards, !v.yardsText);
      setText(view.text, v.text ?? "");
      setHidden(view.text, !v.text);
      setAttr(root, "aria-label", v.heading || null);
      renderKeys(view, Array.isArray(v.buttons) ? v.buttons : []);
      if (v.hidden === false) fresh.see(Number.isInteger(v.seq) ? v.seq : null);
    },
    destroy() {
      fresh.stop();
      for (const node of view.nodes) node.remove();
    },
  };
}
