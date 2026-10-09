# Build reports (2026-10-09)

Final reports of the finished build packages, verbatim, for the agents that continue the build. Newest direction: docs/design/play-drawing.md (binding).

## seed:design-system

I wrote the design system for Under the Lights, the direction contract (148 words) and the surface brief. I also checked the main layout numbers in a static mock of the screen, with the real fonts, at 1440 and 1920.

1. **North Star "The Stadium Is the Interface".** Only three materials: LED panels (`#0F1114` with a visible 4px grid of unlit pixels `#2A2622`), flat painted steel (`#1C2333` and `#283149`, 2px corners, a 2px `#4A5571` highlight on top edges), and the lit field. No shadows, glass or gradients. Only the tower lamps, the LED boards in the bowl and the ball's tracer glow.
2. **LED colors.** Warm white `#FFF3D1` (17.1:1 on the panel) for pass, gold `#FFD27A` for RPO, amber `#FFB21E` for run and digits (unlit digit color `#3A2E1C`), dim text `#B9AD92`. Lamps are tally red `#FF4D3D` and green `#7DDB6A`. LED never shows a team color; team logos are the only exception.
3. **Scene colors.** Night sky `#0D1424` (never black), haze `#26314C`, light-cone white `#F4F1E6`, turf `#3F8C3B` / `#46983F`, paint `#F5F7F2`, line to gain `#FFD400`, line of scrimmage `#4A90FF`, pylons `#FF6A13`, goalposts `#FFC425`. The day palette is provisional.
4. **Scoreboard band.** Painted the offense's exact ESPN color (`--sc-team-off`), with white or black captions (`--sc-team-off-ink`); the worst possible team color still reaches 4.58:1. Without team colors it is `#33405C`.
5. **Fonts.** Big Shoulders Display 800 for captions and the call name, Big Shoulders Text for all other words, and Doto (weight 800, ROND 60) only at 40px and up. All self-hosted in `static/fonts/under-the-lights/` with their OFL licence files.
6. **Sizes (1440 / 1920).** Call percentage in Doto 64/88. Call name 40/54, which fits all 14 play names on one line (widest 357.9 and 483.1px). Scores in Doto 44/56; SHADOW v LEAGUE values in Doto 40/48; captions 19/24; ribbon text 22/28; body 16/20; small 15/20. Nothing under 20px on the TV.
7. **Layout at 1440.** Top ribbon y 0–44; video board at (1000, 64) 416x324; control desk under it at (1000, 404) 416x296; lower ribbon y 716–756; scoreboard band y 760–900. **At 1920:** ribbon 56px; board at (1312, 80) 560x430; desk at (1312, 526) 560x298; lower ribbon y 840–896; band y 900–1080.
8. **SHADOW v LEAGUE row.** Exactly three of the scorecard's pairs: called right, actual play in his top 3, pass/run log loss. An amber lamp marks whichever side leads. There is no cell for a league top-pick count or a league tilt count, at any size.
9. **Motion.** Text steps in at 12 fps (83ms frames, 5 steps); the call and the projection scan in over 400ms; the lights dip to 80% over 300ms, with an OFF setting for live games (`sc:uls:dip-live`); digits snap. Cameras go by height: wide for the drive, tight for the snap, blimp for the game, with a blimp drift between drives in Watch this game. Everything is instant under reduced motion.
10. **The projection.** The top call is lit on a 1-yard grid in warm white, below the bloom threshold. Second and third calls show only their outlines, at 45% and 25%. The name and percentage are lettered on the turf, and the top call stays at 15% after the snap.
11. **Drawn paths.** Every path has a light core (team color mixed 65% toward light-cone white); the team color only goes on edges. Estimated parts are drawn as a checkerboard at 60%. TB red against turf is 1.03 on the data contract's reference turf (1.49 on this world's turf); Dallas navy against the night sky is 1.30.
12. **Where things live.** Each section of the page sits in one place at a time. B opens the control-room drawer (feed controls, situation, flags, settings). G opens the stat board (scorecard, tendencies, team stats, play log). In manual mode the editable situation strip sits above the board, because the off-field message says "click Ball on above".

**What the build agents must not miss**
- **Doto's period and colon.** They are plus-shaped clusters, so ".421" reads as "+421" and "8:41" as "8‡41". The LED font stack must start with a patch face, "ULS LED Punct", that takes only those two characters from Big Shoulders Display.
- **No tabular figures in Big Shoulders.** It has none (1111 is 41.8px wide, 8888 is 73.8px). Any number that changes in place must be Doto, with an unlit "8" behind every digit. Each digit cell must take its width from that unlit 8 (stack both in one inline-grid cell), or the 8 spills over the captions.
- **No spare space.** The board's content ends 276px down a 290px face at 1440, and scoreboard row one ends at x 1394 of 1440. Anything new there replaces something. Keep the call name's letter spacing at 0.
- **Missing engine and app hooks.** I added a proposed v1.2 note to `ui-architecture.md`. The world needs:
  - camera margins so the board column doesn't cover the line of scrimmage;
  - a day or night look chosen from the kickoff time;
  - automatic camera moves: cut to tight at the snap, blimp drift between drives;
  - a scene brightness lift for `data-ambient="room"`;
  - an optional D key to expand the board (hover and focus do it for now);
  - per-pair hooks on the scorecard so the band can place its three pairs.
- **Small JavaScript still needed.** Paging long ribbon messages, and lighting the retag keys for 8 seconds after each Dallas play.
- **No comps.** No visual comps were generated in this run; the first build should be checked with Playwright renders at 1440x900, 1920x1080 and 390x844.

The app's theme code already makes Under the Lights the default world, with the room lights set to dark. Only docs changed, and the node tests pass (642/642).

Files are in `/Users/samgoldfeder/Dev/shadow-caller`:
- `DESIGN.md`
- `docs/design/direction-contract.md`
- `.impeccable/surfaces/static-index-html.md`
- `docs/design/ui-architecture.md` (an additive v1.2 note, the second paragraph after v1.1)

Mock screenshots are in `/private/tmp/claude-501/-Users-samgoldfeder/faa63d11-343f-408c-bfba-897d976141aa/scratchpad/mock/out/`.

## A0+A10:shell-theme

A0 (shell and boot) and A10 (theme contract) are built, tested and checked in a real browser. The page boots in the neutral world, shows every mount point, and never goes blank. A part that is missing or throws leaves a visible notice in its own region, and boot continues.

