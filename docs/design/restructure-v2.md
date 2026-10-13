# Restructure v2: Sam's direction (2026-10-10), binding

Sam: "I wanna remove a lot of things from the home screen to make it less congested ... on the first screen it should just be like the prediction in the game cast ... I don't want any user input. I want clear buttons at the top." This file records his answers to every follow-up question. It overrides earlier specs (ui-architecture.md, DESIGN.md, feature-inventory.md, directions.md) wherever they disagree. play-drawing.md (sections 1 to 4b) still governs how plays and shadows are drawn.

## 1. Home screen: the GameCast and the prediction

**Keep**
- The 3D field (Under the Lights) with the shadow plays, the drawn plays and their labels, the in-stadium LED ribbons.
- The video-board card (section 3), exactly as Sam likes it, with its new always-on layout.
- The scoreboard band, row 1 only: team logos and names, scores, QTR, TIME, DOWN & distance, BALL ON.
- The lower ribbon: drive chart and win probability (both stay on home).
- The top LED ticker (newest play text).

**Remove from the home screen**
- The SHADOW V LEAGUE row (scoreboard band row 2). It moves to the Model Report.
- All user input into the game: the manual-entry keypad, the flag panel (X), the shorthand bar, the retag keys and row (A, N, O, P, J, K, L), Undo, inline editing of the situation strip.
- The ESPN live on/off switch, the event-id box, the Replay and Watch buttons (the top bar replaces them).
- The control-room drawer (B) and its key. Its two settings (light dip, room lights) move to a small settings menu in the top bar.
- The stat board (G) and its key. Its content moves to the Model Report.
- Export CSV (moves to the Model Report).
- The Tight camera (section 4).

The backend's manual-entry endpoints may stay for compatibility, but the UI never calls them.

## 2. Top bar (clear buttons)

Left to right: title and game ("Shadowing Schottenheimer · DAL"; when tracking both sides, both callers), the game picker (phase 2; in phase 1 it shows the current game), playback, camera, Model Report, Ask (phase 4, hidden until then), settings.

**Playback controls:** step back · Play/Pause · step forward · speed (1x 2x 4x 10x) · a progress bar with drive ticks (click or drag to jump to any play) · **Reset** · **Go Live**.

**Keys (no others):** Space play/pause, Left/Right step back/forward, 1 to 4 speed, V camera, Escape = Go Live.

## 3. The card (video board): every section at once

The card never switches between "prediction" and "verdict" states. After each play it shows all of this at the same time:

```
PREVIOUS PLAY
Short pass left · +11                 ✓ TOP PICK 19%
SCHOTTENHEIMER'S NEXT CALL · SNAP 42
INSIDE RUN (A/B GAP)   21%
then  PA short 16%  ·  Short (0–9) 12%
[run/pass split + play-type bars, tilt tag, as before]
LAST 6   ✓  ✗  3  ✓  ✗  ✓
```

