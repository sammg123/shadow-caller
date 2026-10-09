// Replay scrub (owner W5; ui-architecture.md v1.4, section 19; DESIGN.md Watch transport, Control desk). DOM side,
// text only. The game so far as one strip you drag to put any drawn play back on the field: drives in their team's
// tone, scores, turnovers and quarter starts as marks, and a knob on the reviewed play or at the live edge. It shares
// the transport's region (#rg-transport) and appends after it, like the review banner beside the field. Review only:
// every move is actions.reviewAt (the client's review cursor), actions.review(-1) or actions.exitReview, so the
// server's game is never stepped, paused or restarted (3.8: never seek by stopping and restarting).
//
// Keys: ← reviews an earlier play (as the Left key does) and LIVE (Esc) returns to the live edge. On the strip, which
// is a slider: Left and Right step a play, Page Up and Page Down a drive, Home the first play, End live, Esc live;
// Space and 1 to 4 keep driving the watch, as they do everywhere else. A mouse press does not move keyboard focus,
// so the page's shortcuts keep working after a scrub. Hovering previews the play under the pointer on the readout.
import { reconcile, el, setAttr, setData, setHidden, setText } from "./dom.js";
import { keycap, lamp } from "./keycap.js";
import { scrubVm, seqAtFraction, stepFrom } from "../model/vm-scrub.js";

const STEP_KEYS = Object.freeze({ ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, Home: -Infinity,
  End: Infinity });
const DRIVE_KEYS = Object.freeze({ PageUp: -1, PageDown: 1 });
const SPEED_KEYS = Object.freeze({ 1: 1, 2: 2, 3: 4, 4: 10 });   // the digit, the speed (keymap 4.3)
const SPACE = new Set([" ", "Spacebar"]);
const MAIN_BUTTON = 0;
const FRACTION_DP = 5;
const HALF_SLOT = 0.5;
const own = (table, key) => (Object.hasOwn(table, key) ? table[key] : undefined);
const slotCenter = (seq, total) => String(Number(((seq - HALF_SLOT) / total).toFixed(FRACTION_DP)));

// ---------------------------------------------------------------- building
function keys(ctx) {
  const { REVIEW, SCRUB } = ctx.copy;
  const earlier = keycap({ cap: "←", name: REVIEW.earlier, shortcut: "ArrowLeft", title: REVIEW.earlier,
    cls: ["sc-scrub-key", "sc-scrub-earlier"], data: { scrub: "earlier" } });
  const live = keycap({ cap: "Esc", name: SCRUB.live, shortcut: "Escape", title: REVIEW.live,
    cls: ["sc-scrub-key", "sc-scrub-live"], attrs: { "aria-label": REVIEW.live }, data: { scrub: "live" } });
  const liveLamp = lamp("sc-scrub-live-lamp");
  live.node.insertBefore(liveLamp, live.name);
  return { earlier, live, liveLamp };
}

function strip(ctx) {
  const hidden = { "aria-hidden": "true" };
  const drives = el("ol", { cls: "sc-scrub-drives", attrs: hidden });
  const marks = el("ol", { cls: "sc-scrub-marks", attrs: hidden });
  const veil = el("span", { cls: "sc-scrub-veil", attrs: hidden });
  const ghost = el("span", { cls: "sc-scrub-ghost", attrs: hidden });
  const knob = el("span", { cls: "sc-scrub-knob", attrs: hidden });
  const face = el("div", { cls: "sc-scrub-face" }, [drives, marks, veil]);
  const track = el("div", {
    cls: "sc-scrub-track",
    attrs: { role: "slider", tabindex: "0", "aria-label": ctx.copy.SCRUB.track, "aria-orientation": "horizontal" },
    data: { testid: "scrub-track" },
  }, [face, ghost, knob]);
  return { track, drives, marks, ghost, knob };
}

/** In reading order, which is the tab order: the readout, then ←, the strip and LIVE, left to right. */
function build(ctx) {
  const k = keys(ctx);
  const s = strip(ctx);
  const title = el("span", { cls: "sc-scrub-title" });
  const word = el("span", { cls: "sc-scrub-word" });
  const head = el("span", { cls: "sc-scrub-head" });
  const label = el("span", { cls: "sc-scrub-label" });
  const readout = el("p", { cls: "sc-scrub-readout" }, [title, word, head, label]);
  const node = el("div", {
    cls: "sc-scrub", attrs: { role: "group", "aria-label": ctx.copy.SCRUB.label },
    data: { testid: "scrub", state: "empty", dragging: false },
  }, [readout, k.earlier.node, s.track, k.live.node]);
  return { node, readout, title, word, head, label, ...k, ...s };
}

