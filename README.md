# Shadow Play-Caller

Predicts an NFL play-caller's next call before the snap (run or pass, then the play type, then the specific play) from the league baseline, his own habits and his in-game memory. It shows the game like ESPN GameCast on a 3D field, draws his two most likely plays on the turf before each of his snaps, and grades every call against a caller-blind league baseline. Set up for Brian Schottenheimer's Dallas offense, Buccaneers at Cowboys, Oct 8 2026.

## Run it

```bash
cd shadow-caller
bash start.sh           # first run: a .venv with the exact versions in requirements.lock; opens http://localhost:5050
```

The page opens the game named in `config.py` (`espn_event`) by itself: a game in progress, or one that hasn't kicked off, goes live; a finished game opens paused at kickoff. Opening a game rebuilds it from ESPN, so the game file it replaces is copied aside first (`data/live_state.backup-<time>.json`; the newest 20 are kept). Reloading the page never moves the game.

`start.sh` needs Python 3.12 or newer and installs `requirements.lock`: every package at the version the models were built with, each checked against its hash. The models are already built (`models/`). To rebuild them from fresh nflverse data (about 30 seconds, online):

```bash
.venv/bin/python build.py
```

The app rebuilds missing models by itself on a fresh setup, but never while `data/live_state.json` holds a game in progress: then it stops and says to run `build.py` (a rebuild mid-game would change his predictions, and fails offline).

## Finding an ESPN game id

Open the game on espn.com (its Gamecast, box score or play-by-play page). The address looks like `https://www.espn.com/nfl/game/_/gameId/401872980/...`: the number after `gameId/` is the id (older addresses put it after `gameId=`).

Put it in `config.py` as `espn_event`, or leave `espn_event` empty and the app finds today's game for the offense on ESPN's scoreboard. A new game needs a new `game_id` as well: the two change together, because a new `espn_event` under the old `game_id` can keep the old game on screen. For another matchup also change the teams and lines in `GAME`; the checklist is `docs/design/data-contract.md` section I (copy the old game file first; a new play-caller needs his rows in `data/play_callers.csv` and a `build.py` run). Then restart (Ctrl+C, then `bash start.sh`).

## The home page

