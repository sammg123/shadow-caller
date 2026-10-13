# The game picker: any 2026 game, either side (phase 2)

Status: **wired (2026-10-12).** restructure-v2.md section 7, phase 2, wired in by section 11. Sam's answers: the 2026
season only; a live game opens live, a finished game opens paused at kickoff; pick the side to shadow, or track both
sides with separate stats (one side by default); he can paste an ESPN game id or address, and the app tells him how to
find one. This file is the design and the contracts: the listing and the picker (sections 1 to 3), per-game state and
`POST /api/game/select` (section 4, in `tracks.py`, `adopt.py` and `switch.py`), and the wiring as it was applied
(section 5).

Files: `games.py` (the schedule, the cache, pasted references, the betting line, the play-caller table),
`games_api.py` (the Flask blueprint), `static/js/picker/` (`picker-vm.js` the pure view model and state machine,
`picker-api.js` the HTTP client, `picker.js` the DOM side), `static/css/picker/picker.css` (plain, any world),
`static/css/worlds/under-the-lights/picker/picker.css` (the stadium skin); tests in `tests/test_games.py`,
`tests/test_games_config.py`, `tests/test_games_api.py` and `tests/js/picker/`; real ESPN and nflverse answers from
2026-10-10, trimmed, in `tests/fixtures/espn/`. Per-game state: `tracks.py`, `adopt.py`, `switch.py` (tests in
`tests/test_tracks.py`, `tests/test_adopt.py`, `tests/test_switch.py` and `tests/test_api_tracks.py`).

## 1. The schedule (games.py)

**Source.** ESPN's public scoreboard, one request per week:
`site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=2026&seasontype=<2|3>&week=<n>`, fetched through
`espn_feed.fetch_json` (no redirects, 8 MB cap, 30 s deadline), so there is one HTTP path in the app. The weeks come
from ESPN's own calendar (`leagues[0].calendar` in any scoreboard answer): 18 regular-season weeks, then the Wild Card,
Divisional Round, Conference Championship and Super Bowl. The preseason and the off season are never listed.

**A game.** Parsed from the event, every field checked and every string capped (team names 40 characters, details 40):

```json
{"event_id": "401872980", "season": 2026, "season_type": 2, "week": 5, "game_id": "2026_05_TB_DAL",
 "kickoff": "2026-10-09T00:15:00Z", "time_valid": true, "neutral": false,
 "status": "post", "detail": "Final", "completed": true, "clock": null, "period": null,
 "away": {"abbr": "TB", "nflverse": "TB", "name": "Tampa Bay Buccaneers", "short": "Buccaneers", "score": 24,
          "caller": null},
 "home": {"abbr": "DAL", "nflverse": "DAL", "name": "Dallas Cowboys", "short": "Cowboys", "score": 16,
          "caller": {"name": "Brian Schottenheimer", "role": "HC", "model": true}}}
```

- `status` is ESPN's `pre`, `in` or `post`; `detail` its short detail ("Final", "10/11 - 9:30 AM EDT", "12:34 - 2nd",
  "Halftime"). `clock` and `period` are set only while the clock runs in a quarter (null at halftime or between
  quarters). `completed` is false for a postponed or canceled game, which the picker shows but won't open.
- Scores are null before kickoff (ESPN lists 0 to 0). `time_valid` is false while ESPN hasn't set the kickoff time
  (week 18 today): the picker says "Time TBD".
- `abbr` is ESPN's abbreviation, which the feed matches on (`GAME["offense"]` must be it); `nflverse` is nflverse's
  (`LAR` is `LA`, `WSH` is `WAS`, every other team the same: checked on all 61 saved games). `game_id` is nflverse's
  form, the postseason counting on from the regular season (the Wild Card is week 19).
