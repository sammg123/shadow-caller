// Review banner (ui-architecture.md 2.2 review, 2.6, 5.4, 9.1; owner A9). DOM side, text only.
// While Left/Right review a past play (client only: the server is never rewound), a tag on the field names it
// ("Reviewing DAL, Q2 8:41, ... Esc returns to live.") with keys to step earlier, later, and back to live, so a
// mouse or a phone can leave review too. A polite line beside it (always rendered, so the first step is heard)
// speaks each reviewed play. It shares #rg-field with the field host: it appends its banner and that line after
// #field and never touches anything else there (main.js mounts it; the field host does not).
import { el, setData, setHidden, setText } from "./dom.js";
import { keycap, lamp } from "./keycap.js";

function keys(ctx) {
  const R = ctx.copy.REVIEW;
  const key = (id, cap, shortcut, run) => keycap({ cap, name: R[id], shortcut, cls: "sc-review-key",
    data: { review: id }, on: { click: run } });
  return [
    key("earlier", "←", "ArrowLeft", () => ctx.actions.review(-1)),
    key("later", "→", "ArrowRight", () => ctx.actions.review(1)),
    key("live", "Esc", "Escape", () => ctx.actions.exitReview()),
  ];
}

/**
 * @param {HTMLElement} root  #rg-field (shared with the field host)
 * @param {{ actions: object, copy: object }} ctx
 * @returns {{ update(vm: ReturnType<import("../model/vm-review.js").reviewVm>): void, destroy(): void }}
 */
export function mount(root, ctx) {
  const text = el("p", { cls: "sc-review-text" });
  const banner = el("div", { cls: "sc-review", data: { testid: "review" } }, [
    lamp("sc-review-lamp"), text, el("div", { cls: "sc-review-keys" }, keys(ctx).map((k) => k.node)),
  ]);
  const live = el("p", { cls: ["sc-review-live", "sr-only"], attrs: { role: "status", "aria-live": "polite" } });
  setHidden(banner, true);
  root.appendChild(banner);
  root.appendChild(live);
  return {
    update(vm) {
      const active = Boolean(vm?.active);
      setHidden(banner, !active);
      setData(banner, "seq", active ? vm.seq : null);
      setText(text, active ? vm.text : "");
      setText(live, active ? vm.text : "");
    },
    destroy() {
      banner.remove();
      live.remove();
    },
  };
}