- **The field.** A 3D stadium with every play of both teams drawn from the line of scrimmage and labeled on the turf ("Deep pass left · +21"). Before each of his snaps the lights dip and his two most likely plays appear as thin dashed shadow plays, NEXT 1 in amber and NEXT 2 in warm white, each with its odds; his last play stays in steel, tagged LAST with its grade. The stadium's LED ribbons carry the next call and each play's words.
- **The video board** (upper right) shows every section at once: PREVIOUS PLAY (his last call, how it went and its grade: top pick, in his top 3, or a miss with its rank and odds), his NEXT CALL (the top pick with its odds, #2 and #3, the pass/run split against the league, the five play types) and LAST 6 (his last six calls graded, and his night so far). Point at the board to open all 14 specific plays and why the model leans; point at a play to see its shadow on the field. While the other team has the ball it says who has it; at the final whistle it shows the score and a link to tonight's scorecard.
- **The top bar** has two rows: the game, the newest play and the view keys (camera, Model Report, settings), then the playback row (keys below).
- **Across the bottom:** the drive chart (click a drive to jump to its first play), his team's win probability, and the scoreboard: teams, scores, quarter, clock, down and distance, ball on.

Nothing on the page enters plays or edits the game: it plays, pauses, steps and jumps through what ESPN shows.

### Top bar buttons and keys

| Key | Button | What it does |
| --- | --- | --- |
| Left, Right | Back, Forward | One play back or forward, paused |
| Space | Play / Pause | Plays or pauses the game at the chosen speed |
| 1 to 4 | 1x, 2x, 4x, 10x | Playback speed (4x to start) |
| | Progress bar | Click or drag to jump to any play. Ticks mark drives (his in white), quarters and scores; a score's tick appears only once play has passed it. |
| | Reset | Back to kickoff, paused |
| Esc | Go Live | A live game: every ESPN play so far, then the live feed. A finished game: its final state. Its lamp is lit at the live edge. |
| V | Camera | Wide (the TV angle, the default) or Blimp (overhead) |
| | Model Report | Opens the Model Report |
| | Settings | **Light dip in live games** (on by default; a watched game always dips) and **Room lights** (on for a lit room or a projector) |

Those are the only keys. Esc closes an open settings menu or error message before it goes live. With the progress bar focused (Tab to it), Left and Right step, Page Up and Page Down jump a drive, Home goes to kickoff and End goes live. Shortcuts never fire with Cmd, Ctrl or Alt held, or while typing in a text box.

## The Model Report

The top bar's **Model Report** (or http://localhost:5050/report): how the model did tonight, on a laptop or a TV. It follows the game as it plays and only reads; nothing on it changes the game.

- **His night so far:** top picks and top-3 hits out of his calls, his last six, and every call in order as a bar as tall as the model's chance on what he called (grouped by drive, his five biggest surprises numbered).
- **His scorecard:** every SHADOW v LEAGUE pair (run or pass called right, play in his top 3, and the pass vs run, play type and specific play log losses) and the full scorecard. Lower log loss is better; one game is a pipeline test, not proof.
- **Hit rate by down and distance:** 1st; 2nd and 3rd short, medium and long; 4th. His top picks and top 3 against the league baseline's top 3.
- **His biggest surprises:** the five calls the model gave the lowest chance.
- **His tendencies** (pass/run terms with 90% intervals, play-type mix vs expected) and the **in-game memory** effects that fired.
- **Win probability** (large), the **drive chart** (a drive of his jumps to its calls) and **team stats**.
- **Every call v the model:** each of his snaps with the model's top 3, what he called, its rank and the verdict.
- **Back to the GameCast** and **Export CSV** (the call log) on its top bar.

## Live games and the ESPN feed

- A live game logs each play a few seconds after ESPN posts it: down, distance, spot, clock, score, run gap and side, pass depth, sacks, scrambles, incompletions, touchdowns, turnovers, punts, field goals and penalties (a flag that wipes out a play still grades his call). Open the page before kickoff and it waits for the first play.
- Back, Reset and the drive chart work on a live game too: the game rebuilds to that point, paused, and the feed stops; Go Live (Esc) catches up again.
- The feed checks the teams before it logs anything: an event for another matchup is refused with the reason ("ESPN event X is NYG at PHI, not DAL v TB"), and the game on screen is untouched. Before the feed adds another event's plays to the game on screen, that game is backed up in `data/`.
- ESPN can't tell play-action, screens or RPOs: those log as the dropback or run its text describes, and his call is graded on that. Games are graded on what ESPN shows, with no regrading from charting later.
- ESPN's feed is unofficial and free; it can lag or change. A failed poll is retried at 4, 8, 16, then every 30 seconds, and a poll that comes back thin or broken never wipes the game on screen. The Model Report's top bar reads ESPN LIVE, with its red lamp, while the last poll succeeded.
- Each play is read once: if ESPN later rewrites a play (replay review, corrected yards), the first version stands. A play the feed can't apply is skipped and named in the Terminal running the app.

## Demos: the sandbox

The sandbox runs the app on a throwaway copy of the data: a new temp folder with the play-caller table, the saved finished games and the logos, offline, so a demo never touches `data/live_state.json`. It opens the saved TB at DAL game paused at kickoff.

```bash
.venv/bin/python scripts/sandbox.py                  # prints its folder; open http://127.0.0.1:5061
.venv/bin/python scripts/sandbox.py --port 5062      # another port
.venv/bin/python scripts/sandbox.py --data <folder>  # reuse a folder from an earlier run
.venv/bin/python scripts/sandbox.py --online         # call the real ESPN instead of the saved games
```

The browser doesn't open by itself; go to the address it prints. Ctrl+C stops it.

## Before a game or a demo

- **Run the browser full screen** (Ctrl+Cmd+F on a Mac). The page is laid out for 1440x900, Sam's 1512x982 laptop and a 1920x1080 TV; a shorter window (the browser's toolbars) scales the whole layout down to fit.
- **Open the page once before the demo starts.** The first load compiles the stadium's shaders and fetches the fonts and logos; a second visit is instant.
- **Quit screen recorders and turn off Low Power Mode.** Both throttle the GPU, and the 3D field then drops frames. A browser that can't draw 3D (no WebGL2) shows the same game on a 2D field; `?scene=2d` on the address forces it.
- In a watched game his next call and its shadow plays stay on the field before each of his snaps: about 2.6 s at 4x (the default) and 1.8 s at 10x. TB at DAL runs about 14 minutes at 1x, 9.6 at 2x, 6.6 at 4x and 4.3 at 10x.