// ---------------------------------------------------------------- rendering
function driveItem(node, d) {
  setData(node, "team", d.team || null);
  setData(node, "caller", d.caller);
  node.style.setProperty("--sc-scrub-from", String(d.from));
  node.style.setProperty("--sc-scrub-to", String(d.to));
}

function markItem(node, m) {
  setData(node, "kind", m.kind);
  setData(node, "team", m.team || null);
  setData(node, "caller", m.kind === "quarter" ? null : m.caller);
  setData(node, "label", m.text || null);
  node.style.setProperty("--sc-scrub-at", String(m.at));
}

function renderStrip(p, vm) {
  reconcile(p.drives, vm.drives, { key: (d) => `${d.idx}-${d.first}`,
    create: () => el("li", { cls: "sc-scrub-drive" }), update: driveItem });
  reconcile(p.marks, vm.marks, { key: (m) => m.key, create: () => el("li", { cls: "sc-scrub-mark" }), update: markItem });
  p.track.style.setProperty("--sc-scrub-knob", String(vm.knobAt));
  p.track.style.setProperty("--sc-scrub-head", String(vm.headAt));
  setHidden(p.knob, vm.knobSeq === null);
  setAttr(p.track, "aria-valuemin", vm.value.max ? 1 : 0);
  setAttr(p.track, "aria-valuemax", vm.value.max);
  setAttr(p.track, "aria-valuenow", vm.value.now);
  setAttr(p.track, "aria-valuetext", vm.value.text);
  setAttr(p.track, "aria-disabled", vm.empty ? "true" : null);
}

/** The readout follows the knob; while the pointer hovers a play (and is not dragging), it previews that play. */
function renderReadout(p, st) {
  const { vm } = st;
  const hover = st.hoverSeq === null || st.dragging ? null : vm.plays.find((play) => play.seq === st.hoverSeq);
  const shown = hover ?? vm.readout;
  setData(p.readout, "show", hover ? "hover" : vm.readout.state);
  setText(p.title, vm.readout.title);
  setText(p.word, hover ? "" : vm.readout.word);
  setText(p.head, shown.head);
  setText(p.label, shown.label);
  setHidden(p.ghost, !hover);
  if (hover) p.track.style.setProperty("--sc-scrub-hover", slotCenter(hover.seq, vm.total));
}

function render(p, st) {
  const { vm } = st;
  setHidden(p.node, !vm.available);
  setData(p.node, "state", vm.readout.state);
  setData(p.node, "session", vm.session);
  renderStrip(p, vm);
  setAttr(p.earlier.node, "disabled", !vm.canEarlier);
  setAttr(p.live.node, "disabled", !vm.canLive);
  setData(p.liveLamp, "on", !vm.reviewing && !vm.empty);
  renderReadout(p, st);
}

// ---------------------------------------------------------------- moving the knob
/** Ask for one play (null: live), once: the same target twice in a row is not asked for again. */
function seek(ctx, st, seq) {
  if (seq === undefined || seq === st.target) return;
  st.target = seq;
  ctx.actions.reviewAt(seq);
}

/** The current target: the reviewed play, or live (null). */
const targetOf = (vm) => (vm.reviewing ? vm.knobSeq : null);

/** The play under the pointer: a seq, null for the live part of the strip, undefined when it cannot be measured. */
function pointerSeq(p, st, e) {
  const box = p.track.getBoundingClientRect();
  if (!box || !(box.width > 0) || !st.vm.plays.length) return undefined;
  return seqAtFraction(st.vm, (e.clientX - box.left) / box.width);
}

function onPointerDown(p, ctx, st, e) {
  if (e.button !== MAIN_BUTTON) return;
  const seq = pointerSeq(p, st, e);
  if (seq === undefined) return;
  e.preventDefault();
  p.track.setPointerCapture?.(e.pointerId);
  st.dragging = true;
  st.hoverSeq = null;
  st.target = targetOf(st.vm);
  setData(p.node, "dragging", true);
  seek(ctx, st, seq);
  renderReadout(p, st);
}

