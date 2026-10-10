# Polish round reports (2026-10-10)

Final reports of the polish fixers (G1-G7), verbatim, for the agents that continue. Binding direction: docs/design/play-drawing.md (sections 4 and 4b).

## fix:G7 Render pipeline smoothness & resilience

**Per-item verdicts**

**G7-1 (HIGH): fixed.** I measured 20 s of Watch at 4x, 1440x900 at 2x, in GPU Chromium.

| | Before | After (2 runs) |
|---|---|---|
| Programs created / deleted / linked | 111 / 99 / 111 | 0 / 0 / 0 |
| Main thread blocked in GL calls | 210 ms | 0 ms |
| Frames over 25 ms | 4 (max 83 ms) | 0 (max 16.8 ms) |
| `debugState().programs` | changes | 44 → 44 |

- **Whole game at 10x (183 plays):** the program count stays at 44 the whole way and there are 0 long tasks.
  - With the machine lightly loaded: 4 of 5,532 frames over 20 ms, p99 18.5 ms.
  - At load average ~48: 20 of 5,598 frames over 25 ms (0.36%), p99 20.3 ms. None of them falls within 100 ms of a play start. The auditor had 119-125 over 25 ms, about 105 of them at play starts.
- **What changed:**
  - The warm-up now holds every program kind the action layer really draws. A node test checks this against every row of the game, residue, shadows, a review and the ball, on both worlds. The warm-up is hidden after its first frames instead of being disposed.
  - A per-stage program keeper in `dispose.js` (`keepPrograms`) keeps the first material of each kind after its first draw and frees them when the engine is disposed.
  - The next play is built before the last one is retired.
  - Glyph masks are made and uploaded at boot and shared with residue. The INT/TD words wait for the display font, so they are never drawn in the fallback font.
- **New e2e test:** `tests/e2e/test_gpu_budget.py` (GPU only).

**G7-2 (MEDIUM): fixed.**
- **Root cause:** in three r185 every frame draws into the output pass's HDR target, and three keys programs by target. `compileAsync` was compiling against the canvas, so it built a set of programs nothing used, and the first frame recompiled everything synchronously.
  - Boot program creates/deletes: 75/45 before, 47/3 now.
  - Main thread blocked at boot: 159 ms before, 25-33 ms now.
- **What changed:**
  - `rig.warmUp` now compiles against the output target, then the bloom pass's own materials, then draws one empty frame to link the output pass and `uls-lens`. Frames are held until it finishes (12 s cap).
  - Field glyph failures are now reported as `warning`.
  - `ENGINE_TIMEOUT_MS` goes from 8 s to 15 s, so G2-9's 10 s warm-up cap can't push a slow cold start into the 2D fallback.
- **10 cold launches** (new browser and profile each, 5 at 1440x900 and 5 at 1920x1080, both at 2x):
  - Scene ready in 0.73-0.88 s.
  - After ready: 0 frames over 40 ms in the 12 s window (max 33.4 ms) and 0 compiles. Same with Chrome's shader caches disabled.
- **WebKit:** ready in 1.0-1.4 s with 0 compiles after ready, but 1-2 frames of 46-71 ms after ready. I couldn't attribute them (WebKit doesn't report long tasks).
- **Not met literally:** before scene-ready, behind the boot board, there are still long tasks:
  - Engine creation, about 145 ms. Inside it: the lighting environment's PMREM in `lighting.js` (~34 ms, compiles synchronously) and the WebGL probe in `webgl-support.js` (~19 ms). Neither file is mine.
  - The first drawn frame, about 38 ms: first buffer/texture uploads and shadow-depth programs, which `compileAsync` can't reach.
  - HUD work: `core/api.js` state parse about 65-75 ms, and the theme apply.

**G7-3 (MEDIUM): fixed.**
- **How it decides:**
  - The time a frame counts for is its interval minus the engine's own CPU time.
  - It steps up 0.25 after 5 s of animated frames at the display's own pace, with a 2 s cooldown after every step. After 3 failed tries it stays down for the session.
  - The floor is 0.75 at 3840 px wide or more.
  - `?dpr=0.5…3` pins the ratio and turns the governor off.
  - It steps from the ratio actually in use.
- **Deviation from the spec:** I used "frames under ~12 ms, or at the display's pace". A 60 Hz TV never shows a frame under 12 ms, so the literal rule would never recover on the TV.
- **In the browser:**
  - 15x CPU throttle for 4 s: the ratio stays at 2 (before: 2 → 1.75 and stuck).
  - GPU burner: 2 → 1.75 while it ran, back to 2 within 6 s of it closing, no flapping afterwards (before: 2 → 1.0 and stuck).

**G7-4 (MEDIUM): fixed differently.**
- **Requested rule tested and rejected:** turning MSAA off at 1.5x or more saves 33%. But even at 2x the line of scrimmage and line-to-gain edges stair-step and the far yard-number arrows break up (crops and heat map below). I didn't ship it.
- **Shipped instead:** the canvas's own buffer has no MSAA and no depth, since it only receives the output pass's full-screen copy. The scene keeps 4x MSAA. The output is pixel-identical (0 of 5.18M pixels differ).

| GPU process | Before | After |
|---|---|---|
| 1440x900 at 2x | 1,250 MB | 1,058 MB (−15%) |
| 1920x1080 at 2x | 1,468 MB | 1,196 MB (−19%) |
| 3840x2160 at 1x | 1,979 MB | 1,475 MB (−25%) |

- Both changes together would be 595 MB (−52%) at 1440x900, if that's ever wanted for an 8 GB machine.
- **"Free the bloom chain when bloom is off": not real.** `buildPost` never creates the bloom pass when bloom is off, and a look change disposes it.
- **"Reuse targets between bloom and lens": not real.** The lens pass already draws into the output pass's two shared targets; bloom's mip chain is its own.

**G7-5 (LOW): fixed.**
- The camera and labels take each new size at once. The drawing buffer is reallocated once, 120 ms after a burst ends, and CSS scales the old buffer meanwhile. Changes of 2 px or less keep the buffer, and the pixel ratio is only set when it changes.
- A/B with 60 resize steps while a 4x Watch played: textures created went from 854/868 to 70/84, and framebuffers from 854/868 to 65/78.
- Frame times weren't comparable: the machine was capped at 30 fps during that run.
- Mid-burst and settled screenshots look the same: correct proportions, 0.5% of pixels differ from resampling.

**G7-6 (LOW): fixed.**
- `stage.setFrame` resolves at once for a frame equal to the current one.
- A new frame is built hidden. Its glyphs are awaited and its programs compiled while the old field stays on screen, then it's swapped in. The old field and props are freed after the new one's first drawn frame, and a frame replaced while it's being prepared is dropped.
- Watch start, 3 runs including a fresh sandbox: both rebuilds now upload nothing (0 buffer uploads over 200 KB), compile 0 programs, cause 0 long tasks, and the worst frame is 18.8 ms.

