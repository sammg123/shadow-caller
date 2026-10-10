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

**v1.4 (Under the Lights layout, typography and motion, 2026-10-09, W3).** Additive; details in section 15. The world
loads before W1 lands: `theme/worlds/under-the-lights/index.js` takes W1's `look.js`, `props.js` and `moments.js` when
they exist and a palette-only look on `NEUTRAL_LOOK` until then. `arrange.js` hangs whole regions in the stadium's
fixtures in tab order (ribbon, drawer, bowl, video board, desk, lower ribbon, band, stat board); state moves regions by
CSS alone. HUD insets (surface brief, unresolved #1): `layout.css` registers `--sc-field-safe-top|right|bottom|left` as
`<length>` (`@property`), so the computed values are pixels both engines already read; `hudInsets(read)` /
`readHudInsets(doc)` are the getter, and `#app` dispatches `sc:hud-insets` (detail: the insets) when they change without
a resize. One-line ask (A0, `main.js`): `app.addEventListener("sc:hud-insets", () => rt.engine?.setSafeArea?.(null))`,
so the camera re-reads them at once. Ask (W2, W4, W5): list each new stylesheet in the world's `css` in `index.js`
(a node test fails while a stylesheet in the folder is unlisted).

**v1.4 (play drawing as built, 2026-10-09, field geometry: `paths`, `grammar`, `timing`, `ghosts`, new `play-label`
and `shadows`).** Implements `docs/design/play-drawing.md`; details and the renderer checklist in section 16. The
Drawing shape and the step vocabulary (`arc`, `ground`, `mark`) stay, but every scrimmage play now starts at the line
of scrimmage on the center line: no `snap` step, and paths no longer emits `corridor`, `band` or `area`. New mark roles
`catch` (the catch dot), `incomplete` (the X) and `int`; every mark carries `approx`. A run or scramble is one `ground`
line from the line of scrimmage to the end spot, angled to its gap. `approx` means "drawn as an estimate"; since the
review fixes below a real pass never is (see that note). Additive `drawing.label = { text, at,
approx }` ("Deep pass left · +21", from `play-label.js` `playLabel(row)`), beside the end of the play; `resultLabel` is
kept. `shadows.js`: `buildShadowPlays(source, situation, { count = 2, leafNames, leafOrder, avoid })`,
`shadowForLeaf(leaf, p, situation, rank, { name, leafNames, avoid })`, `shadowCandidates(source, opts)`,
`LEAF_NAMES`, `SHADOW_COUNT`; `ghosts.js` is `@deprecated` and unchanged. `timing.js`: no corridor track, the catch dot
takes 0 ms. `grammar.js` drops the backfield and band constants and adds the label and `SHADOW_*` ones.
`static-rules.test.mjs` lists the two new pure modules; `tests/js/field-rows.mjs` gains `rowBySeq`.

**v1.4 (play drawing, review fixes, 2026-10-09).** Additive except where marked; details in section 16. (1) The real
play draws solid (play-drawing.md 4 and 5): a real pass's arc and its `catch`, `incomplete` and `int` marks are never
`approx` now (changed); its label's depth word carries the estimate and `drawing.label.approx` says so. Only kicks
with an estimated landing, a missed field goal's flight and a loose ball's runback stay `approx`; a no-play stays
`ghosted`. (2) `drawing.label.at` is chosen clear of the play's own strokes as the default cameras show them (an arc
rises up the screen, grammar.js `ARC_SCREEN_LIFTS`): outward first (a kick toward the near sideline), then the other
side, then a line further out. (3) The shared label model lives in `play-label.js`: `LABEL_METRICS`, `LABEL_PX`,
`labelMetrics(project, at, { charPx, linePx, padPx })` (a view's metrics from its projection), `resolveLabelMetrics`,
`labelBox`, `labelFootprint`, `placeLabelText`. (4) `buildShadowPlays` takes `hover` (the hovered play joins the top
2 and every label is laid out against every stroke) and `metrics` (the view's, so css2d text never overlaps in the end
zone camera or on a phone); `avoid` takes the previous play's Drawing (its strokes, marks and words) as well as
labels and ShadowPlays; each ShadowPlay carries `hovered`; a shadow's `drawing.ballStart` is null (changed: the real
ball rests there). `shadowForLeaf` takes `metrics` and marks its result `hovered`. (5) A flag on a play that stands
walks from its enforcement spot (`penalty.at_x`), not the end of the play (changed).

