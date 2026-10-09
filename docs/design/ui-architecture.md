# UI architecture for the 3D GameCast rebuild

> **v1.3 OVERRIDE (2026-10-09), Sam's direction: read `docs/design/play-drawing.md` first.** It is binding and overrides this file wherever they disagree (2.4 drawing grammar, 2.5 engine visuals, the ghost zones, the W1 projection shapes) and any task prompt that says otherwise: every play starts on the line of scrimmage (no QB drop, no handoff mesh, no PA fake step); a pass is an arc, an incompletion an arc ending in an X, a run a straight flat 2D line with its yards; every play is labeled on the field ("Deep pass left · +21", "Inside run (up the middle) · +4"); before each Dallas snap the top 2 most likely plays are drawn as dashed, translucent shadow plays in that same shape language with "1 · Deep shot (20+) · 31%" text underneath.

Status: architecture v1, nothing built yet. This file is the contract between the frontend agents. It sits on top of three binding specs and never overrides them:

- `docs/design/data-contract.md` (cited as **DC**): API, row shape, field frame (A1 to A5), geometry (B5), derivations (B6), pred link (B7), manual mode (D), watch (E), polling (E4), payloads (F).
- `docs/design/feature-inventory.md` (cited as **FI**): every current behavior, the keyboard (section 1), the selector contract (6.2), gaps G1 to G29 (5b), the regression checklist (6.3, cited as `#n`).
- `docs/design/directions.md` (cited as **DIR**): "Product truth every direction carries", "Shared approximation grammar", the shared key additions.

`docs/design/three-recipe.md` did not exist when this was written. If it lands, it governs materials and passes *inside* the scene-engine package (A5); it may not change the interfaces below.

**v1.1 (review fixes, 2026-10-09).** Interface changes since v1, each marked "v1.1" where it lands: `createStore` takes `{onError}` and never throws a reducer or listener error into the dispatcher (2.2); `createSync` takes `onError`, and sync, api, actions and the conductor call injected timers, `fetch` and `now` bare, with `now` in epoch ms (2.8, 3.5); `ViewState.bgPending` holds a G12 message until its state is presented, and the feed bar's `last_play`, `skipped` and `plays_logged` come from the presented state only (2.1, 2.3, 4.6); the snap step and approximate pass arcs (2.4, 7.1); `runIntent` routes an action's rejection to `onError` (2.8); `node --test tests/js/` runs through `tests/js/index.js` (decision 8); missing fixtures fail loudly (7.1).

**v1.2 (shell and theme, 2026-10-09, A0 + A10).** Additive; nothing in v1.1 changes meaning. Details in section 9.
`ui/dom.js` moved to A0 so A7, A8 and A9 can start together (it shipped first: `el`, `svgEl`, `setText`, `setAttr`,
`setData`, `setHidden`, `reconcile`, plus `setClass` and `clear`). `main.js` passes the component roots in the 9.1
table and mounts every component through a dynamic import, so a missing or throwing component leaves a visible notice
in its region and boot continues. The default world is `under-the-lights` (`?world=neutral` forces neutral; an unknown
or broken world falls back to neutral with a notice). New A0 files: `static/js/shell/*.js`, `tests/js/fake-dom.mjs`.

**v1.2 (world needs from DESIGN.md, 2026-10-09, design-system seed; proposed, the owning package decides).** Under the
Lights (`/DESIGN.md`, `docs/design/direction-contract.md`) needs, beyond 2.7: (1) camera insets: the board column
covers the right 456 px at 1440 and 624 px at 1920, so `Engine`/`Look` should pass HUD margins (top, right, bottom,
in px or fractions) to `camera-plan.poseFor`, which already takes `margins` (A5); (2) a kickoff-chosen scene variant,
e.g. `look.world.day` merged over the look at `setGameFrame` when the first row's `wall` is before 5 pm Eastern
(lights, sky, fog, exposure), since `Look` is static and `props` cannot reach lights or fog (A5, A10); (3) camera
choreography that modes cannot express: cut to `tight` at the snap, settle to `wide` after, rise to `blimp` and drift
between drives in Watch this game (A5); (4) an ambient hook so `data-ambient="room"` lifts exposure about +0.5 EV
(A5); (5) optional `D` key → `toggleBoard` with `#app[data-board-open]` (A2; until then the board expands on
`:hover`/`:focus-within`); (6) per-pair hooks on the scorecard's `pairs` (`data-pair`, `data-leader`) so the band can
show three of them (A8). World moments read the app mode from `#app[data-mode]` and the dip setting from
`sc:uls:dip-live` unless (3) adds them to the moments context.

**v1.2 (game surfaces, 2026-10-09, A8).** Additive. Details and every world hook in section 10. New action
`actions.reviewAt(seq)` (a play-feed row, a drive or a logged snap shows its play on the field; `null` returns to
live); the box score shows ESPN's own box (`box_espn`) when the server sends it, so timeline snapshots and
`presentedTimeline` carry it as `boxEspn`; `playsVm`, `drivesVm` and `logVm` mark the reviewed play, and the
play-feed, drive-chart and play-log bindings follow `view.review`; (6) above is built (`data-pair`, `data-leader`).

