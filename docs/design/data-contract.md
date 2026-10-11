# Data contract for the 3D GameCast UI

Status: design v1. Nothing here is built yet. This file is the contract between the new UI (`static/`), the backend changes (`app.py`, `espn_feed.py`, `live.py`, plus new `timeline.py`, `watch.py`, `logos.py`) and the tests.

Every example value is real. It was computed by running the existing parser (`iter_plays`, `classify`, `situation`) and a throwaway prototype of this contract over the saved game `data/espn/summary_401872980_final.json` (TB at DAL, Oct 8 2026, ESPN event 401872980), and by replaying that game in the sandbox. Values marked *illustrative* (epoch strings, wall-clock timestamps) only exist at runtime.

The visual grammar that consumes this data (ball centered between the hashes, side thirds, gap corridors, ghosted no-plays, kick arcs) is in `docs/design/directions.md`, section "Shared approximation grammar". This file supplies the facts that grammar draws.

---

## 0. Decisions at a glance

| # | Decision | Why |
| --- | --- | --- |
| 1 | One fixed frame for the whole game. x = yards from the **caller's own goal line**, caller always attacks left to right. No flip by quarter. | The feed says nothing about which physical end a team defends. A flip would invent data and reverse drives that cross a quarter break. |
| 2 | x comes from ESPN `yardLine` (measured from the home goal line), never from `yardsToEndzone`. | `yardsToEndzone` is wrong on every home-team punt: 3 of 3 DAL punts here, 232 of 489 punt spots in the 65 cached 2026 games. |
| 3 | The server sends exact x values plus categorical lateral facts (side, gap). It never sends a y coordinate. | There is no player tracking. y is the UI's approximation and must look like one. |
| 4 | The timeline is derived on request from the ESPN summary, the feed's applied ids (in apply order) and the engine log. Within an `epoch` it is append-only. | No new persisted state beyond ordering. Watch mode only ever shows plays that have been applied. |
| 5 | Separate `GET /api/timeline?since=n&epoch=e`. `/api/state` only gets a pointer. | The full timeline is 187 KB. A new play is about 1 KB. |
| 6 | Drives, box score and game status are derived from applied rows, not copied from ESPN's totals. | The derived box score equals ESPN's final box score on every stat checked, and it cannot spoil Watch mode. |
| 7 | Watch mode is one daemon thread that applies one play per tick through `Feed._apply_one` under the app `LOCK`, guarded by generation tokens. | Same code path as the live feed, and an in-flight live poll can never land in a watched game. |
| 8 | Logos go through `GET /api/logo/<abbr>`, which only fetches allowlisted upstream URLs taken from the summary and caches them on disk. | Offline demos work, nothing is hotlinked, no SSRF or path traversal. |

## 1. Conventions

- Units: yards for x, y and distances; seconds for clocks; probabilities in 0..1.
- Yard values are integers (ESPN only gives whole yards).
- A team is its ESPN abbreviation (`"DAL"`, `"TB"`). The caller's team is `GAME["offense"]`, the opponent is `GAME["opponent"]`.
- ESPN ids stay strings. Keys are snake_case. Unknown is `null`, never `0`.
- "Applied" means the feed has run `_apply_one` on the play and recorded its id.

---

## A. Field coordinate system

### A1. Axes and fixed marks

| Mark | x | y |
| --- | --- | --- |
| Left end zone (the caller defends it; the opponent scores here) | -10 to 0 | |
| Left goal line, midfield, right goal line | 0, 50, 100 | |
| Right end zone (the caller scores here) | 100 to 110 | |
| Goal posts (on the end lines) | -10 and 110 | 26.667 |
| Sidelines: near (bottom of a top-down view, the default camera side), far | | 0, 53.333 |
| Hash marks (NFL: 70 ft 9 in from each sideline, 18 ft 6 in apart) | | 23.583, 29.75 |
| Center line | | 26.667 |

Sent once per epoch as `field`:

```json
{
  "units": "yd",
  "orientation": "caller_left",
  "left_team": "DAL",
  "right_team": "TB",
  "home": "DAL",
  "x_min": -10, "x_max": 110, "width": 53.333,
  "goal_lines": [0, 100], "posts_x": [-10, 110], "hash_y": [23.583, 29.75]
}
```

### A2. Orientation: fixed, caller on the left (recommended)

Real football switches ends after the 1st and 3rd quarters. The drawing should not, for four reasons:

1. **The data can't support it.** The feed carries no coin-toss choice and no physical end. ESPN's own `yardLine` stays anchored to the home goal line all game. A flipping field would be invented, which breaks product principle 3.
2. **Drives cross quarter breaks.** TB's opening drive runs from Q1 10:51 to Q2 14:53 (15 plays, 73 yards), and TB's DOWNS drive runs from Q3 1:46 to Q4 8:32. A flip would reverse the drive arrow halfway through.
3. **The product is about one caller.** If his offense always moves left to right, every one of his drives reads the same way. His left is always the far sideline, so the run sides in the prediction panel land on the same part of the field every snap.
4. **Tonight it costs nothing.** DAL (the caller) is the home team, so x equals ESPN's raw `yardLine` on every play. That makes x checkable against the feed by eye and in tests.

`field.left_team` is always the caller. If a game ever needs "home on the left", that is one server-side mapping (x becomes 100 - x). Don't build it until it's needed.

### A3. Turning ESPN values into x

```
dir(team)                   = +1 if team == caller else -1     # attack direction
x from ESPN yardLine        = yardLine        if caller is home else 100 - yardLine
x from a text spot "TB 3"   = N if TEAM == caller else 100 - N ;  "50" -> 50
x from yardline_100 (engine)= 50 + dir(team) * (50 - yardline_100)
yardline_100 from x         = 50 - dir(team) * (x - 50)
```

- ESPN `start.yardLine` and `end.yardLine` are yards from the **home** goal line. Across 65 cached 2026 games, `yardLine` agreed with the home-anchored reading of `yardsToEndzone` on 20,327 of 20,594 spots. The 267 disagreements were:
  - 236 punt-type plays (punts, muffs, blocked punts, punt-return TDs). Wherever we checked these by hand (the 3 DAL punts here, and a SEA punt in game 401872656), `yardsToEndzone` was the wrong field.
  - 4 other plays (3 penalties, 1 fumble recovery).
  - 27 end-of-half, end-of-regulation or safety markers.
- **Never derive x from `yardsToEndzone`.** On home-team punts ESPN copies `yardLine` into it. Example: DAL punt `4018729801082` at "4th & 10 at DAL 44" has `yardLine` 44 (correct) and `yardsToEndzone` 44 (should be 56). Timeouts report `yardsToEndzone` 0 (`401872980778`: `yardLine` 15). The server also derives `pre.yardline_100` from x, never from ESPN's `yardsToEndzone`.
- A row's `end` spot only counts when `end.down` is between 1 and 4. TDs and FGs end at a goal line with `down` -1, so `x_next` is null for them.

| Play (ESPN id) | ESPN fields | Contract |
| --- | --- | --- |
| First DAL snap `40187298068`, "1st & 10 at DAL 30" | `yardLine` 30, `yardsToEndzone` 70, team 6 (DAL, home) | `x0` 30, `dir` +1 |
| First TB snap `401872980390`, "1st & 10 at TB 27" | `yardLine` 73, `yardsToEndzone` 73 | `x0` 73, `dir` -1 |
| DAL punt `4018729801082`, "4th & 10 at DAL 44" | `yardLine` 44, `yardsToEndzone` 44 (wrong) | `x0` 44 |
| Opening kickoff `40187298040`, TB kicks from TB 35 | `start.yardLine` 65 | `x0` 65 |
| DAL TD `401872980322`, end | `end.yardLine` 100 | `x_end` 100 |
| TB TD `401872980889`, end | `end.yardLine` 0 | `x_end` 0 |

### A4. Across the field (y): owned by the UI, always approximate

- y = 0 is the near sideline and y = 53.333 the far sideline.
- Offense-relative sides: a team with `dir` +1 (attacking right) has its left toward +y (the far side). A team with `dir` -1 has its left toward the near side. So `y = 26.667 + dir * L`, where L is the offset toward that offense's left.
- The feed only gives categories: seven run gaps, scramble gaps, and pass side (left, middle, right). Suggested L values, to be tuned by eye and drawn as approximate:

| Fact | L (yd) |
| --- | --- |
| run `left end` / `left tackle` / `left guard` | +8 / +4 / +2 |
| run `up the middle` | 0 |
| run `right guard` / `right tackle` / `right end` | -2 / -4 / -8 |
| pass `left` / `middle` / `right` (catch area) | +12 / 0 / -12 |

- The ball's lateral spot is unknown (no hash in the feed). Keep the ball centered at y = 26.667, as in `directions.md`.

### A5. three.js mapping

`world.x = x - 50`, `world.z = 26.667 - y`, `world.y` = up, 1 unit = 1 yard. A default camera on +z looking toward -z puts the caller's end zone on the left. Keep A3 and A5 in one small JS module so no other file does field math.

---

## B. Timeline (every play, both teams)

### B1. What is in it, and in what order

- There is one row per ESPN play the feed has applied: both teams and every kind, including timeouts and quarter ends. Plays that haven't been applied never appear, which is how Watch mode stays spoiler-free.
- `seq` is the 1-based arrival index. Within an `epoch` it is append-only. `espn_seq` (ESPN `sequenceNumber`) is the chronological sort key for static drawings like the drive chart and the WP line. The two orders only differ if ESPN inserts a play late.
- `epoch` is an opaque string that changes on: engine reset, feed `forget`, replay, watch start, watch stop with restore, a switch between ESPN and manual source, undo in manual mode, and server restart (it includes a boot id). When the epoch changes, the client drops its cache, refetches `since=0` and redraws without animation.
- TB@DAL fully applied: **183 rows**. That is the same count as `iter_plays` and as the `feed_seen` ids after a replay.

### B2. Row shape: full example (first DAL snap)