One existing test is red: `tests/e2e/test_smoke.py`. Its console errors are all 404s for 48 files the other packages haven't written yet (A5/A6 engine, A7/A8/A9 components and their CSS, `ui/dialogs.js`, and W3's `theme/worlds/under-the-lights/index.js`). There are no errors of any other kind, so it should go green once those files exist.

**Verification**
- Node: 648/648 green in both runners (`node --test 'tests/js/**/*.test.mjs'` and `node --test tests/js/`); 114 of those are new. Lines covered are at least 96% in every module I own.
- Pytest (not e2e): 244 passed.
- Browser, sandbox on port 5300, `?world=neutral`, with only the other packages' missing files stubbed: 0 page or console errors on load and after 3 s idle, at 1440x900, 1920x1080, 1041, 1040, 760 and 390 px. All 27 mount points present.
- #1: the title is "Shadow Play-Caller". `#gameLabel` and `#whoLabel` come from A9's masthead, so that part can't be checked until it lands.
- #2: holds for my layer; see the smoke test note above.
- #7: the rail sits beside the main column at 1041 px and stacks under it at exactly 1040 px. The families switching to 2 columns at 760 px belongs to A7's `prediction.css`.
- #8: document width equals viewport width at every size, including 390.
- Boot failure: shows "Can't reach the app server. Retrying in N s.", the countdown ticks once a second, and it recovers to ready when the server answers.
- Default world: `under-the-lights` doesn't exist yet, so it falls back to neutral with a visible notice.
- My sandbox (port 5300) is stopped.

**Files** (all under `/Users/samgoldfeder/Dev/shadow-caller/`)
- Shell: `static/index.html` (rewritten), `static/css/base.css`, `static/css/layout.css`, `static/js/main.js`
- `static/js/ui/dom.js` (shipped first so A7/A8/A9 could start), `static/js/ui/scheduler.js`
- New shell helpers, added to the 1.1 tree: `static/js/shell/{prefs.js (pure), bindings.js, mount.js, engine.js, notices.js}`
- Theme: `static/js/theme/{tokens, look-schema, neutral-look, team-colors, apply, registry}.js`, `static/js/theme/worlds/index.js`, `static/js/theme/worlds/neutral/index.js`, `static/css/worlds/neutral/tokens.css`
- Tests: `tests/js/{dom, scheduler, tokens, team-colors, look-schema, registry, apply, shell-prefs, shell-bindings, shell-mount, shell-engine}.test.mjs`, plus `tests/js/fake-dom.mjs` (a small fake DOM for node tests of DOM modules)
- `tests/js/static-rules.test.mjs`: extended. `shell/prefs.js` is now policed as pure. Only engine and world scene code may import `three`. `main.js` and `shell/` must load components, the engine and worlds only through dynamic `import()`.
- `docs/design/ui-architecture.md`: dated v1.2 note at the top, new lines in the 1.1 tree (including "v1.2: dom.js moved to A0 so A7/A8/A9 can start together"), and a new section 9. I touched no other package's files.

**REQUIRED_TOKENS (54, in order)**
- Ground and ink: `--sc-bg`, `--sc-surface`, `--sc-surface-2`, `--sc-surface-raised`, `--sc-scrim`, `--sc-ink`, `--sc-ink-muted`, `--sc-ink-inverse`, `--sc-rule`, `--sc-rule-strong`
- Meanings: `--sc-pass`, `--sc-run`, `--sc-rpo`, `--sc-gain`, `--sc-los`, `--sc-good`, `--sc-bad`, `--sc-warn`, `--sc-live`, `--sc-focus`
- Type: `--sc-font-display`, `--sc-font-text`, `--sc-font-num`, `--sc-size-call`, `--sc-size-xl`, `--sc-size-l`, `--sc-size-m`, `--sc-size-s`, `--sc-size-xs`, `--sc-weight-regular`, `--sc-weight-strong`, `--sc-weight-display`, `--sc-case-label`, `--sc-tracking-label`, `--sc-leading-tight`, `--sc-leading-body`
- Space and shape: `--sc-space-1` through `--sc-space-6`, `--sc-radius-s`, `--sc-radius-m`, `--sc-radius-l`, `--sc-border-w`, `--sc-focus-w`, `--sc-gutter`, `--sc-field-aspect`
- Motion: `--sc-dur-fast`, `--sc-dur-med`, `--sc-dur-slow`, `--sc-ease-out`, `--sc-ease-in-out`

`RUNTIME_TOKENS` (9, set by `theme/apply.js`; worlds read them but never define them): `--sc-team-caller`, `--sc-team-caller-alt`, `--sc-team-caller-ink`, `--sc-team-opp`, `--sc-team-opp-alt`, `--sc-team-opp-ink`, `--sc-team-off`, `--sc-team-off-ink`, `--sc-team-def`.

DESIGN.md's token map uses exactly these names; the world's private tokens use the `--uls-` prefix. `tokens.js` also gives W3 helpers to check its own `tokens.css` in node (`tokensFor`, `tokenProblems`) and the page at runtime (`missingTokens`).

**Look schema**
- `validateLook` returns every problem with its path, for example "lights[2].intensity must be >= 0". An unknown key is a problem at every level, so typos never pass silently.
- `resolveLook(partial, base = NEUTRAL_LOOK)` deep-merges (objects merge, arrays and null replace), validates, copies, deep-freezes, and throws `LookError` listing every problem.
- Top-level keys:
  - `id`, `version` (must be 1)
  - `renderer`: toneMapping, exposure, shadows, shadowMapSize (1024 or 2048), antialias, clear, clearAlpha
  - `environment`: background, fog (null, exp2 or linear; far must exceed near), ibl, iblIntensity
  - `lights[]`: unique ids; directional and spot lights need a position; at most 2 cast shadows
  - `field`: turf (2 colors), stripeYd (5 or 10), paint, surround, end zones, numerals, hashes, plinth, roughness, metalness, grain
  - `lines`: los and ltg, each color, widthYd, opacity, mode
  - `ball`: kind, colors, scale, and a trail
  - `strokes`: exactly arc, ground, corridor, area, band, mark
  - `ghost`: 3 opacities in [0, 1]
  - `lastPlay`, `residue`
  - `labels`: className must be CSS class names
  - `post`: bloom, extra pass names
  - `cameras`: 1 to 8 modes with unique ids; `default` and `inset.mode` must name a mode
  - `motion`: every `field/timing.js` DEFAULT_MOTION key (including `minRowMs`) plus ghostInMs, ghostOutMs, verdictMs
  - `teamColor`: minContrast, against
  - `world` (new, optional): plain JSON data the world keeps for itself
