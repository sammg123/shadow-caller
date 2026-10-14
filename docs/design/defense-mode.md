# Defense mode: predicting the defensive call (Sam's idea, 2026-10-12)

Status: idea, nothing built. Recorded from a design conversation with Sam so it isn't lost.

## The idea

Predict the defense's next call (coverage and pressure) instead of, or next to, the offense's. A defensive coordinator's call is concrete (Cover 3, zero blitz), coordinators have strong situational habits ("Cover 3 on third down"), and an offensive coordinator who knows the likely coverage before the snap can call a play that beats it.

Sam's example: the Jaguars don't normally zero-blitz on third down, but they did against the Eagles because Hurts struggles against pressure. Defensive calls change with the opponent, so one coordinator's history isn't enough.

## Three ingredients, weighted

1. **The coordinator's habits by situation.** His history on each down, distance, field position, score and clock (the same role "his habits" play in the offense model).
2. **How every defense this season played this offense.** Most teams outside the division meet only once, so every game against this offense this season is a sample of how the league attacks it (everyone blitzed Hurts on third down). Both in specific situations and in general. Notes:
   - It is as much about the quarterback as the team: a backup changes it.
   - It is thin by midseason (an offense may have faced 25 third-and-long snaps), so it shrinks toward the league until the sample grows.
   - A division rematch makes the first meeting the most relevant game of all.
3. **This game so far.** In-game updating: each game starts from 1 and 2, and every observed play adds evidence, so the model is "rusty" in the first quarter and calibrated by the third. If a defense zero-blitzes every third down tonight when it never did before, that weighs heavily.

The weights are learned, not hand-tuned: fit on past seasons by predicting each held-out game (features only from earlier games, and in-game features only from earlier snaps), scored against a league baseline the way the offense scorecard is.

Other inputs worth adding: offensive personnel and formation (defenses match personnel), score and clock, and the quarterback.

## What it predicts

The next snap, before it happens:
- man or zone;
- the shell (0, 1 or 2 deep safeties);
- the coverage (0, 1, 2, 3, 4, 6);
- pressure (4, 5, 6+ rushers).

Who blitzes by player is not in public data (FTN counts blitzers without naming them); position group at most.

For a coach, the tendency report ("on 3rd and 7+ they play Cover 1, 40%") may matter as much as the live next-play guess.

## Offensive formation as an optional input

Defenses check (adjust) after the offense lines up, so the offense's formation is one of the strongest signals of the final defense.

- **One model, formation optional.** With no formation given, the model averages over the formations this offense usually shows in that spot. With one given, it uses that one.
- **Coordinator what-if page (first).** An offensive coordinator enters the situation and the formation he's thinking of running and sees the predicted defense, with how many past plays stand behind it and the plays themselves (the analyst's play citations already link plays). It lives on its own page, so the GameCast stays free of user input.
- **Live from video (later).** A vision model reads the offense's formation from the broadcast after it sets and updates the defensive prediction before the snap. This is far more realistic than reading coverage from video: the offense is in the wide shot pre-snap and a formation isn't disguised. Personnel (a tight end vs a big receiver) is the hard part, and the update has to land in the second or two before the snap.
- **Limits.** Free formation labels are coarse (shotgun, singleback, empty, I-form, pistol, jumbo, plus personnel, backfield count and motion), so the what-if is only as fine as the labels. Rare combinations come back close to the league average. It learns what defenses did, not why.

## Data reality (checked 2026-10-12)

- **No public live coverage feed exists.** The NFL's Next Gen Stats tracks every player with RFID chips (10 times a second), and AWS models turn that into live reads that appear only as broadcast graphics: Prime Vision on Thursday Night Football shows Defensive Alerts (likely blitzers before the snap), Coverage ID (the pre-snap coverage look) and Pressure Alerts. Genius Sports is the exclusive distributor of the NFL's live official data to media companies and sportsbooks (through 2029). As far as we know, teams can't use live tracking on the sideline either.
- **Free, after the game (nflverse, charted by FTN):** blitzers and pass rushers per play (2022 on, published within days in season); man vs zone and the coverage type in the participation data (2023 and 2024 confirmed, released after each season ended); offensive formation and personnel in the participation data.
- **Paid:** PFF and Sports Info Solutions (and Hudl in college) chart coverage on every play within hours to a day.
- **College:** cfbfastR has no coverage labels. USC likely subscribes to PFF, Hudl or SIS, so the pitch can be: the method proven on public NFL data, running on the program's own charting.
- **Live labels are the crux.** Without them the model can predict live from history but can't grade itself or update in-game on coverage until labels arrive (blitz counts weekly, coverage types possibly only after the season), unless plays are charted by hand or read by a vision model.

## Order (agreed)

1. Data check: coverage, blitz, formation and personnel labels; which seasons; how soon after games.
2. Backtest the defense model with and without formation. Its gain over the league tells us whether to pivot (the offense model's edge is about 1% in log loss: 0.523 vs 0.529 for Schottenheimer), and the formation's gain tells us whether the vision work is worth it.
3. The coordinator's what-if page (manual formation input).
4. Live formation from video.

Keep the offense model: the app can show both his next call and their likely coverage. On the 3D field, coverage can be drawn as shaded zones (thirds for Cover 3, halves for Cover 2) with blitz arrows, in the same language as the shadow plays.

Sources: [Prime Video AI features](https://aboutamazon.com/news/aws/prime-video-thursday-night-football-next-gen-stats-ai-features), [AWS coverage patterns](https://aws.amazon.com/de/blogs/media/nfl-next-gen-stats-and-aws-decode-defense-coverage-patterns/), [NFL Next Gen Stats](https://operations.nfl.com/gameday/technology/nfl-next-gen-stats/), [NFL and Genius Sports extension](https://www.businesswire.com/news/home/20250611456305/en/The-National-Football-League-Expands-and-Extends-Strategic-Partnership-with-Genius-Sports-in-Multi-Year-Deal), [nflreadr releases](https://github.com/nflverse/nflreadr/releases), [nflreadr participation dictionary](https://mirror.linux.duke.edu/cran/web/packages/nflreadr/vignettes/dictionary_participation.html).
