// Every word the analyst panel shows (pure; docs/design/analyst-ui.md). Plain football language, sentence case (a
// world sets plates and keys in caps with text-transform), no em dashes. The server's own messages (the status's
// `message`, an error event's `message`, a refusal's `error`) are shown as the server wrote them; these are the
// panel's own words and the stand-ins when the server sent none. Nothing here names a team or a caller.

const MODEL_FALLBACK = "its model";

export const ASK = Object.freeze({
  title: "Ask the analyst",
  close: "Close",
  closeTitle: "Close the analyst (Esc)",
  inputLabel: "Your question",
  placeholder: "Ask about the game, his calls or the model",
  send: "Ask",
  sendCap: "Enter",
  sendTitle: "Ask (Enter)",
  stop: "Stop",
  stopTitle: "Stop this answer",
  retry: "Ask again",
  hint: "Shift+Enter for a new line.",
  count: (n, max) => `${n} / ${max}`,
  lead: "Ask about tonight's game, his calls or how the model works.",
  facts: Object.freeze({
    source: "It answers from this game's plays and the model's own numbers, never outside knowledge.",
    spoilers: "It only knows the game up to the play on screen.",
    model: (model) => `It runs on this computer (${model || MODEL_FALLBACK}).`,
  }),
  tryLabel: "Try one",
  suggestions: Object.freeze([
    "How is the model doing against the league?",
    "What does he call on 3rd and short?",
    "Why did the model lean run on the last snap?",
    "What were his biggest surprises?",
  ]),
  conversation: "Conversation",
  emptyLog: "Answers appear here, with a key for each play they mention.",
  youAsked: "You asked:",
  analystSaid: "The analyst:",
  citesLabel: "Plays in this answer",
  citeTitle: Object.freeze({
    slide: (ref) => `Show ${ref} on the field`,
    embedded: (ref) => `Find ${ref} in every call`,
  }),
  citeFallback: (seq) => `Play ${seq}`,
  lines: Object.freeze({
    thinking: "Thinking…",
    loading: "Loading the model, about 10 s…",
    tool: (label) => `${label}…`,
  }),
  stopped: "Stopped.",
  toolFallback: "Looking it up",
  status: Object.freeze({
    checking: "Checking",
    ready: "Ready",
    warming: "Warming up",
    busy: "Busy",
    down: "Not ready",
    offline: "Offline",
    missing: "Not set up",
    answering: "Answering",
  }),
  statusLabel: "Analyst status",
  notes: Object.freeze({
    warming: "The first answer takes about 10 s longer while the model loads.",
    busy: "The analyst is answering another question. Ask again when it's done.",
    down: (model) => `The analyst needs Ollama running with ${model || MODEL_FALLBACK}. Start Ollama, then ask again.`,
    offline: "Can't reach the app server. Check the Terminal running bash start.sh.",
    missing: "This server has no analyst yet. Update the app, then restart it with bash start.sh.",
  }),
  errors: Object.freeze({
    network: "Can't reach the app server, so the question didn't go out. Ask again in a moment.",
    cut: "The answer stopped before it finished. Ask again.",
    stall: "The analyst stopped sending its answer. Ask again.",
    noAnswer: "The analyst couldn't put an answer together. Try asking another way.",
    fault: "Something went wrong in the analyst; the server log has the details.",
    busy: "The analyst is answering another question. Ask again when it's done.",
    refused: "The app server refused that question.",
    missing: "This server has no analyst yet. Update the app, then restart it with bash start.sh.",
    server: (status) => `The app server answered with an error (${status}). Ask again.`,
  }),
  spoken: Object.freeze({
    answer: (text) => `The analyst answered: ${text}`,
    error: (message) => `The analyst couldn't answer. ${message}`,
  }),
});