- `NEUTRAL_LOOK`: gray and flat-lit, no bloom or fog; camera modes sideline, endzone, overhead.
- `team-colors.js` matches the DC C2 contrast table to within 0.01. `teamPaint` returns fill, edge, core, ink and alt, falling back from the primary to the alternate color, then to a light core. It also exports `legibility` (against turf, night and white), `liftToLuminance`, `mixHex`, `inkOn` and `minContrastAgainst`.

**Mount point ids** (`index.html`)
- `#app`, then `#rg-masthead`, `#rg-feed`, `#rg-scoreboard`, `#rg-situation`, `#rg-field`, `#rg-transport`, `#rg-call` > `#heroArea`
- `#entry` > `#lastPlay[hidden]`, `#manualEntry`, `[data-mount="shorthand"]`, `#entryHint`
- `#rg-flags` > `#flagPanel[hidden]`
- `#rg-plays`, `#rg-drives`, `#rg-wp`, `#rg-score` > `#kpiArea`, `#rg-box`, `#rg-tendencies`, `#rg-log` > `#logArea`
- Outside `#app`: `#rg-conn`, `#rg-boot` (with a static loading placeholder), `#toast`, and the new `#sc-notices` tray.
- Also new: a `.sc-skip` "Skip to the next call" link and `<link id="world-css">`. The import map is per spec; link order is base, layout, the 22 component stylesheets, the world stylesheet, then `main.js`.
- Component roots are in section 9.1. Two differ from the original 2.6 table and need A7/A9 to follow them:
  - **entry-pad:** gets `#entry` and must not clear it, because it also holds the last-play and shorthand roots. The shell now names any component that removes a shell id.
  - **review-banner:** `main.js` mounts it into `#rg-field` itself, so the field host should not mount it too.

**Boot order** (`main.js`)
1. Read prefs (`?world`, `?scene=2d`, `?ambient`, `?capture=1`, `?debug=1`, the `sc:` stored choices, reduced motion). Start fetching every component module and the 2D engine in parallel.
2. Choose the world: `?world=`, then `sc:world`, then `under-the-lights`, then neutral, with a notice whenever one is skipped or fails. Resolve its look, set the `<html>` attributes, load its CSS, check its tokens, run its `arrange`.
3. Create the store, API client, form hub, dialogs, sync and actions.
4. Mount the components in table order and start the scheduler, plus three shell bindings (team colors, possession colors, display prefs).
5. Start the engine: 2D when `?scene=2d` or there is no WebGL2; otherwise `field/scene.js` with an 8 s limit, falling back to 2D with a notice and `#field[data-scene-error]`. Then set the camera modes and the stored or default camera.
6. Start the conductor (it can swap in 2D at runtime), attach the keyboard, watch reduced motion, then `sync.start()`. `?debug=1` exposes `window.__shadowDebug`.

**New contract points for other packages** (all in ui-architecture.md section 9)
- A component's object returned by `mount` may carry the Form methods (directly or under `.form`); `ctx.form` forwards to whichever component has them.
- The scheduler calls `deps(state, env)` with `env = { now, extras }`, where extras is `{ cameraModes, engine }`. The field host re-renders when the engine changes.
- A world module may export `default`, a named `world`, or its fields directly. It can add `booth: { holds: [region names] }` (X then opens the booth when it holds flags) and `ambient: "room" | "dark"`. DESIGN.md makes `dark` the default for Under the Lights, so W3 should set `ambient: "dark"`.
- Once W5 ships `css/components/scrub.css`, the A0 owner must add its link to `index.html`. Linking it now would be another 404.

## backend:gaps

All six backend gaps are fixed, and the whole non-e2e suite passes: 244 Python tests (was 223) and 642 JS tests. The e2e smoke test fails, because the in-progress frontend shell asks for files that don't exist yet. Every 404 is a missing `static/css/components/*.css`, `static/js/ui/*.js` or `theme/worlds/under-the-lights/index.js` file. No API route 404s.

**What changed (endpoints and fields)**

1. **G8, versions only go up.** Every save now takes a number higher than any used before, including after undo, reset, replay, watch start and watch restore. `/api/version` reads the new `engine.version`, so a reader never sees the number drop, even halfway through a reset. Epoch behaviour is unchanged.

2. **G22, no field goal off the field.** `POST /api/drive {"end":"fg"}` and the shorthand `fg` with no active drive return 400 with "No DAL drive in progress, so there's no field goal to add. To fix the score, type it like 'DAL 3 TB 0'." Nothing changes. `end` must be `punt`, `fg`, `fg_miss` or `half`, otherwise 400. The end-of-drive messages are kept word for word, so checklist items #86 and #87 still hold.

3. **`until` on `GET /api/timeline`.**
   - It is checked the same way as `since`: "until must be a whole number", and "until can't be before since" (both 400).
   - The response is the timeline as of row `until`: `n` is `min(until, rows applied)`, rows run from `since` to `n`, and drives, status and box are as they stood at row `n`. This works in manual mode too.
   - The body echoes `until`. Without `until` the response is unchanged.
   - `since=k&until=k` returns only the snapshot at row k, with no rows.

4. **New `game` object**, sent only when `since=0` or on reset. For TB at DAL it is `{"kickoff": "2026-10-09T00:15:00Z", "kickoff_local": "2026-10-08T19:15:00-05:00", "venue": "AT&T Stadium", "city": "Arlington", "indoor": null, "grass": false, "light": "night"}`.
   - Local time comes from the venue's US state or, abroad, its country.
   - `light` is `night` when the local kickoff hour is 17 or later, or unknown.
   - `indoor` comes only from ESPN's own flag. None of the 65 cached 2026 games has that flag, so it is always null for now.
   - No scores, records or results.

5. **`box_espn` and `box_source` in every timeline response.**
   - `box_espn` is ESPN's own box score in the same shape as `box`. `box_source` is `"espn"` when it is sent, otherwise `"derived"`.
   - It is null in Watch mode, in manual mode, for an `until` earlier than the newest row, and until every play in the summary has been applied. The last rule covers a watch stopped partway, which would otherwise show the final box.
   - It is also null if any field fails to parse, so the UI never gets a mix of the two.
   - Measured on the 65 cached 2026 games: the derived box matches ESPN in every field on only 22 of 130 team-games (total yards differ on 74). That differs from the 56/130 in the brief. ESPN's box parsed on all 65 games.

