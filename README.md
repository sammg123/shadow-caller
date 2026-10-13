# Shadow Play-Caller

Predicts an NFL play-caller's next call before the snap (run or pass, then the play type, then the specific play) from the league baseline, his own habits and his in-game memory. It shows the game like ESPN GameCast on a 3D field, draws his two most likely plays on the turf before each of his snaps, and grades every call against a caller-blind league baseline. Any 2026 game opens from the game picker, shadowing one side's play-caller or both (50 of the 59 play-callers since 2024 have a model), and a local AI analyst answers typed questions about the game. Set up for Brian Schottenheimer's Dallas offense, Buccaneers at Cowboys, Oct 8 2026.

## Run it

```bash
cd shadow-caller
bash start.sh           # first run: a .venv with the exact versions in requirements.lock; opens http://localhost:5050
```

The page opens the game that was on screen when the app last stopped (`data/games/index.json` names it; with no index yet, the game in `config.py`) by itself: a game in progress, or one that hasn't kicked off, goes live; a finished game opens paused at kickoff. Opening a game rebuilds it from ESPN, so the game file it replaces is copied aside first (`live_state.backup-<time>.json` in that game's folder; the newest 20 are kept). Reloading the page never moves the game.

`start.sh` needs Python 3.12 or newer and installs `requirements.lock`: every package at the version the models were built with, each checked against its hash. Tonight's model is in `models/`, the play-callers' models in `models/callers/` (Play-caller models, below). To rebuild tonight's from fresh nflverse data (about 30 seconds, online):

```bash
.venv/bin/python build.py
```

The app rebuilds a missing `models/` by itself on a fresh setup, but never while the game on screen is in progress: then it stops and says to run `build.py` (a rebuild mid-game would change his predictions, and fails offline). A game on a play-caller's model that won't load stops the start the same way and says to run `scripts/build_callers.py`.

## The home page

