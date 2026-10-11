// The question box's keys (pure; docs/design/analyst-ui.md). Enter asks (with Ctrl or Cmd too); Shift+Enter and
// Alt+Enter leave the new line to the box; nothing is sent while an input method is composing (isComposing, or the
// 229 key code some browsers send instead). A plain Escape belongs to the panel (it closes the slide-out). The app's
// own shortcuts never fire in the box: core/keyboard.js classifies a textarea as text, and the keymap ignores text.

const IME_KEYCODE = 229;

const composing = (e) => Boolean(e.isComposing) || e.keyCode === IME_KEYCODE;

/**
 * What a keydown in the question box does: "send", or null (the box types it).
 * @param {{ key: string, shiftKey?: boolean, altKey?: boolean, ctrlKey?: boolean, metaKey?: boolean,
 *   isComposing?: boolean, keyCode?: number } | null | undefined} e
 * @returns {"send" | null}
 */
export function composerAction(e) {
  if (!e || composing(e) || e.key !== "Enter") return null;
  return e.shiftKey || e.altKey ? null : "send";
}

/**
 * Escape with no modifier, outside an input method's composition.
 * @param {{ key: string, shiftKey?: boolean, altKey?: boolean, ctrlKey?: boolean, metaKey?: boolean,
 *   isComposing?: boolean, keyCode?: number } | null | undefined} e
 */
export function isPlainEscape(e) {
  if (!e || composing(e) || (e.key !== "Escape" && e.key !== "Esc")) return false;
  return !(e.shiftKey || e.altKey || e.ctrlKey || e.metaKey);
}
