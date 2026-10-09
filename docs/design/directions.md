# Shadow Play-Caller: visual directions for the redesign

> **v1.3 OVERRIDE (2026-10-09), Sam's direction: read `docs/design/play-drawing.md` first.** It is binding and overrides this file wherever they disagree (2.4 drawing grammar, 2.5 engine visuals, the ghost zones, the W1 projection shapes) and any task prompt that says otherwise: every play starts on the line of scrimmage (no QB drop, no handoff mesh, no PA fake step); a pass is an arc, an incompletion an arc ending in an X, a run a straight flat 2D line with its yards; every play is labeled on the field ("Deep pass left · +21", "Inside run (up the middle) · +4"); before each Dallas snap the top 2 most likely plays are drawn as dashed, translucent shadow plays in that same shape language with "1 · Deep shot (20+) · 31%" text underneath.

Status: candidate directions for the replacement visual world, derived with Impeccable `new-work.md` section 3 (steps 1 to 3) and section 4. The concept roll, the decision page and DESIGN.md come later and are not part of this file.

Mode: **Operate** (a live tool read between snaps) carrying **demo-on-a-big-screen** weight. Expression may never hide the next call, the situation or the keys. Signature motion is one moment per snap, driven by state, and every moment degrades to an instant state change under `prefers-reduced-motion`.

Evidence read: PRODUCT.md, README.md, `static/index.html`, the saved TB at DAL game (`data/espn/summary_401872980_final.json`: DAL `#002a5c` / `#b0b7bc`, TB `#bd1c36` / `#3e3a35`, 184 win-probability points, 21 drives, final TB 24 DAL 16), and sandbox screenshots of the current UI at 1440x900 and 1920x1080 (replayed game, plus one live drive started at DAL 25: "Deep shot (20+) 48%", pass 94% vs league 94%, "No edge").

The current UI is evidence and anti-reference only: cool gray ground `#EEF1F4`, navy ink, Barlow Condensed, a 1200x120 flat SVG field strip, a right rail of white cards, blue pass / amber run / purple RPO. It is a clean form, not a world. Everything below replaces it.

---

## 1. Ground truth

**The unique mechanism, in one sentence.** Shadow Play-Caller runs a copy of one offensive coordinator's decision-making (a caller-blind league baseline, plus his habits, plus an in-game memory of what just worked) and names his next call before the snap, then grades that call against the league the moment the snap lands.

**The audience's real scene.**

- *Sam, live.* A laptop on a desk or coffee table at night beside the Thursday Night Football broadcast, the room lit mostly by the TV. Twenty-five to forty seconds between snaps. Hands on the keyboard. The ESPN feed lands each play a few seconds after the TV shows it, and he retags what ESPN can't see (A, N, O).
- *The demo.* A TV or projector in a football building meeting room, daylight or overhead fluorescents, 8 to 14 feet from the screen. Conor McQuiston (USC football's Director of AI) watches a finished game replayed snap by snap at 4x to 10x in "Watch this game", or a screen recording of it on his own laptop. Narration is not guaranteed.

**Cultural home.** The coaching side of football television: the play-caller's sheet and headset, the film room and the video coordinator's breakdown, the broadcast truck's virtual graphics, the stadium on a game night. Not fantasy sports, not betting, not a SaaS dashboard.

**What this first surface must prove**, in one viewport and without narration:

1. The call is on screen before the snap.
2. The snap happens on a 3D field, drawn honestly from the feed.
3. The verdict lands, scored against the league.
4. The running score says whether the edge is real.

One glance between snaps gives the next call. One snap gives one graded prediction. One game gives the scorecard.

**The rut (kept out).** The dark sports-analytics dashboard: near-black canvas, neon green or cyan accents with glows, a grid of KPI cards and donut gauges, a flat top-down green rectangle for the field, Inter.

**Its predictable opposite (also kept out).** The light data-journalism page: off-white paper, serif headlines, hairline charts, small tracked monospace labels.

The current UI sits between the two. Neither appears in the lists below.

### Product truth every direction carries

These come from PRODUCT.md and the running code, and no direction may drop one.

- **Next call.** Top three specific plays with percentages; the run/pass split with the league mark; five families (Run, Dropback, Play-action, Screen, RPO), each with its league percentage; the 14 specific plays under them; the up/down flags (at least 4 points and 30% off the league); the tilt verdict (tilt pass, lean run, no edge); the "why" points (habits, memory terms, opening script).
- **Scorecard.** Top pick right X of N; actual play in his top 3, X of N (league count beside it); log loss, his vs league, at three levels (pass/run, play type, specific play); called right % vs league; tilts that came true; pass rate tonight. The line "One game is a pipeline test, not proof" stays.
- **His tendencies.** Pass/run terms with 90% intervals, play-type mix vs expected.
- **Situation.** Quarter, clock (with the est. flag), score, down, to go (G for goal), ball on and side, drive and snap numbers, end-of-drive actions.
- **Entry.** J K L (R), P A N O, I S C, T F, the X flag menu (defense and offense columns, W offsetting, Other with yards and automatic first down), U undo, Esc, Enter, the shorthand bar. Feed on/off, game id, Replay this game, Watch this game (1x to 10x), Export CSV, Reset. In feed mode: retag keys A N O P J K L, and U. Keys never fire inside inline inputs.
- **From ESPN.** Team colors and logos, win probability per play, drives (start, end, result, plays, yards, time), box score team stats, the play text, skipped plays.

### Shared approximation grammar (principle 3)

The feed has no player tracking, so every direction draws the same honest set of facts, each in its own material:

| Fact in the feed | What is drawn | How it shows it is approximate |
| --- | --- | --- |
| Ball spot (yardline), no hash | Ball at the line of scrimmage, centered between the hashes | One legend line: "Ball shown mid-field; ESPN gives no hash" |
| Completion: side (L/M/R), air yards = gain minus YAC | Arc to a landing area in the side's third, at the air-yards depth, then a straight ground stroke for YAC | Landing is a small area, not a dot; YAC is a straight stroke, never a weaving route |
| Incompletion: side, only "short" or "deep" | Arc into a depth *band* in the side's third | The band spans the whole short or deep range |
| Run: one of seven gaps (left end to right end), yards | A lane through that gap, length = yards | A corridor with soft edges, no cutbacks |
| Sack, scramble | QB pushed back the yards lost; scramble lane | Same corridor grammar |
| Punt, kickoff, FG (distances in text) | Kick arcs with true distances | Arcs are true in length, generic in height |
| Interception or fumble, spot in text | Turnover mark at the spot, return as a ground stroke | Same stroke grammar |
| Penalty / No Play | Flag at the line, yardage marched; the wiped play stays ghosted | Ghosted play is visibly not counted |
| Prediction (Dallas only) | Category zones and lanes before the snap, weighted by probability | Zones, never routes; no player figures anywhere |

No direction draws 22 players, routes or formations. The ball, the lines and the drawn paths are the actors.

---

## 2. Seven systems this audience knows by heart

Ordered by resonance. Seven material families: coaching paper, film and pro video software, broadcast augmented reality, hand notation, stadium architecture and LED, video game interface, officiating instruments.

1. **The play-caller's laminated call sheet (and the QB's wristband card).** *Coaching paper.* The two-sided, color-coded, laminated sheet the coordinator hides his mouth behind: situation boxes (openers, 3rd and medium, red zone, two-minute), plays ranked inside each box. It resonates because the model is literally a probabilistic copy of this object, and it carries the mechanism directly: the box for this down and distance lights up, his calls ranked inside it, then marked after the snap.
2. **The video coordinator's breakdown and All-22 coaches' film.** *Film and pro video software.* Every play shown from the sideline angle and then the end-zone angle, clicked through on a projector; the cut-up grid of tagged columns (ODK, DN, DIST, YD LN, PLAY TYPE, RESULT, GN/LS) in Hudl, XOS or Catapult. Conor's staff lives in it, and Sam's retag keys are exactly breakdown tagging, so it carries both the replay and the scoring.
3. **The network broadcast package and its virtual graphics.** *Broadcast augmented reality.* The score bug, the down-and-distance flag, the yellow first-down line and blue line of scrimmage painted into the picture, the SkyCam angle behind the offense, and Prime Vision's pre-snap prediction overlays. It is the grammar everyone watches the game through, and TV has already taught viewers to read a machine prediction drawn onto the field before the snap.
4. **X's and O's notation: the playbook diagram, the meeting-room whiteboard, the telestrator.** *Hand notation.* The way football draws a play: marker arrows, dashed motion, painter's-tape grids, magnets, the ghost of last week's erased install, a broadcaster's chalk on a freeze frame. A drawn line openly says "this is a diagram", which is the honest register for paths the feed cannot track.
5. **The stadium on a game night.** *Stadium architecture and LED.* Light towers, the painted field (block yard numerals, hash marks, team end zones), the LED ribbon boards ringing the bowl, the end-zone video board, the classic scoreboard captions HOME, GUESTS, DOWN, TO GO, BALL ON, QTR. Stadium signage is built to be read from 100 yards, which is the TV-across-the-room problem solved at scale.
6. **The video game play-call screen.** *Video game interface.* Three play cards with play art over a 3D field, picked before the snap. A generation of players and staff learned play-calling here, and it reads instantly as "choose the next play". It is listed for resonance but not taken forward as a direction: its play art implies routes the feed does not have, and its look belongs to a commercial franchise.
7. **The officiating kit.** *Officiating instruments and pictograms.* The orange down box with its flip numbers, the two chain poles and the 10-yard chain, the yellow flag, the referee signal chart (touchdown, incomplete, first down, holding). The chain marks the two lines the model reads every snap, and the signal chart is a pictogram set every fan reads instantly, which makes it a native icon language for play results and penalties.