- **The field.** A 3D stadium with every play of both teams drawn from the line of scrimmage and labeled on the turf ("Deep pass left · +21"). Before each of his snaps the lights dip and his two most likely plays appear as thin dashed shadow plays, NEXT 1 in amber and NEXT 2 in warm white, each with its odds; his last play stays in steel, tagged LAST with its grade. The stadium's LED ribbons carry the next call and each play's words.
- **The video board** (upper right) shows every section at once: PREVIOUS PLAY (his last call, how it went and its grade: top pick, in his top 3, or a miss with its rank and odds), his NEXT CALL (the top pick with its odds, #2 and #3, the pass/run split against the league, the five play types) and LAST 6 (his last six calls graded, and his night so far). Point at the board to open all 14 specific plays and why the model leans; point at a play to see its shadow on the field. While the other team has the ball it says who has it; at the final whistle it shows the score and a link to tonight's scorecard.
- **The top bar** has two rows: the game key (it opens the game picker), the newest play and the view keys (camera, Model Report, Ask, settings), then the playback row (keys below).
- **Across the bottom:** the drive chart (click a drive to jump to its first play), his team's win probability, and the scoreboard: teams, scores, quarter, clock, down and distance, ball on.

Nothing on the page enters plays or edits the game: it plays, pauses, steps and jumps through what ESPN shows.

### Top bar buttons and keys

| Key | Button | What it does |
| --- | --- | --- |
| | Game | Opens the game picker (Picking a game, below). It reads the current game, "TB at DAL · Final" |
| Left, Right | Back, Forward | One play back or forward, paused |
| Space | Play / Pause | Plays or pauses the game at the chosen speed |
| 1 to 4 | 1x, 2x, 4x, 10x | Playback speed (4x to start) |
| | Progress bar | Click or drag to jump to any play. Ticks mark drives (his in white), quarters and scores; a score's tick appears only once play has passed it. |
| | Reset | Back to kickoff, paused |
| Esc | Go Live | A live game: every ESPN play so far, then the live feed. A finished game: its final state. Its lamp is lit at the live edge. |
| V | Camera | Wide (the TV angle, the default) or Blimp (overhead) |
| | Model Report | Opens the Model Report |
| | Ask | Opens the analyst's drawer (Ask the analyst, below); reads "Ask · Not ready" while it can't answer |
| | Settings | **Light dip in live games** (on by default; a watched game always dips) and **Room lights** (on for a lit room or a projector) |

Those are the only keys. Esc first closes what is open (the game picker, the Ask drawer while you're in it, the settings menu, an error message), then goes live. With the progress bar focused (Tab to it), Left and Right step, Page Up and Page Down jump a drive, Home goes to kickoff and End goes live. Shortcuts never fire with Cmd, Ctrl or Alt held, while typing in a text box, while the game picker is open or inside the Ask drawer.

## The Model Report

The top bar's **Model Report** (or http://localhost:5050/report): how the model did tonight, on a laptop or a TV. It follows the game as it plays and only reads; nothing on it changes the game.

- **His night so far:** top picks and top-3 hits out of his calls, his last six, and every call in order as a bar as tall as the model's chance on what he called (grouped by drive, his five biggest surprises numbered).
- **His scorecard:** every SHADOW v LEAGUE pair (run or pass called right, play in his top 3, and the pass vs run, play type and specific play log losses) and the full scorecard. Lower log loss is better; one game is a pipeline test, not proof.
- **Hit rate by down and distance:** 1st; 2nd and 3rd short, medium and long; 4th. His top picks and top 3 against the league baseline's top 3.
- **His biggest surprises:** the five calls the model gave the lowest chance.
- **His tendencies** (pass/run terms with 90% intervals, play-type mix vs expected) and the **in-game memory** effects that fired.
- **Win probability** (large), the **drive chart** (a drive of his jumps to its calls) and **team stats**.
- **Every call v the model:** each of his snaps with the model's top 3, what he called, its rank and the verdict.
- **Ask the analyst:** the full chat, at the end.
- **Back to the GameCast** and **Export CSV** (the call log) on its top bar.

## Picking a game

The top bar's **Game** key opens the picker:

- **The 2026 season by week**, this week first. Each game shows its score and state (Live with the quarter and clock, Final, or the kickoff in your own time) and whose calls it can shadow ("Shadow: Schottenheimer (DAL)"). Filter by team, or paste an ESPN game link or id and press Find.
- **Pick a game, then whose calls to shadow.** A side is offered only when its play-caller has a built model; otherwise it is greyed out with the reason ("Only 4 games (226 snaps) in the data; a model needs at least 5 games and 200 snaps."). **Track both sides (separate stats)** shadows both offenses and needs a model on both sides.
- **Open this game.** A finished game opens paused at kickoff, a live one goes live, and one that hasn't started goes live and waits for kickoff. The page follows without a reload. A game with no betting line yet (neither nflverse nor ESPN has one) can't be opened: the model needs the spread and the total.
- Esc, or a click outside, closes it.

**Finding an ESPN game id.** Open the game on espn.com (its Gamecast, box score or play-by-play page). The address looks like `https://www.espn.com/nfl/game/_/gameId/401872980/...`: the number after `gameId/` is the id (older addresses put it after `gameId=`). Paste the whole address or only the number; the address is only read, never opened. The picker lists 2026 only and says why when a game isn't there ("ESPN game 401772510 is from the 2025 season; the picker lists 2026 only.").

`config.py`'s `GAME` is only the starting game, before anything has been picked. A new matchup needs no edit there: pick it.

### Tracking both sides

One engine with a model per offense: before each snap the offense with the ball uses its play-caller's model, each caller keeps his own in-game memory, and each is graded on his own calls.

- The video board follows the offense with the ball and names its caller ("ROBINSON'S NEXT CALL"); its PREVIOUS PLAY and LAST 6 are his. The top bar names both callers.
- Both offenses get their two shadow plays, each drawn from its own side of the field.
- The Model Report gets a switch on its top bar between the two callers' sections; win probability, drives and team stats stay the whole game's. The analyst knows both callers.

### Where each game lives

Every game, and every set of sides tracked in it (a track), has a folder of its own, so switching never touches another game:

```
data/games/
  index.json      the track on screen: a restart opens it again
  401872980/
    game.json     each track's settings (teams, betting line, play-callers, model), fixed when the track is made
    DAL/          Schottenheimer's calls: live_state.json, feed_seen.json, the replay's session file and backups
    DAL+TB/       both sides tracked: its own files and its own stats
```

- Shadowing Tampa Bay in the same game later makes `401872980/TB/` and leaves `DAL/` as it was. Rows in `data/shadow.duckdb`'s call log carry their track, so resetting one track never deletes another's, and the rows from the live night (from before tracks) are never deleted at all.
- Before a run of the app first changes `data/shadow.duckdb` (adding its new columns, or deleting rows an earlier run wrote), it keeps one copy as `data/games/shadow.duckdb.kept-<time>`, checked byte for byte, named in the server log, never pruned. If that copy can't be made, the run leaves the file alone and says so in the log; the game files still record every play.
- A track's betting line is fixed when the track is made. The adopted TB at DAL track keeps 8.5 and 48.5, the line it was graded with live; a new track of that game (Tampa Bay's side, or both) takes today's line, which nflverse now lists as 9.5 and 49.5.
- **The first start of this version adopts today's game.** It copies `data/live_state.json`, its ESPN play record, any replay session and its backups into `data/games/401872980/DAL/`, checks every copy against its source (sha256) and writes `index.json` last. If anything fails, `data/` stays exactly as it was and the app runs on it as before. Once adopted, the app never writes those files in `data/` again: they stay as a safety copy, and deleting them is your call.
- The adopted TB at DAL track keeps `models/`, the Oct 8 build Schottenheimer was graded on live. Every new track runs on the play-callers' models.

## Play-caller models

Every play-caller in the table with enough games gets his own model: the same three layers as tonight's, from the same code.

1. **League baseline:** gradient boosting on nflverse play-by-play, 2018 to 2026, trained on every team except the teams he called plays for (in every season), so it never saw his snaps in the table. Stints before 2024 aren't in the table, so they can be: Schottenheimer's Seattle seasons (2018 to 2020) are in his baseline.
2. **His habits and in-game memory:** a ridge-penalized logistic model on his snaps since 2024 with the baseline as its offset, cross-validated by game.
3. **His play types and specific plays:** league models on FTN charting 2022 to 2026, then his adjustments, shrunk toward the league.

`models/callers/` holds a bundle per caller (`<slug>/stage1.joblib`, `granular.joblib`, `profile.json`; about 5.5 MB each, 275 MB in all) and `index.json`, which lists every caller in the table as built (with his held-out scores against the league), skipped or failed, with the reason. Now: 59 callers, 50 built, 9 skipped. A model needs at least 5 games and 200 snaps: seven of the skipped are 2026 callers with 4 games so far (BAL, CAR, NYG, NYJ, PHI, SEA, WAS), who get theirs at 5; Davis Webb (Denver's first 4 games of 2026) and Klay Kubiak (one 2024 game) never will. Held out by game, 37 of the 50 beat the league baseline on pass vs run log loss and 47 on the specific play; the median caller's model has the play he called as its top pick 37% of the time and in its top 3 63%.

Rebuild after each week of games (new snaps, and a skipped caller gets his model at 5 games), after editing the table, and on a new machine (the bundles' binaries aren't in git):

```bash
.venv/bin/python scripts/build_callers.py --jobs 3                       # every caller, three workers (about 3 minutes)
.venv/bin/python scripts/build_callers.py --only "Brian Schottenheimer"  # one caller (name or slug, repeatable)
```

It checks the whole table first and lists every problem with its line (nothing is built while there is one), pulls nflverse once into `cache/pbp.duckdb` (again once that copy is a day old, or with `--refresh`), and keeps every bundle that is already up to date (`--force` rebuilds them). It never writes `models/stage1.joblib`, `models/granular.joblib`, `models/profile.json` or anything in `data/`. The running app needs no restart: the picker reads the index again when it changes, and a game loads its bundles when it is opened.

**The table** is `data/play_callers_2024_2026.csv`: 112 rows, one per stint, for all 32 teams in 2024, 2025 and 2026, with the columns `season, team, first_week, last_week, play_caller, role, source, confidence, note`. Teams are nflverse codes (`LA` for the Rams, `WAS`); weeks are nflverse's (1 to 18, then 19 to 22 for the playoffs), and each team-season's stints run from week 1 to 22 with no gap or overlap. Every row has a source. It was researched division by division, then every row re-checked against independent sources: ESPN NFL Nation's yearly play-caller lists (2024, 2025, 2026), in-season reporting where the caller owns his calls (team-site transcripts, beat reporters) and the announcement of every change. It is current to Oct 10, 2026. `source` is the best URL for the row and the others are at the end of `note`. Confidence: 110 high, 1 medium (Denver 2026: Payton took the calls back on Oct 8), 1 low (the Rams' 2025 week 14: McVay ill, the calls shared). `docs/design/play-callers.md` has the method, every mid-season change and the teams likeliest to change next. When a team changes play-caller, end the old stint the week before, add a row for the new one, and rebuild.

The picker and `scripts/build_callers.py` read that table; tonight's `build.py` still reads `data/play_callers.csv` (Schottenheimer's two rows).

