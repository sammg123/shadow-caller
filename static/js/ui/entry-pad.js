// The manual entry pad (FI 1.3 to 1.5, 2.4, 3.6; ui-architecture.md 2.6, 9.1; checklist #5, #37 to #47, #59, #60,
// #93; owner A7). DOM side, text only (G27). Mounted on #entry: it fills #manualEntry and #entryHint and writes
// #entry[data-dim] and #entry[data-entry-mode]; it never clears #entry, which also holds the last play and the
// shorthand bar. The entry line (the chosen play, Yards, Touchdown, Turnover, Log play) comes first, then the keypad
// (Run J K L, Pass P A N, RPO O, Result I S C X). Keys call actions; the pad is the Form for Yards, Touchdown,
// Turnover and the Yards focus (actions read and write them through ctx.form, 9.1).
import { el, setAttr, setClass, setData, setHidden, setText } from "./dom.js";
import { act, isFocused, keyCap, selectAll, selectOnFocus } from "./input-kit.js";

const ROWS = Object.freeze([
  Object.freeze({ id: "run", keys: ["J", "K", "L"] }),
  Object.freeze({ id: "pass", keys: ["P", "A", "N"] }),
  Object.freeze({ id: "rpo", keys: ["O"] }),
  Object.freeze({ id: "result", keys: ["I", "S", "C", "X"] }),
]);
const OUTCOME_OF = Object.freeze({ I: "incomplete", S: "sack", C: "scramble" });
const TONE_OF = Object.freeze({ J: "run", K: "run", L: "run", P: "pass", A: "pass", N: "pass", O: "rpo" });
const FLAG_KEY = "X";
const YARDS_MAX_CHARS = 4;          // "-99" to "109": the longest gain or loss a field allows
const YARDS_PLACEHOLDER = "0";      // what an empty Yards box logs
const EMPTY_VM = Object.freeze({ mode: "manual", manualHidden: false, dim: true, chosen: null, keysOn: {}, outOn: {},
  logDisabled: true, hint: "", flagOpen: false });

// ---------------------------------------------------------------- the entry line
function checkField(id, label, key) {
  const box = el("input", { id, attrs: { type: "checkbox" } });
  const text = el("span", { cls: "sc-check-label" }, [label, " ", el("span", { cls: "sc-check-key", text: key })]);
  return { box, node: el("label", { cls: "sc-check", data: { check: id } }, [box, text]) };
}

function buildChosen() {
  const name = el("span", { cls: "sc-chosen-name" });
  const sep = el("span", { cls: "sc-chosen-sep" });
  const hint = el("span", { cls: "sc-chosen-hint" });
  const node = el("p", { id: "chosen", cls: "sc-chosen", attrs: { "aria-live": "polite" } }, [name, sep, hint]);
  return { node, name, sep, hint };
}

function buildLine(copy, onLog) {
  const chosen = buildChosen();
  // G5-4: empty, with 0 as its placeholder (an empty box logs 0 yards), so a click left of a "0" and a digit can never
  // make "40"; focus selects whatever is there (input-kit selectOnFocus keeps it selected through the click).
  const yards = el("input", { id: "yards", cls: "sc-yards-input", attrs: { type: "text", inputmode: "numeric",
    autocomplete: "off", spellcheck: "false", enterkeyhint: "done", maxlength: YARDS_MAX_CHARS,
    size: YARDS_MAX_CHARS, placeholder: YARDS_PLACEHOLDER } });
  yards.value = "";
  const yardsField = el("label", { cls: "sc-yards" }, [el("span", { cls: "sc-yards-label", text: copy.yards }), yards]);
  const td = checkField("fTD", copy.td, copy.tdKey);
  const to = checkField("fTO", copy.turnover, copy.turnoverKey);
  const log = el("button", { id: "logBtn", cls: "sc-log-play", text: copy.logPlay,
    attrs: { type: "button", disabled: true, "aria-keyshortcuts": "Enter" }, on: { click: onLog } });
  const node = el("div", { cls: "sc-entry-line" }, [chosen.node, yardsField, td.node, to.node, log]);
  return { node, chosen, yards, td: td.box, to: to.box, log };
}

// ---------------------------------------------------------------- the keypad
function buildKey(copy, key, handlers) {
  const { name, hint } = copy.keys[key];
  if (key === FLAG_KEY) {
    return keyCap({ key, name, hint, cls: ["key"], data: { tone: "flag" },
      attrs: { id: "flagBtn", "aria-expanded": "false", "aria-controls": "flagPanel" }, on: { click: handlers.flag } });
  }
  const out = OUTCOME_OF[key];
  if (out) {
    return keyCap({ key, name, hint, cls: ["key"], data: { out, tone: "result" }, attrs: { "aria-pressed": "false" },
      on: { click: () => handlers.outcome(out) } });
  }
  return keyCap({ key, name, hint, cls: ["key"], data: { k: key, tone: TONE_OF[key] },
    attrs: { "aria-pressed": "false" }, on: { click: () => handlers.tap(key) } });
}

