# UI architecture for the 3D GameCast rebuild

Status: architecture v1, nothing built yet. This file is the contract between the frontend agents. It sits on top of three binding specs and never overrides them:

- `docs/design/data-contract.md` (cited as **DC**): API, row shape, field frame (A1 to A5), geometry (B5), derivations (B6), pred link (B7), manual mode (D), watch (E), polling (E4), payloads (F).
- `docs/design/feature-inventory.md` (cited as **FI**): every current behavior, the keyboard (section 1), the selector contract (6.2), gaps G1 to G29 (5b), the regression checklist (6.3, cited as `#n`).
- `docs/design/directions.md` (cited as **DIR**): "Product truth every direction carries", "Shared approximation grammar", the shared key additions.

`docs/design/three-recipe.md` did not exist when this was written. If it lands, it governs materials and passes *inside* the scene-engine package (A5); it may not change the interfaces below.

**v1.1 (review fixes, 2026-10-09).** Interface changes since v1, each marked "v1.1" where it lands: `createStore` takes `{onError}` and never throws a reducer or listener error into the dispatcher (2.2); `createSync` takes `onError`, and sync, api, actions and the conductor call injected timers, `fetch` and `now` bare, with `now` in epoch ms (2.8, 3.5); `ViewState.bgPending` holds a G12 message until its state is presented, and the feed bar's `last_play`, `skipped` and `plays_logged` come from the presented state only (2.1, 2.3, 4.6); the snap step and approximate pass arcs (2.4, 7.1); `runIntent` routes an action's rejection to `onError` (2.8); `node --test tests/js/` runs through `tests/js/index.js` (decision 8); missing fixtures fail loudly (7.1).

The visual world (palette, type, HUD composition, materials, lighting) is **not chosen**. Nothing in this architecture picks a color, a font, a size or a placement. Every visual decision enters through the theme layer (section 2.7). The app ships with a deliberately plain `neutral` world so it is usable and testable before a world exists.

---

## 0. Decisions at a glance

| # | Decision | Why |
| --- | --- | --- |
| 1 | One store, one pure reducer, immutable slices. Side effects live only in `sync`, `actions` and the `conductor`. | Several agents can test state logic in node without a browser, and nothing mutates shared objects. |
| 2 | **Presentation gating**: the HUD shows the newest `/api/state` only once the field has drawn every timeline row that state knows about (`state.timeline.n <= drawnThrough`), with a 4 s safety valve. | Gives every world the same "call, snap, verdict" order, keeps Watch mode spoiler-free on screen, and means the scorecard ticks exactly when the play lands. |
| 3 | One `Engine` interface, implemented twice: WebGL (three.js) and a 2D SVG fallback. | The HUD never knows which one it talks to; the fallback draws the same facts (section 6.2). |
| 4 | Field math lives only in `field/coords.js` (DC A5). Geometry is pure data (`field/paths.js`, `field/ghosts.js`); three.js modules only turn primitives into meshes. | Geometry is unit-tested in node, and a world can restyle every stroke without touching the math. |
| 5 | A world plugs in through: CSS custom properties, a declarative **look** object, and three optional hooks (`arrange`, `props`, `moments`), registered in one static registry. | A world is a folder plus one registry line. No world edits a component or the engine. |
| 6 | Components mount into fixed mount points, set **text, never HTML** (G27), and reconcile lists by key so focus survives background renders. | Fixes FI 4.3 (innerHTML rebuilds lose focus) and makes G18 keyboard rows work. |
| 7 | The keyboard is a pure state machine (`core/keymap.js`); the DOM listener only classifies the event target. | Every key, mode and conflict in section 4 is a node unit test. |
| 8 | Node tests run with a **glob**, not a directory: `node --test 'tests/js/**/*.test.mjs'`. v1.1: `node --test tests/js/` also works, through `tests/js/index.js`, which loads every test file in one process. | Verified on this machine (Node v24.19.0): a bare directory argument is not expanded, so node runs it as a module; without `tests/js/index.js` that fails with `MODULE_NOT_FOUND`. The glob (one process per file) stays canonical. |

## 1. Conventions every module follows

- ES modules, no build step. Relative imports always carry the `.js` extension. Only three.js modules may import the bare specifiers `three` and `three/addons/...` (import map in `index.html`).
- **Pure modules** (marked `pure` in section 1.1) import nothing from the DOM, three.js, `window`, `document`, `localStorage`, `fetch`, `performance`, `Date.now()` or `Math.random()`. Time is passed in as `now` (ms). They are unit-tested in node.
- Functions return new objects and never mutate their arguments. Reducer tests deep-freeze their inputs to prove it.
- Files under 400 lines, functions under 50 lines, nesting at most 4 levels. Named constants, no magic numbers.
- Every server string reaches the DOM through `textContent` or an attribute setter. `innerHTML`, `outerHTML`, `insertAdjacentHTML` and `document.write` are banned in `static/js/**` (enforced by `tests/js/static-rules.test.mjs`).
- No `console.log` left behind (same test). Errors are handled explicitly and shown to the user through the toast, the connection banner or the scene error state.
- `localStorage` keys are namespaced `sc:` and every access is wrapped in `try/catch` (private mode throws).
- Server data is validated at the boundary: team colors must match `^#[0-9a-fA-F]{6}$`, logo URLs must match `^/api/logo/[A-Z]{2,4}(\?v=(default|dark))?$`, numbers are checked with `Number.isFinite`. Anything that fails falls back to neutral, never to a guess.

`package.json` at the repo root (create if missing, never add dependencies):

```json
{
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.8" },
  "scripts": {
    "test:js": "node --test 'tests/js/**/*.test.mjs'",
    "test:js:cov": "node --test --experimental-test-coverage --test-coverage-include='static/js/**' --test-coverage-lines=80 --test-coverage-functions=80 --test-coverage-branches=70 'tests/js/**/*.test.mjs'"
  }
}
```

Run from the repo root: `cd /Users/samgoldfeder/Dev/shadow-caller && node --test 'tests/js/**/*.test.mjs'`. Never run bare `node --test` here: with no argument Node scans the whole tree, including `.venv/`.

### 1.1 File tree and owner packages

Every file has exactly one owner package. Packages A0 to A11 build the world-agnostic app now; W1 to W6 (section 8) build a world later and own only that world's folders (`worlds/<id>/`, `fonts/<id>/`, `img/worlds/<id>/`) plus the few shared files named in 8.2. A package that needs a change in a file it does not own asks that file's owner; it never edits it.

```
static/
  index.html                         A0  shell: import map, mount points, module entry
  vendor/three/                          vendored three.js r185 (read-only)
  fonts/<id>/                        W3  self-hosted world fonts (G28); none for neutral
  img/worlds/<id>/                   W2  world icon set (SVG)
  css/
    base.css                         A0  reset, [hidden], focus ring, .sr-only, reduced motion; uses tokens only
    layout.css                       A0  neutral region grid + 1040/760/390 px breakpoints (no horizontal scroll, #8)
    components/
      masthead.css feed-bar.css watch-transport.css field-host.css review-banner.css
      toast.css conn-banner.css boot-screen.css                          A9
      situation-strip.css entry-pad.css flag-panel.css shorthand.css
      last-play.css prediction.css                                       A7
      scoreboard.css play-feed.css drive-chart.css win-prob.css
      box-score.css scorecard.css tendencies.css play-log.css            A8
      scrub.css                                                          W5
    worlds/
      neutral/tokens.css             A10 every required token, neutral values
      <id>/tokens.css layout.css motion.css                              W3
      <id>/components/*.css                                              W2 (except the four W4 files and the two W5 files)
      <id>/components/entry-pad.css flag-panel.css last-play.css shorthand.css, <id>/booth.css   W4
      <id>/components/watch-transport.css scrub.css                      W5
  js/
    main.js                          A0  boot sequence (section 3.1)
    core/
      api.js                         A1  pure*  HTTP client (fetch injected)
      store.js                       A1  pure   createStore
      reducer.js                     A1  pure   combines the slice reducers, initialState
      reduce-server.js               A1  pure   server, version, presented
      reduce-timeline.js             A1  pure   timeline cache events
      reduce-anim.js                 A1  pure   animation queue events
      reduce-conn.js                 A1  pure   boot + connection state
      reduce-view.js                 A2  pure   pick, flag, booth, scorecard, camera, review, sideAtFifty
      timeline-cache.js              A1  pure   merge, gap check, pred patch (DC B7), snapshots
      sync-plan.js                   A1  pure   what to fetch, next delay, backoff
      sync.js                        A1  DOM    poll loop, visibility, kick
      present.js                     A1  pure   presentation gating
      anim-queue.js                  A1  pure   queue rules (DC E4)
      conductor.js                   A1  DOM    store <-> engine bridge
      domain.js                      A1  pure   FAMILIES, LEAVES, familyOf, TEAM regex validators
      keymap.js                      A2  pure   keyboard state machine (section 4)
      keyboard.js                    A2  DOM    keydown listener, target classification
      actions.js                     A2  DOM    intents -> requests, in-flight guard, serialized POSTs
      selection.js                   A2  pure   tap cycles, outcomes, chosen text, payloads
      strip.js                       A2  pure   situation strip edit rules (G1, G2, G3)
      flags.js                       A2  pure   flag keys, summaries, note (G25)
      review.js                      A2  pure   Left/Right review cursor
    model/
      copy.js                        A3  pure   every client-side string, verbatim from FI
      format.js                      A3  pure   pct, pct1, ord, spot text, down & distance, clock
      vm-masthead.js vm-feed.js vm-situation.js vm-prediction.js vm-entry.js
      vm-flags.js vm-last-play.js vm-scorecard.js vm-tendencies.js vm-log.js
      vm-scoreboard.js vm-plays.js vm-drives.js vm-wp.js vm-box.js
      vm-transport.js vm-field.js vm-review.js vm-conn.js verdict.js        A3  pure
    field/
      coords.js grammar.js paths.js ghosts.js timing.js camera-plan.js      A4  pure
      scene.js renderer.js lighting.js post.js field-mesh.js cameras.js
      materials.js player.js ghost-layer.js overlays.js residue.js
      labels.js dispose.js webgl-support.js                                  A5  three.js
      fallback-2d.js fallback-draw.js                                        A6  DOM (SVG)
    ui/
      dom.js scheduler.js                                                   A9 / A0
      masthead.js feed-bar.js watch-transport.js field-host.js review-banner.js
      toast.js conn-banner.js boot-screen.js dialogs.js                     A9
      situation-strip.js entry-pad.js flag-panel.js shorthand.js
      last-play.js prediction.js                                            A7
      scoreboard.js play-feed.js drive-chart.js win-prob.js box-score.js
      scorecard.js tendencies.js play-log.js                                A8
      scrub.js                                                              W5
    theme/
      tokens.js look-schema.js neutral-look.js team-colors.js               A10 pure
      apply.js registry.js                                                  A10 DOM
      worlds/index.js                                                       A10, then W6 (static id → import map)
      worlds/neutral/index.js                                               A10
      worlds/<id>/index.js arrange.js                                       W3
      worlds/<id>/look.js props.js moments.js shaders/                      W1
      worlds/<id>/booth.js                                                  W4
tests/
  js/<module>.test.mjs               owner of the module under test
  js/static-rules.test.mjs           A0  bans innerHTML, console.log, impure imports in pure modules
  js/index.js                        A1  v1.1: lets `node --test tests/js/` load every *.test.mjs (decision 8)
  js/fixtures.mjs                    A1  loads tests/fixtures/*.json for node tests
  fixtures/state_fresh.json state_drive_d25.json state_final.json state_feed_on.json
  fixtures/version_watch_playing.json timeline_contract_rows.json             A1
  fixtures/timeline_tb_dal.json      (produced by another agent; used when present)
  e2e/ui_helpers.py test_ui_*.py     A11 (new files); conftest.py additions are additive only
scripts/capture_ui_fixtures.py       A1  captures the state fixtures from a sandbox (never the live game)
package.json                         A1
```

`pure*` on `api.js`: no DOM, but it calls the injected `fetch`, so it is tested in node with a stub.

Rules for the tree:

- A component's CSS file holds only structure (display, grid, overflow, `[hidden]`) and token references. Colors, fonts, sizes and motion come from tokens; a world overrides per-component skins in `css/worlds/<id>/components/<name>.css`.
- `index.html` links, in order: `base.css`, `layout.css`, every `components/*.css`, then the active world's CSS through `<link id="world-css">` (swapped by `theme/apply.js`).
- New files need a line in this tree first (a doc change by the A0 owner), so two agents never create the same file.

---

## 2. Module interfaces

Types use TypeScript notation for clarity; the code is plain JS with JSDoc. `Row`, `Drive`, `Status`, `Box`, `Field`, `Teams`, `Meta` are exactly the DC shapes (B2, C1 to C5). `StateBody` is `/api/state` (FI Appendix A plus DC F additions `timeline` and `watch`); `VersionBody` is `/api/version` (DC E4).

### 2.1 Store shape

```ts
State = {
  boot:   { phase: "loading" | "ready" | "restart" | "failed", attempts: number, error: string | null },
  conn:   { failures: number, lastOkAt: number | null, retryAt: number | null, lastError: string | null },
  server: StateBody | null,          // newest /api/state body; frozen
  presented: StateBody | null,       // what the HUD shows (3.4)
  presentedSince: number | null,     // when `server` first became newer than `presented` (lag valve)
  version: VersionBody | null,       // newest /api/version; its `feed` and `watch` are the freshest copies
  timeline: TimelineCache,
  anim: AnimState,
  view: ViewState,
  prefs:  { motion: "full" | "reduced", world: string, ambient: "room" | "dark", scene: "auto" | "2d",
            watchSpeed: 1 | 2 | 4 | 10 },   // watchSpeed: chosen before a session starts (default 4), synced with watch.speed
  req:    { seq: number, lastActionApplied: number, inflightActions: number }
}

TimelineCache = {
  epoch: string | null, n: number, source: "espn" | "log" | null,
  mode: "live" | "watch" | "replay" | "manual" | null,
  field: Field | null, teams: Teams | null, teamOrder: string[], meta: Meta | null, wpStart: number | null,
  rows: Row[],                       // rows[i].seq === i + 1; frozen; pred patched (DC B7)
  needsFull: boolean,                // set when an append had a gap; sync refetches since=0 at once
  snapshots: { n: number, drives: Drive[], status: Status, box: Box, unlinked: number[] }[]   // ascending n
}

AnimState = {
  token: number,                     // +1 on every rebuild; engine callbacks carrying an old token are ignored
  queue: { seq: number, origin: "poll" | "action", instant: boolean }[],
  playing: { seq: number, startedAt: number, durationMs: number } | null,
  drawnThrough: number,              // highest seq fully drawn, instantly or animated
  rebuilding: boolean
}

ViewState = {
  pick: { k: string | null, i: number, out: null | "incomplete" | "sack" | "scramble" },
  flag: { open: boolean, gen: number },        // gen +1 on every open (G6)
  booth: { open: boolean, auto: boolean },     // auto: opened by X, closes with the flag panel
  scorecardOpen: boolean,
  camera: string | null,                       // look camera mode id
  review: { seq: number | null },              // null = live edge
  sideAtFifty: string | null,                  // FI 5.5
  stripRejected: { [fieldId: string]: string },// rejected text kept with the invalid style (FI 4.4)
  hoverLeaf: string | null,                    // drives engine.highlightGhost
  toast: { id: number, text: string, err: boolean } | null,
  bgMessage: { text: string, at: number } | null,  // G12
  bgPending: { text: string } | null               // v1.1, G12: a poll's message waiting until its state is presented
}
```