Also considered and set aside: NFL Films' cinematic language (slow-motion spirals, telephoto, grain), which is too slow to read between snaps and is left to a replay moment inside whichever world is chosen; the press-box official gamebook (typewritten play-by-play), which is the data's source but lands on the editorial opposite of the rut.

---

## 3. Five directions

Ordered by resonance (index 1 is the most resonant). Each one is a complete world, viable on the real feed, and carries every item in "Product truth every direction carries". All font families named below resolve on Google Fonts today (checked). All 3D is three.js 0.185.1 from `static/vendor/three` (Line2 fat lines, CSS2DRenderer labels pinned in the scene, EffectComposer with SMAA, bloom only where a direction names it), at 60 fps on Sam's laptop, which also drives the TV by HDMI.

Example values inside the layouts (situations, percentages, scorecard counts) come from the replayed TB at DAL game or stand in for layout only; the build shows nothing the model or the feed does not compute.

Shared key additions, free in the current keymap: **V** cycles camera views, **B** flips or opens the booth side (keypad, flags, tendencies), **Space** plays or pauses Watch this game, **Left/Right** step one snap, **1 to 4** pick 1x, 2x, 4x, 10x in Watch this game (digits stay with the Yards box during manual entry), **G** opens the full scorecard.

---

### Direction 1: Booth Sheet

**The coordinator's laminated call sheet, read from the coaches' booth at night.** His calls are ranked in the box for this down and distance, circled in grease pencil before the snap and checked or crossed after it, beside a booth-window view of the lit field.

Sources: systems 1, 5 and 4.

**Physical scene.** A coaches' booth at press level during a night game: the window is dark except for the lit field, and the sheet on the counter catches the desk light. That forces a night 3D field as the page ground and one bright laminated object as the interface.

**Color strategy: Full palette**, four named roles: laminate ground, ink, highlighter as the situation code, team colors from ESPN.