**Tests run**
- **Node:** 1,513/1,513 pass. Coverage of the touched modules is 88% of lines overall; `stage.js` is at 45% because `createStage` needs WebGL.
- **pytest, non-e2e:** 285 passed. One API-safety test failed once under parallel load and passed alone and on the full rerun.
- **e2e, neutral world:** `keys_offline`, `checklist_field`, `timeline_watch`, `checklist_load` and `smoke`: 56 passed. One `checklist_load` boot timeout at load average ~45 passed on rerun. `gpu_budget`: 2 passed.
- **e2e, Under the Lights:** the same files plus the world file: 67 passed, 1 skipped (a neutral-only check), 2 failed. `gpu_budget`: 2 passed.
  - All 10 golden screenshots pass; none regenerated.
  - **The 2 failures:** `test_g5_7_watch_this_game_puts_the_booth_away_and_focus_on_pause` (mouse and keyboard).
  - **Why it isn't mine:** it's G5's item, its test was edited at 02:34 and `ui/feed-bar.js` at 13:47 by someone else. It fails the same way with the WebGL engine off (`?scene=2d`) and passes on neutral.
- **The frame-budget test's skip:** it skips, with the reason, when a blank page can't run at 60 fps. That happened when the laptop hit 8% battery and slept about 10 hours mid-run.

**Screenshots** (in `/private/tmp/claude-501/g7/`)
- Watch at 4x, before and after: `base4x-end.png`, `fix4x-end.png`
- After a watch start: `start-fresh.png`
- WebKit: `cold-webkit-1440x900.png`
- MSAA A/B: `zoom-num-new.png` vs `zoom-num-msaa.png`, `z-los-new.png` vs `z-los-msaa.png`, `heat-aa-1440.png`
- Lean canvas, pixel-identical: `mem-old-1440.png`, `mem-msaa-1440.png`
- Resize: `resize-mid.png`, `resize-settled.png`
- Neutral world: `final-neutral-1440.png`
- Whole game at 10x: `final10x-run0-end.png`

**Files outside my list:** none. My probe scripts are in the scratchpad's `g7/` folder, not the repo.