DOM-owned inputs are **not** in the store. `#yards`, `#fTD`, `#fTO`, `#otherFirst` and `#cmd` are never written by a render (FI 4.3); `#feedEvent` and the strip inputs are written only while not focused. Actions read the entry inputs through `ctx.form` (2.6); components pass `#cmd` and `#feedEvent` text as arguments (`actions.runShorthand(text)`, `actions.feedToggle(eventId)`, `actions.replay(eventId)`, `actions.watchStart(eventId)`).

Reducer events (`core/reducer.js` routes each to its slice reducer):

| Event | Payload | Effect |
| --- | --- | --- |
| `boot/attempt`, `boot/failed` | `{now, error?, retryAt?}` | boot phase, attempts (#120) |
| `state/loaded` | `{body, origin: "poll" \| "action", reqSeq, now}` | `server = body` unless `origin === "poll" && reqSeq < req.lastActionApplied` (stale poll). Boot becomes `ready`, or `restart` when `body.keys` is missing (#119). A poll body with new background news sets `view.bgPending` (G12, 4.6). Then `advancePresented`. Whenever `presented` moves on: a presented body with `drive_active === false` closes the flag panel (G7), and `bgPending` becomes `bgMessage` (v1.1). |
| `version/loaded` | `{body, now}` | `version = body` |
| `timeline/loaded` | `{resp, origin, hidden, reducedMotion, now}` | `mergeTimeline`; reset → `anim.rebuild`, `view.review = null`; append → `enqueue`. Re-runs `patchPreds` with `server.log`. |
| `conn/ok`, `conn/failed` | `{now, error?, retryAt?}` | failure count (G11) |
| `anim/started`, `anim/done`, `anim/rebuilt`, `anim/flush` | `{seq?, token, durationMs?, now}` | queue bookkeeping, then `advancePresented` |
| `tick` | `{now}` | lag valve: past `MAX_PRESENT_LAG_MS` → `flushAll` + present |
| `pick/tap`, `pick/outcome`, `pick/leaf`, `pick/clear` | `{key}`, `{out}`, `{leaf}`, `{}` | `selection.*` |
| `flag/open`, `flag/close` | `{}` | flag open/gen; booth auto-open and auto-close |
| `booth/toggle`, `scorecard/toggle`, `scorecard/close`, `camera/set`, `review/set`, `hover/leaf` | | view flags |
| `side/fifty`, `strip/rejected`, `strip/clear` | `{team}`, `{field, text}`, `{field}` | strip memory |
| `toast/show`, `toast/hide`, `bg/message` | `{id, text, err}`, `{id}`, `{text, now}` | toast (hide only if id matches) |
| `req/action-start`, `req/action-end` | `{reqSeq}` | in-flight count, `lastActionApplied` |
| `prefs/set` | `{key, value}` | motion, world, ambient, scene, watchSpeed |

### 2.2 Core, pure

```ts
// core/api.js  (fetch injected; no DOM)
class ApiError extends Error { kind: "network" | "timeout" | "http" | "bad-json"; status: number | null; path: string }
const TIMEOUTS = { version: 4000, state: 8000, timeline: 8000, post: 30000 }   // replay holds LOCK about 11 s (DC E6)
const POST_PATHS: readonly string[]   // /api/situation /api/play /api/penalty /api/retag /api/drive /api/command
                                      // /api/undo /api/reset /api/feed /api/feed/replay /api/watch/{start,pause,resume,step,speed,stop}
function createApi({ fetchImpl, timeouts = TIMEOUTS }): {
  getVersion(): Promise<VersionBody>,
  getState(): Promise<StateBody>,
  getTimeline(since: number, epoch: string | null): Promise<TimelineBody>,   // since: integer >= 0; epoch URI-encoded
  post(path: string, body: object): Promise<{ status: 200 | 400 | 409, body: object }>
}
```

- GETs reject with `ApiError` on network failure, timeout (`AbortController`), non-2xx status, or a body that is not JSON.
- `post` resolves for 200, 400 and 409 with a JSON body (400 bodies are the full state plus `error`, FI 4.4; 409 bodies may be only `{error}`, DC E1). Anything else rejects with `ApiError`. A path outside `POST_PATHS` throws `TypeError` before any request.

```ts
// core/store.js
function createStore(reducer, initialState, options?: { onError?: (err) => void }): {   // options: v1.1
  getState(): State,
  dispatch(event: { type: string, ...payload }): void,   // listeners run only when the reducer returns a new object
  subscribe(listener: (state: State, prev: State, event) => void): () => void
}
// v1.1: a reducer or listener that throws never throws into the dispatcher (sync and actions would read it as a
// dead server or a lost POST). The error goes to onError; the default rethrows it on a microtask so the browser
// still reports it. Only a malformed event (no string type) throws, before anything changes.

// core/timeline-cache.js
function emptyTimeline(): TimelineCache
function mergeTimeline(cache, resp: TimelineBody): { cache: TimelineCache, added: Row[], reset: boolean, needsFull: boolean }
function patchPreds(rows: Row[], log: LogRow[]): Row[]
function snapshotAt(cache, n: number): Snapshot | null        // newest snapshot with snapshot.n <= n
function pruneSnapshots(cache, keepFromN: number): TimelineCache
function rowBySeq(cache, seq: number): Row | null
```

- **Reset** when `resp.reset`, `resp.since === 0` or `resp.epoch !== cache.epoch`: replace everything; `field`, `teams`, `team_order`, `meta` and `wp_start` arrive only then (DC C1).
- **Append** otherwise: rows with `seq <= cache.n` are dropped as duplicates; the rest must start at `cache.n + 1` and be consecutive. A gap returns `needsFull: true` and the cache unchanged; `sync` then refetches `since=0`.
- Every merge pushes a snapshot `{n: resp.n, drives, status, box, unlinked}`; snapshots below the presented `n` are pruned.
- `patchPreds` copies the retag-mutable fields of DC B7 (`family, leaf, name, fam_p, fam_p_league, leaf_p, leaf_p_league, leaf_rank, leaf_rank_league, success, retagged`) from `log[]` onto `row.pred`. Join: `src === "espn"` rows by `log.espn_id === row.id`; `src === "log"` rows by `row.id === "log-" + log.seq`. It returns the same array when nothing changed and new objects only for changed rows. Geometry is never touched.

```ts
// core/sync-plan.js
const POLL_MS = { playing: 250, normal: 1000, hidden: 5000 }
const BACKOFF = { baseMs: 1000, factor: 2, maxMs: 15000, offlineAfter: 3 }
function planTick(local: { epoch, n, version, feedOn, feedState }, v: VersionBody):
  { timeline: null | { since: number, epoch: string | null }, state: boolean }
function nextDelay({ watchState, hidden, failures }): number
function connState({ failures }): "online" | "retrying" | "offline"
```

- `planTick.timeline`: `v.epoch` missing (old server) → `null`; `v.epoch !== local.epoch` or `v.timeline_n < local.n` → `{since: 0, epoch: null}`; `v.timeline_n > local.n` → `{since: local.n, epoch: local.epoch}`; else `null` (DC E4: track `n` from the timeline response, never from `/api/version`).
- `planTick.state`: `v.version !== local.version || v.feed.on !== local.feedOn || v.feed.state !== local.feedState`. Never compare versions with `>` (FI 4.2). A change of `feed.last_poll` alone does not refetch the state; the feed bar reads it from `/api/version` (Appendix A, #95).
- `nextDelay`: `failures > 0` → `min(maxMs, baseMs * factor^(failures - 1))`; hidden tab → 5000; `watchState === "playing"` → 250; else 1000.
- `connState`: 0 failures → online, 1 or 2 → retrying, 3 or more → offline.

```ts
// core/present.js
const MAX_PRESENT_LAG_MS = 4000
function isPresentable(server: StateBody, timeline: TimelineCache, anim: AnimState): boolean
function advancePresented(state: State, now: number): State
function presentedTimeline(state: State): { rows, drives, status, box, unlinked, wpStart, teams, field, meta }
```

- `isPresentable`: `server.timeline` absent (old server), or `server.timeline.epoch === timeline.epoch && server.timeline.n <= anim.drawnThrough && !anim.rebuilding`.
- `advancePresented`: `presented = server` when presentable, or when `now - presentedSince >= MAX_PRESENT_LAG_MS`.
- `presentedTimeline`: rows with `seq <= anim.drawnThrough`; drives, status and box from `snapshotAt(timeline, anim.drawnThrough)`.

```ts
// core/anim-queue.js
const MAX_ANIMATED_QUEUE = 3      // DC E4
const BUDGET_SHARE = 0.8          // DC E4: 0.8 * (watch.next_at - now)
const MIN_ANIM_MS = 120           // a computed duration below this is drawn instantly
const OWN_ACTION_MAX_MS = 800     // rows produced by the operator's own POST
function emptyAnim(): AnimState
function enqueue(anim, rows: Row[], { origin, hidden, reducedMotion }): AnimState
function rebuild(anim, n: number): AnimState            // token + 1, queue [], drawnThrough n, rebuilding true
function nextJob(anim, { now, watch, normalMs: (seq) => number }): null | { seq, durationMs, instant }
function markStarted(anim, job, now): AnimState
function markDone(anim, seq: number, token: number): AnimState   // no-op when token is stale
function flushAll(anim): AnimState                               // every queued item becomes instant
```

- `enqueue`: hidden tab or reduced motion → every item instant. Otherwise append; when more than 3 items are queued, every item except the newest 3 becomes instant (DC E4).
- `nextJob`: `null` while playing or when empty. Instant items → `{instant: true, durationMs: 0}`. Otherwise `normal = normalMs(seq)`; when `watch.state === "playing"` and `0 < watch.next_at - now < 60000`, `durationMs = min(normal, BUDGET_SHARE * (watch.next_at - now) / queue.length)` (DC E4, with the budget shared across queued rows); origin `action` caps at `OWN_ACTION_MAX_MS`; a result under `MIN_ANIM_MS` becomes instant. `next_at` outside that window is ignored (clock skew guard; server and browser share a clock on localhost).

```ts
// core/review.js   (Left/Right, client-only; the server is never rewound)
function drawableSeqs(rows: Row[], drawnThrough: number): number[]    // kind !== "admin", seq <= drawnThrough
function stepReview({ reviewSeq, rows, drawnThrough, watchState }, delta: -1 | 1):
  { reviewSeq: number | null, effect: null | "server-step" | "pause-then-step" }
```

- Left from the live edge shows the newest drawable row; from a reviewed row, the previous one; at the first row, no change.
- Right from a reviewed row shows the next drawable row, or returns to live (`null`) past the newest. At the live edge: `server-step` when the watch is paused, `pause-then-step` when it is playing, otherwise no change.

```ts
// core/domain.js
const FAMILIES = ["run", "dropback", "pa", "screen", "rpo"]     // DC B2 canonical order
const LEAVES = ["run_inside", "run_ot_left", "run_edge_left", "run_ot_right", "run_edge_right",
                "dropback_short", "dropback_mid", "dropback_deep", "pa_short", "pa_mid", "pa_deep",
                "screen", "rpo_run", "rpo_throw"]
function familyOf(leaf: string): string | null                  // by prefix; unknown → null
function safeHex(v: unknown): string | null                     // ^#[0-9a-fA-F]{6}$
function safeLogoUrl(v: unknown): string | null                 // ^/api/logo/[A-Z]{2,4}(\?v=(default|dark))?$
const CALLER_SNAP_KINDS = ["play", "penalty", "kneel", "spike", "other", "punt", "fg", "fg_miss"]   // DC B3
```

```ts
// core/selection.js
const EMPTY_PICK = Object.freeze({ k: null, i: 0, out: null })
function tap(pick, key: string): Pick                     // R → K; same key → i + 1; other key → i 0; clears out (FI 1.3)
function toggleOutcome(pick, out): Pick                   // same outcome again → null (#44)
function pickLeaf(keys, leaf: string): Pick | null        // the key and tap count that yield the leaf (#37)
function selectedLeaf(pick, keys): { leaf, name } | null  // keys[k][i % keys[k].length]
function chosenText(pick, keys, familyNames): { text: string, placeholder: boolean, hint: string | null }
function canLog(pick, keys, driveActive: boolean): boolean
function playPayload(pick, keys, form: { yards: string, td: boolean, turnover: boolean }): object | null
function flagPayload(code, pick, keys, form: { yards: string, autoFirst: boolean }): object
```

- `chosenText` reproduces FI 1.5 cell for cell: incomplete keeps the depth name for dropback, play-action and screen picks, gives "RPO, thrown" for either RPO pick, else "Dropback pass"; sack or scramble gives the family name for dropback, play-action and "RPO, thrown", else "Dropback pass". `hint` is "tap {K} for {next name}" when the cycle has more than one entry and no outcome is set (#38).
- `playPayload`: FI 2.4 (`{"yards":3,"td":false,"turnover":false,"leaf":"run_inside"}`; `family: "dropback"` when only an outcome is picked; `outcome` when set). `flagPayload`: FI 2.5 (`yards` is `parseInt` or `null`; `play` only when something is picked).

```ts
// core/strip.js
const STRIP_FIELDS = ["iQtr", "iClock", "iOff", "iOpp", "iDown", "iTogo", "iYard"]
function stripValues(sit, game, sideAtFifty): { iQtr, iClock, iOff, iOpp, iDown, iTogo, iYard,
                                                side: { team: string, own: boolean, title: string } }
function commit(fieldId, raw: string, { edited: boolean, chipTeam: string }): { body: object | null, restore: boolean }
function sideSwitch({ chipTeam, yardText, sit, game }): { body: { spot: string }, sideAtFifty: string | null }
```

- `stripValues` follows FI 2.3 (To go shows `G` when `togo >= yardline_100`; the 50 uses `sideAtFifty`).
- `commit`: not edited, or empty → `{body: null, restore: true}` (#22, #24, G1). `iYard` with leading letters → `{spot: "<LETTERS> <n>"}` uppercased with one space ("d25" → "D 25", G3); a bare number → `{spot: "<chipTeam> <n>"}`. The other fields map 1:1 to the FI 2.3 payloads.

```ts
// core/flags.js
const FLAG_KEYS = { O: "OFFSIDE", H: "DH", C: "IC", D: "DPI", R: "RTP", U: "URD", M: "FM", Z: "12D",
                    F: "FS", G: "DOG", E: "ILF", L: "OH", P: "OPI", B: "IBB", I: "IG", N: "URO", W: "OFFSET" }
const FLAG_ORDER = ["OFFSIDE", "DH", "IC", "DPI", "RTP", "URD", "FM", "12D", "FS", "DOG", "ILF", "OH", "OPI", "IBB", "IG", "URO"]
function penaltySummary(p): string                        // FI 1.6 "Summary shown"
function flagNote(pick, keys, familyNames): string        // G25: recomputed on every render from the current pick
```

`core/keymap.js` is specified in section 4.

### 2.3 View models, pure (`model/`)

Every VM takes one argument, `pv` (the presented view), and returns a plain frozen object whose strings are final display text. Components never format numbers or pick copy themselves.

```ts
pv = {
  presented: StateBody | null,           // state.presented
  tl: ReturnType<presentedTimeline>,     // rows <= drawnThrough, matching drives/status/box
  version: VersionBody | null,           // freshest feed and watch
  view: ViewState, prefs, conn, boot, anim,
  now: number
}
```

Client-built objects use camelCase keys; server objects keep their snake_case keys (DC 1).

| Module, export | Returns (key fields) | Source of truth |
| --- | --- | --- |
| `format.js` `pct, pct1, ord, signed1, spotText, downDistance, clockText, resultText` | strings. `signed1` always one decimal ("+16.5", "+10.0", "-4.9", G23). `downDistance` says "Goal" when `togo >= yardline_100` (G16). `resultText(row)`: "+8", "-11", "INC", "TD", "INT", "FUMBLE", "FLAG", "PUNT 53", "FG 41 GOOD", "FG MISSED", "" for admin | FI 3.5, 3.9 |
| `copy.js` | every client-side string: headings, hints, empty states, placeholders, titles, client toasts, confirms | FI sections 1 to 3, verbatim |
| `verdict.js` `verdictOf(pred)` | `{level: "leaf" \| "family" \| "passrun" \| null, rank, top1, top3, key: "top1" \| "top3" \| "miss" \| "none"}`. Leaf level when `leaf_rank != null` (top1 = rank 1, top3 = rank <= 3); else family level (`fam_top === family`); else pass/run (`(p >= 0.5) === (dropback === 1)`) | DC B7 |
| `vm-masthead.js` `mastheadVm` | `{title, gameLabel, whoLabel, cameraLabel, cameraMode, boothOpen, scorecardOpen}` | #1 |
| `vm-feed.js` `feedVm` | `{on, state: "off" \| "live" \| "retrying", buttonText, status: {text, strong}[], eventId, watchStartVisible, bgMessage}`; feed fields are `{...presented.feed, ...version.feed}`, except `last_play`, `skipped` and `plays_logged`, which describe applied plays and come from `presented.feed` only (v1.1, decision 2) | FI 3.2, G12 |
| `vm-situation.js` `situationVm` | `{values: stripValues(...), offLabel, oppLabel, clockEst, driveInfo: {text, cue}, endRowHidden, note, rejected}` | FI 2.3, 3.4 |
| `vm-prediction.js` `predictionVm` | off field: `{kind: "offfield", heading, body: {text, strong}[]}`, copy by mode (G24). With a drive: `{kind: "call", top: {leaf, name, pct}[3], flag: {text, cls}, split: {pass, league, labels[3]}, families: {key, name, pct, leaguePct, hot, leaves: {key, name, pct1, barPct, hot, picked, highlighted}[]}[], legend, why: {pts, sign, text}[]}` | FI 3.5 |
| `vm-entry.js` `entryVm` | `{mode: "manual" \| "feed" \| "watch", manualHidden, dim, chosen: chosenText(...), keysOn: {J..O}, outOn: {incomplete, sack, scramble}, logDisabled, hint}` | FI 3.6 |
| `vm-flags.js` `flagsVm` | `{hidden, headings: {def, off}, def: {code, key, label, summary}[], off: [...], otherD, otherO, note, buttonOn}` | FI 1.6, G25 |
| `vm-last-play.js` `lastPlayVm` | `{hidden, kind: "waiting" \| "play", heading, name, yardsText, text, buttons: {key, label, tone, current}[]}`; shows the newest non-nullified row **of any source**, the row retag edits; heading "Last play from ESPN" or "Last play (entered by hand)" (G19) | FI 3.6 |
| `vm-scorecard.js` `scorecardVm` | `{empty, emptyText, groups: {id, title, kpis: {value, label, tone}[]}[], note, expanded}` | FI 3.7 |
| `vm-tendencies.js` `tendenciesVm` | `{title, rows: {key, label, sure, sign, pos: {lo, est, hi}}[], axis, note, mix: {name, his, exp}[], heldOut}`; rows ordered habit then memory, in the fixed key order `early_down, third_long, trailing9, red_zone, dq, last, last_fail, explosive_prev, sack_prev`, unknown keys appended alphabetically in their group (G14) | FI 3.8 |
| `vm-log.js` `logVm` | `{empty, emptyText, columns[9], rows: {seq, snap, time, situation, topPick, actual, hisP, lgP, rank: {text, tone}, yds, nullified}[]}`; nullified rows show an empty "#" cell (G15) | FI 3.9 |
| `vm-scoreboard.js` `scoreboardVm` | `{teams: {abbr, name, logo, score, poss, timeouts, caller, side}[2], qtr, clock, clockEst, downText, state, wpCaller}`; from `tl.status` when the source is `espn`, else from `presented.sit` | DC C2, C5, D |
| `vm-plays.js` `playsVm` | `{rows: {seq, id, kind, team, caller, time, situation, text, result, call, verdict, nullified, retagged, scoring}[] (newest first), unlinkedNote}`; `caller` is `offense_is_caller`, `call` is `pred.name` (patched) on caller snaps, `verdict` is `verdictOf(pred).key` | DC B, C1 |
| `vm-drives.js` `drivesVm` | `{drives: {idx, team, caller, dir, x0, x1, result, resultText, complete, plays, yards, time}[]}`, field-x scale 0 to 100; an in-progress drive ends at the last row's `x_next` | DC C3 |
| `vm-wp.js` `wpVm` | `{available, note, points: {seq, wp}[] (espn_seq order, `wp.caller`), start, current, ariaLabel}`; `start` is `wp_start` on the caller's side (`1 - wp_start` when the caller is away); manual mode → `available: false` | DC B6.7 |
| `vm-box.js` `boxVm` | `{available, teams[2], rows: {label, values[2]}[]}` | DC C4 |
| `vm-transport.js` `transportVm` | `{state, speeds: {value, label, pressed}[4], canStart, canPlay, canPause, canStep, canStop, progress: "104 / 183", error}` from `version.watch` | DC E1 |
| `vm-field.js` `fieldVm` | `{situation: Situation \| null, ghostInput: GhostInput \| null, facts: {driveActive, los, ltg, poss, ballX, ltgX}, ariaLabel, legend}` | FI 6.2, DIR grammar |
| `vm-review.js` `reviewVm` | `{active, seq, text}` | 2.2 review |
| `vm-conn.js` `connVm`, `bootVm` | `{state, text, retryInS}`, `{phase, heading, text}` | G11, #119, #120 |

`vm-field.js` decides the situation the scene draws:

1. Caller drive active (`presented.drive_active`): `ballX = xFromYardline100(caller, sit.yardline_100, caller)`, `ltgX = sit.togo >= sit.yardline_100 ? 100 : ballX + sit.togo` (goal to go puts the line on the goal line, FI 3.3), `dir = 1`, `poss = caller`, `ghostInput = ghostInputFromPrediction(presented.prediction)`.
2. Otherwise, ESPN source with `tl.status.state === "in"` and `status.ball_x != null`: `ballX = status.ball_x`, `poss = status.poss`, `dir = dirOf(poss, caller)`. The line to gain comes from the last presented row with a `post`: `ltgX = x_next + dir * post.togo`, clamped to the goal line; none when `status.ball_kind === "kickoff"`. No ghosts (the opponent has no model).
3. Otherwise `situation: null` (bare field, FI 3.3).

`facts.los` and `facts.ltg` are `yardline_100` **of the team in possession** (the convention of #27 and #28: DAL 25 gives 75 and 65; 1st & Goal at TB 8 gives LTG 0). `ariaLabel`: "Ball on DAL 25. 1st & 10. Line to gain DAL 35." with the possession team named; "DAL off the field." with no situation.

### 2.4 Field geometry, pure (`field/`)

All x and y values are DC field yards (x from the caller's goal line, y from the near sideline). Only `coords.js` converts to world or screen space.

```ts
type Pt = { x: number, y: number }
type Situation = { ballX: number | null, ltgX: number | null, dir: 1 | -1, poss: string | null,
                   kind: "snap" | "kickoff" | null, goalToGo: boolean, down: number | null, togo: number | null }

// field/coords.js  (the only file that does field math, DC A5)
const FIELD = { X_MIN: -10, X_MAX: 110, GOAL_X: [0, 100], POSTS_X: [-10, 110], WIDTH: 53.333, CENTER_Y: 26.667, HASH_Y: [23.583, 29.75] }
function dirOf(team, caller): 1 | -1
function xFromYardline100(team, yl100, caller): number      // 50 + dir * (50 - yl100)         DC A3
function yardline100FromX(team, x, caller): number          // 50 - dir * (x - 50)
function xFromTextSpot(text, caller, aliases = {}): number | null   // "TB 3" → 97 (caller DAL), "50" → 50
function yFromLateral(L, dir): number                        // 26.667 + dir * L                DC A4
function toWorld(x, y, h = 0): { x, y, z }                   // (x - 50, h, 26.667 - y), 1 unit = 1 yd   DC A5
function fromWorld(wx, wz): Pt
function toPlane(x, y, rect: { x, y, w, h }): { px, py }     // 2D fallback: caller end zone left, near sideline at the bottom
function clampX(x): number                                   // [-10, 110]
```

```ts
// field/grammar.js  (named constants; every value is a drawing convention unless a source is given)
const LATERAL_GAP  = { "left end": 8, "left tackle": 4, "left guard": 2, "up the middle": 0,
                       "right guard": -2, "right tackle": -4, "right end": -8 }        // DC A4
const LATERAL_PASS = { left: 12, middle: 0, right: -12 }                              // DC A4
const THIRDS = { left: [8.889, 25.667], middle: [-8.889, 8.889], right: [-25.667, -8.889] }   // L ranges, 1 yd sideline inset
const LANE_HALF_WIDTH = 1.5, CATCH_AREA_RADIUS = 2.5, MIN_BAND_YD = 2, LABEL_STACK_OFFSET = 6
const ARC_APEX = { pass: [0.18, 1.5, 10], punt: [0.3, 8, 22], kickoff: [0.28, 8, 22], fg: [0.25, 5, 14] }  // [k, min, max]: apex = clamp(k * length); height is generic (DIR grammar)
const CROSSBAR_YD = 3.333
const GHOST_DEPTH = { run: [0, 5], short: [0, 9], mid: [10, 19], deep: [20, 35], screen: [-3, 3] }
      // short/mid/deep are the leaves' air-yard buckets; run length, screen band and the deep cap (near the nflverse deep IQR top, 32) are conventions
const GHOST_PASS_HALF_SPAN = 25.667                          // pass leaves carry no side, so their bands span the field
const GHOST_RUN = { run_inside: [0, 2], run_ot_left: [4, 2], run_edge_left: [8, 3],
                    run_ot_right: [-4, 2], run_edge_right: [-8, 3], rpo_run: [0, 3] }   // [L, halfWidth]
```

```ts
// field/paths.js
type Step = (                                     // v1.1: "snap" ground steps, and ghosted on every step
  | { t: "arc",      role: "pass" | "punt" | "kickoff" | "fg", from: Pt, to: Pt, apex: number, endH: number, approx: boolean }
  | { t: "ground",   role: "snap" | "yac" | "return" | "sack" | "kneel" | "march" | "hold", from: Pt, to: Pt, approx: boolean }
  | { t: "corridor", role: "run" | "scramble", x0: number, x1: number, yC: number, halfWidth: number, approx: true }
  | { t: "area",     role: "catch", at: Pt, r: number, approx: boolean }
  | { t: "band",     role: "incomplete", x0: number, x1: number, y0: number, y1: number, approx: true }
  | { t: "mark",     role: "td" | "turnover" | "flag" | "sack" | "safety" | "fg_good" | "fg_miss" | "touchback"
                           | "fair_catch" | "downed" | "oob" | "muffed" | "blocked", at: Pt }
  ) & { ghosted: boolean }
type Drawing = {
  seq: number, id: string, kind: string, team: string, dir: 1 | -1, offenseIsCaller: boolean,
  ghosted: boolean,                              // result.nullified: drawn as a not-counted ghost
  steps: Step[],                                 // time order
  ballStart: Pt | null, ballEnd: Pt | null,      // ballEnd at x_next on the center line; null for TD, FG, admin
  resultLabel: { at: Pt, text: string } | null,  // text = format.resultText(row)
  bounds: { x0, x1, y0, y1 } | null
}
function buildDrawing(row: Row): Drawing
function situationFromRow(row: Row): Situation | null     // before the snap (review, ghost replay)
function situationAfterRow(row: Row): Situation | null    // after the row (x_next, post)
```

`buildDrawing` follows DC B5 kind by kind. The ball always sits on the center line (y 26.667). Lateral offsets come only from `geo.gap` (`LATERAL_GAP`), else `geo.lat` (`LATERAL_PASS`, `THIRDS`), else 0, and are always `approx`. v1.1: snaps on runs, scrambles and passes start with a `ground snap` step to the mesh or set point (`grammar.js` `MESH_YD`, `DROP_YD`; three-recipe row 10), always `approx`; a pass is thrown from that point, so every pass arc is `approx` too (PRODUCT principle 3). The exact air yards stay in the row, and the exact catch or interception x is where the `area`, `yac` and `turnover` steps sit.

| Row | Steps |
| --- | --- |
| run, scramble | `ground snap` x0 → the mesh or set point behind the line (approx), then `corridor` x0 → x_end at `yFromLateral(L, dir)`; `mark td` on a TD |
| completion | `ground snap` x0 → the set point (approx), `arc pass` set point → x_catch (lateral from `lat`; always approx, v1.1), `area catch` at x_catch, `ground yac` x_catch → x_end, `mark td` |
| incompletion | `ground snap`, `arc pass` set point → the band's target (approx), `band incomplete` spanning `x0 + dir * air_band` in the side's third; ball ends at x0 |
| interception | `ground snap`, `arc pass` set point → x_catch (approx), `mark turnover`, `ground return` x_catch → x_end |
| sack, kneel | `ground sack` / `ground kneel` x0 → x_end, `mark sack` on sacks |
| nullified play | the action's steps with `ghosted: true`, then `mark flag` at x0 and `ground march` x0 → x_next |
| penalty, no call | `mark flag` at x0, `ground march` x0 → x_next |
| flag on a play that stands | the play, then `mark flag` at `penalty.at_x` and `ground march` x_end → x_next |
| kickoff | `arc kickoff` from_x → land_x, then `ground return` land_x → ret_end_x, or `mark touchback`, or `mark turnover` at `fumble_rec.x` |
| punt | `arc punt` x0 → land_x, then return or `mark` (oob, fair_catch, downed, muffed, blocked) |
| fg, fg_miss | `ground hold` x0 → x_kick, `arc fg` x_kick → post_x with `endH = CROSSBAR_YD + 2` (good) or `CROSSBAR_YD` and `mark fg_miss` |
| admin | no steps |

```ts
// field/ghosts.js
type GhostInput = { leaves: { leaf: string, p: number }[] }      // the top 3, rank order
type GhostShape = {
  rank: 1 | 2 | 3, leaf: string, family: string, p: number, stack: number,   // stack: index among shapes with identical extents
  kind: "corridor" | "band", x0: number, x1: number,
  yC?: number, halfWidth?: number, y0?: number, y1?: number, clamped: boolean, label: { at: Pt }
}
type GhostSet = { key: string, ballX: number, dir: 1 | -1, shapes: GhostShape[] }
function ghostInputFromPrediction(prediction): GhostInput | null     // /api/state prediction.top
function ghostInputFromPred(pred, leafOrder = LEAVES): GhostInput | null   // row pred.top3 + dist.his_l (review)
function buildGhostSet(input: GhostInput, sit: Situation): GhostSet | null
```

- Run leaves and `rpo_run` are corridors (`GHOST_RUN`, depth `GHOST_DEPTH.run`); `dropback_*`, `pa_*` and `rpo_throw` are full-width bands at their bucket depth; `screen` is a full-width band at `GHOST_DEPTH.screen`.
- x ranges start at the line of scrimmage, run in `dir`, and are clamped to the end line (110 or -10); a band shorter than `MIN_BAND_YD` after clamping is moved into the end zone with `clamped: true`.
- Shapes with identical extents keep separate entries (so `highlightGhost(leaf)` works) with `stack` 0, 1, 2; labels move `LABEL_STACK_OFFSET * stack` yards toward the near sideline. The first DAL snap of the saved game (DC B2: top 3 `run_inside`, `pa_short`, `dropback_short`) is exactly this case and is a unit test.
- `key` is derived from `ballX` and the leaves and their `p`, so a repeated call is a no-op.

```ts
// field/timing.js
type Motion = { groundYps: number, airYps: number, kickYps: number, markMs: number, minStepMs: number, holdMs: number, maxRowMs: number }
type Plan = { totalMs: number, steps: { index: number, startMs: number, endMs: number }[] }
function planDrawing(drawing: Drawing, motion: Motion): Plan     // step = length / speed, at least minStepMs; marks take markMs; + holdMs; scaled down to maxRowMs
function normalDurationMs(drawing, motion): number              // planDrawing(...).totalMs; 0 for admin
function fitPlan(plan: Plan, durationMs: number): Plan          // uniform time scale
function progressAt(plan: Plan, tMs: number): { index: number, u: number }[]   // active steps and their 0..1 progress
function sampleArc(from: Pt, to: Pt, apex: number, endH: number, u: number): { x: number, y: number, h: number }   // h = 4 * apex * u * (1 - u) + endH * u
function sampleLine(from: Pt, to: Pt, u: number): Pt
const EASE: { linear, outCubic, inOutCubic }                    // (u) => u'

// field/camera-plan.js   (what to look at; the 3D rig turns it into a camera pose)
type Frame = { center: Pt, spanX: number, spanY: number, dir: 1 | -1 }
function frameSituation(sit: Situation | null, opts?: { minSpan: number }): Frame   // LOS and LTG in view, room ahead in dir
function frameDrawing(drawing: Drawing, opts?): Frame                                 // bounds + margin
function frameDrive(rows: Row[], driveIdx: number): Frame | null
function nextMode(modeIds: string[], current: string | null): string                  // V cycle, wraps
```

### 2.5 Scene engine (three.js) and the 2D fallback

The HUD and the conductor talk to the field only through `Engine`. Both implementations satisfy it; neither computes probabilities, formats text, or reads the store.

```ts
interface Engine {
  readonly kind: "webgl" | "2d"
  readonly ready: Promise<void>                    // first frame shown after the first setGameFrame
  on(event: "ready" | "anim" | "camera" | "frame" | "error" | "contextlost" | "contextrestored", fn): () => void

  setGameFrame(field: Field, teams: Teams, teamOrder: string[]): void   // once per epoch; clears plays, ghosts, residue
  showSituation(sit: Situation | null): void        // LOS, LTG, ball; null = bare field (FI 3.3)
  showGhosts(set: GhostSet | null): void            // built by the conductor with field/ghosts.js
  clearGhosts(): void
  highlightGhost(leaf: string | null): void         // hover or focus on a prediction row
  playRow(row: Row, opts: { durationMs: number, token: number }): Promise<{ seq: number, token: number, completed: boolean }>
                                                    // durationMs 0 = instant, synchronous, no RAF needed. Never rejects:
                                                    // a failure resolves completed:false and emits "error".
  drawRowsInstant(rows: Row[]): void                // rebuild or catch-up: residue and final ball, no animation
  finishNow(): void                                 // complete the running animation at once
  showReview(row: Row | null, ghosts: GhostSet | null): void   // replay a past row with the ghosts of its own pred; null returns to live
  refreshLabels(rows: Row[]): void                  // pred changed after a retag: relabel, never re-geometry (DC B7)
  markVerdict(v: { seq: number, key: "top1" | "top3" | "miss" | "none" }): void   // world moment; may do nothing
  setCamera(modeId: string, opts?: { instant?: boolean }): void
  cameraModes(): { id: string, label: string }[]   // from look.cameras.modes; the fallback returns one mode
  resize(width: number, height: number): void
  setVisible(visible: boolean): void                // false: RAF stops, every draw is instant
  setReducedMotion(on: boolean): void               // true: instant draws, camera cuts, moments skipped
  debugState(): {
    kind, ready: boolean, frames: number, animState: "idle" | "playing" | "rebuilding" | "reviewing",
    playingSeq: number | null, ghosts: string[], highlight: string | null, camera: string,
    situation: Situation | null, drawCalls: number, triangles: number, geometries: number, textures: number, dpr: number
  }
  dispose(): void
}

// field/scene.js (A5)
async function createEngine(host: HTMLElement, look: Look, opts: { reducedMotion: boolean, capture: boolean }): Promise<Engine>
      // rejects with EngineInitError when WebGL2 or a required extension is missing; main.js then uses the fallback
// field/fallback-2d.js (A6)
function createFallbackEngine(host: HTMLElement, look: Look, opts: { reducedMotion: boolean }): Engine
```

In short, the HUD-facing calls are `engine.setGameFrame(field, teams, teamOrder)`, `engine.showSituation({ballX, ltgX, dir, ...})`, `engine.playRow(row, {durationMs})` (0 is the fast path), `engine.showGhosts(ghostSet)` / `clearGhosts()`, `engine.setCamera(mode)` and `engine.highlightGhost(leaf)`. The engine creates its own canvas (or SVG) inside the `#field` host it is given.

Engine-internal modules (A5; their interfaces are internal to the package but fixed here so the package can split its own work):

| Module | Export | Role |
| --- | --- | --- |
| `renderer.js` | `createRig(canvas, look, {capture}) → {renderer, labels, requestRender(), keepAlive(fn), setSize(w, h), setDpr(r), setVisible(b), info(), dispose()}` | WebGLRenderer (`preserveDrawingBuffer` only when `capture`), render-on-demand loop, DPR cap, context loss |
| `lighting.js` | `buildLighting(look) → {group, named: Record<id, Light>, dispose()}` | lights, fog, background, RoomEnvironment IBL when `look.environment.ibl === "room"` |
| `post.js` | `buildPost(renderer, scene, camera, look) → {render(), setSize(w, h), dispose()} \| null` | EffectComposer: RenderPass, optional UnrealBloomPass, world passes, SMAA or FXAA, OutputPass; `null` when the look needs none |
| `field-mesh.js` | `buildField(look, field, teams, paints) → {group, dispose()}` | turf, stripes, lines, hashes, numerals, end zones, posts, logo decals; static geometry merged |
| `cameras.js` | `createCameraRig(look, aspect) → {camera, modes(), setMode(id, {instant}), aim(frame, {instant}), step(dtMs): boolean, setAspect(a), dispose()}` | poses from `camera-plan` frames; optional OrbitControls within `look.cameras.orbit` |
| `materials.js` | `createKit(look, paints) → {stroke(role, team, {ghosted}), fill(role, team), ghost(rank, family, stack), line("los" \| "ltg"), ball(), dispose()}` | one cached material per key; Line2 or tube or ribbon or decal per `look.strokes` |
| `player.js` | `createPlayer(kit, labels, root) → {start(drawing, plan) → {update(tMs): boolean, finish(), dispose()}}` | builds and animates one Drawing |
| `ghost-layer.js` | `createGhostLayer(kit, labels) → {show(set), clear(), highlight(leaf), fade(opacity), dispose()}` | prediction zones and their pinned labels |
| `overlays.js` | `createOverlays(kit, labels) → {situation(sit), clear(), dispose()}` | LOS, LTG, ball marker |
| `residue.js` | `createResidue(kit, look.residue) → {add(drawing), clear(), dispose()}` | kept plays, merged per material |
| `labels.js` | `createLabels(look.labels, host) → {add(pt3, text, cls), remove(h), clear(), render(scene, camera), setSize(w, h), dispose()}` | CSS2DRenderer, sprite or turf decal; text via `textContent` or canvas `fillText` only |
| `dispose.js` | `disposeTree(object3d): void` | geometries, materials, textures, render targets |
| `webgl-support.js` | `hasWebGL2(doc): boolean` | three r185 needs WebGL2 |

Engine rules:

- `showGhosts` called while a play animates is deferred until the play ends; the last call wins. After a caller snap the predicted zone fades to `look.ghost.afterSnapOpacity` and stays until the next `showGhosts` or `setGameFrame`.
- The last play stays drawn per `look.lastPlay`, then moves to residue (`look.residue.keep`) or is disposed.
- Ghosted (nullified) steps use the stroke's ghosted material; approximate steps use `look.strokes[*].approx`. A world can change how "approximate" looks, never whether it shows.
- `markVerdict` and possession changes call `world.moments` when present, with a timeout of `look.motion.verdictMs`; under reduced motion moments are skipped.
- Every Object3D the engine creates has one owning layer that disposes it. After `setGameFrame` the `renderer.info.memory` counts must return to the post-frame baseline (section 6).

### 2.6 UI components (`ui/`)

```ts
interface Component { update(vm): void, destroy(): void }
function mount(root: HTMLElement, ctx: UiContext): Component      // every component module exports this
type UiContext = { actions: Actions, form: Form, engine: () => Engine | null, copy: typeof Copy }
type Form = {                                                     // entry-pad implements yards/td/to, flag-panel autoFirst
  readYards(): string, writeYards(v: string): void,
  readTD(): boolean, writeTD(b: boolean): void, readTO(): boolean, writeTO(b: boolean): void,
  readAutoFirst(): boolean, writeAutoFirst(b: boolean): void,
  focusYards(): void                                              // focus and select unless already focused (FI 4.6)
}

// ui/dom.js (A9): the only way components touch the DOM
function el(tag, opts?: { id?, cls?, attrs?, data?, text?, on? }, children?: Node[]): HTMLElement
function svgEl(tag, attrs?, children?): SVGElement
function setText(node, text: string | number | null): void        // textContent; null → ""
function setAttr(node, name, value: string | number | boolean | null): void   // null or false removes, true sets ""
function setData(node, key, value): void
function setHidden(node, hidden: boolean): void
function reconcile(parent, items, { key, create, update }): void  // keyed list update that keeps nodes and focus

// ui/scheduler.js (A0)
function createScheduler(store, bindings: { component: Component, deps: (state) => unknown[], select: (pv) => VM }[], { raf, now }):
  { start(): void, flush(): void, stop(): void }                  // one render per animation frame; a binding runs only when a dep changed by identity

// ui/dialogs.js (A9)
function confirmAction(text: string): Promise<boolean>            // window.confirm, so #89 and #106 dialog tests keep working
```

| Component | Mount point in `index.html` | VM | Creates and owns |
| --- | --- | --- | --- |
| `masthead.js` | `#rg-masthead` | `mastheadVm` | h1, `#gameLabel`, `#whoLabel`, `#undoBtn`, `a[href="/api/export.csv"]`, `#resetBtn`, camera, booth and scorecard toggles |
| `feed-bar.js` | `#rg-feed` | `feedVm` | `#feedBtn`, `#feedBtnTxt`, `#feedEvent`, `#replayBtn`, Watch this game, `#feedStatus`, background message |
| `scoreboard.js` | `#rg-scoreboard` | `scoreboardVm` | scoreboard |
| `situation-strip.js` | `#rg-situation` | `situationVm` | `#iQtr #iClock #clockEst #lOff #lOpp #iOff #iOpp #iDown #iTogo #iSide #sideTxt #iYard #driveInfo #endRow [data-end]`, strip note |
| `field-host.js` | `#rg-field` | `fieldVm` | `#field` host and its data attributes, legend; mounts `review-banner.js` (`reviewVm`); a ResizeObserver calls `engine.resize`, `visibilitychange` calls `engine.setVisible`; mirrors `engine.debugState()` into the 5.3 attributes on engine events |
| `watch-transport.js` | `#rg-transport` | `transportVm` | transport buttons, speeds, progress |
| `prediction.js` | `#heroArea` | `predictionVm` | `.pill .lgmark .fam .leaf[data-leaf] .why` |
| `last-play.js` | `#lastPlay` (in `#entry`) | `lastPlayVm` | `[data-retag]` |
| `entry-pad.js` | `#manualEntry`, `#entryHint` (in `#entry`) | `entryVm` | `.key[data-k] .key[data-out] #flagBtn #chosen #yards #fTD #fTO #logBtn`; implements `Form` (yards, td, to) |
| `shorthand.js` | `[data-mount="shorthand"]` (in `#entry`) | static | `#cmd #cmdBtn` |
| `flag-panel.js` | `#flagPanel` (region `flags`) | `flagsVm` | `#flagNote #flagClose [data-pen] #otherFirst`; implements `Form` (autoFirst) |
| `play-feed.js` | `#rg-plays` | `playsVm` | play feed |
| `drive-chart.js` | `#rg-drives` | `drivesVm` | drive chart |
| `win-prob.js` | `#rg-wp` | `wpVm` | win-probability line (SVG) |
| `scorecard.js` | `#kpiArea` (region `score`) | `scorecardVm` | scorecard groups |
| `box-score.js` | `#rg-box` | `boxVm` | team stats table |
| `tendencies.js` | `#rg-tendencies` | `tendenciesVm` | `#profTitle #profArea` |
| `play-log.js` | `#logArea` (region `log`) | `logVm` | log table |
| `toast.js` | `#toast` | `view.toast` | toast (2600 ms, FI 4.5) |
| `conn-banner.js` | `#rg-conn` | `connVm` | offline banner with Retry now |
| `boot-screen.js` | `#rg-boot` | `bootVm` | loading, failed-to-load and restart screens |

Component rules: build the skeleton once in `mount`; `update` only sets text and attributes and reconciles keyed lists; never query outside `root`; never read `store` directly; every handler calls `ctx.actions`. Interactive rows are `<button type="button">` (prediction leaves, play-feed rows, drives) so keyboard users reach them (G18).

### 2.7 Theme interface: what a world must provide

A world is `theme/worlds/<id>/index.js` plus CSS under `css/worlds/<id>/`, registered by one line in `theme/worlds/index.js`:

```ts
type WorldModule = {
  id: string, label: string,
  look: Partial<Look>,                       // resolveLook fills the rest from NEUTRAL_LOOK
  css: string[],                             // hrefs under /static/css/worlds/<id>/
  fonts?: string[],                          // self-hosted under /static/fonts/<id>/ (G28: no runtime Google Fonts)
  arrange?(app: HTMLElement, regions: Record<RegionName, HTMLElement>): void,
        // once at boot, before components mount: may wrap or move whole regions (a sheet with a front and a back,
        // a drawer); never removes or renames a region or an id; keeps a logical tab order
  props?(ctx: { THREE, coords, field, teams, look, kickoff: string | null }): { object: Object3D, update?(dtMs: number): boolean, dispose(): void },
        // set dressing: stands, light towers, plinth, booth frame; kickoff = the first row's ESPN `wall` (day or night games)
  moments?: { presnap?(ctx), snap?(ctx, row), verdict?(ctx, verdict), possession?(ctx, team) },
        // ctx: { THREE, scene, camera, lights: Record<id, Light>, requestRender, tween(ms, fn): Promise<void>, reducedMotion }
  passes?: Record<string, (ctx) => Pass>     // ShaderPass factories named in look.post.extra
}
```

`theme/worlds/index.js` is a static map `{ neutral: () => import("./neutral/index.js"), ... }`; `theme/registry.js` exports `loadWorld(id): Promise<WorldModule>` over that map and rejects unknown ids. The world comes from `?world=<id>` (map keys only), then `localStorage sc:world`, then `neutral`. Nothing is ever imported from a user-supplied path.

**CSS custom properties.** `theme/tokens.js` exports the required list; a world defines every one under `:root[data-world="<id>"]`. Names only; values are the world's.

| Group | Tokens |
| --- | --- |
| Ground and ink | `--sc-bg --sc-surface --sc-surface-2 --sc-surface-raised --sc-scrim --sc-ink --sc-ink-muted --sc-ink-inverse --sc-rule --sc-rule-strong` |
| Meanings (FI 0 keeps the meaning, the world picks the value) | `--sc-pass --sc-run --sc-rpo --sc-gain --sc-los --sc-good --sc-bad --sc-warn --sc-live --sc-focus` |
| Type | `--sc-font-display --sc-font-text --sc-font-num --sc-size-call --sc-size-xl --sc-size-l --sc-size-m --sc-size-s --sc-size-xs --sc-weight-regular --sc-weight-strong --sc-weight-display --sc-case-label --sc-tracking-label --sc-leading-tight --sc-leading-body` |
| Space and shape | `--sc-space-1` to `--sc-space-6`, `--sc-radius-s --sc-radius-m --sc-radius-l --sc-border-w --sc-focus-w --sc-gutter --sc-field-aspect` |
| Motion | `--sc-dur-fast --sc-dur-med --sc-dur-slow --sc-ease-out --sc-ease-in-out` |
| Runtime (set by `theme/apply.js` from DC C2 teams; worlds read, never define) | `--sc-team-caller --sc-team-caller-alt --sc-team-caller-ink --sc-team-opp --sc-team-opp-alt --sc-team-opp-ink --sc-team-off --sc-team-off-ink --sc-team-def` |

Attribute hooks a world styles against (set by `theme/apply.js` and the conductor, never by world code): on `<html>`: `data-world`, `data-motion` (`full`, `reduced`), `data-ambient` (`room`, `dark`; the lights-down setting several directions require), `data-scene` (`webgl`, `2d`). On `#app`: `data-mode` (`normal`, `flag`, `feed`, `watch`), `data-phase` (`idle`, `presnap`, `snap`, `verdict`, `other`), `data-poss`, `data-booth-open`, `data-scorecard-open`, `data-conn`, `data-boot`, `data-watch-state`, `data-source` (`espn`, `log`).

**Scene look.** Declarative, validated by `look-schema.js`, deep-frozen after `resolveLook`. Colors are `#rrggbb` strings; positions are field yards `[x, y, height]` (converted by `coords.toWorld`).

```ts
type Look = {
  id: string, version: 1,
  renderer:    { toneMapping: "none" | "aces" | "agx" | "neutral", exposure: number, shadows: "off" | "pcf" | "pcfsoft" | "vsm",
                 shadowMapSize: 1024 | 2048, antialias: "smaa" | "fxaa" | "msaa" | "none", clear: Hex, clearAlpha: number },
  environment: { background: Hex | null, fog: null | { kind: "exp2", color: Hex, density: number } | { kind: "linear", color: Hex, near: number, far: number },
                 ibl: null | "room", iblIntensity: number },
  lights:      { id: string, kind: "ambient" | "hemisphere" | "directional" | "spot", color: Hex, intensity: number,
                 groundColor?: Hex, position?: [number, number, number], target?: [number, number, number],
                 castShadow?: boolean, angle?: number, penumbra?: number }[],          // the lighting rig
  field:       { turf: [Hex, Hex], stripeYd: 5 | 10, paint: Hex, paintOpacity: number, surround: Hex,
                 endZones: "team" | "neutral", endZoneText: "name" | "abbr" | "none", numerals: boolean, hashes: boolean,
                 plinth: null | { height: number, color: Hex }, roughness: number, metalness: number, grain: number },   // turf and paint
  lines:       { los: LineSpec, ltg: LineSpec },              // { color: Hex, widthYd: number, opacity: number, mode: "paint" | "float" }
  ball:        { kind: "football" | "dot" | "puck", color: Hex, accent: Hex, scale: number,
                 trail: { kind: "none" | "ribbon" | "comet" | "spark", color: Hex | "team", widthPx: number, fadeMs: number } },
  strokes:     Record<"arc" | "ground" | "corridor" | "area" | "band" | "mark", {
                 geometry: "line2" | "tube" | "ribbon" | "decal", widthPx?: number, widthYd?: number,
                 core: Hex, edge: "team" | "team-alt" | Hex, opacity: number, dash: null | [number, number],
                 ghostedOpacity: number, approx: "hatch" | "soft" | "dashed" | "pixel" }>,        // line and arc materials
  ghost:       { fill: "team" | "neutral" | Hex, stroke: Hex, opacity: [number, number, number],
                 style: "zone" | "outline" | "hatch" | "pixel" | "marker", afterSnapOpacity: number, labels: boolean },   // ghost style
  lastPlay:    { keep: "until-next-snap" | "until-presnap", dimOpacity: number },
  residue:     { keep: "none" | "drive" | "game", opacity: number },
  labels:      { renderer: "css2d" | "sprite" | "decal" | "none", className: string, result: boolean },               // label renderer style
  post:        { bloom: null | { strength: number, radius: number, threshold: number }, extra: string[] },             // bloom on or off
  cameras:     { modes: { id: string, label: string, rig: "sideline" | "endzone" | "overhead" | "skycam" | "table" | "blimp",
                          fov: number, height: number, back: number, yaw?: number, follow: "ball" | "drive" | "none", cut: boolean }[],
                 default: string, moveMs: number, ease: "linear" | "outCubic" | "inOutCubic",
                 orbit: null | { minPolar: number, maxPolar: number, minAzimuth: number, maxAzimuth: number, zoom: boolean },
                 inset: null | { mode: string, rect: [number, number, number, number] } },
  motion:      Motion & { ghostInMs: number, ghostOutMs: number, verdictMs: number },
  teamColor:   { minContrast: number, against: Hex[] }     // DC C2: a team color under minContrast against these gets the core + edge rule
}
```

```ts
// theme/look-schema.js (pure)
function validateLook(look): { ok: boolean, errors: string[] }     // path-qualified, e.g. "lights[2].intensity must be >= 0"
function resolveLook(partial, base = NEUTRAL_LOOK): Look            // deep merge, validate, deep freeze; throws LookError
// theme/team-colors.js (pure)
function luminance(hex: Hex): number
function contrast(a: Hex, b: Hex): number                           // WCAG ratio
function teamPaint(team: { color, alt_color }, against: Hex[], minContrast = 3):
  { fill: Hex, edge: Hex, core: Hex, ink: Hex, usedAlt: boolean, needsCore: boolean }   // null colors (DC C2 manual mode) → neutral
// theme/tokens.js (pure)
const REQUIRED_TOKENS: string[], RUNTIME_TOKENS: string[]
function missingTokens(read: (name: string) => string): string[]
// theme/neutral-look.js (pure): NEUTRAL_LOOK, a gray, unlit-looking placeholder; camera modes sideline, endzone, overhead
// theme/apply.js (DOM)
function applyWorld(world: WorldModule, doc): void                  // data-world, CSS links, fonts
function applyTeams(teams: Teams, doc, look: Look): void           // runtime --sc-team-* tokens via teamPaint
function watchMotion(matchMedia, onChange: (motion) => void): () => void
```

### 2.8 Core, DOM side (`sync`, `actions`, `keyboard`, `conductor`)

```ts
// core/sync.js (A1)
function createSync({ api, store, now, timers: { setTimeout, clearTimeout }, doc, onError? }): {   // onError: v1.1
  start(): Promise<void>,                                  // boot fetches (3.1), then the loop (3.2)
  kick(opts?: { origin: "poll" | "action" }): void,        // run a tick now; origin tags the timeline rows it brings
  stop(): void
}

// v1.1, for sync, api, actions and the conductor: `now` is epoch ms (Date.now; DC E4 compares it with watch.next_at,
// which the server stamps in epoch ms), and injected timers, fetch and now are called bare, never as a method of the
// object that carries them (Chromium throws "Illegal invocation" for {setTimeout}.setTimeout()). Only a request that
// fails is a connection failure: a bug while applying an answer goes to onError and the poll loop always continues.

// core/actions.js (A2): the only caller of api.post; components and the keyboard call these
function createActions({ store, api, sync, form, dialogs, now, timers? }): Actions
type Actions = {
  tap(key), outcome(out), pickLeaf(leaf), clearPick(), toggleTD(), toggleTO(), logPlay(),
  openFlag(), closeFlag(), toggleFlag(), applyFlag(code),
  commitStrip(fieldId, raw, edited), flipSide(yardText), endDrive(kind: "punt" | "fg" | "fg_miss" | "half"), runShorthand(text),
  undo(), undoRefused(), reset(), retag(key, opts?: { pauseFirst: boolean }), feedToggle(eventId), replay(eventId),
  watchStart(eventId), watchToggle(), watchStep(), watchSpeed(speed: 1 | 2 | 4 | 10), watchStop(),
  cycleCamera(), setCamera(id), toggleBooth(), toggleScorecard(), closeScorecard(),
  review(delta: -1 | 1, opts?: { repeat: boolean }), exitReview(), hoverLeaf(leaf | null), retryNow(), setAmbient(value)
}   // every method returns void or Promise<void>; failed requests become toasts, never throws. v1.1: only a POST that
    // got no answer says "Nothing was saved" (#121); a bug after a successful POST rejects with that bug instead

// core/keyboard.js (A2)
function attachKeyboard(doc, { store, actions, onError? }): () => void   // returns detach; classifies the target, calls resolveKey, runs the intent
function runIntent(actions, intent, onError?): boolean   // v1.1: a throw or an action's rejected promise goes to onError

// core/conductor.js (A1): section 3.5
```

---

## 3. Data flow

```
 keyboard ─► keymap.resolveKey ─► actions.* ─► POST (FIFO) ──► state/loaded (origin action) ─┐
                                                   └──► sync.kick()                         │
 sync loop: GET /api/version ─► planTick ─┬─► GET /api/timeline?since&epoch ─► timeline/loaded ─┤
                                          └─► GET /api/state ──────────────► state/loaded ──┤
                                                                                            ▼
                                                    store (pure reducer: server, timeline, anim, presented, view)
                                                      │                                 │
                                         conductor ◄──┘ (queue, situation, ghosts)      └──► scheduler ─► vm-* ─► components.update
                                            │  ▲
                              engine.playRow│  │anim/started, anim/done (token-checked)
                                            ▼  │
                                     Engine (WebGL or 2D)
```

### 3.1 Boot (`main.js`)

1. Read prefs: `?world=`, `?scene=2d` (force the fallback), `?capture=1` (tests only), `prefers-reduced-motion`, `localStorage` (`sc:world`, `sc:camera`, `sc:ambient`). Load the world from the registry, `applyWorld`, then `world.arrange?.(app, regions)`.
2. Create the store, mount every component on its mount point, start the scheduler. Nothing is focused, so shortcuts work at once (FI 4.6).
3. Field: if `prefs.scene === "2d"` or `!hasWebGL2(document)`, create the fallback; else `await import("./field/scene.js")` and `createEngine(document.getElementById("field"), look, opts)`. An `EngineInitError` falls back to 2D. The three.js bundle (about 750 KB unzipped) is only fetched when WebGL2 exists. `main.js` awaits the engine (a local import, never a network wait) so the first timeline is drawn by a real engine.
4. Start the conductor, then attach the keyboard listener.
5. `sync.start()`: dispatch `boot/attempt`, then GET `/api/state`, `/api/timeline?since=0` and `/api/version` in parallel. Any failure dispatches `boot/failed` and retries with `BACKOFF`; the boot screen says "Can't reach the app server. Retrying in N s." with a Retry now button, until it loads (#120, G11). A state without `keys` shows the restart screen (#119).

### 3.2 Poll loop (`core/sync.js`, DC E4)

```
loop:
  wait nextDelay({ watchState: version.watch.state, hidden: document.hidden, failures: conn.failures })   // kick() ends the wait early
  v = GET /api/version                                   fail → conn/failed, continue        ok → version/loaded, conn/ok
  plan = planTick({ epoch: timeline.epoch, n: timeline.n, version: server.version,
                    feedOn: server.feed.on, feedState: server.feed.state }, v)
  if req.inflightActions > 0: plan.state = false         // an action response is about to replace the state
  in parallel:  plan.timeline → GET /api/timeline?since=…&epoch=…      plan.state → GET /api/state
  apply in this order: timeline/loaded (needsFull → immediate since=0 refetch), then state/loaded (origin poll, reqSeq)
  dispatch tick { now }                                  // lag valve
```

- Ticks never overlap and there is at most one GET per resource in flight.
- `kick()` runs a tick now: after every action, on `visibilitychange` to visible, and from Retry now.
- A poll's state body is dropped when an action response was applied after that poll's request was sent (`reqSeq < req.lastActionApplied`).
- Feed status comes from `version.feed` every tick, so "Updated HH:MM:SS" moves with each server poll without refetching `/api/state`.

### 3.3 Actions (`core/actions.js`)

```
intent ─► pure pre-check (canLog, drive needed for X, confirm for Reset/Replay/Watch)
       ─► req/action-start {reqSeq} ─► POST (one at a time, FIFO) ─► 
          200 or 400 with state: state/loaded {origin: action} ─► toast (message, or error in red; strip saves toast only when a drive starts)
          409 without state:     red toast with error, kick()
          ApiError:              red toast "Can't reach the app server. Nothing was saved." (#121), conn/failed
       ─► req/action-end ─► sync.kick({ origin: "action" })   // the rows this tick brings animate at most OWN_ACTION_MAX_MS
```

In-flight rules (G6): a request captures `pickAtSend = view.pick` and `genAtSend = view.flag.gen`. On success the pick is cleared only if `view.pick === pickAtSend` (immutability makes identity the test), and the flag panel closes only if `view.flag.gen === genAtSend`. While a play or flag POST is in flight, Enter and flag letters are ignored. Reset with the feed on first posts `/api/feed {"on": false}` and its confirm says so (#105, G9 on the UI side).

### 3.4 Animation queue and presentation gating

One caller snap, live or watched:

| Step | Server | Store | Screen |
| --- | --- | --- | --- |
| 1 | the feed or watch thread applies play 105 | | HUD shows the call for this snap (presented state S, `timeline.n` 104) |
| 2 | | tick: row 105 merged and queued; `server = S'` (`timeline.n` 105); S' is not presentable yet | `#app[data-phase="snap"]` |
| 3 | | conductor: `nextJob` → `engine.playRow(row105, {durationMs})` → `anim/started` | the play draws on the field; the predicted zone fades under it |
| 4 | | `anim/done 105` → `drawnThrough 105` → `presented = S'` | verdict on the play-feed row, scorecard ticks, `engine.markVerdict`; `data-phase="verdict"` for `look.motion.verdictMs` |
| 5 | | conductor sees a new presented situation and prediction | `showSituation`, `showGhosts` for the next call; `data-phase="presnap"` |

- Durations: `nextJob` (2.2) applies DC E4 (`min(normal, 0.8 * (next_at - now))`, shared across queued rows), older rows instant when more than 3 are queued, instant under reduced motion or in a hidden tab, `OWN_ACTION_MAX_MS` for the operator's own rows.
- Safety valve: if `presented` lags `server` for `MAX_PRESENT_LAG_MS` (4 s), the reducer flushes the queue, the conductor calls `engine.finishNow()` and draws the rest instantly, and the HUD catches up. A stalled engine can never freeze the next call (product principle 1).
- Timeline-derived panels (play feed, drives, win probability, box score, scoreboard) read `presentedTimeline`, so nothing on screen is ahead of the ball, in any mode (DC E5 on screen, not only on the wire).

### 3.5 Conductor (`core/conductor.js`)

```ts
function createConductor({ store, getEngine: () => Engine, look: Look, now, setTimeout?, clearTimeout?, onError? }): { start(), stop(), swapEngine(next: Engine): void }
// v1.1: the default timers are (fn, ms) => globalThis.setTimeout(fn, ms) and its clearTimeout twin, called bare
```

On each store change it compares slices by identity and:

- `anim.rebuilding` → `engine.finishNow()`, `setGameFrame(field, teams, teamOrder)`, `drawRowsInstant(rows)`, dispatch `anim/rebuilt`.
- `nextJob(anim, {now, watch: version.watch, normalMs})` → `engine.playRow` → `anim/started`; on resolve → `anim/done` with the same token. `normalMs(seq) = normalDurationMs(buildDrawing(row), look.motion)`.
- presented situation or prediction changed and not reviewing → `showSituation(fieldVm.situation)`, `showGhosts(buildGhostSet(fieldVm.ghostInput, situation))`.
- `view.review` → `showReview(row, buildGhostSet(ghostInputFromPred(row.pred), situationFromRow(row)))`, or `showReview(null, null)` back at the live edge; `view.hoverLeaf` → `highlightGhost`; `view.camera` → `setCamera`.
- drawn rows whose `pred` changed (`patchPreds`) → `refreshLabels(changed)`.
- writes `#app[data-phase]` and `#app[data-poss]`; the field host mirrors `engine.debugState()` into its data attributes on each engine event.
- engine `"error"` or `"contextlost"` → `swapEngine(createFallbackEngine(...))` and rebuild from the store (6.2).

### 3.6 Pred patching (DC B7)

Every `state/loaded` and `timeline/loaded` runs `patchPreds(timeline.rows, server.log)`. A retag therefore changes the call label in the play feed, the log, the last-play panel and any drawn label, while the drawn path stays (ESPN text is the drawing truth, the retag is the model's truth).

### 3.7 Epoch change

`v.epoch !== timeline.epoch` → GET `since=0` → `timeline/loaded` with reset → `anim.rebuild(n)` (no animation, DC B1), review exits → the conductor rebuilds the scene → the state (refetched because the version changed) presents once the rebuild ends. This one path covers reset, replay, watch start and stop, feed forget, an ESPN/manual source switch, undo in manual mode and a server restart.

### 3.8 Watch this game

- **Start** (feed bar or transport): confirm "Watch ESPN game {id} from the start? Your game is backed up first and comes back when you stop." If `watch.state === "done"`, first POST `/api/watch/stop {"restore": true}`: a second start would back up the watched game over the restore point (DC E2.5). Then POST `/api/watch/start {event_id: id box or feed.event_id, speed: current speed (default 4), from_seq: 0}`; the epoch changes and the scene rebuilds.
- **Never seek by stopping and restarting** for the same reason; scrubbing (W5) moves the client review cursor over applied rows only.
- **Playing**: polls every 250 ms and animation lengths fit `next_at`. Space pauses, 1 to 4 set 1x, 2x, 4x, 10x (POST `/api/watch/speed`).
- **Paused**: Space resumes, Right steps one play (POST `/api/watch/step`), Left reviews earlier plays.
- **Retag** while watching pauses first (DC E2.8), then retags.
- **Stop**: confirm "Stop watching and put your game back?" → POST `/api/watch/stop {"restore": true}`. `done` offers "Back to my game" (the same stop) and "Watch again".
- **Errors**: a 409 (already playing, step while playing, feed on while watching) is a red toast with the server's text and an immediate tick.

### 3.9 Hidden tab, errors, offline

- Hidden tab: polling slows to 5 s, `engine.setVisible(false)`, rows arriving meanwhile are drawn instantly. On return: `kick()`, `setVisible(true)`, the E4 rule (more than 3 queued → older instant) settles any backlog.
- Connection (G11): one failure → `retrying` (quiet banner text "Reconnecting…"), three or more → `offline` (banner "Can't reach the app server. Retrying in N s." with Retry now); the next success clears it. The last good state stays on screen meanwhile, marked by `#app[data-conn]`.
- A 400 applies the returned state and shows `error` in a red toast for 2.6 s (#117); a rejected strip value keeps its text with the invalid style (FI 4.4).
- Scene failures never touch the HUD: the conductor swaps in the 2D fallback.

---

## 4. Keyboard state machine

One `keydown` listener on `document` (`core/keyboard.js`) classifies the event and calls the pure `resolveKey`; `actions` performs the intent. Inputs keep their own local handlers (4.5).

```ts
// core/keymap.js (pure)
type Target = "text" | "yards" | "activatable" | "other"
type KeyInput = {
  key: string,                     // normalizeKey(e.key): one character → uppercase ("p" → "P", " " → "Space"); otherwise e.key
  repeat: boolean,
  mods: { meta: boolean, ctrl: boolean, alt: boolean, shift: boolean },
  composing: boolean,              // e.isComposing
  target: Target,
  ctx: { feedOn: boolean, watchState: "idle" | "playing" | "paused" | "done" | "stopped" | "error",
         flagOpen: boolean, scorecardOpen: boolean, reviewing: boolean }
}
type Intent =
  | { type: "tap", key } | { type: "outcome", out } | { type: "toggleTD" } | { type: "toggleTO" }
  | { type: "openFlag" } | { type: "closeFlag" } | { type: "applyFlag", code }
  | { type: "undo" } | { type: "undoRefused" } | { type: "clearPick" } | { type: "logPlay" }
  | { type: "retag", key, pauseFirst: boolean }
  | { type: "cycleCamera" } | { type: "toggleBooth" } | { type: "toggleScorecard" } | { type: "closeScorecard" }
  | { type: "watchToggle" } | { type: "watchSpeed", speed: 1 | 2 | 4 | 10 } | { type: "review", delta: -1 | 1, repeat: boolean } | { type: "exitReview" }
function normalizeKey(key: string): string
function modeOf(ctx): "flag" | "watch" | "feed" | "normal"
function resolveKey(input: KeyInput): { intent: Intent | null, prevent: boolean }   // prevent → e.preventDefault()
```

Target classes (`keyboard.js`, DOM side):

| Class | Elements |
| --- | --- |
| `yards` | `#yards` |
| `text` | `input` of type text, search, number, tel, url, email, password, date, time, range, color or no type; `textarea`; `select`; `[contenteditable]`; `[role=textbox \| slider \| combobox \| spinbutton]` |
| `activatable` | `button`, `a[href]`, `summary`, `input` of type checkbox, radio, button, submit, reset, file; `[role=button \| checkbox \| switch \| menuitem \| tab \| option]` |
| `other` | everything else (body, the field, panels) |

### 4.1 Guard (always first)

1. Meta, Ctrl or Alt held → nothing, no `preventDefault` (browser shortcuts keep working, #50). Shift is allowed (Shift+P acts as P).
2. `composing` → nothing.
3. Target `text` → nothing: shortcuts never fire inside inline inputs (#49, PRODUCT.md). Checkboxes and radios are `activatable`, not `text` (G4).
4. A repeat (`e.repeat`) of a key whose intent sends a request (log, undo, retag, flag letter, Space, digits) → `prevent` only. Repeats of picks, outcomes and T/F still act, as today ("holding P keeps cycling", FI 1.1).

### 4.2 Modes

`modeOf(ctx)` in this order: `flag` when `flagOpen && !feedOn && watchState in {idle, stopped}`; `watch` when `watchState in {playing, paused, done, error}`; `feed` when `feedOn`; else `normal`. `#app[data-mode]` mirrors it. With the feed on, the panel is hidden but `flag.open` is kept, as today (FI 4.3); the end of a drive closes it (G7).

### 4.3 Key tables

**Flag mode** (modal; checked before the global keys, because B and G are flags here):

| Key | Result |
| --- | --- |
| Escape, X | `closeFlag` (keeps the pick, #66) |
| O H C D R U M Z F G E L P B I N W | `applyFlag(FLAG_KEYS[key])` (#68 to #75; U is unnecessary roughness, not undo, #74) |
| 0 to 9, `-` | nothing, no prevent: typed into Yards |
| Space or Enter on an `activatable` target | nothing, no prevent: activates the focused flag button (G5 extended to the panel) |
| Enter elsewhere | prevent only; never logs a play (#67) |
| any other single character (J, T, V, Space, …) | prevent only (#67) |
| non-character keys (Tab, arrows, Backspace) | nothing (native) |

**Global keys** (every mode except flag):

| Key | Condition | Intent |
| --- | --- | --- |
| V | | `cycleCamera` (order of `look.cameras.modes`; the fallback has one mode) |
| B | | `toggleBooth` |
| G | | `toggleScorecard` |
| Space | watch session (`playing` or `paused`) and target not `activatable` | `watchToggle` (pause or resume) |
| Space | otherwise | nothing, no prevent (a focused button or checkbox activates natively) |
| ArrowLeft, ArrowRight | target is not `yards` | `review(-1 \| +1)` (2.2 `stepReview`; at the live edge Right steps a paused watch, and pauses then steps a playing one). A held arrow keeps stepping through reviewed rows but never steps the server. |
| 1, 2, 3, 4 | watch session and target is not `yards` | `watchSpeed(1 \| 2 \| 4 \| 10)` |
| Escape | scorecard open | `closeScorecard` |
| Escape | reviewing | `exitReview` |

Anything not consumed falls through to the mode table.

**Watch mode** (`playing`, `paused`, `done`, `error`): the manual pad and flag panel are hidden.

| Key | Intent |
| --- | --- |
| A N O P J K L R | `retag(key, pauseFirst: watchState === "playing")` (DC E2.8: pause, then retag) |
| U | `undoRefused`: red toast "Undo is off while a game plays back. Stop watching first." (an undo would desync the watch thread) |
| anything else | nothing |

**Feed mode** (`feed.on`), FI 1.7 unchanged:

| Key | Intent |
| --- | --- |
| A N O P J K L R | `retag(key)`; R is sent as typed (the server treats it as K) |
| U | `undo` |
| X, Escape, Enter, T, F, I, S, C, digits | nothing, no request (#99) |

**Normal mode** (feed off, no watch, panel closed), FI 1.3 unchanged except G5:

| Key | Intent |
| --- | --- |
| J K L R P A N O | `tap(key)`; focus and select Yards |
| I, S, C | `outcome("incomplete" \| "sack" \| "scramble")`; I also writes Yards `0` |
| T, F | `toggleTD`, `toggleTO` |
| X | `openFlag` (no drive: red toast "No {location} drive in progress. Type the ball spot first.", #63) |
| U | `undo` |
| Escape | `clearPick` (outcome off, Yards `0`, both boxes unticked; focus stays, #47) |
| Enter | target `activatable` → nothing, the control activates natively (G5); otherwise `logPlay` (silent no-op without a drive or a pick, #58) |
| other single character while target is `yards` | prevent only (Yards takes digits and `-`, #48) |
| anything else | nothing |

### 4.4 Conflicts, resolved

| Conflict | Rule |
| --- | --- |
| Digits: Yards box vs watch speeds | Speeds need a watch session **and** focus outside Yards. During manual entry Yards owns digits; during a watch the pad is hidden. |
| Space: watch toggle vs buttons | A focused `activatable` control always gets its native Space. The watch toggles only from other targets. |
| Enter: log play vs buttons | Same rule (G5). `#logBtn` logs through its own click. |
| B and G: booth and scorecard vs flags | Flag mode is checked first, so B is illegal block in the back and G is delay of game while the panel is open. |
| V in flag mode | Swallowed; the panel is modal and short. |
| Arrows: review vs Yards caret | Arrows move the caret when Yards is focused. |
| Escape layering | flag panel → scorecard → review → clear pick (normal mode). In feed and watch modes Escape only closes overlays and never sends a request (#99). |
| R | K everywhere; sent as R in feed retag (FI 1.7). |
| Booth visibility | Keys work with the booth closed. `X` opens the booth automatically when the world puts flags there (`booth.auto`) and closing the panel closes it again. The entry line (`#chosen`, `#yards`, `#fTD`, `#fTO`, `#logBtn`) must stay visible whenever manual entry is possible; a world may not hide it in the booth. |

### 4.5 Keys inside specific inputs (component-owned, FI 1.8)

| Where | Key | Behavior |
| --- | --- | --- |
| Strip fields | focus | select the whole value |
| | any `input` event | marks the field `edited` |
| | Enter | blur; commit if `edited` (G2); then focus Yards if a drive was active before the save (#21) |
| | Tab, blur | commit if `edited` (#20) |
| | Escape | restore the last rendered server value, clear the invalid style and `edited`, blur, no request (G1, #22, #23) |
| Yards | focus | select the value |
| `#cmd` | Enter | run the shorthand; never logs the pick (#84) |
| `#feedEvent` | Enter | blur only (#104) |

### 4.6 The listed gaps, realized

| Gap | Fix | Where | Pinned by |
| --- | --- | --- | --- |
| G1 Esc blanks an untouched or rejected field | Esc writes the last rendered server value back (not `""`), clears the invalid style, blurs without a commit | `situation-strip.js` + `strip.commit` | #23 |
| G2 re-typing the shown value does nothing | commit on Enter, Tab or blur whenever an `input` event fired since focus, not on `change` | `situation-strip.js`, `strip.commit` | #10 |
| G3 "D 25" rejected | a leading side in Ball on is sent as typed (`"D 25"`); a bare number keeps the chip side | `strip.commit` | new e2e: "D 25" off the field starts the drive at DAL 25 |
| G4 checkbox focus kills shortcuts | checkboxes are `activatable`, not `text` | `keyboard.js` target classes | #61 |
| G5 Enter on a button logs a play | Enter on an `activatable` target is left to the browser | `keymap.resolveKey` | new e2e: click Undo, press Enter: no `/api/play` |
| G6 a response wipes a newer pick | clear only if `view.pick === pickAtSend`; close only if `view.flag.gen === genAtSend`; block Enter and flag letters while that request is in flight | `actions.js`, `reduce-view.js` | #62 |
| G7 panel stays open after the drive | `state/loaded` with presented `drive_active === false` closes the panel (and an auto-opened booth) | `reduce-view.js` | #77 |
| G18 prediction rows not focusable | leaves are `<button class="leaf" data-leaf aria-pressed>`; Enter and Space activate natively; focus and hover call `highlightGhost`; keyed reconcile keeps focus | `prediction.js` | #122 |
| G24 manual hint with the feed on | off-field copy by mode: feed "When {OFF} gets the ball, the ESPN feed starts the drive and the next call appears here."; watch "When {OFF} gets the ball in this game, the next call appears here."; manual keeps FI 3.5 | `vm-prediction.js`, `copy.js` | new e2e |
| G25 stale flag note | the note is derived from the current pick on every render | `flags.flagNote`, `vm-flags.js` | new e2e: open with A, A; press P with the mouse; note updates |

The other gaps, decided on purpose:

| Gap | Decision |
| --- | --- |
| G8 | Backend: `version` must change on undo (monotonic). The UI compares with `!==`. #91 depends on it. |
| G9 | UI: Reset with the feed on turns the feed off first and the confirm says so (#105). |
| G10, G20, G22, G26 | Backend behavior; the UI shows server text as given. #85 is a backend fix. |
| G11 | Section 3.9: boot retry, connection banner, red toast on failed actions (#120, #121). |
| G12 | A poll-origin state whose `message` differs from the last presented one, with no action in flight, goes to the polite `bg-message` region in the feed bar, never a toast. v1.1: it waits in `view.bgPending` until that state is presented (decision 2), because the message often narrates the play the state knows about ("Turnover. Waiting for the next Dallas drive."). |
| G13 | Client copy names the team from `teams[caller].location`, else `game.offense` ("No Dallas drive in progress…" keeps #63); score `aria-label` "{location} score". |
| G14, G15, G16, G23 | `vm-tendencies.js` order, empty "#" on nullified rows, "Goal" in the log, one-decimal why points. |
| G17 | `layout.css` and every world layout: no horizontal scroll at 390 px (#8). |
| G19 | The last-play panel shows the row a retag will edit (newest non-nullified, any source). |
| G21 | The Replay confirm names `feed.event_id` when the box is empty; "(today's)" only when neither exists. |
| G27 | Text only (section 1), enforced by `static-rules.test.mjs`; #123. |
| G28 | Fonts are self-hosted per world under `static/fonts/<id>/`; the neutral world uses system fonts. |
| G29 | Nothing from the old stylesheet is carried over. |

---

## 5. Selector contract

Tests select by these hooks; worlds style by classes (`sc-*`), the legacy classes below, and data attributes, **never** by `data-testid`. Removing or renaming any hook is a contract change (doc first).

### 5.1 Kept from FI 6.2

Every id and selector keeps its meaning:

`#gameLabel #whoLabel #undoBtn a[href="/api/export.csv"] #resetBtn #feedBtn #feedBtnTxt #feedEvent #replayBtn #feedStatus #field #iQtr #iClock #clockEst #iOff #iOpp #iDown #iTogo #iSide #sideTxt #iYard #driveInfo #endRow [data-end] #heroArea .pill .lgmark .fam .leaf[data-leaf] .why #entry #lastPlay [data-retag] #manualEntry .key[data-k] .key[data-out] #flagBtn #flagPanel #flagNote #flagClose [data-pen] #otherFirst #chosen #yards #fTD #fTO #logBtn #cmd #cmdBtn #entryHint #logArea #kpiArea #profTitle #profArea #toast`

Three structural changes, on purpose: `#field` is the field host `<div role="img">` (no longer an SVG); `.leaf[data-leaf]` is a `<button>` (G18); `#flagPanel` sits in its own `flags` region instead of inside `#manualEntry` (so a world can move it to a booth). With the feed on or during a watch, both `#manualEntry` and `#flagPanel` are `hidden` (#93).

State hooks the checklist reads stay as legacy classes, each mirrored by a semantic attribute:

| State | Legacy hook (kept) | Mirror |
| --- | --- | --- |
| picked play key (R lights K) | `.key[data-k].on` | `aria-pressed="true"` |
| picked outcome | `.key[data-out].on` | `aria-pressed="true"` |
| retag button matching the row's family | `[data-retag].cur` | `aria-current="true"` |
| rejected strip value | `.bad` on the input | `aria-invalid="true"` |
| side chip on the opponent's side | `#iSide.opp` | `data-side="opp"` |
| feed button on / retrying | `#feedBtn.on`, `#feedBtn.err` | `data-feed-state="off \| live \| retrying"` |
| flag panel open | `#flagBtn.on` | `aria-expanded="true"` |
| toast visible / error | `#toast.show`, `#toast.err` | `data-tone="info \| error"` |
| tilt pill kind | `.pill.tiltpass .tiltrun .leanpass .leanrun .noedge` | `data-flag` |
| versus-league arrows | `.up[title="Well above the league"]`, `.down[title="Well below the league"]` | `data-hot="up \| down"` |
| log loss better / worse | `.better`, `.worse` | `data-tone` |
| rank 1 / 4+ | `.ok`, `.no` | `data-tone="good \| bad"` |
| entry de-emphasized (no drive, feed off) | was inline opacity | `#entry[data-dim="true"]` (#5) |
| hidden parts | `[hidden]` on `#clockEst #endRow #manualEntry #flagPanel #lastPlay` | same |
| Log play disabled | `#logBtn[disabled]` | same |

### 5.2 Shell mount points (`index.html`)

```html
<title>Shadow Play-Caller</title>
<script type="importmap">{"imports": {"three": "/static/vendor/three/build/three.module.min.js",
                                      "three/addons/": "/static/vendor/three/addons/"}}</script>
<script type="module" src="/static/js/main.js"></script>

<div id="app" class="sc-app" data-mode="normal" data-phase="idle" data-boot="loading" data-conn="online">
  <header  id="rg-masthead"   data-region="masthead"></header>
  <section id="rg-feed"       data-region="feed"></section>
  <section id="rg-scoreboard" data-region="scoreboard"></section>
  <section id="rg-situation"  data-region="situation"></section>
  <section id="rg-field"      data-region="field"></section>
  <section id="rg-transport"  data-region="transport"></section>
  <section id="rg-call"       data-region="call"><div id="heroArea"></div></section>
  <section id="entry"         data-region="entry">
    <div id="lastPlay" hidden></div><div id="manualEntry"></div><div class="short" data-mount="shorthand"></div><p id="entryHint"></p>
  </section>
  <section id="rg-flags"      data-region="flags"><div id="flagPanel" hidden></div></section>
  <section id="rg-plays"      data-region="plays"></section>
  <section id="rg-drives"     data-region="drives"></section>
  <section id="rg-wp"         data-region="wp"></section>
  <section id="rg-score"      data-region="score"><div id="kpiArea"></div></section>
  <section id="rg-box"        data-region="box"></section>
  <section id="rg-tendencies" data-region="tendencies"></section>
  <section id="rg-log"        data-region="log"><div id="logArea"></div></section>
</div>
<div id="rg-conn" data-region="conn"></div>
<div id="rg-boot" data-region="boot"></div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
```

`RegionName` = `masthead | feed | scoreboard | situation | field | transport | call | entry | flags | plays | drives | wp | score | box | tendencies | log`. The booth is a state (`#app[data-booth-open]`), not a container: each world decides which regions the booth shows (keypad, flags, tendencies in DIR), through CSS or `arrange`.

### 5.3 Field hooks (`#field`)

| Attribute | Value | Use |
| --- | --- | --- |
| `role="img"`, `aria-label` | "Ball on DAL 25. 1st & 10. Line to gain DAL 35." / "DAL off the field." | FI 6.2 |
| `data-drive-active` | `true` / `false` (the caller's drive) | #27 |
| `data-los`, `data-ltg` | `yardline_100` of the team in possession; goal to go → `0`; absent with no situation | #27, #28 |
| `data-poss` | team abbreviation or empty | |
| `data-ball-x`, `data-ltg-x` | field x (DC A) | 3D frame checks |
| `data-scene` | `webgl` / `2d` | fallback tests |
| `data-scene-ready` | `true` once the first frame after `setGameFrame` is on screen | screenshot gate |
| `data-anim-state` | `idle` / `playing` / `rebuilding` / `reviewing` | deterministic waits |
| `data-drawn-seq`, `data-queue`, `data-playing-seq` | `anim.drawnThrough`, queue length, playing seq | deterministic waits |
| `data-ghosts` | ghost leaves in rank order, space separated, empty when none | ghost tests |
| `data-ghost-highlight` | leaf or empty | G18 hover and focus |
| `data-camera` | camera mode id | V |
| `data-review-seq` | reviewed seq; absent at the live edge | Left/Right |
| `data-epoch` | timeline epoch | rebuild tests |
| `data-frames` | frames rendered so far | render-on-demand test |
| `data-scene-error` | message, set when the fallback replaced WebGL | |

Children: `canvas[data-testid="field-canvas"]` (WebGL) or `svg[data-testid="field-svg"]` (fallback), and `[data-testid="field-legend"]` "Ball shown mid-field; ESPN gives no hash." (DIR grammar).

### 5.4 Hooks for the new features

| Feature | Selector | Attributes and text |
| --- | --- | --- |
| App root | `#app` | `data-mode data-phase data-poss data-booth-open data-scorecard-open data-conn data-boot data-watch-state data-source` |
| Play feed | `[data-testid="play-feed"]` (an `ol`, `aria-label="Plays"`) | |
| Play row | `[data-testid="play-row"]` | `data-seq data-id data-kind data-team data-caller data-verdict="top1 \| top3 \| miss \| none" data-nullified data-retagged data-scoring` |
| Hand-entered plays off the field | `[data-testid="unlinked-note"]` | "1 hand-entered play isn't on the field" (DC C1) |
| Drive chart | `[data-testid="drive-chart"]`, `[data-testid="drive"]` | `data-idx data-team data-caller data-result data-complete` |
| Win probability | `[data-testid="wp-chart"]` | `data-available data-wp-caller="0.6324"`, `aria-label` "DAL win probability 63%" |
| Scoreboard | `[data-testid="scoreboard"]`, `[data-testid="team-score"][data-team]`, `[data-testid="game-clock"]`, `img[data-testid="team-logo"][alt]` | `data-state data-poss` |
| Box score | `[data-testid="box-score"]` (a `table`), `th[data-team]` | DC C4 rows |
| Scorecard toggle (G) | `[data-testid="scorecard-toggle"]` | `aria-expanded` |
| Booth toggle (B) | `[data-testid="booth-toggle"]` | `aria-expanded` |
| Camera mode (V) | `[data-testid="camera-mode"]` | label text, `data-camera` |
| Watch start | `[data-watch="start"]` | feed bar and transport |
| Watch transport | `[data-testid="watch"]` | `data-watch-state` |
| Transport buttons | `[data-watch="play \| pause \| step \| stop \| back \| again"]` | `disabled` when not allowed |
| Speeds (1 to 4) | `[data-speed="1 \| 2 \| 4 \| 10"]` | `aria-pressed` |
| Progress | `[data-testid="watch-progress"]` | "104 / 183" |
| Watch error | `[data-testid="watch-error"]` | `watch.error` text |
| Review banner | `[data-testid="review"]` | `data-seq` |
| Connection | `[data-testid="conn"]`, `[data-testid="conn-retry"]` | `data-conn` |
| Boot and restart screens | `[data-testid="boot"]` | `data-phase` |
| Background message (G12) | `[data-testid="bg-message"]` | `role="status"`, `aria-live="polite"` |

---

## 6. Performance budget and the WebGL fallback

### 6.1 Budget

| Item | Budget | Mechanism and check |
| --- | --- | --- |
| Idle rendering | 0 frames while nothing changes | Render on demand: the loop runs only while a play, a camera move, a ghost fade, a moment or an orbit drag is active, or after `requestRender()`. Test: `#field[data-frames]` is unchanged over 2 s idle. |
| Frame time while animating | 16.7 ms (60 fps) on Sam's laptop at 1440x900, and when it drives the TV at 1920x1080 | DIR target. Measured with `?debug=1` (exposes `window.__shadowDebug = () => engine.debugState()`). |
| Device pixel ratio | `min(devicePixelRatio, 2)`; if the mean frame time over 30 frames exceeds 22 ms, step down by 0.25 to a floor of 1 and stay there for the session | `renderer.js` |
| Draw calls | at most 150 per frame and per view (an inset camera renders the scene twice) in the default camera with field, three ghosts, one play and residue; field paint merged into at most 12; world props at most 40 (merged with `BufferGeometryUtils`); residue at most 1 per material | `debugState().drawCalls` (`renderer.info.render.calls`) |
| Triangles | at most 300k | `debugState().triangles` |
| Shadows | at most 2 shadow-casting lights, maps at most 2048 square | look validation rejects more |
| Post | bloom only when `look.post.bloom`, at half resolution; SMAA by default | `post.js` |
| Labels | at most 12 live CSS2D labels | ghost (3) + result + situation labels |
| Memory | after `setGameFrame`, 183 instant rows, then `setGameFrame` again, `renderer.info.memory` geometries and textures are within +2 of the first post-frame baseline | e2e leak test through `__shadowDebug` |
| Network | `/api/version` (161 B, DC F) every 1 s, 250 ms while watching; `/api/state` (about 49 KB) only on a version change; timeline about 1 to 1.5 KB per new row plus about 7 KB of drives, status and box | DC F |
| Startup | HUD filled within 500 ms of DOMContentLoaded on localhost; `data-scene-ready` within 2 s | e2e timing |
| DOM | whole game in the play feed (183 rows) with keyed reconcile; the play log is never paginated (FI 3.9) | |
| Hidden tab | no RAF; polling every 5 s; arriving rows drawn instantly; catch-up per DC E4 on return | `sync.js`, `anim-queue.js` |
| Context loss | `webglcontextlost`: `preventDefault`, switch to the fallback; `webglcontextrestored`: rebuild the WebGL engine from the store | `renderer.js`, conductor |
| Reduced motion | every draw instant, camera cuts, moments skipped, CSS transitions off | `prefers-reduced-motion` and `data-motion` |

### 6.2 WebGL-unavailable fallback

- **When**: no WebGL2 (three r185 requires it), `?scene=2d`, `createEngine` throwing, a lost context, or an engine error at runtime. `#field[data-scene="2d"]`, with `data-scene-error` when it replaced a failing WebGL engine.
- **What**: `fallback-2d.js` implements the whole `Engine` interface with one SVG (`svg[data-testid="field-svg"]`) drawn through `coords.toPlane`: top-down, caller's end zone on the left, true 120 by 53.3 proportions, the same view a coach draws on paper.
- **Same facts**: yard lines and numbers, hashes, end zones in team colors (`teamPaint`), the line of scrimmage and line to gain, the ball on the center line, the top three ghost zones with opacity by rank and percentage labels, every `Drawing` step (arcs as curves seen from above, catch areas, incompletion bands, run corridors, marks), ghosted no-plays, residue per look, the legend.
- **Motion**: `playRow` animates with stroke-dashoffset transitions when `durationMs > 0`, instant otherwise; review and verdict marks work; one camera mode, "Top".
- **Readable**: text through `textContent`, sizes from `--sc-size-*`, colors from the active look, so the fallback reads as the same world.
- **Tested**: every field e2e test runs twice, `scene=webgl` and `scene=2d` (`?scene=2d`), against the same `#field` hooks.

---

## 7. Test plan

### 7.1 Node unit tests (pure modules)

`tests/js/<module>.test.mjs`, `node:test` and `node:assert/strict`, loading JSON through `tests/js/fixtures.mjs` (`fs` + `JSON.parse`). Run `node --test 'tests/js/**/*.test.mjs'`; coverage `npm run test:js:cov` must hold 80% lines and functions on the pure modules. RED first: each package writes failing tests for its interface and runs them before writing the implementation (agents never commit; the orchestrator does).

Test data: `tests/fixtures/timeline_tb_dal.json` (the real 183-row capture). v1.1: it is required, and a missing fixture fails loudly instead of quietly testing less; `tests/fixtures/timeline_contract_rows.json`, built from DC B2 and B5 rows (seq 1, 2, 43, 87, 113, 161) and the DC G values, is used only when `SC_TIMELINE_FIXTURE=contract` asks for it. No test skips itself because a module or a fixture is absent. `/api/state` fixtures (`state_fresh`, `state_drive_d25`, `state_final`, `state_feed_on`) come from `scripts/capture_ui_fixtures.py` against a sandbox (`.venv/bin/python scripts/sandbox.py --port <5200-5299>`, offline), never the live game.

| Test file | What it pins (real values) |
| --- | --- |
| `coords.test.mjs` | DAL caller: `yardline_100` 70 → x 30; the first TB snap: x 73 ↔ TB `yardline_100` 73; `"TB 3"` → 97; `"50"` → 50; `toWorld(30, 26.667)` → (-20, 0, 0); `toPlane` corners |
| `paths.test.mjs` | first DAL snap (x0 30, `air_band` [1, 10], lat middle): band x 31 to 40, ball ends at 30; `4018729801915`: snap 13 → 6, arc 6 → 52 (approx, v1.1), YAC 52 → 61; kickoff seq 1: arc 65 → 3, return 3 → 30; seq 161: arc 35 → 100, touchback, ball 65; punt seq 43: arc 44 → 97, `oob`; FG seq 87: hold 77 → 69, arc 69 → 110, good; `401872980210`: ghosted, flag, march 92 → 96; sack `4018729802713`: 37 → 48; admin: no steps |
| `ghosts.test.mjs` | top 3 `run_inside, pa_short, dropback_short` at x 30: corridor x 30 to 35 at y 26.667, half-width 2; both short bands x 30 to 39 with `stack` 0 and 1; a deep band at x 95 clamped into the end zone; `null` without a situation |
| `timing.test.mjs` | plan from speeds; `fitPlan`; `sampleArc` h(0) = 0, h(1) = endH, apex at the middle |
| `camera-plan.test.mjs` | frames contain LOS and LTG; `nextMode` wraps |
| `anim-queue.test.mjs` | 5 queued → 2 instant, 3 animated; `next_at - now` 1000 ms with 1 queued → 800 ms cap, with 2 queued → 400; hidden or reduced motion → instant; stale token ignored |
| `present.test.mjs` | S' with `timeline.n` 105 waits for `drawnThrough` 105; the 4 s valve; an old server without `timeline` presents at once |
| `sync-plan.test.mjs` | epoch change → `since=0`; `timeline_n > n` → `since=n`; `last_poll` alone → no state fetch; backoff 1, 2, 4, 8, 15 s; hidden 5 s; playing 250 ms |
| `timeline-cache.test.mjs` | append 101 to 104; duplicates dropped; a gap → `needsFull`; epoch mismatch → reset; `patchPreds` after a retag to A sets `pred.family` to `pa` and leaves `geo` identical (DC G21); unchanged input returns the same array |
| `reducer.test.mjs` | every event in 2.1 on deep-frozen state; stale poll body dropped; G7; booth auto-open and auto-close |
| `keymap.test.mjs` | every row of 4.1 to 4.4, table-driven: G4 checkbox target, G5 Enter on a button, digits vs Yards, Space vs a button, B and G in flag mode, repeats |
| `selection.test.mjs` | FI 1.4 cycles (PPPP wraps), every FI 1.5 cell, FI 2.4 and 2.5 payloads |
| `strip.test.mjs` | G1, G2 (edited equal value commits), G3 (`"D 25"`, `"d25"`, `"25"` with the chip), the 50, To go G |
| `flags.test.mjs` | FI 1.6 summaries, the #65 notes, G25 |
| `review.test.mjs` | Left and Right over drawable rows; `server-step` and `pause-then-step` at the edge |
| `vm-*.test.mjs` | FI 3 strings from the state fixtures (#29 to #36, #110 to #115), G14, G15, G16, G23, G24 |
| `team-colors.test.mjs` | DC C2: DAL `#002a5c` on `#0b0f14` 1.36, DAL alt `#b0b7bc` on `#0b0f14` 9.47, TB `#bd1c36` on turf `#2e6b3a` 1.03 (each ±0.01); `teamPaint` falls back to alt, then to core |
| `look-schema.test.mjs` | `NEUTRAL_LOOK` validates; each bad field is rejected with its path; `resolveLook` deep-freezes |
| `api.test.mjs` | stub fetch: 400 resolves with its body; an HTML 500 → `ApiError`; timeout; an unknown POST path throws |
| `static-rules.test.mjs` | no `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` or `console.log` under `static/js`; pure modules (1.1) import nothing from the DOM, three.js or browser globals |

### 7.2 Playwright e2e (Python, `tests/e2e`, existing fixtures)

- Reuse `server`, `browser` (already launched with SwiftShader so WebGL works headless) and `page` (1440x900, collects page and console errors). Every test sets its own state with the FI 6.1 preconditions; nothing relies on test order.
- `tests/e2e/ui_helpers.py` (A11): `fresh`, `with_drive`, `finished`, `feed_on` (FI 6.1), `wait_idle(page, seq=None)` (waits for `#field[data-anim-state="idle"]` and optionally `[data-drawn-seq="N"]`), `show(page, selector)` (presses B when the target sits in a closed booth), `record_requests(page, path)`.
- Determinism: contexts default to `reduced_motion="reduce"`, so every draw is instant; motion tests opt out and wait on `data-anim-state`. No fixed sleeps except the FI cadence tests.
- The checklist, one file per FI group: `test_ui_load.py` (#1 to #8), `test_ui_strip.py` (#9 to #26), `test_ui_field.py` (#27, #28 and the 5.3 hooks, parametrized over `webgl` and `2d`), `test_ui_prediction.py` (#29 to #37, #122), `test_ui_entry_keys.py` (#38 to #62), `test_ui_flags.py` (#63 to #77), `test_ui_shorthand.py` (#78 to #85), `test_ui_drive_undo_reset.py` (#86 to #91), `test_ui_feed.py` (#92 to #105), `test_ui_replay.py` (#106 to #109), `test_ui_scores_log.py` (#110 to #115, #123), `test_ui_sync_errors.py` (#116 to #121). #3 and #95 follow Appendix A.
- New features:
  - `test_ui_timeline.py`: after a replay, 183 play rows, 64 with `data-caller="true"` (DC G1), 21 drives with DC G17's results in order, `data-wp-caller` 0 at the end, scoreboard 16 to 24, box score DAL 366 and TB 419 yards.
  - `test_ui_watch.py`: a second session fixture runs the sandbox with `SHADOW_WATCH_SCALE` small (DC E3). Start shows `data-watch-state="playing"`; Space pauses; Right adds exactly one to `data-drawn-seq`; 1 to 4 post speeds 1, 2, 4, 10; Stop restores the pre-watch log; no play row ever has `data-seq` above `#field[data-drawn-seq]` (spoiler check); Done then Watch again stops with restore before starting.
  - `test_ui_keys_new.py`: V cycles `data-camera`; B toggles `aria-expanded` and `#app[data-booth-open]`; G toggles the scorecard; digits typed in Yards stay digits during a watch-free session; Space on a focused button clicks it; Left reviews and Escape returns to live.
  - `test_ui_offline.py`: routing `/api/version` to fail gives `retrying` then `offline` and recovers to `online`; a failed first `/api/state` shows the boot screen and retries until it loads (#120); a failed POST gives a red toast (#121).
  - `test_ui_render.py`: `data-frames` stays flat over 2 s idle; with `?debug=1` the draw calls stay within budget; the leak check of 6.1.

### 7.3 Visual capture of the canvas

- Gate every capture on `#field[data-scene-ready="true"][data-anim-state="idle"]` and `document.fonts.ready`.
- Screens: fresh, drive at DAL 25 (ghosts on), finished game, watch paused at row 104, the 2D fallback; at 1440x900, 1920x1080 and 390x844. Files go to `test-results/visual/<world>/<state>-<w>x<h>.png` (already gitignored).
- Element screenshots of `#field` capture the WebGL canvas in Chromium as composited. Pixel reads in the page use `?capture=1`, which creates the renderer with `preserveDrawingBuffer: true` so `canvas.toDataURL()` and `drawImage(canvas)` return the last frame; production never sets it.
- Until a world is chosen there are no golden images: the automated checks are "not blank" (a 32 by 18 sample grid with at least 8 distinct colors) and "something is drawn at the ball" (the pixels around `data-ball-x` differ from an empty-field capture). After W6, each world gets golden images per state and size with a 1% pixel tolerance.

---

## 8. Work packages

### 8.1 Now: the world-agnostic build

| Package | Owns (section 1.1) | Codes against | Done when |
| --- | --- | --- | --- |
| A0 Shell and boot | `index.html`, `css/base.css`, `css/layout.css`, `js/main.js`, `ui/scheduler.js`, `tests/js/static-rules.test.mjs` | every interface (wiring only) | boots with every mount point; static rules green; #1, #2, #7, #8 |
| A1 Core state and sync | `core/{api, store, reducer, reduce-server, reduce-timeline, reduce-anim, reduce-conn, timeline-cache, sync-plan, sync, present, anim-queue, conductor, domain}.js`, `package.json`, `tests/js/fixtures.mjs`, `tests/fixtures/{state_*, version_watch_playing, timeline_contract_rows}.json`, `scripts/capture_ui_fixtures.py` | DC, `Engine` | node tests for 2.2; #3, #116, #117, #120, #121 |
| A2 Input and actions | `core/{keymap, keyboard, actions, selection, strip, flags, review, reduce-view}.js` | 2.1 events, `api` | the 4.3 tables as tests; #38 to #77 |
| A3 View models | `model/*.js` | 2.3 | VM tests against the fixtures |
| A4 Field geometry | `field/{coords, grammar, paths, ghosts, timing, camera-plan}.js` | DC A, B5, B6 | geometry tests in 7.1 |
| A5 Scene engine | `field/{scene, renderer, lighting, post, field-mesh, cameras, materials, player, ghost-layer, overlays, residue, labels, dispose, webgl-support}.js` | `Engine`, `Look`, A4 | field e2e on `webgl`; 6.1 budget |
| A6 2D fallback | `field/{fallback-2d, fallback-draw}.js` | `Engine`, `Look`, A4 | field e2e on `2d` |
| A7 UI input surfaces | `ui/{situation-strip, entry-pad, flag-panel, shorthand, last-play, prediction}.js` and their `css/components/*.css` | VMs, `actions`, `dom.js` | #9 to #37, #122 |
| A8 UI game surfaces | `ui/{scoreboard, play-feed, drive-chart, win-prob, box-score, scorecard, tendencies, play-log}.js` and their CSS | VMs | #110 to #115, `test_ui_timeline.py` |
| A9 UI chrome | `ui/{dom, masthead, feed-bar, watch-transport, field-host, review-banner, toast, conn-banner, boot-screen, dialogs}.js` and their CSS | VMs, `actions` | #92 to #109, watch and offline e2e |
| A10 Theme contract | `theme/{tokens, look-schema, neutral-look, team-colors, apply, registry}.js`, `theme/worlds/index.js`, `theme/worlds/neutral/index.js`, `css/worlds/neutral/tokens.css` | 2.7 | look and token tests; e2e `missingTokens` is empty |
| A11 E2E | `tests/e2e/ui_helpers.py`, `tests/e2e/test_ui_*.py`, additive fixtures in `tests/e2e/conftest.py` | sections 5 and 7 | the checklist green on the neutral world |

Order: A0 lands a stub shell and A10 lands the token names on day one; A1, A2, A3 and A4 are pure and start in parallel with RED tests; A9 ships `dom.js` first so A7 and A8 can build; A5 and A6 build against the `Engine` interface and A4's types with contract rows; A11 writes the checklist tests early and turns them green as packages land. A package that needs a new export, hook or event writes the change into this file (with a version note) before the owner implements it.

### 8.2 Later: the world-specific build

Each W package owns only its listed files, all under a world folder (plus W5's new component). None edits `core/`, `model/`, `field/`, the neutral world, or another world; a missing hook is a change request to its A owner.

| Package | Owns | Inputs | Acceptance |
| --- | --- | --- | --- |
| W1 Scene look | `theme/worlds/<id>/{look, props, moments}.js`, `theme/worlds/<id>/shaders/*.js` | `Look` (2.7), engine hooks, the chosen DIR direction | look validates; 6.1 budget at 1440x900 and 1920x1080; both teams pass `teamPaint` (TB red on turf is 1.03, DC C2); approximations stay visibly approximate; moments skip under reduced motion |
| W2 HUD components | `css/worlds/<id>/components/*.css` except W4's and W5's files; `static/img/worlds/<id>/*.svg` | VMs, legacy classes, data attributes | every component styled in both `data-ambient` settings; no JS edits; #1 to #123 still pass; the next call is the largest thing on screen (PRODUCT principle 1) |
| W3 Layout, typography, motion | `css/worlds/<id>/{tokens, layout, motion}.css`, `theme/worlds/<id>/{index, arrange}.js`, `static/fonts/<id>/*` | `REQUIRED_TOKENS`, `RegionName`, attribute hooks | `missingTokens` empty; no horizontal scroll at 390 px; the DIR viewports at 1440x900 and 1920x1080; logical tab order after `arrange` |
| W4 Booth controls UI | `css/worlds/<id>/booth.css`, `css/worlds/<id>/components/{entry-pad, flag-panel, last-play, shorthand}.css`, `theme/worlds/<id>/booth.js` (called by `arrange.js`) | booth state, entry and flag VMs, the 4.4 entry-line rule | B and X flows; the entry line stays visible during manual entry; the retag row is visible in feed and watch modes |
| W5 Watch transport UI | `css/worlds/<id>/components/watch-transport.css`, `ui/scrub.js`, `css/components/scrub.css`, `css/worlds/<id>/components/scrub.css` | `transportVm`, `actions.review`, `actions.watch*`, 3.8 | Space, 1 to 4, Left and Right shown on screen; scrubbing is client-side review only; watch e2e green |
| W6 Integration | `theme/worlds/index.js` (ownership passes from A10), `tests/e2e/test_ui_world_<id>.py`, the world's golden images | everything | `?world=<id>` works; the full suite green on neutral and the world; goldens recorded; budget checks pass |

---

## Appendix A. Changed on purpose (beyond the G fixes)

| Item | Before (FI) | Now | Why |
| --- | --- | --- | --- |
| #3 poll cadence | `/api/version` every 2 s | every 1 s; 250 ms while a watch plays; 5 s in a hidden tab | DC E4. #3's assertion (at least 2 in 4.5 s, no state refetch) still holds. |
| #95 state refetch with the feed on | `/api/state` about every 4 s because `last_poll` changed | only when `version`, `feed.on` or `feed.state` change; "Updated" comes from `/api/version` each tick | DC E4. #95 is rewritten to assert that the "Updated" time advances without a `/api/state` refetch. |
| When the HUD updates | as soon as the state arrives | after the field has drawn the play (at most 4 s later) | presentation gating, decision 2 |
| Key auto-repeat | every key repeats | keys that send requests ignore repeats | prevents accidental multiple undos and double logs |
| Space and Enter on a focused flag button | swallowed | activate the button | G5 extended to the flag panel |
| Escape | clears the pick | closes the scorecard or leaves review first | the new overlays |
| U while a game plays back | (no watch existed) | refused with a toast | keeps the watch thread and the engine log consistent |
| Last-play panel | newest ESPN row | the row a retag will edit | G19 |
| `#flagPanel` | inside `#manualEntry` | its own `flags` region | worlds with a booth |
| `#field` | 1200x120 SVG strip | 3D or 2D field host | the rebuild |
| Manual pad visibility | hidden with the feed on | also hidden during a watch | manual plays must not land in a watched game |

## Appendix B. Backend dependencies

Owned by the backend agents; listed so no frontend package works around them.

| # | Needed | Used by | If missing |
| --- | --- | --- | --- |
| 1 | `/api/state` gains `timeline {n, epoch, source, mode}` and `watch` (DC F.1) | presentation gating, transport | presents immediately (no gating) |
| 2 | `/api/version` gains `epoch`, `timeline_n`, `watch` (DC E4) | the poll loop | no timeline fetches; the HUD still works |
| 3 | `/api/timeline` (DC C1) and `/api/watch/*` (DC E1) | scene, play feed, drives, watch | the field shows the situation only; watch controls hidden |
| 4 | log rows carry `espn_id` (DC B7) | pred patching | labels refresh on the next epoch only |
| 5 | `version` changes on undo (G8) | #91 | #91 stays red |
| 6 | `SHADOW_WATCH_SCALE` (DC E3) | `test_ui_watch.py` | watch e2e runs at real pace (minutes) |
| 7 | `fg` refused with no drive (G22) | #85 | #85 stays red |
| 8 | v1.1: `status`, `drives` and `box` as of each row (or an `until` on `/api/timeline`), so a poll that brings several rows can snapshot every seq (2.2 snapshots) | scoreboard, drives, box while a batch of rows animates | those panels wait for the batch's last row (never ahead of the field; at most one batch, and the 4 s valve) |
