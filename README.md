# Shadow Play-Caller

Predicts an opponent play-caller's next call (dropback vs. run) live, from the league baseline plus his habits and his in-game memory. Tonight: Brian Schottenheimer, Dallas offense, Buccaneers at Cowboys.

## Run it

```bash
cd shadow-caller
python3 -m pip install -r requirements.txt
python3 app.py          # opens http://localhost:5050
```

The models are already built (`models/`). To rebuild from fresh nflverse data (about 20 seconds):

```bash
python3 build.py
```

## ESPN live feed

Press **ESPN live** at the top. Every play logs itself a few seconds after ESPN posts it: down, distance, spot, clock, score, run gap and side, pass depth, sacks, scrambles, incompletions, touchdowns, turnovers, punts, field goals and penalties (a flag that wipes out a play still scores his call). ESPN can't see play-action, screens or RPOs, so after a play press **A** (play-action), **N** (screen) or **O** (RPO); **P** puts it back to a plain dropback, **J/K/L** change a run's gap, **U** undoes.

- The game id comes from `config.py` (`espn_event`), or leave it blank and the app finds today's game for the offense.
- **Replay this game** rebuilds a finished game from ESPN (the current log is backed up in `data/`): an instant full-game scorecard.
- ESPN's feed is unofficial and free; it can lag or change. Turn the feed off to enter plays by hand.
- A play the feed can't apply is skipped (the status line says "Skipped, enter it by hand") instead of stopping the feed.
- Each play is read once. If ESPN later rewrites a play (replay review, corrected yards), the log keeps the first version; fix it by hand.

## During the game (by hand)

The prediction shows the five play types (Run, Dropback pass, Play-action, Screen, RPO) with the specific plays under each.

1. Everything in the situation line under the field is typed in place: quarter, clock (`8:41` or `841`), both scores, down, to go (`G` for goal), ball on (click the team to switch sides, then type the yard line). Enter or Tab saves, Esc reverts. Typing **Ball on** while Dallas is off the field starts the drive.
2. After each snap press the play key (tap again to cycle) or click the play in the prediction, type the yards, press **Enter**:

| Key | Play | Tap again |
| --- | --- | --- |
| J | Off-tackle left | Outside left (edge) |
| K or R | Inside run (A/B gap) | |
| L | Off-tackle right | Outside right (edge) |
| P | Dropback, short (0–9 air yds) | intermediate, then deep |
| A | Play-action, short | intermediate, then deep |
| N | Screen | |
| O | RPO, handed off or kept | RPO, thrown |
| I | Incomplete (after P, A, N or OO keeps the depth) | |
| S / C | Sack / scramble (after P or A keeps the type) | |
| T / F | Toggle touchdown / turnover | |
| X | Flag menu (see below) | |
| U, Esc | Undo, clear | |

3. Down, distance and field position advance on their own. The clock is estimated (marked est.) until you type it.
4. Drive ends without a score: **Punt**, **FG good**, **FG missed**.

**Flags (X, then a key).** Yardage, automatic first downs and half the distance are applied for you.

| On TB (defense) | Key | | On DAL (offense) | Key |
| --- | --- | --- | --- | --- |
| Offside / encroachment / NZI, 5 | O | | False start, 5 | F |
| Defensive holding, 5 + 1st | H | | Delay of game, 5 | G |
| Illegal contact, 5 + 1st | C | | Illegal formation / shift, 5 | E |
| Pass interference, spot + 1st (Yards = past the line) | D | | Offensive holding, 10 | L |
| Roughing the passer, 15 + 1st | R | | Offensive pass interference, 10 | P |
| Unnecessary roughness, 15 + 1st | U | | Illegal block in the back, 10 | B |
| Face mask, 15 + 1st | M | | Intentional grounding, 10 + loss of down | I |
| Too many men, 5 | Z | | Unnecessary roughness, 15 | N |

W = offsetting (replay the down). "Other on TB / DAL" buttons use the Yards box, with an automatic-first-down box. If you picked his play before the flag, that play is wiped out but still scored as his call. For a flag after a play that stands (late hit), log the play first, then flag. Shorthand: `X DH`, `X FS`, `X DPI 28`, `X TB 15 1ST`, `X DAL 10`, `X` (offsetting).

Shorthand bar uses the same taps: `JJ 6 | 2&4 D44`, `PP 0 INC`, `PPP 35 TD`, `AA 12`, `O 3`, `OO 9`, `S 7`, `SC 6`, `K 3 F` (fumble lost), `I` (interception), `X`, `new D25`, `DAL 14 TB 10`, `Q2 1:58`, `punt`, `fg`.

Specific plays come from public charting: run gap and side, pass depth (air yards), play-action, screen, RPO and its outcome. Named concepts (mesh, inside zone) aren't in public data.

## Tests

```bash
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pytest tests
```

The ESPN parser is checked play by play against nflverse on a real game (TB at DAL, Oct 8 2026: `data/espn/summary_401872980_final.json`, truth in `tests/fixtures/`), plus a full replay checked against ESPN's own drive summaries. Tests run in a temp folder and never touch `data/live_state.json`.

## Stack

| Layer | Tool |
| --- | --- |
| Data pull | nflreadpy (nflverse play-by-play, 2018–2026) |
| Storage | DuckDB (`data/shadow.duckdb`: `plays`, `caller_snaps`, `live_log`) |
| Stage 1 baseline | scikit-learn HistGradientBoosting, trained on every team except Dallas |
| Play-type model | League gradient boosting on FTN charting 2022–2026, then his softmax adjustment shrunk toward the league |
| Stage 2 caller model | Ridge-penalized logistic with the baseline as offset; memory = a value update with learning rate alpha |
| App | Flask on localhost, one HTML page, no build step |

## Files

- `config.py`: tonight's game, caller, thresholds. Change these for another matchup.
- `data/play_callers.csv`: who called plays when. Add rows for new callers, then run `build.py`.
- `build.py`: pulls data, fits both stages and the play-type model, writes `models/`.
- `granular.py`, `build_granular.py`: play type and specific-play model.
- `live.py`: game state, memory updates, predictions, scoring.
- `espn_feed.py`: ESPN live play-by-play: parses each play and feeds the engine.
- `app.py`: the local server. `static/index.html`: the UI.
- `data/live_state.json`: tonight's game, saved after every action (restart-safe).