- Postseason games with no teams yet (ESPN's "TBD at TBD", team ids -1 and -2) are left out, and a postseason week is
  listed once it has a real game. It is looked up only from two weeks before it starts.
- `caller` comes from the play-caller table for that week: `name`, `role` and `model`, whether a model of him exists
  (today `name == config.CALLER_NAME`; phase 3 passes `callers.has_model`, play-caller-models.md 7).

**The cache.** `DATA_DIR/espn/scoreboard_<season>_<type>_<week>.json`, the answer trimmed to what the parser reads
(19 KB of week 5's 290 KB answer, which parses to the same games) plus when it was fetched, written whole (a temp
file, then `os.replace`, through `logos.write_cache`).

| The week | Fresh for |
| --- | --- |
| every game final | good (never fetched again) |
| a game in progress, or one kicking off within an hour (or overdue) | 30 s (`LIVE_TTL_S`) |
| anything else, including a week with no games yet | 15 minutes (`UPCOMING_TTL_S`) |

A refresh that fails keeps the last copy and marks the week `stale`; a week ESPN never answered is listed with its
`error` ("Couldn't get Week 7 from ESPN."). ESPN answers a week it doesn't know with the current one, so an answer for
another season, season type or week is refused, never cached under the wrong name. Stale weeks are fetched in
parallel (6 at a time); the listing waits at most 15 s, then answers with what it has, and the late weeks land in the
cache when they arrive. One refresh runs at a time; a second request waits for it and finds the cache fresh. A cold
start fetches the calendar (week 1, final and kept for good) and then the season: 1.0 s for 18 weeks and 272 games
against the real ESPN on 2026-10-10; a warm listing takes 3 ms.

**Offline** (`SHADOW_ESPN_OFFLINE=1`, the sandbox and the tests): the cached files, then the saved ones in
`tests/fixtures/espn` (weeks 4, 5, 6 and 18 of 2026, and the Wild Card's placeholders), and never the network. Only
the saved weeks are listed, and the picker says so.

**The current week** is the calendar week the clock is in (ESPN's weeks run Wednesday 07:00 UTC to the next Wednesday,
so Monday night belongs to its week), the first week before the season and the last one after it.

## 2. The calls (games_api.py)

`games_api.create_blueprint(games.default_games(has_model=switch.has_built_model))`, registered by app.py. Both calls
are read-only GETs. app.py's gate is app-wide, so it covers them: Flask's Host check (`TRUSTED_HOSTS`) refuses a DNS
name rebound to 127.0.0.1, and `own_page_json_only` lets GET through by design (it guards the calls that change the
game). `tests/test_games_api.py` checks the Host refusal on the sandboxed app. Every answer is JSON with
`Cache-Control: no-store`.

| Call | Answer |
| --- | --- |
| `GET /api/games` | 200 `{"season": 2026, "current": "2-5", "offline": false, "weeks": [week, ...]}`, the current week first, then the calendar's order. 400 for any parameter. 503 when ESPN's calendar can't be had. |
| `GET /api/games/resolve?ref=<text>` | 200 `{"game": game}`. 400 with the reason when `ref` is missing, repeated, joined by another parameter, over 500 characters, or neither a game id nor an espn.com NFL game address. 404 with the reason when the 2026 listing hasn't got it ("ESPN has no game with id 123.", "ESPN game 401772510 is from the 2025 season; the picker lists 2026 only.", "ESPN game 401873272 is a preseason game; ..."; both checked against the real ESPN). 503 when ESPN can't be reached. |

A week: `{"key": "2-5", "season_type": 2, "week": 5, "label": "Week 5", "detail": "Oct 7-13", "current": true,
"stale": false, "error": null, "games": [...]}`. A listing is bounded by the caps (30 weeks of at most 20 games, every
string capped): the whole regular season is 141 KB (272 games, measured), the offline one 32 KB.

**A pasted reference** (`games.parse_game_ref`): a bare id (ASCII digits, 1 to 12), or any espn.com or *.espn.com
address (with or without the scheme) whose path has the `nfl` segment and carries `gameId/<digits>` or
`gameId=<digits>`. Anything else is a ValueError with the reason and the help line ("Open the game on espn.com. The
number after gameId/ in the address is the game id."): another host (`espn.com.evil.example`, `espn.com@evil.example`,
`notespn.com`), a port, a user, another scheme, another sport, two different ids, spaces or control characters,
non-ASCII digits. **The address is only read, never fetched:** only the digits go on, into ESPN's fixed endpoints.

**Python, for phase 2:**

| Call | Returns |
| --- | --- |
| `Games.season()` | the `GET /api/games` body |
| `Games.game(event_id)` | one game of the listing (ValueError for a bad id, `GamesError` 404 or 503) |
| `Games.game_config(event_id, offense)` | `config.GAME` for that game from `offense`'s side (below) |
| `Games.callers_for(event_id)` | `{"DAL": {"name", "role", "source", "model"}, "TB": None}` |
| `games.default_games()`, `games.game_config(...)`, `games.callers_for(...)` | the app's one `Games` (DATA_DIR, offline per the env), so the caches are shared |

**game_config** for TB at DAL from Dallas's side:

```json
{"game_id": "2026_05_TB_DAL", "label": "Buccaneers at Cowboys, Week 5, Thu Oct 8", "offense": "DAL",
 "opponent": "TB", "offense_is_home": true, "offense_spread": 9.5, "total_line": 49.5, "espn_event": "401872980",
 "line_source": "nflverse", "line_note": null, "neutral": false}
```

- `neutral` is ESPN's neutral site (London, Mexico City). It is frozen with the track's config, so the top bar names
  the game the way the picker and the label do: "PHI vs JAX", never "PHI at JAX" (`tracks.matchup_of`; the page's
  `MASTHEAD.game`). A config frozen before the flag existed reads "at".

- The line comes from nflverse's schedule (`nflreadpy.load_schedules`, its `espn` column matching ESPN's id), kept in
  `DATA_DIR/nflverse/schedules_2026.json` for an hour. `spread_line` is the home team's margin (positive when home is
  favored, checked against config.py's comment: Dallas, at home and favored, comes out positive), so the offense's
  spread is `spread_line` at home and `-spread_line` away; Tampa Bay's side of the same game is -9.5.
- Without an nflverse line (or with nflverse unreachable): ESPN's odds in the game summary (`pickcenter`), the first
  provider whose numbers add up: the home side's `spread` (negative when home is favored), the favorite named in
  `details` ("DAL -8.5"; "EVEN" is 0), which must agree, and a total from 20 to 90. For TB at DAL that is DAL 8.5 and
  49.5.
- Neither: `offense_spread` and `total_line` are null, `line_source` null, and `line_note` says so plainly ("No betting
  line for Eagles vs Jaguars yet: neither nflverse nor ESPN has one, and the model needs the spread and the total.").
  A line is never guessed; the engine needs both numbers, so phase 2 refuses such a game (409).
- **The line moved after the game.** nflverse now lists TB at DAL at 9.5 and 49.5; config.py and the game file Sam
  graded live say 8.5 and 48.5 (config.py's comment says they came from nflverse's schedule, so nflverse has updated
  the line since); ESPN's DraftKings line says 8.5 and 49.5. So a game's config is frozen when its state is first
  made (section 4), and the adopted TB at DAL keeps 8.5 and 48.5.

## 3. The picker (static/js/picker)

A key for the top bar ("GAME TB at DAL") opens a panel under it:

- **The team filter** (all teams, then the 32 by name) and **the pasted link** (a field, Find, the help line under
  it, and the server's reason when it refuses, without repeating the help line).
- **The weeks**, this week first and open ("This week · Week 5", "Oct 7-13"), the others closed until clicked (with a
  team picked, every week with one of its games opens). A row: the two teams and their scores, the state at the right
  ("Live · Q2 12:34" by a tally-red lamp, "Final", "Sun 1:00 PM" in the viewer's own time, "Time TBD"), and, when a
  side has a model, "Shadow: Schottenheimer (DAL)". While the panel is open it asks for the list again every 30 s.
- **The chosen game**: its two sides as lamp switches (the team, its play-caller and role, "Model ready.", "No model
  for this play-caller yet." or "Not in the play-caller table yet."); the side with a model is chosen, the home side
  when both have one; "Track both sides (separate stats)" is off by default and needs a model on both sides, and lights
  both sides while it is on; Open this game says how it opens ("Finished: opens paused at kickoff.", "Live: opens
  live.", "Not started: opens live and follows it from kickoff.") or why it can't ("No play-caller model for either
  team yet.", "Postponed: nothing to open.").
- **Which sides have a model** comes from the models' own index: when the season loads, the picker also reads
  `GET /api/callers` (app.py: every caller in `models/callers/index.json`, built or not, with the reason when not). A
  side has a model when its play-caller's entry, by exact name, says `built`; otherwise the side is disabled and its
  note is the entry's reason, else its error (restructure-v2.md 11 decision 1, the same rule `POST /api/game/select`
  applies). An index that can't be read never blocks the listing: the listing's own `model` flag then stands.
- **What it emits:** `onSelect({"event_id": "401872980", "sides": ["DAL"]})`, sides in away-then-home order when both
  are tracked. Phase 2's `POST /api/game/select` takes exactly this body.

**Keyboard.** Escape closes the panel and is spent there (the page's Escape is Go Live; `core/keyboard.js` skips an
event already handled), from anywhere on the page while it is open. The open panel is a modal layer
(`data-sc-layer="modal"`), and `core/keyboard.js` stands down while focus is in one, so no page shortcut (Space, Left,
Right, 1 to 4, V) fires inside the picker, its field and its select included; focus moving outside it closes it. Up and Down walk the games of the open weeks; Tab
walks everything; the radios keep their own arrows. Opening puts focus on the team filter, picking a game on its title,
Back on the game it came from, closing on the key. A click outside closes it. Labels are text, through `ui/dom.js`,
never HTML.

**Mounting** (the home frame, in the top bar's slot, by dynamic import like every component: `main.js` loads
`picker/picker.js` beside the components and `ui/masthead.js` mounts it in the game slot; one that fails leaves the
game's plain words and a notice):

```js
const { mountPicker } = await import("../picker/picker.js");
const picker = mountPicker(slot, { label: "TB at DAL", onSelect: (selection) => actions.selectGame(selection) });
picker.setLabel("DAL at WSH");     // after a switch; picker.open(), picker.close(), picker.destroy(), picker.isOpen()
```

The key's words carry the top bar's `#gameLabel` (`data-testid="game-label"`), with the game's full label as their
tooltip. `actions.selectGame` sends `POST /api/game/select` with exactly the emitted body, as one more jump in the
playback lane, so the state, the timeline and the field follow the new track without a reload; the masthead sets the
key's words from the new state on its next render.

`api` (default: this page's server through `picker-api.js`), `timers` and `timeZone` (default: the viewer's) are
injectable; the node tests use a fake DOM.

**Look.** Plain: tokens only, so it reads in the neutral world. Under the Lights (DESIGN.md "Keys, lamps and LED
inputs", "Control-room drawer"): a steel cabinet with its light-catch drops from the key; a caption plate; the filter
and the field as LED inputs (LED face, steel-frame border, amber caret, a tally-red frame when refused); the season as
racks, a raised-steel plate per week (amber lamp on this week's) over an LED face of games: team abbreviations in Big
Shoulders Display, scores in amber, LIVE by a tally-red lamp, finals in dim LED; the sides as lamp switches on raised
steel; Open the wide key, lit amber once a side is picked. No glow, no shadow but the focus gutter, no gradient but the
pixel grid, no Doto (nothing here is 40 px).

## 4. Phase 2: per-game state

Today one game lives in `data/` (`live_state.json`, `feed_seen.json`, `watch_session.json`, the watch backups) and
`config.GAME` names it. Phase 2 gives every game, and every set of sides tracked in it, a folder of its own, so
switching never touches another game.

```
DATA_DIR/games/
  index.json                 {"version": 1, "current": {"event_id": "401872980", "sides": ["DAL"]},
                              "adopted": {"from": "live_state.json", "sha256": "...", "at": "..."}}
  401872980/
    game.json                {"event_id", "label", "away", "home", "tracks": {"DAL": GAME, "DAL+TB": {...}},
                              "created_at"}: each track's config, frozen when it was made
    DAL/                     one track: Schottenheimer's calls only
      live_state.json        the engine's game, as today (its "game" key is the track's frozen GAME)
      feed_seen.json         the ESPN play ids applied, in order (today's format)
      watch_session.json     while a watch session is on (today's format)
      live_state.backup-*.json, feed_seen.json.backup-*     the watch's backups, newest 20 (today's rule)
    DAL+TB/                  both sides tracked (sides sorted, joined by +): the same files, one state
```

- A **track** is (event, sides). Shadowing Tampa Bay in the same game later makes `401872980/TB/`, and never changes
  `DAL/`: Sam's live-graded record of the game stays as it was.
- The ESPN summaries and scoreboards stay in `DATA_DIR/espn` (keyed by event id, shared by every track), the logos in
  `DATA_DIR/logos`.
- `live.STATE_PATH` and `espn_feed.SEEN_PATH` already sit behind module globals read at call time (the watch's backups
  and session file follow `live.STATE_PATH`), so a switch repoints those two to the track's folder. No other path
  moves.
- `data/shadow.duckdb`'s `live_log` is keyed by `game_id`; two tracks of one game share it, so `live.py` adds a `track`
  column ("DAL", "DAL+TB") and every insert and `_db_delete_after` filters on it (a reset of one track must never
  delete the other's rows). Rows from before have `track` NULL: the adopted game as Sam graded it live. No reset,
  replay or watch ever deletes them (`_db_delete_after` names a track, and NULL is none); the adopted track's own rows
  go in beside them under its track. Nothing in the app reads `live_log`, so the two never mix.
- **The archive's safety copy** (`archive_keep.py`). Before a run (a server start: its one engine) first changes what
  the file held, meaning its shape (the columns above, added to the Oct 8 build's file) or a row another run wrote
  (a reset or a replay deleting a track's rows from an earlier run), the file is copied once into
  `DATA_DIR/games/shadow.duckdb.kept-<time>`, checked byte for byte (sha256) against the file, named with its sha256
  in the server log, and never pruned. New rows need no copy. When the copy can't be made or doesn't check, the run
  never touches the file: its archive is off until the next start (the server log says so once), and the game files
  still record every play. So the first page load after the restart keeps the Oct 8 archive whole before it gains
  its columns.

**Adopting today's game without loss.** On the first start of the phase 2 build, before the engine is made (so before
anything can write). Only the server's own start adopts (`python app.py`, which `start.sh` and `scripts/sandbox.py`
run): importing app.py (a test, a REPL, a tool) never copies anything, since it could copy a game the running app is
still writing; it opens the current track, or `data/` as before.

1. If `DATA_DIR/live_state.json` exists and `games/index.json` doesn't, read the state's `game` (game_id, offense, the
   lines as played) and the event: `feed_seen.json`'s `_events[game_id]`, else the state's `espn_event`, else
   `config.GAME["espn_event"]` when `config.GAME["game_id"]` matches. No event: don't adopt; keep running on `data/`
   as today and log why.
2. Copy, never move: `live_state.json` to `games/<event>/<offense>/live_state.json`; `feed_seen.json` filtered to that
   game_id (its id list, `_apply_order`, `_events`); `watch_session.json` when it names this game, with the backups it
   names (so a restore still works); the other backups of this game too.
3. Write `game.json` with the track's config taken from the state's own `game` block (TB at DAL keeps 8.5 and 48.5),
   plus `espn_event`.
4. Check every copy byte for byte (sha256) against its source, then write `index.json` last (temp file, then
   `os.replace`): its existence is the marker that adoption finished. A failure anywhere removes the half-made folder
   and leaves the app on `data/`, exactly as today.
5. The files in `data/` are never written again by the app (they stay as Sam's safety copy; deleting them is his call).

**`POST /api/game/select {"event_id": "401872980", "sides": ["DAL"]}`** (behind the gate, like every POST; answers
the full state like the other state calls):

1. Validate the body strictly: a JSON object with exactly `event_id` (digits, `espn_feed.check_event`) and `sides` (a
   list of 1 or 2 distinct abbreviations); 400 with the reason otherwise.
2. Without the lock (network): `GAMES.game(event_id)` (404 or 503 with the reason); every side must be one of its teams
   (400) and have a model (`callers_for`: 409 "No model for TB's play-caller yet."); the track's config is
   `game.json`'s frozen one when the track exists, else `GAMES.game_config(event_id, side)` for each side (409 with
   `line_note` when there is no line).
3. Under `LOCK`, first get the new track ready while the game on screen stays as it is: its `game.json` entry
   (written whole, its line frozen) and its models (`live.sides_for`: `models/` is read here on the default model). A
   failure here (409 for a model that won't load) leaves the game on screen untouched, its watch session included.
   Then leave it: stop the live feed (`feed.stop()`, `feed.invalidate()`, so a poll in flight lands nowhere) and park
   any watch session (`Watch.leave`: its restore point and its session file stay); the old track's files are already
   saved after every action.
4. Open the track: its folder; repoint `live.STATE_PATH` and `espn_feed.SEEN_PATH`; set GAME in place (`GAME.clear();
   GAME.update(config)`: every module holds that one dict); the engine reloads on the models step 3 loaded (each
   side's `callers.load_caller` bundle, play-caller-models.md 7, or `models/`) and its state from the new path
   (`GameEngine._load`, or a fresh game). `feed.event_id = event_id`, `feed.reload_seen()`, the summary reloaded from
   `DATA_DIR/espn`; the timeline epoch bumped.
5. Write `index.json`'s `current`, so a restart opens the same track (app.py reads it before making the engine; with no
   index, `config.GAME` is the default as today).
6. Open it the way phase 1's `POST /api/open` does: a game ESPN says is in progress (or not started yet) goes live; a
   finished one becomes a watch session paused at kickoff (seek 0), whose first rebuild backs the track's game up
   exactly as phase 1 does, so a live-graded game (retags included) is never lost to a replay.
7. Only now, with nothing left to fail, does the parked session end the way Go Live ends one (`Watch.end_parked`: its
   session file goes; its game and its backups stay in its own folder). Anything failing in 3 to 6 puts back the old
   paths, GAME and the engine's models (kept before step 3, so nothing is loaded again), and the parked session
   exactly as it stood (`Watch.come_back`: where it was, its restore point, its file), and answers 409 or 500 with the
   reason: never a half switch.

**Tracking both sides** follows play-caller-models.md section 7: one engine with one model per offense
(`self.models = {"DAL": ..., "TB": ...}`); before each snap the team with the ball picks the model; the in-game memory
becomes per team (`state["mem"][team]`, each from its caller's `q0`); log rows carry a `caller` field; `metrics(team)`
gives each caller's scorecard. Consequences for this track's pieces: `GAME` gets `"sides": ["TB", "DAL"]` and both
configs (each side's spread from its own side; the total is shared); `GAME["offense"]` stops meaning the one tracked
caller (the side with the ball does); the feed applies every play once (one feed, one `feed_seen.json` per track); the
card follows the offense with the ball (restructure-v2.md 3), the top bar names both callers, and the Model Report shows
two scorecards. A side with no model is not offered (the picker disables it and says why).

## 5. Wiring (applied 2026-10-12)

1. **app.py**: `GAMES = games.default_games(has_model=switch.has_built_model)` and
   `app.register_blueprint(games_api.create_blueprint(GAMES))` at module level (the gate is app-wide); the Host-gate
   test in `tests/test_games_api.py` runs. app.py also serves `GET /api/callers` and `POST /api/game/select` (section 4).
2. **static/index.html**: `<link rel="stylesheet" href="/static/css/picker/picker.css">` with the component sheets,
   before the world's.
3. **The stadium skin** lives at `static/css/worlds/under-the-lights/picker/picker.css`, registered in the world's css
   list in `static/js/theme/worlds/under-the-lights/index.js` just before `W5_DECK` (the playback row's sheet), not
   after it: `tests/js/uls-deck.test.mjs` requires the deck's sheet to be the world's last, and the two sheets style
   nothing in common. `tests/js/picker/picker-skin.test.mjs` points at the new path.
4. **The top bar** (home frame): the picker sits in place of the current game's label (section 3); the masthead sets
   its key's words from every state, so they follow a switch.
5. **scripts/sandbox.py** copies `data/play_callers_2024_2026.csv` too when it exists. The scoreboards need nothing:
   offline, games.py falls back to `tests/fixtures/espn`.
6. **.gitignore** has `data/nflverse/` (the schedule's cache) and `data/games/`. The scoreboard cache is in
   `data/espn/`, already ignored.
7. **Phase 3**: the listing's `has_model` hook is `switch.has_built_model`, which reads `models/callers/index.json`
   (again only when it changes), so every caller with a built bundle shows as modelled (play-caller-models.md 7).

## 6. Checks run (2026-10-10)

- `pytest tests/test_games*.py`: 107 pass, 1 skipped until app.py registers the blueprint. Real 2026 weeks 4, 5, 6 and
  18 and the Wild Card (61 games; every `game_id` and nflverse abbreviation matches nflverse's schedule), a live and a
  halftime status, hostile events, the calendar and the current week at six moments, every cache rule (final for
  good, the two TTLs, a failed refresh, a wrong-week answer, a broken file, offline), the season order and the
  postseason rule, 11 accepted and 24 refused references (injections included), game_config for both sides of TB at
  DAL (nflverse 9.5 and 49.5; ESPN's odds 8.5 and 49.5), neutral sites, nflverse's spelling of a team, every way ESPN's
  odds can disagree, the table's preference, mid-season changes, aliases and broken rows, and the blueprint's
  validation, bounds and errors.
- `tests/js/picker/`: 38 node tests: the view model on hand-made and on the server's real payload
  (`games-payload.json`, which a Python test checks is exactly what games.py sends), the HTTP client, the DOM
  (keyboard, focus, text-only labels, refresh while open), and the stylesheets' rules.
- app.py's real gate in front of the blueprint (app.py imported on a sandboxed copy of the data, offline, the
  blueprint registered, Flask's test client): GET from the app's own host 200; a rebound Host 400 ("Host
  'rebound.example' is not trusted."); a cross-site text/plain POST 403; a JSON POST 405; every answer `nosniff`.
- Rendered in Chromium at 1512x982 in both worlds on a throwaway page (a bare Flask app serving the static folder and
  this blueprint over the saved weeks, with one game set in progress): the list, keyboard focus, a team filter, the
  chosen game, Open (it emitted `{"event_id": "401872980", "sides": ["DAL"]}` and closed), a refused link, a pasted
  live game, Escape (closed, focus back on the key). No script errors (the one console line is the refused link's
  400).
- The online path against the real ESPN and nflverse on a temp data dir: the cold listing (1.0 s, 18 weeks, 272 games,
  141 KB, current week 2-5, no week failed), game_config for both sides of TB at DAL and for the Rams' side of BUF at
  LAR (`2026_05_BUF_LA`, 3.5, 54.5), callers_for, a pasted address, and the 404 reasons for a 2025 game and a
  preseason game.

## 7. Limits

- ESPN's scoreboard and summary are unofficial and free; they can lag or change shape. A bad answer is refused and the
  last good copy shown.
- A line from nflverse is up to an hour old (and nflreadpy keeps its own copy for a day in memory); before kickoff it
  can move. The track freezes the line it was made with.
- The NFL's season shape (18 weeks, the postseason after) comes from ESPN's calendar, not from code; college later needs
  `LEAGUE`, ESPN's league path in `espn_feed.BASE`, `ESPN_TO_NFLVERSE` (cfbfastR's team names) and the caps.