```json
{
  "seq": 2, "id": "40187298068", "espn_seq": 6800, "src": "espn",
  "drive": 1, "drive_id": "4018729801",
  "team": "DAL", "opp": "TB", "offense_is_caller": true,
  "kind": "play", "type": "Pass Incompletion",
  "qtr": 1, "clock": "14:54", "clock_s": 894, "t": 6, "wall": "2026-10-09T00:16:31Z",
  "pre":  {"down": 1, "togo": 10, "yardline_100": 70, "goal_to_go": false, "text": "1st & 10 at DAL 30"},
  "post": {"poss": "DAL", "down": 2, "togo": 10, "yardline_100": 70, "text": "2nd & 10 at DAL 30"},
  "geo": {"dir": 1, "x0": 30, "x_end": 30, "x_next": 30, "x_catch": 35,
          "lat": "middle", "gap": null, "approx": ["x_catch"]},
  "call": {"family": "dropback", "leaf": "dropback_short", "outcome": "incomplete",
           "depth": "short", "air": 5, "air_src": "est", "air_band": [1, 10], "yac": null, "align": "U"},
  "result": {"yards": 0, "first_down": false, "fd_by": null, "td": false, "turnover": false,
             "turnover_kind": null, "downs": false, "safety": false, "nullified": false, "penalty": null},
  "kick": null,
  "score": {"DAL": 0, "TB": 0},
  "scoring": null,
  "wp": {"home": 0.864, "caller": 0.864, "delta": -0.0092},
  "text": "D.Prescott pass incomplete short middle to B.Spann-Ford (C.Rozeboom).",
  "pred": {
    "log_seq": 1, "snap": 1, "engine_drive": 1,
    "p": 0.4562, "p_league": 0.4624, "p_habits": 0.4562, "flag": "no edge",
    "top_leaf": "run_inside", "top_leaf_p": 0.2733, "top3": ["run_inside", "pa_short", "dropback_short"],
    "fam_top": "run",
    "family": "dropback", "leaf": "dropback_short", "outcome": "incomplete",
    "name": "Short (0–9 air yds), incomplete",
    "fam_p": 0.1781, "fam_p_league": 0.2004, "leaf_p": 0.14, "leaf_p_league": 0.1566,
    "leaf_rank": 3, "leaf_rank_league": 2, "dropback": 1, "success": 0, "retagged": false,
    "dist": {
      "his_f": [0.51834, 0.1781, 0.22386, 0.02782, 0.05187],
      "lg_f":  [0.51724, 0.20045, 0.19354, 0.03468, 0.0541],
      "his_l": [0.27331, 0.08495, 0.04348, 0.05108, 0.06552, 0.14003, 0.02377, 0.01431, 0.15806, 0.04823, 0.01758, 0.02782, 0.03759, 0.01428],
      "lg_l":  [0.24098, 0.06767, 0.05743, 0.06359, 0.08757, 0.15658, 0.02996, 0.0139, 0.12557, 0.04805, 0.01992, 0.03468, 0.03726, 0.01684]
    }
  }
}
```

`dist` arrays follow the canonical orders sent once in `meta`: families `FAMILIES` = run, dropback, pa, screen, rpo; leaves `LEAVES` = run_inside, run_ot_left, run_edge_left, run_ot_right, run_edge_right, dropback_short, dropback_mid, dropback_deep, pa_short, pa_mid, pa_deep, screen, rpo_run, rpo_throw. The values are the 5-decimal tree stored on the log row, passed through unrounded.

### B3. Row fields

Status column: **parser** means `espn_feed` produces it today. **ESPN** means it is in the JSON but nobody reads it yet. **new** means a new derivation. **engine** means `live.py` has to change.

| Field | Type | Meaning, units | Source | Status |
| --- | --- | --- | --- | --- |
| `seq` | int | arrival index, 1-based, append-only per epoch | `feed.applied` order | new (B9) |
| `id` | str | ESPN play id; join key to `log[].espn_id` | play `id` | parser |
| `espn_seq` | int | ESPN `sequenceNumber`; chronological | play | ESPN |
| `src` | `"espn"` or `"log"` | where the row came from | | new |
| `drive`, `drive_id` | int, str | 1-based index into `drives[]`, ESPN drive id | `drives.previous[]` + `current` | new (`iter_plays` drops them) |
| `team` / `opp` | str | ESPN drive owner: the offense on every snap, the kicking team on punts and FGs, the **receiving** team on kickoffs | drive `team` | parser (`team`) |
| `offense_is_caller` | bool | `team == caller` and kind is a scrimmage down (play, penalty, kneel, spike, other, punt, fg, fg_miss). Always false for kickoff and admin. | | new |
| `kind` | enum | see B4 | `classify` kind, split | parser + new split |
| `type` | str | ESPN `type.text`, verbatim | | ESPN |
| `qtr`, `clock`, `clock_s` | int, str, int | period; game clock **at the snap** | `period`, `clock` | parser (seconds only) |
| `t` | int | game seconds elapsed at the snap: `(qtr-1)*900 + 900 - clock_s`; OT is `3600 + 600 - clock_s` | | new |
| `wall` | ISO str | ESPN `wallclock` | | ESPN |
| `pre` | obj or null | down, togo, yardline_100 (from x, see A3), goal_to_go, ESPN `downDistanceText`. Null on kickoffs and admin rows. | `start` | parser (minus text) |
| `post` | obj or null | team with the ball next (`poss`), down, togo, yardline_100, text. Null when there is no next spot (TD, FG, end of period). | `end` | parser (minus poss and text) |
| `geo.dir` | +1 or -1 | attack direction of `team`. On kickoffs that is the return direction; the kick travels the other way. | | new |
| `geo.x0` | int | ball at the start (line of scrimmage; the kick spot for kickoffs) | `start.yardLine` | new |
| `geo.x_end` | int or null | dead-ball spot of the action before any penalty enforcement (B5) | text spots, gain | new |
| `geo.x_next` | int or null | next snap spot after enforcement | `end.yardLine` | new |
| `geo.x_catch` | int or null | pass target: exact on completions and interceptions, estimated on incompletions | B6 | new |
| `geo.lat` | `left`, `middle`, `right` or null | side **from the offense's view**: pass location, or the side of the run or scramble gap | `PASS_RE`, `GAP_RE` | parser matches it, then throws it away |
| `geo.gap` | str or null | raw gap words on runs and scrambles (`"left tackle"` and so on) | `GAP_RE` | parser collapses it into the leaf |
| `geo.approx` | str[] | which `geo` fields are estimates | | new |
| `call` | obj or null | ESPN classification in engine terms **before any retag**: family, leaf, outcome, `depth` (gamebook word: short or deep), `air`, `air_src`, `air_band`, `yac`, `align` (S = shotgun, U = not) | `classify` | parser for family, leaf, outcome, align; new for the rest |
| `result.yards` | int or null | signed gain credited to the call. Sacks are **negative** (the parser returns them positive). 0 on incompletions and interceptions. Null on kicks. | | parser (sign fixed) |
| `result.first_down`, `fd_by` | bool, `rush`/`pass`/`penalty`/null | see B6 | | new |
| `result.td`, `turnover` | bool | | `classify` | parser |
| `result.turnover_kind` | `int`, `fumble` or null | | text | new |
| `result.downs`, `safety` | bool | turnover on downs; safety | | new |
| `result.nullified` | bool | "No Play": the call still counts for scoring the prediction | `classify` | parser |
| `result.penalty` | obj or null | `on`, `foul`, `yards`, `at_x`, `no_play`, `status` (`enforced`, `declined` or `offsetting`), `note` (from `penalty_note`) | text | parser has `note` only |
| `kick` | obj or null | punts, kickoffs, FGs (B5) | text | new |
| `score` | `{abbr: pts}` | score **after** the play, PAT included | `homeScore`, `awayScore` | parser (as off/opp) |
| `scoring` | obj or null | `team`, `type` (`TD`, `FG`, `SF`, `D2P`), `pts`, `pat` (`kick_good`, `kick_missed`, `two_good`, `two_failed`) | score delta + text | new |
| `wp.home` | float | ESPN home win probability **after** the play | `winprobability[playId]` | ESPN (not read today) |
| `wp.caller`, `wp.delta` | float | caller's side of it; change vs the previous applied row in `espn_seq` order | | new |
| `text` | str | ESPN text, verbatim | | parser |
| `admin` | obj | admin rows only: `what` (`timeout`, `official_timeout`, `end_period`, `two_minute`, `end_half`, `end_game`), `by` (team or null) | type + text | new |
| `pred` | obj or null | caller snaps the engine logged (B7) | engine log | engine |

### B4. Kinds

| `kind` | Meaning | Parser today | TB@DAL count |
| --- | --- | --- | --- |
| `play` | snap with a call (run, pass, sack, scramble), including calls wiped out by a flag (`nullified`) | `play` | 129 (DAL 59, TB 70) |
| `penalty` | pre-snap or no-play foul with no call | `sync` | 7 (TB rows 6, DAL rows 1) |
| `kneel`, `spike`, `other` | kneel, spike, aborted snap or team-safety placeholder | `sync` | 2, 0, 0 |
| `punt` | punt, including returns and muffs. A punt wiped out by a flag stays `punt` with `nullified` true. | `punt` (`sync` if nullified) | 7 |
| `fg`, `fg_miss` | field goal attempt, same rule for flags | `fg`, `fg_miss` | 2, 0 |
| `kickoff` | kickoff, including onside kicks | `skip` | 9 |
| `admin` | timeout, official timeout, end of quarter, half or game, two-minute warning | `skip` | 27 |

There is no `score` kind. ESPN folds the PAT or 2-point try into the TD play's text, and `scoringPlays[]` repeats the same 7 play ids. Scoring is a field on the row (`scoring`), and 7 rows carry it here.

### B5. Geometry by kind

Every value below is exact unless it is listed in `geo.approx`. `kdir = dir(kick.by)`.

