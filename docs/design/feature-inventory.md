# Current UI: feature and behavior contract

What the single-page UI (`static/index.html`, about 48 KB) does today, so the visual rebuild keeps every behavior on purpose. Sources: every line of `static/index.html`, every endpoint in `app.py`, and `view()`, `command()`, `PENALTIES`, `TAP_CYCLES`, `SHORTHAND` plus the action methods in `live.py` and `granular.py`. Every behavior marked *verified* was exercised on 2026-10-09 in the offline sandbox (`scripts/sandbox.py --port 5087`, saved TB at DAL game) with Playwright Chromium. Appendix C has the method.

How to read it:

- Sections 1 to 5 describe today's behavior. The rebuild keeps all of it unless section 5b lists it as a gap.
- Section 5b lists bugs and quirks found while verifying. Fix each one or keep it, but decide on purpose, never by copying.
- Section 6 is the numbered regression checklist. `[keep]` lines pass on the current UI. `[fix]` lines fail today and describe the intended behavior. `[hook]` lines need a test hook that does not exist yet.
- Names in `code` are real ids, CSS classes, JSON fields or endpoint paths.

---

## 0. Page map today

```
header   "Shadow Play-Caller" | game.label | "Modelling <caller> (<team> offense)" | [Undo] [Export CSV] [Reset game]
main (fluid)                                                          | aside rail (340 px)
  feed bar: (dot ESPN live: off) "ESPN game id" [______] [Replay this game] status line | "Tonight's scorecard"
  field strip (SVG 1200 x 120, offense drives left to right)           | "<Lastname>'s tendencies"
  situation strip: Qtr | Clock (est.) | DAL - TB scores || Down & To go | Ball on [DAL ⇄][25] | drive info + [Punt][FG good][FG missed][Half over]
  strip note
  hero: prediction tree, or "<OFF> is off the field"
  entry panel: "Last play from ESPN" (feed on) OR manual pad + flag panel + chosen line (feed off), then shorthand bar and hint
  "Play log" table (newest first, never paginated)
toast (fixed, bottom center)
```

Breakpoints: at 1040 px and below the grid becomes one column (rail moves under main). At 760 px and below the family grid drops from 5 to 2 columns and the two flag columns stack. Light theme only. `prefers-reduced-motion` turns transitions off. Fonts: Barlow and Barlow Condensed from Google Fonts at runtime.

Color meanings that carry information (keep the meaning even if the palette changes): pass `--pass #1F5FBF` (blue), run `--run #B8741A` (amber), RPO `--rpo #6B4FA0` (purple), line to gain `--gain #F2C230` (yellow, also the focus ring), line of scrimmage `#8FB8FF`, better/worse and rank good/bad `--good #2E7D4F` / `--bad #B23A3A`, ink `#142235`, muted `#5B6878`.

---

## 1. Keyboard

### 1.1 The guard that keeps shortcuts out of inputs

One `keydown` listener on `document` handles every shortcut. It starts with:

```js
const t = e.target instanceof Element ? e.target : document.body;
if (t.matches("input:not(#yards), select, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
```

- Every `<input>` except the Yards box (`#yards`) blocks shortcuts. That covers the situation strip, the ESPN id box, the shorthand bar, and also the three checkboxes (`#fTD`, `#fTO`, `#otherFirst`). See gap G4.
- The Yards box is allowed on purpose: you press the play key, type yards, press Enter without leaving it. After all shortcut checks, any other printable key in `#yards` that is not a digit or `-` is blocked (`preventDefault`). Verified: typing `1q.5 -` gives `15-`.
- Cmd, Ctrl and Alt combinations never reach the app (browser shortcuts keep working). Shift does reach it (Shift+P acts as P). Auto-repeat is not filtered (holding P keeps cycling).
- Buttons are not inputs, so shortcuts fire while a button has focus. Enter on a focused button runs "log play" instead of clicking the button (gap G5).
- Product rule (PRODUCT.md): shortcuts must never fire inside inline inputs. Verified: typing J in Qtr types `j` and leaves the pick alone.

### 1.2 Mode order

1. ESPN feed on (`state.feed.on`): only retag keys and U work (1.7).
2. Flag panel open (client `flagMode`): flag letters (1.6).
3. Otherwise normal mode (1.3).

### 1.3 Normal mode (feed off, flag panel closed)

| Key | Effect |
| --- | --- |
| J, K, L, R, P, A, N, O | Pick a play (tap). Same key again moves to the next entry of its cycle (1.4); a different key starts at its first entry. R is an alias of K. Clears any outcome. Focuses and selects Yards. |
| I | Toggle outcome "incomplete". Turning it on sets Yards to `0`. |
| S | Toggle outcome "sack" (Yards means yards lost, typed positive). |
| C | Toggle outcome "scramble". |
| T | Toggle the Touchdown checkbox. |
| F | Toggle the Turnover checkbox. |
| X | Open the flag panel. No drive active: red toast "No Dallas drive in progress. Type the ball spot first." and no panel. |
| U | Undo (`POST /api/undo`). |
| Esc | Clear the pick: outcome off, Yards `0`, Touchdown and Turnover unticked. Focus stays where it was. |
| Enter | Log the play (`POST /api/play`). Silent no-op when no drive is active or nothing is picked. |
| Other printable keys | Nothing (blocked inside Yards unless digit or `-`). |

Order matters: the outcome key comes after the play key, because a play key clears the outcome. Verified: S then P shows only "Short (0–9 air yds)".

### 1.4 Tap cycles (`TAP_CYCLES`, served as `state.keys`)

| Key | 1st tap | 2nd tap | 3rd tap |
| --- | --- | --- | --- |
| J | Off-tackle left `run_ot_left` | Outside left (edge) `run_edge_left` | |
| K, R | Inside run (A/B gap) `run_inside` | | |
| L | Off-tackle right `run_ot_right` | Outside right (edge) `run_edge_right` | |
| P | Short (0–9 air yds) `dropback_short` | Intermediate (10–19) `dropback_mid` | Deep shot (20+) `dropback_deep` |
| A | PA short (0–9) `pa_short` | PA intermediate (10–19) `pa_mid` | PA deep shot (20+) `pa_deep` |
| N | Screen `screen` | | |
| O | RPO, handed off or kept `rpo_run` | RPO, thrown `rpo_throw` | |

Cycles wrap (PPPP is back to Short). The chosen line shows the name plus a small hint `tap P for Intermediate (10–19)` whenever the cycle has more than one entry and no outcome is set. The pressed key's button gets `.on` (filled in its family color); R lights the K button.

### 1.5 Outcome resolution (what the chosen line says and what gets logged)

| Pick | + I (incomplete) | + S (sack) | + C (scramble) |
| --- | --- | --- | --- |
| P, PP, PPP | "<depth name>, incomplete" (depth kept) | "Dropback pass, sack" | "Dropback pass, scramble" |
| A, AA, AAA | "PA <depth>, incomplete" | "Play-action, sack" | "Play-action, scramble" |
| N | "Screen, incomplete" | "Dropback pass, sack" | "Dropback pass, scramble" |
| O | "RPO, thrown, incomplete" | "Dropback pass, sack" | "Dropback pass, scramble" |
| OO | "RPO, thrown, incomplete" | "RPO, sack" | "RPO, scramble" |
| J, K, L | "Dropback pass, incomplete" | "Dropback pass, sack" | "Dropback pass, scramble" |
| nothing | "Dropback pass, incomplete" | "Dropback pass, sack" | "Dropback pass, scramble" |

All verified on screen. The server's `_resolve_call` makes the same conversions, so the chosen line always matches the logged name. A sack or scramble drops the depth (the leaf becomes null).

### 1.6 Flag mode (panel open, feed off)

Opening the panel focuses Yards, so digits go into the Yards box (DPI and "Other" read it).

| Key | Code | Shown as | Against | Summary shown | Enforcement |
| --- | --- | --- | --- | --- | --- |
| O | `OFFSIDE` | Offside / encroachment / neutral zone | defense | 5 yds, pre-snap | 5, pick ignored |
| H | `DH` | Defensive holding | defense | 5 yds, auto 1st | 5 + 1st |
| C | `IC` | Illegal contact | defense | 5 yds, auto 1st | 5 + 1st |
| D | `DPI` | Defensive pass interference | defense | ball at the spot, auto 1st (Yards = past the line) | spot = Yards box, 1st |
| R | `RTP` | Roughing the passer | defense | 15 yds, auto 1st | 15 + 1st |
| U | `URD` | Unnecessary roughness | defense | 15 yds, auto 1st | 15 + 1st |
| M | `FM` | Face mask | defense | 15 yds, auto 1st | 15 + 1st |
| Z | `12D` | Too many men | defense | 5 yds, pre-snap | 5, pick ignored |
| F | `FS` | False start | offense | 5 yds, pre-snap | 5, pick ignored |
| G | `DOG` | Delay of game | offense | 5 yds, pre-snap | 5, pick ignored |
| E | `ILF` | Illegal formation / shift | offense | 5 yds | 5 |
| L | `OH` | Offensive holding | offense | 10 yds | 10 |
| P | `OPI` | Offensive pass interference | offense | 10 yds | 10 |
| B | `IBB` | Illegal block in the back | offense | 10 yds | 10 |
| I | `IG` | Intentional grounding | offense | 10 yds, loss of down | 10, down + 1 |
| N | `URO` | Unnecessary roughness | offense | 15 yds | 15 |
| W | `OFFSET` | Offsetting | nobody | replay the down | nothing moves |
| mouse only | `OTHER_D` | Other on TB | defense | yards from the Yards box | Yards box; automatic 1st only if "automatic 1st down" is ticked, otherwise a 1st only when the yards reach the line |
| mouse only | `OTHER_O` | Other on DAL | offense | yards from the Yards box | Yards box, never a 1st down |

