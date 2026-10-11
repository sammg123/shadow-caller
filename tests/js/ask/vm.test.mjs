// static/js/ask/vm.js: what the analyst panel shows, from the state (pure). The phase (idle, asking, streaming, done,
// error), the status word and its note (checking, ready, warming up, busy, not ready with the backend's own message,
// offline, answering), each turn's lines, the cite keys, the send key, the suggestions for a first-time viewer.
import assert from "node:assert/strict";
import test from "node:test";
import { ASK } from "../../../static/js/ask/copy.js";
import { INITIAL, newest, reduce } from "../../../static/js/ask/state.js";
import { normalizeStatus } from "../../../static/js/ask/stream.js";
import { askVm, citeChips, citeLabel, statusOf } from "../../../static/js/ask/vm.js";
import { statusBody } from "./helpers.mjs";

const status = (over) => normalizeStatus(statusBody(over));
const ready = (over = {}) => reduce(INITIAL, { type: "status", status: status(over) });
const asked = (state, question = "What does he call on 3rd and short?") => reduce(state, { type: "ask", question });
const end = (state, outcome) => reduce(state, { type: "end", id: newest(state).id, outcome });
const event = (state, ev) => reduce(state, { type: "event", id: newest(state).id, event: ev });

test("the phase follows the newest turn: idle, asking, streaming, done, error; a stopped turn is idle again", () => {
  const s = asked(ready());
  assert.equal(askVm(INITIAL).phase, "idle");
  assert.equal(askVm(s).phase, "asking");
  assert.equal(askVm(event(s, { type: "delta", text: "A" })).phase, "streaming");
  assert.equal(askVm(end(s, { type: "done", text: "A.", cites: [] })).phase, "done");
  assert.equal(askVm(end(s, { type: "error", reason: "cut", message: "x", retry: true })).phase, "error");
  assert.equal(askVm(end(s, { type: "aborted" })).phase, "idle");
});

test("status words: checking, ready, warming up, busy, not ready (the backend's own message), offline", () => {
  assert.deepEqual(statusOf(INITIAL), { key: "checking", word: "Checking", tone: "idle", note: "" });
  assert.deepEqual(statusOf(ready()), { key: "ready", word: "Ready", tone: "good", note: "" });
  const warming = statusOf(ready({ warm: false }));
  assert.equal(warming.key, "warming");
  assert.equal(warming.word, "Warming up");
  assert.match(warming.note, /about 10 s/);
  const busy = statusOf(ready({ busy: true }));
  assert.equal(busy.key, "busy");
  assert.equal(busy.tone, "warn");
  const message = "The analyst needs Ollama running with gpt-oss:20b. Start Ollama, then ask again.";
  const down = statusOf(ready({ ready: false, ollama: false, message }));
  assert.deepEqual(down, { key: "down", word: "Not ready", tone: "bad", note: message });
  const downNoWords = statusOf(ready({ ready: false, message: null, model: "llama3:8b" }));
  assert.match(downNoWords.note, /Ollama running with llama3:8b/);
  const offline = statusOf(reduce(INITIAL, { type: "statusFailed", message: "Can't reach the app server." }));
  assert.deepEqual(offline, { key: "offline", word: "Offline", tone: "bad", note: "Can't reach the app server." });
});

test("while his own question answers the word is Answering (with the warm-up note on a cold model)", () => {
  assert.deepEqual(statusOf(asked(ready())), { key: "answering", word: "Answering", tone: "warn", note: "" });
  assert.match(statusOf(asked(ready({ warm: false }))).note, /about 10 s/);
});

test("send: disabled with an empty box or an unready analyst, Stop while answering", () => {
  const s = ready();
  assert.equal(askVm(s).send.mode, "ask");
  assert.equal(askVm(s).send.disabled, true, "nothing typed");
  const typed = reduce(s, { type: "draft", text: "Who leads?" });
  assert.equal(askVm(typed).send.disabled, false);
  assert.equal(askVm(typed).canSend, true);
  assert.equal(askVm(reduce(typed, { type: "status", status: status({ ready: false }) })).send.disabled, true);
  assert.equal(askVm(reduce(typed, { type: "status", status: status({ busy: true }) })).send.disabled, true);
  const answering = askVm(asked(typed, "Who leads?"));
  assert.equal(answering.send.mode, "stop");
  assert.equal(answering.send.label, "Stop");
  assert.equal(answering.send.disabled, false);
  assert.equal(answering.canSend, false);
});

test("the four suggested questions for a first-time viewer, pressable only when a question can go", () => {
  const vm = askVm(ready());
  assert.deepEqual(vm.suggestions.map((s) => s.text), ["How is the model doing against the league?",
    "What does he call on 3rd and short?", "Why did the model lean run on the last snap?",
    "What were his biggest surprises?"]);
  assert.ok(vm.suggestions.every((s) => !s.disabled));
  assert.ok(askVm(INITIAL).suggestions.every((s) => s.disabled));
  assert.ok(askVm(asked(ready())).suggestions.every((s) => s.disabled));
  assert.equal(askVm(ready()).empty, true);
  assert.equal(askVm(asked(ready())).empty, false);
});

