---
version: 1
slug: "static-index-html"
primary_target: "static/index.html"
related_targets: []
---

# Surface brief: the GameCast page (static/index.html)

## Scope and mode

The whole single page: the live play-caller console and its demo playback, one HTML page with no build step. Mode: **Operate**, carrying demo weight. The next call, the situation and the keys may never be hidden by expression.

## Audience and job

- **Sam, live:** a laptop in a dark room beside the broadcast, 25 to 40 s between snaps, hands on the keys. Job: read the next call in a glance, retag what ESPN cannot see (A, N, O), fall back to manual entry when the feed fails.
- **Conor, demo:** a meeting-room TV at 8 to 14 ft, a finished game in Watch this game at 4x to 10x, maybe with no narration. Job: see that the call was up before the snap, that the snap was drawn honestly, and that SHADOW is scored against LEAGUE.
- **Proof on hand:** the saved TB at DAL game (401872980), 59 Dallas snaps: called right 85% v 81%, actual play in his top 3 47 v 48, pass vs run log loss .421 v .424. Every number comes from the model or the feed.

## Direction and memorable moment

Under the Lights (DESIGN.md; docs/design/direction-contract.md): the stadium is the interface. The memorable moment is **the shadow plays**: before every Dallas snap the lights dip and the top 2 most likely plays appear on the turf as dashed, translucent shadow plays (a pass as an arc, a run as a straight line) with "1 · Deep shot (20+) · 31%" text underneath (docs/design/play-drawing.md, Sam's binding direction); the lights come back at the snap, the real play draws solid from the line of scrimmage with its label, and the SHADOW v LEAGUE scoreboard ticks.

## Settled since the seed (as built, 2026-10-10)

1. **Camera safe area:** the HUD announces its insets (`sc:hud-insets`, `arrange.js`) and the camera keeps the line of scrimmage and the shadow plays clear of the board column and the open drawer.
2. **Day or night by kickoff:** `game.light` from the kickoff's local hour; the stage swaps in the day look (`stage.js` `lookForGame`).
3. **Camera choreography:** the snap's push to tight, the settle back to wide, the hold on a score and the blimp drift between drives (`stadium/choreo.js`, `choreo-plan.js`, `drift.js`).
4. **Light dip setting:** `booth.js` `shouldDipNow` reads the mode and `sc:uls:dip-live`; Watch this game always dips.
5. **Room lights:** `data-ambient="room"` lifts exposure 0.5 EV (`field/lighting.js` `ROOM_EV`).
6. **Timed LED behavior:** the retag keys light for 8 s (`last-play.js` `RETAG_FRESH_MS`); the ribbons step and dwell (`look.world.uls.ribbons`).
7. **Scoreboard pairs:** the band's row two shows the three pairs, captioned "Run/pass right", "Play in top 3", "Pass vs run log loss".
8. **The next call's time in Watch this game:** at least 2 s fully up before every Dallas snap up to 4x, about 1.5 s at 10x (data contract E3; ui-architecture 23.1).
9. **Provisional values:** settled in DESIGN.md (as built).

## Open (known, owned elsewhere)

1. The masthead's game name truncates at 1440.
2. The scoreboard band stays Dallas navy after the game ends.
3. 2D fallback: the shadow plays are small at full-field scale, and a play stands still while the 2D camera eases (`fallback-player.js` `remount()` resets the play clock; ui-architecture 23.1).
4. On the phone the two shadow labels can stack #2 above #1.
5. The pre-snap camera frames the old zone shapes rather than the shadow plays.
6. A very long team name (the server caps it at 40 characters) overruns the band's team cell; the cell needs ellipsis truncation.
7. Board expansion by key (a `D` intent in the keymap) is still hover or focus only.
