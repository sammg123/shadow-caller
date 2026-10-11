// The top bar's playback (restructure-v2.md 2 and 5; ui-architecture.md 2.6, 5.4; owner: home frame). DOM side, text
// only. Left to right: step back, Play or Pause, step forward, the speeds 1x 2x 4x 10x (exactly one lit), the progress
// bar with its drive ticks (ui/progress-bar.js), Reset and Go Live. Each key prints the keyboard key that does the
// same (Left, Space, Right, 1 to 4, Esc) and names it in its tooltip, so a first-time viewer learns the keys by
// watching. What a key may do comes from transportVm (disabled otherwise); a press goes to ctx.actions, whose playback
// lane never stacks requests. While a request is in flight the group says so (aria-busy, data-busy). A focused key
// the state just disabled hands focus to the progress bar, so the keyboard keeps its place.
import { el, setAttr, setData, setHidden, setText } from "./dom.js";
import { keycap, lamp, setKeyName } from "./keycap.js";
import { createProgressBar } from "./progress-bar.js";

const IDLE_VM = Object.freeze({ state: "idle", busy: false, idx: null, total: null, target: null, at: 0, count: "",
  valueText: "", playing: false, playLabel: "", live: false, speeds: [], marks: [], driveStarts: [], canBack: false,
  canPlay: false, canForward: false, canReset: false, canGoLive: false, canSeek: false, error: "" });

function keySpecs(W) {
  return [
    { name: "back", cap: "←", text: W.back, title: W.backTitle, shortcut: "ArrowLeft", can: "canBack", run: "stepBack" },
    { name: "play", cap: "Space", text: W.play, title: W.playTitle, shortcut: "Space", can: "canPlay", run: "togglePlay" },
    { name: "forward", cap: "→", text: W.forward, title: W.forwardTitle, shortcut: "ArrowRight", can: "canForward",
      run: "stepForward" },
  ];
}

/** A click on a key the vm disabled never reaches the action. */
const guarded = (node, run) => () => {
  if (!node.hasAttribute("disabled")) run();
};

function transportKey(ctx, spec, extra = {}) {
  const key = keycap({ cap: spec.cap ?? "", name: spec.text, shortcut: spec.shortcut ?? null, title: spec.title,
    cls: ["sc-transport-key", `sc-transport-${spec.name}`], data: { transport: spec.name }, ...extra });
  key.node.addEventListener("click", guarded(key.node, () => ctx.actions[spec.run]()));
  return { ...spec, key };
}

function speeds(ctx) {
  const W = ctx.copy.WATCH;
  return [[1, "1"], [2, "2"], [4, "3"], [10, "4"]].map(([value, digit]) => {
    const key = keycap({ cap: digit, name: W.speed(value), shortcut: digit, title: W.speedTitle(value, digit),
      cls: ["sc-transport-key", "sc-transport-speed"], attrs: { "aria-pressed": "false" }, data: { speed: value } });
    key.node.addEventListener("click", () => ctx.actions.setSpeed(value));
    return { value, key };
  });
}

function build(ctx) {
  const W = ctx.copy.WATCH;
  const steps = keySpecs(W).map((spec) => transportKey(ctx, spec));
  const reset = transportKey(ctx, { name: "reset", text: W.reset, title: W.resetTitle, can: "canReset", run: "reset" });
  const live = transportKey(ctx, { name: "live", cap: "Esc", text: W.goLive, title: W.goLiveTitle, shortcut: "Escape",
    can: "canGoLive", run: "goLive" });
  const liveLamp = lamp("sc-transport-live-lamp");
  live.key.node.insertBefore(liveLamp, live.key.name);
  const speedKeys = speeds(ctx);
  const bar = createProgressBar(ctx, IDLE_VM);
  const errorText = el("span", { cls: "sc-transport-error-text" });
  const error = el("p", { cls: "sc-transport-error", attrs: { role: "alert" }, data: { testid: "watch-error" } },
    [lamp("sc-transport-error-lamp"), errorText]);
  const speedGroup = el("div", { cls: "sc-transport-speeds", attrs: { role: "group", "aria-label": W.speedGroup } },
    speedKeys.map((s) => s.key.node));
  const node = el("div", { cls: "sc-transport", attrs: { role: "group", "aria-label": W.group },
    data: { testid: "transport", state: "idle" } },
  [el("div", { cls: "sc-transport-keys" }, steps.map((k) => k.key.node)), speedGroup, bar.node, reset.key.node,
    live.key.node, error]);
  return { node, keys: [...steps, reset, live], play: steps[1], live, liveLamp, speedKeys, bar, error, errorText };
}

function render(parts, vm) {
  const active = parts.node.ownerDocument?.activeElement;
  const hadFocus = parts.keys.find((k) => k.key.node === active) ?? null;
  setData(parts.node, "state", vm.state);
  setData(parts.node, "busy", vm.busy);
  setAttr(parts.node, "aria-busy", vm.busy ? "true" : null);
  for (const k of parts.keys) setAttr(k.key.node, "disabled", !vm[k.can]);
  setKeyName(parts.play.key, vm.playLabel || parts.play.text);
  setData(parts.play.key.node, "playing", vm.playing);
  setData(parts.live.key.node, "live", vm.live);
  setData(parts.liveLamp, "on", vm.live);
  const pressed = new Set(vm.speeds.filter((s) => s.pressed).map((s) => s.value));
  for (const s of parts.speedKeys) setAttr(s.key.node, "aria-pressed", String(pressed.has(s.value)));
  parts.bar.update(vm);
  setText(parts.errorText, vm.error);
  setHidden(parts.error, !vm.error);
  if (hadFocus && hadFocus.key.node.hasAttribute("disabled")) parts.bar.track.focus({ preventScroll: true });
}

/**
 * @param {HTMLElement} root  #rg-masthead (the top bar: the masthead's plate before it, the view keys after it)
 * @param {{ actions: object, copy: object }} ctx
 * @returns {{ update(vm: ReturnType<import("../model/vm-transport.js").transportVm>): void, destroy(): void }}
 */
export function mount(root, ctx) {
  const parts = build(ctx);
  render(parts, IDLE_VM);
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
