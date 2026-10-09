// Watch this game transport (ui-architecture.md 2.6, 3.8, 4.3, 5.4; DC E1; owner A9). DOM side, text only.
// Start (at the speed chosen beforehand), play or pause, step, stop, Back to my game and Watch again when done, the
// four speeds (exactly one pressed) and the progress readout. Each key prints the keyboard key that does the same
// thing (Space, Right, 1 to 4), because Sam drives it from the keyboard and Conor learns it by watching. Which keys
// show depends on the session state; whether a shown key works comes from transportVm (disabled otherwise). The
// confirms for start and stop live in actions. Start sends no id: actions use the feed's or the watch's event id.
import { el, setAttr, setData, setHidden, setText } from "./dom.js";
import { keycap, lamp } from "./keycap.js";

/** Keys shown per watch state; anything else shows like idle. */
const SHOWN = Object.freeze({
  idle: ["start"], stopped: ["start"], playing: ["pause", "step", "stop"], paused: ["play", "step", "stop"],
  done: ["back", "again"], error: ["start", "stop"],
});
const SPEED_KEYS = Object.freeze([[1, "1"], [2, "2"], [4, "3"], [10, "4"]]);   // speed, the digit that sets it (4.3)
/** Where focus goes when the focused key is hidden by the new state (Space or Enter on Pause lands on Play). */
const COUNTERPART = Object.freeze({ play: "pause", pause: "play", stop: "start", back: "start", again: "pause" });

function buttonSpecs(W, actions) {
  return [
    { name: "start", text: W.start, can: "canStart", run: () => actions.watchStart("") },
    { name: "play", text: W.play, cap: "Space", shortcut: "Space", can: "canPlay", run: () => actions.watchToggle() },
    { name: "pause", text: W.pause, cap: "Space", shortcut: "Space", can: "canPause",
      run: () => actions.watchToggle() },
    { name: "step", text: W.step, cap: "→", shortcut: "ArrowRight", can: "canStep", run: () => actions.watchStep() },
    { name: "stop", text: W.stop, can: "canStop", run: () => actions.watchStop() },
    { name: "back", text: W.back, can: "canBack", run: () => actions.watchStop() },
    { name: "again", text: W.again, can: "canAgain", run: () => actions.watchStart("") },
  ];
}

/** A click on a key the vm disabled or the state hides never reaches the action. */
const guarded = (node, run) => () => {
  if (!node.hidden && !node.hasAttribute("disabled")) run();
};

function buttons(ctx) {
  return buttonSpecs(ctx.copy.WATCH, ctx.actions).map((spec) => {
    const key = keycap({ cap: spec.cap ?? "", name: spec.text, shortcut: spec.shortcut ?? null,
      cls: ["sc-transport-key", `sc-transport-${spec.name}`], data: { watch: spec.name } });
    key.node.addEventListener("click", guarded(key.node, spec.run));
    return { ...spec, key };
  });
}

function speeds(ctx) {
  const W = ctx.copy.WATCH;
  return SPEED_KEYS.map(([value, digit]) => {
    const key = keycap({ cap: digit, name: W.speed(value), shortcut: digit, title: W.speedTitle,
      cls: "sc-transport-speed", attrs: { "aria-pressed": "false" }, data: { speed: value } });
    key.node.addEventListener("click", () => ctx.actions.watchSpeed(value));
    return { value, key };
  });
}

function build(ctx) {
  const W = ctx.copy.WATCH;
  const keys = buttons(ctx);
  const speedKeys = speeds(ctx);
  const progress = el("span", { cls: ["sc-transport-progress", "sc-num"], data: { testid: "watch-progress" } });
  const errorText = el("span", { cls: "sc-transport-error-text" });
  const error = el("p", { cls: "sc-transport-error", attrs: { role: "alert" }, data: { testid: "watch-error" } },
    [lamp("sc-transport-error-lamp"), errorText]);
  const speedGroup = el("div", { cls: "sc-transport-speeds", attrs: { role: "group", "aria-label": W.speedTitle } },
    speedKeys.map((s) => s.key.node));
  const node = el("div", {
    cls: "sc-transport", attrs: { role: "group", "aria-label": W.start }, data: { testid: "watch", watchState: "idle" },
  }, [el("div", { cls: "sc-transport-keys" }, keys.map((k) => k.key.node)), speedGroup, progress, error]);
  return { node, keys, speedKeys, progress, error, errorText };
}

/** Keyboard users keep their place: a focused key that just hid passes focus to its counterpart or a usable key. */
function keepFocus(parts, was) {
  if (!was || !was.key.node.hidden) return;
  const usable = (k) => k && !k.key.node.hidden && !k.key.node.hasAttribute("disabled");
  const byName = (name) => parts.keys.find((k) => k.name === name);
  const next = [byName(COUNTERPART[was.name]), ...parts.keys].find(usable);
  next?.key.node.focus({ preventScroll: true });
}

function render(parts, vm) {
  const state = typeof vm.state === "string" ? vm.state : "idle";
  const active = parts.node.ownerDocument?.activeElement;
  const was = parts.keys.find((k) => k.key.node === active) ?? null;
  setHidden(parts.node, !vm.available);
  setData(parts.node, "watchState", state);
  setData(parts.node, "active", Boolean(vm.active));
  const shown = SHOWN[state] ?? SHOWN.idle;
  for (const k of parts.keys) {
    setHidden(k.key.node, !shown.includes(k.name));
    setAttr(k.key.node, "disabled", !vm[k.can]);
  }
  keepFocus(parts, was);
  const pressed = new Set((vm.speeds ?? []).filter((s) => s.pressed).map((s) => s.value));
  for (const s of parts.speedKeys) setAttr(s.key.node, "aria-pressed", String(pressed.has(s.value)));
  setText(parts.progress, vm.progress);
  setHidden(parts.progress, !vm.progress);
  setText(parts.errorText, vm.error);
  setHidden(parts.error, !vm.error);
}

/**
 * @param {HTMLElement} root  #rg-transport
 * @param {{ actions: object, copy: object }} ctx
 * @returns {{ update(vm: ReturnType<import("../model/vm-transport.js").transportVm>): void, destroy(): void }}
 */
export function mount(root, ctx) {
  const parts = build(ctx);
  render(parts, { available: false, state: "idle", speeds: [], progress: "", error: "" });
  root.appendChild(parts.node);
  return {
    update(vm) {
      if (vm) render(parts, vm);
    },
    destroy() {
      parts.node.remove();
    },
  };
}