| Role | Hex | Use |
| --- | --- | --- |
| Laminate | `#F3F4EF` | Sheet ground (cool white, never cream); `#E4E6E0` in the lights-down setting for a dark room |
| Laminate edge | `#FFFFFF` at 55% | 3 px clear border and the one static sheen band |
| Ink | `#121417` | Type, 2 px box rules, grease-pencil marks |
| Graphite | `#767B82` | League numbers and league ticks, as if penciled |
| Highlighter green | `#9BEA62` | 1st down box |
| Highlighter blue | `#7CCBFF` | 2nd down box |
| Highlighter yellow | `#FFE45C` | 3rd and 4th down box |
| Highlighter pink | `#FF7AB6` | Red zone and goal to go (overrides down) |
| Highlighter orange | `#FFA552` | Two-minute (overrides all) |
| Night bowl / haze | `#0A0F1A` / `#1B2436` | 3D surround only |
| Turf / paint | `#2F6E37` and `#357A3D` stripes / `#F1F4EE` | 3D field |
| Line to gain / line of scrimmage | `#FFD400` / `#4A8CFF` | The broadcast convention, kept because everyone reads it |
| Team primary and alternate | from ESPN | End zones, team tabs, play strokes on the field |

**Type.** Sofia Sans Extra Condensed (700 to 900) for box headers, play names and the call, in caps, the way coaches type their sheets; Sofia Sans (400 to 700, tabular numerals) for numbers and notes. One superfamily. No handwriting face: grease-pencil marks are drawn strokes.

**Materials.** Gloss laminate (flat color plus one static sheen band, no texture), highlighter (multiply blend, uneven ends that overshoot the text slightly), grease pencil (waxy strokes with tapered ends and a fine grain), the booth window (the 3D canvas, edge to edge on the left), sheet corners at 18 px radius.

**Component language.** Boxes ruled in 2 px ink like a printed spreadsheet; each box header is a solid highlighter bar with black caps; rows are play name left, percentage right, the probability drawn as an ink underline whose length is the percentage, the league value penciled beside it; up/down flags are grease-pencil arrows; controls are laminated index tabs on the sheet's edge with their keys printed on them. The back of the sheet holds the keypad, the flag menu and his tendencies, because real sheets are two-sided.

**Lettering.** Everything on the sheet in caps ("DEEP SHOT 20+", "INSIDE RUN A/B GAP"); sentence case only for the why notes and ESPN's play text.

**Iconography.** Grease-pencil circle (the prediction), check (top pick right), a small circled 3 (in his top 3), X (miss), arrows (versus league), flag glyph (penalty), tally marks for the scorecard, team logos from ESPN.

**Motion grammar.** Pre-snap: the highlighter swipes across the top call (240 ms, ease-out), then the grease circle draws around it (420 ms) while the matching ghost draws on the field. Snap: the play animates on the field. Verdict: a check or X draws on the row (300 ms) and one tally mark is added. Possession change: the sheet flips (rotateY, 480 ms) to its back when Dallas loses the ball and to its front when the next Dallas drive starts, so the flip itself says who has the ball. Everything else 150 to 200 ms.

**The 3D field.**

- *Light and time:* night. Four light banks (two per sideline) as spot lights with soft shadows at 5600 K, a thin haze in the bowl (exponential fog, low density), bloom only on the light fixtures (high threshold).
- *Grass:* two-tone mow stripes every 5 yards with a micro-noise normal map so the turf catches the light; block numerals and hash marks painted; end zones in each team's primary with its name in the alternate.
- *Camera default:* the booth view: home sideline, press level (about 28 m up, 45 m back), centered on the ball, horizontal field of view about 34 degrees, following the ball with a 600 ms ease. V cycles booth, end zone high behind the offense, and overhead for the drive.
- *Ghost predictions:* before a Dallas snap the top three calls appear on the turf as grease-pencil zones and lanes: the top call filled with the active box's highlighter color at 70%, the second and third as thinner white strokes at 45% and 30%, each with a pinned percentage label. After the snap the predicted zone stays at 15% under the real path until the next snap, so predicted and called sit side by side.
- *Pass arcs:* a leather ball with white laces flies a parabola with a white ribbon tail (Line2, 6 px, fading over 0.6 s); the landing area is a grease-pencil ellipse; YAC is a straight white ground stroke. Runs are lanes in the offense's color at 35% with chalk-white edges.
- *Both teams:* Tampa's plays animate in Tampa's colors with no ghost; the sheet shows its back while Tampa has the ball.

**First viewport, 1440x900.**

- Situation strip, y 0 to 56, full width on the night: logos and scores (Sofia Sans Extra Condensed 34 px, white), quarter and clock (the est. flag penciled in graphite), the down and distance as a highlighter chip in the box's color ("2ND & 7"), BALL ON DAL 38, win probability as a 180x28 white line with the offense's current percentage, the ESPN live dot at the far right.
- Field window: x 0 to 1000, y 56 to 700 (1000x644), the booth view.
- Call sheet: x 1012 to 1428, y 68 to 888 (416x820). Front, top to bottom: the box header bar ("2ND & 7 · DAL 38 · DRIVE 4 · SNAP 23", 22 px); the call ("DEEP SHOT 20+" and "48%", 60 px); the then-line ("THEN SHORT 25% · INTERMEDIATE 14%", 18 px); the pass/run split, 12 px, ink against graphite with the league tick; five family rows (26 px) with his %, the league % penciled, and arrows; the top family's specific plays (16 px rows); the why notes; the box score at the foot (140 px): tally clusters beside "32/59 TOP PICK", "47/59 TOP 3 (LG 48)", "PASS/RUN LOG LOSS .421 v LG .424".
- Under the field, x 16 to 1000: the drive strip (y 712 to 776), each play a segment on a 100-yard scale aligned to the field's own yard lines, the result word at its end; below it the last three plays as booth-monitor rows (30 px): down and distance, ESPN's text shortened, yards, the drawn verdict mark.
- Entry: with the feed off, a 72 px band at the foot of the front side holds the key tabs (J K L, P A N, O, I S C, X) and the yards box; with the feed on, the same band is the retag row under the last play (A N O P, J K L, U). B flips to the back for the full flag menu and tendencies.
- Watch this game: index tabs along the bottom edge of the field window: play/pause, 1x 2x 4x 10x, step, and the drive list as the scrub.

**First viewport, 1920x1080 (TV).** Situation strip 72 px (scores 44 px); field 1340x800; sheet 540x968 with the call at 96 px, family rows 36 px, only the top family's specific plays expanded, box score numbers 28 px; drive strip 1340x80 plus the last two plays at 26 px. Nothing below 20 px.

