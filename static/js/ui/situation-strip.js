// The situation strip (FI 1.8, 2.3, 3.4; ui-architecture.md 2.6, 4.5, 4.6 G1 G2 G3; checklist #9 to #26; owner A7).
// DOM side, text only (G27): Qtr, Clock with est., both scores, Down & To go, Ball on with its side chip, the drive
// line, the end-of-drive keys and the strip note. Editing (4.5): focus selects the value; an input event marks the
// field edited; Enter or a blur (Tab) saves an edited field, even when it equals the shown value (G2); Enter blurs
// and then focuses Yards when a drive was on before the save (#21); Escape brings back the last rendered server value
// with no request (G1). A render never writes the field being typed in (FI 4.3); a rejected value stays with .bad
// and aria-invalid until it is saved, escaped or left (FI 4.4). What a save sends is core/strip.js's rule, reached
// through actions.commitStrip; an unedited commit only clears a kept rejection.
import { inputKeyAction } from "../core/keymap.js";
import { STRIP_FIELDS } from "../core/strip.js";
import { el, setAttr, setClass, setData, setHidden, setText } from "./dom.js";
import { act, isFocused, selectAll, selectOnFocus } from "./input-kit.js";

/** Per field: its visible label (copy key, or the id of a team label), and what the phone keyboard should offer. */
const FIELD_SPECS = Object.freeze({
  iQtr: { label: "qtr", inputmode: "numeric", size: 2 },
  iClock: { label: "clock", size: 5 },
  iOff: { teamLabel: "lOff", inputmode: "numeric", size: 3 },
  iOpp: { teamLabel: "lOpp", inputmode: "numeric", size: 3 },
  iDown: { label: "down", inputmode: "numeric", size: 2 },
  iTogo: { label: "togo", size: 3, caps: true },
  iYard: { size: 4, caps: true },
});
const END_KINDS = Object.freeze([["punt", "endPunt"], ["fg", "endFg"], ["fg_miss", "endFgMiss"], ["half", "endHalf"]]);
const EMPTY_VM = Object.freeze({ values: null, endRowHidden: true, rejected: Object.freeze({}), error: null });
const ERROR_ID = "stripError";

// ---------------------------------------------------------------- building
function fieldInput(id, spec) {
  return el("input", { id, cls: "sc-strip-input", attrs: { type: "text", inputmode: spec.inputmode ?? null,
    autocomplete: "off", autocapitalize: spec.caps ? "characters" : "off", spellcheck: "false", enterkeyhint: "done",
    size: spec.size } });
}

function labelled(node, input, field) {
  return el("label", { cls: "sc-strip-field", data: { field } }, [node, input]);
}

function buildTime(copy, inputs, est) {
  const qtr = labelled(el("span", { cls: "sc-strip-label", text: copy.qtr }), inputs.iQtr, "qtr");
  const clockLabel = el("span", { cls: "sc-strip-label" }, [copy.clock, " ", est]);
  const clock = labelled(clockLabel, inputs.iClock, "clock");
  return el("div", { cls: "sc-strip-group", data: { group: "time" } }, [qtr, clock]);
}

function buildScore(inputs, teams) {
  return el("div", { cls: "sc-strip-group", data: { group: "score" } }, [
    labelled(teams.off, inputs.iOff, "score-off"),
    el("span", { cls: "sc-strip-dash", attrs: { "aria-hidden": "true" }, text: "–" }),
    labelled(teams.opp, inputs.iOpp, "score-opp"),
  ]);
}

function buildDown(copy, inputs) {
  return el("div", { cls: "sc-strip-group", data: { group: "down" } }, [
    labelled(el("span", { cls: "sc-strip-label", text: copy.down }), inputs.iDown, "down"),
    el("span", { cls: "sc-strip-amp", attrs: { "aria-hidden": "true" }, text: copy.amp }),
    labelled(el("span", { cls: "sc-strip-label", text: copy.togo }), inputs.iTogo, "togo"),
  ]);
}

function buildSpot(copy, inputs, chip) {
  const label = el("label", { cls: "sc-strip-label", attrs: { for: "iYard" }, text: copy.ballOn });
  return el("div", { cls: ["sc-strip-group", "sc-strip-field"], data: { group: "spot", field: "spot" } },
    [label, el("div", { cls: "sc-spot" }, [chip, inputs.iYard])]);
}

function buildChip(copy, onClick) {
  const text = el("span", { id: "sideTxt", cls: "sc-side-team" });
  const glyph = el("span", { cls: "sc-side-glyph", attrs: { "aria-hidden": "true" }, text: copy.sideGlyph });
  return { node: el("button", { id: "iSide", cls: "sc-side", attrs: { type: "button", title: copy.sideTitle },
    data: { side: "own" }, on: { click: onClick } }, [text, glyph]), text };
}