- Esc or X closes the panel and keeps the pick.
- Every other printable key except digits and `-` is swallowed. Enter is swallowed (it never logs a play in flag mode).
- In flag mode U, I, C, F, P, L, N, O and R are flags, not their normal meanings. Verified: U applied "Unnecessary roughness on defense", not undo.
- The flag button shows an active state while the panel is open; clicking it toggles the panel.
- Labels drop " on defense" and " on offense"; team names in headings come from `game.opponent` / `game.offense` ("On TB (defense)", "On DAL (offense)", "Other on TB", "Other on DAL"). The panel is built once, on first open.

### 1.7 Feed mode (ESPN live on)

| Key | Request | Server meaning (`retag_last`) |
| --- | --- | --- |
| A | `POST /api/retag {"key":"A"}` | Last pass becomes play-action (keeps the depth when known and there was no outcome) |
| P | `{"key":"P"}` | Back to a plain dropback (same depth rule) |
| N | `{"key":"N"}` | Screen. Refused on a sack or scramble: "N doesn't fit a pass." |
| O | `{"key":"O"}` | Pass becomes "RPO, thrown"; run becomes "RPO, handed off or kept" |
| K, R | `{"key":"K"}` / `{"key":"R"}` | Run becomes inside run |
| J | `{"key":"J"}` | Run becomes off-tackle left, or outside left (edge) if it already was off-tackle left |
| L | `{"key":"L"}` | Same on the right |
| U | `POST /api/undo {}` | Undo |
| anything else | nothing | X, Esc, Enter, T, F, I, S, C and digits do nothing (verified: no requests) |

Retag never flips run and pass, so his memory is unchanged; the row is rescored from its stored prediction tree, renamed and marked `retagged: true`. A key that doesn't fit gives a red toast "J doesn't fit a pass." or "A doesn't fit a run.". No logged play: "No logged play to retag yet.".

### 1.8 Keys inside specific inputs

| Where | Key | Behavior |
| --- | --- | --- |
| Situation strip fields | focus | Selects the whole value |
| | Enter | Blur (saves if the value changed), then focus Yards if a drive was active before the save |
| | Tab | Native focus move; the blur saves |
| | Esc | Meant to revert: sets the value to "" and blurs, relying on the change handler to re-render. Works only if the user typed (gap G1) |
| Yards | focus | Selects the value |
| Shorthand bar `#cmd` | Enter | Runs the command (the global Enter shortcut does not fire) |
| ESPN id `#feedEvent` | Enter | Blurs; does not start or replay anything |

---

## 2. Controls and the endpoints they call

### 2.1 Endpoints (`app.py`)

Every POST returns the full state from `view()` with status 200, or the full state plus `error` with status 400. The client never looks at the status code, only at `error`.

| Method and path | Body the UI sends | Engine call | Notes |
| --- | --- | --- | --- |
| `GET /` | | `static/index.html` | |
| `GET /api/state` | | `engine.view()` + `feed` (incl. `event_id`) | Computes a fresh prediction on every call |
| `GET /api/version` | | `{version, feed:{state, detail, last_poll, last_play, plays_logged, skipped, on}}` | No `event_id` |
| `POST /api/situation` | one of `{qtr}`, `{clock}`, `{score_off}`, `{score_opp}`, `{down}`, `{togo}`, `{spot:"<TEAM> <n>"}` | `set_situation` | Also accepts `side` + `yard` (unused). Strings trimmed, empty values dropped |
| `POST /api/play` | `{yards, td, turnover, leaf}` or `{yards, td, turnover, family:"dropback"}`, plus `outcome` when set | `record_play` | Also accepts legacy `call` R/P/SC/S and `penalty` (unused) |
| `POST /api/penalty` | `{code, yards: int or null, auto_first: bool, play?: {leaf, family, outcome}}` | `apply_penalty` | `yards` is the Yards box (0 becomes null) |
| `POST /api/retag` | `{key}` | `retag_last` | |
| `POST /api/drive` | `{end: "punt" or "fg" or "fg_miss" or "half"}` | `end_drive` | Also `{yard, side, qtr, clock, score_off, score_opp}` starts a drive (unused) |
| `POST /api/score` | | `add_score(team, pts)` | Unused by the UI |
| `POST /api/command` | `{text}` | `command` | Shorthand, all or nothing, one undo step |
| `POST /api/undo` | `{}` | `undo` | Never 400 |
| `POST /api/reset` | `{}` | `reset` + `feed.forget()` | Never 400. Does not stop the feed (gap G9) |
| `POST /api/feed` | `{on: bool, event_id: string or null}` | `feed.start` / `feed.stop` | Sets the message |
| `POST /api/feed/replay` | `{event_id: string or null}` | backup state file, reset, forget, one full poll | |
| `GET /api/export.csv` | | `export_csv` | `text/csv`, attachment `shadow_caller_log.csv` |

### 2.2 Control table

| Control (hook) | Trigger | Request | On success | On error |
| --- | --- | --- | --- | --- |
| Undo `#undoBtn` (title "Undo (U)") | click, or U | `POST /api/undo {}` | toast "Undid the last action." or "Nothing to undo." | |
| Export CSV `a[href="/api/export.csv"]` | click | plain GET link | browser download | |
| Reset game `#resetBtn` | click, then `confirm("Clear every snap logged for this game?")` | `POST /api/reset {}` | toast "Set the start of Dallas's first drive." | |
| ESPN live `#feedBtn` | click | `POST /api/feed {on: !feed.on, event_id: <id box trimmed> or null}` | toast "ESPN live feed on. Plays log themselves; retag play-action, screen or RPO." / "ESPN live feed off. Enter plays by hand." | red toast, e.g. "No DAL game on ESPN today. Enter the ESPN event id." |
| ESPN game id `#feedEvent` | type, Enter blurs | none | filled from `feed.event_id` on every render unless focused; placeholder "today's game" | |
| Replay this game `#replayBtn` | click, then `confirm("Rebuild the game log from ESPN game <id or (today's)>? The current log is backed up first.")` | `POST /api/feed/replay {event_id: <box> or null}` | toast "Replayed ESPN game 401872980: 55 DAL plays logged. Old game backed up in data/." | red toast (e.g. "Enter the ESPN event id to replay.") |
| Qtr, Clock, both scores, Down, To go, Ball on (`#iQtr #iClock #iOff #iOpp #iDown #iTogo #iYard`) | `change` (Enter, Tab or blur after an edit) | `POST /api/situation` with one field (2.3) | silent, except toast "Drive N started." when this save started a drive | red toast, field keeps the typed value with a red underline (`.bad`) |
| Side chip `#iSide` (shows team + ⇄) | click | `POST /api/situation {spot:"<other team> <n>"}` | focus Ball on and select it | red toast |
| Punt, FG good, FG missed, Half over (`[data-end]`, only while a drive is active) | click | `POST /api/drive {end}` | toast (catalog 3.10) | |
| Play keys `.key[data-k]` (J K L P A N O) | click | none | same as the key: tap, cycle, focus Yards | |
| Result keys `.key[data-out]` (incomplete, sack, scramble) | click | none | same as I, S, C | |
| Flag `#flagBtn` | click | none | toggles the panel | red toast when no drive |
| Flag buttons `#flagPanel [data-pen]` | click, or the letter | `POST /api/penalty` | panel closes, pick cleared, `#otherFirst` unticked, Yards focused | red toast, panel stays open, pick kept |
| Close (Esc) `#flagClose` | click | none | closes the panel | |
| automatic 1st down `#otherFirst` | checkbox | sent as `auto_first` with every flag; only `OTHER_D` uses it | | |
| Prediction rows `.leaf[data-leaf]` (title "Click to log this as the play he called") | click | none | picks that play as if its key was tapped the right number of times; focus Yards | |
| Yards `#yards` (default `0`, numeric keypad) | type | | | |
| Touchdown `#fTD`, Turnover `#fTO` | click, or T / F | sent with the play | unticked after a logged play or flag | |
| Log play `#logBtn` | click, or Enter | `POST /api/play` | pick cleared, Yards `0` focused | red toast, pick kept |
| Shorthand `#cmd` + Run `#cmdBtn` | Enter or click | `POST /api/command {text}` (nothing when empty) | box cleared, toast "Done: ..." | red toast, text kept |
| Retag buttons `#lastPlay [data-retag]` | click | `POST /api/retag {key}` | toast "Last play retagged: <name>." | red toast |

### 2.3 Situation strip

Display (from `state.sit`): `qtr`; `clock_str`; `score_off`; `score_opp`; `down`; To go shows `G` when `togo >= yardline_100`, else `togo`; Ball on shows `100 - yardline_100` on the offense's side, `yardline_100` on the opponent's. Side rule: own side when `yardline_100 > 50`, or exactly 50 unless the chip was last switched to the opponent at the 50 (client variable `sideAtFifty`). The chip is ink-filled for own side, white (`.opp`) for the opponent's, title "Ball on DAL's own side. Click to switch." / "Ball on TB's side. Click to switch.". Labels "DAL – TB" come from `game.offense` / `game.opponent`. `est.` (title "Estimated from snaps; type the real clock") shows when `sit.clock_estimated`. Strip note: "Click any number and type; Enter or Tab saves. Click the team to switch sides of the field. Clock takes 8:41 or 841; G in To go means goal."

Payloads: `{qtr: v}`, `{clock: v}`, `{score_off: v}`, `{score_opp: v}`, `{down: v}`, `{togo: v}`, `{spot: "<chip text> <v>"}` (for example `{"spot":"DAL 25"}`, verified). An empty value sends nothing and re-renders.

Server rules (verified):

