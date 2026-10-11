// static/js/ask/state.js: the analyst chat's state, one immutable value changed only by reduce(). A conversation of
// turns (question, the answer as it streams, the tool running, the cites, how it ended); the analyst's status from
// GET /api/ask/status; the draft in the box. Each turn moves asking -> streaming -> done or error (or stopped);
// events for any turn but the one answering are ignored.
import assert from "node:assert/strict";
import test from "node:test";
import { INITIAL, TURNS_KEPT, answering, canAsk, newest, reduce } from "../../../static/js/ask/state.js";
import { statusBody } from "./helpers.mjs";
import { normalizeStatus } from "../../../static/js/ask/stream.js";

const status = (over) => normalizeStatus(statusBody(over));
const ready = (over = {}) => reduce(INITIAL, { type: "status", status: status(over) });
const run = (state, ...actions) => actions.reduce((s, a) => reduce(s, a), state);
const asked = (state, question = "What were his biggest surprises?") => reduce(state, { type: "ask", question });

test("the start: nothing asked, status unknown, so nothing can be asked yet", () => {
  assert.equal(INITIAL.status, null);
  assert.deepEqual(INITIAL.turns, []);
  assert.equal(newest(INITIAL), null);
  assert.equal(answering(INITIAL), false);
  assert.equal(canAsk(INITIAL), false);
  assert.ok(Object.isFrozen(INITIAL) && Object.isFrozen(INITIAL.turns));
});

test("asking needs a ready analyst that isn't busy and a status the page could read", () => {
  assert.equal(canAsk(ready()), true);
  assert.equal(canAsk(ready({ warm: false })), true, "warming up still answers, only slower");
  assert.equal(canAsk(ready({ ready: false, ollama: false })), false);
  assert.equal(canAsk(ready({ busy: true })), false);
  assert.equal(canAsk(reduce(ready(), { type: "statusFailed", message: "Can't reach the app server." })), false);
  assert.equal(canAsk(reduce(reduce(ready(), { type: "statusFailed", message: "x" }), { type: "status",
    status: status() })), true, "a good status clears the failure");
});

test("ask adds a turn with the cleaned question, clears the draft and starts answering", () => {
  const s0 = reduce(ready(), { type: "draft", text: "  How is the model doing against the league?\n" });
  assert.equal(s0.draft, "  How is the model doing against the league?\n");
  const s1 = reduce(s0, { type: "ask", question: s0.draft, clearDraft: true });
  const t = newest(s1);
  assert.deepEqual({ id: t.id, question: t.question, state: t.state, answer: t.answer, tool: t.tool, cold: t.cold },
    { id: 1, question: "How is the model doing against the league?", state: "asking", answer: "", tool: null,
      cold: false });
  assert.equal(s1.draft, "");
  assert.equal(answering(s1), true);
  assert.equal(canAsk(s1), false, "one question at a time");
  assert.ok(Object.isFrozen(s1) && Object.isFrozen(s1.turns) && Object.isFrozen(t));
  assert.equal(s0.turns.length, 0, "the old state is untouched");
  assert.equal(asked(s0, "What were his biggest surprises?").draft, s0.draft, "a suggestion leaves the box alone");
});

test("ask refuses a blank or too long question, a busy or unready analyst, and a second question", () => {
  const s = ready();
  assert.equal(asked(s, "   "), s);
  assert.equal(asked(s, "x".repeat(501)), s);
  assert.equal(asked(INITIAL), INITIAL);
  const busy = ready({ busy: true });
  assert.equal(asked(busy), busy);
  const one = asked(s);
  assert.equal(asked(one, "Another?"), one);
});

test("a cold model marks the turn, so the page can say the first answer is slower", () => {
  assert.equal(newest(asked(ready({ warm: false }))).cold, true);
});

test("tool, delta, done: the turn streams, the tool line clears on words, done keeps the server's text", () => {
  const s = asked(ready({ warm: false }));
  const id = newest(s).id;
  const tool = { type: "tool", name: "scorecard", label: "Reading the scorecard" };
  const s1 = reduce(s, { type: "event", id, event: tool });
  assert.equal(newest(s1).state, "streaming");
  assert.equal(newest(s1).tool, "Reading the scorecard");
  const s2 = run(s1, { type: "event", id, event: { type: "delta", text: "Shadow leads " } },
    { type: "event", id, event: { type: "delta", text: "2 of 3." } });
  assert.equal(newest(s2).answer, "Shadow leads 2 of 3.");
  assert.equal(newest(s2).tool, null);
  const s3 = reduce(s2, { type: "end", id, outcome: { type: "done", text: "Shadow leads 2 of 3 pairs.",
    cites: [{ seq: 104, ref: "Q3 10:51" }] } });
  const t = newest(s3);
  assert.equal(t.state, "done");
  assert.equal(t.answer, "Shadow leads 2 of 3 pairs.");
  assert.deepEqual(t.cites, [{ seq: 104, ref: "Q3 10:51" }]);
  assert.equal(answering(s3), false);
  assert.equal(s3.status.warm, true, "an answer means the model is loaded now");
  assert.deepEqual(s3.announce, { id, text: "The analyst answered: Shadow leads 2 of 3 pairs." });
});