/** G5-13: the refused value's words, kept beside the strip until it is fixed (its field's aria-describedby). */
function buildError() {
  const tag = el("span", { cls: "sc-strip-error-tag" });
  const text = el("span", { cls: "sc-strip-error-text" });
  return { node: el("p", { id: ERROR_ID, cls: "sc-strip-error", attrs: { hidden: true } }, [tag, " ", text]), tag, text };
}

function buildDrive(copy, onEnd, error) {
  const info = el("p", { id: "driveInfo", cls: "sc-drive-info" });
  const ends = END_KINDS.map(([kind, key]) => el("button", { cls: "sc-end", attrs: { type: "button" },
    data: { end: kind }, text: copy[key], on: { click: () => onEnd(kind) } }));
  const row = el("div", { id: "endRow", cls: "sc-end-row", attrs: { hidden: true } }, ends);
  return { node: el("div", { cls: "sc-strip-drive" }, [error.node, info, row]), info, row };
}

// ---------------------------------------------------------------- editing (4.5)
function setBad(input, bad) {
  setClass(input, "bad", bad);
  setAttr(input, "aria-invalid", bad ? "true" : null);
}

/** Show the last rendered server value again and drop the invalid style; a kept rejection is cleared in the store. */
function restore(c, id) {
  const f = c.fields[id];
  const input = c.inputs[id];
  const wasRejected = f.rejected;
  f.edited = false;
  f.rejected = false;
  if (input.value !== f.server) input.value = f.server;
  setBad(input, false);
  if (wasRejected) act(() => c.ctx.actions.commitStrip(id, f.server, false));
}

function commitField(c, id) {
  const raw = String(c.inputs[id].value ?? "");
  c.fields[id].edited = false;
  return act(() => c.ctx.actions.commitStrip(id, raw, true)).then((res) => {
    if (!res?.sent && !isFocused(c.inputs[id])) restore(c, id);   // nothing to send: the server value comes back (#24)
  });
}

const keptIn = (vm, id) => Boolean(vm?.rejected) && Object.hasOwn(vm.rejected, id);

/**
 * Leaving a field: save it when typed in (#20); let go of a rejected value nobody touched, including one that came
 * back while the field still had focus; else show what the last render would have written (a render skips the
 * focused field, #25).
 */
function settleField(c, id) {
  const f = c.fields[id];
  if (f.edited) {
    commitField(c, id);
    return;
  }
  if (keptIn(c.lastVm, id)) f.rejected = true;
  if (f.rejected) restore(c, id);
  else renderField(c, id, c.lastVm);
}

/** Blur on purpose (Enter, Escape): the field is already settled, so its blur handler stays out of it. */
function leave(c, id) {
  c.leaving = id;
  try {
    c.inputs[id].blur();
  } finally {
    c.leaving = null;
  }
}

function onKeyDown(c, id, e) {
  const hit = e.isComposing ? null : inputKeyAction("strip", e.key);   // an IME's closing Enter is not a save
  if (!hit) return;
  if (hit.prevent) e.preventDefault();
  if (hit.action === "restore") {
    restore(c, id);
    leave(c, id);
    return;
  }
  const wasActive = c.driveActive;
  settleField(c, id);
  leave(c, id);
  if (wasActive) act(() => c.ctx.form.focusYards());
}

function wireInput(c, id) {
  const input = c.inputs[id];
  selectOnFocus(input, { pristine: () => !c.fields[id].edited });
  input.addEventListener("input", () => { c.fields[id].edited = true; });
  input.addEventListener("keydown", (e) => onKeyDown(c, id, e));
  input.addEventListener("blur", () => { if (c.leaving !== id) settleField(c, id); });
}

/** The chip flips the side with the typed number. Off the field the box is blank (G5-3) and the flip sends the
 * placeholder's number, so that number fills the box before it takes focus: a render skips the focused field (#25). */
function onChip(c) {
  const yard = c.inputs.iYard;
  const typed = String(yard.value ?? "");
  const shown = typed.trim() || String(yard.getAttribute("placeholder") ?? "");
  act(() => c.ctx.actions.flipSide(typed)).then((res) => {
    if (!res?.ok) return;
    if (!String(yard.value ?? "").trim() && shown) yard.value = shown;
    yard.focus();
    selectAll(yard);
  });
}