**v1.4 (2D field in Sam's grammar, 2026-10-09, A6).** Details in 13.4. The 2D engine draws
`docs/design/play-drawing.md`: every play from the line of scrimmage (a pass an arc that bows by its whole height,
`fallback-steps` `PASS_LIFT`, kicks keeping the 0.45 tilt; an incompletion an arc ending in an X; a run one straight
line on the turf, grown from the line with the ball at its tip), the catch dot, the INT glyph (the return in the
defense's color: `carriersOf` flips on `int`), and `drawing.label` as the play's words (`[data-part="play-label"]`,
`data-approx`; the verdict chip sits past them, away from the play). Before a caller snap `showGhosts(set)` draws his
top 2 as dashed, translucent shadow plays (`field/shadows.js`, laid out in this view's label metrics with the world's
label font measured) with their words underneath; the hovered play is lit, and drawn when outside the top 2; the
previous play stays dimmed with its words until the next play draws; a play that draws fades the shadows out.
`showGhosts` and `showReview` take the conductor's GhostSet unchanged, ShadowPlays, or `{ source, situation?,
leafNames?, leafOrder? }` (fallback-ghosts `shadowInput`), so the conductor can move off `ghosts.js` with no engine
change. Changed: `debugState().ghosts` (so `#field[data-ghosts]`) lists the shadow plays drawn, his top 2 in rank
order, not 3 zones, and is empty once a play draws; `tests/e2e/test_ui_checklist_field.py` checks that the hook starts
with the top 2 (one assertion, either engine). Removed: the zone, lane, catch-area and band paths (`ghostLayer`,
`ghostFill`, `ghostDefs`, the corridor, area and band builders, the pixel turf-cell helpers, `.sc-fb-scan`).
`refreshLabels` rebuilds the drawing, so a retag renames the play on the field.

**v1.4 (Under the Lights booth controls, 2026-10-09, W4).** Additive; details in section 17. New world module
`theme/worlds/under-the-lights/booth.js`, called by `arrange.js` (one line, after W3's insets watcher): `mountBooth(app)`
fills the drawer's SETTINGS rack with two lamp switches, **Light dip in live games** (`sc:uls:dip-live`, `"on"`/`"off"`,
ON by default) and **Room lights** (`<html data-ambient>` `room`/`dark`), and scrolls the FLAGS rack into view each
time `#flagPanel` appears (X opens the drawer to it). Room lights go to the app first: a cancelable `sc:booth-ambient`
event on `#app` (detail `{ value }`); with no listener the booth writes `<html data-ambient>` through `applyRootAttrs`
and keeps `sc:ambient` itself. One-line ask (A0, `main.js`), so the store's `prefs.ambient` follows:
`app.addEventListener("sc:booth-ambient", (e) => { e.preventDefault(); actions.setAmbient(e.detail.value); })`. For W1's
presnap moment: `dipInLiveGames()`, `dipFor(mode, on)` and `shouldDipNow(doc)` (Watch this game always dips). Booth CSS:
`booth.css` (lamp switches, console pushbuttons, the FLAGS plate in flag yellow, the open drawer as a left HUD inset,
the board kept off the entry line) and four skins in `components/` (entry pad, flag panel, last play, shorthand); the
world's `css` lists them after W2's (`W4_BOOTH` in `index.js`).

**v1.4 (Under the Lights HUD skins, 2026-10-09, W2).** Additive; details in section 18. Seventeen component skins in
`css/worlds/under-the-lights/components/` (listed as `W2_SKINS` in the world's `index.js`, after W3's sheets, the shared
keys and lamps first) and twelve 9 x 9 pixel glyphs in `img/worlds/under-the-lights/` (SVG masks lit by CSS). Two
additive changes in `ui/play-feed.js` (A8): **ribbon paging** (surface brief unresolved #7): when the newest row's words
overflow its own button, it pages whole words at a time, `PAGE_HOLD_MS` (2.4 s) a page, once through, then rests on the
first, writing `--sc-page-x` and `--sc-page-cut` (px) on the button and `data-page`, `data-pages`, `data-page-phase`
(`a`/`b`) on the row; exports `pagesFor(spans, width)` (pure), `createPager({ timers, measure, apply })`, `PAGE_HOLD_MS`;
`ctx.timers` and `ctx.measureRibbon` are test injections; where rows wrap nothing pages. And **`li[data-result]`** on
every play row: `resultKind(word)` gives `td` (any touchdown), `turnover` (INT, FUMBLE, TURNOVER), `flag` or `inc` from
the row's result word, else no attribute. Not built: the board toggle (unresolved #6) needs a `D` intent in A2's keymap
(hover and focus open the board, and a focused play opens it, so keyboard users reach every play); a referee pictogram
on the board after a touchdown or turnover needs a last-result field in `predictionVm` (A3); a `1ST` glyph needs a
first-down field on play rows. Found and fixed in the skins: the open stat board's `#rg-box` and `#rg-log` had 0 px rows
(layout.css's `overflow-x: auto` on those regions made them scroll containers in a fixed-height grid).

**v1.4 (Watch transport and replay scrub, 2026-10-09, W5).** Additive; details in section 19. New component
`ui/scrub.js` (W5) with its pure view model `model/vm-scrub.js` (W5; `scrubVm(pv)`, `describePlay(row)`,
`seqAtFraction(vm, f)`, `stepFrom(vm, delta, { byDrive })`): the game so far as one strip of slots (one per timeline
row; during a watch it runs to `watch.total`, the part not yet played unlit), drawn drives in their team's tone,
scores, turnovers and quarter starts as marks, and a knob on the reviewed play or at the live edge, with ← (Left) and
LIVE (Esc) keys and a readout of the play under the knob or the pointer (`describePlay`, field/play-label.js words).
Review only: it calls `actions.reviewAt(seq)` (null for live), `actions.review(-1)` and `actions.exitReview()`, never
a watch step, pause or restart (3.8). Additive changes outside W5's files: `shell/bindings.js` (A0) mounts it after the
transport in `#rg-transport` (it appends, as the review banner does beside the field) with deps `timeline`,
`anim.drawnThrough`, `view.review` and the watch's state and total (`watchTotalDeps`); `index.html` (A0) links
`css/components/scrub.css` after the transport's sheet (9.4's ask); `model/copy.js` (A3) gains `SCRUB`; the world's
`index.js` (W3) lists `W5_DECK` (`components/watch-transport`, `components/scrub`) after W4's; A0's
`tests/js/shell-bindings.test.mjs` names the new entry, and A11's `test_watch_start_from_the_page` finds Watch this game
with `show()` (it opens the booth, where this world keeps it).

**v1.4 (the action layer as built, 2026-10-09, A5 part 2).** Details in section 20. `field/layers.js`
`LAYER_FACTORIES` now points at `player.js`, `ghost-layer.js`, `overlays.js` and `residue.js` (part 1's placeholders
are gone; `scene.js`'s contract in 14.4 is unchanged). Plays draw per `docs/design/play-drawing.md` from the parts of
the new pure `field/play-style.js` (strokes as continuous strips, `play-strip.js`, so a translucent stroke has no beads
at its joints). Changed: `debugState().ghosts`, so `#field[data-ghosts]`, is what the 2D field reports since A6's v1.4
note: the shadow plays drawn, his top 2 in rank order (a hovered play outside them aside), empty once the ball is
snapped (`scene.js` reads `layers.ghosts.shown()`, else the call's leaves). `showGhosts` and `showReview` take a
GhostSet, ShadowPlays or `{ source, situation?, leafNames?, leafOrder?, key? }`, as A6's engine does
(`play-style.shadowInputOf`). Additive: the camera rig's `goalPose()` (`cameras.js`): the pose it is settling on, which
the shadows' text is laid out for (it waits until the camera is within 1.5 yd of it). New optional Look group
`look.world.plays` (20.4). Field labels are styled in `components/field-host.css` (A9's file, additive, tokens only):
`.sc-field-label > span` plates, `.sc-play-label` (`.is-dim`; `.is-approx` is left to the world, as the words
already say how sure they are, play-drawing.md 5), `.sc-shadow-label` (`.rank-N`,
`.is-hovered`, `.is-muted`), `.sc-verdict-chip` (`.is-top1|top3|miss`).

**v1.4 (Under the Lights scene look as built, 2026-10-09, W1).** Details in section 21. W1's `look.js`, `props.js`,
`moments.js`, `stadium/*.js` and `shaders/*.js` under `theme/worlds/under-the-lights/` (index.js picks them up unchanged;
`LOOK_SOURCE` is now `"w1"`). Additive changes outside W1's folder, each one or two lines and tested: `field/scene.js`
(A5) calls two new world moments, `play(ctx, row, { durationMs })` when any animated play starts and
`landed(ctx, row, { completed })` when it ends (never for instant draws, never under reduced motion);
`core/timeline-cache.js` keeps the timeline's `game` (sent with `since=0`) as `cache.game`, and `core/conductor.js`
(A1) passes it as `setGameFrame`'s 4th argument, so day kickoffs light by day (A1's ask in 13 and 14); `main.js` (A0)
carries W3's one-line ask: `#app` `sc:hud-insets` calls `engine.setSafeArea(null)`.

**v1.4 (integration, 2026-10-09, W6).** Details in section 22. Under the Lights is the default world (`?world=neutral`
still opens neutral); `static/index.html` opens with `docs/design/direction-contract.md`, word for word, as its first
comment, and links an SVG favicon (no console 404). Decisions taken under `docs/design/play-drawing.md`: at the snap
the shadow plays fade out completely on both engines (`ghost.afterSnapOpacity: 0` in both shipped looks; changed);
`#field[data-ghosts]` is exactly his top 2 on both engines; a kick on display dims further under the next call
(new optional `look.world.plays.kickDim`, `play-style.dimOpacityOf`); a watch step draws its play at the play's own
pace (`actions` ticks it with origin `poll`, not the 800 ms of a typed row; changed). Under the Lights: the shorthand
bar steps off the stadium desk during a watch, the ribbons and the video board unroll on hover or keyboard focus
(`:has(:focus-visible)`, so a mouse click no longer leaves one open over the other), the drawer's rails run by
`translate`. Additive: `debugState().ball`; `main.js` carries W4's `sc:booth-ambient` line. Tests: the e2e checklist
runs on either world (`SC_E2E_WORLD`), with world-aware helpers in `ui_helpers.py`; a new
`tests/e2e/test_ui_world_under-the-lights.py` and golden screenshots under `tests/e2e/goldens/under-the-lights/`.

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
  img/favicon.svg                    W6  v1.4: the page's icon (22.1)
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
      vm-scrub.js                                                           W5  pure (v1.4: the replay scrub's view model, 19)
    field/
      coords.js grammar.js paths.js ghosts.js timing.js camera-plan.js      A4  pure
      play-label.js shadows.js                                               A4  pure (v1.4: play-drawing.md, 16)
      scene.js renderer.js lighting.js post.js field-mesh.js cameras.js
      materials.js player.js ghost-layer.js overlays.js residue.js
      labels.js dispose.js webgl-support.js                                  A5  three.js
      stage.js layers.js moments.js lines.js turf.js decals.js structures.js
      shaders.js                                                             A5  three.js (v1.2: the stage's parts, 14.1)
      field-spec.js stage-math.js engine-state.js                            A5  pure (v1.2, 14.1)
      play-art.js play-strip.js play-ball.js play-glyphs.js                  A5  three.js (v1.4: the action layer's parts, 20)
      play-style.js                                                          A5  pure (v1.4: how a play looks, 20)
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
      worlds/under-the-lights/stadium/*.js                                  W1  v1.4: the bowl's parts (21.1)
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
  e2e/test_ui_world_under-the-lights.py uls_scenes.py   W6  v1.4: Sam's world end to end, its scenes (22.5)
  e2e/goldens/under-the-lights/*.png  W6  v1.4: golden screenshots, GPU renders (22.5)
  js/index-html.test.mjs             W6  v1.4: the page opens with the direction contract; the default world
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
- `nextJob`: `null` while playing or when empty. Instant items → `{instant: true, durationMs: 0}`. Otherwise `normal = normalMs(seq)`; when `watch.state === "playing"` and `0 < watch.next_at - now < 60000`, `durationMs = min(normal, BUDGET_SHARE * (watch.next_at - now) / queue.length)` (DC E4, with the budget shared across queued rows); origin `action` caps at `OWN_ACTION_MAX_MS`; a result under `MIN_ANIM_MS` becomes instant. `next_at` outside that window is ignored (clock skew guard; server and browser share a clock on localhost). v1.4 (G1-1, section 23): before a caller snap (`watch.next_kind === "caller_snap"`) the play also leaves the next call its reserve, and a watch object older than the head row holds the play for the next poll.

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
| Context loss | `webglcontextlost`: `preventDefault`, switch to the fallback; `webglcontextrestored`: rebuild the WebGL engine from the store. As built (v1.4, G2-4): a lost context is a pause, not a failure: the conductor swaps in the 2D field and disposes the WebGL engine, and the canvas keeps one listener for the browser's restore, so `contextrestored` brings a fresh WebGL field back (`conductor.contextLost`, `scene.js`). It is only as good as the browser's restore, which a sleep and wake usually gives and an HDMI hot-plug may not: re-check on the TV before a demo. | `renderer.js`, conductor |
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

> v1.4 (A6, 2026-10-09): Sam's grammar replaces the prediction zones, lanes, catch areas, bands and result words
> below; 13.4 is the 2D field as it now draws.

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

### 13.4 v1.4: Sam's grammar on the 2D field (A6, 2026-10-09)

Binding source: `docs/design/play-drawing.md`; the pure geometry is section 16, unchanged.

- **Files.** `fallback-steps.js`: arc, ground, mark only; `PASS_LIFT` (1), `liftOf(step)`, `shownHeight(step, h)`.
  `fallback-plays.js`: `toneOfLabel(text)`, `shownBall(drawing, plan, tMs)`. `fallback-ghosts.js` (the shadow plays):
  `shadowInput(set, situation)`, `shownLeaves(request)`, `viewMetrics(ctx, ballX, labelPx)`, `shadowPlaysFor(request,
  ctx, { hover, avoid, labelPx })`, `shadowPaint(ctx, team)`, `shadowLayer(shadows, ctx)`, `SHADOW_HOVER_OPACITY`.
  `fallback-pixels.js`: the glyphs only, `glyphCols(name)`, a lettered `int`. `fallback-svg.js`: `STAGE_LAYERS`,
  `REVIEW_LAYERS`, `spreadBoxes` also returns `dx`. `fallback-draw.js`: `TAG_PAD`.
- **Plays.** A pass is a true-length arc that bows by its apex times `PASS_LIFT` (kicks keep `OBLIQUE`, 0.45), its ground
  track dashed under it; the ball and its trail ride the arc as drawn (`shownBall`). An incompletion ends in an X (two
  strokes in the throw's edge and light core); a completion has a catch dot (radius 3.5 to 6 px), then the YAC; an
  interception the INT glyph (bad tone), then the return in the defense's color. INT and TD sit beside their spot like
  a badge, on the side away from the words, so the end of the play stays in view. A run, scramble, sack, kneel, YAC,
  return or penalty walk is one straight line with an arrowhead (a run for no gain is a dot at the line); kicks are
  unchanged. Each stroke grows with the ball at its tip (the step's easing: a run slows into the tackle).
- **Words.** `drawing.label` at its spot (`tagSize` s), toned bad for a turnover, block, miss or safety and warn for a
  no-play or a flag, `data-approx` when the spot is an estimate; `labels.result: false` or `renderer: "none"` hides them.
  The verdict chip sits 24 px past them on the far side from the end of the play (paths.js's anchor, `resultLabel.at`).
  They fade in when the play lands; while the next call is up they stay at
  65% with the play at `lastPlay.dimOpacity` (an `until-presnap` look still retires it). Residue stays a look setting
  (DESIGN.md: the drive's earlier plays at 20%).
- **Shadow plays.** `buildShadowPlays(source, situation, { hover, avoid: [the previous play's drawing], metrics })` with
  this view's metrics (`labelMetrics` over `ctx.pt`, lifts `[OBLIQUE, PASS_LIFT]`, the label font measured on a hidden
  probe tag; `LABEL_PX` where nothing is laid out). Each is `g.sc-fb-shadow[data-leaf][data-rank][data-hovered]`, its
  parts `[data-stroke]`, every stroke dashed edge and core alike, square-ended (`look.ghost.style` picks the dash),
  tinted by `look.ghost.fill` (team, the field's paint or a color, with a darker edge), at 50% and 35%; the hovered one
  85%, the rest 60% of theirs. They grow out of the line of scrimmage (`.sc-fb-grow`, `ghostInMs`) and fade out when a
  play draws (`ghostOutMs`). Words: `[data-part="shadow-label"].sc-ghost-label.rank-N.sc-fb-shadow-label[data-leaf]
  [data-hovered]` on a dashed plate, 75% while another play is hovered. Live they draw over the ball they come out of;
  in review under the play that happened (`REVIEW_LAYERS`), beside its words and verdict.
- **Hooks.** `debugState().ghosts` is `shownLeaves(request)`: his top 2 in rank order (a hovered extra aside), empty once
  a play draws or with no request; `highlight` as before. `declutter` slides a tag inside the free area's sides before
  spreading tags vertically, so long words near an end zone stay on screen.

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

---

## 15. v1.4: Under the Lights layout, typography and motion as built (W3, 2026-10-09)

Additive to 2.7, 5.2, 8.2 and 9.4; DESIGN.md (Layout, Typography, Motion grammar) is the source. Where this section is
more specific, it is how the world's files work.

### 15.1 Files

| File | Role |
| --- | --- |
| `theme/worlds/under-the-lights/index.js` | The WorldModule: id, label, look (W1's `look.js` export `look`, `LOOK` or `default`; else `FALLBACK_LOOK.partial`: night-sky clear and background, bowl-haze fog, DESIGN.md turf and paint, LOS `#4a90ff` and LTG `#ffd400` at 0.4 yd, team colors checked against turf and night), W1's `props` and `moments` when their files exist, `css`, `fonts`, `arrange`, `booth: { holds: ["feed", "situation", "flags"] }`, `ambient: "dark"`. A W1 file that is missing is skipped quietly; one that throws is reported (`reportError`) and skipped. Named exports: `LOOK_SOURCE` (`"w1"` or `"fallback"`), `FALLBACK_LOOK`, `hudInsets`, `readHudInsets`, `INSET_EVENT`, `LAYOUT_ID` |
| `theme/worlds/under-the-lights/arrange.js` | `PLAN` (the fixtures in DOM order), `regionOrder`, `arrange(app, regions)` (idempotent; sets `#app[data-layout="uls"]`), `hudInsets`, `readHudInsets`, `watchInsets` |
| `css/worlds/under-the-lights/tokens.css` | Every required token (DESIGN.md token map), the `--uls-*` palette, type roles, geometry and LED face, the four `@font-face` rules (with the "ULS LED Punct" patch: Big Shoulders Display for U+002E and U+003A), phone sizes, reduced-motion zeros |
| `css/worlds/under-the-lights/layout.css` | The fixtures, their states, the registered HUD insets, the phone column |
| `css/worlds/under-the-lights/motion.css` | `--uls-step` (`steps(5, jump-end)`, 415 ms), `--uls-scan` (`steps(10, jump-end)`, 400 ms), `--uls-segment-snap` (0 ms), `--uls-blink-ms`, `--uls-rail-ms` (240 ms), `--uls-dip-ms` / `--uls-dip-level` (300 ms, 0.8, for W1's moments), keyframes `uls-step-in`, `uls-scan-down-a|b`, `uls-scan-up`, `uls-rails-in`, `uls-blink`, and where the HUD uses them; all off under reduced motion |
| `fonts/under-the-lights/` | `big-shoulders-display/` (wght 700 to 800), `big-shoulders-text/` (500 to 800), `doto/` (static wght 800, ROND 60): latin woff2 from the Google Fonts CSS2 API, each beside its `OFL.txt`; `SOURCES.txt` has URLs, sizes and SHA-256 |

### 15.2 Fixtures (`PLAN`, DOM order = tab order)

| Fixture (`div`, `data-fixture`) | Regions | Stadium box, 1440x900 / 1920x1080 | z |
| --- | --- | --- | --- |
| `.uls-ribbon` | `plays`, `masthead` | 0, 0, full width x 44 / 56: nameplate, play message, masthead keys, feed lamp | 20 |
| `.uls-drawer` (racks `[data-rack="feed|situation|flags|settings"]`, `role="group"`, plates `.uls-plate#uls-plate-<rack>`) | `feed`, `situation`, `flags`; `settings` has an empty `.uls-rack-body` for the booth | closed: `display: contents`; open: x 0, from the HUD top to the band, 400 / 520 wide | 40 |
| `#rg-field` (bare) | `field` | fixed, full viewport | 0 |
| `.uls-board` | `call` | right 24 / 48, top = HUD top + 20 / 24, 416 x 324 / 560 x 430; open 600 x 560 / 800 x 746 | 11, open 35 |
| `.uls-desk` | `transport` (watch mode only), `entry` | under the board, same width, down to 16 px above the lower ribbon; scrolls, entry line sticky | 10 |
| `.uls-lower` | `drives`, `wp` (264 / 352 wide) | 40 / 56 tall, 4 px above the band | 10 |
| `.uls-band` | `scoreboard` (row one) | bottom, full width x 140 / 180 | 10 |
| `.uls-statboard` | `score`, `tendencies`, `box`, `log` | closed: `display: contents`, its `score` region is the band's row two (z 12); open: the free area (24 to 984 x 64 to 700 at 1440) | 30 |

The ribbon reads nameplate, play message, masthead keys, feed lamp: the masthead stays one element and lends its plate
and its keys to the ribbon's grid (`display: contents`), and the play feed comes first in the DOM so Tab meets the
plays, the keys and the feed in their visual order (the plate holds no control). DESIGN.md's order had the feed lamp
before the keys; the swap keeps the tab order equal to the visual order.

### 15.3 State, by CSS alone (selectors on `#app[data-layout="uls"]`)

- **Manual entry** (`[data-mode="normal"|"flag"]`): `#rg-situation` is the 52 / 64 px strip under the ribbon, and
  `--uls-hud-top` (so the board, desk, drawer, stat board and the top inset) moves down by it. Feed or watch: the
  strip lives in the open drawer's SITUATION rack.
- **Drawer closed** (`[data-booth-open]` not `"true"`): `#rg-feed` shows compact at the ribbon's right end (the feed key
  with its lamp, the status line; the id box, Replay, Watch and the background message wait for the drawer), plates,
  `#rg-flags` and the settings body are hidden. **Open:** a steel rack, racks under plates, FLAGS only while
  `#flagPanel` is shown, SETTINGS only once its body has content; it runs out on rails (`uls-rails-in`).
- **Stat board** (`[data-scorecard-open="true"]`): the score region moves from the band to the board at full size,
  with tendencies, box and log; the night scrim covers only the bowl's free area (`#field::after`).
- **Ribbons hold one message**: the play feed shows `[data-newest="true"]` and unrolls on `:hover` / `:focus-within`
  into a replay board under itself; the drive chart shows the current drive (else the last) and unrolls upward, clear
  of the board column.
- **Video board**: grows from its top-right corner, at once, on `:hover`, `:focus-within` and for
  `#app[data-board-open="true"]` (a future D key, v1.2 ask 5).
- **Band row two**: the SHADOW V LEAGUE plate (`.sc-card-sub`) and exactly `called_right`, `top3`, `passrun_logloss`.
  With no team colors (`--sc-team-off` is the neutral team gray), the band is neutral scoreboard steel (a style
  container query; elsewhere the gray shows).
- **Phone, tablet and small or short windows** (below 1200 x 640): one scrolling column in DOM order, plate first;
  the masthead keys scroll sideways inside their row; the field is a 13 / 10 band (390 x 300 at 390); the open drawer
  and stat board stay in the flow (DESIGN.md's full-screen sheets would cover the B and G keys, the only way to close
  them without a keyboard). The insets are 0.

### 15.4 HUD insets (surface brief, unresolved #1)

- **CSS:** `@property --sc-field-safe-top|right|bottom|left { syntax: "<length>"; inherits: true; initial-value: 0px }`,
  set on `#app[data-layout="uls"]`: top = `--uls-hud-top` (44 / 56, plus the strip in manual entry), right =
  gutter + board width + 16 (456 / 624), bottom = lower ribbon + 4 + band (184 / 240), left 0; all 0 in the phone
  column. Registered, they compute to pixels, which is what `stage.js` and `fallback-svg.js` parse.
- **JS:** `hudInsets(read)` (pure: `read(name)` returns a computed value; non-px or negative reads 0) and
  `readHudInsets(doc)` (`getComputedStyle(#field)`, zeros without a window), both exported by `arrange.js` and
  `index.js`; the world object also carries `hudInsets()` (dropped by `checkWorld` today; A10 may pass it through).
- **Event:** `arrange` starts one watcher per `#app` (MutationObserver on `data-mode`, `data-booth-open`,
  `data-scorecard-open`, plus window `resize`) and dispatches `sc:hud-insets` (`bubbles`, detail
  `{ top, right, bottom, left }`) on `#app` only when the values change. Engines read the properties on every resize
  already; the mode change that adds or removes the strip needs the A0 line in v1.4 (`setSafeArea(null)` re-reads them).

### 15.5 For the component skins (W2, W4, W5)

- Load order: the world's `css` list is W3's three sheets, then each component skin as it lands (add its href in
  `index.js`; `tests/js/uls-world.test.mjs` fails while a stylesheet in the folder is unlisted or a listed one is
  missing).
- Inside a fixture, layout.css removes a component's neutral panel chrome (border, radius, background) and fits a
  region to its slot (one-line ribbon message, compact feed, one-row strip, band row two, the WP readout and line)
  with `:where(<fixture>) <component selector>`, the component's own specificity: a later skin wins on equal terms.
  The compact visibility rules (which row, which drive, which pairs) carry the region id; override them with the same.
- World type roles for skins: `--uls-led-font` (with `font-variation-settings: var(--uls-led-variation)`; Doto only at
  `--sc-size-call`, `--sc-size-xl` or `--uls-size-led-readout`, 40 px and up), `--uls-size-caption`, `--uls-size-plate`,
  `--uls-size-key`, `--uls-size-ribbon`, `--uls-size-body`, tracking `--uls-tracking-caption|plate|ribbon`, the LED face
  `--uls-led-face`, geometry `--uls-ribbon-h`, `--uls-lower-h`, `--uls-band-h`, `--uls-strip-h`, `--uls-plate-h`,
  `--uls-key-h`, `--uls-lamp`, `--uls-face-pad`. `--sc-logo-variant: dark` is set for the world (LED windows use ESPN's
  dark logos in both room settings).

### 15.6 Tests

Node: `tests/js/uls-arrange.test.mjs` (the plan places every region once, tab order, fixtures and racks, ids kept,
idempotent, missing regions, no window; `hudInsets`, `readHudInsets`, the watcher's change-only events and stop) and
`tests/js/uls-world.test.mjs` (`checkWorld`, the look either way, the stylesheet list against the folder, real woff2
with OFL, `tokenProblems` empty, DESIGN.md values, 4.5:1 text on every HUD surface, reduced-motion zeros, the punct
patch, the Flat Hardware Rule, registered insets, LED steps and scans, Doto at 40 px and up). Browser: Playwright at
1440x900, 1920x1080 and 390x844 on `?world=under-the-lights` (manual drive, finished game, feed on, watch, drawer, flag
panel, stat board, unrolled ribbons, expanded board).

## 16. v1.4: play drawing as built (field geometry, 2026-10-09; review fixes the same day)

Binding source: `docs/design/play-drawing.md`. Everything here is pure (`static/js/field/`), node-tested, and the 2D
and 3D renderers consume it unchanged in shape; section 16.5 lists what they adapt.

### 16.1 Drawing (`paths.js`)

```ts
type Step = (
  | { t: "arc",    role: "pass" | "punt" | "kickoff" | "fg", from: Pt, to: Pt, apex: number, endH: number, approx: boolean }
  | { t: "ground", role: "run" | "scramble" | "kneel" | "sack" | "yac" | "return" | "march" | "hold", from: Pt, to: Pt,
      approx: boolean }
  | { t: "mark",   role: "catch" | "incomplete" | "int" | "td" | "turnover" | "flag" | "sack" | "safety" | "fg_good"
      | "fg_miss" | "touchback" | "fair_catch" | "downed" | "oob" | "muffed" | "blocked", at: Pt, approx: boolean }
) & { ghosted: boolean }
type Drawing = { seq, id, kind, team, dir, offenseIsCaller, ghosted, steps: Step[], ballStart: Pt | null,
  ballEnd: Pt | null, resultLabel: { at: Pt, text: string } | null,      // the play feed's word, at the action's end
  label: { text: string, at: Pt, approx: boolean } | null,               // v1.4: the words drawn on the field
  bounds: { x0, x1, y0, y1, h } | null }
```

| Row | Steps (from the line of scrimmage `(x0, 26.667)`) |
| --- | --- |
| completion | `arc pass` → `(x_catch, side lane)`, `mark catch`, `ground yac` → `(x_end, same lane)` when he gained after the catch |
| incompletion | `arc pass` → the target, `mark incomplete`: `x_catch` (ESPN's estimate), else the air yards, else the depth word's median (`AIR_DEPTH_YD`), else 5; kept 1 yd inside the end line; the ball goes back to `x0` |
| interception | `arc pass` → `(x_catch, lane)`, `mark int`, `ground return` → `x_end` (none when he went down where he caught it) |
| run, scramble | one `ground run` / `ground scramble` → `(x_end, gap lane)`; a no-gain run up the middle has zero length |
| sack | `ground sack` → `x_end`, `mark sack` |
| kneel, other / spike | `ground kneel` → `x_end` when the ball moved / no steps |
| TD, safety, lost fumble | `mark td` at the end; `mark safety`; `mark turnover` then the defense's `ground return` (approx) |
| no play | the same steps with `ghosted: true`, `mark flag` at the enforcement spot, `ground march` `x0` → `x_next` |
| penalty, no snap | `mark flag`, `ground march` |
| flag on a play that stands | the play, `mark flag` at `penalty.at_x`, `ground march` from there (else from the end of the play) to `x_next` |
| kicks | unchanged; a field goal keeps its `hold` step, since the kick's true length starts at the hold |

Lanes: pass side `LATERAL_PASS` (left / middle / right = 12 / 0 / -12 yd toward the offense's left), run gap
`LATERAL_GAP`, a typed run's leaf `runLateralOfLeaf`. `approx` means "drawn as an estimate" (the look's approx
style). A real pass never is: the real play draws solid (play-drawing.md 4) and its words carry the estimate (5), so a
pass arc and its `catch`, `incomplete` and `int` marks are `approx: false` even when `x_catch` is ESPN's estimate. Only
a kick landing with no `land_x`, a missed field goal's flight and a loose ball's runback are `approx`; a no-play's
action is `ghosted` (dimmed and dashed).
`label.at`: candidates beside the end of the play (an incompletion's X, a no-play's flag, a field goal's posts),
`LABEL_GAP_YD` (5) outward from the center line first (a play ending on it toward the far side; a kick toward the
near side), then the other side, then 3.5 and 7 yd further out each way, never within 5 yd of the center line; the
first whose box (`LABEL_METRICS`) is clear of the play's own `labelFootprint` (its lines; each arc's flight lifted up
the screen by `ARC_SCREEN_LIFTS` 2 to 3.1, the cameras that show plays by default; its marks as glyphs) and of both
balls wins. Every TB at DAL label lands 5 yd from its play. `label.approx`: the spot the words describe is an
estimate (an incompletion's target or a returnless interception at an estimated spot; a loose ball's runback).

### 16.2 Labels (`play-label.js`)

`playLabel(row) -> string` (`""` for admin rows): `<what it was> · <result>` with `LABEL_SEP` (" · ") and the true minus
`MINUS` (U+2212); `signedYards(n)` gives "+8", "−11", "no gain". Every example in play-drawing.md 3 is a test on its real
row. Pass words: ESPN's depth word (`call.depth`) and side (`geo.lat`); run words: `geo.gap` ("Inside run (left
guard)", "Off-tackle left", "Outside run right"); typed rows: the leaf ("Inside run", "Play-action short pass",
"Intermediate pass"); a retag on the caller's play wins for the play type (`pred.family` and `pred.leaf`: "Play-action
deep pass left", "Screen", "RPO handoff", "RPO throw"). Results: yards, "incomplete", "TD", "INT" (picked screens and RPO
throws), "fumble lost", "safety", "returned for TD"; interceptions read "Pass intercepted · short middle". Kicks: "Punt ·
53 yds · out of bounds", "FG 41 yds · good | no good | blocked", "Kickoff · touchback | return to DAL 30 | fumble lost".
Flags: "No play · defensive offside on TB", "Flag · false start on TB · −5", and a flag on a play that stands appends
"flag: face mask on DAL".

The label model (paths.js and shadows.js lay every field label out with it):

```ts
type LabelMetrics = { charYd: number, lineYd: number, padYd: number,   // one character, one line, the plate's padding
  down: { x: 0, y: ±1 } | { x: ±1, y: 0 },                            // the field axis pointing down the screen
  lifts: number[] }                                                   // yards of `down` a yard of height reads as
const LABEL_METRICS: LabelMetrics      // { 0.8, 3.5, 0, { x: 0, y: -1 }, ARC_SCREEN_LIFTS }: the default cameras
const LABEL_PX = { char: 7.2, line: 26, pad: 12 }   // a 22 px plate of 14 px text, 4 px between stacked plates
function labelMetrics(project: (p: { x, y, h }) => { x, y } /* canvas px, y down */, at: Pt,
  px?: { charPx?, linePx?, padPx? }): Readonly<LabelMetrics>         // LABEL_METRICS when the view is degenerate
function resolveLabelMetrics(m): LabelMetrics                       // every field checked, defaults for bad ones
function labelBox(label: { text, at }, m?): { u, v, hw, hh }         // along the text, down the screen, half sizes
function labelFootprint(steps: Step[], m?): Pt[]   // lines, arcs lifted per `lifts` (a range), marks as glyphs
function placeLabelText(text, candidates: Pt[], { boxes?, points?, metrics?, strict? }): Pt | null
```

`placeLabelText` takes the first candidate whose box is clear of `boxes` and `points` (each slid along its text to stay
whole on the field); with none clear, `null` when `strict`, else the first clear of the other text, else the first.
Footprint points sit at most a third of a line apart, so no box slips between two samples of a steep arc.

### 16.3 Shadow plays (`shadows.js`)

```ts
type ShadowPlay = { rank: number | null, leaf: string, family: string, p: number, name: string, key: string,
  stack: number,                                                 // earlier shadows with the very same shape
  hovered: boolean,                                              // the play the prediction panel hovers or focuses
  label: { text: string, at: Pt, approx: true },                 // "1 · Deep shot (20+) · 31%"
  drawing: Drawing & { kind: "shadow", dashed: true, opacity: number,   // steps carry dashed: true and opacity too
                       seq: null, id: "shadow:<leaf>", ballStart: null, ballEnd: null, resultLabel: null } }
function buildShadowPlays(source, situation, opts?: { count?: number /* 2 */, leafNames?, leafOrder?,
  avoid?: Array<Drawing | ShadowPlay | { text, at }>, hover?: string | null, metrics?: LabelMetrics })
  : ReadonlyArray<ShadowPlay>                                    // [] without a snap situation or usable odds
function shadowForLeaf(leaf, p, situation, rank, opts?: { name?, leafNames?, avoid?, metrics? }): ShadowPlay | null
function shadowCandidates(source, opts?: { leafNames?, leafOrder? }): ReadonlyArray<{ leaf, p, rank, name }>
```

`source` is `/api/state` `prediction` (`top` order, then `families`), a row's `pred` (`top3`, odds from `dist.his_l` in
`leafOrder`), or a field view model's ghost input (`{ leaves }`). Names come from the source, else `leafNames`, else
`LEAF_NAMES` (the engine's names, pinned to the timeline meta by a test). Geometry (play-drawing.md 4): passes and
play-action to the middle lane at 6 / 14 / 25 air yards, `rpo_throw` 6; runs and `rpo_run` a line 4 yd downfield ending
0 / ±4 / ±9 yd wide; the screen an arc 1 yd behind the line and 10 yd toward the near sideline; everything kept 1 yd
inside the end line. A shadow whose arc matches an earlier one exactly (play-action short and dropback short) flies
`SHADOW_STACK_LIFT` (60%) higher per match, so both stay visible; lengths and lanes stay true. Opacity 0.5 for #1 and
0.35 for the rest (a hovered play included).
`hover`: a leaf outside the top `count` joins them (its own rank, `hovered: true`); a top play that is hovered is only
marked. Strokes are laid out first, so every label knows every stroke: a top play's text steps down a line to clear a
hovered stroke (126 of the game's 708 hovers), so place labels from each result.
Text sits underneath its shadow (a gap below its lowest point, centered on it, in the view `metrics`) and takes the
first line down (then up) clear of every label, every shadow stroke, the ball and everything in `avoid`. Within the
first three lines it may sit over the previous play's dimmed strokes (never over text, a shadow or a mark) rather than
drift toward the sideline (5 of the 59 Dallas snaps). Percentages round as the prediction panel shows them: `pct` for
the top line's three, `pct1` beyond.

### 16.4 Timing (`timing.js`)

No snap phase: the first step leaves the line of scrimmage at t = 0. Tracks are `arc`, `line` or `still` (no `path`).
A `catch` mark takes 0 ms, so the YAC grows the moment the arc lands; an `incomplete` X pops in over `markMs` where the
arc lands; run lines ease out (slow into the tackle); `hold` and `march` ease in and out. Rows still fit 2 to 4 s at 1x
and `fitPlan` is unchanged. A shadow's `drawing` plans like any drawing (it has no `ballStart`; `ballAt` gives null
before its stroke starts).

### 16.5 What the renderers adapt (A5 part 2, A6, the conductor and `vm-field`)

- Draw `drawing.label` (text at `at`, above every stroke) instead of the `resultLabel` word.
- Dash a step when it is `ghosted` or a shadow's (`dashed: true`); give `approx` steps the look's approx style. A real
  pass is never `approx` now, so the incompletion's arc and X draw solid with no renderer change.
- New marks: `catch` (a small dot), `incomplete` (an X), `int` (INT). The 2D fallback draws unknown roles as a square
  today (`fallback-steps.js` `MARKS`), and `fallback-plays.carriersOf` flips possession only on `turnover`, so the INT
  return still takes the offense's color until `int` flips it too. `corridor`, `band` and `area` builders are dead code.
- A no-gain run is a zero-length `ground` line at the line of scrimmage: draw a dot or nothing (the label says "no gain").
- Before a caller snap: `buildShadowPlays(ghostInput | prediction | pred, situation, { avoid: [previousDrawing],
  hover: hoveredLeaf, metrics })` replaces `buildGhostSet`; draw each `drawing.steps` dashed at its `opacity`, the
  `hovered` one lit, with `label` underneath; fade them at the snap; keep the previous play dimmed until the next play
  draws. Rebuild on a hover change (`highlightGhost(leaf)`), a camera change (V) and a resize.
- css2d text is screen-sized, so pass the view: `metrics = labelMetrics(project, { x: situation.ballX, y: 26.667 })`
  with `project` the camera's field-to-canvas-pixel projection (`{ x, y, h }` to `{ x, y }`, y down; the 2D field
  wraps `ctx.pt`) and `charPx`, `linePx`, `padPx` from the world's label CSS. Decal text painted on the turf passes
  its own sizes in yards. Measured against the camera presets: no shadow text on other text in any camera at 1440x900,
  1920x1080 or 390x844 except 1 or 2 of 59 snaps in the end-zone camera (36 to 59 before); none on a stroke in the
  broadcast, high and Under the Lights wide cameras.
- Tests that pin the old grammar (no longer true): `tests/js/fallback-plays.test.mjs` lines 34, 51, 67, 77, 89, 99 and
  135 (the snap step, the band, the catch area, the corridor lane, the INT carrier).
- v1.4 (A6, 2026-10-09): the 2D fallback does all of the above (13.4); those seven tests are rewritten to the grammar.

### 16.6 Tests

Node: `play-label.test.mjs` (18), `shadows.test.mjs` (22), `paths.test.mjs` and `paths-flags.test.mjs` (34),
`grammar.test.mjs` (11), `timing.test.mjs` (18); `ghosts.test.mjs` (12) unchanged. Lines and functions 100%, branches
85% to 100% over the six modules. Sweeps: every row's label clear of its own play; every Dallas snap with each of the 14
plays hovered and the previous play kept (826 layouts): no text on text, a shadow or a mark, and over a dimmed stroke
only within three lines of its shadow. Visual: `node scripts/play-sheet.mjs [--out dir]` writes an SVG contact sheet
(one real row of every play kind with its label, then shadow plays for real Dallas predictions, laid out in the
sheet's own label metrics, hovers and a dimmed previous play included), rendered to PNG with Playwright.

## 17. v1.4: the Under the Lights booth as built (W4, 2026-10-09)

Additive to 2.7, 4.4, 8.2, 11 and 15. DESIGN.md (Control desk, Control-room drawer, Keys, lamps and LED inputs) is the
source; where this section is more specific, it is how the world's booth works.

### 17.1 Files

| File | Role |
| --- | --- |
| `theme/worlds/under-the-lights/booth.js` | `mountBooth(app, { storage })`, called by `arrange.js` after it hangs the racks (idempotent per `#app`; `null` without a SETTINGS rack). Builds `.uls-booth[data-booth="settings"]` in `[data-rack="settings"] > .uls-rack-body`: two `.uls-setting`, each a `label.sc-check.uls-switch[data-setting="dip"\|"room"]` (`input#ulsDipLive` / `input#ulsRoomLights`, checkboxes drawn as lamps, plus `.uls-switch-label`) and its note (`p.uls-switch-note#ulsDipNote` / `#ulsRoomNote`, the input's `aria-describedby`). Watches `<html data-ambient>` (the room switch always shows it, whoever set it) and `#flagPanel[hidden]` (each time the panel appears, its rack scrolls into view, block start). Returns `{ node, dip, room, stop() }`. Exports `DIP_KEY` (`sc:uls:dip-live`), `AMBIENT_KEY` (`sc:ambient`), `AMBIENT_EVENT` (`sc:booth-ambient`), `BOOTH_COPY`, `dipInLiveGames(storage)`, `setDipInLiveGames(on, storage)`, `dipFor(mode, on)` (pure: `watch` always dips) and `shouldDipNow(doc, storage)` (reads `#app[data-mode]`). Storage never throws; a blocked one keeps the choice for the visit. |
| `css/worlds/under-the-lights/booth.css` | Lamp switches (every `.sc-check`: Touchdown, Turnover, automatic 1st down, the settings), console pushbuttons (`:is(.sc-keypad, .sc-retag) .sc-key`), the racks' scroll margin, the FLAGS plate in flag yellow, the open drawer as a left HUD inset, the board's height while a desk input has focus |
| `css/worlds/under-the-lights/components/entry-pad.css` | The manual desk: plate, the pinned entry line, the two-row keypad console, the hint, the dimmed pad |
| `css/worlds/under-the-lights/components/flag-panel.css` | The flag panel in the FLAGS rack |
| `css/worlds/under-the-lights/components/last-play.css` | The desk in feed and watch modes: the last play's LED board and the retag keys |
| `css/worlds/under-the-lights/components/shorthand.css` | The shorthand bar: an LED input and a Run key |

### 17.2 The desk

- **Plates.** `.sc-pad-title` ("WHAT DID HE CALL?", manual) and `.sc-last-heading` ("LAST PLAY FROM ESPN", feed and
  watch) are painted plates like the board's (raised steel, white plate caps, a seam under them).
- **Manual entry line** (sticky at the desk's top, ui-architecture 4.4): a grid, `"chosen chosen chosen yards"` over
  `"td to log log"`: the chosen play on an LED readout (caps; the next tap under it in small type; "PICK THE PLAY"
  dim), Yards as an LED input (Display 800 digits, amber caret), Touchdown and Turnover as lamp switches, Log play as the
  widest key, lit amber with an `Enter` window (CSS `content` with empty alt text) once something is picked, unlit and
  dim while disabled. While Yards or the shorthand bar has focus the open video board keeps its normal height and
  scrolls inside (it still grows left), so a resting pointer never covers the entry line.
- **Keypad console.** Two rows (`.sc-keypad` grid: run and pass, then RPO and result), each key a pushbutton: the
  keyboard letter in an LED window across its top, the name painted under it. Letters and lit windows take the family
  tone through `--sc-tone` (run amber, pass warm white, RPO gold; results warm white, lit amber; X yellow, lit yellow
  while the flag panel is open). The family words (`aria-hidden`) and the per-key hints are hidden on the stadium desk
  (the hints stay for screen readers; the chosen line says the next tap); a phone (420 px and under) gets one family per
  row. At 1440 every key shows; at 1920 the second row scrolls under the pinned entry line (DESIGN.md: the desk scrolls).
  Off the field the pad dims to 0.62 (`--sc-entry-dim`, no fade).
- **Feed.** The last play is an LED board (`#lastPlay` carries the pixel face): the play in Display caps, the yards in
  amber, ESPN's text in body type, clamped to three lines in the stadium layout (the ribbon and the play feed hold all
  of it; a screen reader hears it all). The retag keys are one row of the same pushbuttons; `.cur` (the play's type)
  carries a 2 px warm-white frame drawn by `::after` (no shadow). The row is sticky at the desk's foot inside the last
  play.
- **Watch this game.** The transport fills the desk's top, so the retag row is fixed to the desk's foot (inside its
  frame) and the desk gains the row's height as bottom padding.
- **After each caller play** (`#lastPlay[data-fresh="true"]`, A7, 8 s): every retag window lights amber and the board
  steps the new play in (`uls-step-in`, 5 frames); then the windows rest unlit and visible. Reduced motion: no step.

### 17.3 The drawer

- **X** opens the booth (it holds `flags`) and booth.js scrolls the FLAGS rack to the drawer's top; its plate is painted
  flag yellow with a black caption. The panel drops its own frame: the note (an LED strip) beside Close (Esc), then the
  defense and offense columns (one column at 720 px and under) of foul keys (the flag-mode letter in a yellow window,
  lit yellow under the pointer or focus; the foul in caps; its enforcement in small type), Other on each team with the
  automatic 1st down lamp switch, Offsetting (W) and the hint. The panel's title is visually hidden; it still names the
  region. Escape or X closes both; a booth opened with B stays open.
- **SETTINGS**: the two lamp switches (17.1), each with its note.
- **The open drawer is HUD** in the stadium layout: `--sc-field-safe-left: var(--uls-drawer-w)` (400 / 520 px). W3's
  watcher announces it (`sc:hud-insets`); the camera re-frames once A0 adds W3's one-line listener (v1.4, section 15.4).
  Until then the drawer covers the field's left edge, the line of scrimmage included when it sits there.

### 17.4 Tests

Node: `tests/js/uls-booth.test.mjs` (14: the dip rule, storage that throws, `shouldDipNow`, arrange hanging the
booth, idempotence, the switches, the room lights handshake with and without an answer, the `<html data-ambient>`
watcher, the FLAGS rack scroll; booth.js 99% of lines). E2E: A11's input files run on this world with
`ui_helpers.WORLD` set to `under-the-lights` (a pytest plugin outside the repo patches it): entry, flags, shorthand and
drive, feed and replay, strip, keys and A7's input surfaces, 128 of 140 pass. The 12 that fail look for things this
world keeps elsewhere by design, none in W4's surfaces: the play log in the closed stat board (`#logArea`, #69, #89,
#91, #105), the feed's id box and Replay in the closed drawer (`#feedEvent`, `#replayBtn`, #49, #101, #104, #106, #109;
A11's `show()` opens the booth, these tests don't call it), a play button in the collapsed board and the families at
760 px (A7's hover test and #7, W2's board), and the smoke test's 404s for W1's scene modules. The booth flows (B, X,
Escape, the FLAGS scroll, the left inset, the board kept off the entry line, the two switches across a reload, the 8 s
light during a watch) are checked in Playwright.

## 18. v1.4: the Under the Lights HUD skins as built (W2, 2026-10-09)

Additive to 5, 8.2, 10.2, 11.3, 12.3 and 15.5. DESIGN.md (Components, Named Rules) is the source; where this section is
more specific, it is how the world's skins work. Every skin styles the hooks of sections 10 to 12 at the component's own
specificity (`:where(:root[data-world="under-the-lights"])` or `:where(#app[data-layout="uls"] <fixture>)` before the
component selector), so load order decides against the neutral component CSS and W3's fitting rules.

### 18.1 Files

| File | Skins |
| --- | --- |
| `components/masthead.css` | Every key on the page (`.sc-key`: raised steel cap, LED window for the key letter, lit amber when on, dark when disabled) and lamp (`.sc-lamp`); the nameplate and keys on the ribbon. Holds the shared LED primitives (18.2) and the `"ULS LED Pct"` face |
| `components/prediction.css` | The video board: plate, call name, Doto figure over its unlit `88%`, tilt tag, then-line, LED split bar and family bars with league notches, pixel hot arrows; the open board (two family columns over their plays, why lines, legend); the off-field face with an unlit `88%` |
| `components/scoreboard.css` | Band row one (logo windows, captions in the paint's ink, amber Doto scores and facts over unlit 8s, possession and timeout lamps, EST and FINAL tags) and the shared digit windows (`.sc-digits[data-ghost]`) |
| `components/scorecard.css` | Band row two (steel SHADOW V LEAGUE plate, three pairs: caption, two amber readouts, `v`, leader lamp, snap count) and tonight's scorecard on the stat board |
| `components/play-feed.css` | The ribbon's one-line message (time, team, result, verdict glyph, ESPN's text; paging), the unrolled replay board (steel drive plates, LED rows) |
| `components/drive-chart.css`, `components/win-prob.css` | The lower ribbon: the drive as LED cells on the 100-yard scale (unrolls into the drive list), the win probability as an LED line |
| `components/situation-strip.css`, `components/feed-bar.css` | LED input windows on steel; the ESPN key and its tally lamp, the status, the drawer's FEED rack, the G12 line |
| `components/box-score.css`, `components/tendencies.css`, `components/play-log.css` | The stat board's panels under steel plates: LED tables, the LED forest plot |
| `components/toast.css`, `components/conn-banner.css`, `components/boot-screen.css`, `components/review-banner.css`, `components/field-host.css` | The LED strips and tags around the bowl, the boot board, the field legend |
| `img/worlds/under-the-lights/*.svg` | 9 x 9 masks: `check`, `three`, `x` (verdicts), `td`, `inc`, `first` (the down marker), `flag`, `turnover`, `hot-up`, `hot-down`, `ref-touchdown`, `ref-turnover` (referee signals) |

Used today: the verdict glyphs on the ribbon and the replay board, `ref-touchdown` / `turnover` / `flag` before a play's
result (`data-result`) and a drive's result (`data-result` of the drive chart), the hot arrows on the board. `td`, `inc`,
`first` and `ref-turnover` are there for hooks that do not exist yet (v1.4 W2 note) and for W1's turf lettering.

### 18.2 Shared world primitives (defined in `components/masthead.css`)

- `--uls-led-num`: `"ULS LED Punct", "ULS LED Pct", Doto, …`. Doto draws `%` as two dot pairs and a diagonal that reads
  `28X` across a room, so `"ULS LED Pct"` takes U+0025 from Big Shoulders Display (W3's file, already preloaded), like
  W3's period and colon. Only at `--sc-size-call`, `--sc-size-xl` or `--uls-size-led-readout` (the 40 Pixel Rule, tested).
- `--uls-cell` (4 px), `--uls-lit` (the lit-cell mask: round dots on the panel's 4 px pitch), `--uls-track` (a bar's
  unlit cells, a step warmer than the panel's grid), `--uls-glyph` (18 px; 27 px for ribbon glyphs on the TV).
- `--uls-ghost`: segment-unlit taken toward the panel for the unlit 8s behind segment digits, so `7` beside its unlit
  `8` never reads `87` across a room (the board's figure uses `--uls-unlit`).
- LED bars and charts are their own elements masked with `--uls-lit` over a plain panel (a bar's padding rows, or a
  `::before` in the SVG's grid area), so lit and unlit pixels share one grid. Digit windows stack the ghost behind the
  value (`::before`, z −1) with a hidden copy (`::after`) setting the cell's width; `--uls-win-x|y` is the padding.

### 18.3 Tests

Node: `tests/js/uls-skins.test.mjs` (every skin registered in order and under 400 lines; the Flat Hardware Rule; no raw
hex, named hue or `--sc-team-*` in a skin; Doto only at LED sizes; every `url()` resolves; animations are hardware
steps with both reduced-motion states; LED inks clear 4.5:1 on the panel; the glyphs are clean 9 x 9 masks) and
`tests/js/play-feed-pager.test.mjs` (`pagesFor`, the pager's holds, rest and reset, `resultKind`, `data-result` on the
real game, the feed paging only its newest row). Browser: Playwright at 1440x900, 1920x1080 and 390x844 in replay
(manual drive, finished game, feed on with the drawer, stat board, review, toast, offline, boot failure) and in Watch
this game (paused and playing, the board open, the ribbon paging).

## 19. v1.4: the Watch transport and the replay scrub as built (W5, 2026-10-09)

Additive to 2.6, 3.8, 4.3, 5.4, 9.1, 12 and 15. DESIGN.md ("Watch transport", "Control desk", "Keys, lamps and LED
inputs") is the source; where this section is more specific, it is how the deck works.

### 19.1 Files

| File | Role |
| --- | --- |
| `model/vm-scrub.js` (pure) | `scrubVm(pv)`: `{available, empty, session, total, lastSeq, liveSeq, reviewSeq, reviewing, knobSeq, knobAt, headAt, plays: {seq, drive, head, label, text}[], drives: {idx, team, caller, first, last, from, to}[], marks: {key, kind: "quarter"\|"score"\|"turnover", seq, team, caller, at, text}[], readout: {state: "live"\|"review"\|"empty", word, title, head, label, text}, value: {now, max, text}, canEarlier, canLive}`, frozen. A slot per timeline row in seq order; `total` is `watch.total` during a session (the count is already on the transport; no row past the field is read, DC E5), else the last drawn seq. `from`, `to`, `at`, `knobAt` and `headAt` are fractions of the strip (5 decimals). `describePlay(row)`: "Q2 8:41 · DAL · Deep pass left · +21" (when and whose, then `playLabel(row)`), memoized by row. `seqAtFraction(vm, f)`: the drawable play nearest the slot under `f` (the one before wins a tie; admin rows never), `null` past the newest drawn row (the live detent). `stepFrom(vm, delta, { byDrive })`: -1 an earlier play (from live, the newest, like Left), +1 a later one (past the newest: `null`; live stays live, so the scrub never steps the server), ±Infinity the first play or live; `byDrive` the start of this drive or the one before, the next drive's start or live |
| `ui/scrub.js` | The component (appends to `#rg-transport`). Markup in reading and tab order: `p.sc-scrub-readout[data-show]` (`.sc-scrub-title`, `.sc-scrub-word`, `.sc-scrub-head`, `.sc-scrub-label`), `.sc-key.sc-scrub-key.sc-scrub-earlier[data-scrub="earlier"]` (cap ←, `REVIEW.earlier`, `aria-keyshortcuts="ArrowLeft"`), `.sc-scrub-track[role="slider"][tabindex="0"][data-testid="scrub-track"]` (`aria-valuemin/max/now/valuetext`, `aria-disabled` while empty; children `.sc-scrub-face` > `ol.sc-scrub-drives`, `ol.sc-scrub-marks`, `.sc-scrub-veil`; `.sc-scrub-ghost`, `.sc-scrub-knob`), `.sc-key.sc-scrub-key.sc-scrub-live[data-scrub="live"]` (cap Esc, a `.sc-lamp.sc-scrub-live-lamp[data-on]`, the word `SCRUB.live`, `aria-label` `REVIEW.live`). Root `.sc-scrub[data-testid="scrub"][data-state][data-session][data-dragging]`, `role="group"`, `aria-label` `SCRUB.label`. Positions are custom properties: `--sc-scrub-from`/`--sc-scrub-to` on drives, `--sc-scrub-at` on marks, `--sc-scrub-knob`, `--sc-scrub-head`, `--sc-scrub-hover` on the track |
| `css/components/scrub.css` | Structure and tokens (neutral): one grid, the readout on top, then ←, the strip and LIVE; drives in the runtime team colors; the strip full width under 520 px |
| `css/worlds/under-the-lights/components/watch-transport.css` | The transport on the desk (19.3) |
| `css/worlds/under-the-lights/components/scrub.css` | The strip, the board and the keys on the desk (19.3) |

### 19.2 Behavior

- **Review only.** A press, a drag, a key or ← asks `actions.reviewAt(seq)` (null: live), `actions.review(-1)` or
  `actions.exitReview()`; the same target is never asked for twice in a row. Nothing posts to `/api/watch/*`: Right at
  the live edge stays live on the strip (the page's Right still steps a paused watch, 4.3).
- **Pointer.** The strip is a slider. A main-button press reviews the play under it (`seqAtFraction`), a drag follows
  it (pointer capture), the part of a watched game not played yet is the live detent, and release keeps the play on the
  field. `pointerdown` and `mousedown` are prevented, so a mouse scrub never moves keyboard focus and the page's
  shortcuts keep working; `touch-action: pan-y` lets a phone scroll the page vertically. Hover (no press) previews the
  play under the pointer on the readout (`data-show="hover"`) and with a dashed ghost knob, and asks for nothing.
- **Keys on the focused strip** (a slider, so the keymap leaves it alone, 4.1 guard 3): Left/Down and Right/Up a play,
  Page Up/Down a drive, Home the first play, End live, Esc live (only while reviewing); Space plays or pauses and 1 to 4
  set the speed, as everywhere else. Keys with Alt, Ctrl or Meta, and every other key, pass through.
- **Focus.** A key activated from the keyboard that the new state disables (LIVE after going live, ← on the first play)
  hands focus to the strip; a mouse click leaves focus alone.
- **The readout** follows the knob (`Review` with the reviewed play, `Live` with the newest), a hovered play while the
  pointer is over the strip, and during a watch it carries the mode's name (`WATCH.start`) as `title`.

### 19.3 Under the Lights

- **The desk in watch mode is four rows**, so they fit above the retag keys W4 fixes to the desk's foot (1440: 184 of
  226 px; 1920: 208 of 217 px, the rows 4 px apart there, 6 px on the laptop): (1) an LED message board and the play
  counter; (2) Space play/pause, → Step, Stop; (3) the four speeds, one lit; (4) ←, the strip, LIVE.
- **The board** is the scrub's readout, absolutely placed in the transport's first row on the stadium's desk
  (`#rg-transport` is its positioning box): two lines of LED caps. Live: the mode's name (`WATCH THIS GAME`) over the
  newest play's words, dim (the band already says when and whose ball). Review: `REVIEW` (amber), when and whose, then
  the play in warm white. Hover: the hovered play. The
  transport's own painted plate (`::before`, `content: attr(aria-label) / ""`) stands down there; in the phone column
  the plate shows and the board sits in the flow above the strip, without the title.
- **The counter** (`.sc-transport-progress`): Doto (`--uls-led-num`) at `--uls-size-led-readout`, amber segments over
  `888/888` in `--uls-ghost` (the spaces close up: `word-spacing: -0.6em`), its width the shared token
  `--uls-deck-count-w` (seven Doto cells and the window's padding), which the board subtracts.
- **The keys** are the world's (W2's `masthead.css`); the transport lights the pause key's window amber while a game
  plays (the play key is unlit while paused) and puts the error's words beside a tally-red lamp. ← prints its key only
  (its name stays for assistive tech); LIVE keeps its word and lights its lamp tally red at the live edge, on air.
- **The strip** is an LED face: the drives' lane is W2's unlit track (`--uls-track`), each drawn drive lit through
  W2's mask (`--uls-lit`) in its LED tone (the caller warm white, the opponent amber), quantized to the 4 px pitch with
  `round()` (a plain `calc()` before it for older engines), one unlit column between drives; score cells above in the
  scorer's tone, turnovers in tally red, quarter ticks below in LED dim. The knob is a 2 px warm-white frame three cells
  wide (amber while held), riding the front of the lit strip at the live edge; the veil dims the drawn plays after a
  reviewed one; the ghost is a dashed dim frame. No transitions: everything changes state at once.
- **Not changed:** the stadium shows the transport only in watch mode (W3's layout), so Watch this game starts from
  the drawer's FEED rack (B) at the stored speed; 1 to 4 change it once the game plays.

### 19.4 Tests

Node: `tests/js/vm-scrub.test.mjs` (18, the real TB at DAL captures: slots, drives, marks, a watch's spoiler-free strip,
review, empty, the caller without team colors, `seqAtFraction`, `stepFrom`, copy), `tests/js/scrub.test.mjs` (16: hooks
and tab order, keys and names, keyed renders, ← and LIVE, keys on the strip, pointer press, drag and the live detent,
hover, the board after a drag, empty, an unmeasurable strip, the focus handoff, destroy; both modules 100% of lines) and
`tests/js/uls-deck.test.mjs` (8: registration and order, flat hardware, tokens only, Doto only at LED sizes, no
motion, the counter's ghost and width, the board's geometry, contrast). E2E: `tests/e2e/test_ui_timeline_watch.py`
17/17 on both worlds (`ui_helpers.WORLD` patched by a pytest plugin outside the repo for Under the Lights). On Under
the Lights, `test_ui_chrome.py`'s two watch tests pick a speed on the idle transport before starting, which this world
keeps off the desk until a game plays (by DESIGN.md); they stay neutral-only. Browser: Watch this game at 10x from the
drawer through pause, step, scrub, live, done, review of the finished game and Back to my game, at 1440x900 and
1920x1080, plus 390x844.

## 20. v1.4: the action layer as built (A5 part 2, 2026-10-09)

Additive to 2.5 and 14.4. The binding source is `docs/design/play-drawing.md`; DESIGN.md's "Plays on the field" rules
(the tracer head, The Light Core Rule, the drive's residue) apply where they don't conflict with it. `scene.js` drives
these layers exactly as 14.4 says; they reach each other through `stage.layers` (20.3).

### 20.1 Files

| File | Kind | Role |
| --- | --- | --- |
| `player.js` | three.js | layer `player`: the live play, animated from its plan (`start` → job) or whole (`placeAll`); the play on display, dimmed when the next call is up; its words; the hand-over to residue; `review` (to residue), `relabel`, `verdict` (to overlays) |
| `ghost-layer.js` | three.js | layer `ghosts`: the shadow plays (`shadows.buildShadowPlays`), their text in the view's label metrics, hover, the snap fade; `shown()` (the `data-ghosts` hook) |
| `overlays.js` | three.js | layer `overlays`: the painted situation (`current()`), the verdict chips (slots `live`, `review`) |
| `residue.js` | three.js | layer `residue`: past plays, faint, merged per material; Left/Right review (one past play replayed) |
| `play-style.js` | pure | a Drawing or a ShadowPlay as frozen parts (stroke, track, arrow, mark) with every color, width, dash and opacity from the Look; `carriersOf`, `pathOf`, `revealAt`, `shadowInputOf`, `resolvePlayLook` |
| `play-art.js` | three.js | parts → meshes revealed by step progress (`buildArt`), field-label helpers, `playEnv` (team paints and the page's tones, kept a second), `drawingOrNull`, `warmUpPrograms` (every action-layer shader compiled at boot) |
| `play-strip.js` | three.js | the stroke primitive: a path as one continuous strip (screen px or turf yards) with a reveal distance, dashes in yards, an inner cut (the edge ring), per-vertex alpha and color, anti-aliased sides |
| `play-ball.js` | three.js | the ball in play: football, tracer head, contact shadow, trail (`look.ball.trail`), the hold's slide to the next spot |
| `play-glyphs.js` | three.js (canvas) | the marks' alpha masks (core, and an edge ring cut out of it), letters with `fillText` only |

### 20.2 What it draws

- **Every scrimmage play starts on the line of scrimmage**, on the center line. A pass is a true 3D arc (an edge ring in
  the team color around a light core, The Light Core Rule) that grows with the ball, a thin dashed ground track under
  it, then a catch dot and the yards after the catch as a straight line on the turf; an incompletion's arc ends in an X;
  an interception in an INT plate and the defense's return; a run, scramble, sack (its edge in the `bad` tone), kneel,
  return or penalty walk (dashed line-to-gain yellow) is one straight flat line grown from its start with an arrowhead;
  kicks fly their true length (a field goal's check or X stands at the crossbar as a billboard); a touchdown ends in
  TD. A no-play draws dimmed and dashed (60% toward gray at `ghostedOpacity`) under its flag. Estimates take the look's
  approx style (`dashed`, `hatch`, `pixel`: dashes; `soft`: 55%). No 3D runner, no routes, no ball behind the line.
- **Timing** (the facade's fitted plan): flights move at ground speed, carries ease out into the tackle (the stroke's
  tip is the ball, `revealAt`), the catch dot lands at once, other marks pop in over `markMs`, an arrowhead lands with
  its line, the play's words step in when the last step lands; during the hold the ball slides to the next snap's spot
  (`drawing.ballEnd`), where the facade's resting ball takes over. The ball's nose follows its velocity (a spiral on
  passes and punts, end over end on kickoffs and field goals); its head is the arc's light core times
  `world.plays.headGlow` (additive: it blooms when the look has bloom); its trail is the carrier's light core.
- **The play on display** keeps its words (`drawing.label`, a `.sc-play-label` plate centered on `label.at`) until the
  next play draws. When the next call goes up it dims to `lastPlay.dimOpacity` over `ghostInMs` and its words go muted
  (`.is-dim`), or it retires at once for `lastPlay.keep: "until-presnap"`. A verdict (`markVerdict`) adds a chip under
  its words ("Top pick", "In his top 3", "Miss"; `.sc-verdict-chip.is-<key>`, dropped a plate by CSS).
- **Residue** (`look.residue`: `none`, `drive` = the current drive's earlier plays, `game`): strokes, arrowheads and turf
  marks at `residue.opacity`, no words, no ground tracks and no kick flights (a 22-yard-high punt would hang over every
  later snap), merged by shape with each path's own color and opacity as vertex attributes: a drive costs about 10 draw
  calls, a whole game 34.
- **Shadow plays** before a caller snap: his top 2 (`buildShadowPlays`), plus the play the prediction panel hovers or
  focuses. Each is a dashed stroke in the ghost tint (`ghost.fill`: `team` the team's light core, `neutral` the
  `ghost.stroke` color, or a color) at the shadow's own opacity (0.5, 0.35; the hovered one `hoverOpacity`, the others
  `dimOthers` times theirs while one is hovered), `shadowWidth` times the real core, grown out of the line of scrimmage
  over `ghostInMs`, then where it ends: a dashed target ring where a pass is aimed, a chevron on a run. The text
  (`.sc-shadow-label.rank-N`, dashed plate; `.is-hovered`, `.is-muted`) is laid out underneath by `shadows.js` in this
  view's label metrics: `labelMetrics` through a camera at the rig's `goalPose()` and the plate measured from the
  world's CSS once per canvas size; it avoids the play on display, its words and its chip. It waits until the camera is
  within 1.5 yd of that pose (after a rebuild the camera glides in from the whole field) and is laid out again on a
  camera mode, canvas or safe-area change, a hover, a verdict or a relabel. At the snap (`fade(afterSnapOpacity,
  ghostOutMs)`) the text fades out and the strokes fade to `ghost.afterSnapOpacity` (0 removes them), a trace the ball
  flies through or past. Only the caller's offense: the conductor sends a call only on his drives.
- **Review** (Left/Right): the live plays, words, chip and residue step aside; the reviewed row replays from its line of
  scrimmage at its normal length (at once under reduced motion) with its words and its grade (`review` chip slot) while
  the facade shows its own shadows and situation; Esc restores the live state.

### 20.3 Interfaces between the action layers (`stage.layers`; additions to 14.4)

- `player`: `lastDrawing()` (the play on display, for the shadows' layout), `dimLast()` (the ghost layer calls it when a
  call goes up, not during review), `isLive()` (false while reviewing), `glyphs`.
- `residue`: `addMany(items, { drive })` (the player's hand-over; keep rules relative to the drive now in force),
  `review(item | null)`, `reviewDrawing()`, `relabel(rows)`, `count()`.
- `overlays`: `situation(sit)`, `current()`, `verdict({ seq, key, label }, { slot, visible })`,
  `relabel(slot, { row, label })`, `clearVerdict(slot)`, `setVisible(slot, on)`, `chip(slot)`.
- `ghosts`: `relayout()` (after a verdict or a relabel), `shown()` (the hook).
- `cameras.js` (A5, additive): `rig.goalPose()`.

### 20.4 The Look keys a world supplies

Existing schema keys, all read: `strokes.arc`, `strokes.ground`, `strokes.mark` (`geometry`: `line2` draws screen-wide
strips of `widthPx`, `ribbon`, `decal` and `tube` turf-wide strips of `widthYd`; `core`; `edge` `team`, `team-alt` or a
color; `opacity`; `dash`; `ghostedOpacity`; `approx`; `mark.widthYd` is the glyph size), `lines.ltg.color` (the flag,
the walk), `ball` (`kind`, `color`, `accent`, `scale`, `trail.kind|color|widthPx|fadeMs`), `ghost` (`fill`, `stroke`,
`afterSnapOpacity`, `labels`), `lastPlay` (`keep`, `dimOpacity`), `residue` (`keep`, `opacity`), `labels` (`renderer`,
`className`, `result`), `motion` (`markMs`, `ghostInMs`, `ghostOutMs` and the plan's speeds), `teamColor` (through the
kit's team paints). The page's `--sc-good`, `--sc-bad`, `--sc-warn` tokens color the marks' tones, and the label
plates take `--sc-surface-2`, `--sc-ink`, `--sc-ink-muted`, `--sc-rule-strong`, `--sc-focus`, `--sc-font-text`,
`--sc-size-s|xs`, `--sc-weight-strong`, `--sc-tracking-label`, `--sc-case-label`, `--sc-radius-s`, `--sc-dur-med|slow`,
`--sc-ease-out`, `--sc-space-1`. Optional, new: `look.world.plays` (`play-style.PLAY_LOOK`; each key checked, a bad
value takes its default): `headGlow` 2.5, `headYd` 1.3, `trackOpacity` 0.28, `trackWidthPx` 1.5, `trackDash` [0.5, 0.9],
`arrowYd` 1.6 (0: none), `hoverOpacity` 0.9, `dimOthers` 0.5, `shadowDash` [1.2, 0.8], `shadowWidth` 1.25, `targetYd`
1.1, `tones` `{ good, bad, warn }` (else the page's tokens, else `TONE_FALLBACK`).

### 20.5 Budget as measured (`?debug=1`, Watch this game at 4x, 12 s, plays 95 to 103; Chromium on the Apple M4 Max)

**Re-measure after G7 (v1.4 note, 2026-10-10).** These 12 s windows (plays 95 to 103) miss the frames a whole game drops: a full watched game shows about 120 frames over 25 ms (a play's first frame, the camera's cuts and the stadium's moments), so "0 of 718 over 20 ms" is not the game's number. G7's frame work and a whole-game run replace this table; until then quote it as a window, not as the game.

| Size, DPR | Frame interval p50 / p95 / p99 / max | Frames over 20 ms | Engine CPU p50 / p95 / max | Draw calls max | Triangles |
| --- | --- | --- | --- | --- | --- |
| 1440x900, 2 | 16.7 / 16.8 / 16.8 / 16.8 ms | 0 of 718 | 0.4 / 0.6 / 8.0 ms | 51 | 4.3k |
| 1920x1080, 1 | 16.7 / 16.8 / 16.8 / 16.8 ms | 0 of 719 | 0.4 / 0.6 / 7.4 ms | 51 | 4.3k |
| 1440x900, 2, from the first snap | 16.7 / 16.7 / 16.8 / 33.4 ms | 1 of 723 | 0.5 / 0.6 / 9.7 ms | 50 | 4.3k |
| 1440x900, 2, rows 20 times the demo pace (`SHADOW_WATCH_SCALE=0.05`) | 16.7 / 16.7 / 16.8 / 16.8 ms | 0 of 719 | 0.3 / 0.4 / 0.6 ms | 45 | 5.0k |

The worst engine frame is a play's first (its meshes built and uploaded). Before `warmUpPrograms` (shaders compiled
mid-play) and the trail's per-frame bounds and color, the same runs dropped 2 frames (up to 50 ms) at 1440 and 1 (117
ms) at 1920, with an engine CPU p95 of 2.3 ms. Playwright's default headless
Chromium renders with SwiftShader (tier `low`); `channel: "chromium"` gets the GPU, as these numbers do. Idle frames stay
0 (the e2e render-on-demand test passes). Budget (6.1): 16.7 ms, 150 draw calls, 300k triangles, 12 live labels
(the action layers keep at most 7: the play's words and its chip, three shadow texts, and during a review the
reviewed play's words and chip while the live ones are hidden).

### 20.6 Tests

Node: `play-style.test.mjs` (14), `play-art.test.mjs` (9), `play-glyphs.test.mjs` (4), `action-layers.test.mjs` (12),
`ghost-layer.test.mjs` (10), on `tests/js/action-stage.mjs` (a WebGL-free stage with the real kit, rig and paint, a
recording label layer and a hand-cranked frame clock). Lines 97 to 100%, branches 80 to 98% and functions 98 to
100% on the nine modules. `stage-parts.test.mjs` lost part 1's two placeholder tests; `scene-engine.test.mjs`'s
spies leave `shown` unanswered.
E2E: `test_ui_checklist_field.py`, `test_ui_keys_offline.py` (idle frames, draw budget, the leak check, context loss),
`test_ui_timeline_watch.py`, `test_ui_checklist_prediction.py`, `test_ui_game_surfaces.py`. Browser: every play kind
mid-flight and landed, pre-snap shadows, hover, review, at 1440x900 (DPR 2), 1920x1080 and 390x844, both worlds.

## 21. v1.4: the Under the Lights scene look as built (W1, 2026-10-09)

Additive to 2.7, 14.6 and 20.4; DESIGN.md "The stadium (3D art direction)" and `docs/design/play-drawing.md` are the
source. Where this section is more specific, it is how the world's scene works.

### 21.1 Files (`theme/worlds/under-the-lights/`)

| File | Role |
| --- | --- |
| `look.js` | The Look (`look`, frozen): night-sky clear and background, bowl-haze FogExp2, four tower spot lights (`TOWERS`; only the two home-side ones cast shadows), a dim sky hemisphere, DESIGN.md turf and paint, LOS and LTG 0.45 yd, strokes with a light-cone-white core and the team on the edge, the ball 2.2x with a spark trail, the shadow plays in LED warm white (`ghost.fill: "neutral"`), bloom threshold 1.05 and the `uls-lens` world pass, cameras `wide` (default), `tight` (follows the ball), `blimp`; `world.day` (sun, sky, haze for a day kickoff), `world.plays` (20.4), `world.uls` (21.3). Exports `ULS` (DESIGN.md colors), `TOWERS`, `SUN` |
| `props.js` | `props(ctx)`: the stadium group `uls-stadium` (stands and tower steel, crowd, LED ribbons, lamp banks, light shafts; by day the rim caster instead of the shafts) and `object.userData.uls` (`dim`, `choreo`, `ribbons`, `frame`, `dip`) for the moments; `update(dt)` steps the ribbons, the dip and the camera and is busy only while one moves. `passes["uls-lens"]`. `liteGpu()`: a software rasterizer drops the shafts and the crowd and draws the stands unlit |
| `moments.js` | `presnap` (dip unless `booth.shouldDipNow()` says no; the camera back to wide), `snap` (lights up), `play` (lights up; the camera pushes in to tight, or rises to the blimp for a kick), `landed` (settle back, or in Watch this game rise to the blimp and drift after a drive ends; the ribbons step in the play's words, TOUCHDOWN with the scorer's logo, INTERCEPTED or FLAG for a moment), `verdict` (TOP PICK, IN HIS TOP 3 or MISS joins the caller play's words), `possession` (the upper ribbon back to the game) |
| `stadium/bowl.js` | The bowl's geometry: a lower bowl all round (10 rows on the home side, 28 elsewhere) behind a field wall, a horseshoe upper deck over the far side and both ends; `RINGS`, `LEVELS`, `seating()` |
| `stadium/builder.js` | Flat-shaded, vertex-colored quads merged into one geometry (`createBuilder`, `ringPoint`) |
| `stadium/stands.js` | The stands and tower steel as one lit mesh with a faint self-light (dimmed by the dip) and the bowl's haze |
| `stadium/crowd.js` | 56,000 seeded seats (about 86% filled) as one `Points`: home colors, the visitors in one end, street colors, faces |
| `stadium/towers.js` | Tower frames from the look's spot lights, masts and heads into the builder, 144 lamps as one instanced mesh (x9 HDR: they bloom; dark glass by day) |
| `stadium/ribbons.js`, `stadium/messages.js` | The two LED fascia ribbons (field wall all round; upper deck front) on one canvas, stepping at 12 fps; messages from `field/play-label.js` (the field's own words), LED tones only, team logos (dark variant) as the one team color |
| `stadium/air.js` | The towers' light shafts (one additive mesh, at most 6%) and the day's rim caster (the stands' rim slid down the sun's rays into the shadow box, shadow only) |
| `stadium/haze.js` | The stadium's fog depth measured from the field's middle (`bowlHaze(material)`), so the blimp keeps the bowl |
| `stadium/dim.js` | The light dip: tower spots, lamps, shafts, stands and crowd to a level, eased; `restore()` |
| `stadium/choreo-plan.js` (pure), `stadium/choreo.js`, `stadium/drift.js` | The camera choreography (21.2) |
| `shaders/led.js`, `shaders/shaft.js`, `shaders/grade.js` | The LED dot-pitch board material (dots up close, the picture far away), the shaft material, the lens falloff pass centered on the free area |

### 21.2 Camera choreography (surface brief #3)

Only on the `wide` camera the viewer chose (V to `tight` or `blimp` leaves it alone). A shot is taken in the rig at once
(`rig.shot(id, { instant: true })`, so the shadows' text is laid out for where the camera lands) and the visible camera
blends there on the world's clock: the snap pushes in to `tight` (650 ms) and the rig follows the ball; a kick rises to
`blimp` (1.7 s); after the play it settles to `wide` (900 ms). In Watch this game a play that ends the drive (TD,
turnover, safety, downs, punt, field goal) rises to the blimp and drifts: it eases out to the whole bowl (1.65x, 42
degrees down, aimed 25 yd past the field) and sweeps at most 2.4 degrees a second to 20, then holds (no frames). The
next caller presnap or play comes back down. Reduced motion drops every shot at once. The rig's view offset (the HUD's
safe area) is never touched, so every shot keeps the free area's optical center.

### 21.3 `look.world.uls`

`dip { level 0.8, ms 300 }` (DESIGN.md), `camera { pushMs, settleMs, riseMs, descendMs, driftDegPerS, driftMaxDeg,
driftZoom, driftPitchDeg, driftLiftYd }`, `ribbons { stepMs 83, steps 5, holdTdMs 3200 }`.

### 21.4 Budget as measured (`?debug=1`, GPU Chromium on the Apple M4 Max, Watch this game)

**Re-measure after G7 (v1.4 note):** the same caveat as 20.5. These are short windows; a whole game has about 120 frames over 25 ms.

| Run | Frame p50 / p95 / p99 / max | Over 20 ms | Engine CPU p50 / p95 / max | Draw calls max | Triangles max |
| --- | --- | --- | --- | --- | --- |
| 1440x900 DPR 2, 4x, plays 95 to 103 | 16.7 / 16.7 / 16.8 / 16.8 ms | 0 of 719 | 1.0 / 2.6 / 12.0 ms | 66 | 38.4k |
| 1920x1080 DPR 1, 4x, plays 95 to 103 | 16.7 / 16.7 / 16.8 / 16.8 ms | 0 of 719 | 1.1 / 2.6 / 11.5 ms | 66 | 38.4k |
| 1440x900 DPR 2, 2x, plays 10 to 15 (TD, blimp drift, kickoff) | 16.7 / 16.7 / 16.8 / 16.8 ms | 0 of 840 | 1.1 / 2.4 / 18.8 ms | 77 | 38.6k |

The stadium is 5 draw calls (4 by day, 3 on a software rasterizer) and about 38k triangles with the field.

### 21.5 Tests

Node: `uls-look.test.mjs` (9), `uls-stadium.test.mjs` (6), `uls-messages.test.mjs` (5), `uls-moments.test.mjs` (7),
`uls-choreo-plan.test.mjs` (6), `uls-ribbons.test.mjs` (3); `scene-engine.test.mjs`, `conductor.test.mjs` and `timeline-cache.test.mjs` gain one
test each for 21's engine and core lines.

## 22. v1.4: integration as built (W6, 2026-10-09)

The packages joined into one page on Sam's world, checked end to end on both worlds. `docs/design/play-drawing.md` is
binding throughout; where it left a choice open, the choice and its reason are below.

### 22.1 The page

- **Default world.** `theme/worlds/index.js` keeps `DEFAULT_WORLD = "under-the-lights"` and `FALLBACK_WORLD = "neutral"`;
  `/` opens Under the Lights, `?world=neutral` opens neutral, an unknown id is ignored with a notice
  (`tests/js/index-html.test.mjs`, and the e2e boot test with no `?world=`).
- **`static/index.html`** opens, right after `<!doctype html>` (so the page stays in standards mode), with
  `docs/design/direction-contract.md` word for word as its first comment, under the line
  "docs/design/direction-contract.md, verbatim:" (pinned by `index-html.test.mjs`; nothing in the contract can close
  a comment). It links `static/img/favicon.svg` (night sky, the line of scrimmage, an arc, the ball), so a load raises
  no `/favicon.ico` 404 in the console.
- **`main.js`** carries W4's line: `#app` `sc:booth-ambient` calls `actions.setAmbient`, so the store's
  `prefs.ambient` (and `sc:ambient`) follow the booth's Room lights switch.

### 22.2 Decisions under play-drawing.md

| Question (from the build reports) | Decision | Where |
| --- | --- | --- |
| After the snap: 2D faded the shadows out, 3D kept the top one at 0.1 | Out, both engines: "When the snap happens, the shadows fade out" (4). DESIGN.md's "the top call stays at 15%" was the superseded projection's rule | `ghost.afterSnapOpacity: 0` in `NEUTRAL_LOOK` and the Under the Lights look; `uls-look` and `look-schema` tests |
| `data-ghosts`: 2D reported the top 2, 3D three zones | Exactly his top 2 in rank order (a hovered play outside them aside), both engines | A5 part 2 already; `test_ui_checklist_field.py` checks it exactly again |
| A dimmed kickoff or punt arc competed with the shadows at every drive's first snap | Kept on, dimmed further: new optional `look.world.plays.kickDim` (default 1; Under the Lights 0.4, so 0.3 x 0.4 = 0.12); `play-style.dimOpacityOf(look, drawing)` | `player.dimLast`; `play-style`, `action-layers`, `uls-look` tests |
| A watch step (Right or Step on a paused watch) drew its play in 800 ms (a 72-yard run in 0.8 s) | A step applies ESPN's next play, not one he typed: `actions` kicks its tick with origin `poll`, so the play draws at `normalMs` (anim-queue's 800 ms cap stays for his own rows) | `core/actions.js` `STEP`; `actions.test.mjs` |
| `ghosts.js` (zones, lanes, bands) after A5 part 2 and A6 | Kept as the conductor's GhostSet: its ranked plays and odds feed both engines' shadow input, its shapes only the pre-snap camera frame (`camera-plan.frameSituation`); nothing draws them | `ghosts.test.mjs` header |
| The field goal's hold line (8 yd behind the line of scrimmage; rework L1) | Left as is: play-drawing.md 2 keeps kicks "as before (true length)", and a field goal's length starts at the hold. Sam's call | open |

### 22.3 Under the Lights, found in integration

- **The watch desk.** DESIGN.md's watch desk is the transport over the last play and its retag keys: during a watch the
  shorthand bar steps off the stadium desk (it peeked half cut under the transport before the first Dallas play) and
  the hint stays for screen readers only (`components/shorthand.css`). Manual entry, the feed and the phone keep both.
- **Unrolling.** The play ribbon, the drive ribbon and the video board unroll on `:hover` or `:has(:focus-visible)`
  (was `:focus-within`): a row clicked with the mouse kept the replay board open over the drive list after the pointer
  left; the keyboard still opens them by Tab (`layout.css`, `motion.css`, `components/play-feed.css`,
  `drive-chart.css`, `prediction.css`).
- **The drawer's rails** run by `translate` on the compositor (was `inset-inline-start`, a relayout every frame that
  left the drawer's text a pixel off at rest in one run of three; `uls-world.test.mjs` pins it).

### 22.4 Engine

`debugState().ball` (`field/scene.js`): the ball in flight as `{ x, y, h }` field yards, a copy, while a play draws;
`null` at rest. The e2e line-of-scrimmage check reads it frame by frame.

### 22.5 Tests

- **Either world.** `tests/e2e/ui_helpers.py` `WORLD` comes from `SC_E2E_WORLD` (default `neutral`; the A8 file's
  `QUERY` follows it). World-aware helpers: `show(page, sel)` opens the closed booth (B) or stat board (G) that holds a
  target and closes again one that didn't help; `reveal`, `point_at`, `click_at` reach a target in a region that unrolls
  on hover (they wait for its LED step-in and keep the pointer on the target until it stops moving); `region_box` measures
  a region lent to a fixture (`display: contents`); `CAMERAS` per world; `neutral_only(reason)` skips the neutral
  layout's own checks elsewhere (#7's rail and family columns, the idle transport's speed keys, which Under the Lights
  shows only while a game plays). Older tests now read words as written (`textContent`; a world may set them in caps)
  and the world's default camera.
- **`tests/e2e/test_ui_world_under-the-lights.py`** (with `uls_scenes.py`): the default world and its fonts; his top 2
  as shadow plays before a Dallas snap with their text, a hovered third play, none for Tampa Bay; each of
  play-drawing.md 3's own examples on the field, reviewed from the ribbon, on both engines; every frame of Dallas's first
  drive from the line of scrimmage on (Playwright's page clock); the scoreboard band against `/api/state` and the
  timeline's status, mid-game and final; zero console errors and failed requests through Replay and a whole watched
  game at 10x from the drawer; the golden screenshots.
- **Golden screenshots** (7.3): `tests/e2e/goldens/under-the-lights/{final,presnap,midflight,incomplete,drawer}-
  {1440x900,1920x1080}.png`. GPU renders (Chromium's new headless mode, `channel="chromium"`; the e2e `browser`
  renders with SwiftShader, the engine's low tier), the page clock installed and frozen on its 16 ms frame grid, so a
  ball in flight is caught on the same frame every run (counted by the engine from its first frame). Compared within 1%
  of pixels (a channel off by more than 24); `SC_UPDATE_GOLDENS=1` rewrites them; a failure leaves the capture in
  `test-results/visual/under-the-lights/`; without a GPU (tier low) the comparison is skipped with the reason.

## 23. v1.4: the next call's time, the live feed's safety and the backend (G1, 2026-10-10)

### 23.1 The next call stays up before every Dallas snap

At the default 4x his next call and its shadow plays were on the field for 0.31 to 0.62 s before each Dallas snap (11
snaps, GPU Chromium): the snap came 1.75 s after the play before it (DC E3: 7.0 s at 1x, divided by the speed), and the
queue gave that play 80% of the wait. Two pieces fix it, sized from the time the call needs: the verdict's beat
before it (conductor, G2-3: 1.5 s below 4x, 0.6 s from 4x), its 400 ms fade-in, and 2 s fully lit up to 4x (1 s above).

- **Server (`watch.py`):** a caller snap waits at least `CALLER_FLOOR_S`: 6.0 s below 4x, 4.8 s at 4x, 3.6 s above
  (seconds at that speed, still times `SHADOW_WATCH_SCALE`). The watch object names the pace of the row it waits on,
  `next_kind` (`caller_snap`, `snap`, `kick`, `admin`, `admin_end`), in `/api/version` as well (DC E1).
- **Client (`core/anim-queue.js`):** when `next_kind` is `caller_snap`, the play before it is held to
  `next_at - now - reserve`, with `reserve = min(CALL_RESERVE_MS, 0.7 * (next_at - now))` and `CALL_RESERVE_MS` 4100 ms
  below 4x, 3200 at 4x, 2400 above. A watch object older than the head row (`watch.idx < row.seq`, its `next_at` that
  row's own landing) isn't budgeted on: the play waits for the next `/api/version`, at most 600 ms. That stale case cost
  the call about 0.5 s whenever the timeline answered before the version poll (the play ran its full length).

Measured (unscaled sandbox, GPU Chromium with Metal; window = `#field[data-ghosts]` up until the snap takes it down):
1x 3.41 to 3.90 s; 2x 2.63 to 2.93; 4x 2.62 to 3.29 (median 2.73, both worlds); 10x 1.45 to 2.59 (median 1.88). Before:
4x median 0.44, 10x 0.29. The new e2e `tests/e2e/test_watch_presnap_exposure.py` asserts at least 2.0 s at 4x, on the 2D
field with the suite's browser and on the 3D field with a GPU browser.

**Found, not fixed here (2D field, `field/fallback-player.js`, another owner):** `remount()` sets `start: null` on every
camera frame, so a play stands still while the 2D camera eases (`look.cameras.moveMs`: 1100 ms on Under the Lights, 600
on neutral) and every 2D play overruns its budget by that much (measured: 2.53 s against a 1.43 s budget on Under the
Lights, 2.04 s on neutral). Keeping `start` through a remount fixes it. Until then the 2D variant of the exposure test
allows for that overrun (2.0 s minus the world's `moveMs`), still far above the 0.31 to 0.62 s it was written against.

### 23.2 Vocabulary: shadows, not ghosts

Sam's word, the copy and play-drawing.md say **shadow plays**: his top 2 drawn dashed and translucent before a Dallas
snap. The code kept the older word: `field/ghosts.js` (`buildGhostSet`, `ghostInputFromPred`), `ghost-layer.js`,
`fallback-ghosts.js`, `#field[data-ghosts]`, `look.ghost`. Read "ghost" in code as "shadow". At the time of writing
`buildGhostSet` still builds the input both engines take (17 references in `static/js`), so G2-1's removal of the
GhostSet is not in the code yet; this section is corrected when it lands.

### 23.3 Rows typed by hand (DC D)

A flag typed with no play is now a timeline row of kind `penalty` in ESPN's shape (the flag at the line, the walk to the
enforced spot, "Flag · false start on DAL · −5"); a no-play walks to its own enforced spot; shorthand `I` (or `INT`) is
an interception (`result.turnover_kind: "int"`), `F` a fumble. The flag rows are timeline rows only: the play log,
metrics, archive and CSV list snaps.

### 23.4 What the server answers (DC H)

Every POST answers 400, 409 or 500 with the state body and `error`, and only a real fault is a 500 (with its traceback
in the server log); error pages are JSON; every answer carries `frame-ancestors 'self' http://localhost:*
http://127.0.0.1:*`, `nosniff`, `no-referrer` and `same-origin` opener isolation. The live feed checks the teams, keeps
the summary on screen through a bad poll, backs off, refuses redirects and answers over 8 MB, and is backed up before it
adds to a typed game or follows another event.

### 23.5 Tests

- `tests/e2e/test_watch_presnap_exposure.py`: the call's window before Dallas snaps in a real-time 4x watch (23.1).
- `tests/e2e/test_ui_hostile_text.py`: markup in team names, the venue and a flag's words stays text, on both worlds and
  both engines.
- `test_ui_checklist_flags.py` (G1-4: typed flags drawn with their words; a no-play's own spot) and
  `test_ui_checklist_shorthand_drive.py` (G1-5: `I` is an interception on the field).
- Python: `test_watch.py` (floors, `next_kind`, pruning), `test_espn_replay.py` (matchup, bad and thin polls, raw file,
  backoff, redirects and size, the seen file's event), `test_timeline.py` (600 seeded mutations of a real summary;
  flags and interceptions typed by hand; another game's file kept), `test_api_safety.py` (the feed refusing another
  matchup, headers, bad bodies, 500s, the replay's message, the model-rebuild guard), `test_backend_gaps.py` (CSV, caps).