**Not held out:** a finished game replayed on a bundle built after it is in-sample. Schottenheimer's bundle (built Oct 10) includes TB at DAL, so a new track of that game grades him on a game his model has seen; only the adopted track (on `models/`, built before the game) is out of sample.

## Ask the analyst

A local AI analyst answers typed questions about the game on screen: the top bar's **Ask** key opens it in a drawer on the GameCast, and the Model Report has the full chat at the end. It runs on gpt-oss 20B through Ollama on this Mac, so questions never leave it.

**Setup:** install Ollama (ollama.com), run `ollama pull gpt-oss:20b` once (13 GB), and keep Ollama running. This Mac has both. While it can't answer, the key reads "Ask · Not ready" and the drawer says why. The first answer waits about 10 s more while the model loads; it then stays loaded for 10 minutes after each answer. `SHADOW_ANALYST_MODEL` and `SHADOW_OLLAMA_URL` point it at another model or address.

**It answers from** this game's plays and the model's own numbers, through lookups on a private copy of the game (nothing it does changes the game):

- the game now: score, clock, who has the ball, his next call and why the model leans that way (his habits against the league, the in-game memory);
- plays and counts by down, distance, quarter, half, field zone, play type, result or player, and how each of his calls graded (his biggest surprises, when the tilt fired);
- the scorecard (overall or by down, quarter or half), team stats, drives, his tendencies against the league, who he is and the model's held-out evidence, and how the model works.