| Kind | Waypoints |
| --- | --- |
| run | `x0` → `x_end = x0 + dir*yards` (on a TD, the goal line) → `x_next` |
| completion | `x0` → `x_catch = x0 + dir*air` → `x_end = x_catch + dir*yac` → `x_next` |
| incompletion | `x0` → `x_catch` (estimate, with `air_band`). `x_end = x0`. |
| interception | `x0` → `x_catch` (interception spot) → `x_end` (end of the return) → `x_next` |
| sack | `x0` → `x_end` (sack spot in the text) |
| scramble, kneel | `x0` → `x_end` |
| nullified play | the same waypoints drawn as a ghost, then the ball moves to `x_next` (enforcement) |
| penalty, no call | `x0` → `x_next` |
| kickoff | `kick.from_x` (= `x0`) → `kick.land_x = x0 + kdir*dist` → `kick.ret_end_x`, or `kick.fumble_rec.x` → `x_next` (touchback: `x_next` is the touchback spot) |
| punt | `x0` (line of scrimmage) → `land_x = x0 + kdir*dist` → `ret_end_x` → `x_next` |
| fg | `x0` → kick spot `kick.x_kick = post_x - kdir*dist` → posts at `post_x` (110 for kdir +1, -10 for kdir -1) |
| admin | none |

`kick` fields: `by`, `kdir`, `from_x`, `dist`, `land_x`, `ez` (the text says "end zone"), `touchback`, `fair_catch`, `downed`, `oob`, `muffed`, `blocked`, `ret_yards`, `ret_end_x`, `fumble_rec` (`{team, x}`), `penalty`, plus `good`, `x_kick`, `post_x` on FGs. `result.turnover` on kicks is true when the receiving team (`team`) loses a fumble or muff. **ESPN's `isTurnover` is false on the kickoff fumble `4018729802667`**, but ESPN's own box score counts it as DAL's lost fumble, so the server decides from the text ("FUMBLES ... RECOVERED by TB-...").

Real kick rows:

```json
{"seq": 1, "id": "40187298040", "team": "DAL", "kind": "kickoff", "geo": {"dir": 1, "x0": 65, "x_end": 30, "x_next": 30},
 "kick": {"by": "TB", "kdir": -1, "from_x": 65, "dist": 62, "land_x": 3, "ez": false, "touchback": false, "ret_yards": 27, "ret_end_x": 30, "fumble_rec": null}}
{"seq": 113, "id": "4018729802667", "team": "DAL", "kind": "kickoff", "geo": {"dir": 1, "x0": 65, "x_end": 37, "x_next": 37},
 "kick": {"by": "TB", "kdir": -1, "dist": 61, "land_x": 4, "ret_yards": 24, "ret_end_x": 28, "fumble_rec": {"team": "TB", "x": 37}},
 "result": {"turnover": true, "turnover_kind": "fumble"}, "wp": {"home": 0.2403, "delta": -0.1154}}
{"seq": 161, "id": "4018729803781", "team": "TB", "kind": "kickoff", "geo": {"dir": -1, "x0": 35, "x_end": 100, "x_next": 65},
 "kick": {"by": "DAL", "kdir": 1, "dist": 65, "land_x": 100, "ez": true, "touchback": true}}
{"seq": 43, "id": "4018729801082", "team": "DAL", "kind": "punt", "pre": {"down": 4, "togo": 10, "yardline_100": 56, "text": "4th & 10 at DAL 44"},
 "geo": {"dir": 1, "x0": 44, "x_end": 97, "x_next": 97}, "kick": {"by": "DAL", "kdir": 1, "dist": 53, "land_x": 97, "oob": true, "ret_end_x": null}}
{"seq": 87, "id": "4018729802060", "team": "DAL", "kind": "fg", "geo": {"dir": 1, "x0": 77, "x_next": null},
 "kick": {"by": "DAL", "kdir": 1, "dist": 41, "good": true, "x_kick": 69, "post_x": 110}, "score": {"DAL": 10, "TB": 7}}
```

The TB FG `4018729802919` (41 yards, line of scrimmage at DAL 23) gives `x0` 23, `x_kick` 31 and `post_x` -10. Holders sit 8 yards back on both FGs.

### B6. Derivation rules

1. **Penalty split.** Everything before `PENALTY on` is the action (`body`). The parser already does this split.
2. **Air yards.** On completions, `air = yards - yardsAfterCatch` (`air_src: "yac"`, exact). If the gamebook word disagrees by a whole bucket ("deep" but air under 10, or "short" but air 20 or more), set `air_src: "yac_conflict"` and add `x_catch` to `approx`, the same distrust `_pass_leaf` already applies. On interceptions, `air = (x_int - x0) * dir` from "INTERCEPTED by NAME at SPOT" (`air_src: "int_spot"`, exact). On incompletions, use the median for the word (`air_src: "est"`). These medians come from nflverse 2026 weeks 1 to 5 (65 games, attempts excluding sacks): **short 5 yd, IQR 1 to 10, n = 1,049; deep 23 yd, IQR 19 to 32, n = 461**. Hard-code them with that provenance for v1, and later write them into `models/profile.json` from `build.py`. Runs, sacks and scrambles get `air: null`. TB@DAL counts: 43 `yac`, 27 `est`, 2 `int_spot`, 0 conflicts.
3. **Side and gap.** Passes use `PASS_RE` group 3. Runs use `GAP_RE` on the body. Scrambles use `scrambles (left end|...|right end)`, so "J.Daniels scrambles right end" gives `lat: "right"`. Sacks get `lat: null`.
4. **`x_end`.** It is the dead-ball spot before enforcement. TD: the goal line. Sack: "sacked at SPOT". Interception: the return end ("Y.Diaby to TB 25"), else `x_catch`. Kick: return end, else the landing spot, else the fumble recovery spot. Everything else: `x0 + dir*yards`.
5. **First down.** `first_down = td`, or: the offense keeps the ball (`post.poss == team`) and `post.down == 1`, and it is not the same series (`pre.down == 1` and `post.togo == pre.togo - (pre.yardline_100 - post.yardline_100)`). `fd_by` is `penalty` when the row is a no-play or a pre-snap foul by the defense, or when the call's own gain fell short and a defensive foul gave the first down. Otherwise it is `rush` (runs, scrambles, kneels) or `pass`. This reproduces ESPN exactly: **DAL 20 (pass 12, rush 5, penalty 3), TB 24 (10, 10, 4)**. The same-series test is what keeps `401872980210` (offside on 1st & Goal at TB 8, which became 1st & Goal at TB 4) from counting.
6. **Scoring.** `team` is the side whose score went up versus the previous applied row, and `pts` is that change. Don't trust the drive owner: on a pick-six the defense scores. `pat` comes from the text. Example: DAL TD `4018729803742` has `pts` 6, `pat: "two_failed"`, `score {"DAL": 16, "TB": 24}`.
7. **Win probability.** ESPN has exactly one entry per play (183 of 183), recorded after the play: the DAL interception `4018729802466` drops `wp.home` from 0.7456 to 0.6324 (`delta` -0.1132), and END GAME is 0.0. The one extra entry, whose `playId` (`4018729801`) matches no play, is ESPN's opening value. Send it as `wp_start` (0.8619). `tiePercentage` is 0.0 all game, so ignore it.
8. **Penalties.** `PENALTY on (TEAM)(-Name)?, (Foul), (N) yards?, enforced at (SPOT)( - No Play)?` fills `on`, `foul`, `yards`, `at_x` and `no_play`. "declined" and "Offsetting" set `status`. Example `401872980210`: `{"on": "TB", "foul": "Defensive Offside", "yards": 4, "at_x": 92, "no_play": true, "status": "enforced", "note": "defensive offside on TB"}` with `x0` 92, `x_end` 93 (the ghosted 1-yard run) and `x_next` 96.
9. **Team aliases in text.** Text spots use gamebook abbreviations. Map them through an alias table (for example WAS and WSH) to the ESPN abbreviations. If a spot doesn't resolve, fall back to `end.yardLine`. Never guess.

### B7. Link to the engine log (`pred`)

- `pred` is present on every row the engine logged: the caller's snaps, including no-plays. That is **59 rows here** (55 counted, plus 4 nullified: `401872980210`, `401872980265`, `4018729801640`, `4018729803985`).
- The join key is a new `espn_id` on log rows. `record_play` stores `feed["id"]`, and `apply_penalty` gains an `espn_id` parameter that `Feed._apply_one` passes for nullified calls. Today nullified rows carry no feed text or id at all.
- `pred` is a projection of the log row with the **same key names**, plus `top3` (from `tree.his_l`) and `dist` (tree arrays in canonical order).
- Fields fixed at log time: `p`, `p_league`, `p_habits`, `flag`, `top_leaf`, `top_leaf_p`, `top3`, `fam_top`, `dist`.
- Fields that change on retag or undo: `family`, `leaf`, `name`, `fam_p`, `fam_p_league`, `leaf_p`, `leaf_p_league`, `leaf_rank`, `leaf_rank_league`, `success`, `retagged`.
- **UI rule:** every time `/api/state` is refreshed, copy those fields from `state.log[]` onto cached timeline rows with the same `espn_id`. Geometry never follows a retag, because ESPN's text is the drawing truth. The call label does follow it, because Sam's retag is the model's truth.

### B8. What exists today and what has to be added

| Need | Today | Change |
| --- | --- | --- |
| Drive id per play | `iter_plays` returns `(team, play)` | add a variant that yields `(team, drive_idx, drive_id, play)` |
| Pass side, depth word | `PASS_RE` matches; side is discarded | return both from `classify` (new keys, nothing removed) |
| Air yards, YAC | computed inside `_pass_leaf`, then thrown away | return `air`, `air_src`, `yac` |
| Run gap words, scramble side | collapsed into the leaf; scramble side not read | return the raw `gap` |
| Spots: sack, interception, return, recovery, kick landing, FG distance, penalty enforcement | not parsed | regexes in `timeline.py`, tested on real plays |
| Possession after the play | only `_poss_id` (numeric) | map it to an abbreviation |
| Win probability | not read anywhere | join `winprobability` by `playId` |
| Apply order | `feed_seen.json` stores `sorted(seen)` (string order, which loses sequence) | store ids in apply order under the same key; for a legacy sorted list, reorder by `sequenceNumber` |
| Summary in memory | `poll_once` writes `data/espn/summary_<event>.json` but keeps nothing | `Feed.summary` plus a loader (memory, then that file, then `_final.json`) |
| Log row to ESPN | log rows have no `espn_id`; nullified rows have no feed info at all | `record_play` and `apply_penalty` store `espn_id` |
| Clock-estimate flag per row | only on `sit` | manual mode: store `clock_est` on log rows |