test("done with no text keeps the streamed words; with none at all it is the no-answer error", () => {
  const s = asked(ready());
  const id = newest(s).id;
  const kept = run(s, { type: "event", id, event: { type: "delta", text: " Streamed words. " } },
    { type: "end", id, outcome: { type: "done", text: "", cites: [] } });
  assert.equal(newest(kept).answer, "Streamed words.");
  const empty = reduce(s, { type: "end", id, outcome: { type: "done", text: "  ", cites: [] } });
  assert.equal(newest(empty).state, "error");
  assert.match(newest(empty).error, /couldn't put an answer together/);
  assert.equal(newest(empty).retry, true);
});

test("an error ends the turn with its words, keeps any words already shown, and is announced", () => {
  const s = asked(ready());
  const id = newest(s).id;
  const s1 = run(s, { type: "event", id, event: { type: "delta", text: "So far he" } },
    { type: "end", id, outcome: { type: "error", reason: "server", message: "The analyst took too long.",
      retry: true } });
  const t = newest(s1);
  assert.equal(t.state, "error");
  assert.equal(t.answer, "So far he");
  assert.equal(t.error, "The analyst took too long.");
  assert.equal(t.retry, true);
  assert.deepEqual(s1.announce, { id, text: "The analyst couldn't answer. The analyst took too long." });
  assert.equal(canAsk(s1), true);
});

test("busy (429) marks the analyst busy until the next status says otherwise", () => {
  const s = asked(ready());
  const id = newest(s).id;
  const s1 = reduce(s, { type: "end", id, outcome: { type: "error", reason: "busy", retry: true,
    message: "The analyst is answering another question. Ask again when it's done." } });
  assert.equal(s1.status.busy, true);
  assert.equal(canAsk(s1), false);
  assert.equal(canAsk(reduce(s1, { type: "status", status: status() })), true);
});

test("aborted: the turn is stopped, its words stay, nothing is announced", () => {
  const s = asked(ready());
  const id = newest(s).id;
  const s1 = run(s, { type: "event", id, event: { type: "delta", text: "Half" } },
    { type: "end", id, outcome: { type: "aborted" } });
  assert.equal(newest(s1).state, "stopped");
  assert.equal(newest(s1).answer, "Half");
  assert.equal(newest(s1).retry, true);
  assert.equal(s1.announce, null);
  assert.equal(answering(s1), false);
});

test("events and endings for any turn but the one answering change nothing", () => {
  const s = asked(ready());
  const id = newest(s).id;
  const done = reduce(s, { type: "end", id, outcome: { type: "done", text: "Yes.", cites: [] } });
  assert.equal(reduce(done, { type: "event", id, event: { type: "delta", text: "late" } }), done);
  assert.equal(reduce(done, { type: "end", id, outcome: { type: "error", message: "late", retry: true } }), done);
  assert.equal(reduce(s, { type: "event", id: 99, event: { type: "delta", text: "x" } }), s);
  assert.equal(reduce(s, { type: "event", id, event: { type: "thinking" } }), s);
  assert.equal(reduce(s, { type: "nope" }), s);
});

test("retry asks the newest failed or stopped question again as a new turn; never an answered one", () => {
  const s = asked(ready());
  const id = newest(s).id;
  const network = { type: "error", reason: "network", message: "x", retry: true };
  const failed = reduce(s, { type: "end", id, outcome: network });
  const again = reduce(failed, { type: "retry", id });
  assert.equal(again.turns.length, 1);
  assert.equal(newest(again).question, "What were his biggest surprises?");
  assert.equal(newest(again).state, "asking");
  assert.notEqual(newest(again).id, id, "a new id: a late event from the old request can't touch it");
  const refused = reduce(s, { type: "end", id, outcome: { type: "error", reason: "refused", message: "x",
    retry: false } });
  assert.equal(reduce(refused, { type: "retry", id }), refused);
  const answered = reduce(s, { type: "end", id, outcome: { type: "done", text: "Yes.", cites: [] } });
  assert.equal(reduce(answered, { type: "retry", id }), answered);
  const notReady = reduce(failed, { type: "status", status: status({ ready: false }) });
  assert.equal(reduce(notReady, { type: "retry", id }), notReady);
});

test("the conversation keeps its newest turns", () => {
  let s = ready();
  for (let i = 0; i < TURNS_KEPT + 3; i += 1) {
    s = asked(s, `Question ${i}?`);
    s = reduce(s, { type: "end", id: newest(s).id, outcome: { type: "done", text: `Answer ${i}.`, cites: [] } });
  }
  assert.equal(s.turns.length, TURNS_KEPT);
  assert.equal(s.turns[0].question, "Question 3?");
});

test("status and statusFailed: the newest word wins", () => {
  const s = reduce(INITIAL, { type: "statusFailed", message: "Can't reach the app server." });
  assert.equal(s.statusError, "Can't reach the app server.");
  const s1 = reduce(s, { type: "status", status: status({ warm: false }) });
  assert.equal(s1.statusError, null);
  assert.equal(s1.status.warm, false);
  assert.equal(reduce(s1, { type: "status", status: null }), s1, "an unreadable status changes nothing");
});
