// The shorthand bar (FI 1.8, 2.6; ui-architecture.md 2.6, 4.5; checklist #78 to #84; owner A7). DOM side, text only.
// One text box (#cmd) and Run (#cmdBtn). Enter in the box runs the line and never logs the picked play (#84): the
// global keyboard ignores keys typed in a text box, and this box's own Enter runs it. A line that worked clears the
// box; a refused one stays for fixing (#83). Lines go out in order (the actions queue is FIFO): a new line typed while
// one is out runs after it (#82), a repeat Enter on the line already out is ignored, and an answer never wipes text
// typed since. #cmdBtn[aria-busy] while any line is out. The bar is static: it has no view model (9.1).
import { inputKeyAction } from "../core/keymap.js";
import { el, setAttr } from "./dom.js";
import { act } from "./input-kit.js";

function build(copy, onRun) {
  const input = el("input", { id: "cmd", cls: "sc-short-input", attrs: { type: "text",
    placeholder: copy.shorthandPlaceholder, "aria-label": copy.shorthandAria, autocomplete: "off",
    autocapitalize: "characters", spellcheck: "false", enterkeyhint: "go" } });
  const button = el("button", { id: "cmdBtn", cls: "sc-short-run", attrs: { type: "button" }, text: copy.shorthandRun,
    on: { click: onRun } });
  return { input, button, node: el("div", { cls: "sc-short" }, [input, button]) };
}

/**
 * @param {HTMLElement} root  [data-mount="shorthand"]
 * @param {{ actions: object, copy: { ENTRY: object } }} ctx
 * @returns {{ update(): void, destroy(): void }}
 */
export function mount(root, ctx) {
  const out = [];                                     // lines sent and not answered yet, in order
  let bar = null;
  const run = () => {
    const text = String(bar.input.value ?? "");
    if (text.trim() === "" || out.includes(text)) return;
    out.push(text);
    setAttr(bar.button, "aria-busy", "true");
    act(() => ctx.actions.runShorthand(text)).then((res) => {
      out.splice(out.indexOf(text), 1);
      if (out.length === 0) setAttr(bar.button, "aria-busy", null);
      if (res?.ok && bar.input.value === text) bar.input.value = "";
    });
  };
  bar = build(ctx.copy.ENTRY, run);
  bar.input.addEventListener("keydown", (e) => {
    const hit = inputKeyAction("cmd", e.key);
    if (!hit) return;
    if (hit.prevent) e.preventDefault();
    run();
  });
  root.appendChild(bar.node);
  return {
    update() {},
    destroy() {
      bar.node.remove();
    },
  };
}
