# Play-caller models: one model per play-caller

Phase 3 groundwork (restructure-v2.md, section 7): a model for every play-caller in a sourced table, 2024 to 2026, all 32 teams. This file covers what gets built, how to run it, what it writes, the runtime module, and how phase 3 wires it into the engine and the caller picker (including tracking both sides). Nothing here is wired into the app yet.

Files: `build.py` and `build_granular.py` (the build, now taking the caller as an argument), `scripts/build_callers.py` (every caller in a table), `callers.py` (the runtime side), `tests/test_build_callers.py` and `tests/test_callers.py`.

## 1. What a caller's model is

The same three layers as tonight's model, from the same code:

1. **League baseline (stage 1).** Gradient boosting on nflverse play-by-play 2018 to 2026: the league's chance of a pass in the situation, caller-blind.
2. **His habits and in-game memory (stage 2).** A ridge-penalized logistic model with the baseline as its offset, fit on his snaps only; cross-validated by game, bootstrapped by game for the 90% intervals.
3. **Play types and specific plays.** League models on FTN charting 2022 to 2026 (play type, run gap and side, pass depth), then his softmax adjustments shrunk toward the league.

`python build.py` with no arguments still builds tonight's caller into `models/` and `data/shadow.duckdb`, byte for byte the same profile as before (section 8). Every step now takes the caller, his table rows, the output folder and the DuckDB file as arguments; `main()` passes the values in `config.py`.

## 2. Honesty: what his baseline never sees

A caller's baseline is trained on every team **except every team he called plays for in the table, in every season** (2018 to 2026, not only his weeks). That is the rule tonight's build already used ("all teams except DAL"), generalized to callers who moved: a coordinator who called for NYG in 2024 and PHI in 2025 gets a baseline without NYG and without PHI. The league play-type models use the same exclusion. Tests prove it on a synthetic league: the training snap count of each bundle's baseline equals the league minus his teams (`profile.baseline.n_train`).

**Sharing.** Callers with the same exclusion (the same set of teams) share one stage 1 fit and one set of league play-type models. Two callers of one team (a head coach and the interim who replaced him, or 2024's caller and 2025's) cost one baseline, not two. A caller who moved teams has his own set and his own fit. Within a group the shared fits run once, then each caller's own fits.

**Known gap.** "His snaps" means the snaps in the table, which starts in 2024. Earlier stints stay in his baseline: Schottenheimer was Seattle's offensive coordinator in 2018 to 2020, and those Seattle snaps are in his league baseline today, exactly as in the Oct 8 build. Adding older rows to the table closes it; the exclusion reads every row.

## 3. The table

One row per stint: `season,team,first_week,last_week,play_caller,role,source`, optionally `confidence,note`. Weeks use nflverse numbering (regular season 1 to 18, postseason 19 to 22). The default table is `data/play_callers_2024_2026.csv` when it exists, else `data/play_callers.csv`.

`scripts/build_callers.py` checks the whole table before pulling anything, and lists every problem with its line:

- the required columns are there, and a row has no more values than the header (an unquoted comma in a note);
- season is a whole number inside the data (2018 to 2026);
- team is one of the 32 nflverse codes (`LA` for the Rams, `WAS`, `JAX`, `LV`; a common alias such as `LAR` or `WSH` gets a "did you mean" hint);
- weeks are whole numbers with 1 <= first <= last <= 22;
- there is a play_caller;
- inside a team-season the stints start at week 1 and follow each other with no gap and no overlap;
- no two spellings of one name (`Kevin O'Connell` and `Kevin OConnell` would share a folder).

Any problem: exit code 2, nothing pulled, nothing built.

## 4. Running it

```bash
.venv/bin/python scripts/build_callers.py                                # every caller in the default table
.venv/bin/python scripts/build_callers.py --jobs 3                       # three workers (the phase 3 full run)
.venv/bin/python scripts/build_callers.py --only "Brian Schottenheimer"  # one caller (name or slug, repeatable)
```

| Option | Default | What it does |
| --- | --- | --- |
| `--table` | the default table above | the play-caller table |
| `--only NAME` | everyone | build only this caller (any spelling that makes his slug, or the slug); repeat for more |
| `--jobs N` | 2 | parallel worker processes (one exclusion group each at a time); the machine is shared |
| `--threads N` | half the cores split between the workers | threads per worker (OpenMP and BLAS) |
| `--force` | off | rebuild bundles that are already up to date |
| `--refresh` | off | pull nflverse again even if the cache is less than a day old |
| `--cache` | `cache/pbp.duckdb` | the nflverse cache; refused anywhere inside `data/` |
| `--out` | `models/callers` | where bundles and the index go; `models/` itself, `data/` and any folder containing `data/` are refused |