**Signature moment: the circle.** Before every Dallas snap the model highlights its call in the box and draws a grease-pencil circle around it, and the same circle appears on the turf. The ball flies. A check or an X is drawn on the row, and the ghost stays faint under the real path. By halftime the sheet is covered in circles, checks and crosses like a used call sheet. What Conor says an hour later: "It had his call sheet on screen and circled the next play before the snap, then checked it off."

**Cross-surface reach.** The graded sheet exports as a one-page image for the pitch email; the situation-box layout becomes a tendency sheet for any caller from the profile's by-down data; a pregame scout sheet; the college port keeps the sheet and drops to run/pass.

**Honest risk.** A bright sheet beside a dark field is a luminance jump in a dark room (the lights-down laminate is required, not optional). Skeuomorphism can slide into kitsch: no desk props, no paper grain, no fake fingerprints. Real sheets list named concepts and ours has 14 coarse plays, so the box can look sparse; it fills with his situation tendencies, never invented play names. On a projector the night field turns murky and needs a demo exposure lift (about +0.5 EV).

---

### Direction 2: Cut-Up

**The video coordinator's breakdown session.** Every snap is a clip shown from the sideline and then the end zone on a projected 3D "coaches' copy" film, the model's pre-snap read is drawn over it in telestrator chalk, and the breakdown grid below logs, tags and grades each play.

Sources: systems 2 and 4.

**Physical scene.** A film room with the lights off and the projector on: the brightest thing in the room is the film, the grid is lit but quieter, and at home it is the same laptop on the same dark night. That forces a lifted projector black as the ground (not near-black) and the film as the brightest object on screen.

**Color strategy: Restrained.** Projector neutrals plus one drawn accent; team colors appear only in the ODK chips and the end zones.

| Role | Hex | Use |
| --- | --- | --- |
| Projector black | `#27292D` | Ground: the lifted black a projector actually throws |
| Panel / grid rule | `#303237` / `#3F4248` | Pre-snap column, grid |
| Text / muted | `#ECEDE8` / `#A4A9B0` | All type |
| Selected row | `#ECEDE8` ground, `#17181A` ink | The current play is an inverted row, never a colored side stripe |
| Burn-in box | `#000000` at 78% | Data burned into the film, as on coaches' video |
| Telestrator yellow / white / red | `#FFE14D` / `#F7F7F2` / `#FF5A4E` | Drawn strokes only, never chrome, borders or glows |
| ODK chips | O = possession team primary (ESPN, lifted to 4.5:1 with its text), D = opponent primary, K = `#D9B44A` | The breakdown's tag column |
| Film turf / paint / stands | `#55704C` and `#5B774F` stripes / `#E8ECE4` / `#1E2024` | 3D |

**Type.** Atkinson Hyperlegible Next (400, 600, 800) for everything, chosen for reading across a room (distinct 1, l and I, open counters); Atkinson Hyperlegible Mono only for the film timecode and right-aligned numeric columns, at reading size, never as small tracked labels.

**Materials.** Projected film (the 3D render with a 6% corner falloff and a soft projector lift on whites through a ShaderPass, no grain), matte software panels, burn-in data boxes, telestrator ink (pressure-tapered strokes with a slight jitter, drawn at hand speed).

**Component language.** The breakdown grid: sticky header; 32 px rows on the laptop, 44 px on TV; columns # · Q/CLOCK · ODK · DN · DIST · YD LN · PLAY TYPE · PRED (his top call and %) · RANK · GN/LS · RESULT. Drives are grid section headers with a mini yardage strip ("DRIVE 4 · 9 PLAYS · 70 YDS · 4:09 · TD"). Filter chips (3RD DOWN, RED ZONE, MISSES, PLAY-ACTION) build a cut-up and replay it in the film. The transport bar and the SL / EZ angle buttons belong to the film.

**Lettering.** Grid headers in caps at 13 to 14 px with no added tracking; play text in sentence case as ESPN writes it; the call in 800 weight, never in caps lock across a whole sentence.

**Iconography.** Transport glyphs (frame step, play, fast forward), angle letters SL and EZ, ODK letters, telestrator strokes (circle, arrow, X). Verdict by shape, not color: filled square for the top pick, half-filled for in his top 3, hollow for a miss.

**Motion grammar.** Film-native: hard cuts between angles, never crossfades; frame-step and scrub. Telestrator strokes draw at hand speed (350 ms) and wipe off before the next snap (200 ms). New grid rows insert at the top in 150 ms. On the verdict the film freezes for 600 ms while the chalk circles the landing.

**The 3D field.**

- *Light and time:* "coaches' copy": even, flat stadium light (hemisphere light plus a high key, soft shadows off), the night game rendered without drama, no bloom.
- *Grass:* desaturated stripes, crisp numerals and hashes, team end zones, dark stands as simple tiers.
- *Cameras:* SL (press-level sideline framed to a 40-yard window around the line of scrimmage, the All-22 width) and EZ (end zone high, behind the offense, looking downfield). Default: SL main with EZ inset; each snap plays SL, then cuts to EZ. Two renders per frame through scissor viewports.
- *Ghost predictions:* the telestrator pre-snap read: the top call as a solid yellow chalk zone or arrow with "48%", the second and third as thin white dashed chalk, all lying on the turf plane.
- *Pass arcs:* a white ball tracer (Line2, 4 px), the landing area circled in white chalk, YAC as a straight chalk stroke; runs as chalk arrows through the gap lane; a miss gets a red chalk X over the yellow read.

**First viewport, 1440x900.**