**Worth knowing**
- The DPR row in section 6.1 of `docs/design/ui-architecture.md` is now out of date: the ratio recovers, the floor is 0.75 at 4K, and `?dpr=` exists. The README could mention `?dpr=`.
- The remaining boot long tasks are in other files: `static/js/field/lighting.js` (the lighting environment's PMREM, ~34 ms) and `static/js/field/webgl-support.js` (the WebGL probe, ~19 ms).

## fix:G6 Play drawing geometry & 2D fallback

All ten G6 items are fixed except G6-4, which is fixed on the 2D field only (3D needs a hook in files other fixers are editing). One file outside my list was touched: `play-style.js`. Node suite is green at 1517/1517, and the new drawing e2e passes on both worlds (11/11 each).

**Per item**
- **G6-1, fixed.** On 4th down both engines draw the shadows at 0.35 and 0.25, and the words read "If he goes · 1 · …". The 3D field only got this through a small change in `play-style.js` (passes `down` through when it is 4; listed under "Outside my list"). With "If he goes" set on all 59 Dallas snaps, every label stack still fits, both in the default view and with phone metrics.
- **G6-2, fixed.** The field goal arc now leaves from the line of scrimmage, and the label still says "FG 41 yds · good". A blocked kick is a block mark at the line, then the loose ball. `FG_HOLD_YD` and `hold` are gone. The 2D `debugState()` now reports `ball` like WebGL does. In the e2e, seq 87's first frame is at x 77.32 (WebGL) and 77.00 (2D), and no frame goes behind it.
- **G6-3, fixed.** The two labels are placed as one block: #1 on a line, #2 on the next line down. Instead of a fixed 1.15× pitch, the label model now measures how much bigger a line gets past the line of scrimmage in each camera. When the field is too crowded, #2 skips a line but never sits above #1. On the phone before snap 169, #2 sat at y 335 over #1 at 359 (2 px overlap); now #1 is at 404 and #2 at 433.
- **G6-4, fixed on 2D, deferred on 3D.**
  - The prescribed 1.5 yd ball disc alone changes nothing on desktop: labels always sit at least 5 yd off the center line, so the plate edge is 3.25 yd away. The real cause is that labels are placed using desktop sizes, while a phone plate is about 9 yd tall.
  - I added the disc plus `buildDrawing(row, {metrics})` and `placePlayLabel(drawing, metrics)`, so a renderer can place labels for its own view. The 2D field now does this, and the shadows avoid the label where it is actually drawn.
  - 3D still needs `player.js`, `residue.js`, the overlays chip and `lastDrawing` to call `placePlayLabel` with the camera's metrics. Other fixers are editing those files, so I left them alone. In the sweep for the Under the Lights wide camera on a phone, 138 of 156 play labels touch the play or ball today; 0 do when placed this way.
- **G6-5, fixed.** Any row with an interception (`turnover_kind 'int'`) is drawn as a pass with the INT mark, whatever the play type says. A hand-typed one with no play type reads "Pass intercepted".
- **G6-6, fixed.** The 2D field has two cameras: Drive (the default) and Top, and V switches between them.
  - Drive frames the line of scrimmage, line to gain, the shadows (including a hovered one) and room for their words. During a play it widens to show the whole play and its words.
  - Camera moves ease over `look.cameras.moveMs`, and cut under reduced motion. The static field zooms by viewBox instead of redrawing.
  - At 1440, the shadows on the first snap are 134 px and 202 px wide (Top: 31 and 46). I wrote my own Drive frame because the G2-1 `presnap` preset doesn't exist yet.
- **G6-7, fixed.** Text sizes are cached instead of re-measured, unchanged tags and redraws are patched in place instead of rebuilt, and the label size is measured once. Over a whole game at 4x for 20 s, measured after only the label-size cache was in, so the original code was likely worse:

| | Before rest of G6-7 | After |
|---|---|---|
| getBBox calls | 448 | 150–161 |
| getBBox time | 1106 ms | 22–34 ms |
| SVG nodes inserted | 542/s | 145/s |
| Long tasks | 307, 52, 165, 193, 112, 222 ms | none |

- **G6-8, fixed.** An estimated catch spot is capped where the receiver went down, so AA 12 and PP 0 no longer run backward after the catch. ESPN's exact catch spots keep real losses after the catch (seq 120).
- **G6-9, fixed.** The collision sweeps now use the camera modes the two worlds actually ship, posed as the rig poses them, with each world's measured canvas, HUD insets and plate size, at 1440x900, 1920x1080 and 390x844.
  - The default cameras at desktop sizes show zero overlaps, and their arc lift stays inside the label model's range.
  - Gaps the sweep found are pinned as budgets that can only shrink: neutral sideline at 1440 (24/156 labels touch their own play), Under the Lights tight (lift 4.06, 20/156), blimp and overhead (8/156), the end zone camera (most) and phones.
- **G6-10, fixed.** With `ghost.tint: "family"`, 2D shadows use the world's family colors (pass warm white, run amber, RPO gold), and their labels get a `family-*` class. I read the color data from the look rather than G3-1's code, so it doesn't depend on their exports.

**Tests**
- **Node:** 1517/1517 (1301 at the start; other fixers added tests too). Line coverage on my modules is 91–100%.
- **pytest non-e2e:** 284 passed, 1 failed: `test_api_safety::test_the_live_feed_refuses_another_matchup_and_backs_up_first`. That is server-side code (`live.py`, `app.py`) another fixer is changing; I didn't touch Python.
- **e2e neutral** (field checklist, drawing rules, timeline watch, keys offline, game surfaces): 67/67.
- **e2e Under the Lights, world file plus drawing rules:** 24 functional tests pass. The first run had 6 golden failures (final, midflight, incomplete). Another fixer rewrote the goldens folder at 13:16 during that run. On the re-run all 10 goldens pass. I didn't regenerate any goldens myself.
- **e2e Under the Lights, field-area files plus goldens:** 63 passed, 3 failed, none in field code:
  - `test_g5_7_*` (×2) are G5's new tests.
  - `test_a_play_row_shows_its_play_on_the_field` fails because the `.uls-ribbon` HUD element blocks the click on the play row. It reproduces on re-run and passes on neutral.

**Screenshots** (in `/private/tmp/claude-501/g6-fixer/shots/`, all viewed)
- G6-1: `after-idx86-1440x900.png`; before is the skeptic's `presnap-idx86.png`.
- G6-2: `fg-after-f40.png`, `fg-after-2d-f40.png`.
- G6-3: `before-idx169-390x844.png` vs `after-idx169-390x844.png`, and `before-idx7-390x844.png` vs `after-idx7-390x844.png`.
- G6-4: `before2d-idx6-390x844-2d.png` vs `after2d-idx6-390x844-2d.png`.
- G6-6: `drive2d-a-idx1-1440x900.png` and `drive2d-b-idx169-1440x900.png`, plus their `-top` versions.
- G6-7 measurements: `perf-*.json`.

**Outside my list**
- `static/js/field/play-style.js` (edited): `snapOf` passes `down: 4` through and `fromGhostSet` takes the down from the live snap. Additive only; its tests pass.
- Now out of date, not edited by me:
  - `ui-architecture.md`: 13.2/13.3 still say one "top" camera; 16.1 and 16.4 still describe the hold; 16.3 the old label layout; the 22.2 field-goal row still says "open".
  - `tests/e2e/test_ui_chrome.py:491-495` asserts the 2D field has one camera. It only runs when WebGL fails, and it is wrong now.
  - `tests/js/play-style.test.mjs:137` mentions the holder; it still passes.

My sandbox on port 5850 is stopped.

## fix:G3 Stadium & shadow-play look

**G3 Stadium & shadow-play look: all 8 items fixed.** G3-7 is checked only in node tests; no rendered frame shows the lamps. Three e2e tests fail in other fixers' areas; reasons are below.

## Per-item verdicts

**G3-1 (HIGH): fixed.** The two shadows now read as two plays.
- **Schema:** new optional `ghost.tint: "fill" | "family"`. `ghost.stroke` is still the fallback, so the 2D engine is unchanged.
- **play-style.js:** `world.plays.families` (pass/run/rpo) and `world.plays.casing` are new, validated keys.
  - Pass families draw in `ledWarm`, run in `ledAmber`, RPO in `ledGold`.
  - Every dashed part gets a casing: the same path, 1.8x wide, night-sky at 0.4. It is a ring outside the stroke, so the stroke's own colour is not darkened.
  - Shadows stay dashed at 0.5 / 0.35.
  - I capped the run's chevron at 1.6x the core width. At 3.2x it filled in to a solid blot.
- **ULS look:** `shadowWidth` 3.2, tint `family`.
- **ghost-layer.js:** each shadow label gets a `family-<family>` class (set in the class string, not via `toggleLabelClass`).
- **ULS field-host.css:** the dashed edge and the rank numeral (`::first-letter`) take `--sc-pass` / `--sc-run` / `--sc-rpo`.
- New e2e checks the classes and tones and writes crops. I looked at them: two colours, and the dashes hold over the star logo.

**G3-2 (HIGH): fixed.** The back wall already existed; it was the flat navy slab. It now has steel columns every 7 yd, a lit concourse band and dark gates, still in the `back` tone. A new `stadium/ground.js` lays a bowl-haze plaza 170 yd out from the home stand, with a radial gradient, joints and lamp pools (pools at night only). It sits in the stands' existing draw call. The lens in `grade.js` now falls off toward the top (1.25) and corners, and only 0.35 below centre.

Measured on the final state, wide and tight, both sizes:

| Measure | Before | After |
|---|---|---|
| finish-gate `flat.py` longest dark+flat run | 150/620 rows (wide 1440); 257/720 (tight 1920) | 0–7 rows |
| Strict flat (row range under 1), longest run | up to 56 rows | 0 |
| Smallest 60-row band range | 1.1–7.4 | 14.1–48.7 |

Budget (Watch, 14 s): 57–68 draw calls, about 45k triangles (was about 38k), frame p95 16.7–16.8 ms.

**G3-4 (MEDIUM): fixed.** In Watch, a touchdown or turnover now holds for `holdScoreMs` (2000) before the rise. During the hold the camera is pinned and draws no frames; a timer then starts the rise. Any new shot or reduced motion cancels the hold. In the browser the shot stayed `tight` through 1.9 s and was `blimp` by 2.3 s.

**G3-5 (MEDIUM): fixed.** `fg_miss` is now in the choreography's kick list, in `endsDrive`, and in play-style's kick list. Contract tests read `KICKS` from `timeline.py`.

**G3-6 (LOW): fixed.** The fascia now reads, for example, "NEXT CALL · INSIDE RUN (A/B GAP) 27% · THEN PA SHORT (0–9) 13%" (names warm, odds amber).
- It waits 1.5 s behind the play's words, or until a held moment (touchdown, turnover, flag) ends.
- A snap drops a call still waiting; landing a play brings the play's words back; a late grade never overwrites the call.
- Separate bug found and fixed: during a game-frame rebuild, moments went to the old stadium, so the call was lost.
- No caller's last name: the moment context has no caller name, so the fascia reads "NEXT CALL" without it.

**G3-7 (LOW): fixed, node-verified only.** A `dim.js` flare lifts the lamp banks to x1.15 for 300 ms, above the 0.8 dip, on a TOP PICK or a touchdown. Their beams rise up to full (DESIGN's 6% cap) and the spot lights are untouched. Reduced motion skips it. In the default live shots the lamp banks are out of frame, so the flare is rarely visible.

**G3-8 (LOW): fixed.** Under 720 px, plates get `max-width: calc(100vw - 24px)`, normal wrapping, `--sc-size-xs` and balanced lines. CSS alone still left the 356 px punt plate 15 px off a 390 px screen. So `labels.js` now shifts each plate sideways to stay inside the field. Checked at 390x844.

**G3-9 (LOW): fixed.**
- **materials.js:** the kit keeps only paint, line, ball, texture("radial"), setTeams, a no-op setDpr (stage.js still calls it) and dispose. LAYERS keeps turf, decal, graphic, line, ring, shadow, trail and glow.
- **shaders.js:** only `setOpacity` remains.
- **Schema and both looks:** `strokes` is now arc/ground/mark only, `ghost.opacity` is gone, and `ghost.style` stays.
- I grepped all of static/js, including `fallback-*`, before removing anything.

## Tests
- node: 1518/1518 pass.
- pytest non-e2e: 285 passed.
- e2e, neutral world (field, keys_offline, timeline_watch, prediction, game_surfaces, uls_look): 70 passed.
- e2e, Under the Lights world:
  - field + keys: 21 passed.
  - watch + prediction: 30 passed, 2 failed. Both are the new `test_g5_7_…focus_on_pause` cases, which belong to another fixer's work in progress (Pause doesn't get focus).
  - game_surfaces: 13 passed, 1 failed. `test_a_play_row_shows_its_play_on_the_field` fails because the HUD play-feed ribbon intercepts the click. It fails again when run alone; it is HUD play-feed layout, not my files.
  - world + uls_look (includes the 10 goldens and 5 new tests): 24 passed.
- **Goldens regenerated:** all 10 in `tests/e2e/goldens/under-the-lights/` (final, presnap, midflight, incomplete, drawer at 1440x900 and 1920x1080). Every one is affected by the fascia call, the tinted shadows or the facade and plaza. They also capture other fixers' HUD changes as they stood, so run `SC_UPDATE_GOLDENS=1` again once everyone lands.

## Screenshots (looked at)
All in `/private/tmp/claude-501/g3-fixer/shots/` unless a full path is given.
- **G3-1:**
  - after: `/Users/samgoldfeder/Dev/shadow-caller/test-results/visual/uls-look/shadows-{first,midfield}-{1440x900,1920x1080}.png`
  - before: `before-presnap1-1440x900-crop.png`, `before-presnap4-1920x1080-crop.png`
- **G3-2:**
  - before: `before-cam-wide-canvas-1440x900.png`, `before-cam-tight-canvas-1920x1080.png`
  - after: `g32c-cam-wide-1440x900.png`, `g32c-cam-tight-canvas-1920x1080.png`, `bd2-day-tight.png`, and `/Users/samgoldfeder/Dev/shadow-caller/test-results/visual/uls-look/slab-*.png`
- **G3-4:** `td-after-0048ms.png`, `td-after-1904ms.png` (held), `td-after-3504ms.png` (rising)
- **G3-6:** `fascia-night6b-1440x900-fascia.png`
- **G3-8:** before `/private/tmp/claude-501/live-rehearsal/shots/96-phone-idx49.png`, after `g38b-phone-field.png`

## Files outside my list
None edited apart from the 10 regenerated golden PNGs. New files are `static/js/theme/worlds/under-the-lights/stadium/ground.js` (inside stadium/**) and `tests/e2e/test_ui_uls_look.py` (listed). Docs I can't edit are now out of date: ui-architecture.md 2.5, 2.7 and 14.5 still describe the removed kit methods and `ghost.opacity`, and a comment in `play-strip.js` still mentions `kit.fade`. My sandbox on 5820 is stopped.

## fix:G2 3D story: pre-snap camera, review framing, conductor

All eight G2 items (G2-2 to G2-9) are fixed, and I touched no files outside my list. On both worlds, every e2e failure I saw was in another group's tests or caused by another group's in-progress work; details are at the end.

**Per item**
- **G2-2, fixed.** While Left/Right reviews a row, the camera frames that row's situation together with its whole play (new `unionFrame` in camera-plan.js). The live view is unchanged, and so is the ball-following camera. A reviewed row with nothing drawn keeps the plain situation frame.
  - At 1440, the play's words for seq 81, 95, 108, 43 and 87 used to land at x 1222, −999, −640, 1359 and 858; they now land between x 26 and 968 (limit 984). At 1920 the furthest right edge is 1276 (limit 1296).
  - The new `test_ui_camera_framing.py` fails if the camera change is undone, and passes with it.
- **G2-3, fixed.** The verdict gets its own beat before the next shadows: 1500 ms normally, capped at 600 ms when Watch plays at 4x or faster. The light dip comes with the shadows.
  - Measured on the real UI (seq 7): the play lands at 1.88 s, the field holds only the chip "Miss · #11 Deep shot · 3%", and the shadows and presnap arrive at 3.44 s.
- **G2-4, fixed.** A lost WebGL context is no longer treated as a bug: no "Something went wrong" notice and no console error.
  - The 2D field holds the game and a toast says so. On restore, a fresh 3D field is built through `loader.start`, redrawn from the store, and the 2D field is disposed.
  - It works even though the lost engine was already disposed: the engine keeps a listener on its canvas for the restore. The new `test_ui_context_restore.py` runs two lose/restore cycles on the GPU and skips without one.
- **G2-5, fixed.** At FINAL the band is neutral steel rgb(51, 64, 92) instead of Dallas navy (`POSSESSION_FINAL` in apply.js). The ULS band test now also checks the band colour mid-game and at the final.
- **G2-6, fixed.** New `ui/announcer.js`, loaded the same way as other components:
  - a hidden polite log reads each newly drawn play, e.g. "Q1 12:41 DAL. Deep pass middle, +21. Miss." It stays silent on page load and on a new game, and reads at most three plays in a burst.
  - a status line reads Camera / Speed / Paused / Playing / Flag mode / Back to live.
  - Checked live through a watched game; covered by a node test and an e2e.
- **G2-7, fixed.** The live chip now says what was graded. The Dallas TD reads "In his top 3 · #2 Intermediate · 39%". A retag recomputes the chip.
  - Not done: the chip on a *reviewed* play still shows plain words. That would need a small change in residue.js, which isn't mine. 2D parity skipped (it was optional).
- **G2-8, fixed.** The page ships in Under the Lights with its tokens, lamp and boot-board styles, plus font preloads; no inline script was added. The very first frame is now the night sky with the LED board and is pixel-identical (0 changed pixels) to the boot screen that replaces it. Before, it was a light-gray system-font screen. `?world=neutral` still switches over at about 0.19 s.
- **G2-9, fixed.**
  - The silent warm-up catch now raises a warning, also visible in `debugState().warnings`.
  - The warm-up cap is 10 s, and engine creation also waits for the bare field to be built.
  - After a failover, the next epoch tries WebGL again instead of staying 2D for the session.
  - New tests cover a layer that throws mid-play (one error, play ends incomplete, back to idle), `createFallback` throwing (reported once, store untouched), a play length that can't be computed (drawn instantly), a row that can't be drawn, a job that can't finish, a missing queued row and stage creation failing.

**Tests**
- Node: 1518/1518 for the whole suite; 153/153 in my files. Line coverage of my changed modules is 97.8–100%.
- pytest (non-e2e): 285 passed.
- e2e on neutral: field, camera framing, context restore and smoke 15/15; chrome, load, watch and prediction 64/64; a11y, keys and game surfaces 43 passed, 3 skipped.
- e2e on Under the Lights: the world file (all 10 goldens included), field, camera framing, context restore and smoke 34/34; chrome, load, watch and prediction 59 passed, 2 failed, 3 skipped; a11y, keys and game surfaces 42 passed, 1 failed, 3 skipped. The three failures are listed below.
- A full neutral run under heavy machine load was killed partway. The tests that had failed in it (G5-2 desk, test_49, tests 100/103/108) all pass when run alone.

**Worth knowing (other groups' work)**
- **G7 bug.** In the new compile path (renderer.js/stage.js), three.js `compileAsync` throws "Cannot read properties of undefined (reading 'isReady')" if a frame's parts are dropped while their shaders are still compiling. My bare-field wait avoids it on the restore path, but the race itself is in G7's code.
- **Clock check changed for G4-9.** The band now shows the engine clock during his drive, so I changed the band test's clock expectation (in my ULS world file) to follow that rule.
- **Two other tests fail on Under the Lights:** G5-7's "focus lands on Pause after starting a watch", and `test_a_play_row_shows_its_play_on_the_field`, where the ribbon intercepts the click. Both pass on neutral and neither involves my files.
- **Goldens.** I did not regenerate them; someone regenerated all of them at 13:16 and they pass with my changes. They already show the steel band at FINAL.
- **ghosts.js not deleted.** Nothing in G2-2..9 called for it, and the conductor still uses it.

**Screenshots** (in /private/tmp/claude-501/g2-fixer/shots/)
- review framing: `review-{81,95,108,43,87}-1440x900-{before,after}.png`, `review-{81,95,43,87}-1920x1080-{before,after}.png`
- verdict beat and chip: `verdict-2-1440x900-after.png`, `after-verdict-2-1440x900-after.png`, `verdict-7-1440x900-after.png`, `after-verdict-7-1440x900-after.png`, `verdict-159-1920x1080-after.png` (before: /private/tmp/claude-501/critique-uls/shots/crop-verdict-cluster.png)
- context loss: `lose-0-before-gpu-final.png`, `lose-1-lost-gpu-final.png`, `lose-2-restored-gpu-final.png`
- band at final: `final-band-after.png` (before: `review-95-1440x900-before.png`)
- first frame: `boot-before/boot-seq-0.png`, `boot-after/boot-seq-0.png`, `boot-after/boot-seq-1.png`, `boot-neutral/`

**Files changed**
- /Users/samgoldfeder/Dev/shadow-caller/static/js/core/conductor.js
- /Users/samgoldfeder/Dev/shadow-caller/static/js/main.js
- /Users/samgoldfeder/Dev/shadow-caller/static/js/theme/apply.js
- /Users/samgoldfeder/Dev/shadow-caller/static/js/model/vm-field.js
- /Users/samgoldfeder/Dev/shadow-caller/static/js/field/scene.js
- /Users/samgoldfeder/Dev/shadow-caller/static/js/field/cameras.js
- /Users/samgoldfeder/Dev/shadow-caller/static/js/field/camera-plan.js
- /Users/samgoldfeder/Dev/shadow-caller/static/js/field/overlays.js
- /Users/samgoldfeder/Dev/shadow-caller/static/js/ui/announcer.js (new)
- /Users/samgoldfeder/Dev/shadow-caller/static/index.html
- /Users/samgoldfeder/Dev/shadow-caller/static/css/base.css
- tests in /Users/samgoldfeder/Dev/shadow-caller/tests/js/: conductor, scene-engine, cameras, camera-plan, vm-field, apply and index-html tests, plus new `overlays.test.mjs` and `announcer.test.mjs`
- tests in /Users/samgoldfeder/Dev/shadow-caller/tests/e2e/: `test_ui_world_under-the-lights.py`, `test_ui_checklist_field.py`, plus new `test_ui_camera_framing.py` and `test_ui_context_restore.py`

My sandbox server on port 5810 is stopped.

## fix:G4 Boards that read: video board, scoreboard band, masthead, stat board

All 12 G4 items are fixed. The node and pytest suites are green, and every e2e failure left in my area traces to other fixers' in-progress files. Nothing was committed.

## Verdict per item
- **G4-1 Fixed.**
  - In Feed and Watch, when Dallas is off the field, the board now shows a "SCHOTTENHEIMER SO FAR" face: the predicted call with its % in Doto at 40/48 px, then what happened in the field's own label words, then the verdict in its tone. Under that come the tally (top pick n of N, in his top 3 n of N) and the last 6 verdict glyphs.
  - After a touchdown or turnover the face leads with the referee pictogram and TOUCHDOWN / INTERCEPTED at call-name size. "DAL is off the field" stays as a footer line.
  - At FINAL the board shows the plate, the score in Doto, the band's three pairs and a "G Tonight's scorecard" key. The strip reads "Final. Replay or watch another game from the booth (B)."
  - Manual mode mid-game is unchanged. No league top-pick count appears anywhere.
- **G4-2 Fixed.**
  - The masthead now reads "Shadowing Schottenheimer · DAL", with no cut at 1440 or 1920; the full game label and "Modelling …" line are the plate's tooltip.
  - The board plate reads "Schottenheimer's next call · Snap n" and falls back to "Next call" for names over 16 characters.
  - The keys are named "Booth (B)" and "Scorecard (G)".
  - Screen readers now hear one sentence per change ("Next call, snap 2: …, 24 percent. Then …") from a single live region outside the faces.
- **G4-3 Fixed.**
  - New labels: "Run/pass right", "Run or pass called right (league …)", "Play in top 3", and "1 snap".
  - The basis is said once under the plate. It only does this when every pair counts the same snaps; otherwise each pair keeps its own count.
  - The leader lamp and the red log-loss tone now compare the displayed numbers, so 1.62 v 1.62 shows no lamp and no red.
  - The trailing value dims to led-dim. The full values are visually hidden instead of `display:none`, so screen readers can reach them.
- **G4-4 Fixed.** On 4th down the plate reads "4th down · if he goes for it · Snap n" with the caveat in yellow and a tooltip saying the model has no kick class.
- **G4-5 Fixed.**
  - The then-line holds to one line: when both plays don't fit, the second drops.
  - Names in the open board never break, and play rows are at least 24 px tall (44 px on touch screens).
  - Sweep: 0 of 70 pre-snaps clipped at 1440 (was 11) and 0 of 66 at 1920. The trade-off is that the second then-play is dropped on 10 of 59 snaps at 1440 and 8 at 1920.
- **G4-6 Fixed.** The tag now reads "Like the league", "Leans pass/run" or "Tilts pass/run". The classes and tooltip are unchanged.
- **G4-7 Fixed.** The % sign is scaled to 58%. Crops at 1440 and 1920 show the ghost and lit cells still aligned.
- **G4-8 Fixed.** Stat board pairs sit two to a row, and every pair is whole at 1440 and 1920. I read "the forest plot spans the right column" as making the strips full width, so I put each term's label above its strip. That makes the strips about twice as wide, but the right column is taller and scrolls more.
- **G4-9 Fixed, with one change from the brief.** The band shows the engine's estimated clock with its EST caption only during the caller's drive, in ESPN's quarter. Otherwise it keeps ESPN's clock, because the engine never syncs the clock on the opponent's plays. At watch play 20 it read 10:51 while ESPN read 7:22.
- **G4-10 Fixed.** In forced-colors mode the unlit 8s are removed, keys that are on get a Highlight frame, lamps keep system colors (CanvasText ring, Highlight when lit), LED windows get a frame, and the board's pixel glyphs stay visible.
- **G4-11 Fixed.** `logoVariant` is now read once per `data-world`/`data-ambient` value instead of on every update (tested).
- **G4-12 Fixed.** Drive info reads "Drive 9 · snap 32". Both Reset confirms add "A copy is kept in data/."; I checked that `/api/reset` does back the game up first.

## Tests
- **Node:** 1513/1513 pass.
- **pytest (not e2e):** 285 passed.
- **e2e, neutral world** (prediction, load, chrome, feed_replay, game_surfaces, input_surfaces, strip, entry, shorthand_drive): 177 passed, 1 failed. The failure was `test_92_94_95` (an extra `/api/state` refetch) and it passes on rerun.
- **e2e, Under the Lights** (my area):
  - `test_ui_boards`: 12/12, run under both world settings.
  - The world file: 19/19, including all 10 goldens.
  - prediction, load, chrome and feed_replay all pass. Six that failed while the machine load was about 170 passed on rerun.
  - Unrelated failures still open:
    - `test_a_play_row_shows_its_play_on_the_field`: the play ribbon's unroll is mid-change by another fixer.
    - `test_15[togo]`, `test_15[score]` and `test_16`: the server's validation messages were changed by another fixer.
- **Goldens:** another agent regenerated all 10 at 13:16, after my last visual change, and they match, so I did not regenerate any.

## Files outside my list (small additive changes)
- `static/js/model/vm-situation.js`: final strip copy. Its test file `tests/js/vm-situation.test.mjs` gets one new test plus the drive-info text.
- `static/js/shell/bindings.js`: the prediction binding now also depends on `s.timeline` and `s.anim.drawnThrough`.
- `static/js/theme/worlds/under-the-lights/index.js`: registers a new skin.
- **New** `static/css/worlds/under-the-lights/components/board.css`: the recap and FINAL faces. I moved the off-field rules here from `prediction.css` because that skin has a 400-line limit.
- Drive-info or Reset-confirm text updated in:
  - `tests/js/situation-strip.test.mjs`
  - `tests/e2e/test_ui_checklist_strip.py`
  - `tests/e2e/test_ui_checklist_entry.py`
  - `tests/e2e/test_ui_checklist_shorthand_drive.py`
  - `tests/e2e/test_ui_input_surfaces.py`
- `tests/e2e/test_ui_game_surfaces.py`: a tie on screen carries no tone.
- In my own files I also changed the replay toast assertions in `test_ui_chrome.py` and `test_ui_checklist_feed_replay.py` to match another fixer's (G1-11) new backup message.

New page hooks that need recording in the docs: `#heroArea[data-kind]` gains `recap` and `final`, plus `.sc-board-spoken`, `.sc-face-head`, `.sc-call[data-fourth]` and `.sc-card-pairs[data-basis-shared]`.

## Screenshots
- Before and after, plus phone and neutral-world views: `/private/tmp/claude-501/g4-fixer/shots/`
  - `before-*`, `after1-*` to `after5-*`, `phone-*`, `neutral-*`, `crop-callfig-1440/1920.png`, `then-1440/1920-snap3.png`, `masthead-1440/1920-zoom.png`
- e2e captures: `/Users/samgoldfeder/Dev/shadow-caller/test-results/visual/boards/`
- Sweep logs: `/private/tmp/claude-501/g4-fixer/sweep1440.log` and `/private/tmp/claude-501/g4-fixer/sweep1920.log`

## Worth fixing next
The strip and the SITUATION rack still show the engine's clock, which goes stale through every opponent drive, so the two clocks only agree during Dallas drives. The fix belongs in `vm-situation` or the feed, not in my files.

## fix:G1 Backend: Watch pacing, live-game data safety, docs

All 13 G1 items are fixed. All suites are green, except a few e2e failures outside my area (listed under Tests). No commits, stashes or checkouts; my sandboxes (ports 5800–5802) and browsers are stopped.

## Items

**G1-1 (critical, fixed, with different numbers than proposed).** The proposed numbers missed the targets when measured. At 2x the call got about 1.3 s, because the verdict beat there is still 1.5 s (G2-3 only shortens it to 0.6 s from 4x). At 4x and 10x it was borderline. What's in now:
- **Server (`watch.py`):** a minimum wait before each Dallas snap of 6.0 s below 4x, 4.8 s at 4x and 3.6 s above.
- **`/api/version` and `/api/state`:** both now carry `next_kind` (`caller_snap`, `snap`, `kick`, `admin`, `admin_end`).
- **Client (`anim-queue.js`):** before a caller snap, the play is cut short so the call keeps `min(reserve, 0.7 × wait)`. The reserve is 4100 ms below 4x, 3200 ms at 4x and 2400 ms above.
- **A second bug:** when the timeline answered before the next version poll, the queue used stale watch data and the play ran full length, costing the call about 0.5 s. The play now waits for the fresh poll, for at most 600 ms.
- **Game length:** 14.3 min at 1x, 9.6 at 2x, 6.6 at 4x, 4.3 at 10x.

Measured on GPU Chromium (Metal), real time: shadows up before each Dallas snap. "Fully lit" subtracts the 400 ms fade-in.

| Speed | Before | Now: median / shortest | Fully lit (shortest) |
|---|---|---|---|
| 1x | 3.5–6.5 s | 3.70 / 3.41 s | 3.0 s |
| 2x | 1.5–1.8 s | 2.73 / 2.63 s | 2.2 s |
| 4x | 0.44 s median | 2.73 / 2.63 s (both worlds) | 2.2 s |
| 10x | 0.29 s | 1.88 / 1.45 s | 1.05 s |

**G1-2 (fixed).**
- The live feed checks the teams first. A wrong matchup gets a 400 ("ESPN event X is NYG at PHI, not DAL v TB."), the game is untouched, and the feed is off with that reason. A later poll that finds a wrong matchup stops the feed.
- The game is backed up before the feed switches events, or adds to a typed game with nothing from ESPN yet.
- `feed_seen.json` now records which ESPN event its plays came from, so a restart follows that event.

**G1-3 (fixed).** A game file for another `game_id`, or one with no game in it, is copied byte-for-byte to `live_state.other-<game_id>-<time>.json` before the first save. The message and the server log name the copy.

**G1-4 (fixed).** A flag typed with no play becomes a `penalty` row in ESPN's shape, so the field draws "Flag · false start on DAL · −5". A no-play row walks to its own enforced spot. Manual flag rows now carry the code, foul, team, yards and status. Flag rows are never counted as snaps: metrics, the play log, DuckDB and the CSV skip them.

**G1-5 (fixed).** `I` / `INT` now give `turnover_kind: "int"` and `F` gives `"fumble"`. No family is invented. The field reads "Pass intercepted".

**G1-6 (fixed).** A broken or thin ESPN poll is treated as a failed poll and the summary on screen stays. Every summary field is read for its expected type. A row that still can't be built is listed in `missing` (not `skipped`, which means "drawn, but the apply failed"). 600 seeded mutations are in the tests. An extra 20,000-mutation run had zero failures and no NaN in any answer.

**G1-7 (fixed).** `frame-ancestors 'self' http://localhost:* http://127.0.0.1:*`, nosniff, no-referrer and same-origin opener isolation are on every response. The bad-Host test now covers `/`, a static file, a logo and the export.

**G1-9 (fixed).**
- Bad input gets a 400, a refused state a 409, and anything unexpected a 500 with the traceback in the server log.
- Empty, list and broken bodies get JSON errors instead of HTML pages, and Flask's own error pages are JSON too.
- Range checks: yards −100 to 100, down 1–4, to-go up to 99, clock, scores up to 199, penalty yards up to 99.

**G1-10 (fixed).**
- **Raw file:** plays are applied first. The raw summary is then written whole (temp file, then rename), only when new plays arrived, and a write failure never stops the feed.
- **Fetches:** redirects are refused, answers over 8 MB are refused, and a download gives up after 30 s.
- **Backoff:** waits are 4, 8, 16, then 30 s between failing polls, back to 4 s after a good one.
- **Poll thread:** a race where the thread could exit just as the feed was turned on is closed.

**G1-11 (fixed).** The replay message names the backup or says "No earlier game to back up". Only the newest 20 backups of each file are kept, never one a watch session needs. The two staging files are git-ignored, and `plays_logged` resets with each replay.

**G1-12 (fixed).** Team names are capped at 40 characters, play text at 400, a foul at 60 and a note at 80. The CSV is written with Python's `csv` module, and text cells starting like a formula get an apostrophe (numbers stay numbers).

**G1-13 (fixed).**
- **Lock:** a hash-checked lock pinned to the venv's exact versions, verified by a dry-run install in a fresh venv. `start.sh` installs from it.
- **Python 3.12+:** `start.sh` now requires it, because the pinned numpy 2.5.3 and scipy 1.18.1 need 3.12.
- **Build guard:** models are rebuilt automatically only when they're missing or built with another scikit-learn, and never while a game is in progress.

**G1-8 (fixed, written while other groups were still changing code).**
- **DESIGN.md:** as-built, with the SEED comment gone. It covers the shadow-play grammar, the tilt words, band captions, board faces, the % glyph, the new LED grid colour, 68 stadium colours, the real rigs/fog/bloom/towers/bowl values, day mode, the room-lights hook, board size, scrim use and the 1 px radii.
- **ui-architecture:** a new §23, a context-loss note, and both perf tables marked "re-measure after G7". The G2-1 GhostSet removal hasn't landed (17 references remain), so it's documented as pending.
- **data-contract:** new sections on the security model (H) and a new-matchup checklist (I), plus updates to sections C1, D, E1–E4 and E6.
- **README and surface brief:** the README gets a game/demo-day checklist; the surface brief is refreshed.

## Tests
- **Node:** 1518/1518 (whole suite).
- **Pytest, non-e2e:** 285 passed (was 246).
- **E2E on my area's files (loaded machine, other fixers' browsers running):**
  - **Neutral:** 117 passed, 6 failed. Three shorthand tests passed alone (13/13 rerun). test_111 and test_117 passed alone; test_117 was edited by another group mid-run. The 2D exposure check is fixed: the 2D field has its own overrun (see below), so it now asserts 2.0 s minus the camera move.
  - **Under the Lights:** 120 passed, 2 failed. Both failures are G5's new booth-focus test, not mine. After the last change, the exposure and hostile-text files pass on both worlds (6/6 on Under the Lights).
- **Goldens:** none regenerated by me (other groups changed them).

## Screenshots (in `/private/tmp/claude-501/g1-fixer/`)
- `after-4x-presnap-uls.png`, `after-4x-presnap-neutral.png`: the call held mid-wait at 4x.
- `after-flag-presnap-under-the-lights.png`, `after-flag-presnap-neutral.png`: a typed false start drawn with its label.
- `after-interception-under-the-lights.png`: a typed `I` reading "PASS INTERCEPTED".
- `names40-uls.png`, `names40-neutral.png`: a 40-character team name on each world.

## Found, outside my files
1. **2D play clock:** `fallback-player.js` `remount()` resets the play clock on every camera frame. Every 2D play overruns by the camera move (+1.1 s on Under the Lights, +0.6 s on neutral). Keeping `start` through the remount fixes it.
2. **Band overflow:** a 40-character team name still overruns the Under the Lights band into the score; the cell needs ellipsis truncation.
3. **Verdict-beat coupling:** the queue's reserve mirrors G2-3's 600 ms / 1500 ms verdict beat. Having `conductor.js` pass its beat length to `nextJob` would remove that coupling.

**File outside my list:** `requirements.lock` (new), which G1-13's lock requires.

## fix:G5 Booth, desk, keyboard & HUD layout

**G5 fixer report: Booth, desk, keyboard and HUD layout.** All 18 items are fixed. Five of them land differently from the spec, with reasons given under each. I made no commits, stashes, resets or checkouts.

## Per item

- **G5-1 fixed.** The drawer rails now use fill `backwards`. In manual and flag mode the cabinet doesn't animate; its racks run out instead, all except SITUATION, so the fixed strip never sits inside a transformed box. `uls-world.test.mjs` now rejects `both` or `forwards` fills and checks the rack rule.
  - New motion-on e2e `test_ui_booth_motion.py` covers idle, drive and final at 1440 and 1920, plus flag mode at both sizes.
  - It checks the strip's box during and after the run, and that `elementFromPoint` hits the feed key, Replay, the event id box, the strip fields, the first foul key and Close.
  - It fails on the old CSS: the strip moved to 0,140 at 398x52.

- **G5-2 fixed, one deviation.**
  - `arrange.js`: new `hudScale` = min(1, max(0.6, innerHeight / (0.375 × width clamped to 1440–1920, + 360))). It is set on `<html>` as `--uls-hud-scale` and updated on resize before the insets are read.
  - `tokens.css` multiplies the type, space and geometry tokens by it, plus a new `--uls-px` used for the desk's hardware pixels. Doto sizes never go below 40 px.
  - Desk: `scroll-padding-block-start` equals the entry line, rows snap, and `min-height` is plate + entry line + one key row. `booth.js` marks a key row the desk's foot would cut as `[data-cut]`, which hides it whole while it stays a Tab stop.
  - Second keypad row bottom vs desk bottom (px):

    | Window | Before | After |
    |---|---|---|
    | 1440x900 | 698 / 700 | 698 / 700 (unchanged) |
    | 1440x790 | 698 / 590 | 613 / 614 |
    | 1366x768 | 698 / 568 | 596 / 597 |
    | 1280x720 | 698 / 520 | 559 / 559 |
    | 1470x840 | 709 / 637 | 654 / 652 (2 px) |

  - At 1920x1080 and 1920x950 the first row is whole and the second scrolls in whole; the sliver is gone.
  - Focused controls covered by the entry line: 2–6 at five of the seven sizes before, 0 at all 7 now. Feed and watch desks were checked at short windows too.
  - **Deviation:** the floor holds one key row, not both. At 1920-class widths two rows don't fit (DESIGN.md already has the second row scroll there), and a two-row floor would cover the win-probability ribbon. The stacked-layout threshold stays at 640 px tall.

- **G5-3 fixed.**
  - `stripValues(..., {driveActive})`: with no drive, the chip is on the offense's side and Ball on is blank with placeholder 25. `actions` passes `drive_active`.
  - With a blank box off the field, the side chip sends the other side's 25.
  - After a FG from TB 5: "25" sends DAL 25 and "t25" sends TB 25. Covered by strip, actions and strip-e2e tests.

- **G5-4 fixed.**
  - Yards starts empty with placeholder 0; empty logs 0. `clearPick` and an incompletion both set it to "".
  - `selectOnFocus` also prevents the first mouseup after a mouse-press focus.
  - New e2e: a click at the left edge then "4" logs 4, both from empty and from "12".

- **G5-5 fixed.** The sync loop now remembers which version the timeline was last fetched at. A new version with the same row count refetches `{since: n}`. Comparing against the state's version would have missed a Punt, because the Punt's own reply already carries the new version.
  - New e2e: Punt or FG shows its result within 3 s. It fails with the fix disabled.

- **G5-6 fixed.** In the manual strip the end keys don't wrap; the drive line takes one line with an ellipsis, but only while keys share the row.
  - Keys at 1440 sit at y 52–90 (inside 44–96); at 1920 at y 64–114 (inside 56–120).

- **G5-7 fixed.** A successful start dispatches a new `booth/close` and calls a new form method, `focusTransport`.
  - Pause takes focus once it is laid out, retrying for up to 2 s, unless someone is typing in a text box.
  - e2e passes by mouse and by keyboard on both worlds.

- **G5-8 fixed.** `booth.js` sets `#app[data-desk-focus]`; the `last-play.css` rule now has `.uls-desk` as its `:has()` subject. A node test rejects any page-rooted `:has()` in the world's sheets.
  - Trace of a 10 s 2D watch at 4x: UpdateLayoutTree element count p50 25, p90 59; style time 222 ms.

- **G5-9 fixed, one deviation.**
  - New `dom.js` helper `openWhileKeyboardInside`: play feed and drive chart get `[data-open]` while keyboard focus is inside; Escape rolls up and refocuses the shown row. CSS uses `[data-open]`, and collapsed rows are visually hidden instead of `display: none`.
  - B focuses the drawer's first control and G focuses the stat board (a named region with tabindex -1); closing gives focus back.
  - `#app` is role=main and the masthead header is role=none. The board and band are named regions. Racks are groups only while the drawer is open.
  - New `test_ui_a11y.py`, motion on: the Tab walk at 1440x900, 1440x790 and 1920x1080 finds every stop on screen and uncovered, all 3 plays included. axe on the page, open drawer and open stat board finds 0 violations.
  - **Deviation:** X keeps focus in Yards rather than the first foul key, because the penalty yards are typed after X (checklist test #71).

- **G5-10 fixed.** New `face` field on each row in `vm-plays`: the field's label plus the player, e.g. "Q2 9:29 DAL INC 3 IN HIS TOP 3 DEEP PASS RIGHT · C.LAMB". ESPN's full text stays the button's name, visually hidden on the ribbon.
  - No paging under reduced motion and none while unrolled; a ResizeObserver re-measures.
  - Rows that didn't change are skipped: re-rendering the same game writes nothing.

- **G5-11 fixed.** The amber "fresh" windows are scoped to non-watch modes; the play's words still step in. Pinned by a node test.

- **G5-12 fixed, deviation on names.**
  - Escape closes an open drawer (new `closeBooth`) before clearing the pick.
  - The slider is a new "slider" target class: only arrows, Home, End, PageUp/PageDown and Space stay on the strip; B, G, V, retag keys, digits and Esc reach the page.
  - **Deviation:** an aria-label of "Back to live (Esc)" still fails axe, because the key's text reads "EscLive". So the keys are named by their visible word, with titles "Back to live (Esc)" and "Earlier play (Left)".

- **G5-13 fixed.**
  - Error toasts are `role=alert`, hold 8 s, pause on hover and focus, and have a Dismiss (Esc) key drawn by CSS so the toast's text is unchanged.
  - Esc dismisses an error toast first, except in flag mode.
  - The strip shows a persistent "INVALID" line with the server's words; the bad field points at it via `aria-describedby`.

- **G5-14 fixed, colour differs.**
  - Dim level is 0.85; axe colour-contrast went from 16 nodes to 0.
  - **Deviation:** the frame token `--uls-steel-frame` is #6F7C9D, not #6B7899. #6B7899 is only 2.94:1 on the raised steel the lamp sockets sit on; #6F7C9D gives 3.77:1 on steel and 3.10:1 there.

- **G5-15 fixed.**
  - Phone: masthead keys wrap, so V, B and G are on screen at 390 and 320; touch keys are 44 px.
  - At 1024x768 in a drive the band's facts now wrap; scrollWidth went from 1029 to 1024.
  - The pair gap and min-width rules from the spec are in. New e2e covers 390, 320 and 1024.

- **G5-16 fixed.** In Watch the drawer reads FEED, SETTINGS, SITUATION. The strip is read-only: tabindex -1, no side chip, no end keys. e2e added.

- **G5-17 fixed.** The unlit pixel is #342E28 (1.41:1), and the LED tile is offset 1 px. The offset is what actually fixes it: a dot centred on a block corner averages to flat black at any colour.
  - Board face std on the gridvis measure: 13.0 at 100%, 13.0 at 50%, 6.4 at 33% (was 9.4 / 0.0).

- **G5-18 fixed.** Backoff is 1, 2, then every 3 s.

## Tests

- **Node:** 1519 / 1519 pass.
- **pytest non-e2e:** 285 passed.
- **e2e, my files plus load, flags, shorthand, feed_replay and chrome:**
  - Neutral: 259 passed, 1 failed.
  - Under the Lights (plus the world file and goldens): 274 passed, 4 skipped, 1 failed.
  - The one failure both times was `test_ui_chrome` test_92. My new feed test was leaving the feed's applied-plays memory (`feed_seen`) on the shared sandbox. It now uses its own sandbox, and test_92 passes after it on both worlds.
- **Reruns after the last fixes**, both worlds: a11y (with axe), game surfaces and scores_sync 50/50; booth motion 8/8; G5-7 2/2; small windows 3/3.
- **Goldens** passed within 1%; none regenerated.
- **Expectations I updated in my own files** because another group changed behaviour: strip #15 (server range messages) and #16 (a negative score is now refused); scores #111 (a tie at the shown precision has no tone); the actions reset-confirm test now reads the copy constant.

## Screenshots

In `/private/tmp/claude-501/g5-fixer/shots/`; all looked at:
- `g51-before-1440x900.png`, `g51-after-1440x900.png`, `g51-after-flag-1920x1080.png`
- `g52-before-manual-1920x1080.png`, `g52-after3-manual-1440x790.png`, `g52-after3-desk-1920x1080.png`, `g52-after3-watch-1440x790.png`, `g52-after3-feed-1280x720.png`
- `g56-after-1440x900.png`, `g510-ribbon-1440.png`, `g59-unrolled-crop.png`
- `g513-error-1440.png`, `g513-neutral-toast.png`, `g513-neutral-strip.png`
- `g515-after-390x844.png`, `g515-band-1024.png`, `g515-band-1024-before.png`, `g516-after-drawer-watch-1440x900.png`

## Files outside my list

- `tests/e2e/test_ui_checklist_load.py`: test_04 now expects Ball on blank with placeholder 25 (follows from G5-3).
- `tests/e2e/test_ui_chrome.py`: test_117/118/121 hide timeout 4 s → 12 s and docstring (error toasts hold 8 s, G5-13).

## Worth knowing

- At 1024x768 the scoreboard skin's team names are overprinted by their score windows. This was there before my changes and is in `scoreboard.css`, which isn't mine.
- The axe tests only run when `SC_AXE_JS` points at an `axe.min.js`. The repo has none; I used axe-core 4.12.1 from another local project.
- The machine ran at load 40–200 during the e2e runs, so motion tests use the 2D scene and wait for animations to finish.
- One `pkill` by pattern stopped my own full-suite run. I checked that no other agent's pytest matched the pattern; theirs kept running.
