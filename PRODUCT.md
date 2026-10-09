# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Sam (primary operator).** Runs the app on his laptop during live NFL games, glancing at it between snaps and keying in what the feed can't see (play-action, screen, RPO, flags). Needs the next-call prediction readable in a second or two, and keyboard-first control.
- **Demo audience.** The same app shown full-screen on a TV, projector or screen recording, chiefly to Conor McQuiston (USC football's Director of AI) as part of Sam's pitch for a football analytics internship. Needs to understand, without narration, what the model predicted and how it did.

## Product Purpose

Shadow Play-Caller models one NFL offensive play-caller (tonight: Brian Schottenheimer, Dallas) and predicts his next call live, before the snap: run or pass, then five play types (run, dropback, play-action, screen, RPO), then 14 specific plays (run gap and side, pass depth, RPO handoff or throw). It shows the whole game as it happens, both teams' plays animated on a 3D field like ESPN GameCast, and scores every prediction against a league baseline as the game goes. Success: correct, calibrated predictions shown before each snap, and a showcase that makes the analytics obvious to a football decision-maker.

## Positioning

A shadow model of one play-caller's brain, not a generic play predictor: a caller-blind league baseline, plus his own habits, plus an in-game memory that reacts to what just worked (value gap, stickiness, after a failure, after an explosive gain, after a sack). Every live call is scored against the league baseline, so the edge is measured rather than claimed.

## Operating Context

- Local Flask app on localhost:5050, started with `bash start.sh`. One HTML page, no build step.
- Used beside a live broadcast. The ESPN unofficial feed auto-logs each play a few seconds after it happens; manual entry by keyboard is the fallback.
- ESPN can't see play-action, screens or RPOs; Sam retags the last play with one key (A, N, O). Corrected tags arrive days later in nflverse (FTN charting) for regrading.
- Finished games can be rebuilt instantly ("Replay this game") or watched snap by snap at 1x to 10x speed ("Watch this game") for demos.
- Shown on a laptop during games and on large screens for demos; both matter.

## Capabilities and Constraints

- Data per play (free ESPN feed): down, distance, spot, clock, score, possession, run gap and side, pass side (left/middle/right), air yards on completions (98% right depth bucket), only "short"/"deep" on incompletions (74%), sacks, scrambles, turnovers, penalties, ESPN win probability, box score. No player tracking: routes and player positions are not available, so any drawn path is an approximation from these fields.
- Never delete or blindly overwrite `data/live_state.json` (the live game). Keyboard shortcuts must never fire inside inline inputs. After changes Sam restarts with Ctrl+C, then `bash start.sh`.
- Long-term port to college football (cfbfastR, run/pass level only, a Big Ten play-caller table). Keep code general across teams and levels where it is cheap.
- Undecided: final hosting beyond localhost.

## Brand Commitments

- Name: Shadow Play-Caller. Team names, colors and logos come from ESPN for whichever teams are playing.
- Plain, direct football language. No fabricated statistics; every number shown is computed from the model or the feed.

## Evidence on Hand

- Model results (game-level cross-validation): Stage 1 baseline 2025 holdout log loss 0.5268 vs nflfastR xpass 0.5355; his model with memory 0.5248 vs league 0.5322 (1,351 snaps, 21 games).
- First live game (TB at DAL, Oct 8 2026, 59 Dallas snaps): pass/run log loss 0.421 vs league 0.424; 85% vs 81% called right; actual play in his top 3 on 47 of 59.
- ESPN parser validated against nflverse on 65 games (8,333 snaps); saved real game at `data/espn/summary_401872980_final.json`.

## Product Principles

1. The next call comes first: readable in a glance between snaps.
2. Every prediction is scored, and the score is visible.
3. Never show more precision than the data has; approximations look like approximations.
4. Works on free data with a manual fallback at every step.
5. Nothing is specific to Dallas: any team, any caller, later any level.

## Accessibility & Inclusion

Readable from across a room on a TV or projector as well as on a laptop.
