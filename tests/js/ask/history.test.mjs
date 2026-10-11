// static/js/ask/history.js: what POST /api/ask sends (docs/design/analyst.md section 5). The question is text, 1 to 500
// characters after trimming, control characters other than line breaks and tabs dropped (the server's own rule).
// history is the earlier answered exchanges, oldest first: at most 10 messages, a user message at most 500 characters,
// an assistant one at most 4,000, none empty; the newest that fit the server's 6,000-character window; and the whole
// body under the app's 64 KB limit, dropping the oldest first.
import assert from "node:assert/strict";
import test from "node:test";
import { LIMITS, capText, cleanText, codePoints, historyOf, questionOf, requestBody, utf8Length }
  from "../../../static/js/ask/history.js";

const turn = (id, question, answer, state = "done") => ({ id, question, answer, state, cites: [] });

test("the limits are the contract's", () => {
  assert.deepEqual({ ...LIMITS }, { question: 500, messages: 10, user: 500, assistant: 4000, chars: 6000,
    bodyBytes: 64 * 1024 });
  assert.ok(Object.isFrozen(LIMITS));
});

test("cleanText drops control characters but keeps line breaks and tabs, then trims", () => {
  assert.equal(cleanText("  Third\u0000 down\r\n\tplease\u007f \u0085"), "Third down\n\tplease");
  assert.equal(cleanText(42), "");
  assert.equal(cleanText("\ud800 lone"), "� lone", "a lone surrogate becomes the replacement character");
});

test("questionOf: 1 to 500 characters after cleaning, else null", () => {
  assert.equal(questionOf("  What does he call on 3rd and short?  "), "What does he call on 3rd and short?");
  assert.equal(questionOf("   \n\t "), null);
  assert.equal(questionOf("\u0001\u0002"), null);
  assert.equal(questionOf("x".repeat(500)).length, 500);
  assert.equal(questionOf("x".repeat(501)), null);
  assert.equal(questionOf(undefined), null);
});

test("codePoints counts characters the way the server does; capText cuts on a character, never mid-pair", () => {
  assert.equal(codePoints("🏈🏈"), 2);
  assert.equal(capText("short", 10), "short");
  const cut = capText("🏈".repeat(10), 5);
  assert.equal(codePoints(cut), 5);
  assert.ok(cut.endsWith("…"));
  assert.doesNotMatch(cut, /[\ud800-\udbff](?![\udc00-\udfff])/, "no half of a pair");
});

test("utf8Length counts the bytes the body takes on the wire", () => {
  assert.equal(utf8Length("abc"), 3);
  assert.equal(utf8Length("é"), 2);
  assert.equal(utf8Length("’"), 3);
  assert.equal(utf8Length("🏈"), 4);
  assert.equal(utf8Length(""), 0);
});

test("history holds only answered exchanges, oldest first, as user then assistant", () => {
  const turns = [turn(1, "Q one?", "A one."), turn(2, "Q two?", "", "error"), turn(3, "Q three?", "Half", "stopped"),
    turn(4, "Q four?", "A four."), turn(5, "Q five?", "", "asking")];
  assert.deepEqual(historyOf(turns), [
    { role: "user", content: "Q one?" }, { role: "assistant", content: "A one." },
    { role: "user", content: "Q four?" }, { role: "assistant", content: "A four." },
  ]);
  assert.deepEqual(historyOf([]), []);
});

test("at most 10 messages: the newest five exchanges", () => {
  const turns = Array.from({ length: 8 }, (_, i) => turn(i + 1, `Q${i + 1}?`, `A${i + 1}.`));
  const history = historyOf(turns);
  assert.equal(history.length, 10);
  assert.equal(history[0].content, "Q4?");
  assert.equal(history.at(-1).content, "A8.");
});

test("each message fits its cap: a long answer is cut to 4,000 characters, never sent empty", () => {
  const long = "word ".repeat(1500);
  const [user, assistant] = historyOf([turn(1, "Explain the model in detail?", long)]);
  assert.equal(user.content, "Explain the model in detail?");
  assert.ok(codePoints(assistant.content) <= 4000);
  assert.ok(assistant.content.endsWith("…"));
  assert.deepEqual(historyOf([turn(1, "Q?", "   \u0000 ")]), [], "an answer that cleans to nothing is left out");
  assert.deepEqual(historyOf([turn(1, "  ", "An answer.")]), [], "so is a question that does");
});

test("the newest exchanges that fit the server's 6,000-character window; the first that doesn't ends it", () => {
  const big = "b".repeat(3000);
  const turns = [turn(1, "Old?", "small"), turn(2, "Middle?", big), turn(3, "New?", big)];
  const history = historyOf(turns);
  assert.deepEqual(history.map((m) => m.content.slice(0, 6)), ["New?", "bbbbbb"],
    "the middle exchange would pass 6,000, so it and everything older stay home");
});

test("the request body carries the question and the history, and stays under the byte limit", () => {
  const turns = [turn(1, "Q one?", "A one."), turn(2, "Q two?", "A two.")];
  const body = requestBody("Q three?", turns);
  assert.deepEqual(Object.keys(body), ["question", "history"]);
  assert.equal(body.question, "Q three?");
  assert.equal(body.history.length, 4);
  assert.ok(Object.isFrozen(body));
});

test("over the byte limit the oldest exchanges go first, in pairs, until it fits", () => {
  const turns = [turn(1, "Q one?", "’".repeat(900)), turn(2, "Q two?", "’".repeat(900)),
    turn(3, "Q three?", "’".repeat(900))];
  const limits = { ...LIMITS, bodyBytes: 6000 };
  const body = requestBody("Now?", turns, limits);
  const bytes = utf8Length(JSON.stringify(body));
  assert.ok(bytes < limits.bodyBytes, `${bytes} bytes`);
  assert.deepEqual(body.history.filter((m) => m.role === "user").map((m) => m.content), ["Q two?", "Q three?"]);
  const tiny = requestBody("Now?", turns, { ...LIMITS, bodyBytes: 100 });
  assert.deepEqual(tiny.history, [], "with no room at all only the question goes");
});

test("the worst history the caps allow still fits 64 KB", () => {
  const heavy = (ch) => Array.from({ length: 12 }, (_, i) => turn(i, ch.repeat(500), ch.repeat(4000)));
  for (const ch of ["’", "🏈", "\"", "\n"]) {
    const body = requestBody("’".repeat(500), heavy(ch));
    const bytes = utf8Length(JSON.stringify(body));
    assert.ok(bytes < 64 * 1024, `${JSON.stringify(ch)}: ${bytes} bytes`);
    assert.ok(body.history.length <= 10);
  }
});