- PREVIOUS PLAY: his most recent call (the tracked offense's last snap): what he called, the result, and the verdict (top pick with its %, "in his top 3 · #2 · 14%", or "miss · #4 Intermediate · 10%"). It stays while the other team has the ball (it is still his previous call); before his first snap the section is absent, not a placeholder.
- NEXT CALL: the top pick with its %, then #2 and #3 with their %, plus everything the card already shows (bars, split, tilt tag).
- LAST 6: his last six calls graded (✓ top pick, a number = its rank in his top 3, ✗ miss), with his night so far beside it as the old recap said it (top picks and top-3 hits out of his calls).
- Sam: "and whatever was on there before". Nothing the card showed before is dropped; the old "recap" face's content now lives in PREVIOUS PLAY and LAST 6, shown all the time.
- When the tracked offense doesn't have the ball, the NEXT CALL section reads "TB has the ball" (when tracking both sides, the card follows the offense with the ball); PREVIOUS PLAY and LAST 6 stay up.
- The card fits at 1440x900, 1512x982 (Sam's laptop) and 1920x1080 without covering the top bar, the scoreboard band, the ball or the shadow plays, and without shrinking text below its current sizes (drop decoration before shrinking type).

## 4. Camera

Two views only, toggled with V: **Wide** (the normal TV angle, default) and **Blimp** (the overhead stadium view). No Tight anywhere: no Tight mode, no automatic push-in at the snap, no automatic float-up between drives. Following the ball sideways in Wide is fine.

## 5. Playback semantics (no user input into the game)

- **Opening a finished game:** paused at kickoff, showing the opening situation. **Opening a live game:** Go Live.
- Play, Pause, speed, step and seek drive the Watch engine (the server applies plays in order). Stepping or seeking backward restarts the game from kickoff and fast-forwards to the target play, paused.
- **Reset:** back to kickoff, paused.
- **Go Live:** for a live game, stop playback, apply every ESPN play so far and follow the live feed; for a finished game, jump to the final state.
- The live game file stays protected by the existing backups.

## 6. Model Report page (/report)

A second page reached from the top bar ("Model Report"), in the same stadium vocabulary (LED, segment, steel), readable on a laptop and a TV, with a link back to the GameCast:
- Shadow vs League: every scorecard metric, per tracked play-caller.
- Every call vs the model: a table of each caller snap (number, quarter and clock, situation, his top 3 with %, what he called, its rank, the verdict).
- His tendencies: pass/run terms, play-type mix vs expected.
- Box score (both teams), the win-probability chart (large) and the drive chart.
- The "so far" recap; hit rate by down and distance; his biggest surprises (the lowest-probability calls he made); the in-game memory effects that fired.
- Export CSV.
- Room for the AI analyst's full chat (phase 4).

## 7. Later phases (in this order)

2. Game picker: 2026 season only; live games open live, finished games open paused at kickoff; pick the side to shadow, or track both sides with separate stats (default: one side); per-game state so switching games never touches another game.
3. Play-callers: a sourced table for all 32 teams, 2024 to 2026 (research running: data/play_callers_2024_2026.csv, docs/design/play-callers.md), a model per caller, the caller picker, tracking both sides.
4. AI analyst: local gpt-oss 20B through Ollama, typed questions only, tools over the game's own data, an Ask slide-out on home and the full chat on the Model Report.

No automatic regrading from nflverse charting: games are graded on what ESPN shows.

## 8. Finding an ESPN game id

Open the game on espn.com. The address looks like `https://www.espn.com/nfl/game/_/gameId/401872980/...`; the number after `gameId/` is the id.

## 9. Phase 1 server contract

Every call below answers with the full state like the other state calls, sits behind the existing Host/Origin/Content-Type gate, validates its body strictly (400 with a plain reason), and protects the game file through the Watch engine's existing backups (a session's first rebuild backs the game up exactly like `/api/watch/start`; later rebuilds keep that session's restore point).

| Call | What it does |
| --- | --- |
| `POST /api/open` (no body) | What the home page calls once on load. A watch session (playing, paused, done, error) or the live feed already running: nothing changes. Otherwise: ESPN game in progress → Go Live; else → a watch session paused at kickoff (seek 0). |
| `POST /api/watch/seek {"idx": N}` | Rebuild the game from kickoff and apply the first N ESPN plays at once (no pacing), then hold: "paused", or "done" when N equals the total. Integer 0 ≤ N ≤ total, else 400. Reset is seek 0. Allowed from any state. |
| `POST /api/watch/back` (no body) | One drawn play back: rebuild to just after the previous play that drew a timeline row (kickoff when there is none), paused. At kickoff: 409 "Already at kickoff." |
| `POST /api/watch/forward` (no body) | One drawn play forward: apply plays up to and including the next one that draws a row, paused. At the end: 409. (`/api/watch/step` keeps its one-ESPN-play meaning.) |
| `POST /api/golive` (no body) | ESPN game in progress → apply every ESPN play so far, end the watch session keeping the game (no restore), and turn the live feed on for that event. Game final → seek to the end ("done"). ESPN unreachable when it is needed → 503 with a plain message, nothing changes. |
| watch object additions | `marks`: `[{"idx", "kind": "drive" \| "quarter" \| "score", "team", "label"}]` for the progress bar's ticks (in `/api/watch` and `/api/state`, not in the 250 ms `/api/version` brief); `game`: `{"status": "pre" \| "in" \| "post", "detail": "Final"}` so the UI knows live from final. |
| `GET /report` | Serves `static/report.html` with the same gate and headers as `/`. |

`idx` is the Watch engine's own counter (ESPN plays applied, 0 to `total`), so the progress bar maps straight onto it.

## 10. Phase 1 build split (file ownership)

Four builders run at the same time in one working tree, so each owns its files; a change another builder's file needs goes in that builder's report as a request, never as an edit (the integrator applies it).

- **Server**: `watch.py`, `app.py`, any new Python module, `tests/test_*.py` for them. No front-end files.
- **Home frame**: `static/index.html`, `static/js/main.js`, `static/js/shell/**`, `static/js/core/**`, every `static/js/ui/*` and `static/js/model/vm-*` module except the card's, the camera (`static/js/field/cameras.js`, `camera-plan.js`, `moments.js`, the world's `moments.js`), the world's `booth.js` (becomes the settings menu), `static/css/layout.css`, the component and world CSS for everything it owns including both worlds' `layout.css`, and the tests and e2e files for those surfaces (removing the ones whose feature is gone).
- **Card**: `static/js/ui/prediction.js`, `static/js/ui/last-play.js`, `static/js/model/vm-prediction.js`, `vm-last-play.js`, `verdict.js`, the card strings in `static/js/model/copy.js` (only those), the card's CSS in both worlds (`prediction.css`, `last-play.css`, the world's `board.css`), its node tests and its e2e checks. It may edit only the `prediction` and `last-play` entries of `static/js/shell/bindings.js`.
- **Model Report**: new files only (`static/report.html`, `static/js/report/**`, report CSS for both worlds, its node tests, `tests/e2e/test_report_page.py`). It reuses existing modules by importing them unchanged; it never ships the 3D engine.