**One pull.** nflverse play-by-play (the build's columns, 2018 to 2026) and FTN charting are downloaded once into the cache DuckDB (written aside, then swapped in), never `data/shadow.duckdb`. The cache is reused for 24 hours; after that, or with `--refresh`, the next run pulls again. Workers open it read-only.

**Up to date.** A bundle's fingerprint covers his stints (season, team, weeks), the pull time, the scikit-learn version and a build version number. A bundle with the same fingerprint is kept unless `--force`; a new pull makes every bundle out of date. Bump `BUILD_VERSION` in `scripts/build_callers.py` when the build changes what a bundle holds.

**Too few snaps.** A caller needs at least 5 games (one per cross-validation fold) and 200 snaps in the data, and 100 snaps with FTN charting for the play-type layer. Below that he is skipped, and the index says why ("Only 3 games (144 snaps) in the data; a model needs at least 5 games and 200 snaps.").

**Time** (this Mac, 14 cores, other agents running; section 8 has the runs):

| What | Time |
| --- | --- |
| nflverse pull into the cache | 10 s |
| shared fits per exclusion group (stage 1 twice, three league play-type models), 2 to 3 threads | median 11.8 s, max 16.6 s |
| one caller's own fits (stage 2 grid and bootstrap, play-type adjustments, held-out checks) | median 0.8 s, max 1.3 s |
| 35 callers in 33 groups, `--jobs 3` (2 threads each) | 146 s wall |
| one caller alone (`--only`, one group, 7 threads), cache already pulled | 11 s wall |

The shared fits dominate, so the run time follows the number of distinct exclusion sets (about one per team, plus one per caller who moved).

**Disk.** About 5.8 MB per bundle (the league models are inside every bundle so each one loads on its own): roughly 200 to 350 MB for 35 to 60 callers. Binaries and the cache are gitignored; profiles and the index are small JSON.

## 5. What it writes

```
models/callers/
  index.json                      every caller in the table, built or not
  brian-schottenheimer/
    stage1.joblib                 his baseline (shared by everyone with his exclusion)
    granular.joblib               league play-type models + his adjustments (same keys as models/granular.joblib)
    profile.json                  the live profile schema, then the bundle's own keys
```

Bundles are written into a temporary folder and swapped in, so a reader never sees half of one; a write that fails keeps the old bundle. Only a folder that holds bundle files is ever replaced (anything else under that name is refused, never moved), and `--out` can't be `models/` itself, anything inside `data/`, or a folder that contains `data/`. `models/stage1.joblib`, `models/granular.joblib` and `models/profile.json` are never written.

**profile.json** starts with exactly the keys `models/profile.json` has, in the same order (`caller, seasons, n_snaps, n_games, alpha, lambda, q0, coefs, cv_logloss, dropback_rate, by_down, team, stage1_check, granular, built_at, sklearn`), so the engine, the UI view models and the analyst read a bundle the way they read tonight's profile. `team` is the team of his latest stint. Then:

| Key | Holds |
| --- | --- |
| `slug` | his folder name |
| `teams` | every team in his stints |
| `stints` | season, team, weeks, role, confidence, source for each row |
| `baseline` | `excluded_teams` and `n_train` (snaps the baseline was trained on) |
| `data` | `source`, `pulled_at`, `seasons` of the nflverse pull |
| `build` | `version`, `fingerprint`, `seconds` (`own`, `shared`, `shared_by`) |

The held-out comparison against the league is `cv_logloss`: `league_baseline` (the baseline on his snaps; it never saw his teams) against `habits_plus_memory` (his model, 5-fold cross-validated by game), plus `granular.cv.specific_play` for the specific play (log loss, top pick, top 3).

**index.json:**

```json
{
  "built_at": "2026-10-10T19:00:16", "table": "data/play_callers.csv",
  "data": {"source": "nflverse", "pulled_at": "2026-10-10T18:46:35", "seasons": [2018, "...", 2026]},
  "sklearn": "1.9.1",
  "counts": {"built": 1, "skipped": 0, "failed": 0, "not built": 0},
  "callers": [{
    "name": "Brian Schottenheimer", "slug": "brian-schottenheimer", "status": "built",
    "teams": ["DAL"], "seasons": [2025, 2026], "role": "HC", "confidence": null,
    "snaps": 1406, "games": 22,
    "logloss": {"league": 0.5289, "his": 0.5228},
    "specific_play": {"league": 1.958, "his": 1.955, "top1": 0.383, "top3": 0.663},
    "built_at": "2026-10-10T19:00:16", "up_to_date": true,
    "seconds": {"own": 0.6, "shared": 10.1, "shared_by": 1},
    "stints": [{"season": 2025, "team": "DAL", "first_week": 1, "last_week": 22, "role": "HC", "confidence": null, "source": "..."}]
  }]
}
```

`status` is `built`, `skipped` (with `reason`), `failed` (with `reason`; a caller whose rebuild failed but who has an older bundle stays `built`, with `up_to_date: false` and `error`), or `not built` (left out by `--only`). `role` is his latest stint's; `confidence` is the least sure of his stints (low, medium, high). Entries are sorted by name. The index is rewritten after every group, so an interrupted run still leaves a valid one.

## 6. Runtime: callers.py

| Call | Returns |
| --- | --- |
| `list_callers(callers_dir=None, include_unbuilt=False)` | index entries (built only unless asked) |
| `find_caller(team, season, week)` | the entry of whoever called `team`'s plays that week (nflverse code), built or not, or None |
| `has_model(name)` | whether that name has a built model |
| `load_caller(slug, check_version=True)` | `CallerModel(slug, name, profile, stage1, granular, path)` |
| `slugify(name)`, `is_slug(text)` | the folder name rule |

`load_caller` refuses anything that is not a slug before touching the disk (no path can leave the folder), raises `CallerNotFound` for a missing or incomplete bundle (naming the missing file), and `ModelVersionError` when the bundle was built with another scikit-learn. A missing index means nothing was built yet (`[]`); a broken one is an error. Loading a bundle takes about half a second.

## 7. Wiring it in (phase 3, after the restructure lands)

None of these files are this track's; each change is small.

**live.py, the engine loads a caller.** `GameEngine.__init__(self, caller=None)`: when `caller` is a `CallerModel`, take `self.profile, self.stage1, self.G = caller.profile, caller.stage1, caller.granular`; when it is None, load `models/` exactly as today (tonight's build stays the default). Everything after that (`self.w`, `alpha`, `q0`, `predict`, `predict_tree`) is unchanged. Replace the local `class ModelVersionError` with `from callers import ModelVersionError`, so `app.py`'s `except (FileNotFoundError, ModelVersionError)` catches both.

**config.py.** Add `CALLER_SLUG = "brian-schottenheimer"` next to `CALLER_NAME` (or derive it with `callers.slugify(CALLER_NAME)`).

**games.py, the picker.** `Games(..., has_model=callers.has_model)`. Today's default is `lambda name: name == CALLER_NAME`; with the hook, every caller with a built bundle shows as modelled, and a skipped one says why through `find_caller(...)["reason"]`. ESPN abbreviations become nflverse codes before `find_caller` (`WSH` to `WAS`, `LAR` to `LA`) with `games.nflverse_abbr`, which already exists.

**app.py.** `GET /api/callers` answers `callers.list_callers()` (name, slug, teams, seasons, snaps, log loss against the league) for the picker. Picking a game resolves each side's caller (`games.callers_for(event)`, then `slugify(name)`) and rebuilds the engine with `GameEngine(callers.load_caller(slug))`, under the lock, only when no game of that session is in progress (the same rule as the model rebuild today). `CallerNotFound` and `ModelVersionError` become a 409 with the message, never a crash.

**Track both sides.** The engine holds one model per offense: `self.models = {"DAL": load_caller(dal_slug), "TB": load_caller(tb_slug)}`. Before each snap, the team with the ball picks the model: its `stage1`, coefficients (`w`, `alpha`, `q0`) and `G` feed `_predict`, so the prediction code stays as it is with `self` replaced by the possession's model. What becomes per-team: the in-game memory (`state["mem"]` becomes `state["mem"][team]`, each starting at that caller's `q0`), the log rows (a `caller` field, so the card's LAST 6 and the report's scorecards filter by caller), and the metrics (`metrics(team)`). `GAME["offense"]` and `GAME["opponent"]` stop meaning "the tracked caller" and the opponent; the side with the ball does. Two bundles take about a second to load (half a second each). A side with no model (skipped, or nobody in the table) is tracked with the league baseline only and labelled so, or not tracked; the picker shows why from the index.

**UI and analyst.** Nothing has to change to show one caller from a bundle: the profile schema is the same. `profile.teams` and `profile.stints` are new and optional, for the picker and the report (a caller who moved can read "NYG 2024, PHI 2025").

## 8. Checks run (2026-10-10)

**build.py is unchanged in behaviour.** The original `build.py` and `build_granular.py` (git HEAD) and the generalized ones ran on the same downloaded nflverse data into scratch folders (never `models/` or `data/`): the profiles are identical except `built_at`, and both joblib files predict bit for bit the same (stage 1, the three league play-type models, `W_A`, `W_B`, `W_C`, the RPO rates, and the `caller_snaps` table). Same on the data as of week 4 and on today's data. The build also got faster, 39 s to 9 s: the specific-play check now reads the league predictions it already made instead of predicting one row at a time (verified bit for bit: a batch prediction equals the row-by-row one for every model).

**Schottenheimer's bundle against the live models/profile.json.**

- Rebuilt from the data as of 2026 week 4 (what the Oct 8 build saw), through `scripts/build_callers.py`: every number matches to 3.7e-13 (floating-point noise in the bootstrap intervals from a different thread count; the original code shows the same noise).
- Rebuilt from today's data (`models/callers/brian-schottenheimer/`): the only new data since the Oct 8 build is TB at DAL (2026 week 5), published after that build. It adds 55 snaps and 1 game, and with it the cross-validation picks a stronger ridge penalty (lambda 10 instead of 3), which pulls every term toward the league:

| | live (Oct 8) | rebuilt today |
| --- | --- | --- |
| snaps, games | 1,351, 21 | 1,406, 22 |
| lambda | 3 | 10 |
| held-out log loss, league / his | 0.5322 / 0.5248 | 0.5289 / 0.5228 |
| Overall lean | +0.569 | +0.349 |
| Early downs (1st/2nd) | -0.594 | -0.350 |
| 3rd & 4+ | -0.429 | -0.157 |
| Value gap (what's been working) | +0.449 | +0.185 |
| Repeat last call (stickiness) | -0.449 | -0.429 |
| After a 20+ yard gain | -0.423 | -0.271 |
| specific play top pick / top 3 | 37.6% / 65.7% | 38.3% / 66.3% |
| stage 1 check (2025 held out) | identical | identical |

The bundle built today is identical (except `built_at`) to what the original `build.py` writes on today's data.

**Tests.** 80 tests across `tests/test_build_callers.py` and `tests/test_callers.py`: a synthetic six-team league (2022 to 2026, every snap charted) runs the whole pipeline end to end with two spawned workers (the table, one pull, stage 1 shared by two callers of one team, a caller who moved teams, two callers skipped for too few games, the bundles, the index, `load_caller` predicting like the engine, a rerun that keeps current bundles, `--only --force`), plus table validation, the guards on `data/` and `models/`, a folder that is not a bundle never being replaced, an unreadable bundle profile, the cache's freshness and `--refresh`, a failed bundle write, and the runtime module. Coverage of the four files: 96% (build.py 99%, build_granular.py 93%, callers.py 97%, scripts/build_callers.py 95%). The full suites: pytest (not e2e) 634 passed, node 1450 of 1452 (the 2 failures are other tracks' work in progress).

**Full-scale rehearsal.** A placeholder table (not research: one invented caller per team 2024 to 2026, a mid-season change, a caller across two teams, a stint too short to fit) ran with `--jobs 3`: 34 built and 1 skipped in 146 s, 33 exclusion groups, the two callers of one team sharing a fit, no temporary folders left behind.

## 9. Limits and choices

- **The ridge penalty grid is coarse** (1, 3, 10, 30, 100). One game moved Schottenheimer's choice from 3 to 10, and his terms shrank by 4% to 63% (the near-zero trailing-by-9 term changed sign). A finer grid, or one penalty chosen for the whole league of callers, would make a caller's profile steadier from week to week.
- **One caller per week.** Shared play-calling duties cannot be two overlapping rows; the table names whoever called most.
- **FTN charting can lag play-by-play.** A new caller with play-by-play but not enough charted snaps is skipped with that reason until the charting arrives.
- **Removed callers.** The index lists the callers in the current table; a bundle of a caller removed from the table stays on disk (unlisted) until deleted.
- **Callers below the floor** (5 games, 200 snaps) are skipped rather than fit on a handful of games; the threshold is `MIN_GAMES`, `MIN_SNAPS` and `MIN_CHARTED` in `scripts/build_callers.py`.

## 10. College later

The pieces that are NFL-specific are parameters: the team codes (`read_table(..., teams=...)`), the seasons and the maximum week, the play-by-play loader (`build.load_raw_pbp`, which would read cfbfastR instead of nflverse) and the held-out season. College has run and pass but no FTN charting, so a college bundle would carry stage 1 and stage 2 only; the engine's play-type layer (`predict_tree`) would then need to be optional, with the card showing run/pass alone.