- Numbers: `int(float(v))`, otherwise "'x' isn't a number". Scores clamp at 0 (`-3` becomes 0).
- Down 1 to 4 ("Down must be 1 to 4"); quarter 1 to 5 ("Quarter must be 1 to 4 (5 = overtime)"); To go at least 1 ("To go must be at least 1"); yard number 1 to 50 ("Yard line must be 1 to 50"); ball between the goal lines.
- To go `G`, `g`, `goal` means goal to go. To go is always clamped to `[1, yardline_100]` (To go 10 at TB 6 becomes 6 and shows `G`).
- Clock (`parse_clock`): `8:41`, `8.41`, `841`, `1500`, `12` (whole minutes), `5`. Seconds under 60, at most 15:00. Errors: "Clock like 8:41 or 841, got '8:4'" and "'16:00' isn't a game clock (max 15:00)". Typing a clock clears `clock_estimated`.
- Spot: side letters must match the start of one team abbreviation, otherwise "Field side 'DALD' isn't DAL or TB".
- Starting a drive: any of down, to go or spot set while no drive is active starts one (down defaults to 1, to go to 10), `drive_n + 1`, memory `prev` cleared, message "Drive N started.". That includes clicking the side chip while off the field (verified). Otherwise the message is "Saved." and no toast shows.

### 2.4 Manual play entry

Client selection `sel = {k, i, out}`; the picked leaf is `state.keys[k][i % length]`. Log play is enabled only when `drive_active` and (a leaf or an outcome is picked).

Payload: `{yards: parseInt(Yards) or 0, td: #fTD, turnover: #fTO}` plus `leaf` (or `family: "dropback"` when only an outcome is picked) plus `outcome` when set. Verified: K, 3, Enter sends `{"yards":3,"td":false,"turnover":false,"leaf":"run_inside"}`.

Server effects (`record_play`, verified):

- Needs an active drive ("No Dallas drive in progress. Start a new drive first.").
- Sack yards become negative; incomplete forces 0.
- Yards reaching the end zone without a turnover mark a touchdown and cap the yards at the distance.
- Touchdown: +7 ("PAT assumed"), drive ends. Turnover: drive ends. Gain at or past the line: 1st & `min(10, yardline)`. 4th down short: turnover on downs, drive ends. Otherwise down + 1 and to go minus yards. The ball never goes past the own 1 (`yardline_100` capped at 99; safeties are not modelled).
- Memory update (value, stickiness, explosive at 20+ yards, sack) and `snap_n + 1`.
- Clock estimate: incomplete 6 s; otherwise 30 s for a pass or 34 s for a run when the clock is above 2:00 or it is Q1 or Q3; else 7 s. Sets `clock_estimated` (shows `est.`).
- Messages: "Logged.", "First down.", "Touchdown, +7 (PAT assumed; fix the score if needed). Waiting for the next drive.", "Turnover. Waiting for the next Dallas drive.", "Turnover on downs. Waiting for the next Dallas drive.".

### 2.5 Flags

Flag payload: `{code, yards: parseInt(Yards) or null, auto_first: #otherFirst}` plus `play: {leaf, family, outcome}` when something is picked (`family` is `"dropback"` when only an outcome is picked, else null).

Panel note at open time: with a pick, "Your pick (<chosen text without the tap hint>) is wiped out but still scored as his call. Pre-snap fouls ignore it."; without, "No play picked: the flag just moves the ball.". Panel hint: "Flag on the play you picked: that play is wiped out but still counts as his call for scoring. Flag after a play that stands (late hit): log the play first, then flag. DPI and Other use the Yards box (for DPI, yards past the line). Half the distance applies near the goal line."

Enforcement (`apply_penalty`, verified):

- Needs an active drive ("No Dallas drive in progress. Type the ball spot first.").
- DPI and Other need Yards above 0: "Type the yards first: how far past the line for DPI, or the penalty yardage.".
- With a pick and a foul that is not pre-snap: a nullified log row named "<play> (no play: <label in lower case>)" (offsetting: "<play> (no play, flag)"), scored like a snap but not fed to his memory, Yds shown as `flag`.
- DPI: ball at line minus Yards (never inside the 1), 1st & `min(10, spot)`.
- Defense: half the distance when the foul is more than half the way to the goal; first down when the foul carries one or the gain reaches the line; goal to go stays goal to go.
- Offense: half the distance toward the own goal; to go grows by the yards lost; the down is replayed, except intentional grounding (down + 1, and on 4th down "Turnover on downs").
- Messages, for example (from 1st & 10 at DAL 25 unless noted): "Defensive holding: 5 yards, automatic first down. 1st & 10 at DAL 30.", "False start: back 5 yards. 1st & 15 at DAL 20.", "Roughing the passer: 4 yards (half the distance), automatic first down. 1st & Goal at TB 4.", "Penalty on DAL: back 10 yards. 1st & 20 at DAL 40.", "Offsetting penalties, replay the down. 2nd & 30 at DAL 30.". A logged pick adds " His call still counts for scoring.".

### 2.6 Shorthand bar (`command()`)

Placeholder: `Shorthand: JJ 6 | 2&4 D44   ·   PP 0 INC   ·   PPP 35 TD   ·   X DH   ·   X DPI 25   ·   new D25`. Segments split on the pipe character and run in order, all or nothing: a bad segment changes nothing and one Undo reverts a whole good line. Success message: "Done: " plus the segments.

| Segment | Meaning | Verified example |
| --- | --- | --- |
| `J JJ K R L LL P PP PPP A AA AAA N O OO` + yards | Play by tap code; last signed number is the yards | `JJ 6` logs "Outside left (edge)", 6 |
| ... `INC` | Incomplete | `PP 0 INC` logs "Intermediate (10–19), incomplete" |
| ... `TD` | Touchdown | `PPP 35 TD` |
| ... `F` or `INT` | Turnover | `K 3 F` logs "Inside run (A/B gap)" with turnover |
| `S n` / `SC n` | Sack (yards made negative) / scramble | `S 7` logs "Dropback pass, sack", -7 |
| `I` | Interception: a pass with no type, 0 yards, turnover | logs "Pass" (log shows "Pass, turnover" with dashes) |
| `X` or `FLAG` | Offsetting | |
| `X <code> [n]` | Codes OFF ENC NZI DH IC DPI PI RTP URD UR FM 12 FS DOG DELAY ILF OH HOLD OPI IBB IG URO OFFSET | `X DPI 28` |
| `X <team> n [1ST or AUTO]` | Other on that team | `X TB 15 1ST`, `X DAL 10` |
| `new <spot>` | New drive, 1st & 10 (or goal) | `new D25`, `new T8`, `new 50`, `new 25` (bare number keeps the current side) |
| `<down>&<n or G> <spot>` | Down, distance, spot (starts a drive when off the field) | `2&4 D44`, `2 & G T5` |
| `DAL 14 TB 10` (either order) | Both scores | |
| `Q<1-5> M:SS` | Quarter and clock (colon form only) | `Q2 1:58`; `Q2 960` is "Didn't understand 'Q2 960'" |
| `punt`, `fg`, `fg miss`, `half` | End the drive | `fg` adds 3 even with no drive active (gap G22) |

Shorthand flags never attach a picked play (no nullified row). Errors: "Didn't understand 'KK 3'", "Unknown flag 'ZZ'. Try X DH, X FS, X OH, X DPI 25, X TB 5", plus the spot and range errors from 2.3.

### 2.7 ESPN feed and Replay

- Feed on: `feed.start(event_id)` uses the id box, else the last id the feed used (initially `config.GAME["espn_event"]`), else looks up today's game for the offense (online only). A background thread polls every 4 s; each poll saves the raw summary and applies unseen plays in order under the app lock. Plays it can't apply are skipped and reported in `feed.skipped` instead of stopping the feed. Network errors set `feed.state = "error"` and keep retrying.
- Replay: copies `data/live_state.json` to `data/live_state.backup-YYYYmmdd-HHMMSS.json`, resets the game and the seen-id list, applies every play of the event once, sets the message. It does not turn the feed on or off.
- In the sandbox (offline) turning the feed on with event 401872980 applies the whole saved game on the first poll (59 rows, verified), which is a handy "feed on" state for tests.

### 2.8 Retag

Covered in 1.7. It works by key, by the buttons in the last-play panel, and through `POST /api/retag` directly. It edits the newest non-nullified row of any source (gap G19).

---

## 3. Information displayed

### 3.1 Header

`<title>` "Shadow Play-Caller". H1 "Shadow Play-Caller". `#gameLabel` = `game.label` ("Buccaneers at Cowboys, Thursday Night Football, Oct 8"). `#whoLabel` = "Modelling " + `profile.caller` + " (" + `profile.team` + " offense)".

### 3.2 Feed bar

| State | Button `#feedBtn` | Status line `#feedStatus` |
| --- | --- | --- |
| `feed.on` false | "ESPN live: off", grey dot | "Off: enter plays by hand, or turn it on and plays log themselves." |
| on, `state` "starting" or "live" | "ESPN live: on", ink pill, red dot with glow | "Updated " + `last_poll` (or "…") + " · **Last:** " + `last_play` (escaped) + (when `skipped`) " · **Skipped, enter it by hand:** " + `skipped` (escaped) |
| on, `state` "error" | "ESPN live: retrying", amber dot (`.err`) | "Can't reach ESPN (" + `detail` + "). Still trying every few seconds." |

`last_play` is ESPN's text cut to 160 characters ("END GAME" after a finished game). `skipped` is the play text cut to 90 characters plus " (" + error + ")". With the feed off the skipped note is hidden even if set.

### 3.3 Field graphic