// ---------------------------------------------------------------- rendering
function renderField(c, id, vm) {
  const f = c.fields[id];
  const input = c.inputs[id];
  f.server = vm.values ? String(vm.values[id] ?? "") : "";
  setAttr(input, "placeholder", vm.values?.placeholders?.[id] || null);   // G5-3: Ball on off the field
  if (isFocused(input)) return;                            // never overwrite the field being typed in (#25)
  const kept = vm.rejected && Object.hasOwn(vm.rejected, id) ? String(vm.rejected[id]) : null;
  f.edited = false;
  f.rejected = kept !== null;
  const shown = kept ?? f.server;
  if (input.value !== shown) input.value = shown;
  setBad(input, kept !== null);
}

function renderSide(c, side) {
  const own = side ? Boolean(side.own) : true;
  setText(c.chip.text, side?.team ?? "");
  setClass(c.chip.node, "opp", !own);
  setData(c.chip.node, "side", own ? "own" : "opp");
  setAttr(c.chip.node, "title", side?.title ?? c.copy.sideTitle);
  setAttr(c.chip.node, "aria-label", side?.title ?? c.copy.sideTitle);
}

/** G5-16: during Watch this game the strip shows ESPN's situation read-only: no typing, no Tab stop, no side chip. */
function renderReadOnly(c, readOnly) {
  for (const id of STRIP_FIELDS) {
    setAttr(c.inputs[id], "readonly", readOnly);
    setAttr(c.inputs[id], "tabindex", readOnly ? "-1" : null);
  }
  setAttr(c.chip.node, "disabled", readOnly);
}

function render(c, vm) {
  c.lastVm = vm;
  renderReadOnly(c, Boolean(vm.readOnly));
  for (const id of STRIP_FIELDS) renderField(c, id, vm);
  c.driveActive = Boolean(vm.values) && !vm.endRowHidden;
  renderSide(c, vm.values?.side ?? null);
  setText(c.teams.off, vm.offLabel ?? "");
  setText(c.teams.opp, vm.oppLabel ?? "");
  setAttr(c.inputs.iOff, "aria-label", vm.scoreAria?.off || null);
  setAttr(c.inputs.iOpp, "aria-label", vm.scoreAria?.opp || null);
  setHidden(c.est, !vm.clockEst);
  setText(c.drive.info, vm.driveInfo?.text ?? "");
  setData(c.drive.info, "cue", Boolean(vm.driveInfo?.cue));
  setHidden(c.drive.row, vm.endRowHidden !== false);
  setText(c.note, vm.note ?? "");
  renderError(c, vm.error ?? null);
}

function renderError(c, error) {
  setText(c.error.tag, error?.tag ?? "");
  setText(c.error.text, error?.text ?? "");
  setHidden(c.error.node, !error);
  for (const id of STRIP_FIELDS) setAttr(c.inputs[id], "aria-describedby", error?.field === id ? ERROR_ID : null);
}

function buildStrip(c) {
  const fields = el("div", { cls: "sc-strip-fields" }, [buildTime(c.copy, c.inputs, c.est),
    buildScore(c.inputs, c.teams), buildDown(c.copy, c.inputs), buildSpot(c.copy, c.inputs, c.chip.node)]);
  return el("div", { cls: "sc-strip" }, [fields, c.drive.node, c.note]);
}

/**
 * @param {HTMLElement} root  #rg-situation
 * @param {{ actions: object, form: object, copy: { STRIP: object } }} ctx
 * @returns {{ update(vm: object | null): void, destroy(): void }}
 */
export function mount(root, ctx) {
  const copy = ctx.copy.STRIP;
  const inputs = Object.fromEntries(STRIP_FIELDS.map((id) => [id, fieldInput(id, FIELD_SPECS[id])]));
  const c = {
    ctx, copy, inputs, driveActive: false, lastVm: EMPTY_VM, leaving: null,
    fields: Object.fromEntries(STRIP_FIELDS.map((id) => [id, { edited: false, rejected: false, server: "" }])),
    est: el("span", { id: "clockEst", cls: "sc-est", attrs: { title: copy.estTitle, hidden: true }, text: copy.est }),
    teams: { off: el("span", { id: "lOff", cls: "sc-strip-label" }),
      opp: el("span", { id: "lOpp", cls: "sc-strip-label" }) },
    note: el("p", { cls: "sc-strip-note" }),
  };
  c.chip = buildChip(copy, () => onChip(c));
  c.error = buildError();
  c.drive = buildDrive(copy, (kind) => act(() => ctx.actions.endDrive(kind)), c.error);
  for (const id of STRIP_FIELDS) wireInput(c, id);
  const strip = buildStrip(c);
  root.appendChild(strip);
  return {
    update(vm) {
      render(c, vm ?? EMPTY_VM);
    },
    destroy() {
      strip.remove();
    },
  };
}