test("the intro says where answers come from, and names the model once the status does", () => {
  assert.equal(askVm(INITIAL).facts.length, 2);
  const facts = askVm(ready()).facts;
  assert.equal(facts.length, 3);
  assert.match(facts[2], /gpt-oss:20b/);
});

test("each turn's quiet line: thinking, the cold-start wait, the tool running; none once words arrive", () => {
  const warm = asked(ready());
  assert.equal(askVm(warm).turns[0].line, ASK.lines.thinking);
  assert.equal(askVm(asked(ready({ warm: false }))).turns[0].line, ASK.lines.loading);
  const tool = event(warm, { type: "tool", name: "list_plays", label: "Looking through the plays" });
  assert.equal(askVm(tool).turns[0].line, "Looking through the plays…");
  const words = event(tool, { type: "delta", text: "He" });
  assert.equal(askVm(words).turns[0].line, "");
  assert.equal(askVm(words).turns[0].answer, "He");
  assert.equal(askVm(end(words, { type: "done", text: "He ran.", cites: [] })).turns[0].line, "");
});

test("a finished turn: its words, its cites as keys, its error and the retry key on the newest one only", () => {
  const s1 = end(asked(ready()), { type: "error", reason: "network", message: "Can't reach the app server.",
    retry: true });
  const t1 = askVm(s1).turns[0];
  assert.equal(t1.error, "Can't reach the app server.");
  assert.deepEqual(t1.retry, { shown: true, disabled: false });
  const cites = [{ seq: 120, ref: "Q3 2:52" }];
  const s2 = end(asked(s1, "Another?"), { type: "done", text: "Yes, at Q3 2:52.", cites });
  const [old, last] = askVm(s2).turns;
  assert.equal(old.retry.shown, false, "only the newest turn offers Ask again");
  assert.deepEqual(last.cites, [{ key: "120", seq: 120, label: "Q3 2:52", title: "Show Q3 2:52 on the field" }]);
  const stopped = askVm(end(asked(ready()), { type: "aborted" })).turns[0];
  assert.equal(stopped.stopped, true);
  assert.equal(stopped.retry.shown, true);
  const busyNow = reduce(s1, { type: "status", status: status({ busy: true }) });
  assert.deepEqual(askVm(busyNow).turns[0].retry, { shown: true, disabled: true });
});

test("cite labels: the tools' own Q3 2:52 style, OT and 2OT too; anything else falls back to the play's number", () => {
  assert.equal(citeLabel("Q3 2:52", 120), "Q3 2:52");
  assert.equal(citeLabel("q4 10:05", 9), "Q4 10:05");
  assert.equal(citeLabel("OT 4:10", 9), "OT 4:10");
  assert.equal(citeLabel("2OT 0:31", 9), "2OT 0:31");
  assert.equal(citeLabel("Q5 2:52", 9), "Play 9");
  assert.equal(citeLabel("<b>Q3</b>", 9), "Play 9");
  assert.equal(citeLabel("", 104), "Play 104");
});

test("cite keys say what pressing them does on each page", () => {
  const cites = [{ seq: 104, ref: "Q3 10:51" }, { seq: 104, ref: "Q3 10:51" }, { seq: 7, ref: "bad" }];
  assert.deepEqual(citeChips(cites, "slide"), [
    { key: "104", seq: 104, label: "Q3 10:51", title: "Show Q3 10:51 on the field" },
    { key: "7", seq: 7, label: "Play 7", title: "Show Play 7 on the field" },
  ]);
  assert.equal(citeChips(cites, "embedded")[0].title, "Find Q3 10:51 in every call");
  assert.deepEqual(citeChips(null, "slide"), []);
});

test("the character count shows near the limit", () => {
  const s = ready();
  assert.equal(askVm(reduce(s, { type: "draft", text: "short" })).count.shown, false);
  const near = askVm(reduce(s, { type: "draft", text: "x".repeat(420) })).count;
  assert.deepEqual(near, { shown: true, text: "420 / 500" });
});

test("the announcement for screen readers passes through once per turn", () => {
  const s = end(asked(ready()), { type: "done", text: "He ran it.", cites: [] });
  assert.deepEqual(askVm(s).announce, { id: 1, text: "The analyst answered: He ran it." });
  assert.equal(askVm(ready()).announce, null);
});

test("the view model is frozen data", () => {
  const vm = askVm(end(asked(ready()), { type: "done", text: "He ran it.", cites: [{ seq: 3, ref: "Q1 9:00" }] }));
  assert.ok(Object.isFrozen(vm) && Object.isFrozen(vm.turns) && Object.isFrozen(vm.turns[0].cites[0]));
});

test("no em dash in anything the panel can say", () => {
  const strings = [];
  const walk = (v) => {
    if (typeof v === "string") strings.push(v);
    else if (typeof v === "function") strings.push(String(v("X", "Y")));
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(ASK);
  assert.ok(strings.length > 30);
  assert.deepEqual(strings.filter((s) => s.includes("\u2014")), []);
});
