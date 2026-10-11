// A Model Report board (DOM side, through ui/dom.js): the cabinet every section hangs in, a painted plate (its h2)
// over an LED face. report.html ships each board's section with its plate, so the page reads before any script runs
// and a board whose component fails keeps its name; the component takes the plate's words and fills the face.
import { el, setText } from "../../ui/dom.js";

const hasClass = (node, cls) => (node.getAttribute("class") ?? "").split(/\s+/).includes(cls);
const childWith = (root, cls) => [...root.children].find((node) => hasClass(node, cls)) ?? null;

/**
 * @param {HTMLElement} root  the board's section
 * @param {{ testid?: string }} [opts]  a test hook on the face
 * @returns {{ face: HTMLElement, setPlate(text: string): void, destroy(): void }}
 */
export function createBoard(root, { testid } = {}) {
  const plate = childWith(root, "rp-plate") ?? root.insertBefore(el("h2", { cls: "rp-plate" }), root.firstChild);
  const face = el("div", { cls: "rp-face", data: testid ? { testid } : {} });
  root.appendChild(face);
  return {
    face,
    setPlate: (text) => { if (text) setText(plate, text); },
    destroy: () => face.remove(),
  };
}