6. **Undo and shorthand.**
   - (a) I chose to refuse the undo rather than remove the id from the seen list. Re-applying the play would put it after plays applied since, out of order, and would knock a watch's play counter out of step.
     - Every play applied by the feed, a replay or a watch now blocks undo past that play. `POST /api/undo` returns **409** with the state and "Undo can't take back a play ESPN logged: the feed would never log it again. Retag the last play with A, N, O or P, or type the fix." Version and epoch stay the same.
     - A retag or typed fix made after the newest ESPN play can still be undone.
     - Resetting an ESPN game, starting a watch, or restoring after one clears the undo history, so U then says "Nothing to undo." This also stops the old G9 double-logging after reset and undo. A typed (manual) game can still be undone after a reset.
   - (b) A shorthand line now writes nothing until its last segment succeeds, then saves once. A bad segment or a failed save leaves the game file, the DuckDB archive and the version untouched, so no version number is reused.

**Changes to other teams' contracts (in the v1.2 note in ui-architecture.md, Appendix B)**
- The note includes an override of the data contract's "don't use ESPN's boxscore for display" rule, outside Watch mode only.
- Checklist #99 ("U undoes" with the feed on) now gets a 409 red toast after a fed play.
- The data contract's rule that undo stays allowed during a watch is bounded by the same rule.

**Verified live:** sandbox on port 5440 (since stopped). Versions went 1, 2, 3, 4, 334, 335 through reset, play, undo, replay and reset. A watch at 10x never sent `box_espn`, and its versions only went up. With the feed on: undo returned 409, undoing a retag returned 200, and reset then undo returned "Nothing to undo."

**Notes:**
- I moved the team-header, PAT, clock and score text helpers from `timeline.py` into `timeline_text.py` to keep `timeline.py` under 800 lines (now 794).
- `live.py` was already 864 lines before this work and is now 913.
- I rewrote one existing test, `test_undo_never_takes_an_espn_play_back_out` (the old version tested the buggy undo).
- I added one line to `test_watch_backs_up_state_and_seen_then_resets`, because feed plays no longer leave undo steps.

Files I wrote outside the six I own (both additive): the two new test files and the two edited tests below, plus the v1.2 note in `docs/design/ui-architecture.md`.

Files:
- /Users/samgoldfeder/Dev/shadow-caller/app.py
- /Users/samgoldfeder/Dev/shadow-caller/live.py
- /Users/samgoldfeder/Dev/shadow-caller/timeline.py
- /Users/samgoldfeder/Dev/shadow-caller/timeline_text.py
- /Users/samgoldfeder/Dev/shadow-caller/espn_feed.py
- /Users/samgoldfeder/Dev/shadow-caller/watch.py
- /Users/samgoldfeder/Dev/shadow-caller/tests/test_backend_gaps.py (new, 18 tests)
- /Users/samgoldfeder/Dev/shadow-caller/tests/test_api_backend_gaps.py (new, 3 tests)
- /Users/samgoldfeder/Dev/shadow-caller/tests/test_api_safety.py
- /Users/samgoldfeder/Dev/shadow-caller/tests/test_watch.py
- /Users/samgoldfeder/Dev/shadow-caller/docs/design/ui-architecture.md

## A5a:stage

A5 part 1 (the 3D stage) is built and working in the real app. `field/scene.js` implements the whole Engine interface with a complete static world. Plays and ghosts run on placeholders that part 2 replaces by editing one table, `LAYER_FACTORIES` in `field/layers.js`.

**Test results**
- Node: 1,043/1,043 in both runners; 105 of those tests are new and mine.
- Pytest (not e2e): 246 passed.
- E2e: the full suite gave 228 passed, 7 failed. The run overlapped other agents' runs, so the CPU was heavily loaded. When I re-ran the 7 failures (9 test cases with parameters), 8 passed. The only one still failing is `test_smoke`. Its only failure is a 404 on `theme/worlds/under-the-lights/index.js`, which W3 hasn't written yet; this is the failure A0 already reported. On the final code the field, camera-cycle and timeline/watch e2e files passed 28/28.
- Browser: 0 console errors from the engine on GPU or SwiftShader, in my test page and in the real app (`/?world=neutral`). I started a drive with `new D25` and the conductor drew it: LOS and LTG in place, three ghost zones, and the field host reporting `data-los 75`, `data-ltg 65` and the correct label.

**Measured (Apple M4 Max GPU, headless Chromium)**

| Scene | Size, DPR | Draw calls | Triangles | During a 4 s play | Engine CPU per frame |
|---|---|---|---|---|---|
| Neutral look, drive with 3 ghosts | 1440x900, 2 | 20 | 3.7k | 60 fps, p95 16.8 ms, no dropped frames | p50 0.2 ms, max 0.4 |
| Night test look (stadium bowl, 4 towers, 20k crowd) | 1440x900, 1 and 2 | 36 | 31k | 60 fps, p95 16.7–16.8 ms | p50 0.4 ms, max 0.5 |
| Same | 1920x1080, 1 and 2 | 37 | 31k | 60 fps, p95 16.7–16.8 ms | p50 0.4 ms, max 0.6 |
| Same, SwiftShader (low quality tier) | 1440x900, 1 | 22 | 31k | not measured | not measured |

- **Frame time:** headless Chromium caps frames at 60 Hz. The frame column only proves no frame took longer than 16.7 ms; the CPU column shows the headroom.
- **Idle:** 0 frames and 0 animation-frame callbacks over 2 s, both after the first camera glide and after a 1.1 s camera move.
- **Memory:** I warmed the scene up first, then drew 183 rows instantly, ran plays, ghosts and situations, and rebuilt the game frame 4 more times. Geometry, texture and shader-program counts did not move.
- **Play timing:** `playRow` resolves in 3011–3017 ms for a 3000 ms plan.

**Bugs found and fixed while building**
- three r185 keeps a hidden animation-frame loop running forever if you stop its render loop from inside a frame, and each restart adds another. The recipe's stage code does exactly this, and frame counters can't see it. `renderer.js` now runs its own loop.
- At the night look's fog density, distance haze washed out about 45% of the field at blimp range. Everything on the field now ignores fog; only the far ground beyond the sidelines fades into the haze.
- The ball-following camera was being pulled back by the full-width pass-zone ghosts. Follow modes now frame only the ball.

