# Play-callers 2024 to 2026

`data/play_callers_2024_2026.csv` says who called the offensive plays for all 32 teams in 2024, 2025 and 2026, one row per stint, with a source on every row. It is current to Oct 10, 2026: weeks 1 to 4 are played (DAL and TB have also played week 5), and each team's last 2026 stint is the announced caller through week 22.

Now that the file exists, `games.py` (the game picker's callers) and `scripts/build_callers.py` read it ahead of `data/play_callers.csv`. Tonight's model (`build.py`, `build_granular.py`) still reads `data/play_callers.csv` through `config.CALLERS_CSV`, and `scripts/sandbox.py` still copies only that file (game-picker.md, step 5).

## 1. How it was researched

1. **Research, one pass per division.** Web search and page reads, preferring team sites, beat reporters and major outlets that say in so many words who calls the plays. A coordinator's title was never taken as proof: 16 head coaches called their own offense at the start of 2026 (17 from DEN's week 5).
2. **Verification, one pass per division.** Every row was re-checked against independent sources. The baseline is ESPN NFL Nation's yearly playcaller list (Aug 30 2024, Sep 9 2025, Sep 3 2026; ABC stations and TSN reprint it, and a reprint counts as one source with it). On top of that: in-season evidence (the caller explaining his own calls, team-site transcripts) and the announcement of every change.
3. **Merge (this table).** `source` is the one best URL for the row: a team site or an in-season piece where the caller owns his calls, else the explicit announcement; for a split season, the article on the change. The row's other URLs are at the end of `note` ("Other sources: a | b"). Remarks about the research process were trimmed from the notes; no fact was changed.

All 245 URLs in the table were requested on Oct 10, 2026. 236 answered and 9 refused a script (bot walls or paywalls: arizonasports.com x4, jsonline, newsweek, mynorthwest, castanetkamloops, profootballnetwork). None was missing. The Arizona Sports article behind two LA rows was read and checked.

## 2. Conventions

- Weeks are nflverse's: 1 to 18 regular season, 19 to 22 postseason. In every team-season the stints start at week 1 and run to 22 with no gap or overlap. `build_callers.read_table` reports no problems; `games.read_callers` parses 112 of 112 rows and trims no role or source.
- `last_week` 22 means through the end of that team's season, playoffs or not. For 2026 it is a projection after week 4.
- A bye inside a stint has no plays. LV 2024 had the only gap (Getsy through week 9, Turner from his first game in week 11), so Turner's stint now starts at the week 10 bye.
- Roles fit the app's 24-character cap (`ROLE_MAX` in games.py). Four long titles were shortened: Pass game coord/QB coach (Downing), Interim OC (Turner), HC (shared with OC) (McVay, 2025 week 14), Pass game specialist (Klay Kubiak).
- The two DAL rows already in `data/play_callers.csv` (Schottenheimer, 2025 and 2026) appear here unchanged in every column that file has, source included. The verified sources are in their notes.

## 3. Counts

| | 2024 | 2025 | 2026 | Total |
| --- | --- | --- | --- | --- |
| Team-seasons | 32 | 32 | 32 | 96 |
| Rows (stints) | 40 | 39 | 33 | 112 |
| Team-seasons with more than one row | 6 | 6 | 1 | 13 |
| ...where the caller changed | 6 | 4 | 1 | 11 |
| Head coach calls the plays in week 1 | 14 | 16 | 16 | |

Confidence: 110 high, 1 medium, 1 low. 59 callers; 13 of them called for more than one team (Klint Kubiak for three: NO, SEA, LV).

## 4. Low and medium confidence

| Season | Team | Weeks | Caller | Confidence | Why |
| --- | --- | --- | --- | --- | --- |
| 2025 | LA | 14 | Sean McVay, shared with OC Mike LaFleur | low | McVay was ill and flew in on game day (45-17 at ARI). The Rams site says LaFleur relayed the calls and called some; SI says McVay stayed in command; Arizona Sports says LaFleur called plays. It sits on McVay so the season has no gap. Treat the game as mixed. |
| 2026 | DEN | 5 to 22 | Sean Payton | medium | Payton took the calls back from Davis Webb on Oct 8 (AP, ESPN, team site). Week 5 at LAC (Oct 11) is unplayed, Webb keeps a game-day role, and Payton would not say how long the change lasts. |

`build_callers` gives each caller the weakest confidence among his stints, so McVay's entry in `models/callers/index.json` will read low and Payton's medium, though every other stint of theirs is high.