## Tests

```bash
.venv/bin/python -m pip install -r requirements-dev.txt
node --test 'tests/js/**/*.test.mjs'                          # the pages' logic (npm run test:js:cov adds coverage)
.venv/bin/python -m pytest tests -q -m "not e2e"              # server, parser, timeline, playback (about 2 minutes)
.venv/bin/python -m pytest tests/e2e/test_ui_card.py -q -x    # one e2e file in Chromium (Playwright)
SC_E2E_WORLD=under-the-lights .venv/bin/python -m pytest tests/e2e/test_ui_card.py -q -x   # the same in the stadium
```

Run e2e files one at a time, never the whole folder: several headless browsers rendering the stadium at once overload the Mac. The default e2e world is the plain one; `SC_E2E_WORLD=under-the-lights` runs the stadium.

The ESPN parser is checked play by play against nflverse on a real game (TB at DAL, Oct 8 2026: `data/espn/summary_401872980_final.json`, truth in `tests/fixtures/`), plus a full replay checked against ESPN's own drive summaries. Tests run in a temp folder and never touch `data/live_state.json`.

## Stack

| Layer | Tool |
| --- | --- |
| Data pull | nflreadpy (nflverse play-by-play, 2018 to 2026) |
| Storage | DuckDB (`data/shadow.duckdb`: `plays`, `caller_snaps`, `live_log`) |
| Stage 1 baseline | scikit-learn HistGradientBoosting, trained on every team except Dallas |
| Play-type model | League gradient boosting on FTN charting 2022 to 2026, then his softmax adjustment shrunk toward the league |
| Stage 2 caller model | Ridge-penalized logistic with the baseline as offset; memory = a value update with learning rate alpha |
| App | Flask on localhost; two pages (the GameCast and the Model Report) in plain ES modules and three.js, no build step |

## Files

- `config.py`: the game, the caller, thresholds; `espn_event` is the ESPN game id. Change these for another matchup.
- `data/play_callers.csv`: who called plays when. Add rows for new callers, then run `build.py`.
- `build.py`: pulls data, fits both stages and the play-type model, writes `models/`.
- `granular.py`, `build_granular.py`: the play-type and specific-play model.
- `live.py`: game state, memory updates, predictions, scoring.
- `espn_feed.py`: ESPN live play-by-play: parses each play and feeds the engine.
- `app.py`: the local server. `static/index.html` is the GameCast, `static/report.html` the Model Report.
- `watch.py`, `playback.py`, `watch_session.py`: playback (open, play, pause, step, seek, Go Live), its pacing, the progress bar's ticks, backups and the session file.
- `timeline.py`, `timeline_text.py`: every play of both teams as drawable rows (`/api/timeline`).
- `scripts/sandbox.py`: the app on a throwaway copy of the data (Demos).
- `games.py`, `games_api.py`, `callers.py`, `analyst*.py`: the next phases (a game picker, a model per play-caller, the AI analyst), built and tested but not wired into the app yet.
- `requirements.txt`: what the app needs; `requirements.lock`: the exact, hashed versions `start.sh` installs.
- `data/live_state.json`: the game on screen, saved after every play (restart-safe). A file for another game is copied aside (`live_state.other-<game_id>-<time>.json`) before the new game's first save.