---

## C. Teams, drives, box score, status

### C1. The `/api/timeline` response

```
GET /api/timeline?since=<int >= 0>&epoch=<str, optional>
```

- If `epoch` is missing or doesn't match, or `since > n`, the server answers as if `since=0` and sets `"reset": true`.
- A `since` that isn't an integer returns 400 `{"error": "since must be a whole number"}`.

```json
{
  "epoch": "k3v9-2", "n": 104, "since": 100, "reset": false,
  "source": "espn", "mode": "watch",
  "rows": ["...rows with seq 101..104..."],
  "drives": ["...every drive that has an applied row..."],
  "status": {"...": "C5"}, "box": {"...": "C4"}, "wp_start": 0.8619,
  "unlinked": []
}
```

- `field` (A1), `teams`, `team_order` and `meta` (`leaves`, `families`, `leaf_names`, `family_names`, `air_est` with provenance) are only included when `since` is 0 or `reset` is true.
- `source` is `espn` once the feed has a summary and at least one applied id for this game, otherwise `log` (section D).
- `mode` is `live` (feed on), `watch` (a watch session is active or done), `replay` (ESPN rows, feed off) or `manual`.
- `unlinked` lists log `seq`s that were typed by hand and have no `espn_id`. They aren't drawn in ESPN mode. The UI can say "1 hand-entered play isn't on the field". A flag typed with no play (D, v1.4) is not a play and is never listed.
- `skipped` lists the `seq`s of applied plays whose apply failed (drawn, but a caller snap among them has no `pred`); `missing` lists applied ids that have no row: ESPN dropped or re-id'd the play, or (v1.4, G1-6) its row couldn't be built from a malformed poll (the server log names the play once). A malformed field never fails the answer: every summary field is read for the type it should have, a null entry is skipped, and a number that isn't one is unknown (`pre.togo` null for a distance of `""`, say).
- v1.4 (G1-12): ESPN text is capped on the way out: `teams[].name`, `location`, `display_name` 40 characters, a row's `text` 400, `type` 40, `result.penalty.foul` 60 and `note` 80. The page sets all of it with `textContent`.

### C2. `teams` and the logo proxy

```json
"team_order": ["TB", "DAL"],
"teams": {
  "DAL": {"abbr": "DAL", "espn_id": "6", "name": "Cowboys", "location": "Dallas", "display_name": "Dallas Cowboys",
          "home": true, "caller": true, "side": "left", "color": "#002a5c", "alt_color": "#b0b7bc",
          "logo": "/api/logo/DAL", "logo_dark": "/api/logo/DAL?v=dark"},
  "TB":  {"abbr": "TB", "espn_id": "27", "name": "Buccaneers", "location": "Tampa Bay", "display_name": "Tampa Bay Buccaneers",
          "home": false, "caller": false, "side": "right", "color": "#bd1c36", "alt_color": "#3e3a35",
          "logo": "/api/logo/TB", "logo_dark": "/api/logo/TB?v=dark"}
}
```

- Source: `header.competitions[0].competitors[]`: `team.color` and `team.alternateColor` (hex without `#`), `homeAway`, `team.logos[]`. `team_order` is away then home, the scoreboard order.
- Never send `score`, `winner`, `record` or `linescores` from the header. In a saved game they are final, and the records already include this game's result (DAL "2-3", TB "1-4").
- Without any summary (manual mode before ESPN), teams come from `GAME` with `color: null`, and the UI uses a neutral palette and a monogram.

**Color fact the UI has to plan for** (WCAG contrast ratios):

| Color | vs black | vs night background `#0b0f14` | vs turf `#2e6b3a` |
| --- | --- | --- | --- |
| DAL `#002a5c` | 1.49 | 1.36 | 2.21 |
| DAL alt `#b0b7bc` | 10.35 | 9.47 | 3.15 |
| TB `#bd1c36` | 3.38 | 3.10 | **1.03** |
| TB alt `#3e3a35` | 1.86 | 1.70 | 1.76 |

DAL navy disappears on a dark scene, and TB red has the same luminance as green turf. Drawn paths need a light core or an outline, with the team color as a glow or fill, not as the only signal.

**`GET /api/logo/<abbr>?v=default|dark`** returns 200 `image/png`, 400 for a bad `v`, 404 for an unknown team or an offline cache miss, and 502 when the upstream fetch fails.

1. Normalize `abbr` to uppercase. It must fully match `^[A-Z]{2,4}$` **and** be one of the current game's teams, else 404. `v` must be in `{"default", "dark"}`, else 400. Flask's default converter already rejects `/`, and the regex rejects `..`, `%2e` and anything else.
2. The upstream URL is **never built from input**. It is the `href` in that team's `logos[]` whose `rel` contains `default` (or `dark`), which is the 500 px PNG, never the 4096 px variants. Validate it with `urllib.parse.urlsplit`: scheme `https`; hostname exactly `a.espncdn.com`; no port, username, password, query or fragment; path matches `^/[A-Za-z0-9/_.-]+\.png$` and contains neither `..` nor `//`.
3. Fetch with a 5 s timeout and **redirects disabled** (an opener whose redirect handler refuses, so a 3xx becomes a 502). Require status 200, `Content-Type: image/png`, the PNG signature `\x89PNG\r\n\x1a\n`, and at most 1 MB (read 1 MB + 1 byte and reject if it fills). Allow one in-flight fetch per (team, variant), and cache failures for 10 minutes.
4. The cache file is `DATA_DIR/logos/<ABBR>-<variant>.png`, built only from validated tokens. Assert that `path.resolve().parent == (DATA_DIR/"logos").resolve()`. Write to a temp file, then `os.replace`. `data/logos/` is already in `.gitignore`.
5. Serve with `send_file(..., mimetype="image/png", max_age=86400)` and `X-Content-Type-Options: nosniff`.
6. With `SHADOW_ESPN_OFFLINE=1`, never touch the network: serve the cache or return 404. For demos to show logos, `scripts/sandbox.py prepare()` should also copy `data/logos/*.png`, filled once by an online run.

### C3. `drives`

```json
{"idx": 1, "id": "4018729801", "team": "DAL", "offense_is_caller": true,
 "start": {"qtr": 1, "clock": "15:00", "x": 30}, "end": {"qtr": 1, "clock": "10:51", "x": 100},
 "plays": 9, "yards": 70, "time": "4:09", "time_s": 249, "result": "TD", "result_text": "Touchdown",
 "complete": true, "seq": [1, 13], "engine_drive": 1}
```

