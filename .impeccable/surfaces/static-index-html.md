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

Under the Lights (DESIGN.md; docs/design/direction-contract.md): the stadium is the interface. The memorable moment is **the projection**: before every Dallas snap the lights dip, the call lights up on the turf in coarse pixels with its name and percentage, the lights come back at the snap, the ball's tracer flies through or past it, and the SHADOW v LEAGUE scoreboard ticks.

## Unresolved decisions

1. **Camera safe area.** The board column covers the right 456 px (1440) or 624 px (1920); `camera-plan.poseFor` takes margins, but neither `Engine` nor `Look` can pass HUD insets yet.
2. **Day or night by kickoff.** `Look` is static. Day games need a variant (lights, sky, fog, exposure) chosen at `setGameFrame` from the kickoff, or `props` owning the lights and sky.
3. **Camera choreography.** The snap cut to tight, the settle back to wide, and the blimp drift between drives in Watch this game are not expressible in `look.cameras` modes.
4. **Light dip setting.** World moments do not receive the app mode; read `#app[data-mode]` and an `sc:uls:` setting, or extend the moments context.
5. **Room lights.** `data-ambient="room"` should lift the scene about +0.5 EV; the engine has no ambient hook.
6. **Board expansion.** Hover or focus inside the board expands it for now; a D key (`toggleBoard`) needs an intent in the keymap.
7. **Timed LED behavior.** Ribbon paging for long ESPN text, and the retag keys lighting for 8 s after each caller play, need a small piece of JS (component or world).
8. **Unrolling ribbons.** The play feed and the drive chart unroll into taller LED boards on hover or focus (CSS `:hover` and `:focus-within`); check that focus order stays logical once `arrange` has placed every region.
9. **Scoreboard pairs.** The band's row two shows three of `scorecardVm().pairs`; the scorecard component needs per-pair hooks (pair id, leader) so CSS can place them.
10. **Provisional values.** Day palette, fog density, camera rigs and the light shafts settle on the first render. No visual comps were produced in this seed; the first build is checked with Playwright renders at 1440x900, 1920x1080 and 390x844 against DESIGN.md.