SVG `viewBox 0 0 1200 120`, full width, `role="img"`, `aria-label="Field position"` (static). End zones of 100 units each: offense abbreviation on the left (rotated -90), opponent on the right (rotated 90). The offense always drives left to right. Alternating 10-yard turf stripes, yard lines every 10 (heavier at both goal lines and midfield), numbers 10 20 30 40 50 40 30 20 10 near the bottom. With a drive active: line of scrimmage at `x = 100 + (100 - yardline_100) * 10` (light blue, 3 units), line to gain at `min(1100, x + togo * 10)` (yellow, 4 units, so goal to go puts it on the goal line), a brown football at the spot, and the yellow label "line to gain". No drive: bare field, no markers. Nothing about the previous play is drawn.

### 3.4 Drive info and end buttons

`#driveInfo`: drive active "Drive " + `drive_n` + ", snap " + (`memory.snap_n` + 1) + " of the game"; otherwise, in bold ink, "<OFF> off the field. Type where they get the ball in Ball on.". `memory.snap_n` counts snaps fed to memory, so nullified rows don't advance it. End buttons (Punt, FG good, FG missed, Half over) show only while a drive is active.

### 3.5 Prediction (hero), from `state.prediction`

No drive (`prediction` null): heading "<OFF> is off the field", text "When <OFF> gets the ball, click **Ball on** above and type the spot, like **D 25**. The drive starts and predictions come back. Update the score and clock the same way." (the "D 25" advice fails in the Ball on field, gap G3; the copy stays the same with the feed on, gap G24).

With a drive:

| Element | Source and format |
| --- | --- |
| "Most likely call" | `top[0].name` + `pct(top[0].p)` (bold) |
| Runners-up | "Then **`top[1].name`** `pct` · **`top[2].name`** `pct`" |
| Flag pill (title "Pass vs run against the league") | `flag` with the first letter capitalized: "TILT PASS", "TILT RUN" (filled blue / amber), "Lean pass", "Lean run" (outlined), "No edge" (grey). TILT when abs(p - p_league) is at least 0.15, lean at 0.08 (`config.TILT`, `config.LEAN`) |
| Pass/run bar (`aria-label="Pass versus run"`) | blue width `p`, amber the rest; dashed marker at `p_league` (title "League X%") |
| Bar labels | "Ball thrown or dropback `pct(p)`" · "League `pct(p_league)` (dashed)" · "Handed off or kept `pct(1 - p)`" |
| Five family columns | `families[]` in descending `p` (server sorted): `name` + arrow, big `pct(p)` in the family color (run amber; dropback, play-action, screen blue; RPO purple), "League `pct(p_league)`" |
| Leaves under each family | `leaves[]` in descending `p`: `name` + arrow, `pct1(p)` (one decimal under 10%), 5 px bar of width `min(100, p / top[0].p * 100)%`. Clickable. The leaf `p_league` is not shown as text; it only drives the arrow |
| Arrows | `hot === "up"` ▲ green (title "Well above the league"), `"down"` ▼ red (title "Well below the league"). Hot = at least 4 points and at least 1.3 times the other side (`HOT_PTS 0.04`, `HOT_RATIO 1.3`). Verified: "Run ▼", "Intermediate (10–19) ▲", "Deep shot (20+) ▼" |
| Legend | "▲ ▼ = at least 4 points and 30% above or below the league for this exact situation. Bars are scaled to the top pick. Click a play to pick it as what he called." |
| Why line, item 1 | x = `round((p_habits - p_league) * 1000) / 10`, shown "+x" or "x" then "pass pts from his habits here" (blue when 0 or more, amber when negative) |
| Why line, script | while `script` (snaps 1 to 15): a U+2014 dash, then "Opening script: memory switches on after snap " + `memory.script_plays` |
| Why line, memory | one item per `memory_parts[]`: "+pts" or "pts" then `term`. Terms: "Value gap (what's been working)", "Repeat last call (stickiness)", "After a failed play", "After a 20+ yard gain", "After a sack". Only nonzero inputs appear; none during the script. Verified example: +16.5 habits, +0.6 value gap, +9.9 stickiness, -4.9 after a failed play |

`pct(x)` = `Math.round(x * 100) + "%"`. `pct1(x)` = one decimal under 10%, else rounded.

### 3.6 Entry panel