**v1.2 (input surfaces, 2026-10-09, A7).** Additive. Details and every world hook in section 11. Three view-model
fields (`entryVm.flagOpen`, `lastPlayVm.pauseFirst`, `predictionVm` families' `barPct` and `leagueBarPct`), the
entry-pad binding follows `view.flag`, and one new A7 file, `ui/input-kit.js` (key caps, select-on-focus, bar shares,
safe action calls). Hover or focus on a play, a then-line item, the top pick or a family row (its top play) calls
`actions.hoverLeaf`, which the conductor already turns into `engine.highlightGhost`.

**v1.2 (chrome, 2026-10-09, A9).** Additive. Details and every world hook in section 12. `shell/bindings.js` gains
`fieldHostVm` (fieldVm plus the store's drawn seq, queue, playing seq, rebuild, review seq and the presented epoch), and
the field-host binding selects it with `anim` and `view.review` as deps, so the 5.3 animation hooks come from the store.
The field host never creates the engine (main.js does, 9.5); it builds `#field`, writes the 5.3 hooks, mirrors
`debugState()` on engine events and wires resize and visibility. New A9 file `ui/keycap.js` (key caps and lamps, the
markup A7's input kit shares). `model/copy.js` gains six A9 strings. `#feedEvent` follows the server's event id only
when that id changes, so text typed there survives polls (#104).

**v1.2 (2D field, 2026-10-09, A6).** Additive. Details in section 13. The fallback implements every 2.5 method plus the
two extras the WebGL engine has: `setGameFrame`'s optional 4th argument `game` (a day kickoff merges `look.world.day`,
as `field/scene.js` does) and `setSafeArea(insets)`. Both engines read the same optional safe-area properties,
`--sc-field-safe-top|right|bottom|left` (values in `px`) on `#field` or an ancestor, which a full-bleed world sets so the
field clears its HUD (Under the Lights at 1440: top 44px, right 456px, bottom 184px). Asks, both optional: A1's
conductor passes the timeline body's `game` as `setGameFrame`'s 4th argument (then both engines honor a day kickoff);
W3's layout sets the `--sc-field-safe-*` properties. Eleven A6 files (1.1: the two first listed plus nine); the six
pure ones are policed by `static-rules.test.mjs`. The fallback is forced with `?scene=2d` (there is no `?engine=`).

**v1.2 (3D stage, 2026-10-09, A5 part 1).** Additive. Details, and the internal API A5 part 2 builds on, in section 14.
`field/scene.js` implements every 2.5 method with a complete static world (the regulation field, its paint, the
situation, cameras, labels, lights, bloom, world props) and contract-correct placeholders for plays and ghosts that
part 2 replaces through one table (`field/layers.js` `LAYER_FACTORIES`). Changes outside A5's files, each minimal:
`createEngine` takes `opts.world` (the WorldModule, for `props`, `moments` and `passes`; `shell/engine.js` and
`main.js` pass it, A0); three pure A5 modules are listed in `static-rules.test.mjs`. The engine writes no 5.3 hooks
in the app: the field host (A9, 12) mirrors `debugState()`, whose `ready` now means "the first frame after the latest
`setGameFrame` is on screen". Same extras as the 2D engine: `setGameFrame`'s 4th argument `game`, `setSafeArea`, the
`--sc-field-safe-*` properties. Asks, both optional: A1 passes the timeline's `game` to `setGameFrame` (day games);
W3 sets `--sc-field-safe-*` for Under the Lights (and `--sc-font-display`, which the field's numerals and end-zone
names are painted in). Thirteen new A5 files (1.1).

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
      stage.js layers.js moments.js lines.js turf.js decals.js structures.js
      shaders.js                                                             A5  three.js (v1.2: the stage's parts, 14.1)
      field-spec.js stage-math.js engine-state.js                            A5  pure (v1.2, 14.1)
      fallback-2d.js fallback-draw.js                                        A6  DOM (SVG)
      fallback-runtime.js fallback-layers.js fallback-player.js fallback-svg.js   A6  DOM (v1.2: the engine's parts, 13.1)
      fallback-ghosts.js fallback-plays.js fallback-steps.js fallback-pixels.js fallback-bowl.js   A6  pure (v1.2;
                                                                             fallback-draw.js is pure too, 13.1)
    shell/                                                                  A0  v1.2: main.js's helpers
      prefs.js                       A0  pure   URL and stored choices -> boot prefs
      bindings.js                    A0         component table: root, loader, view model, deps (9.1)
      mount.js                       A0  DOM    dynamic import + mount with notices, the Form hub
      engine.js                      A0  DOM    WebGL engine or the 2D fallback, with a timeout and notices
      notices.js                     A0  DOM    region notices and the page notice tray (#sc-notices)
    ui/
      dom.js scheduler.js                                                   A0 (v1.2: dom.js moved to A0 so A7/A8/A9 can start together)
      masthead.js feed-bar.js watch-transport.js field-host.js review-banner.js
      toast.js conn-banner.js boot-screen.js dialogs.js                     A9
      keycap.js                                                             A9  v1.2: key caps and lamps the chrome builds with (12)
      situation-strip.js entry-pad.js flag-panel.js shorthand.js
      last-play.js prediction.js                                            A7
      input-kit.js                                                          A7  v1.2: key caps, select-on-focus, bar shares (11)
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
  js/fake-dom.mjs                    A0  v1.2: a small fake DOM (focus, attributes, events) for node tests of DOM modules
  js/three-env.mjs three-hooks.mjs   A5  v1.2: the import map in node (vendored three r185), for node tests of scene code
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
| Tendency rows (v1.2, A11, 2026-10-09) | `#profArea [data-term]`, one per forest-plot row | `data-term="<coef key>"`, `data-sure="true \| false"` (true: filled, the 90% interval excludes zero; `tendenciesVm` rows' `key` and `sure`). #114 can't see "filled" in an SVG any other way. |

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

**v1.2 (backend, 2026-10-09).** #5, #7 and #8 are built, plus four additions. Pinned by `tests/test_backend_gaps.py`
and `tests/test_api_backend_gaps.py`.

- **#5, G8: versions only go up.** Every save takes a version one above any the engine has used: after an undo, a
  reset, a replay, a watch start or a watch restore too. `/api/version` reads it lock-free and never sees it drop,
  not even halfway through a reset. `!==` (sync-plan) keeps working. A shorthand line is one save, so one new version.
- **#7, G22.** `POST /api/drive {"end": "fg"}` and the shorthand `fg` with no drive active answer 400 with
  `error` "No DAL drive in progress, so there's no field goal to add. To fix the score, type it like 'DAL 3 TB 0'."
  and change nothing. `end` must be `punt`, `fg`, `fg_miss` or `half` (400 otherwise); punt, fg_miss and half stay
  harmless off the field.
- **#8: `GET /api/timeline?since=s&until=m&epoch=e`.** `until` is optional, checked like `since` (400
  `{"error": "until must be a whole number"}`) and never below it (400 `{"error": "until can't be before since"}`).
  The answer is the timeline as of row m: `n = min(m, applied rows)`, `rows` are `s < seq <= n`, and `drives`,
  `status` and `box` are what the response said when row n was the newest (manual mode too: a drive that goes on
  past n is still in progress, and the status is the one right after row n). The body echoes `until: n`; without
  `until` it is C1's, unchanged. `since=k&until=k` is a snapshot alone (no rows). A stale epoch still answers from
  row 1 (`reset: true`), up to `until`. So one `since=local.n` poll brings the batch and its newest snapshot, and
  `since=k&until=k` for each earlier k of the batch fills `snapshots`.
- **`game`: facts for the scene,** with `field`, `teams`, `team_order` and `meta` (only when `since` is 0 or
  `reset`): `{"kickoff": "2026-10-09T00:15:00Z", "kickoff_local": "2026-10-08T19:15:00-05:00", "venue": "AT&T
  Stadium", "city": "Arlington", "indoor": null, "grass": false, "light": "night"}`. `kickoff` is the header's
  `competitions[0].date` in UTC. `kickoff_local` is that moment at the venue (the zone of its US state, or of its
  country abroad; null when unknown). `indoor` and `grass` are ESPN's own booleans from `gameInfo.venue` (then the
  header's venue), null when ESPN doesn't say: none of the 65 cached 2026 summaries has `indoor`, so null means
  unknown, not outdoors. `light` is `"night"` when the local kickoff hour is 17 or later or unknown, else `"day"`.
  Never a score, record, winner or result. With no summary every field is null and `light` is `"night"`.
- **`box_espn` and `box_source`,** in every timeline body. Over the 65 cached 2026 games the derived `box` equals
  ESPN's final box in every field on only 22 of 130 team-games (total yards differ on 74; TB at DAL matches
  exactly), and ESPN's own box parses on all 65. Outside Watch mode `box_espn` is ESPN's own
  `boxscore.teams[].statistics` (display values) in exactly the shape of `box` (`top_s` and `top` included) and
  `box_source` is `"espn"`. It is `null`, with `box_source: "derived"`, in Watch mode (spoilers), in manual mode,
  for an `until` short of the newest row, while any play of the summary isn't applied yet (a watch stopped part way
  leaves a finished game on screen in replay mode, and its final box would run ahead of the field), and when any
  field fails to parse (never a mix). The UI shows `box_espn` when it is there, else `box`. Outside Watch mode this
  replaces DC C4's "Don't use ESPN's boxscore for display".
- **Undo never takes an ESPN play back out.** Every play the feed, a replay or a watch applies seals the undo
  history. A `POST /api/undo` that would step back past it answers **409** with the state body and `error` "Undo
  can't take back a play ESPN logged: the feed would never log it again. Retag the last play with A, N, O or P, or
  type the fix." and changes nothing (same version, same epoch). Changes made after the newest ESPN play (a retag, a
  typed fix) still undo with 200. A reset or replay of an ESPN game, a watch start and a watch restore clear the
  history instead, so the next U says "Nothing to undo." (200). Chosen over forgetting the play's id: the feed
  would then re-apply it after the plays applied since (out of order), and a watch's index would drift. For the
  checklist: #99's "U undoes" now means U sends `/api/undo` and a fed play gives the 409 as a red toast; #88 holds
  in manual mode; DC E2.8 ("undo stays allowed during a watch") is bounded by the same rule; the client-side
  refusal while a game plays back (4.3) stays.
- **A shorthand line is all or nothing on disk too.** Its segments write nothing; the line is one save at the end.
  A bad segment, or a save that fails, leaves the game, `live_state.json`, the DuckDB archive and the version as
  they were (it used to leave the half-done line on disk and hand its version out twice).

---

## 9. v1.2: shell and theme as built (A0 + A10, 2026-10-09)

Additive to sections 1 to 8. Where this section is more specific than an earlier one, it is how the code works.

### 9.1 Component roots, view models and deps (`shell/bindings.js`)

`main.js` imports every component module dynamically, mounts them in this order with `mount(root, ctx)`, and binds
each to the scheduler. A component reads and writes only inside its root.

| Component | Root passed to `mount` | View model | Re-renders when (deps, by identity) |
| --- | --- | --- | --- |
| `boot-screen.js` | `#rg-boot` | `bootVm` | `boot`, `conn`, the seconds the retry countdown shows |
| `conn-banner.js` | `#rg-conn` | `connVm` | `conn`, the seconds the retry countdown shows |
| `toast.js` | `#toast` | `view.toast` | `view.toast` |
| `masthead.js` | `#rg-masthead` | `mastheadVm` | `presented`, `view.camera`, `view.booth`, `view.scorecardOpen`, camera modes |
| `feed-bar.js` | `#rg-feed` | `feedVm` | `presented`, `version`, `view.bgMessage` |
| `scoreboard.js` | `#rg-scoreboard` | `scoreboardVm` | `presented`, `timeline`, `anim.drawnThrough` |
| `situation-strip.js` | `#rg-situation` | `situationVm` | `presented`, `view.sideAtFifty`, `view.stripRejected`, `timeline`, `anim.drawnThrough` |
| `field-host.js` | `#rg-field` | `fieldVm` | `presented`, `timeline`, `anim.drawnThrough`, and the engine (`env.extras` changes whenever the engine is created or swapped, so the host re-reads `ctx.engine()` and re-subscribes to its events) |
| `review-banner.js` | `#rg-field` (appends its banner; the field host does not mount it) | `reviewVm` | `view.review`, `timeline`, `anim.drawnThrough` |
| `watch-transport.js` | `#rg-transport` | `transportVm` | `version`, `presented`, `prefs` |
| `prediction.js` | `#heroArea` | `predictionVm` | `presented`, `view.pick`, `view.hoverLeaf`, input mode |
| `entry-pad.js` | `#entry` (finds `#manualEntry` and `#entryHint` inside it and writes `#entry[data-dim]`; it must not clear `#entry`, which also holds the last-play and shorthand roots) | `entryVm` | `presented`, `view.pick`, input mode |
| `last-play.js` | `#lastPlay` | `lastPlayVm` | `presented`, input mode |
| `shorthand.js` | `[data-mount="shorthand"]` | `null` (static) | never after the first render |
| `flag-panel.js` | `#flagPanel` | `flagsVm` | `presented`, `view.flag`, `view.pick`, input mode |
| `play-feed.js` | `#rg-plays` | `playsVm` | `presented`, `timeline`, `anim.drawnThrough` |
| `drive-chart.js` | `#rg-drives` | `drivesVm` | `presented`, `timeline`, `anim.drawnThrough` |
| `win-prob.js` | `#rg-wp` | `wpVm` | `presented`, `timeline`, `anim.drawnThrough` |
| `scorecard.js` | `#kpiArea` | `scorecardVm` | `presented`, `view.scorecardOpen` |
| `box-score.js` | `#rg-box` | `boxVm` | `presented`, `timeline`, `anim.drawnThrough` |
| `tendencies.js` | `#rg-tendencies` | `tendenciesVm` | `presented` |
| `play-log.js` | `#logArea` | `logVm` | `presented` |

"Input mode" is `version.watch.state`, `version.feed.on` and the presented watch state (what `inputMode(pv)` reads).
`ctx` is `{ actions, form, engine: () => Engine | null, copy }` (`copy` is the `model/copy.js` namespace).

**Form.** The object `mount` returns may carry any of the `Form` methods (`readYards`, `writeYards`, `readTD`,
`writeTD`, `readTO`, `writeTO`, `readAutoFirst`, `writeAutoFirst`, `focusYards`), directly or under `.form`.
`ctx.form` is a hub that forwards each call to the first mounted component that has the method (entry pad: yards,
TD, TO, focus; flag panel: auto first down); with none, reads return empty values and writes do nothing.

**Integrity.** After each mount the shell checks that every id `index.html` provides (`SHELL_IDS` in
`shell/bindings.js`) is still on the page; a component that removed one is named in a notice.

**Failures.** A module that fails to load, has no `mount`, or throws in `mount` leaves a `.sc-region-notice`
(`[data-testid="region-notice"][data-region=<name>]`) in its root and one summary line in the page tray. An `update`
that throws is reported in the tray and retried only when that binding's deps change. The boot screen and the toast
have built-in fallbacks (the static placeholder in `index.html` and a text-only toast), so neither can go blank.

### 9.2 `ui/dom.js` details

- `el(tag, { id, cls, attrs, data, text, on }, children)`: unknown option names throw (no `className`, no
  `class`); `cls` is a string or a list; children are nodes, or strings and numbers added as text.
- `setAttr` refuses `on*` attributes, `srcdoc`, and `javascript:`, `vbscript:` and `data:` URLs (except
  `data:image/png|gif|jpeg|webp`) in URL attributes. `null`, `undefined` and `false` remove; `true` sets `""`.
- `setData(node, "sceneReady", true)` writes `data-scene-ready="true"`: booleans are written as `"true"` / `"false"`
  (the 5.3 and 5.4 hooks read them that way); `null` removes.
- Every setter skips writes when the value is already there.
- `reconcile(parent, items, { key, create, update })`: `parent` belongs to the list (children it did not create are
  removed); kept nodes are never rebuilt; the fewest nodes move (longest increasing subsequence); a focused row keeps
  focus; `update(node, item, index)` runs for every item, right after `create` for new ones; duplicate keys throw.
- `setClass(node, cls, on)` toggles one class (HTML and SVG); `clear(node)` removes every child.

### 9.3 `ui/scheduler.js` details

`createScheduler(store, bindings, { raf, now, cancelRaf?, onError?, view?, extras? })` returns
`{ start, flush, invalidate, add, stop }`. `deps(state, env)` gets `env = { now, extras }`; `select(pv)` gets
`presentedView(state, now)` merged with `extras()` (main.js passes `{ cameraModes, engine }`, replaced whenever the
engine is created or swapped; `mastheadVm` reads `pv.cameraModes`). `start` renders every binding at once; later changes render once per frame.
`invalidate` asks for a frame without a store change (main.js calls it every 250 ms while a retry is pending, so
"Retrying in N s" counts down on time).
`add(binding)` returns its remover. `onError(err, binding)` sees every throw.

### 9.4 Theme (A10)

- `theme/tokens.js`: `REQUIRED_TOKENS` (54 names, the 2.7 table in its order, grouped in `TOKEN_GROUPS`) and
  `RUNTIME_TOKENS` (9). `TOKEN_KIND` gives each required token a value kind; `checkTokenValue`, `tokenProblems`,
  `parseTokenBlocks` and `tokensFor(cssText, ':root[data-world="<id>"]')` let a world check its `tokens.css` in node,
  and `missingTokens(read)` checks the page. `base.css` gives the runtime tokens neutral defaults on `:root`.
- `theme/apply.js`: `applyWorld(world, doc, { timeoutMs })` resolves `{ loaded, failed }` after the new stylesheets
  load next to the old ones, then flips `<html data-world>`; font files are preloaded. `applyRootAttrs(doc,
  { motion, ambient, scene })` writes the other `<html>` hooks. `applyTeams(teams, doc, look)` sets the caller and
  opponent tokens (`-alt` is the validated alternate color, `-ink` the text color on the fill) and
  `applyPossession(poss, doc)` moves `--sc-team-off`, `--sc-team-off-ink` and `--sc-team-def` with the ball (the
  caller is the offense when nobody has it). `missingWorldTokens(doc)` reads the computed root style.
- `theme/team-colors.js` also exports `NEUTRAL_TEAM`, `REFERENCE_BACKGROUNDS` (turf, night, white),
  `minContrastAgainst`, `inkOn`, `mixHex`, `liftToLuminance` (three-recipe 10.3 glow lift) and `legibility(team)`.
  `teamPaint` returns `{ fill, edge, core, ink, alt, usedAlt, needsCore, neutral }`.
- Look (2.7) as validated: unknown keys are errors at every level; `motion` holds every `field/timing.js`
  `DEFAULT_MOTION` key (including `minRowMs`) plus `ghostInMs`, `ghostOutMs`, `verdictMs`; a world may keep its own
  data under `look.world` (plain JSON, never validated beyond that). Directional and spot lights need `position`.
- WorldModule: the module's `default` export, or a named `world` export, or the module's own fields. `css` paths must
  sit under `/static/css/worlds/<id>/`, `fonts` under `/static/fonts/<id>/`. New optional fields:
  `booth: { holds: RegionName[] }`, the regions the world shows in its booth (`actions.openFlag` opens the booth
  automatically when it holds `flags`); `ambient: "room" | "dark"`, the world's default room lights when the viewer
  has chosen none (`?ambient=` and `sc:ambient` win; the app default is `room`; Under the Lights sets `dark`).
  `REGION_NAMES` is exported by `theme/registry.js`.
- World choice: `?world=<id>` (map keys only), then `localStorage sc:world`, then `DEFAULT_WORLD`
  (`under-the-lights`), then `neutral`. An ignored id, a world that fails to load or validate, a look that fails
  `resolveLook` (the scene then uses `NEUTRAL_LOOK`), stylesheets that fail, and missing tokens each show a notice.
  The neutral world's `arrange` wraps the regions in `.sc-col-main` and `.sc-col-rail` and sets
  `#app[data-layout="neutral"]`, which `css/layout.css` turns into the two-column page.
- `index.html` links `css/components/scrub.css` once W5 ships it (W5 asks the A0 owner); a link to a missing file
  would be a console error (#2).

### 9.5 Boot order (`main.js`, section 3.1 as built)

1. Read boot prefs (`?world`, `?scene=2d`, `?ambient=dark`, `?capture=1`, `?debug=1`, `sc:world`, `sc:camera`,
   `sc:ambient`, `prefers-reduced-motion`); start fetching every component module and the 2D engine in parallel.
2. Choose and load the world (fallback rules above), resolve its look, apply `<html>` hooks and the world CSS, check
   the tokens, run `world.arrange(app, regions)`.
3. Create the store (`initialState({ prefs })`), the API client, the Form hub, dialogs, sync and actions.
4. Mount every component in the 9.1 order and start the scheduler (plus three shell bindings: teams to
   `applyTeams`, possession to `applyPossession`, prefs to `applyRootAttrs` and `engine.setReducedMotion`).
5. Create the engine in `#field`: the 2D fallback when `?scene=2d` or no WebGL2, else `field/scene.js`
   `createEngine` (8 s limit); any failure falls back to 2D with `#field[data-scene-error]` and a notice. Then
   `<html data-scene>`, the camera modes, and the stored or default camera.
6. Start the conductor (its `createFallback` swaps in the 2D engine at run time), attach the keyboard, watch
   `prefers-reduced-motion`, then `sync.start()`. With `?debug=1`, `window.__shadowDebug = () => engine.debugState()`.

## 10. v1.2: game surfaces as built (A8, 2026-10-09)

Additive to sections 2.3, 2.6, 5.4 and 9.1. Where this section is more specific, it is how the code works.

### 10.1 Interface additions outside A8's files (each minimal, each tested where it lands)

| Where (owner) | Addition | Why |
| --- | --- | --- |
| `core/actions.js` (A2) | `reviewAt(seq)`: sets `view.review` to a drawn row that draws something (`review.drawableSeqs`); `null` returns to live; anything else is ignored; never steps or pauses the server | a play-feed row, a drive or a logged snap shows its play on the field (W5's scrub can use it too) |
| `core/timeline-cache.js`, `core/present.js` (A1) | snapshots keep `boxEspn` (the body's `box_espn`, else `null`); `presentedTimeline` passes it | Appendix B v1.2: the UI shows `box_espn` when it is there |
| `model/vm-box.js` (A3) | prefers `tl.boxEspn` when it has team columns; adds `source` (`espn`, `derived`, `null`), `sourceText`, `emptyText` | the box says which box it is |
| `model/vm-plays.js` (A3) | `reviewSeq`; rows `reviewable` (not admin) and `reviewing` | the reviewed row is pressed |
| `model/vm-drives.js` (A3) | `reviewSeq`; drives `firstSeq` (first drawn row that draws something) and `reviewing` | a drive shows its first play |
| `model/vm-log.js` (A3) | rows `verdict` (`verdictOf`), `tlSeq` (its drawn timeline row, by `espn_id` or `log-<seq>`), `reviewing` | a logged snap shows its play |
| `model/vm-scoreboard.js`, `model/vm-wp.js` (A3) | teams `logoDark` (validated like `logo`); `caller` | LED windows use ESPN's dark logo (DESIGN.md); the readout names the side |
| `model/copy.js` (A3) | new keys in `BOX`, `PLAYS`, `DRIVES`, `WP`, `SCOREBOARD`, `SCORECARD`, `TENDENCIES` (marked "v1.2 (A8)") | every string stays in copy.js |
| `shell/bindings.js` (A0) | the play-feed, drive-chart and play-log deps add `view.review` (the log also the timeline) | they mark the reviewed play |

### 10.2 Hooks a world styles against

Text only; component CSS holds structure and token references; every state is a data attribute or an ARIA state on
markup the component always builds; lists are reconciled by key, so nodes and focus survive renders. A press on a
row whose play is on the field (`aria-pressed="true"`) returns to live.

- **Scoreboard** (`#rg-scoreboard`): `.sc-scoreboard[data-testid="scoreboard"][data-state][data-poss][data-source]`;
  `li.sc-sb-team[data-team][data-caller][data-home][data-side][data-poss][data-logo="shown|failed|none"]` with
  `.sc-sb-logo` (`img[data-testid="team-logo"]`, else the `.sc-sb-mono` monogram), `.sc-sb-name`, `.sc-sb-abbr`,
  `.sc-sb-score[data-testid="team-score"]`, the lamp `.sc-sb-poss[data-on]` and `.sc-sb-tos` (three
  `.sc-sb-to[data-on]`); `.sc-sb-fact[data-fact="qtr|clock|down|ball"]` (`.sc-sb-cap`, a value), `.sc-sb-est`,
  `.sc-sb-final`. A world sets `--sc-logo-variant: dark` to load `logo_dark` (neutral does under `data-ambient="dark"`).
- **Digit windows**: `.sc-digits[data-ghost]` (scores `88`, the clock `88:88`, `88%`, scorecard values as 8s). The
  ghost is the unlit pattern a world may light behind the value (DESIGN.md, the Ticking Number Rule); neutral doesn't.
- **Play feed** (`#rg-plays`): `ol[data-testid="play-feed"] > li.sc-pf-group[data-drive][data-team][data-caller]
  [data-complete]` (sticky header `.sc-pf-ghead`: team, result or "Drive in progress", summary) `> ol.sc-pf-rows >
  li[data-testid="play-row"]` (the 5.4 attributes plus `data-reviewing`, `data-newest`) `> button.sc-pf-btn`
  (a `div` on admin rows): `.sc-pf-time`, `.sc-pf-team`, `.sc-pf-sit`, `.sc-pf-noplay`, `.sc-pf-result`,
  `.sc-pf-text`, `.sc-pf-call` (`.sc-pf-verdict`, `.sc-pf-callname`, `.sc-pf-retagged`).
- **Drive chart** (`#rg-drives`): `ol[data-testid="drive-chart"] > li[data-testid="drive"][data-idx][data-team]
  [data-caller][data-dir][data-result][data-complete][data-current][data-reviewing] > button.sc-dc-btn` (disabled
  until its first row is drawn): `.sc-dc-team`, `.sc-dc-result`, `.sc-dc-summary`, `svg.sc-dc-track` (x 0 to 100, the
  caller's goal on the left: `.sc-dc-field`, `.sc-dc-yard`, `.sc-dc-mid`, `.sc-dc-bar`, `.sc-dc-end`). Two lines per
  drive in a narrow region, one line from 34rem (container query `sc-drives`).
- **Win probability** (`#rg-wp`): `.sc-wp[data-testid="wp-chart"]` (5.4), `.sc-wp-team`, `.sc-wp-value`;
  `svg.sc-wp-svg` (viewBox 360x100, stretched, non-scaling strokes): `.sc-wp-bg`, `.sc-wp-q`, `.sc-wp-even`,
  `.sc-wp-area-caller` and `-opp` (clipped above and below 50%), `.sc-wp-line`,
  `.sc-wp-mark[data-kind="score|turnover"][data-team][data-seq]`, `.sc-wp-now`; `.sc-wp-axis` (`.sc-wp-ot`); `.sc-wp-note`.
- **Box score** (`#rg-box`): `table.sc-box[data-testid="box-score"][data-source]`, `th[data-team]`, `td[data-team]`,
  `.sc-box-source`, `.sc-box-empty`.
- **Scorecard** (`#kpiArea`): `.sc-scorecard[data-expanded][data-empty]` (container `sc-scorecard`);
  `li.sc-card-pair[data-pair][data-leader][data-better]` with `.sc-card-plabel`, two
  `.sc-card-side[data-side][data-lead]` (caption, `.sc-card-full` "0.421", `.sc-card-brief` ".421" hidden in neutral,
  `.sc-card-lamp`) and `.sc-card-basis`; the band's three are `called_right`, `top3`, `passrun_logloss`. Then
  `.sc-card-group[data-group="leaf|family|passrun"]` (`dl.sc-card-kpis` of `.sc-kpi`: `dt.sc-kpi-label`,
  `dd.sc-kpi-value[data-tone]` with the legacy `.better` / `.worse`) and `.sc-card-note`.
- **Tendencies** (`#rg-tendencies`): `h2#profTitle`, `#profArea`; `ul.sc-tend-terms` of `li.sc-tend-ghead` and
  `li.sc-tend-row[data-term][data-group][data-sure][data-sign]` (`.sc-tend-label`; `svg.sc-tend-svg` with
  `.sc-tend-zero`, `.sc-tend-ci`, `.sc-tend-dot`, `.sc-tend-hole`); `.sc-tend-axis`, `.sc-tend-note`,
  `table.sc-tend-mix tr[data-family]`, `.sc-tend-heldout`.
- **Play log** (`#logArea`): `table.sc-log[data-testid="play-log"]`, `tr[data-seq][data-nullified][data-verdict]
  [data-reviewing][data-tl-seq]`; the Actual name is `button.sc-log-link` (disabled until its row is drawn);
  `.sc-log-rank` with `.ok` / `.no` and `data-tone`.

### 10.3 Tests

Node: `tests/js/{scoreboard,play-feed,drive-chart,win-prob,box-score,scorecard,tendencies,play-log}.test.mjs` on the
real captures through `tests/js/game-surfaces-harness.mjs`, plus additive cases in the tests of every file in 10.1.
E2E: `tests/e2e/test_ui_game_surfaces.py` (#6 for these panels, #107, #108, #110 to #115, G15, G16, G18, the 5.4
hooks after a replay, review from a play row, a drive and a logged snap, no sideways scroll at 390 px).

---

## 11. v1.2: input surfaces as built (A7, 2026-10-09)

Additive to sections 2.3, 2.6, 4.5, 4.6, 5.1 and 9.1. Where this section is more specific, it is how the code works.

### 11.1 Interface additions outside A7's files (each minimal, each tested where it lands)

| Where (owner) | Addition | Why |
| --- | --- | --- |
| `model/vm-entry.js` (A3) | `flagOpen` (`view.flag.open`) | `#flagBtn.on` and `aria-expanded` (5.1) live on the entry pad |
| `shell/bindings.js` (A0) | the entry-pad deps add `view.flag` | the flag key follows X and Escape |
| `model/vm-last-play.js` (A3) | `pauseFirst` (the watch is `playing`) | a retag key clicked during a playing watch pauses first, like the keyboard (DC E2.8) |
| `model/vm-prediction.js` (A3) | families `barPct` and `leagueBarPct` (0 to 100, `null` when unknown) | the family bar and its league notch |

### 11.2 Behavior as built

- **Situation strip** (4.5, G1, G2, G3): focus selects the value, and selects again on the next task so a mouse
  click's caret can't undo it (skipped once typing starts). An `input` event marks the field edited. Enter: an edited
  field commits (`actions.commitStrip(id, text, true)`), an unedited one with a kept rejection lets it go; then blur,
  then `form.focusYards()` when a drive was on before the save (#21). A blur (Tab) commits an edited field (#20).
  Escape: the last rendered server value comes back with no request (#22, #23); a kept rejection is cleared in the
  store through `actions.commitStrip(id, value, false)`, which never sends. A commit that sends nothing (an emptied
  field) restores the server value (#24). A render never writes the focused field (#25). The side chip calls
  `actions.flipSide(typed text)` and, once it saved, focuses and selects Ball on (#18).
- **Entry pad**: the entry line (chosen play, Yards, Touchdown, Turnover, Log play) comes before the keypad, so a world
  can pin it (DESIGN.md desk). It is the Form for Yards, TD, TO and the Yards focus: `focusYards` focuses and selects
  unless Yards is already focused (FI 4.6); `writeYards` while focused selects, so after a log the next digit
  replaces the 0.
- **Next call**: one delegated `pointerover` on `.sc-call` lights whatever play is under the pointer: the nearest
  `data-leaf` (a play button, a then-line item, the top pick), else a family row's `data-top-leaf` (its most likely
  play); `pointerleave` clears it; focus on a play button lights it too and comes back when the pointer leaves. Each
  change calls `actions.hoverLeaf(leaf | null)` once. Leaving the call face (drive over) clears it.
- **Shorthand**: lines go out in order through the FIFO actions queue; a new line typed while one is out runs after
  it (#82); a repeat Enter on the line already out is ignored; an answer clears the box only when it still holds that
  line, so text typed since is never wiped; a refused line stays (#83).
- **Last play**: `data-fresh="true"` for `RETAG_FRESH_MS` (8 s) after the row changes to a newer play, never for the
  play on screen at load (DESIGN.md: the retag keys light after each caller play). `ctx.timers` may inject timers.
- **Flag panel**: `role="region"` labelled by its title (`#flagTitle`); the Form's `readAutoFirst`/`writeAutoFirst`.

### 11.3 Hooks a world styles against

Text only; component CSS holds structure and token references. Every state below is a class, a data attribute or an
ARIA state on markup the component always builds; lists are reconciled by key, so nodes and focus survive renders.

- **Key caps** (entry keys, foul keys, retag keys): `button.sc-key` > `.sc-key-cap[aria-hidden="true"]` (the key),
  `.sc-key-name`, `.sc-key-hint` (hidden when empty), `aria-keyshortcuts`. The same markup as A9's `ui/keycap.js`
  (which adds `.sc-key-value`). A9's `masthead.css` styles `.sc-key` page-wide, so A7's key rules are scoped to
  `.sc-keypad`, `#flagPanel` and `.sc-retag`.
- **Situation strip** (`#rg-situation`): `.sc-strip` > `.sc-strip-fields` (`.sc-strip-group[data-group="time|score|
  down|spot"]`, `label.sc-strip-field[data-field]` > `.sc-strip-label` + `input.sc-strip-input`, `.sc-spot` holding
  `#iSide.sc-side` and `#iYard`), `.sc-strip-drive` (`#driveInfo.sc-drive-info[data-cue]`, `#endRow.sc-end-row` >
  `button.sc-end[data-end]`), `.sc-strip-note`. Rejected: `input.bad[aria-invalid="true"]`. Est.: `#clockEst.sc-est`.
  Chip: `#iSide.opp[data-side="own|opp"]`. Field widths read `--sc-strip-chars`.
- **Next call** (`#heroArea[data-kind="empty|offfield|call"]`): `.sc-offfield` (`.sc-offfield-heading`,
  `.sc-offfield-body` with `strong`); `article.sc-call[data-enter="a|b"]` (flips on every new call: another snap, top
  pick or share, so a world's entrance replays) > `.sc-call-head` (`.sc-call-kicker` > `.sc-call-label`,
  `.sc-call-sep`, `.sc-call-snap`), `.sc-call-top[data-leaf][data-family]` (`h2.sc-call-name`, `.sc-call-figure` >
  `.sc-call-pct` + `.pill[data-flag][data-tilt][data-side]` with the legacy kind class), `.sc-then` (`.sc-then-lead`,
  `.sc-then-item[data-leaf]` > `.sc-then-sep`, `.sc-then-name`, `.sc-then-pct`), `.sc-split` (`.sc-split-bar
  [role="img"]` > `.sc-split-pass`, `.lgmark`; `.sc-split-labels > span[data-side="pass|league|run"]`), `.sc-fams` >
  `section.fam[data-family][data-top-leaf][data-hot]` (`.sc-fam-head` > `.sc-fam-name` + `.sc-hot`; `.sc-fam-pct`;
  `.sc-fam-bar` > `.sc-fam-fill` + `.sc-fam-tick`; `.sc-fam-league`; `ul.sc-leaves` > `li.sc-leaf-row` >
  `button.leaf[data-leaf][data-family][aria-pressed][data-picked][data-highlighted]` with `.sc-leaf-name`, `.sc-hot`,
  `.sc-leaf-pct`, `.sc-leaf-bar` > `.sc-leaf-fill`), `.sc-call-more` (`ul.why` > `li.sc-why-item[data-kind=
  "habits|script|memory"][data-sign="up|down|none"]` > `.sc-why-pts` + `.sc-why-text`; `.sc-legend`). Hot arrows:
  `.sc-hot.up|.down[data-hot][title][role="img"]`, hidden and empty when not hot.
- **Entry desk** (`#entry[data-dim][data-entry-mode="manual|feed|watch"]`): `#manualEntry` > `.sc-pad-title`,
  `.sc-entry-line` (`#chosen.sc-chosen[data-placeholder]` > `.sc-chosen-name`, `.sc-chosen-sep`, `.sc-chosen-hint`;
  `label.sc-yards` > `.sc-yards-label` + `#yards`; `label.sc-check[data-check="fTD|fTO"]` > checkbox +
  `.sc-check-label` (`.sc-check-key`); `#logBtn.sc-log-play`), `.sc-keypad` > `.sc-keyrow[data-row="run|pass|rpo|
  result"]` > `.sc-keyrow-label` + `.sc-keyrow-keys` > `.key.sc-key[data-k|data-out][data-tone="run|pass|rpo|result"]`
  and `#flagBtn.key.sc-key[data-tone="flag"][aria-expanded]`; `#entryHint`.
- **Shorthand** (`[data-mount="shorthand"]`): `.sc-short` > `#cmd.sc-short-input`, `#cmdBtn.sc-short-run[aria-busy]`.
- **Last play** (`#lastPlay[data-kind="waiting|play"][data-fresh][role="region"]`): `.sc-last-heading`,
  `.sc-last-name`, `.sc-last-yards`, `.sc-last-text`, `.sc-retag` > `.sc-key[data-retag][data-tone].cur
  [aria-current]`.
- **Flag panel** (`#flagPanel[role="region"]`): `.sc-flag-head` (`h2#flagTitle.sc-flag-title`, `#flagClose`),
  `#flagNote.sc-flag-note`, `.sc-flag-cols` > `section.sc-flag-col[data-against="def|off"]` (`.sc-flag-heading`,
  `ul.sc-flag-list` > `li.sc-flag-row` > `.sc-key.sc-flag[data-pen]`, `.sc-flag-other` with Other and, on defense,
  `label.sc-check` > `#otherFirst`), `.sc-flag-offset` > `[data-pen="OFFSET"]`, `.sc-flag-hint`.
- **Data properties** the components write: `--sc-share` and `--sc-league-share` ("0%" to "100%") on
  `.sc-split-bar`, `.sc-fam-bar` and each `button.leaf`. The component CSS sets `--sc-tone` from `data-family` and
  `data-tone`; a world may set its own. `--sc-entry-dim` is the pad's opacity off the field.
- Avoided on purpose: `.sc-field` is the field host (A9) and `.sc-log` the play-log table (A8).

### 11.4 Tests

Node: `tests/js/{situation-strip,entry-pad,flag-panel,shorthand,last-play,prediction,input-kit}.test.mjs` on the real
state captures through `tests/js/ui-input-harness.mjs` (fake DOM, recording actions and Form stubs, fake timers).
E2E: A11's `test_ui_checklist_strip.py` (#9 to #26, G3), `test_ui_checklist_prediction.py` (#29 to #37, #122, G24)
and `test_ui_checklist_field.py` (#27, #28) are the checklist; `tests/e2e/test_ui_input_surfaces.py` (A7) adds what
they don't pin: select-on-focus by mouse, hover and focus round trips, the family-row link, the flag key's state,
the desk's mode and dim hooks, the retag keys' fresh window, the shorthand queue, the 760 px and 390 px layouts.

---

## 12. v1.2: chrome as built (A9, 2026-10-09)

Additive to sections 2.5, 2.6, 3.8, 3.9, 5.3, 5.4 and 9.1. Where this section is more specific, it is how the code works.

### 12.1 Interface additions outside A9's files (each minimal, each tested)

| Where (owner) | Addition | Why |
| --- | --- | --- |
| `shell/bindings.js` (A0) | `fieldHostVm(pv)`: `fieldVm(pv)` plus `anim: { drawnSeq, queue, playingSeq, rebuilding }`, `reviewSeq` and `epoch` (the presented state's `timeline.epoch`); the field-host binding selects it, and its deps add `anim` and `view.review` | `#field[data-drawn-seq]`, `[data-queue]`, `[data-playing-seq]`, `[data-review-seq]`, `[data-epoch]` and `[data-anim-state]` (5.3) are store facts `fieldVm` does not carry |
| `model/copy.js` (A3) | `MASTHEAD.gameGroup`, `MASTHEAD.viewGroup`, `REVIEW.earlier`, `REVIEW.later`, `REVIEW.live`, `FIELD.label` | the masthead's key groups, the review banner's keys, `#field`'s name before a game loads |

New A9 file: `ui/keycap.js` (`keycap`, `setKeyName`, `setKeyValue`, `lamp`).

### 12.2 Behavior as built

- **Field host.** Builds `#field` (`role="img"`; `aria-label` from `fieldVm`, "Football field" before a game) with the
  legend inside it. It never creates the engine (main.js does, 9.5) and never writes `data-scene-error` (main.js
  does). Hooks: from `fieldVm`, `data-drive-active`, `data-los`, `data-ltg`, `data-poss`, `data-ball-x`, `data-ltg-x`
  (absent when unknown); from the store, `data-drawn-seq`, `data-queue`, `data-playing-seq`, `data-review-seq`,
  `data-epoch`; from `engine.debugState()`, read on every engine event (`ready anim camera frame contextlost
  contextrestored`) and on attach, `data-scene` (the engine's `kind`), `data-scene-ready`, `data-frames`,
  `data-ghosts`, `data-ghost-highlight`, `data-camera`. `data-ghosts` and `data-ghost-highlight` start empty, so they
  exist before an engine does. `data-anim-state`: `rebuilding` while the store rebuilds; `playing` while a row is
  queued or playing; else the engine's own non-idle state (it may still be finishing); else `reviewing` while the
  review cursor is set; else `idle`. Whenever `ctx.engine()` changes (the scheduler re-runs the host on `env.extras`),
  the host re-subscribes, calls `engine.resize(clientWidth, clientHeight)` and, in a hidden tab, `setVisible(false)`.
  A ResizeObserver feeds `engine.resize` (a zero size is skipped); `visibilitychange` calls `setVisible`. An engine
  call or `debugState` that throws goes to `reportError`; the store hooks are still written.
- **Review banner.** Appended after `#field` in `#rg-field` (the field host leaves it alone): an amber lamp, the
  `reviewVm` text, and three keys so a mouse or a phone can step and leave review too: `[data-review="earlier"]` (cap
  ←, `actions.review(-1)`), `[data-review="later"]` (→, `actions.review(1)`), `[data-review="live"]` (Esc,
  `actions.exitReview()`). A `.sr-only` polite line beside it (`.sc-review-live`, always rendered) speaks each
  reviewed play and goes quiet at the live edge; the banner itself is not a live region, so its keys are not read as
  news.
- **Feed bar.** `#feedEvent` follows the server's `feed.event_id` only when that id changes, and never while focused,
  so text typed there survives the polls until the server moves to another game (#104, FI 5.17); Enter blurs it.
  `#feedBtn`, `#replayBtn` and `[data-watch="start"]` hand the box's text, untrimmed, to `actions.feedToggle`,
  `actions.replay` and `actions.watchStart` (which trim). G12: the polite `[data-testid="bg-message"]` region is
  always rendered; each new message is a new `.sc-feed-bg-line`, so a world can step it in.
- **Watch transport.** Keys shown per state: `idle`/`stopped` start; `playing` pause, step (disabled), stop; `paused`
  play, step, stop; `done` back, again; `error` start, stop and the error line (`role="alert"`). `disabled` follows
  `transportVm`; a click on a disabled or hidden key never reaches an action. The four speeds always show (before a
  start they set `prefs.watchSpeed`). Start and Watch again send no id: actions use `feed.event_id`, then
  `watch.event_id`. The caps print the keyboard key: Space (play, pause), → (step), 1 to 4 (1x, 2x, 4x, 10x).
- **Toast.** `#toast` keeps the shell's `role` and `aria-live`; it holds a lamp and `.sc-toast-text`. A new toast id
  is a new text node, so the same words twice are announced twice; the words stay once it hides (FI 4.5). It hides
  by opacity only (never `display` or `visibility`), so the live region never leaves the accessibility tree.
- **Connection banner and boot screen.** One `.sr-only` polite line each (`.sc-conn-live`, `.sc-boot-live`) speaks
  when the state or phase changes; the "Retrying in N s" countdown updates on screen without being announced. Retry
  now (`[data-testid="conn-retry"]`, offline only; `[data-testid="boot-retry"]`, failed only) calls
  `actions.retryNow()`. The boot screen has `aria-busy="true"` while loading and hides once ready.
- **Dialogs.** `confirmAction(text)` is `globalThis.confirm(String(text))` behind a promise; no confirm, or one that
  throws, is No.

### 12.3 Hooks a world styles against

Text only; component CSS holds structure and token references. States are classes, data attributes or ARIA states
on markup the components always build.

- **Key caps** (`ui/keycap.js`, shared with A7): `.sc-key` (`button type="button"`, or `a`) > `.sc-key-cap
  [aria-hidden="true"]`, `.sc-key-name`, `.sc-key-value` (the camera mode); `aria-keyshortcuts`, `title`; on is
  `[aria-pressed="true"]` or `[aria-expanded="true"]`. `.sc-lamp` is decorative and always beside words.
  `css/components/masthead.css` holds the shared key and lamp structure; on a touch screen with no hover
  (`(hover: none) and (pointer: coarse)`) the caps step aside, since there is no keyboard to learn.
- **Masthead** (`#rg-masthead`): `.sc-masthead[data-has-game]` > `.sc-masthead-plate` (`h1.sc-masthead-title`,
  `p.sc-masthead-meta` > `#gameLabel.sc-masthead-game`, `#whoLabel.sc-masthead-who`), `.sc-masthead-controls` >
  `.sc-masthead-keys.sc-masthead-game-keys[role="group"]` (`#undoBtn`, `a.sc-key-link[href="/api/export.csv"]`,
  `#resetBtn.sc-key-danger`) and `.sc-masthead-keys.sc-masthead-view-keys[role="group"]` (`[data-testid=
  "camera-mode"][data-camera]`, `[data-testid="booth-toggle"][aria-expanded]`, `[data-testid="scorecard-toggle"]
  [aria-expanded][aria-controls="rg-score"]`).
- **Feed bar** (`#rg-feed`): `.sc-feed[data-feed-state="off|live|retrying"]` > `.sc-feed-controls` (`#feedBtn.sc-key.
  sc-feed-btn[data-feed-state]` with `.on` and `.err`, no `aria-pressed`: its words already say on or off, > `.sc-lamp.
  sc-feed-lamp` + `#feedBtnTxt`;
  `.sc-feed-event` > `label.sc-feed-event-label` + `#feedEvent.sc-feed-event-input`; `#replayBtn.sc-key`;
  `.sc-key.sc-feed-watch[data-watch="start"]`), `#feedStatus.sc-feed-status` (`strong` labels),
  `.sc-feed-bg[data-testid="bg-message"][data-empty]` > `.sc-feed-bg-line`.
- **Transport** (`#rg-transport`): `.sc-transport[data-testid="watch"][data-watch-state][data-active]` >
  `.sc-transport-keys` > `.sc-key.sc-transport-key.sc-transport-<start|play|pause|step|stop|back|again>[data-watch]`,
  `.sc-transport-speeds[role="group"]` > `.sc-key.sc-transport-speed[data-speed][aria-pressed]`,
  `.sc-transport-progress.sc-num[data-testid="watch-progress"]`, `.sc-transport-error[data-testid="watch-error"]` >
  `.sc-lamp` + `.sc-transport-error-text`.
- **Field** (`#rg-field`): `#field.sc-field` (5.3) > `.sc-field-legend[data-testid="field-legend"]` and the engine's
  canvas or SVG (the component CSS makes them fill the host); `.sc-review[data-testid="review"][data-seq]` >
  `.sc-lamp`, `.sc-review-text`, `.sc-review-keys` > `.sc-key.sc-review-key[data-review]`; `.sc-review-live.sr-only`.
- **Toast**: `#toast.toast.sc-toast` (`.show`, `.err`, `[data-tone="info|error"]`) > `.sc-lamp.sc-toast-lamp`,
  `.sc-toast-text`.
- **Connection** (`#rg-conn`): `.sc-conn[data-testid="conn"][data-conn="retrying|offline"]` (fixed across the top) >
  `.sc-lamp`, `.sc-conn-text`, `.sc-key.sc-conn-retry[data-testid="conn-retry"]`.
- **Boot** (`#rg-boot`): `section.sc-boot[data-testid="boot"][data-phase][aria-busy]` > `.sc-boot-board` >
  `.sc-boot-plate` (`.sc-lamp`, `.sc-boot-title`), `h2.sc-boot-heading`, `p.sc-boot-text` (`strong` is the command),
  `.sc-key.sc-boot-retry[data-testid="boot-retry"]`.

### 12.4 Tests

Node: `tests/js/{keycap,masthead,feed-bar,watch-transport,field-host,review-banner,toast,conn-banner,boot-screen,
dialogs}.test.mjs` through `tests/js/chrome-ctx.mjs` (a fake-DOM page with an outsider node no component may touch,
recording actions, the real copy). E2E: `tests/e2e/test_ui_chrome.py` (A9) on the neutral world: #92 to #109, Watch
this game on A11's `watch_server` (start at a picked speed, Space, Right steps exactly one play, 1 to 4, the spoiler
check, Stop restores the pre-watch log, done then Back to my game and Watch again with the stop before the start),
G12 (news from a poll lands in the feed bar's polite region, never a toast), the connection banner (retrying,
offline, back), the boot screen (#119, #120), toasts (#117, #118, #121), the masthead's keys, the field host's hooks,
the review banner, and the chrome at 390 px.

---

## 13. v1.2: the 2D field as built (A6, 2026-10-09)

Additive to 2.5 and 6.2. Where this section is more specific, it is how `field/fallback-2d.js` works.

### 13.1 Files

| File | Kind | Role |
| --- | --- | --- |
| `fallback-2d.js` | DOM | `createFallbackEngine(host, look, opts)`: state, lifecycle, the guarded Engine object; exports `CAMERA_MODES` |
| `fallback-runtime.js` | DOM | plays (animated or instant), situation, ghosts (deferral, after-snap), review, verdicts, relabels, the frame loop |
| `fallback-layers.js` | DOM | draws the state into the layers: field, situation, keyed ghost zones with fades, residue, last play, tags |
| `fallback-player.js` | DOM | one play by progress on a stage, ticked by the engine's frame loop (no clock of its own) |
| `fallback-svg.js` | DOM | specs to SVG (`ui/dom.js` only), tag panels sized to their text, `--sc-field-safe-*`, label declutter |
| `fallback-draw.js` | pure | layout (fit inside the safe area), team paints, the static field, the situation, the ball, HUD-styled tags |
| `fallback-ghosts.js` | pure | the prediction zones in the look's ghost style, with his percentages |
| `fallback-plays.js` | pure | a row's Drawing as parts with partial geometry (`partAt`), carriers, labels, residue rules, trail |
| `fallback-steps.js` | pure | the parts of each step kind (arc, ground, corridor, area, band, mark) |
| `fallback-pixels.js` | pure | the 1-yard turf grid (lit 0.8 yd cells) and the 9 by 9 glyphs every mark is drawn with |
| `fallback-bowl.js` | pure | the stadium around the field, only for looks lit by tower spot lights |

Node tests: `tests/js/fallback-{2d, draw, ghosts, plays, pixels, bowl, svg}.test.mjs` (the engine runs on
`tests/js/fake-dom.mjs` with an injected frame clock).

### 13.2 What it draws

- **One camera, `top`.** The whole field from straight above through `coords.toPlane`, the caller's end zone on the
  left, true proportions, fitted with a 4 yd apron inside the host minus the safe-area insets (ignored when they would
  leave less than 40% of either side). One SVG unit is one CSS pixel; `resize` and an internal ResizeObserver relayout.
- **Height reads as a slight tilt.** A point `h` yards up is drawn `0.45 * h` yards toward the far sideline
  (`OBLIQUE`), so a pass or kick is a true-length arc that bows by its apex while its ground track stays on the turf as
  a dashed shadow; the ball in flight lifts off its shadow and carries a halo. Goal posts are drawn the same way.
- **The field from the look:** `environment.background` ground, `field.surround`, the 6 ft white border, `turf`
  stripes every `stripeYd`, team end zones (`teamPaint` fill; the name or abbreviation per `endZoneText`, ink with the
  alternate as its outline), yard and goal lines, hashes and the try marks when `hashes`, split numerals with their
  arrows when `numerals`, gold posts and orange pylons (the NFL fixture colors the WebGL field uses), the home team's
  logo at midfield (only through `/api/logo/<ABBR>`, only with team end zones).
- **The bowl, only when the look has `spot` lights:** three tiers of stands as superellipse rings rising away from the
  field, a seeded crowd tinted by both teams, the deck fascia, a tower at each spot light (mast, lamp bank aimed at its
  target, glow), and the light pooling on the turf and falling off toward the corners. A look without spot lights (the
  neutral one) stays a plain field: the bowl is the look's lighting rig seen from above, not world code.
- **Situation:** LOS and LTG from `look.lines` (at least 2 px), full width; the LTG hides on goal to go (the goal line
  is the line) and on kickoffs; a down-and-distance tag behind the LOS at the far sideline; the ball (`look.ball.kind`)
  in a ring on the center line.
- **Prediction:** the top three zones from `field/ghosts.js` at `look.ghost.opacity` by rank, in `look.ghost.style`
  (zone, outline, hatch, pixel: every cell of the top call and the outline cells of the others, marker), with his
  percentage (`pct1`) at a lane's tip or inside a band's deep edge. Fades use `look.motion.ghostInMs` and `ghostOutMs`;
  a pixel top call scans in top to bottom in 10 steps. `showGhosts` during a play is deferred (the last call wins); a
  caller snap leaves only the top call at `afterSnapOpacity` until the next set. `highlightGhost(leaf)` lights that
  zone fully and dims the rest to 35%; a leaf outside the top three gets its own zone from `leafZones`.
- **Plays:** every Drawing step. Strokes grow along their paths, lanes grow with the ball, catch areas and marks pop
  in, bands fade in, arrowheads land with their step; timing is `planDrawing` fitted to `durationMs`. Paths follow the
  Light Core Rule (core = the team edge mixed 65% toward the stroke's `core`; the team color on the edge); approximate
  steps take the stroke's `approx` style (dashed, hatch, soft, or pixel cells); ghosted steps take `ghostedOpacity`
  and stay dashed; the penalty walk is dashed line-to-gain yellow. Marks are 9 by 9 glyphs on a small panel: TD, X
  (turnover, missed FG, muff), flag, burst (sack, safety), check (good FG), ring, diamond, square, arrow, bar.
  Possession flips after a turnover mark and after a kick's flight, so returns take the other team's color.
- **What stays:** the last play at full strength, dimmed to `look.lastPlay.dimOpacity` when the next call is up (or
  retired to residue for `until-presnap`); its result word and the verdict chip retire at that moment too (result
  words are transient). Residue per `look.residue.keep` at `look.residue.opacity`, cleared by a new drive for `drive`.
- **Labels** are tags (`.sc-fb-tag` plus `look.labels.className`; ghost labels also `.sc-ghost-label.rank-N`, the
  WebGL engine's classes; the chip `.sc-fb-verdict`) styled with the world's tokens: panel `--sc-surface-2` with a
  `--sc-rule-strong` edge, text `--sc-ink` or a meaning token (`--sc-good`, `--sc-bad`, `--sc-warn`), `--sc-font-text`
  at `--sc-size-xs|s|m` (one step down on fields under 5 px a yard), `--sc-weight-strong`, `--sc-tracking-label`,
  `--sc-case-label`. Colliding tags are moved apart in priority order (the play's words, the down and distance, the
  zones) inside the free area; one with no room is hidden. `look.labels.renderer: "none"` draws no tags;
  `labels.result: false` drops the result word.
- **Review:** `showReview(row, set)` hides the live stage and replays the row with its own ghosts and verdict chip
  (animated unless reduced motion or a hidden tab), `showReview(null)` returns to live. Live plays that arrive
  meanwhile draw instantly into the hidden live stage.

### 13.3 Engine contract details

- `ready` resolves on the first frame after the first `setGameFrame` (a 120 ms timer stands in when no frame comes, as
  in a hidden tab); before that the host already shows a bare field, never a blank one.
- Events: `ready`, `anim` (`{ seq, state }`: playing, idle, reviewing), `camera` (`{ id: "top" }`), `frame` (every
  change and every animation frame; none while idle), `error`. `debugState()` reports `kind "2d"`, `camera "top"`,
  `ghosts` as shown (the top call alone after a snap; the review's own during review) and zero GPU counters.
- `playRow` never rejects: a bad row resolves `completed: false`, is reported and emitted as `error`. `durationMs`
  0, reduced motion, a hidden engine or review draw at once. `dispose` settles a running play with `completed: false`.
- Every other public call is guarded the same way; `opts.onError` (default `globalThis.reportError`) receives errors.
- `opts` may inject `raf`, `cancelRaf`, `now`, `setTimeout`, `clearTimeout`, `getComputedStyle` and `ResizeObserver`
  (node tests); all are called bare.

---

## 14. v1.2: the 3D stage as built (A5 part 1, 2026-10-09)

Additive to 2.5, 6.1 and `docs/design/three-recipe.md`. Where this section is more specific, it is how
`field/scene.js` works. A5 part 2 (`player.js`, `ghost-layer.js`, `overlays.js`, `residue.js`) builds on 14.3 to 14.6;
those sections replace the internal signatures in the 2.5 table (A5-internal, so the package decides).

### 14.1 Files

| File | Kind | Role |
| --- | --- | --- |
| `scene.js` | three.js | `createEngine`, `EngineInitError`: the Engine facade. Timing, tokens, the play promise, ghost deferral, review, moments, events, hooks |
| `stage.js` | three.js | the stage (14.3): renderer rig, scene graph roots, lights, post, field, props, cameras, labels, kit, situation paint; `makeCanvas`, `bindPage` (host size, tab visibility, `<html data-ambient>`), `lookForGame` (the day look) |
| `layers.js` | three.js | `LAYER_FACTORIES` and `createLayers(stage, factories)`: the seam part 2 fills (14.4); part 1's placeholders |
| `renderer.js` | three.js | `createRig`: WebGLRenderer (antialias, HalfFloat output, `setEffects`), its own rAF loop on demand, DPR cap and governor, context loss, `info()` with frame CPU times |
| `lighting.js` | three.js | `buildLighting(look, { renderer })`: lights from `look.lights` (field yards), fitted shadow cameras, background, fog, RoomEnvironment IBL; `exposureFor(look, ambient)`, `ROOM_EV` |
| `post.js` | three.js | `buildPost(renderer, look, { scene, camera, passes, bloom })`: UnrealBloomPass and world passes through `renderer.setEffects` (no EffectComposer, no OutputPass) |
| `field-mesh.js` | three.js | `buildField(look, frame, { doc, maxAnisotropy })`: turf, glyphs (async, `ready`), posts, pylons, plinth |
| `turf.js` | three.js | the turf shader (recipe 4.3) driven by `look.field`; fog only on the far apron |
| `decals.js` | three.js | numeral atlas and merged mesh, wordmark masks, the midfield logo (alpha bleed, ImageData), the field font |
| `structures.js` | three.js | goalposts (merged per material), pylons (instanced), plinth, `neutralProps` (benches, low wall) |
| `lines.js` | three.js | the situation paint: LOS and LTG strips, the spot ring, the ball at rest and its contact shadow, the glide |
| `cameras.js` | three.js | `createCameraRig`: poses from `camera-plan.js`, eased cuts, damped re-aims, follow, shots, the safe-area view offset |
| `materials.js` | three.js | `createKit`: shared materials by key (14.5), `LAYERS` (render order and polygon offset) |
| `shaders.js` | three.js | `turfMarkMaterial(kind)`: grid (the 1-yard pixel cells), hatch, zone; `setOpacity`, `setHatchDpr` |
| `labels.js` | three.js | `createLabels`: css2d, decal, sprite or none; at most 12 live |
| `moments.js` | DOM | the event bus, world moments, `tween` on the render loop |
| `dispose.js` | DOM-free | `disposeTree`, `markShared`, `isShared` |
| `webgl-support.js` | DOM | `hasWebGL2`, `gpuName`, `isSoftwareGpu` |
| `field-spec.js` | pure | NFL dimensions, numeral layout and atlas quads, pylons, wordmark and logo placement, `endZoneTeams`, `wordmarkText` |
| `stage-math.js` | pure | `pickDpr`, `governDpr`, `safeView`, `insetsFrom`, `lerpPose`, `dampPose`, `poseGap`, `bleedAlpha` |
| `engine-state.js` | pure | `hookValues` (the same facts and label as `vm-field.js`, checked against it), `animStateOf`, `ghostLeaves`, `hostAttrs`, `debugRecord` |

### 14.2 The Engine as built

- **`createEngine(host, look, opts)`**, `opts`: `reducedMotion`, `capture` (`preserveDrawingBuffer`), `world` (the
  WorldModule, 14.6), `tier` (`"high"`, or `"low"`: DPR 1, no MSAA, shadows or bloom; the default is `low` on a
  software rasterizer such as the e2e browser's SwiftShader, else `high`), `hooks` (default `false`; `true` makes the
  engine write the 5.3 hooks itself, for a page without the field host), and for node tests only `createStage` and
  `layerFactories`. It adds `canvas[data-testid="field-canvas"]` (aria-hidden) and the label layer
  `div.sc-field-labels` to the host (a `static` host becomes `position: relative`) and draws a bare field at once.
- **Readiness.** `engine.ready` resolves on the first frame after the first real `setGameFrame` whose glyphs are in
  (or after 4 s). `debugState().ready` is the same fact for the latest `setGameFrame`: `false` from the call until
  that frame, while `animState` is `rebuilding`. The field host maps it to `data-scene-ready`.
- **Events:** `ready`; `anim` (`{ state, seq }`, as the 2D engine); `camera` (the mode id); `frame` (the frame count,
  only while drawing); `error` (fatal for this engine: a layer threw while drawing; the conductor swaps in 2D);
  `contextlost`, `contextrestored`; and two extras: `warning` (non-fatal: a world prop, pass, moment or day look
  failed) and `resize` (`{ width, height, dpr }`).
- **`setGameFrame(field, teams, teamOrder, game?)`** finishes a running play, clears every layer, then rebuilds the
  kit's team paints, the field (end zones in the defending teams' exact primaries, their names in
  `--sc-font-display`, the home logo at midfield), the props, and, for `game.light === "day"`, the look with
  `look.world.day` merged over it (`resolveLook`; a bad day look is a warning and night stays).
- **`showSituation(sit)`** paints the LOS, LTG and resting ball (lines.js; the LTG hides on goal to go, a kickoff shows
  only the ball on its tee), calls `overlays.situation(sit)`, re-aims the camera (a glide) and fires the `possession`
  moment when `sit.poss` changes. While reviewing it is stored and applied on return.
- **`showGhosts(set)`** waits while a play runs (the last call wins, `null` included); else `ghosts.show(set)` (or
  `ghosts.clear()` for `null`), the current highlight again, the camera re-aimed to include the shapes (ball-following
  modes ignore them) and the `presnap` moment.
- **`playRow(row, { durationMs, token })`** never rejects. Drawn at once (`player.placeAll([{ row, drawing }])`,
  `completed: true`) when `durationMs <= 0`, under reduced motion, in a hidden tab or when the drawing has no steps.
  Otherwise `plan = fitPlan(planDrawing(drawing, look.motion), durationMs)` and `job = player.start(drawing, plan,
  row)`; a caller row also calls `ghosts.fade(look.ghost.afterSnapOpacity, look.motion.ghostOutMs)` and the `snap`
  moment. Each frame: `job.update(t)` (t clamped to `plan.totalMs`) and `rig.follow(job.ball())`. It resolves
  `{ seq, token, completed: true }` once `t >= plan.totalMs` and `update` returns `false`; the resting ball is then
  placed at `drawing.ballEnd` (hidden when that is `null`: TD, field goal) and shown, and deferred ghosts are shown.
  A row without a numeric `seq`, or a `start` or `update` that throws, resolves `completed: false` (a throw is also an
  `error`).
- **`finishNow()`** calls `job.finish()` and resolves the play at once (`completed: true`); a new `playRow`,
  `setGameFrame`, `showReview(row)`, `setVisible(false)`, `setReducedMotion(true)` and `dispose` all finish first.
- **`drawRowsInstant(rows)`** → `player.placeAll(items)`, every row with a `seq`, in order (rows with nothing to
  draw have a drawing with no steps).
- **`showReview(row, set)`** → `player.review({ row, drawing })`, `ghosts.show(set)`, the paint at
  `situationFromRow(row)`, `animState` `reviewing`; `showReview(null)` → `player.review(null)`, the live ghosts and
  situation. **`refreshLabels(rows)`** → `player.relabel(rows)`, `residue.relabel(rows)`. **`markVerdict(v)`** →
  `player.verdict(v)` and the `verdict` moment.
- **`setCamera(id, { instant })`** eases over `look.cameras.moveMs` with `look.cameras.ease`; cuts for `mode.cut`,
  `instant` or reduced motion; unknown ids are ignored. `cameraModes()` → the look's `{ id, label }`.
- **`resize(w, h)`**: DPR `min(device, 2)`, at most a 4K frame of pixels, stepped down 0.25 (floor 1) when animated
  frames average over 22 ms; the camera view and safe area; labels; hatch pitch. The engine also observes its host,
  the tab's visibility and `<html data-ambient>` itself. **`setAmbient(value)`**: `"room"` lifts the exposure
  `ROOM_EV` (0.5) stops. **`setSafeArea(insets | null)`**: explicit `{ top, right, bottom, left }` px insets, else
  `--sc-field-safe-*` read on every resize.
- **`debugState()`**: the 2.5 fields plus `tier`, `gpu`, `shot` (the active mode, 14.5), `pose` (`position`,
  `target`, `up` in world yards, `fov`), `lens` (`fov`, `aspect`, `view`), `reviewSeq`, `running` (the loop is on),
  `programs`, `cpuMs` (`p50`, `p95`, `max` of the last 120 frames' CPU time: updaters plus draw submission).
- **`dispose()`** finishes the play, unbinds the observers, disposes every layer and the stage (field, props, post,
  lighting, kit, renderer) and removes the canvas; with `hooks` it removes its attributes except `aria-label`.

### 14.3 The stage (every layer receives it)

| Member | What it is |
| --- | --- |
| `THREE`, `coords` | the three.js namespace and `field/coords.js` (`toWorld(x, y, h)`: field yards to world) |
| `look`, `frame` | getters: the resolved Look in force (the day variant when it applies); `{ field, teams, teamOrder, game }` or `null` |
| `scene`, `roots` | the THREE.Scene and one Group per layer, in draw order: `field`, `props`, `residue`, `ghosts`, `situation`, `overlays`, `plays`, `labels` (`ROOTS`) |
| `kit`, `labels`, `cams`, `lines` | the material kit, the label layer, the camera rig and the situation paint (14.5) |
| `requestRender(frames = 1)` | ask for a frame (render on demand: anything async, a hover, a texture load must call it) |
| `keepAlive(fn)` | `fn(dtMs)` runs every frame and returns `true` while it still needs frames; returns its remover |
| `reducedMotion()`, `visible()`, `lights()` | flags; the named lights (`look.lights` ids) |
| `layers` | the four layers, so one may hand work to another (the player to residue) |
| `world`, `emit(event, payload)` | the WorldModule; the engine's event bus (`warning` for a problem that is not fatal) |
| `rig`, `renderer`, `doc`, `host`, `canvas` | the renderer rig (`dpr()`, `size()`, `info()`), the raw WebGLRenderer, the page objects |

### 14.4 Layers: the contract part 2 implements

`field/layers.js` instantiates `LAYER_FACTORIES` once per engine (`residue`, `overlays`, `ghosts`, `player`, in that
order). Part 2 points the table at its modules and changes nothing in `scene.js`.

| Layer | Required | Optional | Called when |
| --- | --- | --- | --- |
| `player` | `start(drawing, plan, row) -> job`, `clear()`, `dispose()` | `placeAll(items)`, `review(item \| null)`, `relabel(rows)`, `verdict(v)` | an animated row; instant rows and rebuilds (`items` = `[{ row, drawing }]`); review; a retag; a verdict |
| job | `update(tMs) -> boolean`, `finish()` | `ball() -> { x, y, h } \| null` (field yards), `dispose()` | every frame of the play; `finishNow`; the follow camera |
| `ghosts` | `show(set)`, `clear()`, `dispose()` | `highlight(leaf \| null)`, `fade(k, ms)` | a new call; no call; hover or focus; a caller snap (`afterSnapOpacity`, `ghostOutMs`) |
| `overlays` | `situation(sit)`, `clear()`, `dispose()` | | every `showSituation` (and review), after the LOS and LTG are painted |
| `residue` | `clear()`, `dispose()` | `add(...)` (the player's to call), `relabel(rows)` | `setGameFrame`; a retag |

Rules:

- A layer adds its objects under `stage.roots.<its name>` and disposes what it owns with `disposeTree`. The kit's
  materials and textures are shared: never dispose or recolor them; fade with `kit.fade(material, k)` (it keeps the
  base opacity in `userData.opacity`, so `fade(m, 1)` restores it) and give a mesh its own material when it needs its
  own color.
- The player owns its jobs: the facade never disposes one. Keep the last play drawn per `look.lastPlay` until the next
  `start`, `placeAll` or `clear`, and hand older plays to residue per `look.residue`.
- The ball: a player that draws its own ball calls `stage.lines.setBallVisible(false)` when its job starts; when the
  job ends the facade places the resting ball at `drawing.ballEnd` and shows it, so the player hides its own ball
  when `update` returns `false` (part 1's placeholder disposes it then).
- `update(tMs)` may return `true` past `plan.totalMs` (a fade after the play): the facade waits for `false`.
- `start` and `update` may throw: the play resolves `completed: false` and the engine emits `error` (the conductor
  then swaps in the 2D field), so throw only for a real fault.
- Part 1's placeholders, replaced by part 2: a player that flies a plain ball along `timing.ballAt` (no strokes),
  ghost zones as flat rectangles in `kit.ghost(rank, family).fill` with the percentage as a label, and empty overlays
  and residue.

### 14.5 Kit, labels, camera rig, situation paint, disposal

- **Kit** (`materials.js`; every result cached and shared; `opts` = `{ ghosted, approx }`):
  `paint(abbr)` (teamPaint against `look.teamColor`); `stroke(role, team, opts)` a path's light core (the team edge
  mixed 65% toward `look.strokes[role].core`), `edge(role, team, opts)` its team-colored edge (a line2 edge is 2.2x
  wider), `fill(role, team, opts)` a ground fill in the team's own color: `role` is `arc ground corridor area band
  mark`, the material follows `look.strokes[role].geometry` (`line2` a LineMaterial in pixels; `tube` a lit
  MeshStandardMaterial; `ribbon` and `decal` a flat material on the turf with polygon offset), `ghosted` uses
  `ghostedOpacity` and mixes the color 60% toward gray, `approx` uses `look.strokes[role].approx` (`dashed`, `soft`
  55%, `hatch`, `pixel` a checkerboard of 1-yard cells); `ghost(rank, family, { team })` `{ fill, stroke }` in
  `look.ghost.style` (`pixel` lit 0.8 yd cells, `hatch`, `zone` feathered, `marker`, `outline` stroke only) at
  `look.ghost.opacity[rank - 1]`; `line("los" | "ltg")`; `ball()` `{ body, accent }`; `texture("radial" | "halo")`;
  `fade`, `setTeams`, `setDpr`, `dispose`. `shaders.js` `turfMarkMaterial(kind, opts)` makes unshared grid, hatch or
  zone materials for per-mesh needs.
- **Render order on the turf** (`LAYERS`, recipe 5.2): `turf 0`, `decal 1`, `ghostZone 2`, `graphic 3`, `line 5`,
  `ring 6`, `shadow 7`, then in the air `trail 8`, `burst 9`, `ghostLine 10`, `ghostHead 11`, `glow 12`; each with its
  polygon offset `factor` and `units`. Coplanar meshes use polygon offset and `depthWrite: false`, never a y lift.
- **Fog:** everything on the field (the kit, paint, lines, posts, pylons) has `fog: false`; the world's haze is for
  the stands, and the turf fades into it only on the apron beyond the border (at blimp distance a 0.0035 FogExp2
  would wash the field about 45%). A layer that wants haze opts in.
- **Labels** (`labels.js`): `add(pt, text, cls = "", { heightYd }) -> handle | null` (`pt` field yards `{ x, y, h }`;
  `handle.move(pt)`, `handle.remove()`), `remove(handle)`, `clear()`, `count()`. At most 12 live: the oldest goes.
  The markup is `<div class="sc-field-label"><span class="{look.labels.className} {cls}">text</span></div>` (text
  only; CSS2D owns the outer transform, so offset the span); `decal` paints the text flat on the turf upright from the
  home camera and `sprite` on a billboard, both in the font and colors the same classes get from the world's CSS.
- **Camera rig** (`stage.cams`): `setMode(id, { instant })` the viewer's mode; `shot(id | null, { instant })` a
  temporary mode over it (the snap's cut to a tight shot, back with `shot(null)`; `mode()` and the `camera` hook stay
  the viewer's, `activeMode()` says what is on); `view({ situation, ghosts, drawing })`; `follow(ball | null)` for
  `follow: "ball"` modes (the facade feeds it from `job.ball()`); `pose()`, `lens()`, `camera`.
- **Situation paint** (`stage.lines`): `set(sit, { instant })`, `setBallVisible(on)`, `placeBall(x | null)`,
  `ballAt()`, `state()`, and `ball` (the resting ball's Group).
- **Disposal** (`dispose.js`): `disposeTree(root, { onError })` frees geometries, materials, textures, render targets
  and CSS2D elements under `root` (each once) and skips anything `markShared` marked; it never throws mid-tree.

### 14.6 World hooks as implemented (2.7)

- **`props(ctx)`**, called at every `setGameFrame`, `ctx` = `{ THREE, coords, field, teams, look, kickoff, light,
  paint(abbr), ambient, requestRender }`; it returns `{ object, update?(dtMs) -> boolean, dispose() }`. `update` runs
  every drawn frame and keeps the loop alive only while it returns `true` (the 0-idle-frames budget: a prop animates
  only while it has something to show). A throw is a `warning`, and the field still draws. A world without props gets
  `neutralProps`: benches between the 30s and a low wall.
- **`moments`**: `presnap(ctx, set)` on a `showGhosts` with a call, `snap(ctx, row)` when an animated caller play
  starts, `verdict(ctx, v)`, `possession(ctx, team)` when the situation's `poss` changes; `ctx` = `{ THREE, scene,
  camera, rig, lights, requestRender, tween(ms, fn), reducedMotion, look, frame }` (`tween` calls `fn(u)` for `u` 0
  to 1 on the render loop and resolves). Never under reduced motion; a throw or a rejection is a `warning`. The light
  dip is `lights[id].intensity` tweened in `presnap` and back in `snap`.
- **`passes`**: each name in `look.post.extra` → `world.passes[name]({ THREE, renderer, scene, camera, look })`, a
  pass with `render(renderer, writeBuffer, readBuffer)`, run after bloom on linear HDR before tone mapping; a missing
  name is a `warning`.
- **`look.world.day`**: a partial Look merged over the look at `setGameFrame` when `game.light === "day"`. It
  re-lights the scene (`lights`, `environment`, `renderer`, `post`) and repaints the field (`field`); the kit's
  strokes, lines, ball, ghost and labels keep the night look's values (they are paint and light, not weather).
- **`warning` events** are not shown to the viewer yet: main.js could pass them to its notice tray (an A0 ask).
- **CSS the engine reads:** `--sc-field-safe-top|right|bottom|left` (px, on `#field` or an ancestor), `--sc-font-display`
  (field numerals and end-zone names, after `document.fonts.load`), `look.labels.className` on labels,
  `<html data-ambient>`.
- **Lighting units:** three's physical lights. White paint should land near 0.85 linear (recipe pitfall 1): with a
  hemisphere light of about 0.9, four corner spots at 34 yd high and about 100 yd from midfield need an intensity of
  about 1.5e4 each (decay 2), aimed across the field with a 0.9 penumbra; closer or brighter and the paint near the
  towers passes the bloom threshold. Fixture colors are engine constants: posts `#ffc425`, pylons and upright ribbons
  `#ff6a13`, pads in the defending team's color.

### 14.7 Budget as measured (headless Chromium, ANGLE Metal, Apple M4 Max; `?debug=1` debugState)

| Scene | Size, DPR | Draw calls | Triangles | Frames during a 4 s play | Engine CPU per frame |
| --- | --- | --- | --- | --- | --- |
| neutral look, drive at DAL 25 with 3 ghosts | 1440x900, 2 | 20 | 3.7k | 60 fps, p95 16.8 ms, none dropped | p50 0.2 ms, max 0.4 |
| night test look (DESIGN.md values; bowl, towers, 20k crowd points, LED ribbon as test props) | 1440x900, 1 and 2 | 36 | 31k | 60 fps, p95 16.7 to 16.8 ms | p50 0.4 ms, max 0.5 |
| the same | 1920x1080, 1 and 2 (8.3 MP) | 37 | 31k | 60 fps, p95 16.7 to 16.8 ms | p50 0.4 ms, max 0.6 |

Idle: 0 frames and 0 `requestAnimationFrame` calls over 2 s, after the first glide and after a 1.1 s camera move.
Memory: after a warm frame, 183 instant rows, plays, ghosts, situations and four more `setGameFrame`s leave
geometries, textures and programs exactly where they were (neutral 21, 10, 17; night 27, 27, 33). Headless frames are
vsync-capped at 60 Hz, so the frame column proves "no hitch", and the CPU column is the headroom.

### 14.8 Found while building

- **r185's `WebGLAnimation` schedules the next frame after its callback returns**, so `setAnimationLoop(null)` from
  inside a frame leaves a `requestAnimationFrame` chain running forever, and every restart adds another (the
  recipe's `stage.js` in 10.1 does this; frame counters never see it). `renderer.js` runs its own chain.
- A ball-following mode framed with the ghosts was pulled back by the full-width pass bands; such modes frame the
  ball only.

### 14.9 Tests

Node (`tests/js`, three.js through `three-env.mjs`): `field-spec`, `stage-math`, `engine-state` (its hooks against
`fieldVm` on the real fixtures), `webgl-support`, `dispose`, `materials`, `cameras`, `lighting`, `lines`,
`field-mesh`, `labels`, `stage-parts` (post, neutral props, the placeholder layers), `stage-host` (day look, canvas,
page bindings, font) and `scene-engine` (the facade on a WebGL-free stage with spy layers: timing, tokens, instant
paths, finishNow, ghost deferral, follow camera, ball hand-off, review, moments, hooks, dispose). The renderer, the
turf shader, canvas glyphs and post-processing are checked in the browser at 1440x900, 1920x1080 and 390x844.