**Changes outside my package (all small and additive)**
- `static/js/shell/engine.js` and `static/js/main.js` now pass the world module to `createEngine`. World props, moments and post passes need this.
- `tests/js/static-rules.test.mjs`: added my three pure modules to the PURE list (A6 did the same for theirs).
- `docs/design/ui-architecture.md`: a v1.2 note at the top, the new files in the 1.1 tree, and a new section 14 holding the as-built record and the API part 2 builds on.

**Contract decisions other packages should know about**
- **Field hooks:** A9's field host already writes the 5.3 hooks by mirroring `debugState()`. If the engine also wrote them, the two would disagree on `data-anim-state` and during review. So the engine's own hook writer is off by default (`hooks: true` turns it on for pages without the field host).
- **`debugState().ready`:** this now means "first frame after the latest `setGameFrame` is drawn", which the field host turns into `data-scene-ready`.
- **Engine extras:** the same as the 2D engine's: `setGameFrame`'s optional 4th argument `game`, `setSafeArea(insets)`, and the `--sc-field-safe-*` CSS properties.

**Internal API for part 2 (full detail in section 14.3–14.6)**
- **The `stage` every layer receives:**
  - scene parts: `THREE`, `coords`, getters `look` and `frame`, `scene`, and one root group per layer in draw order (`field`, `props`, `residue`, `ghosts`, `situation`, `overlays`, `plays`, `labels`);
  - tools: `kit` (materials), `labels`, `cams` (camera rig), `lines` (situation paint);
  - functions: `requestRender()`, `keepAlive(fn)`, `reducedMotion()`, `visible()`, `lights()`, `emit()`;
  - `layers`, so the player can reach residue.
- **The layers part 2 implements:**
  - `player`: `start(drawing, plan, row)` returns a job with `update(tMs)` (true while still drawing), optional `ball()` and `finish()`. Also `placeAll(items)`, `review`, `relabel`, `verdict`, `clear`, `dispose`.
  - `ghosts`: `show`, `highlight`, `fade(k, ms)`, `clear`, `dispose`.
  - `overlays`: `situation(sit)`, `clear`, `dispose`.
  - `residue`: `add`, `relabel`, `clear`, `dispose`.
- **What the facade does around a play:** it owns timing (the plan is fitted to `durationMs`), tokens and the play promise. It holds back `showGhosts` while a play runs (last call wins) and fades the call at a caller snap. When a play ends, it puts the resting ball at the play's end spot, so a player that draws its own ball must hide that ball when `update` returns false.
- **Rules for layers:** `stage.lines.setBallVisible(false)` when the player draws its own ball. Never dispose kit materials; they are shared, so fade them with `kit.fade`. Free what you own with `disposeTree`, which skips shared resources. Use the `LAYERS` table for draw order and polygon offset, never a height offset.
- **Camera tools:** `cams.shot(id)` makes a temporary camera cut (e.g. tight at the snap) without changing the viewer's chosen mode; `cams.follow(ball)` drives the follow modes.

**Things to act on**
- **Possible disruption of another agent:** my own sandbox (PID 53496) stopped by itself around 13:29; its log just ends, with no error. At cleanup I killed the listener on my assigned port 5310 using the prescribed `lsof` command. That listener turned out to be a different process, PID 88255, started at 13:31 by someone else. If another agent lost a server on 5310, that was me.
- **Optional asks, so the world hooks fully apply:**
  - A1: pass the timeline's `game` to `setGameFrame`, so day games get the afternoon look.
  - W3: set `--sc-field-safe-*` (1440: top 44, right 456, bottom 184 px) and `--sc-font-display`; the field's numbers and end-zone names are painted in that font.
  - A0: show the engine's new `warning` events in the notice tray.
- **The night look in my screenshots is a stand-in**, not W1's world. I built a test look and stadium props from DESIGN.md's values, only in my scratch folder, to check the hooks. With physical light falloff, towers that are too bright or too close make the white paint near them bloom. W1 should start from about 1.5e4 per tower with a 0.9 penumbra (section 14.6).

Files are in `/Users/samgoldfeder/Dev/shadow-caller/`:
- **Engine:** `static/js/field/scene.js`, `stage.js`, `layers.js`, `renderer.js`, `lighting.js`, `post.js`, `field-mesh.js`, `turf.js`, `decals.js`, `structures.js`, `lines.js`, `cameras.js`, `materials.js`, `shaders.js`, `labels.js`, `moments.js`, `dispose.js`, `webgl-support.js`
- **Pure helpers:** `static/js/field/field-spec.js`, `stage-math.js`, `engine-state.js`
- **Tests:** `tests/js/field-spec`, `stage-math`, `engine-state`, `webgl-support`, `dispose`, `materials`, `cameras`, `lighting`, `lines`, `field-mesh`, `labels`, `stage-parts`, `stage-host`, `scene-engine` (all `.test.mjs`), plus `tests/js/three-env.mjs` and `three-hooks.mjs` (load the vendored three.js in node)

Screenshots are in `/private/tmp/claude-501/-Users-samgoldfeder/faa63d11-343f-408c-bfba-897d976141aa/scratchpad/a5/shots/`:
- **1440x900:** `first-neutral-{sideline,endzone,overhead}`, `night3-night-{wide,blimp}` (with the board-column safe area), `night2-night-{tight,blimp}`, `night4-night-endzone`, `shadow-shadow-{endzone,overhead}`, `swiftshader-night-wide`
- **1920x1080:** `tv-night-{wide,tight,blimp,endzone}`, `tv-neutral-{sideline,endzone,overhead}`
- **390x844:** `phone-night-{wide,blimp}`
- **Retina close-ups (DPR 2):** `detail-tight-goal-dpr2`, `detail-endzone-left-dpr2`
- **Real app:** `app-neutral-1440x900`
- **Mid-play:** `midplay-{0,1,2}-1440x900`

## A6:fallback-2d

**A6 (the 2D SVG fallback engine) is built and verified in a real browser.** It implements the whole Engine interface and draws the same facts as the 3D field from the same pure geometry. The real switch is `?scene=2d`; there is no `?engine=` parameter.

