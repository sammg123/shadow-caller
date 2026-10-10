// Toast (ui-architecture.md 2.6, 5.1; FI 4.5; #117, #118, #121, G27; owner A9). DOM side, text only.
// Renders view.toast into the shell's #toast (role="status", aria-live="polite", kept as index.html made it): a lamp
// and the message, with the legacy hooks .show and .err mirrored by data-tone. The timers live in actions
// (toast/hide). Each new toast id is a new text node, so the live region announces it even when the words repeat;
// the words stay in the DOM after the toast hides (FI 4.5), so a world can step it out.
// G5-13: an error is an alert (role="alert", assertive) with a Dismiss key (Esc does the same, keymap.js); it holds
// 8 s, and while the pointer or keyboard focus is on it (actions.holdToast / releaseToast). The key has no text of its
// own (CSS prints its key), so the toast's words are only the message.
import { el, setAttr, setClass, setData, setHidden } from "./dom.js";
import { lamp } from "./keycap.js";

const DISMISS = Object.freeze({ label: "Dismiss (Esc)", shortcut: "Escape" });
const LIVE = Object.freeze({ info: ["status", "polite"], error: ["alert", "assertive"] });
const HOLD_ON = Object.freeze(["pointerenter", "focusin"]);
const HOLD_OFF = Object.freeze(["pointerleave", "focusout"]);

/**
 * @param {HTMLElement} root  #toast
 * @param {object} _ctx
 * @returns {{ update(toast: { id: number, text: string, err: boolean } | null): void, destroy(): void }}
 */
export function mount(root, ctx) {
  const light = lamp("sc-toast-lamp");
  let text = el("span", { cls: "sc-toast-text" });
  let shownId = null;
  let errorUp = false;
  const run = (name) => () => {
    if (errorUp) ctx?.actions?.[name]?.(shownId);
  };
  const dismiss = el("button", { cls: ["sc-key", "sc-toast-dismiss"], attrs: { type: "button", hidden: true,
    "aria-label": DISMISS.label, title: DISMISS.label, "aria-keyshortcuts": DISMISS.shortcut },
  on: { click: run("dismissToast") } });
  setClass(root, "sc-toast", true);
  root.appendChild(light);
  root.appendChild(text);
  root.appendChild(dismiss);
  const holders = [...HOLD_ON.map((type) => [type, run("holdToast")]), ...HOLD_OFF.map((type) => [type, run("releaseToast")])];
  for (const [type, fn] of holders) root.addEventListener(type, fn);

  function replaceText(words) {
    const next = el("span", { cls: "sc-toast-text", text: words });
    root.insertBefore(next, text);
    text.remove();
    text = next;
  }

  return {
    update(toast) {
      const on = Boolean(toast);
      errorUp = on && Boolean(toast.err);
      const [role, live] = errorUp ? LIVE.error : LIVE.info;
      setAttr(root, "role", role);              // before the words, so an error is announced as one
      setAttr(root, "aria-live", live);
      if (on && toast.id !== shownId) {
        shownId = toast.id;
        replaceText(String(toast.text ?? ""));
      }
      setClass(root, "show", on);
      setClass(root, "err", errorUp);
      setData(root, "tone", on ? (toast.err ? "error" : "info") : null);
      setHidden(dismiss, !errorUp);
    },
    destroy() {
      for (const [type, fn] of holders) root.removeEventListener(type, fn);
      light.remove();
      text.remove();
      dismiss.remove();
      setClass(root, "sc-toast", false);
    },
  };
}
