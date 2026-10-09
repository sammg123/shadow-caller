// Toast (ui-architecture.md 2.6, 5.1; FI 4.5; #117, #118, #121, G27; owner A9). DOM side, text only.
// Renders view.toast into the shell's #toast (role="status", aria-live="polite", kept as index.html made it): a lamp
// and the message, with the legacy hooks .show and .err mirrored by data-tone. The 2.6 s timer lives in actions
// (toast/hide). Each new toast id is a new text node, so the live region announces it even when the words repeat;
// the words stay in the DOM after the toast hides (FI 4.5), so a world can step it out.
import { el, setClass, setData } from "./dom.js";
import { lamp } from "./keycap.js";

/**
 * @param {HTMLElement} root  #toast
 * @param {object} _ctx
 * @returns {{ update(toast: { id: number, text: string, err: boolean } | null): void, destroy(): void }}
 */
export function mount(root, _ctx) {
  const light = lamp("sc-toast-lamp");
  let text = el("span", { cls: "sc-toast-text" });
  let shownId = null;
  setClass(root, "sc-toast", true);
  root.appendChild(light);
  root.appendChild(text);

  function replaceText(words) {
    const next = el("span", { cls: "sc-toast-text", text: words });
    root.insertBefore(next, text);
    text.remove();
    text = next;
  }

  return {
    update(toast) {
      const on = Boolean(toast);
      if (on && toast.id !== shownId) {
        shownId = toast.id;
        replaceText(String(toast.text ?? ""));
      }
      setClass(root, "show", on);
      setClass(root, "err", on && Boolean(toast.err));
      setData(root, "tone", on ? (toast.err ? "error" : "info") : null);
    },
    destroy() {
      light.remove();
      text.remove();
      setClass(root, "sc-toast", false);
    },
  };
}
