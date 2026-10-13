// What the analyst panel shows (pure; docs/design/analyst-ui.md): the phase (idle, asking, streaming, done, error),
// the status word with its lamp tone and note, the intro for a first-time viewer, each turn's lines and cite keys,
// the send key (Ask, or Stop while answering) and the character count. Text only: the panel sets every string as
// text, never as markup, and the answer can quote ESPN's play text.
import { ASK } from "./copy.js";
import { LIMITS, questionOf } from "./history.js";
import { normalizeCites } from "./ndjson.js";
import { answering, canAsk, newest } from "./state.js";

const COUNT_FROM = 400;
/** The tools' own clock references (analyst.md section 8): Q1 to Q4, OT, 2OT and on, then M:SS. */
const REF = /^(?:Q[1-4]|[2-9]?OT) \d{1,2}:[0-5]\d$/;
const PHASE_OF = Object.freeze({ asking: "asking", streaming: "streaming", done: "done", error: "error",
  stopped: "idle" });

const freeze = Object.freeze;

/**
 * A cite key's words: the tools' "Q3 2:52" (or "OT 4:10"), else the play's number.
 * @param {unknown} ref
 * @param {number} seq
 * @returns {string}
 */
export function citeLabel(ref, seq) {
  const text = typeof ref === "string" ? ref.trim().replace(/\s+/g, " ").toUpperCase() : "";
  return REF.test(text) ? text : ASK.citeFallback(seq);
}

/**
 * The cite keys under an answer: its words and what pressing it does on this page (the GameCast shows the play on
 * the field; the Model Report finds his call in the table).
 * @param {unknown} cites  [{seq, ref}] as done.cites carries them
 * @param {"slide" | "embedded"} layout
 * @returns {ReadonlyArray<{ key: string, seq: number, label: string, title: string }>}
 */
export function citeChips(cites, layout = "slide") {
  const title = layout === "embedded" ? ASK.citeTitle.embedded : ASK.citeTitle.slide;
  return freeze(normalizeCites(cites).map(({ seq, ref }) => {
    const label = citeLabel(ref, seq);
    return freeze({ key: String(seq), seq, label, title: title(label) });
  }));
}

const word = (key, tone, note) => freeze({ key, word: ASK.status[key], tone, note });

/**
 * The status word, its lamp tone (good, warn, bad, idle) and the note under it, if any.
 * @param {typeof import("./state.js").INITIAL} state
 */
export function statusOf(state) {
  const s = state.status;
  if (answering(state)) return word("answering", "warn", newest(state).cold ? ASK.notes.warming : "");
  if (state.statusError) return word(state.statusCode === "missing" ? "missing" : "offline", "bad", state.statusError);
  if (!s) return word("checking", "idle", "");
  if (!s.ready) return word("down", "bad", s.message || ASK.notes.down(s.model));
  if (s.busy) return word("busy", "warn", ASK.notes.busy);
  if (!s.warm) return word("warming", "warn", ASK.notes.warming);
  return word("ready", "good", "");
}

function lineOf(turn) {
  if (turn.state === "asking") return turn.cold ? ASK.lines.loading : ASK.lines.thinking;
  if (turn.state !== "streaming") return "";
  if (turn.tool) return ASK.lines.tool(turn.tool);
  return turn.answer ? "" : ASK.lines.thinking;
}

function turnVm(turn, isNewest, can, layout) {
  const retry = isNewest && turn.retry && (turn.state === "error" || turn.state === "stopped");
  return freeze({
    key: String(turn.id),
    id: turn.id,
    state: turn.state,
    question: turn.question,
    answer: turn.answer,
    line: lineOf(turn),
    error: turn.state === "error" ? turn.error ?? "" : "",
    stopped: turn.state === "stopped",
    retry: freeze({ shown: retry, disabled: retry && !can }),
    cites: turn.state === "done" ? citeChips(turn.cites, layout) : freeze([]),
  });
}

function factsOf(status) {
  const facts = [ASK.facts.source, ASK.facts.spoilers];
  return freeze(status?.model ? [...facts, ASK.facts.model(status.model)] : facts);
}

function sendOf(live, canSend) {
  if (live) return freeze({ mode: "stop", label: ASK.stop, title: ASK.stopTitle, cap: "", disabled: false });
  return freeze({ mode: "ask", label: ASK.send, title: ASK.sendTitle, cap: ASK.sendCap, disabled: !canSend });
}

/**
 * The top bar's Ask key from a status read (stream.js fetchStatus): shown once the server says it has an analyst; plain
 * when it can answer (ready, warming up or busy with another question), "Not ready" with the reason on its tooltip
 * when it can't (Ollama not running, the model missing), so a press opens the drawer that says what to do. A server
 * with no analyst (404) or one that can't be reached shows no key.
 * @param {{ ok: true, status: object } | { ok: false, code: string } | null} result
 * @returns {Readonly<{ shown: boolean, status: string, value: string, title: string }>}
 */
export function askKeyVm(result) {
  if (!result || !result.ok || !result.status) {
    return freeze({ shown: false, status: result?.code === "missing" ? "missing" : "offline", value: "", title: "" });
  }
  const s = result.status;
  if (!s.ready) return freeze({ shown: true, status: "down", value: ASK.key.notReady,
    title: s.message || ASK.notes.down(s.model) });
  const status = s.busy ? "busy" : s.warm ? "ready" : "warming";
  return freeze({ shown: true, status, value: "", title: ASK.key.title });
}

/**
 * The panel's view of the state.
 * @param {typeof import("./state.js").INITIAL} state
 * @param {{ layout?: "slide" | "embedded" }} [opts]
 */
export function askVm(state, { layout = "slide" } = {}) {
  const can = canAsk(state);
  const canSend = can && questionOf(state.draft) !== null;
  const typed = state.draft.length;
  const last = state.turns.length - 1;
  return freeze({
    layout,
    phase: state.turns.length ? PHASE_OF[newest(state).state] ?? "idle" : "idle",
    status: statusOf(state),
    empty: state.turns.length === 0,
    lead: ASK.lead,
    facts: factsOf(state.status),
    tryLabel: ASK.tryLabel,
    suggestions: freeze(ASK.suggestions.map((text) => freeze({ text, disabled: !can }))),
    turns: freeze(state.turns.map((t, i) => turnVm(t, i === last, can, layout))),
    canAsk: can,
    canSend,
    send: sendOf(answering(state), canSend),
    count: freeze({ shown: typed >= COUNT_FROM, text: ASK.count(typed, LIMITS.question) }),
    announce: state.announce,
  });
}
