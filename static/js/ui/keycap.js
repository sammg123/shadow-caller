// Key caps and lamps for the chrome components (ui-architecture.md v1.2, 9.6; owner A9). DOM side, through ui/dom.js.
// A key is a button (or a link) with the keyboard key printed on its cap, its name, and an optional value: the cap
// is decoration (aria-hidden), the name is the label and aria-keyshortcuts names the key, so Sam learns the keys by
// seeing them and a screen reader hears the name once. A lamp is a decorative circle a world lights through data
// attributes; it always sits beside words that say the same thing (DESIGN.md "Lamp").
import { el, setText } from "./dom.js";

const toList = (cls) => (Array.isArray(cls) ? cls : [cls]).filter((c) => typeof c === "string" && c !== "");

/**
 * @param {{ tag?: "button" | "a", cap?: string, name?: string, value?: string | null, shortcut?: string | null,
 *   title?: string, id?: string, cls?: string | string[], attrs?: object, data?: object, on?: object }} opts
 * @returns {{ node: HTMLElement, cap: HTMLElement | null, name: HTMLElement, value: HTMLElement | null }}
 */
export function keycap({ tag = "button", cap = "", name = "", value = null, shortcut = null, title, id, cls = [],
  attrs = {}, data = {}, on = {} } = {}) {
  const capNode = cap ? el("span", { cls: "sc-key-cap", attrs: { "aria-hidden": "true" }, text: cap }) : null;
  const nameNode = el("span", { cls: "sc-key-name", text: name });
  const valueNode = value === null ? null : el("span", { cls: "sc-key-value", text: value });
  const base = tag === "button" ? { type: "button" } : {};
  const node = el(tag, {
    id, cls: ["sc-key", ...toList(cls)], data, on,
    attrs: { ...base, title, "aria-keyshortcuts": shortcut, ...attrs },
  }, [capNode, nameNode, valueNode]);
  return { node, cap: capNode, name: nameNode, value: valueNode };
}

export function setKeyName(key, text) {
  setText(key.name, text);
}

export function setKeyValue(key, text) {
  if (key.value) setText(key.value, text);
}

/** A decorative lamp; `cls` adds the component's own class. */
export function lamp(cls) {
  return el("span", { cls: ["sc-lamp", ...toList(cls)], attrs: { "aria-hidden": "true" } });
}
