// The analyst chat's state (pure; docs/design/analyst-ui.md). One immutable value, changed only by reduce(): the
// analyst's status (GET /api/ask/status, normalized), the draft in the box, and the conversation, a list of turns.
// A turn moves asking -> streaming -> done | error | stopped; only the newest turn can be answering, and events or
// endings for any other turn change nothing (a late event from a stopped request can't touch a newer question).
// Actions (the panel dispatches them; stream.js's events and outcomes pass through untouched):
//   {type: "status", status}            the status, normalized (stream.js normalizeStatus); null is ignored
//   {type: "statusFailed", code, message}  the status couldn't be read (code "missing": no analyst on this server)
//   {type: "draft", text}               what the box holds
//   {type: "ask", question, clearDraft}  a new question (refused unless canAsk and the question is valid); clearDraft
//                                       when it came from the box (a suggestion leaves what's typed alone)
//   {type: "event", id, event}          a tool or delta event for turn `id`
//   {type: "end", id, outcome}          how turn `id` ended: done, error or aborted
//   {type: "retry", id}                 ask the newest failed or stopped question again, as a new turn
import { ASK } from "./copy.js";
import { cleanText, questionOf } from "./history.js";

export const TURNS_KEPT = 30;
const ANSWER_MAX = 20000;
const TOOL_MAX = 80;
const LIVE = new Set(["asking", "streaming"]);

const freeze = Object.freeze;

export const INITIAL = freeze({
  status: null,
  statusError: null,
  statusCode: null,
  draft: "",
  turns: freeze([]),
  nextId: 1,
  announce: null,
});

/** The newest turn, or null. */
export function newest(state) {
  return state.turns.length ? state.turns[state.turns.length - 1] : null;
}

/** A question is on its way or streaming in. */
export function answering(state) {
  const turn = newest(state);
  return Boolean(turn && LIVE.has(turn.state));
}

/** A new question can go: the analyst said it is ready and free, the page reached it, and nothing is answering. */
export function canAsk(state) {
  const s = state.status;
  return Boolean(s && s.ready && !s.busy && !state.statusError && !answering(state));
}

const withTurns = (state, turns) => freeze({ ...state, turns: freeze(turns.slice(-TURNS_KEPT)) });

function replaceNewest(state, patch) {
  const turns = state.turns.slice();
  turns[turns.length - 1] = freeze({ ...turns[turns.length - 1], ...patch });
  return withTurns(state, turns);
}

/** The newest turn when it is `id` and still answering, else null. */
function liveTurn(state, id) {
  const turn = newest(state);
  return turn && turn.id === id && LIVE.has(turn.state) ? turn : null;
}

function addTurn(state, question, clearDraft = false) {
  const turn = freeze({ id: state.nextId, question, state: "asking", cold: Boolean(state.status && !state.status.warm),
    tool: null, answer: "", cites: freeze([]), error: null, retry: false });
  const draft = clearDraft ? "" : state.draft;
  return withTurns(freeze({ ...state, nextId: state.nextId + 1, draft }), [...state.turns, turn]);
}

function ask(state, { question, clearDraft }) {
  const q = questionOf(question);
  return q && canAsk(state) ? addTurn(state, q, clearDraft === true) : state;
}

function onEvent(state, { id, event }) {
  const turn = liveTurn(state, id);
  if (!turn || !event) return state;
  if (event.type === "tool") {
    const tool = cleanText(event.label).slice(0, TOOL_MAX) || ASK.toolFallback;
    return replaceNewest(state, { state: "streaming", tool });
  }
  if (event.type === "delta" && typeof event.text === "string") {
    const answer = `${turn.answer}${event.text}`.slice(0, ANSWER_MAX);
    return replaceNewest(state, { state: "streaming", tool: null, answer });
  }
  return state;
}

function failed(state, id, message, retry) {
  const next = replaceNewest(state, { state: "error", tool: null, error: message, retry });
  return freeze({ ...next, announce: freeze({ id, text: ASK.spoken.error(message) }) });
}

function finished(state, turn, outcome) {
  const answer = cleanText(outcome.text) || cleanText(turn.answer);
  if (!answer) return failed(state, turn.id, ASK.errors.noAnswer, true);
  const next = replaceNewest(state, { state: "done", tool: null, answer, cites: freeze([...(outcome.cites ?? [])]),
    error: null, retry: false });
  const status = state.status ? freeze({ ...state.status, warm: true }) : null;   // the model answered: it's loaded
  return freeze({ ...next, status, announce: freeze({ id: turn.id, text: ASK.spoken.answer(answer) }) });
}

function onEnd(state, { id, outcome }) {
  const turn = liveTurn(state, id);
  if (!turn || !outcome) return state;
  if (outcome.type === "done") return finished(state, turn, outcome);
  if (outcome.type === "aborted") return replaceNewest(state, { state: "stopped", tool: null, retry: true });
  if (outcome.type !== "error") return state;
  const next = failed(state, id, cleanText(outcome.message) || ASK.errors.fault, outcome.retry !== false);
  const busy = outcome.reason === "busy" && next.status;
  return busy ? freeze({ ...next, status: freeze({ ...next.status, busy: true }) }) : next;
}

function retry(state, { id }) {
  const turn = newest(state);
  const again = turn && turn.id === id && turn.retry && (turn.state === "error" || turn.state === "stopped");
  if (!again || !canAsk(state)) return state;
  return addTurn(withTurns(state, state.turns.slice(0, -1)), turn.question);
}

const REDUCERS = freeze({
  status: (state, a) => (a.status ? freeze({ ...state, status: a.status, statusError: null, statusCode: null })
    : state),
  statusFailed: (state, a) => freeze({ ...state, statusError: cleanText(a.message) || ASK.notes.offline,
    statusCode: a.code === "missing" ? "missing" : "offline" }),
  draft: (state, a) => (typeof a.text === "string" && a.text !== state.draft
    ? freeze({ ...state, draft: a.text }) : state),
  ask,
  event: onEvent,
  end: onEnd,
  retry,
});

/**
 * The next state; the same object when the action changes nothing.
 * @param {typeof INITIAL} state
 * @param {{ type: string }} action
 */
export function reduce(state, action) {
  const fn = action && typeof action.type === "string" && Object.hasOwn(REDUCERS, action.type)
    ? REDUCERS[action.type] : null;
  return fn ? fn(state, action) : state;
}