**Results**
- **Node:** 1043/1043 pass in both runners. 99 of them are new, and the six pure modules (`fallback-draw/-ghosts/-plays/-steps/-pixels/-bowl.js`) are now policed by the static rules. My modules have 99.2% of lines covered, and every one has at least 80% of functions covered.
- **Pytest (not e2e):** 246 pass.
- **e2e:** 39/39 pass in `test_ui_checklist_field.py`, `test_ui_timeline_watch.py` and `test_ui_game_surfaces.py`, on both engines.
- **Browser, `?scene=2d`:** 0 console or page errors in the neutral world at 1440, 1920 and 390 px, and through a Watch session. There is no horizontal scroll, and the field's `data-scene-ready` hook turns true.
- **Default world:** the only error is the 404 for W3's `under-the-lights/index.js`, which hasn't landed yet. It falls back to neutral with a notice.
- **Performance under SwiftShader:** 0.3 ms of script per animation frame. A 72-yard run first took 417 ms per frame, because a single SVG made every ball move repaint the whole field. I split the surface into a static SVG and a moving one, each on its own compositor layer. It now renders at 60 fps (16.7 ms per frame) at 1440 and 1920.

**Smoke test is still red, not from A6:** the W3 world 404, plus the replay POST taking 47 s against the test's 30 s timeout. The machine's load average was about 56.

**What it draws**
- Top-down view, caller's end zone on the left, true proportions.
- Height shows as a slight tilt: kicks and passes are true-length arcs that bow by their apex, with a dashed ground shadow.
- Team end zones with their names, split numerals, hashes, gold posts, orange pylons, and the home logo at midfield.
- The line of scrimmage, the line to gain, and a down-and-distance tag.
- The prediction zones, faded by rank, in the look's ghost style (including the coarse pixel projection), with percentages.
- Animated plays: strokes grow along their paths, lanes grow with the ball, marks pop in as 9x9 pixel glyphs.
- Approximate steps drawn as approximate, ghosted no-plays, residue rules, review replays, and verdict chips.
- Overlapping labels are moved apart, and hidden if there is no room.
- Looks that light the field with tower spot lights also get a stadium bowl: stands, a crowd, towers and light falloff. The neutral look stays a plain field.
- I verified the night look with a test look approximating DESIGN.md, because W1's real look hasn't landed. It lives in my scratchpad, not the repo.

**Edits to files I don't own (all additive)**
- `tests/js/static-rules.test.mjs`: one line adding the six pure modules to the pure list.
- `docs/design/ui-architecture.md`: new lines in the 1.1 file tree, a dated v1.2 note, and a new section 13 describing the engine as built.

**Asks of other packages (optional)**
- **A1 (conductor):** pass the timeline's `game` as `setGameFrame`'s 4th argument. Both engines then switch to `look.world.day` for day kickoffs.
- **W3 (layout):** set `--sc-field-safe-top/right/bottom/left` in px on `#field`, so the field clears the HUD. These are the same property names A5 reads.
- Two extensions beyond the interface, matching A5: the 4th `setGameFrame` argument above, and `setSafeArea(insets)`.

Files are in /Users/samgoldfeder/Dev/shadow-caller:
- **Engine (DOM):** `static/js/field/fallback-2d.js`, `fallback-runtime.js`, `fallback-layers.js`, `fallback-player.js`, `fallback-svg.js`
- **Drawing data (pure):** `static/js/field/fallback-draw.js`, `fallback-ghosts.js`, `fallback-plays.js`, `fallback-steps.js`, `fallback-pixels.js`, `fallback-bowl.js`
- **Tests:** `tests/js/fallback-2d.test.mjs`, `fallback-draw.test.mjs`, `fallback-ghosts.test.mjs`, `fallback-plays.test.mjs`, `fallback-pixels.test.mjs`, `fallback-bowl.test.mjs`, `fallback-svg.test.mjs`

Screenshots are in /private/tmp/claude-501/-Users-samgoldfeder/faa63d11-343f-408c-bfba-897d976141aa/scratchpad/shots/final/:
- **Real app, `?scene=2d`, neutral world:**
  - `app-neutral-final-{1440x900,1920x1080,390x844}.png` (whole page)
  - `app-neutral-final-field-{1440x900,1920x1080,390x844}.png` (field element only)
  - `app-neutral-watch-mid{0,1,2}-1440x900.png`
  - `app-neutral-watch-presnap0-1440x900.png` (note: this one caught a play already in flight)
  - `app-neutral-watch-presnap0-page-1440x900.png` (same moment, whole page)
- **Night test look:**
  - `uls-presnap-1440x900.png`, `uls-presnap-1920x1080.png`, `uls-presnap-390x844.png`
  - `uls-midplay-pass-1440x900.png`, `uls-midplay-run-1440x900.png`, `uls-midplay-punt-1920x1080.png`
  - `uls-review-1440x900.png`, `uls-highlight-1440x900.png`, `uls-final-1440x900.png`
- **Neutral look in a 16:9 box:** `neutral-presnap-boxed-1440x900.png`

My sandbox on port 5330 is stopped.

## A7:ui-input

I built all six of A7's input surfaces, and every checklist item in my range now passes: #9 to #37 and #122 on `?world=neutral`. The last full run of everything that drives my components was 107 e2e tests, all passing. One gap: A5's 3D scene wasn't loaded in any of my runs. So hovering or focusing a play is verified only up to the store and back. Nothing confirmed the zone actually lighting on a canvas.