- Dimmed to opacity 0.5 when no drive is active and the feed is off.
- Manual pad (feed off): heading "What did he call?", rows Run / Pass / RPO / Result. Button texts (key, name, hint): J "Left" "JJ: outside edge"; K "Inside" "A/B gap (R works too)"; L "Right" "LL: outside edge"; P "Dropback" "tap again: short, mid, deep"; A "Play-action" "tap again: short, mid, deep"; N "Screen"; O "RPO" "OO: he threw it"; I "Incomplete" "after P, A, N or OO"; S "Sack" "yards lost"; C "Scramble" "yards gained"; X "Flag" "penalty menu" (yellow).
- Chosen line `#chosen`: placeholder "Pick the play" (muted), else the resolved name (1.5) plus the tap hint; "Yards" box; "Touchdown (T)"; "Turnover (F)"; "Log play" button.
- Last-play panel `#lastPlay` (feed on only): no ESPN row yet: "Waiting for the first <OFF> play" / "Plays appear here a few seconds after ESPN posts them.". Otherwise the newest log row with `source === "espn"` and not nullified: heading "Last play from ESPN", big `name` + ", TD" if `td` + ", turnover" if `turnover`, small "`yards` yds" + " · retagged" if `retagged`, then `feed_text` (ESPN's raw text, escaped), then retag buttons: pass rows A "Play-action", N "Screen", O "RPO, thrown", P "Plain dropback"; run rows O "RPO, handed off", J "Left (again: edge)", K "Inside", L "Right (again: edge)". The button matching the row's `family` gets an ink border (`.cur`); J/K/L never do.
- Hint `#entryHint`: feed off "Press the play key (tap again to cycle), type yards, Enter. I incomplete, X flag, Esc clears, U undoes. Down, distance and field position advance on their own."; feed on "ESPN logs each play, down, distance, spot, clock and score. It can't see play-action, screens or RPOs: press A, N or O to fix the last play. P undoes that, J/K/L change the run gap, U undoes."
- With the feed on, the manual pad and flag panel are hidden; the shorthand bar stays visible and working.

### 3.7 Scorecard (`state.metrics`), heading "Tonight's scorecard"

`metrics.n` 0: "Scores appear after the first logged snap.". Otherwise up to three groups, each sub-heading carrying its count:

| Group (shown when) | Value | Label |
| --- | --- | --- |
| "Specific play (`granular.leaf_n` snaps)" (leaf_n > 0) | `leaf_top1` of `leaf_n` | Top pick was right |
| | `leaf_top3` of `leaf_n` | Actual play in his top 3 (league `leaf_top3_league`) |
| | `leaf_logloss` (2 dp, green if below league else red) | His model, log loss |
| | `leaf_logloss_league` (2 dp) | League, log loss |
| "Play type (`fam_n` snaps)" (fam_n > 0) | `fam_top_hits` of `fam_n` | Most likely type was right |
| | `fam_logloss` (2 dp, green or red) | Log loss (league `fam_logloss_league` 2 dp) |
| "Pass vs run (`n` snaps)" (always) | `logloss_model` (3 dp, green or red) | His model, log loss (league `logloss_league` 3 dp) |
| | `pct(acc_model)` | Called right (league `pct(acc_league)`) |
| | `tilt_hits` of `tilt_n`, or "0" when `tilt_n` is 0 | Tilts that came true |
| | `pct(dropback_rate)` | Pass rate tonight |

Note under it: "Lower log loss is better. One game is a pipeline test, not proof.". `n` counts every row including nullified ones; `leaf_*` counts rows whose specific play is known; `fam_*` rows whose type is known. `brier_model` and `brier_league` are computed but not shown. Values after replaying the saved game with the shipped models: 32 of 59; 47 of 59 (league 48); 1.62 / 1.62; 45 of 59; 0.72 (league 0.69); 0.421 (league 0.424); 85% (league 81%); 1 of 2; 75%.

### 3.8 Tendencies (`state.profile`)

- Title `#profTitle`: last word of `profile.caller` + "'s tendencies" ("Schottenheimer's tendencies"; "His tendencies" before the first render).
- "Pass vs run terms": SVG forest plot (`aria-label` "His pass-run tendency terms with 90 percent intervals"), one row per `profile.coefs` entry except `intercept` (9 rows), text `label`, horizontal interval `lo` to `hi` and dot at `est`, x clamped to -1.2 to 1.2, dashed zero line, blue when `est` is 0 or more, amber otherwise; filled and opaque when the interval excludes zero, hollow and faded otherwise; axis words "more run" / "more pass". Row order is the JSON key order, which Flask sorts alphabetically (gap G14).
- Note: `n_snaps` + " snaps, " + `n_games` + " games (" + `seasons` joined by "–" + "). Filled dots: 90% interval excludes zero." ("1,351 snaps, 21 games (2025–2026).")
- "His play-type mix vs expected" table (when `profile.granular`): one row per `granular.family_rates` key (alphabetical: Dropback pass, Play-action, RPO, Run, Screen): `family_names[key]`, `pct(his)`, "exp. " + `pct(league_expected)`.
- "Held-out check: his top pick for the specific play was right `pct(cv.specific_play.top1_his)` of the time; the actual play was in his top 3 `pct(cv.specific_play.top3_his)` of the time (`cv.specific_play.n` snaps)." (38%, 66%, 1,270).

### 3.9 Play log (`state.log`, newest first), heading "Play log"

Empty: "No snaps yet. Each logged play shows his top pick next to what he called.". Otherwise one table, every row, no paging:

| Column | Value |
| --- | --- |
| # | `snap` (repeats on nullified rows, gap G15) |
| Time | "Q" + `qtr` + " " + `clock` (game clock at the snap) |
| Situation | ordinal `down` + " & " + `togo` + " at " + spot ("DAL 36", "TB 47", "50"). Goal to go shows the number (gap G16) |
| His top pick | `leaf_names[top_leaf]` + " " + `pct(top_leaf_p)`; legacy rows without `top_leaf`: "Pass" or "Run" + `pct(max(p, 1 - p))` |
| Actual | `name` (legacy fallback from `call`: R Run, P Pass, SC Scramble, S Sack) + ", TD" + ", turnover" |
| His % on it | `pct1(leaf_p)`, else `pct1(fam_p)`, else a U+2014 dash |
| League % | `pct1(leaf_p_league)`, else `pct1(fam_p_league)`, else the dash |
| Rank | `leaf_rank`: 1 green bold, 2 or 3 plain, 4+ red bold; null shows the dash |
| Yds | `yards`, or `flag` when `nullified` |

### 3.10 Toasts and the message catalog

The page has no persistent message area. Messages appear only as toasts (behavior in 4.5). Successful POSTs toast `state.message`; situation saves toast only when a drive starts; polls never toast (gap G12).

| Source | Message |
| --- | --- |
| Fresh or reset | "Set the start of Dallas's first drive." |
| Strip save | "Drive N started." (toasted) or "Saved." (not toasted) |
| End drive | "Punt. Waiting for the next Dallas drive." / "Field goal good (+3). Waiting for the next Dallas drive." / "Field goal missed. Waiting for the next Dallas drive." / "End of half. Waiting for the next Dallas drive." |
| Play | "Logged." / "First down." / "Touchdown, +7 (PAT assumed; fix the score if needed). Waiting for the next drive." / "Turnover. Waiting for the next Dallas drive." / "Turnover on downs. Waiting for the next Dallas drive." |
| Flag | "<label>: <n> yards[ (half the distance)][, automatic first down]. <situation>.", "<label>: back <n> yards[, loss of down]. <situation>.", "Offsetting penalties, replay the down. <situation>." plus " His call still counts for scoring." when a pick was logged |
| Retag | "Last play retagged: <name>." |
| Undo | "Undid the last action." / "Nothing to undo." |
| Shorthand | "Done: <segments>" |
| Feed | "ESPN live feed on. Plays log themselves; retag play-action, screen or RPO." / "ESPN live feed off. Enter plays by hand." |
| Replay | "Replayed ESPN game <id>: <n> DAL plays logged. Old game backed up in data/." (n counts logged snaps, not nullified rows: 55 for 59 rows) |
| Set by the feed, never shown | "Drive N started (ESPN)." and "No play: <foul> on <TEAM>. <situation>. His call still counts for scoring." |

Errors (red toast): every validation message quoted in section 2, plus "Pick what he called first.", "Unknown play 'x'", "Unknown penalty 'x'", "No logged play to retag yet.", "No DAL game on ESPN today. Enter the ESPN event id.", "Enter the ESPN event id to replay.", and raw exception text from ESPN fetches.

Confirm dialogs: Reset "Clear every snap logged for this game?"; Replay "Rebuild the game log from ESPN game <id or (today's)>? The current log is backed up first.".

### 3.11 Restart screen

If `/api/state` has no `keys` (old server), `main` is replaced by "Restart the server to finish the update" / "In Terminal press Ctrl+C, run **bash start.sh**, then refresh this page. Your logged snaps are saved." The rail stays as empty headings. Verified with an intercepted response.

---

## 4. Refresh, errors, toasts and focus

### 4.1 Load

`GET /api/state` once, then `render()`. No toast. If that request fails the page stays an empty skeleton forever: one attempt, and the poll does nothing while there is no state (gap G11).

### 4.2 Polling

- Every 2000 ms: `GET /api/version`. If `version`, `feed.last_poll`, `feed.state` or `feed.on` differs from the last full state, `GET /api/state` and `render()`, without a toast.
- Feed off and idle: verified 3 version checks and 0 state fetches in 6.5 s.
- Feed on: `last_poll` changes on every 4 s server poll, so the full state is refetched about every 4 s even when nothing happened (verified 5 version checks and 3 state fetches in 10.5 s).
- A change made by another client (another tab, curl, the feed thread) shows up on the next tick (verified 883 ms).
- `version` goes up on every engine save, but restarts at 1 after Reset or Replay, and an Undo restores the previous number (gap G8). Compare with "not equal", never "greater than".
- Poll errors are swallowed by an empty `catch`.

### 4.3 What a render touches

`render()` redraws everything from the state: labels, field, strip, hero, chosen line, feed bar, last-play panel, entry opacity, scorecard, tendencies, log. Guards:

- `setVal` never overwrites the focused strip field and removes the red underline from fields it does write.
- `#feedEvent` is not overwritten while focused.
- `#yards`, the checkboxes, the shorthand box and the client pick are never touched by a render, so a background refresh keeps what the user is entering.
- The flag panel stays open across renders while `flagMode` is true; with the feed on it is hidden but `flagMode` is kept.
- Field, hero, last-play panel, scorecard, tendencies and log are rebuilt with `innerHTML` each time, so their click handlers are re-bound and focus inside them is lost.

### 4.4 Error handling

- 400 responses: `api()` sets the state from the body (the server's current state), re-renders, and shows `error` in a red toast. Strip saves additionally keep the rejected text in the field with the `.bad` red underline (`renderAllBut`).
- Network failures and non-JSON responses: no toast, an uncaught promise rejection in the console (verified: "TypeError: Failed to fetch" and "SyntaxError: Unexpected token '<'" on an HTML 500). No offline indicator anywhere.

### 4.5 Toast

`#toast`, `role="status"`, `aria-live="polite"`, fixed bottom center, ink background (red with `.err`), max 90vw. Shown by setting class `toast show`; hidden after 2600 ms by resetting the class (opacity transition 0.2 s). A new toast replaces the text and restarts the timer. The text stays in the DOM after hiding, so tests should check the `show` class.

### 4.6 Focus

- Nothing is focused on load; shortcuts work immediately.
- Tapping a play or outcome, clicking a prediction row, opening the flag panel, logging a play and applying a flag all focus and select Yards.
- Enter in a strip field blurs it, then focuses Yards when a drive was already active.
- Clicking the side chip focuses and selects Ball on.
- Enter in the ESPN id box blurs it.
- After a toolbar or drive-end button click, focus stays on that button.
- After a retag button click the button is re-rendered away and focus falls to `body`.
- Tab order is the DOM order; no `tabindex` anywhere. Prediction rows are not focusable (gap G18).
- Focus ring: `:focus-visible` 3 px yellow outline.

### 4.7 Layout and motion

See section 0 for breakpoints. Only CSS transitions exist: split bar widths (0.35 s), toast opacity (0.2 s). Nothing else animates. At 390 px the document is 597 px wide (gap G17).

---

## 5. Edge cases the current code handles

1. **No drive active.** `prediction` is null: off-field panel, bare field, end-drive buttons hidden, entry panel at opacity 0.5 (unless the feed is on), Log play disabled, X refused with a toast, Enter silently ignored, drive info shows the bold cue.
2. **Starting a drive from the strip.** Typing a down, a to go or a Ball on number, or clicking the side chip, while off the field starts drive N with 1st & 10 defaults and one "Drive N started." toast.
3. **Goal to go.** "G", "g" or "goal" in To go; To go clamped to the distance and shown as `G`; line to gain drawn on the goal line; first downs inside the 10 become goal to go; defensive fouls keep goal to go.
4. **Clock.** Five input formats; validated; estimated after each logged play with the deduction rules in 2.4 and marked `est.`; a typed clock or an ESPN clock clears the mark.
5. **The 50.** Ball on 50 is ambiguous, so the client remembers which side the chip was switched to (`sideAtFifty`) and the server takes "TB 50" and "DAL 50" as the same spot.
6. **Field position.** Ball on takes a side-relative number 1 to 50; the chip decides the side.
7. **Sacks and incompletions.** Sack yards are typed positive and stored negative; incomplete forces 0 yards on both client and server.
8. **Automatic touchdown.** Yards that reach the end zone become a touchdown with the yards capped to the distance; +7 assumes the PAT and the message says to fix the score if needed.
9. **Turnover on downs.** A 4th-down play short of the line, or intentional grounding on 4th down, ends the drive.
10. **Nullified plays.** A flag on a picked play (or ESPN "No Play") logs a row that is scored but kept out of his memory, named "(no play: ...)", Yds `flag`.
11. **Pre-snap fouls** ignore the pick (no row).
12. **Half the distance** near either goal line; DPI never puts the ball inside the 1.
13. **"Other" fouls** need yards above 0; only the defensive one can give an automatic first down.
14. **Shorthand** is all or nothing, one undo step per line, and keeps the text in the box on error.
15. **Feed resilience.** Unapplicable plays are skipped and named in the status line; fetch errors keep retrying with the reason shown; "starting" shows "Updated …"; each ESPN play id is applied once, and the seen list survives a restart.
16. **Retag safety.** Never flips run and pass; misfit keys and N on a sack or scramble are refused with a message.
17. **Typing is never clobbered** by background renders; rejected values stay visible with a red underline.
18. **Old server** without `keys` gets the restart screen instead of a broken page.
19. **Scores** clamp at 0; non-numbers are refused.
20. **Destructive actions** (Reset, Replay) need a browser confirm, and Replay backs up the state file first.
21. **ESPN text** (`last_play`, `skipped`, `feed_text`, last-play `name`) is HTML-escaped before display.
22. **Interception by shorthand** logs a pass with no type: dashes in the log, left out of the play-type and specific-play metrics.
23. **Undo with an empty history** says "Nothing to undo.".
24. **Reduced motion** turns transitions off.

## 5b. Gaps and quirks found while verifying (decide on purpose)

| # | Gap | Evidence |
| --- | --- | --- |
| G1 | Esc on a field the user did not type in blanks it instead of reverting: Chrome fires no `change` after a scripted value change, so the reverting render never runs. Same after a rejected value (blank, red underline stays). Esc after typing does revert. | Click Qtr, Esc: field empty (events: focus, blur, no change) |
| G2 | Re-typing the value already shown does nothing, so on a fresh game typing 25 in Ball on (already showing 25) and Enter does not start the drive. | 0 requests; drive info unchanged |
| G3 | The off-field copy says to type "D 25", but the Ball on field rejects it. | Toast "Field side 'DALD' isn't DAL or TB" |
| G4 | Clicking Touchdown, Turnover or "automatic 1st down" puts focus in a checkbox, and every shortcut is dead until focus moves. | J did nothing with focus on `#fTD` |
| G5 | Enter on a focused button runs Log play instead of the button (Space still clicks it). | After clicking Undo, Enter sent nothing |
| G6 | No in-flight guard: a log or flag response clears any pick made after the request left, and a flag response closes a panel the user just reopened. | K, Enter, P: the P pick was wiped when the K response landed |
| G7 | The flag panel stays open after the drive ends; the next flag key errors. | Punt with panel open: panel visible; H gave "No Dallas drive in progress" |
| G8 | Undo restores the previous version number, so other open windows never refresh after an Undo. Reset and Replay restart the version at 1. | play v334, undo v334; reset v1 |
| G9 | Reset does not stop the feed: with the feed on the poller re-logs the whole game within one poll. Reset, Undo, then feed on logs every play twice. | 59 rows back after Reset; 118 rows after Reset, Undo, feed on |
| G10 | Undo lives in server memory (200 steps, lost on restart); a replayed game cannot be undone back to empty. | 200 undos left 50 of 59 rows |
| G11 | No network error handling: first load failure leaves a blank page with no retry; failed actions give no toast; poll failures are silent; no offline state. | Section 4.4 |
| G12 | Messages set by feed-applied events are never shown (polls never toast, no message area), for example "No play: defensive offside on TB ...". | |
| G13 | "Dallas" is hard-coded: the client X toast, several server messages, and the `#iOff` aria-label "Dallas score". PRODUCT.md says nothing may be specific to Dallas. | |
| G14 | Tendency rows and the play-type mix follow alphabetical JSON key order (Flask sorts keys): Value gap, Early downs, After a 20+ yard gain, Repeat last call, After a failed play, Red zone, After a sack, 3rd & 4+, Trailing by 9+. `coefs[].group` ("habit" or "memory") is available for a deliberate order. | |
| G15 | The log "#" repeats: a nullified row carries the next snap's number. `seq` is unique but not shown. | Replay: 51, 20, 8, 7 appear twice |
| G16 | The log shows a number for goal to go ("1st & 8 at TB 8") while the strip shows G and messages say "1st & Goal". | |
| G17 | No phone layout: horizontal scroll at 390 px. | Document 597 px wide |
| G18 | Prediction rows are click-only `div`s: not focusable, no role, no keyboard activation. | |
| G19 | The last-play panel shows the newest ESPN row, but retag edits the newest non-nullified row from any source, so a manual or shorthand row entered with the feed on is the one that changes. | |
| G20 | Retagging an incomplete pass to A or P drops its depth ("Play-action, incomplete"). Engine behavior. | |
| G21 | Replay's confirm says "(today's)" when the id box is empty, but the server replays the feed's current event id (initially the configured one), never a lookup of today's game. | |
| G22 | Shorthand `fg` (and `POST /api/drive {"end":"fg"}`) adds 3 points with no drive active. | Score 0 to 3 off the field |
| G23 | Why-line numbers are not fixed-precision ("+10", "+1" next to "+16.5"). | |
| G24 | The off-field panel shows manual-entry instructions even with the feed on. | |
| G25 | The flag note is computed when the panel opens; changing the pick with the mouse while it is open leaves it stale. | |
| G26 | Offline-mode errors show a local file path in the status line and toasts. | "Offline mode: no saved game at /private/var/..." |
| G27 | Strings from the server are inserted as HTML in several places without escaping. The log's "Actual" cell includes the foul text parsed from ESPN on no-play rows, and the error status line inserts `feed.detail`. ESPN is external data: the rebuild should set text, never HTML, for every server string. | |
| G28 | Fonts load from Google Fonts at runtime; offline they fall back to Arial Narrow or the system font. | |
| G29 | Leftover CSS with no markup: `.form`, `.score`, `.mini`, `.w5`. | |

---

## 6. Regression checklist

### 6.1 Preconditions (tests/e2e harness)

Use the existing harness: session `server` fixture (sandbox, offline, saved game 401872980), `page` fixture (1440 x 900, collects page and console errors), `post(base, path, body)`. The server is shared by the whole session, so every test sets its own state first and never relies on test order:

- **Fresh:** `post(base, "/api/feed", {"on": False})`, then `post(base, "/api/reset")`, then `page.goto(base + "/")`. State: Q1 15:00, 0-0, 1st & 10, ball on DAL 25, no drive.
- **Drive:** Fresh, then `post(base, "/api/command", {"text": "new D25"})` and reload.
- **Finished game:** `post(base, "/api/feed", {"on": False})`, then `post(base, "/api/feed/replay", {"event_id": "401872980"})`, then load. State: 59 rows, DAL 16 TB 24, Q4 0:00, no drive.
- **Feed on:** Fresh, then click the feed button (the id box holds 401872980); the offline poller applies the whole game within one poll.

Model-dependent numbers (percentages, log losses) must be asserted against `GET /api/state`, not hard-coded. Literal values quoted here are today's, with the shipped models (profile built 2026-10-08T23:47:22).

### 6.2 Selector contract

Keep these ids and data attributes in the rebuild (or add `data-testid` with the same names). The checklist uses them:

`#gameLabel #whoLabel #undoBtn a[href="/api/export.csv"] #resetBtn #feedBtn #feedBtnTxt #feedEvent #replayBtn #feedStatus #field #iQtr #iClock #clockEst #iOff #iOpp #iDown #iTogo #iSide #sideTxt #iYard #driveInfo #endRow [data-end] #heroArea .pill .lgmark .fam .leaf[data-leaf] .why #entry #lastPlay [data-retag] #manualEntry .key[data-k] .key[data-out] #flagBtn #flagPanel #flagNote #flagClose [data-pen] #otherFirst #chosen #yards #fTD #fTO #logBtn #cmd #cmdBtn #entryHint #logArea #kpiArea #profTitle #profArea #toast`

New hooks the 3D field needs, because a WebGL canvas can't be inspected: the field container carries `data-drive-active`, `data-los` (yardline_100 of the ball) and `data-ltg` (yardline_100 of the line to gain), plus an `aria-label` such as "Ball on DAL 25. 1st & 10. Line to gain DAL 35.".

### 6.3 Checklist

Load and layout

1. [keep] On a fresh load, the document title is "Shadow Play-Caller", `#gameLabel` equals `game.label`, and `#whoLabel` reads "Modelling Brian Schottenheimer (DAL offense)".
2. [keep] The page shows no page errors and no console errors on load and after 3 s idle.
3. [keep] With the feed off and nothing changing, `GET /api/version` fires about every 2 s (at least 2 in 4.5 s) and `GET /api/state` is not refetched.
4. [keep] The fresh strip shows Qtr 1, Clock 15:00, 0 and 0, Down 1, To go 10, side chip DAL, Ball on 25, and `est.` is hidden.
5. [keep] With no drive, the hero shows "DAL is off the field", `#endRow` is hidden, `#logBtn` is disabled, and the entry panel is visibly de-emphasized.
6. [keep] Fresh scorecard reads "Scores appear after the first logged snap.", the log reads "No snaps yet. Each logged play shows his top pick next to what he called.", and `#profTitle` reads "Schottenheimer's tendencies".
7. [keep] At 1040 px wide the rail stacks under the main column; at 760 px the families show in 2 columns.
8. [fix] At 390 px wide the page has no horizontal scroll (document width equals the viewport).

Situation strip

9. [keep] On a fresh game, typing 20 in Ball on and pressing Enter sends `{"spot":"DAL 20"}`, toasts "Drive 1 started.", and `#driveInfo` reads "Drive 1, snap 1 of the game".
10. [fix] On a fresh game, typing 25 in Ball on (already showing 25) and pressing Enter starts drive 1.
11. [keep] Off the field, typing 2 in Down and pressing Enter starts a drive (toast "Drive N started.", 2nd & 10).
12. [keep] Off the field, clicking the side chip starts a drive at the mirrored spot.
13. [keep] Clock `841` shows 8:41, `8.05` shows 8:05, `12` shows 12:00, and each hides `est.`.
14. [keep] Clock `16:00` gives the red toast "'16:00' isn't a game clock (max 15:00)", and the field keeps `16:00` with the invalid style.
15. [keep] Down `7` gives "Down must be 1 to 4"; Qtr `6` gives "Quarter must be 1 to 4 (5 = overtime)"; To go `0` gives "To go must be at least 1"; Ball on `60` gives "Yard line must be 1 to 50"; a score of `x` gives "'x' isn't a number".
16. [keep] A score of `-3` is saved as 0.
17. [keep] To go `g` shows `G` and the server's `togo` equals `yardline_100`; To go 10 at TB 6 shows `G`.
18. [keep] At DAL 40, clicking the side chip sends `{"spot":"TB 40"}`, the chip reads TB in the opponent style, and Ball on is focused with its text selected.
19. [keep] At the 50, switching the chip to TB keeps showing TB 50 after the save.
20. [keep] Tab out of an edited field saves it the same way Enter does.
21. [keep] With a drive active, Enter in an edited strip field blurs it and focuses Yards.
22. [keep] Typing a value then Esc restores the server value with no request.
23. [fix] Esc in a field without typing, and Esc in a field holding a rejected value, both show the server value and clear the invalid style.
24. [keep] Clearing a field and pressing Enter sends no request and restores the server value.
25. [keep] While typing in a strip field, a change made through the API by another client does not overwrite the text being typed.
26. [keep] After a logged play `est.` shows next to Clock; typing a clock hides it.

Field

27. [hook] With a drive at 1st & 10 DAL 25 the field reports drive active, line of scrimmage at 75 and line to gain at 65; after Punt it reports no drive and draws neither line.
28. [hook] At 1st & Goal at TB 8 the line to gain is reported at the goal line (0).

Prediction

29. [keep] With a drive active, "Most likely call" shows `prediction.top[0].name` and `pct(top[0].p)`, and the runners-up line shows `top[1]` and `top[2]` with their percentages.
30. [keep] The pill text is `prediction.flag` with the first letter capitalized, with distinct styles for TILT, lean and "No edge" (on the 1st & 10 DAL 25 drive it reads "No edge"; `new D25 | Q1 15:00 | DAL 0 TB 14`, `K -3`, `3&2 T20` gives "TILT PASS" today).
31. [keep] The pass/run bar labels read "Ball thrown or dropback {pct(p)}", "League {pct(p_league)} (dashed)", "Handed off or kept {pct(1 - p)}".
32. [keep] Five family columns appear in descending `families[].p`, each with `pct(p)` and "League {pct(p_league)}".
33. [keep] Each family lists its leaves in descending `p` with `pct1` values (one decimal under 10%).
34. [keep] Every family or leaf with `hot` "up" shows ▲ titled "Well above the league", every "down" shows ▼ titled "Well below the league", and no other item shows an arrow.
35. [keep] The why line starts with "{x} pass pts from his habits here", where x = round((p_habits - p_league) * 1000) / 10 with a "+" when 0 or more.
36. [keep] For snaps 1 to 15 the why line includes "Opening script: memory switches on after snap 15"; after a finished game plus `new D25`, it instead lists one item per `memory_parts` entry with its `term`.
37. [keep] Clicking the "Outside left (edge)" row selects it (the chosen line reads "Outside left (edge)") and focuses Yards, the same as pressing J twice.

Manual entry, keyboard

38. [keep] P, P, P, P shows Short (0–9 air yds), Intermediate (10–19), Deep shot (20+), then Short again, each with the "tap P for <next>" hint.
39. [keep] J alternates Off-tackle left and Outside left (edge); L alternates Off-tackle right and Outside right (edge); K and R both select "Inside run (A/B gap)" and light the K key.
40. [keep] A cycles PA short (0–9), PA intermediate (10–19), PA deep shot (20+); N selects Screen; O alternates "RPO, handed off or kept" and "RPO, thrown".
41. [keep] Only the last pressed play key looks selected.
42. [keep] P then I shows "Short (0–9 air yds), incomplete" and sets Yards to 0; J then I shows "Dropback pass, incomplete"; O then I shows "RPO, thrown, incomplete".
43. [keep] A then S shows "Play-action, sack"; P then S "Dropback pass, sack"; O, O then S "RPO, sack"; K then C "Dropback pass, scramble".
44. [keep] Pressing I, S or C twice turns the outcome off; a play key after an outcome clears it.
45. [keep] I alone shows "Dropback pass, incomplete" and enables Log play during a drive.
46. [keep] T and F toggle the Touchdown and Turnover boxes.
47. [keep] Esc clears the pick ("Pick the play"), sets Yards to 0, and unticks both boxes.
48. [keep] In Yards, digits and `-` type, other letters do not.
49. [keep] Typing J in Qtr, Clock, a score, Down, To go, Ball on, the ESPN id box or the shorthand bar types the letter and leaves the pick unchanged.
50. [keep] With Alt or Ctrl held, P does not select a play.
51. [keep] K, Yards 3, Enter sends `{"yards":3,"td":false,"turnover":false,"leaf":"run_inside"}`, toasts the message, clears the pick, and leaves Yards focused showing 0.
52. [keep] P, S, Yards 7, Enter logs Yds -7, and the next down's distance grows by 7.
53. [keep] A, I with Yards 15, Enter logs 0 yards.
54. [keep] A gain at least the distance toasts "First down." and shows 1st & 10 (or G inside the 10).
55. [keep] After shorthand `new T8` then `L 3` (2nd & G at TB 5), K with Yards 12 logs a touchdown: +7 to the offense, drive ends, toast starts "Touchdown, +7", log row "Inside run (A/B gap), TD" with Yds 5.
56. [keep] L, L, Yards 5, F, Enter toasts "Turnover. Waiting for the next Dallas drive." and the log row ends ", turnover".
57. [keep] A 4th-down play short of the line toasts "Turnover on downs. Waiting for the next Dallas drive." and ends the drive.
58. [keep] Enter with nothing picked, or with no drive active, sends no request.
59. [keep] Log play stays disabled until a drive is active and a play or outcome is picked.
60. [keep] Clicking play key buttons behaves like the keys (repeat clicks cycle) and focuses Yards.
61. [fix] After clicking the Touchdown checkbox, pressing J still selects a play.
62. [fix] Picking P right after pressing Enter on a K pick keeps the P pick once the K response lands.

Flags

63. [keep] X with no drive gives the red toast "No Dallas drive in progress. Type the ball spot first." and no panel.
64. [keep] X opens the panel with headings "On TB (defense)" and "On DAL (offense)", 8 coded fouls each with their key letters and summaries, plus Offsetting (W), Other on TB, the "automatic 1st down" box, and Other on DAL.
65. [keep] With A, A picked, the note reads "Your pick (PA intermediate (10–19)) is wiped out but still scored as his call. Pre-snap fouls ignore it."; with nothing picked, "No play picked: the flag just moves the ball."
66. [keep] X or Esc closes the panel and keeps the pick; the flag button looks active only while the panel is open.
67. [keep] With the panel open, J, T and Enter send nothing and change nothing.
68. [keep] At 1st & 10 DAL 25 with nothing picked, H sends `{"code":"DH","yards":null,"auto_first":false}`, toasts "Defensive holding: 5 yards, automatic first down. 1st & 10 at DAL 30.", and closes the panel.
69. [keep] At 1st & 10 DAL 25, P, X, F toasts "False start: back 5 yards. 1st & 15 at DAL 20." and adds no log row.
70. [keep] J, X, L adds the row "Off-tackle left (no play: offensive holding)" with Yds "flag", and the toast ends "His call still counts for scoring."
71. [keep] PPP, X, D with Yards 0 gives "Type the yards first: how far past the line for DPI, or the penalty yardage." and the panel stays open; typing 28 then D gives "...ball at the spot, 28 yards, automatic first down...".
72. [keep] Other on TB with Yards 15 and the box ticked toasts "Penalty on TB: 15 yards, automatic first down. ..." and the box is unticked afterwards.
73. [keep] Other on DAL with Yards 10 and the box ticked toasts "Penalty on DAL: back 10 yards. ..." with no first down.
74. [keep] In the panel, I applies intentional grounding (down goes up by one) and U applies unnecessary roughness on defense, not undo.
75. [keep] J, X, W adds the row "Off-tackle left (no play, flag)" and replays the down.
76. [keep] Shorthand `new T8` then `X RTP` toasts "Done: Roughing the passer: 4 yards (half the distance), automatic first down. 1st & Goal at TB 4."
77. [fix] Punt with the flag panel open closes the panel.

Shorthand

78. [keep] `JJ 6 | 2&4 D44` toasts "Done: JJ 6, 2&4 D44" and clears the box; one Undo reverts both segments.
79. [keep] `PP 0 INC`, `AA 12`, `O 3`, `OO 9`, `S 7`, `SC 6` log "Intermediate (10–19), incomplete", "PA intermediate (10–19)", "RPO, handed off or kept", "RPO, thrown", "Dropback pass, sack" (-7), "Dropback pass, scramble".
80. [keep] `I` logs "Pass, turnover" with dashes in His % on it, League % and Rank.
81. [keep] `X DH`, `X FS`, `X DPI 28`, `X TB 15 1ST`, `X DAL 10` and `X` each toast their matching message ("Done: Defensive holding: ...", and so on; `X` replays the down without moving the ball) and add no log row.
82. [keep] `new D25`, `new T30`, `DAL 14 TB 10`, `Q2 1:58`, `punt`, `fg miss`, `half` each do what section 2.6 says.
83. [keep] `KK 3` gives "Didn't understand 'KK 3'", `X ZZ` gives "Unknown flag 'ZZ'. Try X DH, X FS, X OH, X DPI 25, X TB 5"; neither changes the state and the text stays in the box.
84. [keep] Enter in the shorthand box runs it, the Run button does too, and Enter there never logs the picked play.
85. [fix] `fg` with no drive active is refused.

Drive end

86. [keep] Punt toasts "Punt. Waiting for the next Dallas drive.", shows the off-field state, and the field loses its markers.
87. [keep] FG good adds 3 to the offense score; FG missed leaves the score; Half over toasts "End of half. Waiting for the next Dallas drive." and ends the drive.

Undo, Reset, Export

88. [keep] U and the Undo button revert the last action with the toast "Undid the last action."; with nothing to undo the toast is "Nothing to undo."
89. [keep] Reset asks "Clear every snap logged for this game?"; dismissing it changes nothing; accepting returns to the fresh state with the toast "Set the start of Dallas's first drive."
90. [keep] Export CSV downloads `shadow_caller_log.csv` (`text/csv`) whose header is `snap,drive,time,qtr,clock,down,togo,yardline_100,score,p,p_league,p_habits,flag,call,dropback,yards,success,td,turnover,family,leaf,outcome,name,top_leaf,top_leaf_p,fam_p,fam_p_league,leaf_p,leaf_p_league,leaf_rank,leaf_rank_league,seq,nullified,penalty`, with one row per log row, oldest first.
91. [fix] An Undo made in one tab shows up in a second open tab within 2.5 s.

ESPN feed

92. [keep] Clicking "ESPN live: off" sends `{"on":true,"event_id":"401872980"}`, the button reads "ESPN live: on" with the live style, and the toast reads "ESPN live feed on. Plays log themselves; retag play-action, screen or RPO."
93. [keep] With the feed on, the manual pad and flag panel are hidden, the shorthand bar still works, the hint switches to the feed text, and the entry panel is not dimmed.
94. [keep] With the feed on (sandbox), all 59 rows appear within 10 s and the status reads "Updated HH:MM:SS · Last: END GAME".
95. [keep] With the feed on, `GET /api/state` is refetched about every 4 s.
96. [keep] The last-play panel shows "Last play from ESPN", "Short (0–9 air yds), turnover", "0 yds", the ESPN text, and buttons A Play-action, N Screen, O RPO thrown, P Plain dropback, with P marked current.
97. [keep] With the feed on, A sends `{"key":"A"}`, toasts "Last play retagged: PA short (0–9).", shows " · retagged", and marks A current; the P button then restores "Short (0–9 air yds)".
98. [keep] With the feed on, J on that pass gives the red toast "J doesn't fit a pass."
99. [keep] With the feed on, X, Esc, Enter, T, F, I, S and C send nothing; U undoes.
100. [keep] Feed on with no ESPN row yet shows "Waiting for the first DAL play" and "Plays appear here a few seconds after ESPN posts them."
101. [keep] Event id 999 with the feed on (sandbox) shows "ESPN live: retrying" with the error style and "Can't reach ESPN (...). Still trying every few seconds."
102. [keep] When `feed.skipped` is set and the feed is on, the status line includes "Skipped, enter it by hand:" and the skipped text.
103. [keep] Turning the feed off shows "ESPN live: off", "Off: enter plays by hand, or turn it on and plays log themselves.", brings back the manual pad, and hides the last-play panel.
104. [keep] The ESPN id box is not overwritten while focused, and Enter in it only blurs it.
105. [fix] Reset with the feed on does not re-log the game behind the user's back (the feed stops, or the user is told).

Replay

106. [keep] Replay asks "Rebuild the game log from ESPN game 401872980? The current log is backed up first." and toasts "Replayed ESPN game 401872980: 55 DAL plays logged. Old game backed up in data/."
107. [keep] After a replay the log has 59 rows, the score is 16 to 24, the clock Q4 0:00, the offense is off the field, and every scorecard value matches `/api/state.metrics`.
108. [keep] After a replay exactly 4 rows show Yds "flag" with names containing "(no play:".
109. [keep] Replay with event id 999 shows a red toast and leaves the game unchanged.

Scorecard, tendencies, log

110. [keep] The "Specific play" and "Play type" groups appear only when `leaf_n` and `fam_n` are above 0; the "Pass vs run" group always appears once a snap is logged.
111. [keep] Each log-loss value is styled as better when it is below the league value and worse otherwise.
112. [keep] The log columns are, in order, #, Time, Situation, His top pick, Actual, His % on it, League %, Rank, Yds, and the newest row is first.
113. [keep] Rank 1 is styled good, 2 and 3 neutral, 4 and up bad; missing values show a dash.
114. [keep] The tendencies plot has 9 rows, filled exactly for terms whose `lo > 0` or `hi < 0`, and the note reads "1,351 snaps, 21 games (2025–2026). Filled dots: 90% interval excludes zero."
115. [keep] The play-type mix lists all five families with his % and "exp. X%", followed by the held-out sentence built from `cv.specific_play` (38%, 66%, 1,270 today).

Sync, errors, accessibility

116. [keep] A change posted to the API from outside the page shows up within 2.5 s without a reload and without a toast.
117. [keep] A 400 response shows its `error` text in a red toast for about 2.6 s and the page shows the returned state.
118. [keep] The toast is a polite live region, and a new toast replaces the previous one.
119. [keep] If `/api/state` has no `keys`, the page shows "Restart the server to finish the update".
120. [fix] If the first `/api/state` fails, the page says so and retries until it loads.
121. [fix] A failed action (network error or non-JSON 500) shows a red toast.
122. [fix] Prediction rows are keyboard-focusable and Enter or Space picks them.
123. [fix] A play whose ESPN foul text contains `<b>x</b>` appears in the log as literal text.

---

## Appendix A. `/api/state` field names

```
game         {game_id, label, offense, opponent, offense_is_home, offense_spread, total_line, espn_event}
sit          {down, togo, yardline_100, qtr, clock (seconds), clock_str "M:SS", score_off, score_opp, clock_estimated}
drive_active bool            drive_n int
prediction   null when no drive, else:
             {p, p_league, p_habits, gap, flag ("TILT PASS"|"TILT RUN"|"lean pass"|"lean run"|"no edge"),
              memory_parts [{term, pts}], script bool, snap_next, value_gap,
              families [{key, name, p, p_league, hot ("up"|"down"|""), leaves [{key, name, p, p_league, hot}]}],
              top [{key, name, family, p, p_league}] x3}
keys         {A, J, K, L, N, O, P, R: [{leaf, name}]}            (tap cycles)
penalties    {CODE: {label, against ("def"|"off"|null), yards (int|"spot"|"box"), first, lod, presnap}}
leaf_names   {leaf: name}    family_names {run, dropback, pa, screen, rpo: name}
log          newest first, without the stored tree. Every row:
             {seq, snap, drive, time (wall clock), qtr, clock, down, togo, yardline_100, score "off-opp",
              p, p_league, p_habits, flag, top_leaf, top_leaf_p, fam_p, fam_p_league, fam_top,
              leaf_p, leaf_p_league, leaf_rank, leaf_rank_league, call (R|P|S|SC), dropback (0|1),
              yards, success (0|1|null), td, turnover, family, leaf, outcome, name, nullified,
              penalty (code|null), source ("manual"|"espn")}
             plus on played (not nullified) rows: depth (short|mid|deep|null), feed_text, align ("S"|"U"|null)
             plus retagged: true after a retag
metrics      {n} when empty, else {n, logloss_model, logloss_league, brier_model, brier_league, acc_model, acc_league,
              dropback_rate, tilt_n, tilt_hits, granular {fam_n, leaf_n, fam_logloss, fam_logloss_league, fam_top_hits,
              leaf_top1, leaf_top3, leaf_top3_league, leaf_logloss, leaf_logloss_league}}
profile      {caller, team, seasons, n_snaps, n_games, alpha, lambda, q0, built_at, sklearn,
              coefs {key: {est, lo, hi, label, group}}, cv_logloss {...}, dropback_rate {actual, league_expected},
              by_down [{down, n, actual, league_expected}], stage1_check {...},
              granular {n_snaps, family_rates {fam: {his, league_expected}}, cv {family, run_gap, pass_depth,
              specific_play {n, logloss_league, logloss_his, top1_his, top1_league, top3_his}}, rpo_throw {his, league, his_n}}}
memory       {snap_n, value_gap, prev ({type 1|-1, success, explosive, sack} | null), script_plays}
feed         {state ("off"|"starting"|"live"|"error"), detail, last_poll, last_play, plays_logged, skipped, on, event_id}
version int  message string  error string (400 responses only)
```

## Appendix B. Data the current UI does not show

Available in `/api/state` but not displayed: `prediction.gap`, `value_gap`, `snap_next`, `top[].family`, `top[].p_league`, leaf `p_league` as text; per-row `seq`, `drive`, wall-clock `time`, `score`, `p`, `p_habits`, `flag`, `success`, `fam_top`, `leaf_rank_league`, `source`, `penalty`, `depth`, `align` (shotgun or under center); `metrics.brier_*`; `profile.cv_logloss`, `stage1_check`, `by_down`, `dropback_rate`, `granular.cv.family`, `run_gap`, `pass_depth`, `rpo_throw`; `memory.value_gap`, `memory.prev`; `feed.plays_logged`, `feed.detail` (outside the error state); `state.message` from feed-applied events.

In the ESPN summary but not passed through `/api/state` at all (a 3D GameCast needs a server change to get them): win probability per play, drive summaries (start and end yard line, result, plays, yards, time), team colors, alternate colors and logos, box-score team stats, and pass side (the parser reads left, middle or right but does not store it). PRODUCT.md mentions "Watch this game" (snap by snap at 1x to 10x); no control or endpoint exists yet.

## Appendix C. How this was verified

- Sandbox: `.venv/bin/python scripts/sandbox.py --port 5087` (temp data folder, offline, saved game `data/espn/summary_401872980_final.json`). The real `data/live_state.json` and `data/feed_seen.json` were never touched.
- Playwright 1.60 (Chromium headless) in six scripted passes covering fresh and off-field state, drive start, every tap cycle and outcome pairing, the flag panel with and without a pick, every flag path, inline edits and their errors, the side chip and the 50, leaf clicks, shorthand, undo and reset, drive ends, feed on, retag, feed off, replay, feed error, the intercepted skipped, waiting and restart states, network failures, polling cadence, and widths 1440, 1040, 1000, 760, 700 and 390. A direct API probe covered the remaining messages, version numbering, undo depth, and Reset, Undo and feed duplication.