function onPointerMove(p, ctx, st, e) {
  const seq = pointerSeq(p, st, e);
  if (st.dragging) {
    seek(ctx, st, seq);
    return;
  }
  st.hoverSeq = seq ?? null;
  renderReadout(p, st);
}

function endDrag(p, st, e) {
  if (!st.dragging) return;
  st.dragging = false;
  setData(p.node, "dragging", false);
  if (e && e.pointerId !== undefined) p.track.releasePointerCapture?.(e.pointerId);
  renderReadout(p, st);
}

function onLeave(p, st) {
  st.hoverSeq = null;
  if (!st.dragging) renderReadout(p, st);
}

/** Keys on the strip (a slider, so the page's keymap leaves it alone; 4.1 guard 3). */
function onKey(ctx, st, e) {
  const { vm } = st;
  if (e.altKey || e.ctrlKey || e.metaKey || !vm.available) return;
  const step = own(STEP_KEYS, e.key);
  const drive = own(DRIVE_KEYS, e.key);
  const speed = own(SPEED_KEYS, e.key);
  if (step !== undefined || drive !== undefined) {
    e.preventDefault();
    st.target = targetOf(vm);
    if (vm.plays.length) seek(ctx, st, stepFrom(vm, step ?? drive, { byDrive: drive !== undefined }));
  } else if (e.key === "Escape" && vm.reviewing) {
    e.preventDefault();
    ctx.actions.exitReview();
  } else if (SPACE.has(e.key)) {
    e.preventDefault();
    if (!e.repeat) ctx.actions.watchToggle();
  } else if (speed !== undefined && !e.repeat) {
    e.preventDefault();
    ctx.actions.watchSpeed(speed);
  }
}

/** A key the state just disabled under keyboard focus hands focus to the strip, so Tab keeps its place. */
function pressKey(st, node, run) {
  return (e) => {
    if (node.hidden || node.hasAttribute("disabled")) return;
    run();
    if (e && e.detail === 0 && node.ownerDocument?.activeElement === node) st.pendingFocus = node;
  };
}

function wire(p, ctx, st) {
  p.earlier.node.addEventListener("click", pressKey(st, p.earlier.node, () => ctx.actions.review(-1)));
  p.live.node.addEventListener("click", pressKey(st, p.live.node, () => ctx.actions.exitReview()));
  p.track.addEventListener("pointerdown", (e) => onPointerDown(p, ctx, st, e));
  p.track.addEventListener("pointermove", (e) => onPointerMove(p, ctx, st, e));
  p.track.addEventListener("pointerup", (e) => endDrag(p, st, e));
  p.track.addEventListener("pointercancel", (e) => endDrag(p, st, e));
  p.track.addEventListener("lostpointercapture", (e) => endDrag(p, st, e));
  p.track.addEventListener("pointerleave", () => onLeave(p, st));
  p.track.addEventListener("mousedown", (e) => e.preventDefault());
  p.track.addEventListener("keydown", (e) => onKey(ctx, st, e));
}

function settleFocus(p, st) {
  const node = st.pendingFocus;
  st.pendingFocus = null;
  if (node && node.hasAttribute("disabled") && node.ownerDocument?.activeElement !== p.track) {
    p.track.focus({ preventScroll: true });
  }
}

/**
 * @param {HTMLElement} root  #rg-transport (shared with the watch transport, which mounts first)
 * @param {{ actions: object, copy: object }} ctx
 * @returns {{ update(vm: ReturnType<import("../model/vm-scrub.js").scrubVm>): void, destroy(): void }}
 */
export function mount(root, ctx) {
  const parts = build(ctx);
  // The component's own state: the view model it shows, the play under the pointer, a drag, the last play asked for.
  const st = { vm: scrubVm(null), hoverSeq: null, dragging: false, target: null, pendingFocus: null };
  wire(parts, ctx, st);
  render(parts, st);
  root.appendChild(parts.node);
  return {
    update(vm) {
      if (!vm) return;
      st.vm = vm;
      render(parts, st);
      settleFocus(parts, st);
    },
    destroy() {
      parts.node.remove();
    },
  };
}