function buildPad(copy, handlers) {
  const keys = new Map();
  const rows = ROWS.map((row) => {
    const caps = row.keys.map((key) => {
      const node = buildKey(copy, key, handlers);
      keys.set(key, node);
      return node;
    });
    const label = copy.rows[row.id];
    return el("div", { cls: "sc-keyrow", data: { row: row.id }, attrs: { role: "group", "aria-label": label } },
      [el("span", { cls: "sc-keyrow-label", attrs: { "aria-hidden": "true" }, text: label }),
        el("div", { cls: "sc-keyrow-keys" }, caps)]);
  });
  return { node: el("div", { cls: "sc-keypad" }, rows), keys };
}

// ---------------------------------------------------------------- rendering
function renderChosen(chosen, vm) {
  const c = vm ?? { text: "", placeholder: true, hint: null };
  setText(chosen.name, c.text);
  setText(chosen.sep, c.hint ? " " : "");
  setText(chosen.hint, c.hint ?? "");
  setHidden(chosen.hint, !c.hint);
  setData(chosen.node, "placeholder", Boolean(c.placeholder));
}

function setPressed(node, on) {
  setClass(node, "on", on);
  setAttr(node, "aria-pressed", on ? "true" : "false");
}

function renderKeys(keys, vm) {
  for (const [key, node] of keys) {
    if (key === FLAG_KEY) {
      setClass(node, "on", Boolean(vm.flagOpen));
      setAttr(node, "aria-expanded", vm.flagOpen ? "true" : "false");
    } else if (OUTCOME_OF[key]) {
      setPressed(node, Boolean(vm.outOn?.[OUTCOME_OF[key]]));
    } else {
      setPressed(node, Boolean(vm.keysOn?.[key]));
    }
  }
}

/** The Form (ui-architecture.md 2.6): actions read and write the entry line only through these. */
function formOf(line) {
  return {
    readYards: () => String(line.yards.value ?? ""),
    writeYards: (value) => {
      line.yards.value = String(value ?? "");
      if (isFocused(line.yards)) selectAll(line.yards);   // after a log the next digit replaces what was there
    },
    readTD: () => Boolean(line.td.checked),
    writeTD: (on) => { line.td.checked = Boolean(on); },
    readTO: () => Boolean(line.to.checked),
    writeTO: (on) => { line.to.checked = Boolean(on); },
    focusYards: () => {                                   // focus and select unless already focused (FI 4.6)
      if (isFocused(line.yards)) return;
      line.yards.focus();
      selectAll(line.yards);
    },
  };
}

/**
 * @param {HTMLElement} root  #entry
 * @param {{ actions: object, copy: { ENTRY: object } }} ctx
 * @returns {{ update(vm: object | null): void, destroy(): void, form: object }}
 */
export function mount(root, ctx) {
  const manual = root.querySelector("#manualEntry");
  const hintNode = root.querySelector("#entryHint");
  if (!manual || !hintNode) throw new Error("The entry pad needs #manualEntry and #entryHint inside #entry.");
  const copy = ctx.copy.ENTRY;
  const run = (fn) => () => act(fn);
  const line = buildLine(copy, run(() => ctx.actions.logPlay()));
  const pad = buildPad(copy, {
    tap: (key) => act(() => ctx.actions.tap(key)),
    outcome: (out) => act(() => ctx.actions.outcome(out)),
    flag: run(() => ctx.actions.toggleFlag()),
  });
  const title = el("h2", { cls: "sc-pad-title", text: copy.heading });
  const built = [title, line.node, pad.node];
  for (const node of built) manual.appendChild(node);
  selectOnFocus(line.yards);
  return {
    form: formOf(line),
    update(vm) {
      const v = vm ?? EMPTY_VM;
      setData(root, "dim", Boolean(v.dim));
      setData(root, "entryMode", v.mode ?? "manual");
      setHidden(manual, Boolean(v.manualHidden));
      renderChosen(line.chosen, v.chosen);
      renderKeys(pad.keys, v);
      setAttr(line.log, "disabled", v.logDisabled !== false);
      setText(hintNode, v.hint ?? "");
    },
    destroy() {
      for (const node of built) node.remove();
      setText(hintNode, "");
    },
  };
}