- Film: x 0 to 1040, y 0 to 585 (16:9). SL angle, with the EZ inset at 288x162 in its lower right. Burn-in at top left: "Q2 08:41 · DAL · 2 & 7 · DAL 38 · PLAY 0034" (white on black, 15 px mono).
- Win-probability scrubber along the film's bottom edge (1040x40): the win-probability line is the game timeline, drive boundaries are ticks, and dragging it scrubs the game. Transport sits at its left (Space, Left/Right, 1x to 10x).
- Pre-snap column: x 1040 to 1440, y 0 to 585, on the panel color: "PRE-SNAP READ · SCHOTTENHEIMER" (14 px); the call at 56 px weight 800 with its %; the then-line; the pass/run split; five family bars (his in white, the league as an outline tick); the top family's specific plays; the why lines.
- Grid: x 0 to 1440, y 585 to 900: header plus eight rows, then a footer with the totals: "TOP PICK 32/59 · TOP 3 47/59 (LG 48) · PASS/RUN LOG LOSS .421 v .424 · CALLED RIGHT 85% v 81%".
- Entry: a TAG command line at the left of the grid footer (the shorthand bar with key hints). B opens the keypad as a 240 px drawer over the grid, with the flag menu inside it. In feed mode a retag edits the PLAY TYPE cell of the newest row in place, and the cell flashes a yellow chalk underline for 400 ms.

**First viewport, 1920x1080 (TV).** Film 1386x780 with the EZ inset at 384x216; pre-snap column 534 wide with the call at 84 px; grid 1920x300 with five 44 px rows (fewer, bigger rows on TV) and footer totals at 26 px.

**Signature moment: every play twice.** After each snap the clip runs from the sideline, hard-cuts to the end zone, and the telestrator lays the pre-snap read (yellow) against what happened (white), freezing on the landing; then the breakdown row lands with its verdict. What Conor says an hour later: "It was a film session: the model drew its read on the film before the snap and graded itself in the breakdown."

**Cross-surface reach.** Filter chips turn the grid into cut-ups (every 3rd down, every miss) that replay in the film, which is self-scout in Conor's own vocabulary; the grid exports through the existing CSV route; a printed cut-up report; the college port maps straight onto Hudl column names.

**Honest risk.** The darkest direction, and a projector lifts dark grays toward mud, so it needs a room test. Two angles per play double the render work and can feel busy on a laptop (V hides the inset). The pro-tool look reads as unglamorous unless the film render is excellent. The grid tempts toward spreadsheet density that buries the next call, which must stay the largest thing on screen.

---

### Direction 3: Network Package

**A complete TV graphics package for a shadow analytics unit.** The offense's team color drenches the overlays, the 3D field is a broadcast picture with virtual lines, and the predicted call is painted onto the turf like the first-down line before every snap.

Sources: systems 3 and 7.

**Physical scene.** A big TV in a bright meeting room, or full screen on a laptop on the couch: the screen should look like football television, opaque graphics over a lit field, legible from across the room. That forces a bright field picture with opaque, high-contrast graphics and no dark interface chrome at all.

**Color strategy: Committed.** The offense's primary carries 30 to 60% of the graphics and changes on possession with a wipe; package white and ink do the rest; the yellow is reserved for the line to gain.

| Role | Hex | Use |
| --- | --- | --- |
| Offense primary / alternate | from ESPN (tonight DAL `#002A5C` / `#B0B7BC`) | Pre-snap tower, bug segments, AR paint |
| Defense primary / alternate | from ESPN (tonight TB `#BD1C36` / `#3E3A35`) | Its bug segment, its plays |
| Package white / steel / ink | `#F7F8FA` / `#CDD3DB` / `#0B0E13` | Bars, lower thirds, text |
| Line to gain / line of scrimmage | `#FFD100` / `#2C6BFF` | Virtual lines in the picture, the down-and-distance flag |
| Estimate hatch | offense color at 40% with 45 degree white hatching, 6 px pitch | The package's one mark for "estimated" |
| Picture | turf `#2E7A36` and `#348540` stripes under 6000 K light, paint `#F4F6F2`, sky `#06090F` | 3D only |

When a team's primary has less than 3:1 contrast against the night picture or white, the package swaps in its alternate. Verdicts read by word and shape: HIT is a white slab with a yellow edge, MISS an ink slab.

**Type.** Anybody (variable: width 50 to 150, weight 100 to 900), one family for the whole package: expanded (width 130, weight 900) for scores and the call, normal (width 100, weight 700) for names, condensed (width 70, weight 600) for labels and the drive tracker; tabular numerals throughout.

**Materials.** Flat opaque slabs with 12 degree cut ends, no gloss, no glass, no glow, no gradients, no bevels; team logos on white roundels; augmented-reality paint inside the 3D picture (decals that sit in the grass under the stadium light).