Derivation (from rows only; ESPN's drive totals are used only once the drive is complete):

- `start.x` is the first snap's `x0`. A drive with no snaps uses the kickoff's `ret_end_x`. `start.qtr` and `start.clock` come from the drive's first row, the kickoff included, which is how ESPN does it.
- `end.x` is the last snap's `x0`, or the goal line on a TD. This is ESPN's own convention: punts, FGs, interceptions and downs end at the last line of scrimmage. `end.clock` is ESPN's end clock, or `"0:00"` when the drive ended the half or game.
- `yards = (x_final - start.x) * dir`, where `x_final` is the last snap's `x_end` (kneels included) unless that snap was a punt, FG or turnover, in which case it is `end.x`. For a drive in progress, `x_final` is the last row's `x_next`.
- `plays` counts non-nullified `play`, `kneel`, `spike`, `other`, `fg` and `fg_miss` rows. Punts are not counted, which matches ESPN's `offensivePlays`.
- `complete` means a later drive has an applied row, or the last applied row ended the possession (`post.poss != team`, scoring, punt or FG), or an end-of-half or end-of-game row is applied. Only then are `result`, `result_text`, `time` and `end` filled. Otherwise they are null.
- Show `result` as ESPN's string (`TD`, `FG`, `PUNT`, `INT`, `FUMBLE`, `DOWNS`, `END OF HALF`, `END OF GAME`, and others ESPN may add). Fall back to `result_text` for unknown values.
- Checked on TB@DAL: 21 drives (DAL 10, TB 11). For all 20 drives with a snap, start x, end x, yards and plays equal ESPN's. The odd one out is drive 14 (`40187298014`, DAL, FUMBLE, 0 plays): ESPN reports `yardLine` 0 at both ends, and the contract gives `start.x` = `end.x` = 28 (the end of the return), yards 0, plays 0. Summing `time` gives possession DAL 20:39 and TB 39:21, the same as ESPN's.

### C4. `box`: derived from rows, matches ESPN's final box score

```json
"box": {
  "DAL": {"plays": 55, "yards": 366, "rush": {"att": 13, "yds": 50},
          "pass": {"comp": 24, "att": 42, "net": 316, "int": 2, "sacks": 0, "sack_yds": 0},
          "first_downs": {"total": 20, "rush": 5, "pass": 12, "pen": 3},
          "third": {"conv": 4, "att": 10}, "fourth": {"conv": 0, "att": 1},
          "turnovers": 3, "fumbles_lost": 1, "penalties": {"n": 7, "yds": 57}, "top_s": 1239, "top": "20:39"},
  "TB":  {"plays": 65, "yards": 419, "rush": {"att": 39, "yds": 241},
          "pass": {"comp": 19, "att": 25, "net": 178, "int": 0, "sacks": 1, "sack_yds": 11},
          "first_downs": {"total": 24, "rush": 10, "pass": 10, "pen": 4},
          "third": {"conv": 7, "att": 13}, "fourth": {"conv": 0, "att": 1},
          "turnovers": 0, "fumbles_lost": 0, "penalties": {"n": 14, "yds": 92}, "top_s": 2361, "top": "39:21"}
}
```

- Counted rows are non-nullified `play` and `kneel` rows. Rushes are runs, scrambles and kneels. Pass attempts are passes including interceptions, not sacks. Net passing is completion yards minus sack yards.
- Penalties come from every row's `penalty`, attributed to `penalty.on`.
- Turnovers are interceptions plus lost fumbles, including the kickoff fumble.
- 3rd and 4th down are snaps that stood on that down; a conversion is `first_down` or TD.
- `top_s` is the sum of completed drives' `time_s`. A drive in progress adds its start clock minus the current clock.
- Every number above equals ESPN's final `boxscore.teams[].statistics` (`totalYards`, `rushingYards` and attempts, `netPassingYards`, `completionAttempts`, `sacksYardsLost`, `firstDowns` and the pass, rush and penalty splits, `thirdDownEff`, `fourthDownEff`, `turnovers`, `fumblesLost`, `totalPenaltiesYards`, `possessionTime`).
- **Don't use ESPN's `boxscore` for display.** Its `value` field is unreliable (`totalYards` has `value: "-"`, `displayValue: "419"`), `interceptions` is listed twice, and in Watch mode it is the final.

### C5. `status`

```json
{"state": "in", "qtr": 3, "clock": "10:51", "poss": "TB", "score": {"DAL": 10, "TB": 14},
 "down_text": "1st & 10 at TB 25", "ball_x": 75, "ball_kind": "snap",
 "timeouts": {"DAL": 3, "TB": 3}, "last_seq": 104, "wp_home": 0.6324}
```

That is the real state right after the DAL interception (applied row 104). After all 183 rows: `{"state": "post", "qtr": 4, "clock": "0:00", "poss": null, "score": {"DAL": 16, "TB": 24}, "down_text": null, "ball_x": null, "timeouts": {"DAL": 1, "TB": 2}, "last_seq": 183, "wp_home": 0.0}`.

- `state` is `pre` (no rows), `in`, or `post` once an `end_game` row is applied. It is never read from ESPN's header.
- `poss`, `down_text` and `ball_x` come from the last row that has a `post`.
- After a score, `ball_kind` is `kickoff` and `ball_x` is the scoring team's own 35 (`spot_x(team, 35)`).
- `timeouts` is 3 minus the `admin.what == "timeout"` rows by each team in the current half.
- `clock` is the last applied row's snap clock. ESPN gives no clock after a play.

---

## D. Manual-entry mode (no ESPN)

When `source` is `log`, the server builds the same row shape from `engine.state["log"]`. Those are the caller's snaps only.

| Field | From the log row |
| --- | --- |
| `seq`, `id`, `src` | log `seq`, `"log-<seq>"`, `"log"` (`espn_seq`, `wall`, `type` null) |
| `drive`, `team`, `offense_is_caller` | engine `drive`, caller, true |
| `qtr`, `clock`, `clock_s`, `t` | row values. `clock_est` must be added to log rows, since `sit.clock_estimated` isn't copied today. |
| `pre` | `down`, `togo`, `yardline_100`, plus text built like `situation_text()` |
| `post` | the next log row in the same drive, else null. A flag typed by hand (v1.4) carries its own enforced spot (`yardline_after`, `down_after`, `togo_after` on the log row): that is its `post`, and null when a loss of down on 4th ended the drive there. |
| `geo` | `x0 = 50 + dir*(50 - yardline_100)` (= `100 - yardline_100` with the caller on the left); `x_end = x0 + dir*yards` (TD: goal line); `x_next` = the next row's `x0` in the same drive. `lat` comes from a run leaf (`run_ot_left` gives left, `run_inside` gives middle). For passes `lat` is null and listed in `approx`. |
| `call` | `family`, `leaf`, `outcome`. `depth` is the **leaf bucket** (short, mid, deep, which are not ESPN's words). `air` is the bucket median, `air_src: "bucket"`: short 3 (IQR -1 to 5, n = 2,847), mid 14 (12 to 16, n = 923), deep 26 (22 to 35, n = 513), nflverse 2026 weeks 1 to 5. `yac` null. |
| `result` | `yards`, `td`, `turnover`, `nullified`; `first_down` comes from the next snap (`down == 1` on a new series) or `yards >= togo`. `turnover_kind` is the log row's (v1.4, G1-5): `"int"` for shorthand `I` or `INT`, `"fumble"` for `F`, null when the Turnover box was ticked with no kind. `penalty`, for a flag typed by hand (v1.4, G1-4), is ESPN's shape: `{"code": "DH", "foul": "defensive holding", "on": "TB", "yards": 5, "at_x": 24, "no_play": true, "status": "enforced" or "offsetting", "note": null}` (`foul` is the engine's label, lowercased, without its instructions or "on defense"); for an ESPN no-play or a game saved before v1.4, `{"code": ...}` only. |
| `score` | after the play = the next row's `score` (`"off-opp"`), or `sit` for the last row |
| `scoring` | `td` gives `{"team": caller, "type": "TD", "pts": 7}` (the engine assumes the PAT) |
| `wp` | null |
| `pred` | the log row itself |

Drives come from the engine's `drive` numbers. `result` is `TD`, `TURNOVER` or `DOWNS` when the last row shows it, and null otherwise. A drive's `plays` counts snaps that stand (not flags, not no-plays).

**Flags typed by hand (v1.4, G1-4).** A foul with no play logged (pre-snap, or after a play that stands: `X FS`, the flag panel with nothing picked, `X URD` after a run) is a log entry of `kind: "penalty"` with its own `seq` (the timeline key: unique and increasing), the spot before (`down`, `togo`, `yardline_100`) and after (`yardline_after`, `down_after`, `togo_after`), `pen_on` (`def`, `off`, or null for offsetting) and `pen_yards` (the yards walked, half the distance included). It becomes a timeline row of kind `penalty` in ESPN's shape: `call` and `pred` null, `geo.x0` the line, `x_end` the line, `x_next` the enforced spot, `result.nullified` true for a pre-snap foul, `first_down` when it gives a new series (`fd_by: "penalty"`). The page draws it as ESPN's penalty rows: the flag at the line, the walk, "Flag · false start on DAL · −5". It is never a snap: the metrics, `/api/state`'s `log`, the DuckDB archive and the CSV export skip it, and `unlinked` never lists it. A no-play row (a flag on a picked call) records the same facts, so it walks to its own enforced spot instead of to wherever the next snap was.

What manual mode can't show, so the UI must not pretend it can:

- Opponent plays and drives. Opponent possessions are blank stretches.
- Kicks. Punts, FGs and misses only end a drive. Recommend `end_drive` record `{drive_n: how}` in `state["drive_ends"]` so the result isn't null.
- Pass side, exact air yards, YAC, sack spots, return spots.
- An exact clock (estimated until typed), wall time, win probability, box score for the opponent, time of possession.
- Team colors and logos, unless a cached summary exists for `GAME["espn_event"]`.

---

## E. Watch mode backend

### E1. Endpoints

All bodies are JSON objects read with `request.get_json(silent=True) or {}` and validated. Successful POSTs return the same body as `/api/state` (view, `feed`, `watch`, `timeline` pointer), which is what the existing `api()` helper expects. Errors return 400 or 409 with `error`.

| Endpoint | Body | Effect |
| --- | --- | --- |
| `POST /api/watch/start` | `{"event_id": "401872980", "speed": 4, "from_seq": 0}` | validates (`event_id` must match `^\d{6,12}$`; `speed` is a float from 0.5 to 10; `from_seq` is between 0 and the play count). Loads the summary (offline: the saved `_final.json`, else 400 with the existing "no saved game" message), backs up, resets, then starts the thread. Returns 409 if a watch is already playing or paused. |
| `POST /api/watch/pause` / `resume` | `{}` | `playing` ↔ `paused`. Idempotent. |
| `POST /api/watch/step` | `{}` | only while paused (else 409): applies exactly one play now |
| `POST /api/watch/speed` | `{"speed": 8}` | the change takes effect on the current wait, with the remaining time rescaled |
| `POST /api/watch/stop` | `{"restore": false}` | ends the session. `restore: true` puts back the pre-watch game (E3) and restarts the live feed if it was on. |
| `GET /api/watch` | | the `watch` object below (it is also inside `/api/version` and `/api/state`) |
| `POST /api/open` | (none) | restructure-v2.md 9: what the home page calls once on load. A watch session (playing, paused, done, error) or the live feed already on: nothing changes. Otherwise an ESPN game in progress (or not yet started) goes live (`/api/golive`), and a finished one opens as a watch paused at kickoff (seek 0). |
| `POST /api/watch/seek` | `{"idx": 104}` | rebuilds the game from kickoff and applies the first `idx` ESPN plays at once (no pacing), then holds: `paused`, or `done` when `idx` equals the total. `idx` is an integer from 0 to the total (not a boolean, not 2.0), else 400. Allowed from any state; Reset is seek 0. A session's first rebuild backs the game up like `start`; later rebuilds keep that session's restore point. A seek to where the session already stands changes nothing. |
| `POST /api/watch/back` / `forward` | (none) | one drawn play back or forward: a timeline row that is built and is not an admin row (admin rows draw nothing). Back always rebuilds, paused, and at kickoff is 409 "Already at kickoff."; Forward applies on top while playing or paused (a playing session pauses), rebuilds otherwise, and at the end is 409 "Already at the last play.". With no session both work from the game on screen, live mode included. `step` keeps its one-ESPN-play meaning. |
| `POST /api/golive` | (none) | an ESPN game in progress (or not yet started): applies every play so far (this event's plays already on screen stay; anything else is rebuilt), ends the session keeping the game (no restore) and turns the live feed on through the `/api/feed` path; another matchup is a 400 before anything changes. A final game: seek to the end (`done`). ESPN unreachable when it is needed: 503 with a plain message, and nothing changes. Offline the saved final is used, so it takes the final path. |
| `GET /report` | | the Model Report page (`static/report.html`), with the same Host gate and headers as `/`; a JSON 404 while the file is missing |

The five calls added for restructure-v2.md 9 (open, seek, back, forward, Go Live) answer with the full state, sit behind the same Host, Origin and Content-Type gate as every other POST, and validate their bodies strictly (400 with a plain reason). A seek holds `LOCK` for up to about 0.8 s (150 plays rebuild in 0.57 s from idle, the first backup included), so the page seeks on release and keeps one request in flight.

```json
"watch": {"state": "playing", "event_id": "401872980", "speed": 4.0, "idx": 104, "total": 183,
          "next_at": 1791504012345, "next_kind": "caller_snap", "ff_until": 0,
          "started_at": "2026-10-09T21:10:00", "feed_was_on": false,
          "backup": {"state": "live_state.backup-20261009-211000.json", "seen": "feed_seen.json.backup-20261009-211000"},
          "error": null}
```

- `state` is one of `idle`, `playing`, `paused`, `done`, `stopped` or `error`.
- `idx` is the number of ESPN plays applied, which equals the timeline `n`.
- `next_at` is server epoch milliseconds for when the next play lands, or null while paused (*illustrative value*).
- `next_kind` (v1.4, G1-1, also in `/api/version`) is the pace of the row the session waits on: `caller_snap` (a snap of the modelled caller: his next call is up), `snap` (the opponent's), `kick`, `admin` or `admin_end` (end of a quarter, half or game); null unless playing or paused.
- `ff_until` is set by `from_seq`: rows with `seq <= ff_until` are applied with no delay and drawn without animation.
- `marks` (restructure-v2.md 9; in `GET /api/watch` and `/api/state`, never in the 250 ms `/api/version` brief): `[{"idx", "kind": "drive" | "quarter" | "score", "team", "label"}]` in idx order, the progress bar's ticks. Drive and quarter marks sit at the idx before their first play ("DAL ball · Q1 15:00", "Q2"); a score mark sits at the idx after the scoring play ("TD DAL"). They follow the game on screen, the live feed after Go Live included (recomputed per poll, cached). The screen shows a score mark only once play has passed it (E5).
- `game` (the same two places): `{"status": "pre" | "in" | "post" | null, "detail": "Final"}`, ESPN's status for the game on screen, so the page knows a live game from a final one; null when there is no summary.
- After Go Live on a live game the session is over (`state` is `stopped`), `feed.on` is true and the timeline's `mode` is `live`; `idx` and `total` stay at the plays applied at Go Live, so the page sizes its bar by the timeline while live. A rebuild (seek, back, Go Live's rebuild) gives a new epoch (a full redraw, no animation); a forward applied on top keeps the epoch, so its rows animate.

### E2. Threading and locking

```python
class Watch:
    """Replays a saved or finished ESPN game into the engine, one play per tick."""
    def __init__(self, feed, lock, pace_scale=1.0):
        self.feed, self.lock = feed, lock          # lock = app.LOCK (the RLock every engine mutation takes)
        self.cv = threading.Condition()            # guards the fields below; never held while touching the engine
        self.state, self.queue, self.idx, self.token = "idle", [], 0, 0

    def _run(self, token):
        while True:
            with self.cv:
                while self.token == token and self.state == "paused":
                    self.cv.wait()
                if self.token != token or self.state != "playing":
                    return
                if self.idx >= len(self.queue):
                    self.state = "done"; return
                delay = 0 if self.idx < self.ff_until else self._pace(self.queue[self.idx]) / self.speed
                self.next_at = now_ms() + delay * 1000
                woke = self.cv.wait_for(lambda: self.token != token or self.state != "playing" or self._kick,
                                        timeout=delay)
                if woke:                            # paused, stopped, or speed changed: re-evaluate
                    self._kick = False
                    continue
                i = self.idx
            with self.lock:                         # LOCK held only while applying ONE play
                if self.token != token or self.state != "playing":
                    continue                        # paused or stopped while we waited for the lock
                team, p = self.queue[i]
                self.feed.apply_one(team, p)        # _apply_one + applied/seen + status + _save_seen; never raises
                with self.cv:
                    self.idx = i + 1
```

Invariants (the tests in G pin them):

1. **Lock order is always `LOCK` then `cv`.** The thread waits on `cv` without holding `LOCK`. Control endpoints that only change state (pause, resume, speed) take `cv` alone. `start`, `step` and `stop` take `LOCK` first, then `cv`.
2. **`LOCK` is held only while one play is applied.** Measured: TB rows median 1.3 ms; DAL rows median 115 ms, mostly `predict()` (94 ms) plus the DuckDB insert and the state-file write. The thread never sleeps while holding `LOCK`.
3. **Every engine mutation is under `LOCK`**: the watch thread, the live poller (`Feed.apply`) and every HTTP handler.
4. **The live poller can never race a watch.** `Feed` gets a `gen` counter. `poll_once` reads `gen` before it fetches. `apply(summary, gen)` returns 0 under the lock if `gen` is stale. `watch/start`, `/api/feed/replay` and `/api/reset` call `feed.stop()` and `feed.invalidate()` (`gen += 1`) under `LOCK`. `POST /api/feed {"on": true}` returns 409 while a watch is `playing` or `paused`.
5. **Back up before the reset, inside the same `LOCK` block.** Copy `live_state.json` to `live_state.backup-<ts>.json`, exactly like `/api/feed/replay` does today. Also copy `feed_seen.json` to `feed_seen.json.backup-<ts>`: without it a restored game re-logs plays it already has. `.gitignore` already covers both names. Then `engine.reset()`, `engine.history = []` (so U can't half-restore the old game), `feed.forget()`, `feed.event_id = eid`, `feed.summary = summary`, `feed.off_team_id = team_id(...)`, bump the epoch, then start a daemon thread with the new `token`.
6. **Restore** (`stop` with `restore: true`, under `LOCK`): atomically copy both backups back, `engine.state = engine._load() or engine._fresh()`, clear history, reload `feed.applied` and `feed.seen`, restore `feed.event_id`, bump the epoch, `engine._save()`, and restart the feed if `feed_was_on`. With no backup (a fresh install), restore means a fresh game.
7. **Restarts.** The thread is a daemon, so a server restart ends the session. The partly watched game is still on disk. As built, the restore point is also in `data/watch_session.json`, so the session comes back as `error` ("The app restarted during a watch ... Reset takes it back to kickoff, Go Live to the latest play.", naming the top bar's own keys, since restructure-v2 has no Stop and both rebuild from an error) and Stop (the API's) still puts the real game back (`idle` here stranded it in a backup nothing pointed at).
8. Manual endpoints (retag, undo, play, flag) stay allowed during a watch. `LOCK` serializes them between plays. Retagging play-action in a watched game is a legitimate demo move. The UI should pause first.

### E3. Pacing

The delay applies before each row, at 1x, divided by `speed`, and multiplied by the `SHADOW_WATCH_SCALE` environment variable (default 1; tests use 0.001).

| Next row | Seconds at 1x | TB@DAL rows |
| --- | --- | --- |
| caller snap (`play`, `penalty`, `kneel`, `spike`, `other` with `offense_is_caller`) | 7.0 (time to read the prediction, then see the snap) | 60 |
| opponent snap | 4.0 | 78 |
| `kickoff`, `punt`, `fg`, `fg_miss` | 5.0 | 18 |
| `admin` (timeouts, two-minute warning) | 1.0 | 23 |
| `admin` end of quarter, half or game | 3.0 | 4 |

**v1.4 (G1-1): a floor before every caller snap.** At 4x a caller snap came 1.75 s after the play before it, the page gave 80% of that to the play, and his next call was up for 0.31 to 0.62 s (11 snaps, GPU Chromium). Now a caller snap waits at least its floor, in seconds at that speed (still times `SHADOW_WATCH_SCALE`): **6.0 s below 4x, 4.8 s at 4x, 3.6 s above** (`watch.CALLER_FLOOR_S`; `delay_s`). The floor holds the play before it (1 to 1.7 s), the page's reserve for the call (E4: the verdict's beat, 1.5 s below 4x and 0.6 s from 4x; the call's 400 ms fade-in; 2 s of it fully lit up to 4x, 1 s above) and a poll's latency. Every other row keeps its pace. A speed change rescales the wait to the new speed's pace, floor included.

The whole game takes **857 s (14:17) at 1x, 579 s (9.6 min) at 2x, 397 s (6.6 min) at 4x and 260 s (4.3 min) at 10x** (it was 214 s at 4x and 86 s at 10x). For comparison, ESPN's wall clock ran 3 h 2 min 30 s (00:15:54 to 03:18:24 UTC). An optional `pace: "real"` (wall-clock gaps capped at 45 s) can come later; don't build it now.

The next call's window before each Dallas snap, measured (unscaled sandbox, GPU Chromium with Metal, Under the Lights unless noted; the shadows' `#field[data-ghosts]` up until the snap takes them down; "fully lit" subtracts their 400 ms fade-in):

| Speed | Before v1.4 | Window, median / least | Fully lit, least |
| --- | --- | --- | --- |
| 1x | 3.5 to 6.5 s | 3.70 / 3.41 s (10 snaps) | 3.0 s |
| 2x | 1.5 to 1.8 s | 2.73 / 2.63 s (10) | 2.2 s |
| 4x | 0.44 s median (0.31 to 0.62) | 2.73 / 2.63 s (13); neutral 2.75 / 2.63 (14) | 2.2 s |
| 10x | 0.29 s | 1.88 / 1.45 s (25); neutral 1.91 / 1.85 (25) | 1.05 s |

### E4. How the UI learns that a play arrived

`GET /api/version` stays lock-free and O(1), and adds three keys (*illustrative values*):

```json
{"version": 412, "epoch": "k3v9-2", "timeline_n": 104,
 "feed": {"state": "off", "on": false, "last_poll": "21:13:07", "last_play": "...", "plays_logged": 36, "skipped": null},
 "watch": {"state": "playing", "event_id": "401872980", "idx": 104, "total": 183, "speed": 4.0,
           "next_at": 1791504012345, "next_kind": "caller_snap", "skipped": 0, "error": null}}
```

```
poll every 1000 ms (every 250 ms while watch.state == "playing"; the endpoint is 161 B and 0.4 ms today, still well under 1 KB with the new keys):
  v = GET /api/version
  if v.epoch != local.epoch:      r = GET /api/timeline?since=0                      -> rebuild scene, no animation
  elif v.timeline_n > local.n:    r = GET /api/timeline?since=local.n&epoch=local.epoch -> queue r.rows in seq order
  if v.version != local.version:  s = GET /api/state  -> next-call panel, log, metrics; patch pred (B7)
```

- `version` goes up on every `engine._save()`: 330 bumps for the full game, about 1.8 per ESPN play.
- `timeline_n` goes up exactly once per applied play. It is the animation trigger.
- Track `n` from the timeline response, not from `/api/version`.
- Animation length is `min(normal, 0.8 * (watch.next_at - now))`. If more than 3 rows are queued (for example a hidden tab), draw the older ones instantly.
- v1.4 (G1-1, `core/anim-queue.js`): when `watch.next_kind` is `caller_snap`, the play before it also leaves the next call its reserve: `min(CALL_RESERVE_MS, 0.7 * (next_at - now))`, with `CALL_RESERVE_MS` 4100 ms below 4x, 3200 at 4x and 2400 above (the verdict's beat, the 400 ms fade-in, the lit target and some to spare), shared across the animated queue. A watch object older than the head row (`watch.idx < row.seq`: its `next_at` is that row's own landing, already past) is never budgeted on: the play waits for the next `/api/version`, at most 600 ms past that landing. Scaled-down test runs (`SHADOW_WATCH_SCALE`) leave too little for a play, which then draws at once, as before.

### E5. No spoilers

In every mode, the server only reads **per-play fields of applied plays**, plus team names, colors and logos. It never reads:

- `header.competitions[0].competitors[].score`, `winner`, `record` or `linescores`
- `header...status`, `meta.gameState`
- `boxscore`, `scoringPlays`, `leaders`, `article`, `news`, `videos`
- `winprobability` entries of unapplied plays
- `drives[].result`, `yards`, `timeElapsed`, `offensivePlays` or `description` of drives that aren't complete (C3)

Exception (restructure-v2.md section 9): the watch object's `marks` span the whole game, future scores included, and `game` reads `header.competitions[0].status.type` (`state`, `shortDetail`). The screen keeps the rule: the progress bar shows the drive and quarter ticks for the whole game, but a score mark only once play has passed it (`model/vm-transport.js`), never a future score.

### E6. Related fixes to `/api/feed/replay`

The replay endpoint has the same race today. It doesn't stop the poller, so a summary fetched just before a replay can be applied into the rebuilt game. Give it `feed.stop()`, `feed.invalidate()` and the `feed_seen.json` backup from E2. It holds `LOCK` for about 11.0 s while it rebuilds all 183 plays (measured in the sandbox). That is acceptable, but the UI should show progress.

v1.4 (G1-11): the replay's message names the backup it made ("Your old game is backed up as live_state.backup-20261010-101500.json.") or says "No earlier game to back up."; `feed.status.plays_logged` starts over with each replay. `backup_game` keeps only the newest 20 backups of each file, never one a watch's session file names, and backups made in the same second are numbered past the newest (`-2`, `-3` ...). `data/.live_state.*` and `data/.feed_seen.*` (the files a restore stages) are git-ignored.

---

## F. Payload size and performance

Measured on TB@DAL in the sandbox and with the prototype:

| Item | Size or time |
| --- | --- |
| `/api/version` | 161 B, 0.4 ms |
| `/api/state` after the full game | 49,406 B (8,492 gzipped). The log is 45.9 KB of it; `profile` 3.5 KB, `penalties` 2.3 KB and `keys` 0.9 KB never change. |
| `engine.view()` with a drive active | about 94 ms, almost all of it `predict()`, under `LOCK` |
| Full timeline, 183 rows | 186,976 B (27,028 gzipped); about 1.0 KB per row; `pred` blocks 30.8 KB over 59 rows |
| `drives` (21) / `box` + `status` | 6.5 KB / under 1 KB |
| `live_state.json` after the full game | 119 KB |
| Full replay | 11.0 s, 330 version bumps |

**Recommendation: a separate `/api/timeline?since=n&epoch=e`, not a field inside `/api/state`.**

- Inside `/api/state`, every version bump would ship about 240 KB. At 10x Watch that is about 2 bumps every 0.6 s.
- With `since`, a new play costs one row (about 1 to 1.5 KB) plus about 7 KB of drives, status and box.
- Rows are append-only, which is what an animation queue wants. `/api/state` is a snapshot.

Changes that go with it:

1. `/api/state` gains `timeline: {"n", "epoch", "source", "mode"}` and `watch`. Additive only, so nothing that reads it today breaks.
2. Memoize `predict()` by `state["version"]`. Repeat `/api/state` calls at the same version drop from about 94 ms to about 2 ms, which keeps `LOCK` free for the watch thread.
3. Cache built rows per ESPN id within an epoch. A row is frozen the first time it is built. This matches the README rule "Each play is read once": a later ESPN rewrite doesn't change a drawn play until the next epoch.
4. Optional: `GET /api/meta` for `profile`, `penalties`, `keys`, `leaf_names` and `family_names`, so `/api/state` can stop resending them later.
5. Flask doesn't compress responses. On localhost that doesn't matter. If the app is ever hosted, gzip takes the full timeline from 187 KB to 27 KB.

---

## G. Backend tests that pin the contract

Pure tests use the existing `sandbox` and `make_feed` fixtures, build the timeline with `feed.apply(summary)`, and never start Flask. HTTP tests need the subprocess `server` fixture from `tests/e2e/conftest.py` (sandbox on a free port, offline, saved game). Move it to `tests/conftest.py` so API tests run without Playwright. Watch tests set `SHADOW_WATCH_SCALE=0.001`.

| # | Test (module) | What it pins (real TB@DAL values) |
| --- | --- | --- |
| 1 | `test_timeline_has_every_applied_play_in_order` (test_timeline.py) | 183 rows, `seq` 1..183, `espn_seq` increasing. Kinds: play 129, admin 27, kickoff 9, penalty 7, punt 7, fg 2, kneel 2. 64 rows with `offense_is_caller`. |
| 2 | `test_first_dallas_snap_starts_at_x30` | `40187298068`: seq 2, `dir` +1, `x0` 30, `x_end` 30, `x_next` 30, `pre` 1st & 10 / 70, `lat` middle, `air` 5 `est` [1, 10], `wp.home` 0.864 |
| 3 | `test_first_tampa_snap_runs_right_to_left` | `401872980390`: `dir` -1, `x0` 73, `x_end` 70, `air` -1, `yac` 4, `lat` left |
| 4 | `test_x_equals_espn_yardline_with_home_caller_on_the_left` | all 156 non-admin rows: `x0 == start.yardLine`. With the caller set to TB: `x0 == 100 - yardLine`, the first TB snap has `x0` 27 and the first DAL snap has `x0` 70. |
| 5 | `test_home_punts_ignore_yards_to_endzone` | the DAL punts `4018729801082`, `4018729801339` and `4018729801749` have `x0` 44, 53 and 18, and `pre.yardline_100` 56, 47 and 82 |
| 6 | `test_completion_air_and_yac` | `401872980185`: `air` 21 (yac 0), `x_catch` 92. `4018729801915`: `x0` 13, `air` 39, `yac` 9, `x_catch` 52, `x_end` 61. |
| 7 | `test_incompletion_air_is_a_labelled_estimate` | `4018729801059` (deep left): `air` 23, band [19, 32], `x_catch` in `approx`. 27 rows have `air_src` `est`. |
| 8 | `test_interception_spot_gives_air_and_return` | `4018729802466`: `air` 3 (`int_spot`), `x_catch` 76, `x_end` 75, `x_next` 75, kind `int`. `4018729804123`: `air` 12, `x_catch` 88. |
| 9 | `test_run_gap_side_and_length` | `401872980163` up the middle, 50 → 71. `4018729802242` TB left tackle, `dir` -1, 86 → 14 (72 yd). Scramble `401872980442` `lat` right. |
| 10 | `test_sack_is_negative_and_uses_the_sack_spot` | `4018729802713`: `yards` -11, `x0` 37, `x_end` 48 |
| 11 | `test_no_play_ghost_and_enforcement` | `401872980210`: nullified, `x_end` 93, `x_next` 96, penalty TB Defensive Offside 4 with `no_play` true, `first_down` false |
| 12 | `test_flag_on_a_play_that_stands` | `4018729801359` (face mask): not nullified, `x_end` 88, `x_next` 73, `fd_by` penalty |
| 13 | `test_kickoff_return_touchback_and_fumble` | `40187298040`: land 3, return end 30. `4018729803781`: land 100, `ez`, touchback, `x_next` 65. `4018729802667`: `fumble_rec` TB 37, `turnover` true (ESPN's `isTurnover` is false). |
| 14 | `test_field_goal_kick_spots` | DAL `4018729802060`: `x0` 77, `x_kick` 69, `post_x` 110. TB `4018729802919`: `x0` 23, `x_kick` 31, `post_x` -10. |
| 15 | `test_scoring_rows_and_points` | 7 rows with the same ids as ESPN's `scoringPlays`. `401872980322`: 7 pts, `kick_good`. `4018729803742`: 6 pts, `two_failed`, score DAL 16 TB 24. |
| 16 | `test_win_probability_after_every_play` | 183 of 183 rows have `wp.home`. `wp_start` 0.8619. The interception row is 0.6324 with `delta` -0.1132. The last row is 0.0. |
| 17 | `test_drives_match_espn` | 21 drives. For every drive with a snap, start x, end x, yards and plays equal ESPN's. Results: TD, TD, PUNT×6, FG, END OF HALF, TD, INT, TD, FUMBLE, FG, DOWNS, DOWNS, TD, PUNT, INT, END OF GAME. Drive 14 has plays 0, yards 0, x 28. |
| 18 | `test_box_score_matches_espn_final` | every stat in C4 equals `boxscore.teams[].statistics`, including first downs 20/24 and possession 20:39/39:21 |
| 19 | `test_status_mid_game_and_final` | after 104 rows: Q3 10:51, poss TB, DAL 10 TB 14, `ball_x` 75, state `in`. After 183 rows: `post`, timeouts DAL 1 TB 2. |
| 20 | `test_caller_rows_link_to_the_engine_log` | 59 rows with `pred`, `log_seq` 1..59 in order, every log row has `espn_id`. `40187298068`: p 0.4562, league 0.4624, `top3` [run_inside, pa_short, dropback_short], `leaf_rank` 3, `fam_p` 0.1781. |
| 21 | `test_retag_changes_pred_not_geometry` | after `retag_last("A")` on a pass, the row's `pred.family` is `pa` and its `geo` is unchanged |
| 22 | `test_partial_game_has_no_spoilers` | apply 104 plays: `n` 104, 12 drives, drive 12 is INT (complete), no drive 13, box DAL 187 yd and TB 241 yd, state not `post` |
| 23 | `test_since_and_epoch` (HTTP) | `since=100` returns seq 101..183. A wrong epoch gives `reset` true and every row. Bad `since` gives 400. Reset or replay changes the epoch. |
| 24 | `test_legacy_sorted_seen_file_is_reordered` | a sorted `feed_seen.json` gives a timeline in `sequenceNumber` order |
| 25 | `test_manual_mode_rows_from_the_log` | typed plays give `src: "log"`, `x0 = 100 - yardline_100`, a short pass `air` 3 (`bucket`, approx), `wp` null |
| 26 | `test_watch_backs_up_state_and_seen_then_resets` (test_watch.py) | both backup files hold the pre-watch bytes, the engine log is empty, history is cleared |
| 27 | `test_watch_runs_to_the_end` | `done`, score 16-24, log 59, timeline 183, `idx == total == 183` |
| 28 | `test_watch_pause_holds_and_step_applies_one` | `idx` is stable for 0.2 s while paused, then `step` adds exactly 1. `step` while playing returns 409. |
| 29 | `test_watch_speed_change_rescales_the_wait` | with a long pace, speed 1 → 10 makes the next play land early |
| 30 | `test_stop_with_restore_puts_the_live_game_back` | the log, `seen` and `applied` equal the pre-watch values, the epoch changed, the feed restarts if it was on |
| 31 | `test_inflight_live_poll_is_dropped` | `gen` captured, then watch start, then `feed.apply(summary, gen=old)` returns 0 and logs nothing |
| 32 | `test_feed_cannot_start_while_watching` (HTTP) | `POST /api/feed {"on": true}` returns 409 |
| 33 | `test_watch_never_holds_lock_while_waiting` | during a long wait, `LOCK.acquire(timeout=0.05)` succeeds |
| 34 | `test_each_play_bumps_version_and_timeline_n` | `timeline_n == watch.idx`, and `version` goes up every play |
| 35 | `test_logo_rejects_bad_input` (test_logos.py) | `../x`, `dal.png`, `D-L`, `TOOLONG` and `%2e%2e` give 404; `NYJ` (not in the game) gives 404; `?v=../x` gives 400 |
| 36 | `test_logo_upstream_url_allowlist` | accepts `https://a.espncdn.com/i/teamlogos/nfl/500/dal.png`. Rejects `http:`, `a.espncdn.com.evil.com`, `evil.com/a.espncdn.com/…`, userinfo, a port, `..`, a query string, `.svg`. |
| 37 | `test_logo_offline_never_touches_network` | `urlopen` patched to raise: a cache hit gives 200 `image/png`, a miss gives 404 |
| 38 | `test_logo_cache_path_size_signature_redirect` | writes only inside `DATA_DIR/logos`; non-PNG, over 1 MB and 3xx all give 502 and leave nothing cached |
| 39 | `test_suite_never_touches_the_live_game` (session, autouse) | the sha256 of `data/live_state.json` and `data/feed_seen.json` (when present) is the same before and after the run |

---

## H. Security model and the live game's safety (v1.4)

The app is a single-user tool on localhost: no accounts and no secrets, and its one asset is the live game in `data/live_state.json` (with `feed_seen.json` and the DuckDB archive). Everything below protects that file from other sites, from ESPN's answers, and from Sam's own mistakes at speed.

**Who may talk to it.**

| Guard | Where | Answer |
| --- | --- | --- |
| Only `127.0.0.1` and `localhost` (a DNS name rebound to 127.0.0.1 is refused) | `TRUSTED_HOSTS` | 400, every route (page, static files, logos, export) |
| Every change is JSON (a cross-site page can't send JSON without a CORS preflight this app never grants) | `own_page_json_only` | 415 |
| An `Origin`, when sent, must be this app's own | `own_page_json_only` | 403 |
| A body over 64 KB | `MAX_CONTENT_LENGTH` | 413 |
| No other site may frame the page (a hidden frame could click "ESPN live"); Sam's own tools on other local ports may | `Content-Security-Policy: frame-ancestors 'self' http://localhost:* http://127.0.0.1:*` on every answer | |
| No content sniffing, no referrer, no shared window with other origins | `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin` | |

A full script and style CSP is deferred: the page loads its modules and fonts from its own origin, but a policy strict enough to matter needs the inline bootstrap moved out first.

**What a request may say.** Every POST reads a JSON object (an empty body, a list or a broken one is a 400 with the state body, never an HTML page), checks types and ranges at the boundary (yards −100 to 100 as a JSON whole number; down 1 to 4; to go 1 to 99 or G; a clock up to 15:00; scores 0 to 199; penalty yards 1 to 99; short text fields at most 40 characters, a shorthand line 500) and answers with the state body plus `error`: **400** for a request the game can't take (a `KeyError` or `TypeError` is a 400 too, with its traceback in the server log in case it isn't the request's fault), **409** when the game's state refuses it (an undo past an ESPN play, a watch on screen), **500** with the traceback in the server log for anything else. Flask's own errors (404, 405, 413, a refused Host) are JSON too.

**What ESPN may send.** A live poll is checked before anything is applied (`espn_feed.check_summary`, `check_matchup`):

- An answer that isn't a game summary (`{"code": 500}`, a list, no `header.competitions[0].competitors`, `drives` that isn't an object), or a thin one (no plays once plays are applied), is a failed poll: nothing is applied and the summary on screen (colors, logos, venue) stays. Before kickoff a summary with no drives is fine.
- Another matchup's game (the teams aren't `GAME`'s offense and opponent; ESPN's aliases allowed) is refused: `POST /api/feed {"on": true}` answers 400 "ESPN event X is NYG at PHI, not DAL v TB." and changes nothing; a poll that finds it later stops the feed with that reason in its status. Replay and Watch this game take any game with the caller in it, behind their own backups.
- Fetches refuse redirects (a 3xx is a failed fetch) and answers over 8 MB, and give up on a download after 30 s. A failing feed waits 4, 8, 16, then 30 s between polls, and 4 s again after a good one.
- The raw summary (`data/espn/summary_<event>.json`, what a restart reads) is written after the plays are applied, whole (a temp file, then a rename), and only when new plays arrived. A disk that refuses it is noted in the feed's status; the plays are in.
- Every field is read for the type it should have; a row that still can't be built is left out and listed in `missing` (C1). Text is capped (C1).

**Backups before anything replaces the game.** Reset, replay and Watch this game copy `live_state.json` and `feed_seen.json` aside first (E2, E6). Turning the live feed on does too when it follows another event than the one its applied plays came from, or when the game has typed plays and nothing from ESPN yet. A game file for another `game_id` (or with no game in it) is copied to `live_state.other-<game_id>-<time>.json` before the new game's first save, and an unreadable one to `live_state.unreadable-<time>.json`; the message names the copy. `feed_seen.json` records the ESPN event its applied ids came from (`_events`), so after a restart the feed follows that event, not whatever `config.py` says.

**The models.** Missing models, or models built with another scikit-learn, are rebuilt at start (about 30 s, online) only when no game is in progress; otherwise the app stops and says to run `build.py`. `start.sh` installs `requirements.lock`: exact versions, each checked against its hash.

## I. New-matchup checklist

1. **Copy the old game first:** `cp data/live_state.json data/live_state.<old game_id>.json` (the app also copies another game's file aside on its own, as `live_state.other-<game_id>-<time>.json`, but keep your own copy).
2. In `config.py`, change **`game_id` and `espn_event` together** (and `label`, `offense`, `opponent`, `offense_is_home`, `offense_spread`, `total_line`). A new `espn_event` under the old `game_id` would mix two games' ESPN ids in one `feed_seen.json` entry.
3. Abbreviations are ESPN's (`WSH`, `LAR`, `JAX`): the live feed refuses an event whose teams aren't these two.
4. A different play-caller: add his rows to `data/play_callers.csv` and run `.venv/bin/python build.py` (about 30 s, online) before the game, never during it.
5. Restart (`Ctrl+C`, then `bash start.sh`). The page should read "Set the start of Dallas's first drive." (or name the old file it kept aside). Before kickoff, press ESPN live: a wrong event is refused with its teams named.

## Appendix: where the code goes

- `timeline.py`, pure functions:
  - field math (A3)
  - `build_row(ctx, team, drive, play)`
  - `build_timeline(summary, applied, log, caller)`
  - `drives(rows, summary)`, `box(rows, drives)`, `status(rows)`
  - the parse regexes from B6
  - no Flask, no I/O
- `watch.py`: the `Watch` class (E2) and the pacing table (E3).
- `logos.py`: the allowlist validator, fetch, cache and `send_file` (C2).
- `espn_feed.py`: `iter_plays` with drive ids, `Feed.applied`, `gen` and `invalidate()`, `Feed.summary`, and `apply_one`, which the batch `apply` reuses.
- `live.py`:
  - `espn_id` on log rows (`record_play`, `apply_penalty`)
  - `clock_est` on log rows
  - optional `drive_ends`
  - `predict()` memoized by version
- `app.py`: `/api/timeline`, `/api/watch/*`, `/api/logo/<abbr>`; the additive `timeline` and `watch` keys on `/api/state` and `/api/version`; the 409 guard on `/api/feed`; the replay fixes in E6.
- `config.py`: `SHADOW_WATCH_SCALE`. `scripts/sandbox.py`: copy `data/logos/*.png`.
