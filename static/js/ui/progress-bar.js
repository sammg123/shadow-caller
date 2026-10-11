// The top bar's progress bar (restructure-v2.md 2: "a progress bar with drive ticks (click or drag to jump to any
// play)"; owner: home frame). DOM side, text only. A slider over the game's ESPN plays, 0 (kickoff) to the total: the
// played part lit, a tick per drive start, quarter and score (watch.marks), the knob where the game is (a seek's target
// while it runs), and the count beside it ("104 / 183"). A click jumps; a drag moves the knob and jumps where it is let
// go, so a drag sends one seek, not one per pixel. Its own keys (core/keymap.js leaves them to a focused slider):
// Left and Right one drawn play back and forward, Page Up and Page Down the drive before and after, Home kickoff, End
// Go Live, Space play or pause. Every move goes through ctx.actions, which never stacks requests.
import { own } from "../core/domain.js";
import { el, reconcile, setAttr, setData, setText } from "./dom.js";

const MAIN_BUTTON = 0;
const FRACTION_DP = 5;

/** A key's move on the focused bar: an action name, or (drive keys) the direction to the next drive start. */
const KEY_ACTIONS = Object.freeze({ ArrowLeft: "stepBack", ArrowDown: "stepBack", ArrowRight: "stepForward",
  ArrowUp: "stepForward", Home: "reset", End: "goLive", " ": "togglePlay", Spacebar: "togglePlay" });
const DRIVE_KEYS = Object.freeze({ PageUp: -1, PageDown: 1 });

function build(ctx) {
  const W = ctx.copy.WATCH;
  const hidden = { "aria-hidden": "true" };
  const fill = el("span", { cls: "sc-progress-fill", attrs: hidden });
  const marks = el("ol", { cls: "sc-progress-marks", attrs: hidden });
  const knob = el("span", { cls: "sc-progress-knob", attrs: hidden });
  const track = el("div", {
    cls: "sc-progress-track",
    attrs: { role: "slider", tabindex: "0", "aria-label": W.progress, "aria-orientation": "horizontal",
      "aria-valuemin": "0", title: W.progressTitle },
    data: { testid: "progress" },
  }, [fill, marks, knob]);
  const countText = el("span", { cls: ["sc-progress-count", "sc-num"], attrs: hidden, data: { testid: "progress-count" } });
  const node = el("div", { cls: "sc-progress" }, [track, countText]);
  return { node, track, fill, marks, knob, countText };
}

function markItem(node, m) {
  setData(node, "kind", m.kind);
  setData(node, "team", m.team || null);
  setData(node, "caller", m.kind === "quarter" ? null : m.caller);
  setAttr(node, "title", m.label || null);
  node.style.setProperty("--sc-at", String(m.at));
}

/** Where the knob shows: a drag's own spot while dragging, else the game's (or a seek's target). */
function renderKnob(p, st) {
  const at = st.drag ? st.drag.at : st.vm.at;
  p.track.style.setProperty("--sc-at", String(at));
  const idx = st.drag ? st.drag.idx : st.vm.target ?? st.vm.idx;
  setText(p.countText, st.drag && st.vm.total ? st.ctx.copy.WATCH.count(idx, st.vm.total) : st.vm.count);
}

function render(p, st) {
  const { vm } = st;
  reconcile(p.marks, vm.marks, { key: (m) => m.key, create: () => el("li", { cls: "sc-progress-mark" }),
    update: markItem });
  setAttr(p.track, "aria-valuemax", vm.total ?? 0);
  setAttr(p.track, "aria-valuenow", vm.target ?? vm.idx ?? 0);
  setAttr(p.track, "aria-valuetext", vm.valueText || null);
  setAttr(p.track, "aria-disabled", vm.canSeek ? null : "true");
  setData(p.track, "live", vm.live);
  renderKnob(p, st);
}

// ---------------------------------------------------------------- pointer: click or drag to jump
/** The play count under the pointer, or null when the bar can't be measured or can't seek. */
function pointAt(p, st, e) {
  const box = p.track.getBoundingClientRect?.();
  const total = st.vm.total;
  if (!st.vm.canSeek || !box || !(box.width > 0) || !total) return null;
  const f = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
  const idx = Math.round(f * total);
  return { idx, at: Number((idx / total).toFixed(FRACTION_DP)) };
}

function onPointerDown(p, st, e) {
  if (e.button !== MAIN_BUTTON) return;
  const point = pointAt(p, st, e);
  if (!point) return;
  e.preventDefault();
  p.track.setPointerCapture?.(e.pointerId);
  st.drag = point;
  setData(p.node, "dragging", true);
  renderKnob(p, st);
}

function onPointerMove(p, st, e) {
  if (!st.drag) return;
  st.drag = pointAt(p, st, e) ?? st.drag;
  renderKnob(p, st);
}

function endDrag(p, st, e, { jump }) {
  if (!st.drag) return;
  const { idx } = st.drag;
  st.drag = null;
  setData(p.node, "dragging", null);
  if (e && e.pointerId !== undefined) p.track.releasePointerCapture?.(e.pointerId);
  if (jump) st.ctx.actions.seek(idx);
  renderKnob(p, st);
}

// ---------------------------------------------------------------- keys on the focused bar
function driveStart(vm, delta) {
  const here = vm.target ?? vm.idx ?? 0;
  const starts = vm.driveStarts;
  return delta > 0 ? starts.find((s) => s > here) : [...starts].reverse().find((s) => s < here);
}

function onKey(st, e) {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const action = own(KEY_ACTIONS, e.key);
  const drive = own(DRIVE_KEYS, e.key);
  if (action === undefined && drive === undefined) return;
  e.preventDefault();
  if (e.repeat && (action === "togglePlay" || action === "goLive" || action === "reset")) return;
  if (action) {
    st.ctx.actions[action]();
    return;
  }
  const target = st.vm.canSeek ? driveStart(st.vm, drive) : undefined;
  if (target !== undefined) st.ctx.actions.seek(target);
}

function wire(p, st) {
  p.track.addEventListener("pointerdown", (e) => onPointerDown(p, st, e));
  p.track.addEventListener("pointermove", (e) => onPointerMove(p, st, e));
  p.track.addEventListener("pointerup", (e) => endDrag(p, st, e, { jump: true }));
  p.track.addEventListener("pointercancel", (e) => endDrag(p, st, e, { jump: false }));
  p.track.addEventListener("lostpointercapture", (e) => endDrag(p, st, e, { jump: false }));
  p.track.addEventListener("keydown", (e) => onKey(st, e));
}

/**
 * @param {{ actions: object, copy: object }} ctx
 * @param {object} vm  the first transportVm
 * @returns {{ node: HTMLElement, track: HTMLElement, update(vm: object): void }}
 */
export function createProgressBar(ctx, vm) {
  const parts = build(ctx);
  const st = { ctx, vm, drag: null };
  wire(parts, st);
  render(parts, st);
  return {
    node: parts.node,
    track: parts.track,
    update(next) {
      st.vm = next;
      render(parts, st);
    },
  };
}