Try "How is the model doing against the league?", "What does he call on 3rd and short?", "Why did the model lean run on the last snap?" or "What were his biggest surprises?"

**It can't answer:**

- anything outside this game: other games, the season, injuries, news (it never uses outside knowledge);
- what ESPN's play-by-play doesn't record: coverage, formations, personnel, routes, player tracking, or play-action, screens and RPOs (it says so, then gives the closest thing, like his usual rate);
- what comes later in a replay: it knows the game only up to the play on screen. Players' stat lines come only while following a live game (they are ESPN's box score, which the app never shows during a replay);
- who will win: it gives ESPN's win probability instead.

One question at a time; answers usually take 5 to 25 s. Each play it mentions ("Q3 2:52") is a key: on the GameCast it jumps the game to that play (in a live game that leaves Go Live; Esc goes back), and on the Model Report it scrolls to that call. Its wording can slip now and then; its numbers come from the lookups.

## Live games and the ESPN feed

- A live game logs each play a few seconds after ESPN posts it: down, distance, spot, clock, score, run gap and side, pass depth, sacks, scrambles, incompletions, touchdowns, turnovers, punts, field goals and penalties (a flag that wipes out a play still grades his call). Open the page before kickoff and it waits for the first play.
- Back, Reset and the drive chart work on a live game too: the game rebuilds to that point, paused, and the feed stops; Go Live (Esc) catches up again.
- The feed follows only the game on screen, and checks the teams before it logs anything: an event for another matchup is refused with the reason ("ESPN event X is NYG at PHI, not DAL v TB"), and the game is untouched. Another game opens from the picker, into its own folder.
- ESPN can't tell play-action, screens or RPOs: those log as the dropback or run its text describes, and his call is graded on that. Games are graded on what ESPN shows, with no regrading from charting later.
- ESPN's feed is unofficial and free; it can lag or change. A failed poll is retried at 4, 8, 16, then every 30 seconds, and a poll that comes back thin or broken never wipes the game on screen. The Model Report's top bar reads ESPN LIVE, with its red lamp, while the last poll succeeded.
- Each play is read once: if ESPN later rewrites a play (replay review, corrected yards), the first version stands. A play the feed can't apply is skipped and named in the Terminal running the app.

## Demos: the sandbox

The sandbox runs the app on a throwaway copy of the data: a new temp folder with the play-caller tables, the saved finished games and the logos, offline, so a demo never touches `data/`. It opens the saved TB at DAL game paused at kickoff. Offline, the picker lists only the saved weeks and opens only TB at DAL (either side, or both); `--online` opens any 2026 game.

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
- **Ask the analyst one question within 10 minutes of the demo**, with Ollama running: that loads the model, so the first real answer doesn't wait the extra 10 s.
- **Quit screen recorders and turn off Low Power Mode.** Both throttle the GPU, and the 3D field then drops frames. A browser that can't draw 3D (no WebGL2) shows the same game on a 2D field; `?scene=2d` on the address forces it.
- In a watched game his next call and its shadow plays stay on the field before each of his snaps: about 2.6 s at 4x (the default) and 1.8 s at 10x. TB at DAL runs about 14 minutes at 1x, 9.6 at 2x, 6.6 at 4x and 4.3 at 10x.

