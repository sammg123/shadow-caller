# The analyst's chat: the Ask slide-out and the Model Report's full chat (phase 4 front end)

Status: **built, not mounted.** restructure-v2.md section 7 item 4: a local AI analyst, typed questions only, with an
Ask slide-out on the GameCast and the full chat on the Model Report. The backend is docs/design/analyst.md (its
section 5 is the contract this follows). This file is the component, its events and the exact steps that mount it on
both pages once the restructure lands.

Files (all new): `static/js/ask/` (`copy.js`, `history.js`, `keys.js`, `ndjson.js`, `state.js`, `vm.js` are pure;
`stream.js` is pure* like `core/api.js`, fetch and timers injected; `view.js` and `panel.js` are the DOM side),
`static/css/ask/ask.css` (structure and tokens only: the neutral look) and `static/css/ask/ask-under-the-lights.css`
(Under the Lights' skin), tests in `tests/js/ask/`.

## 1. What it does

One component, `mountAsk(host, {layout})`, two layouts:

| Layout | Page | Shape |
| --- | --- | --- |
| `slide` | GameCast | A steel drawer that runs out from the left wall on rails (240 ms, none under reduced motion), between the top bar's lower edge and the lower ribbon's upper edge: 360 px wide at 1440, 378 at 1512, 480 at 1920. It never covers the video board, the top bar, the lower ribbon or the band; while it is out, `<html data-ask="open">` widens the field's left safe inset (`--sc-field-safe-left`) by its width plus the 16 px stack gap, so the camera keeps the ball, the lines and the shadow plays in the free field between the drawer and the board. Below 1200 x 640 it is a sheet over the whole screen. Closed until the top bar's Ask key opens it. |
| `embedded` | Model Report | One more board: the steel cabinet and painted plate of the report's boards, as tall as the window under the report's ribbon. From 56 rem wide (container query) the intro and the suggestions stand beside the conversation; narrower, they show until the first question, as in the drawer. |

Inside both, top to bottom (the DOM order is the tab order):

- **The plate:** "ASK THE ANALYST", a lamp and the analyst's state in words (below), and in the drawer the Esc key
  (Close).
- **The note:** an LED strip under the plate when the state has something to say: the backend's own message when it is
  not ready ("The analyst needs Ollama running with gpt-oss:20b. Start Ollama, then ask again."), the warm-up note,
  busy, offline, not set up.
- **The intro** (first-time viewer): "Ask about tonight's game, his calls or how the model works.", what it answers
  from (this game's plays and the model's own numbers, never outside knowledge; only the game up to the play on
  screen; the model it runs on, from the status), and four suggested questions as rows of the board, each a button
  that asks at once: "How is the model doing against the league?", "What does he call on 3rd and short?", "Why did the
  model lean run on the last snap?", "What were his biggest surprises?".
- **The conversation** on the LED face, like a stadium's captioning board: his question in amber, the analyst's
  answer in warm white, both sentence case; while a tool runs, its label as a quiet dim line beside an amber lamp
  ("LOOKING THROUGH THE PLAYS..."); "THINKING..." before anything arrives, "LOADING THE MODEL, ABOUT 10 S..." on a cold
  model; each cited play as an LED key reading the clock in amber ("Q3 2:52"); an error as a tally-red lamp beside the
  server's words, with the words already streamed kept above it; "STOPPED." for a stopped answer; "Ask again" on the
  newest failed or stopped question. The answer is text, never markup (`textContent`, `white-space: pre-wrap` for its
  line breaks and short hyphen bullets): it can quote ESPN's play text. The face follows new words while the reader is
  at its end and stays put when they scrolled up.
- **The desk:** an LED input (amber caret, 500 characters at most, grows to six lines) and the Enter key ("Ask";
  "Stop" while answering, at the same width so the box never jumps), "Shift+Enter for a new line." and the count
  ("412 / 500") from 400 characters.
- A visually hidden live region (`role="status"`, polite, atomic) that announces each finished answer once ("The
  analyst answered: ...") or its error ("The analyst couldn't answer. ..."); never the deltas. The conversation itself
  is not a live region.

**Status words** (lamp, word, note): Checking (unlit) until the first status; Ready (green); Warming up (amber; "The
first answer takes about 10 s longer while the model loads."); Busy (amber; another question is answering); Answering
(amber; this panel's own question, with the warm-up note on a cold model); Not ready (tally red; the backend's
`message`); Offline (tally red; the status couldn't be read); Not set up (tally red; the server answers 404, so the
blueprint isn't registered yet). Ask and the suggestions work only when the analyst said it is ready and not busy and
nothing is answering; Ask also needs a question (1 to 500 characters after the server's own cleaning).

**Keys.** Enter asks (Ctrl or Cmd with Enter too); Shift+Enter or Alt+Enter is a new line; nothing is sent while an
input method is composing. The app's shortcuts (Space, Left, Right, 1 to 4, V, Escape) never fire in the box:
`core/keyboard.js` classifies a textarea as text and the keymap ignores text (held as a contract by
`tests/js/ask/keys.test.mjs`). In the drawer, Escape closes it and gives focus back to the Ask key when the Escape
comes from inside the drawer, from the Ask key or from nowhere in particular (the page's body); the panel listens in
the capture phase and prevents it, so the page's Escape (Go Live) never sees it. Escape on any other control is that
control's or the page's. Keys on the panel's buttons (a cite key, a suggestion) work as they do on any button of the
page, so Left and Right still step the game from a cite key.

## 2. The calls (docs/design/analyst.md section 5)

- **`POST /api/ask`** with `{"question", "history"}`, `Accept: application/x-ndjson`, `cache: "no-store"`, same-origin
  credentials. The body is read incrementally (`ndjson.js`): a line split across chunks or a character split across
  two, several events in one chunk, CRLF, a last line with no newline, a malformed line (counted, skipped), unknown
  types (skipped). Every string is checked and capped. The first `done` or `error` ends the read; anything after it is
  ignored. A stream that ends without either says "The answer stopped before it finished. Ask again."; a connection
  that drops mid-answer says the same; an `error` after deltas keeps the deltas on screen. A refusal is read as JSON
  `{"error"}`: 400, 403, 413 and 415 show the server's reason and offer no retry; 429 shows the server's words, marks
  the analyst busy and checks the status at once; 404 says the server has no analyst yet; 5xx and anything else show
  the server's words or "The app server answered with an error (503). Ask again."; a network failure says "Can't reach
  the app server, so the question didn't go out. Ask again in a moment."
- **Abort.** One AbortController per question. Closing the drawer, Stop, leaving the page (`pagehide`) and
  `destroy()` abort it; the turn becomes "stopped" with its words kept, nothing announced. A stream that sends nothing
  for 200 s (past the server's 150 s per question, short of its gate's 240 s) is stopped and says so.
- **History** (`history.js`): the answered exchanges only (a failed or stopped one is left out), oldest first, whole
  exchanges so it always starts with a question, at most 10 messages, a question at most 500 characters and an answer
  at most 4,000 (cut on a character with an ellipsis), none empty after the server's cleaning, the newest that fit the
  6,000 characters the server keeps (the first exchange that doesn't fit ends it, as on the server). Characters are
  counted as the server's Python counts them (code points). The whole body then stays under 64 KB, dropping the oldest
  exchanges first.
- **`GET /api/ask/status`**, read when the drawer opens or the embedded chat mounts, 400 ms after each answer ends
  (the server frees its one-question gate when the response closes; a check that beat it would flash Busy), at once
  after a refusal, when the box is focused and the last check is 30 s old (the model unloads after 10 minutes), every
  5 s while not ready or offline, every 2 s while busy, every 30 s while not set up; never while the drawer is closed.
  A finished answer marks the model warm at once.

## 3. The component and its events

```js
import { mountAsk } from "./ask/panel.js";   // or "../ask/panel.js" from report/
const ask = mountAsk(host, { layout: "slide" });   // "slide" (GameCast) or "embedded" (Model Report)
ask.open(askKey);      // slide: shows it, focus in the box; askKey gets aria-controls and aria-expanded
ask.close();           // slide: hides it, aborts a question on its way, focus back to the key
ask.toggle(askKey);
ask.isOpen();          // embedded: always true
ask.destroy();         // aborts, stops the checks, removes its listeners and nodes
ask.root;              // the panel's element: <aside id="sc-ask"> (slide) or <div id="sc-ask"> (embedded)
```

Options for tests and harnesses: `id` (the root's id, `sc-ask` by default; the title is `${id}-title`, the box
`${id}-input`), `fetchImpl`, `timers` ({setTimeout, clearTimeout}), `now`, `raf` (render batching: one render per
animation frame however many deltas arrive; the window's own by default).

Events, dispatched on `ask.root`, bubbling (`CustomEvent`):

| Event | `detail` | When | What the host does |
| --- | --- | --- | --- |
| `sc:ask-cite` | `{seq, ref}` | a cite key is pressed (`seq` is the timeline's seq, the watch's idx after that play; `ref` the key's words, "Q3 2:52") | GameCast: `actions.seek(seq)` (POST /api/watch/seek). Model Report: scroll to that call's row. |
| `sc:ask-toggle` | `{open}` | the drawer opened or closed | GameCast: re-read the field's insets (`rt.engine?.setSafeArea?.(null)`), so the camera reframes around the drawer. |

Hooks for styles and tests: `.sc-ask[data-layout][data-open][data-phase="idle|asking|streaming|done|error"]`
`[data-status="checking|ready|warming|busy|answering|down|offline|missing"][data-empty]`, `<html data-ask="open">`,
and `data-testid`: `ask-panel`, `ask-status`, `ask-close`, `ask-suggestion`, `ask-log`, `ask-turn`, `ask-cite`,
`ask-retry`, `ask-input`, `ask-send`.

## 4. Mounting on the GameCast (static/index.html, static/js/main.js)

1. **index.html, head:** after the last component sheet (`components/win-prob.css`), before the world's sheets:

   ```html
   <link rel="stylesheet" href="/static/css/ask/ask.css">
   <link rel="stylesheet" href="/static/css/ask/ask-under-the-lights.css">
   ```

   Both stay as page links: `theme/apply.js` swaps only `[data-world-css]` links, and every rule in the second sheet is
   scoped to `:root[data-world="under-the-lights"]`, so it is inert under `?world=neutral`. (To keep it in the world's
   folder instead: move it to `static/css/worlds/under-the-lights/ask/ask.css` and, in the same change, add
   `CSS("ask/ask")` to the world's `css` list in `theme/worlds/under-the-lights/index.js` and `"ask/ask"` to
   `ULS_PARTS` in `report/world.js`, because `tests/js/uls-world.test.mjs` fails on any sheet in that folder no page
   registers; then point `tests/js/ask/ask-skin.test.mjs` at the new path.)

2. **index.html, body:** the drawer's host, right after `#app`'s closing tag and before `#rg-conn`, outside `#app`
   (the world's `arrange()` and the neutral grid leave it alone; the drawer itself is `position: fixed`):

   ```html
   <div id="rg-ask" data-region="ask"></div>
   ```

   Optionally add `"rg-ask"` to `SHELL_IDS` in `shell/bindings.js`.

3. **main.js:** in `boot()`, after `listenToWorld(app, { actions, rt });`, add
   `mountAnalyst(doc, { actions, rt, notices }).catch(core.onError);` and this function. The import is dynamic, so a
   broken analyst leaves a notice and never stops the GameCast; the Ask key is shown only once the drawer mounted
   (`ui/view-keys.js` builds it hidden; `tests/js/masthead.test.mjs` keeps holding that):

   ```js
   /** restructure-v2.md 7 item 4: the analyst's Ask slide-out, under the top bar's Ask key. */
   async function mountAnalyst(doc, { actions, rt, notices }) {
     const host = doc.getElementById("rg-ask");
     const key = doc.querySelector('[data-testid="ask"]');
     if (!host || !key) return;
     let mod;
     try {
       mod = await import("./ask/panel.js");
     } catch (err) {
       notices.show("ask", `The analyst couldn't load (${message(err)}).`);
       return;
     }
     const ask = mod.mountAsk(host, { layout: "slide" });
     key.hidden = false;
     key.addEventListener("click", () => ask.toggle(key));
     host.addEventListener("sc:ask-cite", (e) => actions.seek(e.detail.seq));
     host.addEventListener("sc:ask-toggle", () => rt.engine?.setSafeArea?.(null));
   }
   ```

4. **Nothing else on the page changes:** no keymap entry (restructure-v2.md 2 lists the only keys; Escape is handled
   as above), no reducer state (the drawer keeps its own; `aria-expanded` on the Ask key is set by the panel).

5. **Tests that flip:** `tests/e2e/test_ui_top_bar.py` line 125 expects the Ask key hidden; it is now visible and
   opens the drawer.

## 5. Mounting on the Model Report (static/report.html, static/js/report/main.js)

1. **report.html, head:** after `report/report.css`, the same two links as the GameCast (step 4.1).

2. **report.html, the section:** keep `hidden` (the script shows it once the chat mounted), make it span both columns
   and name it by the panel's own heading:

   ```html
   <section id="rp-analyst" class="rp-analyst rp-board-wide" data-region="analyst" data-testid="report-analyst"
     aria-labelledby="sc-ask-title" hidden></section>
   ```

3. **report/main.js:** in `boot()`, after `startScheduler(...)`, add
   `mountAnalyst(doc, { motion, notices }).catch(reportError);` and:

   ```js
   /** restructure-v2.md 6 and 7 item 4: the analyst's full chat; a cite scrolls to that call's row. */
   async function mountAnalyst(doc, { motion, notices }) {
     const host = doc.getElementById("rp-analyst");
     if (!host) return;
     try {
       const { mountAsk } = await import("../ask/panel.js");
       mountAsk(host, { layout: "embedded" });
     } catch (err) {
       notices.show("ask", `The analyst couldn't load (${message(err)}).`);
       return;
     }
     host.hidden = false;
     host.addEventListener("sc:ask-cite", (e) => showCall(doc, e.detail.seq, motion));
   }
   ```

   `showCall` is the page's own (it scrolls to `#rp-calls tr[data-seq]` and focuses the row). `REPORT_IDS` already
   lists `rp-analyst`.

4. **Tests that flip:** `tests/e2e/test_report_page.py` lines 73 to 75 expect the analyst region hidden and empty.

## 6. The server

Register the blueprint in app.py exactly as docs/design/analyst.md section 7 says. Until then the chat shows "Not set
up: This server has no analyst yet. Update the app, then restart it with bash start.sh." and checks again every 30 s;
nothing else on either page changes.

## 7. Verified

- Node (`node --test 'tests/js/ask/*.test.mjs'`): the NDJSON reader over every case above, the stream client's
  refusals, network failure, abort and stall, the history and body rules, the state's phases and stale-event rules, the
  view model's words, the cite keys, the textarea's keys and the page keyboard's contract, the panel on the fake DOM
  (open, Escape, focus, Enter, Shift+Enter, suggestions, cites, text-only rendering, announcement once, stop, 429 and
  retry, not ready, the status schedule, embedded, destroy), the two sheets against the world's rules, the modules'
  purity.
- A real Chromium against a throwaway harness and a fake NDJSON server (not in the repo), at 1512x982 and 1920x1080 in
  both worlds: the drawer never overlaps the board, the top bar or the lower ribbon; the field's left inset is the
  drawer's width plus 16 px while open and 0 after; no app shortcut fires from the box (the app's real
  `core/keyboard.js` attached); Escape closes the drawer without Go Live and gives focus back, and the next Escape is
  Go Live again; history goes out on the second question; the embedded chat is full height.

## 8. Open items

- On the Model Report a cite to an opponent's play has no row in "Every call v the model" (it lists his snaps), so
  `showCall` does nothing; it could fall back to the nearest of his calls before it, or to the drive's row.
- A cite on the GameCast seeks: during a live game that leaves Go Live (POST /api/watch/seek starts a watch session at
  that play; Escape or Go Live returns). After a seek back, the analyst only knows the game up to that play (no
  spoilers, analyst.md section 2), which is right but worth knowing in a demo.
- The top bar's Ask key has no LED window, so its open state (`aria-expanded="true"`) shows no lit window in Under the
  Lights; the Settings key has the same gap.
