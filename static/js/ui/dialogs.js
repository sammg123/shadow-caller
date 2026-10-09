// Confirm dialogs (ui-architecture.md 2.6, 3.3, 3.8; FI 3.10; owner A9). DOM side.
// confirmAction is the browser's own confirm behind a promise: a real, modal, keyboard-ready dialog that the e2e
// tests accept or dismiss (#89 Reset, #106 Replay, Watch start and stop). The answer is always a boolean, and
// anything that goes wrong (no confirm, a browser that blocks dialogs) counts as No, so nothing destructive runs.

/**
 * @param {unknown} text  the question, shown as text
 * @returns {Promise<boolean>}
 */
export function confirmAction(text) {
  try {
    if (typeof globalThis.confirm !== "function") return Promise.resolve(false);
    return Promise.resolve(Boolean(globalThis.confirm(String(text))));
  } catch {
    return Promise.resolve(false);
  }
}
