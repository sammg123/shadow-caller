// An app board on the Model Report (DOM side): the app's own component (ui/scorecard.js, tendencies.js, win-prob.js,
// drive-chart.js, box-score.js), imported unchanged and mounted in a report board's face, under the report's plate
// with the words the component's view model gives (its own title then steps aside in CSS, so it is never said twice).
import { createBoard } from "./board.js";

/**
 * @param {{ mount: Function }} mod  the app component's module
 * @param {{ plate: (vm: object) => string, testid?: string }} opts
 * @returns {{ mount(root: HTMLElement, ctx: object): { update(vm: object): void, destroy(): void } }}
 */
export function framed(mod, { plate, testid } = {}) {
  if (typeof mod?.mount !== "function") throw new TypeError("framed() needs a component module with mount()");
  if (typeof plate !== "function") throw new TypeError("framed() needs plate(vm)");
  return Object.freeze({
    mount(root, ctx) {
      const board = createBoard(root, { testid });
      const inner = mod.mount(board.face, ctx);
      return {
        update(vm) {
          board.setPlate(plate(vm));
          inner.update(vm);
        },
        destroy() {
          inner.destroy();
          board.destroy();
        },
      };
    },
  });
}
