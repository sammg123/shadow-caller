// What POST /api/ask sends (pure; docs/design/analyst.md section 5). The question: text, 1 to 500 characters after
// the server's own cleaning (control characters other than line breaks and tabs dropped, then trimmed). The history:
// the earlier answered exchanges, oldest first, at most 10 messages, a user message at most 500 characters and an
// assistant one at most 4,000, none empty, the newest that fit the 6,000 characters the server keeps (an exchange that
// doesn't fit ends it, as on the server), whole exchanges only, so it always starts with a question. Then the whole
// body stays under the app's 64 KB limit, dropping the oldest exchanges first. Characters are counted the way the
// server's Python counts them (code points), so a pair of UTF-16 halves is one character here too.

export const LIMITS = Object.freeze({
  question: 500,
  messages: 10,
  user: 500,
  assistant: 4000,
  chars: 6000,
  bodyBytes: 64 * 1024,
});

const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/g;
const EDGE_SPACE = /^[\s\u0085]+|[\s\u0085]+$/g;
const ELLIPSIS = "…";

/**
 * Text as the server keeps it: control characters other than line breaks and tabs dropped, a lone surrogate made
 * the replacement character, trimmed. "" for anything that isn't text.
 * @param {unknown} value
 * @returns {string}
 */
export function cleanText(value) {
  if (typeof value !== "string") return "";
  const text = value.replace(CONTROL, "");
  const whole = typeof text.toWellFormed === "function" ? text.toWellFormed() : text;
  return whole.replace(EDGE_SPACE, "");
}

/** Characters (code points), the way the server counts them. */
export function codePoints(text) {
  let n = 0;
  for (const _ of String(text)) n += 1;
  return n;
}

/**
 * At most `max` characters: a longer text is cut on a character boundary and ends with an ellipsis.
 * @param {string} text
 * @param {number} max
 */
export function capText(text, max) {
  const chars = Array.from(String(text));
  if (chars.length <= max) return String(text);
  return `${chars.slice(0, max - 1).join("").trimEnd()}${ELLIPSIS}`;
}

/** The bytes `text` takes as UTF-8 (a lone surrogate as the replacement character's three). */
export function utf8Length(text) {
  let n = 0;
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}

/**
 * The question the server will take, cleaned, or null (blank, or longer than the limit).
 * @param {unknown} draft
 * @param {typeof LIMITS} [limits]
 * @returns {string | null}
 */
export function questionOf(draft, limits = LIMITS) {
  const question = cleanText(draft);
  return question && codePoints(question) <= limits.question ? question : null;
}

/** One answered turn as a [user, assistant] pair, each within its cap, or null when either cleans to nothing. */
function exchangeOf(turn, limits) {
  const asked = cleanText(turn?.question);
  const said = cleanText(turn?.answer);
  if (!asked || !said) return null;
  return [Object.freeze({ role: "user", content: capText(asked, limits.user) }),
    Object.freeze({ role: "assistant", content: capText(said, limits.assistant) })];
}

/** The newest answered exchanges that fit the message count and the character window, oldest first. */
function exchangesOf(turns, limits) {
  const answered = (Array.isArray(turns) ? turns : []).filter((t) => t?.state === "done")
    .map((t) => exchangeOf(t, limits)).filter(Boolean);
  const kept = [];
  let chars = 0;
  for (let i = answered.length - 1; i >= 0 && (kept.length + 1) * 2 <= limits.messages; i -= 1) {
    const size = answered[i].reduce((sum, m) => sum + codePoints(m.content), 0);
    if (chars + size > limits.chars) break;
    kept.unshift(answered[i]);
    chars += size;
  }
  return kept;
}

/**
 * The history POST /api/ask takes from the conversation so far.
 * @param {ReadonlyArray<{ state: string, question: string, answer: string }>} turns
 * @param {typeof LIMITS} [limits]
 * @returns {ReadonlyArray<{ role: "user" | "assistant", content: string }>}
 */
export function historyOf(turns, limits = LIMITS) {
  return Object.freeze(exchangesOf(turns, limits).flat());
}

/**
 * The whole body, {question, history}, under limits.bodyBytes: the oldest exchanges go first until it fits.
 * @param {string} question  already checked (questionOf)
 * @param {ReadonlyArray<object>} turns  the conversation before this question
 * @param {typeof LIMITS} [limits]
 * @returns {Readonly<{ question: string, history: ReadonlyArray<object> }>}
 */
export function requestBody(question, turns, limits = LIMITS) {
  let exchanges = exchangesOf(turns, limits);
  for (;;) {
    const body = { question, history: Object.freeze(exchanges.flat()) };
    if (!exchanges.length || utf8Length(JSON.stringify(body)) < limits.bodyBytes) return Object.freeze(body);
    exchanges = exchanges.slice(1);
  }
}