Testing (ECC): tests first for new behaviour; node and non-e2e pytest suites green; e2e runs one file at a time and only a builder's own files (the machine overloads when several headless browsers render the stadium at once); the integrator runs the wider e2e set once.

## 11. Phases 2 to 4 wiring (after phase 1 lands)

Status: **wired (2026-10-12)**; each track's doc records it as applied (game-picker.md 4 and 5, play-caller-models.md 7,
analyst.md 7, analyst-ui.md 4 to 6). Two rules the wiring settled: today's game is adopted only by the server's own
start (`python app.py`, as `start.sh` and `scripts/sandbox.py` run it), never by importing app.py; and with both sides
tracked the field keeps the game's frame (its offense attacks +x, the other team -x, each in its own colours on the
field, the drive chart and the scoreboard), so the other offense's ball, line to gain and shadow plays are drawn from
its own side.

The three tracks were built as new files and documented; this phase wires them in. Binding: game-picker.md sections 4 and 5 (per-game state, adoption of today's game, `POST /api/game/select`), play-caller-models.md section 7 (engine loads a caller, tracking both sides), analyst.md section 5 and analyst-ui.md sections 4 to 6 (the analyst's blueprint and the chat's mounting).

Decisions:
1. A side with no built model is not offered: the picker disables it and says why (the index's reason).
2. Each track's line is frozen when the track is first made (`game.json`); TB at DAL keeps 8.5 and 48.5.
3. Today's game is adopted by copy (game-picker.md 4): checked byte for byte, `index.json` written last, and the app never writes the old `data/` files again.
4. Tracking both sides: the card follows the offense with the ball and is headed with that caller's name ("GRIZZARD'S NEXT CALL"); its PREVIOUS PLAY and LAST 6 are that same caller's; the top bar names both callers; the Model Report has a switch between the two callers' sections (scorecard, calls table, tendencies, surprises, memory) while the box score, win probability and drives stay shared. The analyst sees every tracked caller.
5. Fix while wiring: page shortcuts never fire while the picker is open; "Track both sides" selects both sides; a double-click on Ask doesn't send and then stop; the Under the Lights chat skin wins the cascade (no soft shadows, per the flat hardware rule).

Ownership (four builders at once):
- **Engine**: live.py, timeline.py, timeline_text.py, callers.py, config.py and their tests. Contract: `GameEngine(caller=None)` as today plus `GameEngine(callers={"DAL": CallerModel, "TB": CallerModel})`; `engine.sides`; `engine.metrics(team=None)`; per-team memory; every caller row and prediction carries `team` and `caller`.
- **Server**: app.py, watch.py, playback.py, watch_session.py, espn_feed.py, games.py, games_api.py, analyst_api.py, analyst_snapshot.py, analyst_tools.py, scripts/sandbox.py, .gitignore and their tests. Registers the games and analyst blueprints, adds `GET /api/callers` and `POST /api/game/select`, adopts today's game, and puts `track: {event_id, sides, label}` and `tracked: [{team, caller, slug}]` in `/api/state`.
- **Home**: static/index.html, static/js/main.js, shell, core, the non-card ui and vm modules, static/js/picker/**, static/js/ask/**, their CSS, and the home e2e files. Mounts the picker in the top bar's game label and the Ask slide-out; a cite seeks the GameCast.
- **Card and report**: the card's modules, static/report.html, static/js/report/** and their CSS and tests. Both-sides display; mounts the full chat on the report; a cite scrolls to that call's row.

Testing (Sam): unit suites in full; e2e and visual checks sampled (a handful of files and spot points), never full run-throughs.