## 5. High, but thin in places

- 2025 NE, Josh McDaniels: both sources are preseason. No in-season or playoff article names the caller, though nothing suggests anyone else (he was AP Assistant Coach of the Year).
- 2025 PIT, Arthur Smith: no source names the caller for the wild-card loss (week 19).
- 2024 KC, Andy Reid: assumed for the week 18 rest game at DEN.
- 2024 PHI, Kellen Moore: Sirianni made at least one call himself (4th-and-1 at NO, week 3).
- 2026 DEN weeks 1 to 4, Davis Webb: Payton said he would call some plays, so some of his input is mixed in.
- 2026 WAS (David Blough) and 2026 CLE (Todd Monken): little in-season evidence after week 1.
- No game-level source for these late weeks, and no reported change: CHI 2024 weeks 15 to 18, IND 2025 weeks 13 to 18, TEN 2025 weeks 15 to 18, GB 2025 weeks 15 to 19, LV 2025 weeks 17 and 18.

## 6. Mid-season changes

| Season | Team | Stints | What happened |
| --- | --- | --- | --- |
| 2024 | NYJ | 1-5 Nathaniel Hackett (OC); 6-22 Todd Downing (pass game coordinator/QB coach) | Saleh fired Oct 8; interim HC Jeff Ulbrich moved the calls before week 6. |
| 2024 | CLE | 1-7 Kevin Stefanski (HC); 8-22 Ken Dorsey (OC) | Dorsey took over from week 8 (Watson tore his Achilles in week 7). |
| 2024 | LV | 1-9 Luke Getsy (OC); 10-22 Scott Turner (interim OC) | Getsy fired Nov 3; Turner's first game was week 11, after the bye. |
| 2024 | CHI | 1-10 Shane Waldron (OC); 11-13 Thomas Brown (OC); 14-22 Thomas Brown (interim HC) | Waldron fired Nov 12. Eberflus fired Nov 29 and Brown kept calling, so week 14 is a title change only. |
| 2024 | LA | 1-17 Sean McVay; 18 Mike LaFleur (OC); 19-22 Sean McVay | LaFleur called only the week 18 rest game. |
| 2024 | SF | 1-17 Kyle Shanahan; 18-22 Klay Kubiak (pass game specialist) | Kubiak called week 18, SF's last game. |
| 2025 | TEN | 1-3 Brian Callahan (HC); 4-22 Bo Hardegree (QB coach) | Handoff at 0-3. Callahan fired Oct 13; Hardegree kept calling under interim HC Mike McCoy. |
| 2025 | CLE | 1-9 Kevin Stefanski (HC); 10-22 Tommy Rees (OC) | Announced Nov 3, in the week 9 bye. |
| 2025 | DET | 1-9 John Morton (OC); 10-22 Dan Campbell (HC) | Campbell took over after the week 9 loss to MIN (bye in week 8), for the rest of the season. |
| 2025 | NYG | 1-10 Mike Kafka (OC); 11-22 Mike Kafka (interim HC) | Daboll fired Nov 10. Same caller, new title. |
| 2025 | LV | 1-12 Chip Kelly (OC); 13-22 Greg Olson (interim OC) | Kelly fired Nov 23, after week 12. |
| 2025 | LA | 1-13 Sean McVay; 14 McVay shared with LaFleur (low); 15-22 Sean McVay | McVay ill for week 14. Same caller in the table. |
| 2026 | DEN | 1-4 Davis Webb (OC); 5-22 Sean Payton (HC, medium) | Payton took the calls back on Oct 8, at 2-2. |

## 7. Re-check during 2026

Every 2026 row runs to week 22 as announced. The notes flag these as the likeliest to change:

- DEN: Payton has only just taken over.
- TB (1-4, Zac Robinson): Bowles's seat is the hottest in the NFC South.
- HOU (0-4, Nick Caley): Ryans has already taken back the defensive calls.
- CIN (2-2, Zac Taylor): a column says he should give up play-calling.
- PIT (Mike McCarthy): friction with Rodgers; in GB he handed off the calls in 2015 and took them back by mid-December.
- DET (Drew Petzing): Campbell took the calls mid-season in 2021 and 2025.
- New callers off to 0-4 or 1-3: LAC (Mike McDaniel), MIA (Bobby Slowik), TEN (Brian Daboll), NYJ (Frank Reich).