## Tests

```bash
.venv/bin/python -m pip install -r requirements-dev.txt
node --test 'tests/js/**/*.test.mjs'                          # the pages' logic (npm run test:js:cov adds coverage)
.venv/bin/python -m pytest tests -q -m "not e2e"              # server, parser, timeline, playback, picker, analyst (about 3 minutes)
.venv/bin/python -m pytest tests/e2e/test_ui_card.py -q -x    # one e2e file in Chromium (Playwright)
SC_E2E_WORLD=under-the-lights .venv/bin/python -m pytest tests/e2e/test_ui_card.py -q -x   # the same in the stadium
```

Run e2e files one at a time, never the whole folder: several headless browsers rendering the stadium at once overload the Mac. The default e2e world is the plain one; `SC_E2E_WORLD=under-the-lights` runs the stadium. `tests/e2e/test_ui_game_and_ask.py` covers the picker and the Ask drawer. No test needs Ollama: the analyst's tests run on a stand-in.

The ESPN parser is checked play by play against nflverse on a real game (TB at DAL, Oct 8 2026: `data/espn/summary_401872980_final.json`, truth in `tests/fixtures/`), plus a full replay checked against ESPN's own drive summaries. Tests run in a temp folder and never touch `data/`.

## Stack

| Layer | Tool |
| --- | --- |
| Data pull | nflreadpy (nflverse play-by-play, 2018 to 2026) |
| Storage | DuckDB (`data/shadow.duckdb`: `plays`, `caller_snaps`, `live_log`) |
| Stage 1 baseline | scikit-learn HistGradientBoosting, trained on every team except the ones he called plays for (tonight's: every team except Dallas) |
| Play-type model | League gradient boosting on FTN charting 2022 to 2026, then his softmax adjustment shrunk toward the league |
| Stage 2 caller model | Ridge-penalized logistic with the baseline as offset; memory = a value update with learning rate alpha |
| Game list | ESPN's public scoreboard (2026); betting lines from nflverse's schedule, else ESPN's odds |
| Analyst | gpt-oss 20B on Ollama, local; read-only lookups over the game's own data |
| App | Flask on localhost; two pages (the GameCast and the Model Report) in plain ES modules and three.js, no build step |

## Files

- `config.py`: the starting game (before any pick), tonight's caller, thresholds; `espn_event` is the ESPN game id.
- `data/play_callers_2024_2026.csv`: who called every team's plays, 2024 to 2026, with sources (Play-caller models). `data/play_callers.csv`: tonight's caller, for `build.py`.
- `build.py`: pulls data, fits both stages and the play-type model, writes `models/` (tonight's model).
- `granular.py`, `build_granular.py`: the play-type and specific-play model.
- `scripts/build_callers.py`, `callers.py`: a model per play-caller in `models/callers/`; listing and loading them.
- `live.py`, with `live_sides.py`, `live_calls.py`, `live_flags.py`, `live_archive.py`, `live_shorthand.py`: game state, one model per tracked offense, memory updates, predictions, flags and scoring.
- `espn_feed.py`, `espn_plays.py`: ESPN live play-by-play: reads each play and feeds the engine.
- `games.py`, `games_api.py`: the game picker's 2026 season from ESPN, pasted links, each game's betting line and play-callers.
- `tracks.py`, `adopt.py`, `switch.py`: per-game folders, adopting today's game, and switching games.
- `analyst.py`, `analyst_tools.py`, `analyst_snapshot.py`, `analyst_explain.py`, `analyst_api.py`: the analyst: its prompt and Ollama client, its lookups, its copy of the game, its account of the model, its routes.
- `app.py`, `request_values.py`: the local server and its request checks. `static/index.html` is the GameCast, `static/report.html` the Model Report.
- `watch.py`, `watch_args.py`, `playback.py`, `watch_session.py`: playback (open, play, pause, step, seek, Go Live), its pacing, the progress bar's ticks, backups and the session file.
- `timeline.py`, `timeline_text.py`, `timeline_log.py`: every play of both teams as drawable rows (`/api/timeline`).
- `scripts/sandbox.py`: the app on a throwaway copy of the data (Demos).
- `requirements.txt`: what the app needs; `requirements.lock`: the exact, hashed versions `start.sh` installs.
- `data/games/`: each game's state, saved after every play (restart-safe; Where each game lives). A game file that holds another game is copied aside (`live_state.other-<game_id>-<time>.json`) before the new game's first save. `data/live_state.json`: the game from before per-game folders, kept as a safety copy once adopted.