**Component language.** Score bug (bottom center); down-and-distance flag (a yellow chip hanging off the bug); drive tracker (top bar: the drive's plays as segments over a 100-yard scale, the result at the end); the pre-snap read tower (left, offense color); lower thirds for results (right); the full-screen stat card for the scorecard (G); the possession stinger; the keypad as a producer's switcher (rows of buttons with tally lights, a lit tally marking the armed key).

**Lettering.** Caps for labels and team abbreviations, title case for play names, numbers always expanded.

**Iconography.** Referee signal pictograms for results (touchdown, incomplete, first down, flag, turnover), drawn in one 3 px stroke weight; team logos from ESPN; the possession arrow.

**Motion grammar.** Broadcast in and out: elements wipe in on angled masks (240 ms, expo-out), hold, and wipe out (180 ms). The possession stinger is a team-color slab sweep with the logo (600 ms, skippable, instant under reduced motion). Changing numbers roll (200 ms). The painted call fades into the grass (300 ms) at the pre-snap moment.

**The 3D field.**

- *Light and time:* night under bright, even broadcast light (two light rigs), ACES tone mapping with the exposure lifted for a TV look, crisp shadows only from the goalposts.
- *Grass:* lively broadcast green with mow stripes and painted numerals; team end zones; the yellow line and line of scrimmage are decals painted into the turf, never floating.
- *Cameras:* broadcast high home (press level at the 50, follows the ball laterally, field of view 28 degrees) by default; SkyCam behind the offense (about 12 m up, behind the quarterback) for the snap and every pass arc; a reverse angle for replays. Camera moves 700 ms ease-in-out.
- *Ghost predictions:* the painted call: the top call's zone painted into the grass in the offense color with the estimate hatch, its name and percentage lettered flat on the turf ("DEEP SHOT 48%"); the second and third as outlined zones at lower opacity; a run call paints its gap lane as a hatched corridor.
- *Pass arcs:* the ball with a white comet trail (fading over 0.5 s) and a landing ring that pulses once; a completion marks the catch area with a solid ring, an incompletion with a hatched band.

**First viewport, 1920x1080 (TV, the package's native size, inside the 90% title-safe area).**

- The broadcast picture, full bleed.
- Drive tracker: x 96 to 1824, y 54 to 102 (1728x48).
- Pre-snap read tower: x 96 to 576, y 150 to 822 (480x672), drenched in the offense color: "SHADOW READ · SCHOTTENHEIMER"; the call at 88 px expanded with its %; the then-line at 28 px; the pass/run split; five family bars with league ticks; the why lines.
- Lower-third stack: x 1344 to 1824, y 560 to 822: the last three plays, newest on top, 80 px each: result pictogram, ESPN text, yards, verdict slab.
- Win probability: x 1584 to 1824, y 122 to 212, under the tracker.
- Score bug: x 480 to 1440, y 930 to 1002 (960x72): logos, scores at 44 px, quarter and clock, the down-and-distance flag above it, the possession arrow, and a "SHADOW 32/59" segment that opens the stat card.
- Keypad: B slides the producer's switcher up from the bottom (1728x260). In feed mode the retag keys appear as a four-button switcher row above the bug for 8 seconds after each Dallas play.

**First viewport, 1440x900 (laptop).** The package scales to 0.75 (1440x810) and the extra 90 px above the picture hold the drive tracker; the call at 66 px; the lower thirds trimmed to two.

**Signature moment: the painted call.** Before each Dallas snap the predicted call is painted onto the grass like the first-down line, hatched because it is an estimate, with its percentage lettered on the turf. The real ball flies over it and lands in it or outside it, and the bug slams HIT or MISS. What Conor says an hour later: "It painted its prediction on the field like the yellow line, and the ball either landed in it or it didn't."

**Cross-surface reach.** Screen recordings are the demo artifact, built at 1080p inside title-safe; stills for a pitch email or LinkedIn; a pregame matchup card; any team's colors from ESPN; the college port keeps the package at run/pass level.

**Honest risk.** It is closest to what networks already air, so the bar is real broadcast craft and anything less reads as a knock-off. It must not imitate any network's marks, names or graphic shapes. The painted zone implies spatial precision the feed lacks unless the hatching and zone language hold everywhere. On a laptop the stacked overlays compete with the next call. Dark primaries against the night picture need the alternate-color rule.

---

### Direction 4: Install Room

**The game plan taught at a whiteboard.** The field is a white clay architectural model standing on a white board; every play is drawn on it in the possessing team's dry-erase marker, the model's call in black marker before the snap, and erased plays leave their ghosts behind.

Sources: system 4, joined to the architect's white study model.

**Physical scene.** A meeting room in daylight with a projector or a big TV on the wall and the whiteboard beside it; and Sam's laptop at night, where the board dims. That forces a light world (white board, white clay) that projects cleanly, with a lights-down variant for the dark room.

**Color strategy: Restrained.** A white world, black marker for structure and for the model's calls, the possessing team's color as the only saturated stroke, painter's-tape blue for structure.

| Role | Hex | Use |
| --- | --- | --- |
| Board / ghost residue | `#F5F6F4` / `#E2E5E1` | Ground (cool white, never cream) and the residue of erased plays |
| Lights-down board | `#DADDD8` | Night setting for the laptop; marker black unchanged |
| Clay / ambient-occlusion shadow | `#E9EBE9` / `#B7BCBE` | The field model |
| Aluminum frame | `#BCC1C5` | Board edge, 4 px |
| Marker black | `#1C1E20` | Text, the model's call, structure |
| Painter's tape | `#3B8FD9` | Dividers and grids, 6 px with torn ends |
| Team markers | possessing team's primary from ESPN (alternate if under 3:1 on white) | Actual plays |
| Verdict markers | hit `#1F9D55`, miss `#D93636` | Always with a check or an X |

**Type.** Schibsted Grotesk (400 to 900) for every label, number and button; Permanent Marker only for marker annotations (the note beside the circled call, verdict words, drive notes), never for data or controls.

**Materials.** Matte white clay with engraved yard lines and debossed numerals; soft window daylight; a gloss whiteboard with faint ghosting; painter's tape; round and bar magnets with real contact shadows; marker strokes with tapered ends and slight streaking.

**Component language.** Board sections divided by painter's tape; the next call written large; probability bars as round-capped marker strokes; buttons as bar magnets with their keys printed on them; toggles as sliding round magnets; the keypad as a magnetic strip; the flag menu as a taped board section.

**Lettering.** Labels in Schibsted caps at 600; the call in Schibsted 900; handwritten marker only where a coach would write by hand.

**Iconography.** X's and O's, marker arrows, the blocking T, dashed motion lines, check and X, the magnet as the ball marker.

**Motion grammar.** Marker strokes draw on at hand speed (300 to 450 ms, tapered); an erase is a smear wipe (200 ms) that leaves 8% residue; magnets slide and snap (160 ms with a 2 px overshoot); the camera orbits like walking around a table model (700 ms ease-in-out); everything else 150 to 200 ms.

**The 3D field.**

- *Object:* the field as a 120 by 53.3-yard white clay slab on a shallow plinth, standing on the board: engraved lines, debossed numerals, small white goalposts, team end zones as a light wash of their marker color.
- *Light and time:* daylight, always: RoomEnvironment image-based light (a soft window) plus one key light at 40 degrees with soft shadows (PCF soft, 2048 map), contact shadows under every arc, no bloom, SMAA.
- *Camera default:* the table view from behind the offense's sideline corner (50 degrees elevation, 30 degrees yaw), a limited orbit by drag; V cycles table, sideline and overhead.
- *Ghost predictions:* black marker drawn on the clay before the snap: the top call bold with a marker circle and "48%" in Permanent Marker on a pinned label; the second and third as thinner dashed black marker.
- *Pass arcs:* a raised marker ribbon in the team color (a tube about 0.3 yards thick) whose soft shadow falls on the clay, which shows the arc's height honestly; the landing is a hand-drawn marker loop; YAC a flat marker stroke; runs fat marker arrows through the gap lane. After the next snap each stroke is erased to an 8% ghost.

**First viewport, 1440x900.**

- Board ground, edge to edge, framed by tape.
- Top bar, y 0 to 60: the situation in Schibsted 30 px ("DAL 16 · TB 24 · Q4 1:22 · 2 & 1 · TB 24"), the ESPN live magnet at right.
- Model: x 24 to 940, y 72 to 640 (916x568).
- Call column: x 964 to 1416, y 72 to 640: a taped "NEXT CALL" header; the call in black at 60 px with its %; the marker note; the then-line; the pass/run split; family bars in marker; why notes in marker.
- Bottom band, y 660 to 888, in a taped box: at left (620 px) the drive tracker (a yard scale with a marker segment per play and the result word) and the last four plays; at right the tally scorecard (marker tally clusters beside 28 px numbers) and the win-probability line drawn in marker.
- Entry: a magnet strip under the call column when the feed is off; retag magnets under the last play when the feed is on; B slides the taped flag-and-tendencies section over the call column.

**First viewport, 1920x1080 (TV).** Model 1260x760; call column 600 wide with the call at 92 px; bottom band 240 px; marker annotations at 30 px or larger.

**Signature moment: the ghost board.** The model writes its call in black marker before the snap, the play is drawn in team marker on the white model, and at the next snap the board is wiped but each play leaves a faint ghost: by the end of a drive the field carries the drive, and by the final whistle a ghost map of the whole game. What Conor says an hour later: "It drew every play on a white 3D model like a coach at a whiteboard, and the old plays stayed as ghosts."

**Cross-surface reach.** The end-of-game ghost map exports as a poster image; install-style slides for the pitch; the cleanest of the five on a projector; any team's marker colors from ESPN; the college port is natural, since every staff teaches at a whiteboard.

**Honest risk.** The white world is bright on a laptop at night, so the lights-down board is required. The clay model's calm can read as slower than a live broadcast. Handwriting faces tip into cute when overused. Marker strokes can read as real routes unless they stay lanes and zones. Silver alternates and pale primaries vanish on white and need the contrast rule.

---

### Direction 5: Under the Lights

**The stadium itself is the interface.** A lit field inside a dark bowl, the next call projected onto the turf before each snap like a pregame light show, the play feed on the LED ribbon boards, and a second scoreboard where SHADOW plays LEAGUE.

Sources: systems 5 and 7, with the line to gain from 3.

**Physical scene.** The demo on a big TV with the room lights dimmed, and Sam's night-game laptop: the screen as a window into the stadium. That forces dark surroundings lit only by their own fixtures, with every piece of chrome made from the stadium's own surfaces. The light follows the real kickoff time from ESPN: night games under the lights, day games in afternoon sun with the stadium's shadow line across the turf.

**Color strategy: Drenched.** The surface is the stadium, colored by its fixtures; the team color owns the painted scoreboard.

| Role | Hex | Use |
| --- | --- | --- |
| Night sky / bowl haze | `#0D1424` / `#26314C` | 3D surround, deep blue, never a black UI ground |
| Light-cone white | `#F4F1E6` | Light towers, the lit field's falloff |
| Turf / paint | `#3F8C3B` and `#46983F` stripes / `#F5F7F2` | 3D field |
| LED panel / warm white / amber / unlit pixel | `#0F1114` / `#FFF3D1` / `#FFB21E` / `#2A2622` | Ribbon boards and video board; unlit pixels stay visible |
| Scoreboard steel | offense primary from ESPN, captions `#FFFFFF` | Painted cabinet |
| Segment digits | lit `#FFB21E`, unlit `#3A2E1C` | Scores, clock, down, to go, ball on |
| Pylon orange / line to gain | `#FF6A13` / `#FFD400` | 3D |

Bloom exists only on 3D fixtures and the ball tracer. Every interface panel is opaque.

**Type.** Big Shoulders: the Display cut for scoreboard captions and scores, the Text cut for every label and button (condensed Chicago-born signage lettering). Doto (variable dot-matrix) for LED readouts at 40 px and larger only; below that, LED boards set Big Shoulders Text in warm white.

**Materials.** Flat painted steel (the scoreboard cabinet, no rivets, no texture), LED panels with a visible pixel pitch (a pixel-grid shader at 3 to 4 px), light towers with bloom, haze, the painted field, foam pylons.

**Component language.** Ribbon boards: full-width bands 44 to 56 px high with the pixel texture, where text steps in from the right and holds (never a continuous crawl). The video board: the next-call panel. The scoreboard band: captions and segment digits (HOME, GUESTS, QTR, TIME, DOWN, TO GO, BALL ON). The second scoreboard row: SHADOW against LEAGUE, with the pairs the scorecard computes (called right, top 3, log loss) as the "scores". The control-room drawer for keys.

**Lettering.** Painted captions in Big Shoulders Display caps; LED copy in caps; numbers in segments wherever a real scoreboard would use them.

**Iconography.** Pixel glyphs on a 9 by 9 grid for results (TD, INC, 1ST, FLAG, turnover); referee signal pictograms on the video board for big results; team logos on the board.

**Motion grammar.** LED steps (frame-by-frame at a 12 fps feel) for ribbon changes; the projected call fades up in scanlines (400 ms); the lights dip 20% around the projection and come back at the snap (300 ms); segment digits snap with no tween; in Watch this game the camera drifts like a blimp between drives and locks to the ball at the snap.

**The 3D field.**

- *Object:* the full bowl: tiered stands as dark low-poly rings carrying LED fascia ribbons (diegetic copies of the interface ribbons), four light towers, exponential haze, the painted field with team end zones and names, orange pylons, goalposts.
- *Light and time:* night: four spot lights with soft shadows, warm white, bloom on the fixtures only (UnrealBloomPass with a high threshold). Day: afternoon sun with the rim's shadow line across the field (a simple rim mesh casting into the shadow map).
- *Camera default:* a wide high home that includes the first ring of stands (field of view 34 degrees); the snap cuts to a tighter press-level view; V cycles wide, tight and blimp.
- *Ghost predictions:* projection-mapped onto the turf: a deliberately low-resolution pixel projection (the coarse pixel grid itself says "approximate") of the top call's zone in LED warm white with its name and percentage; the second and third as dimmer pixel outlines.
- *Pass arcs:* the ball as a bright tracer with a short spark trail; the landing as a pixel ring; runs as a projected pixel lane.

**First viewport, 1440x900.**

- The bowl, full bleed.
- Upper ribbon, y 0 to 44, full width: the play feed, each play stepping in and holding ("Q2 8:41 · DAL · PASS SHORT RIGHT TO LAMB +8 · TOP PICK HIT").
- Video board (the next call): x 1000 to 1416, y 64 to 388 (416x324): the painted caption "NEXT CALL" above it; the call in Doto at 64 px with its %; the five families as LED bars with league ticks. D expands it to 600x560 with the specific plays and the why lines.
- Lower ribbon, y 716 to 756: the drive chart as LED segments on a 100-yard scale, with the win-probability line at its right end.
- Scoreboard band, y 760 to 900, full width, painted in the offense's color: row one DAL and TB scores, QTR, TIME, DOWN, TO GO, BALL ON; row two SHADOW against LEAGUE, showing only the pairs the scorecard computes (called right 85% against 81%, actual play in the top 3 47 against 48, pass/run log loss .421 against .424).
- Entry: B opens the control-room drawer from the left (keypad, flags, feed, watch transport); in feed mode the retag keys flash on the lower ribbon for 8 seconds after each Dallas play.

**First viewport, 1920x1080 (TV).** Video board 560x430 with the call at 88 px; scoreboard band 180 px; ribbons 56 px.

**Signature moment: the projection.** Before each Dallas snap the stadium lights dip, the predicted call is projected onto the turf in coarse light pixels with its percentage, the lights come up at the snap, the ball's tracer flies through or past it, and the SHADOW against LEAGUE scoreboard ticks. What Conor says an hour later: "The stadium itself projected the prediction onto the field before every snap, and the model had its own scoreboard against the league."

**Cross-surface reach.** The most cinematic screen recording of the five; the kickoff-time light makes every game look like its own night or afternoon; the SHADOW against LEAGUE scoreboard is a reusable device for a pitch deck; a college stadium variant.

**Honest risk.** It sits closest to the dark-with-glow default and survives only if every glow is a physical fixture and every panel is opaque. Dot-matrix type loses legibility below 40 px and on projectors. Dimming the lights every snap can wear on Sam over a three-hour game (live mode needs a setting that skips the dip). The bowl with bloom is the heaviest GPU load of the five. A projector washes out a dark bowl. The league side has no top-pick count in the current scorecard, so that row must never fill a pair the model does not compute.

---

## 4. Calibration self-checks

Checked against `new-work.md` "Calibration": the three AI-default looks (warm cream ground, high-contrast serif display and a terracotta or signal-red accent; near-black with one neon accent and glowing edges; broadsheet hairlines, italic display serif and small tracked mono labels), the category guess ("football analytics app" gives the dark neon dashboard) and the category-plus-avoidance guess ("not a dark dashboard" gives the light data-journalism page). Where a direction failed or nearly failed, the rework is stated.

| # | Direction | One of the three defaults? | Guessable from category, or category plus avoidance? | Verdict and rework |
| --- | --- | --- | --- | --- |
| 1 | Booth Sheet | No. Cool laminate white, condensed grotesk caps, a five-color highlighter code, 2 px ink rules; no serif, no italic, no mono, no glow (the night is a 3D scene, the interface is an opaque bright object). | No. Category gives a dark dashboard; avoidance gives editorial paper. A laminated, highlighter-coded coaching sheet is neither. | **Pass.** Rendition watch: a paper sheet invites cream card stock and a typewriter face, which is the editorial opposite wearing coaching clothes. Ruled out up front: laminate stays `#F3F4EF` (cool), type stays condensed caps, annotations stay drawn strokes. |
| 2 | Cut-Up | Near the second default: a dark ground with a yellow accent. | "Dark sports tool" is a guessable answer, so it is the second most exposed direction, after Under the Lights. | **Pass, conditional; reworked.** The ground is lifted projector black `#27292D`, not near-black; the yellow exists only as drawn telestrator ink, never on borders, buttons or glows; selection is row inversion, not an accent stripe; there are no glows or gradients anywhere. It fails at execution if any chrome picks up the accent, the ground drifts darker than `#1E1F22`, or a glow appears. |
| 3 | Network Package | No. A lit field picture, opaque team-color and white slabs, a width-axis grotesk; no glow, no serif, no hairlines. | Not from the category (that guess is the dark dashboard). It does speak the category's own TV language, which the brief asks for ("like ESPN GameCast"), so the brief wins here. | **Pass.** Execution watch: generic "sports graphics template" devices (chrome bevels, lens flares, glass, gradients) are banned in this world; flat slabs only. |
| 4 | Install Room | No. Cool white board and clay, black marker, tape blue, a sturdy grotesk; no cream, no serif, no italic, no hairlines (tape and marker are heavy). | No. Neither the dashboard nor its paper opposite; a whiteboard and a clay model are their own register. | **Pass.** Rendition watch: the light-world prior pulls toward warm cream and lamplight. The clay is `#E9EBE9` (neutral), the light is daylight from RoomEnvironment, and no warm cast is allowed in the IBL or the board. |
| 5 | Under the Lights | Borders the second default: dark surround, emissive light. | "A stadium at night" is guessable for a sports 3D piece; the stadium-signage interface and the SHADOW against LEAGUE scoreboard are not. | **Pass, the strongest conditions; reworked.** The sky is deep blue with haze (`#0D1424`, `#26314C`), never a black interface ground; glow exists only on physical fixtures and the ball tracer; panels are opaque painted steel or LED with visible unlit pixels (a material, not a glow); LED hues are warm white and amber, never neon; day games render in sunlight. It fails at execution if any panel glows, any neon hue appears, or the bowl goes black. |

None of the five is the rut or its opposite, and the five span five materially different worlds: laminated coaching paper over a night window, a projected film room, a broadcast picture with painted graphics, a white clay model with marker, and the stadium's own lights and signage.