**Verification**
- **e2e, A11's checklist files:**
  - #9 to #26 and G3: `test_ui_checklist_strip.py`.
  - #27 and #28: `test_ui_checklist_field.py`. These use A9's field host plus my end-of-drive row.
  - #29 to #37, #122 and G24: `test_ui_checklist_prediction.py`.
  - The entry, flag and shorthand files also drive my components (#38 to #91). All pass.
- **e2e, my file** (`test_ui_input_surfaces.py`, 13 tests, all pass):
  - A mouse click selects the whole strip value.
  - Hover and focus on a play come back from the store as `data-highlighted`.
  - A family row lights its top play.
  - Tab walks the plays in order.
  - The flag key shows the panel's state.
  - The desk reports its mode and dims off the field.
  - The retag keys light during a watch.
  - Two shorthand lines typed back to back both run.
  - #7: the families show in 2 columns at 760 px.
  - #8: nothing scrolls sideways at 390 px.
- **Node:** 1043 pass with 0 failures (1016 in one run plus A6's `fallback-2d` file run alone, 27, because it hung mid-rewrite in the full run). My 7 test files add 72 tests. My modules are at 99.9% lines, 87% branches and 98% functions.
- **Pytest (not e2e):** 246 passed.
- **Browser:** screenshots at 1440x900, 1920x1080 and 390x844. Document width equals the viewport at all three. No uncaught page errors.
- **Sandbox:** stopped; port 5340 is free.

**Changes during verification**
- Shorthand bar: my first version ignored a line typed while the previous one was still sending, which made #82 fail. Now lines go out in order; only a repeat Enter on the line already out is ignored.
- Situation strip: a value or rejection that arrives while the field has focus now shows once you leave the field. An IME's closing Enter no longer saves.
- Select-on-focus: it no longer selects away a fast typist's first digit. Checked in the browser: K then "12" leaves Yards at "12".

**Changes in files I don't own** (all additive and minimal, described in `ui-architecture.md` §11.1):
- `model/vm-entry.js` (A3): `flagOpen`, so the flag key can show when the panel is open.
- `model/vm-last-play.js` (A3): `pauseFirst`, so clicking a retag key during a playing watch pauses first, like the keyboard does.
- `model/vm-prediction.js` (A3): `barPct` and `leagueBarPct` on families, for the family bar and its league notch.
- `shell/bindings.js` (A0): the entry pad now re-renders when `view.flag` changes.
- `docs/design/ui-architecture.md`: an A7 v1.2 note at the top, a tree line for `ui/input-kit.js`, and a new section 11 listing every hook a world can style against.

**For other packages**
- Two class names collided: A9's field host uses `.sc-field` and A8's play-log table uses `.sc-log`. I renamed mine.
- A9's `masthead.css` styles `.sc-key` across the whole page, so my key rules are scoped to the keypad, the flag panel and the retag row. W2 and W4 should know this before skinning keys.
- In the neutral layout the next call sits below the field, under the fold at 1440x900. That is A0's layout; Under the Lights puts it on the video board.

**Files** (all under `/Users/samgoldfeder/Dev/shadow-caller/`)
- Components: `static/js/ui/situation-strip.js`, `entry-pad.js`, `flag-panel.js`, `shorthand.js`, `last-play.js`, `prediction.js`
- Shared helper (new, A7): `static/js/ui/input-kit.js`
- CSS: `static/css/components/situation-strip.css`, `entry-pad.css`, `flag-panel.css`, `shorthand.css`, `last-play.css`, `prediction.css`
- Node tests: `tests/js/situation-strip.test.mjs`, `entry-pad.test.mjs`, `flag-panel.test.mjs`, `shorthand.test.mjs`, `last-play.test.mjs`, `prediction.test.mjs`, `input-kit.test.mjs`, `ui-input-harness.mjs`
- e2e: `tests/e2e/test_ui_input_surfaces.py`

**Screenshots** (39: 13 states at each of the three sizes) are in `/private/tmp/claude-501/a7/final/`. The most useful:
- `05-tilt-hero-1440x900.png`: the next call on a TILT PASS state with the opening-script note.
- `10-memory-hero-1920x1080.png`: the next call with in-game memory terms.
- `06-tilt-entry-pp-1920x1080.png`: the entry pad with a pick and its tap hint.
- `08-flags-open-390x844.png`: the flag panel on a phone.
- `12-feed-entry-390x844.png`: the last ESPN play with its retag keys.
- `11-memory-strip-1440x900.png`: the situation strip during a drive.
- `09-flags-page-1440x900.png`: the full page with the flag panel open.

## A8:ui-game

The eight game panels are built and working on the neutral world. Clicking a play, a drive or a logged snap shows that play on the field, and clicking it again goes back to live. The new A8 tests all pass. Three suite-level problems are in other packages' work, listed under Tests.

**Changes outside A8's files** (each small, additive and tested; documented in ui-architecture.md, a v1.2 note at the top plus a new section 10)
- `actions.review` only steps one play left or right, so I added `actions.reviewAt(seq)` in `static/js/core/actions.js` (A2). It jumps to any drawn play; `null` returns to live. It never steps or pauses the server, and W5's scrub can use it too.
- **ESPN's own box score (A1, A3):** the cache dropped `box_espn`, so `timeline-cache.js` and `present.js` now keep it as `boxEspn`. `vm-box.js` shows it when it is there, else the counted box, and adds a line saying which one is showing.
- **Other view models (A3):**
  - `vm-plays.js`, `vm-drives.js` and `vm-log.js` mark the reviewed play.
  - Each drive knows its first drawable play.
  - Each log row carries its verdict and its row on the field.
  - `vm-scoreboard.js` adds the dark-background logo URL.
  - `vm-wp.js` adds the caller's abbreviation for the readout.
- **`copy.js` (A3):** new strings, each marked "v1.2 (A8)".
- **`shell/bindings.js` (A0):** the play feed, drive chart and play log now re-render when the reviewed play changes.
- **Existing tests:** I updated the expected shape in three of them (`vm-plays`, `vm-scoreboard`, `vm-log`) for the new fields.
- **Under the Lights:** the scorecard pairs carry `data-pair` and `data-leader` as DESIGN.md asked. A world can switch the scoreboard to ESPN's dark-background logos with `--sc-logo-variant: dark`, and big numbers carry `data-ghost` for the unlit-digit look. Every hook W2 needs is listed in section 10.2.

**Files** (all under `/Users/samgoldfeder/Dev/shadow-caller/`)
- Components: `static/js/ui/{scoreboard,play-feed,drive-chart,win-prob,box-score,scorecard,tendencies,play-log}.js`
- Stylesheets: `static/css/components/` (same eight names, `.css`)
- Node tests: `tests/js/` (same eight names, `.test.mjs`), plus `tests/js/game-surfaces-harness.mjs`
- E2E: `tests/e2e/test_ui_game_surfaces.py`
- Every new file is under 160 lines.

**Tests**
- **New A8 e2e:** 12/12 pass on `?world=neutral&scene=2d`. They cover #6 for these panels, #107, #108, #110 to #115, G15, G16, G18 and the 5.4 hooks after a replay. They also cover review from a row, a drive and a log row, and no sideways scroll at 390 px.
- **Node:** 995/995 across every test file except `tests/js/fallback-2d.test.mjs`. That A6 file was being edited while I worked and now hangs without finishing, so neither the glob nor `node --test tests/js/` completes. Earlier full runs were 1004/1004 in both runners.
- **New A8 node tests:** 52 tests. My eight components are at 98.7 to 100% lines and 82 to 98.5% branches.
- **Pytest, non-e2e:** 240 passed and 4 timed out at 30 s while the machine's load average was 50 to 76. All 4 pass when re-run alone (6.5 s), and none touch files I changed.
- **`test_smoke.py`:** still red. Its only remaining 404 is W3's missing `theme/worlds/under-the-lights/index.js`. With `?world=neutral` nothing fails to load.

**Checked in the browser** (my sandbox on 5350, now stopped): 183 play rows, 21 drives with ESPN's results in order, DAL at 0% win probability, 16 to 24, ESPN's box score (DAL 366, TB 419 yards). No horizontal scroll at 1440, 1920, 1000 or 390 px. The page has no failed resources and no notices with `?world=neutral`.

**Screenshots** (in `/private/tmp/claude-501/-Users-samgoldfeder/faa63d11-343f-408c-bfba-897d976141aa/scratchpad/a8/`)
- `final/`:
  - Full view at each size: `view-1440x900.png`, `view-1920x1080.png`, `view-390x844.png`, plus full-page shots at 1440 and 1920.
  - Each panel at 1440, 1920 and 390: `scoreboard-*`, `plays-*`, `drives-*`, `wp-*`, `score-*`, `box-*`, `tend-*`, `log-*`.
  - Review state: `plays-review-1440.png`, `plays-review2-1440.png`, `log-review-1440.png`.
- `shots/`: `score-1000.png` and `drives-1000.png`, the wide layouts when the rail stacks under the main column.
- `dark/`: neutral with the room lights down (dark logos load).
- `manual/`: a hand-entered game.

## A9:ui-chrome

The A9 chrome is built and checked in a real browser, on the neutral world: masthead, ESPN feed bar, Watch this game controls, field host, review banner, toasts, connection banner, boot screen and confirm dialogs, with their CSS. My e2e file passes all 24 tests. In the final full run 23 passed and one timed out while the page booted (machine load average was 80); it passed on its own straight after.

**Behavior worth knowing**
- **Field host:** it doesn't create the engine. A0's `main.js` and `shell/engine.js` already do that and write `data-scene-error`, which the host leaves alone. The host builds `#field` and the legend, writes every 5.3 hook, re-reads the engine's state on each engine event, and calls `engine.resize` and `engine.setVisible`. A11's context-loss test confirms a lost WebGL context switches the field to 2D.
- **G12:** news from a poll goes to the feed bar's polite `bg-message` region, never a toast, as the architecture says.
- **ESPN game id box:** it now updates only when the server's event id changes. The old rule overwrote it on every render, and the version poll re-renders the bar every second, so an id Sam typed was wiped a second after he left the box.
- **Feed button:** no `aria-pressed`, because its own words already say on or off.
- **Accessibility:** focus moves from Pause to Play (and Stop to Start) when the state hides the focused key. The connection banner, boot screen and review banner each have a polite line that speaks once per change, not on every countdown second. The toast hides by opacity only, so screen readers always announce it. Key caps (U, V, Space…) hide on touch screens.

**Files I own** (under `/Users/samgoldfeder/Dev/shadow-caller/`)
- `static/js/ui/{masthead,feed-bar,watch-transport,field-host,review-banner,toast,conn-banner,boot-screen,dialogs}.js`
- `static/js/ui/keycap.js` (new, in the 1.1 tree): shared key caps and lamps. A7 uses the same markup.
- `static/css/components/{masthead,feed-bar,watch-transport,field-host,review-banner,toast,conn-banner,boot-screen}.css` (`masthead.css` also holds the shared key and lamp styles)
- `tests/js/{keycap,masthead,feed-bar,watch-transport,field-host,review-banner,toast,conn-banner,boot-screen,dialogs}.test.mjs` and `tests/js/chrome-ctx.mjs`
- `tests/e2e/test_ui_chrome.py`

**Edits to files I don't own** (all additive)
- `static/js/shell/bindings.js` (A0): new `fieldHostVm`. The field-host binding now selects it, with `anim` and `view.review` added to its deps, because `fieldVm` doesn't carry the drawn seq, queue, playing seq, review seq or epoch that the `#field` hooks need.
- `static/js/model/copy.js` (A3): 6 strings: `MASTHEAD.gameGroup`, `MASTHEAD.viewGroup`, `REVIEW.earlier`, `REVIEW.later`, `REVIEW.live`, `FIELD.label`.
- `docs/design/ui-architecture.md`: a v1.2 note for A9, the `keycap.js` line in the file tree, and a new section 12 covering these additions, behavior as built and every hook a world can style.

**Tests**
- **Node:** all green in both runners, 1,039 tests at the last count (other agents were adding tests while I ran). My 10 test files hold 84 tests; my modules are at 100% lines, 88.5% branches, 98% functions.
- **Pytest (not e2e):** 246 passed.
- **E2E, `test_ui_chrome.py`:**
  - feed bar: checklist #92 to #105 (excluding #99's keys, below)
  - replay: #106 to #109
  - G12 background news
  - Watch this game: start at a chosen speed, Space, Right steps exactly one play, keys 1 to 4, no play row ahead of the field, Stop restores the game, done then Back and Watch again (stop with restore before the start)
  - offline: connection banner retrying, offline, back online; boot retry (#120); restart screen (#119); toasts #117, #118, #121
  - masthead V, B and G keys, field hooks, review banner, phone width
- **A11's checklists against my components:** field 10/10, load 8/8, feed/replay plus keys/offline plus timeline/watch 45/45.
- **Fixed my own tests:**
  - #99: after two retags, U undoes them first, and only the third press hits the server's "can't take back an ESPN play" refusal.
  - Watch timing: a pause can land while the server is still applying a play, so the test now waits for the field to match the server's live count.
  - Game-length wait: a full watched game can take well over a minute when the machine is busy, so that wait is 240 s.
- **`tests/e2e/test_smoke.py` is still red,** but only on the 404 for `theme/worlds/under-the-lights/index.js` (W3's file). Nothing from A9 is missing.

**Screenshots** (in `/private/tmp/claude-501/a9-chrome/shots/`)
- `drive-1440x900.png`, `drive-1920x1080.png`, `drive-390x844.png`: no horizontal scroll at any width, WebGL field ready, no console or page errors.
- `field-transport-1440.png`, `review-light-1440.png`, `top-dark-1440.png`
- `masthead-390-touch0.png`, `masthead-390-touch1.png`
- `gallery/neutral-*.png` at 1440 and 390: feed off, live and retrying; Watch controls idle, playing, paused, done and error; connection retrying and offline; boot failed and restart; toast info and error; masthead.

My sandbox on port 5360 is stopped. Partway through, port 5360 was being served by a different PID (88253) still using my sandbox's data folder, so it was a restart of my sandbox; I stopped that one.
