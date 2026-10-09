---
name: Shadow Play-Caller
description: "Under the Lights: the stadium is the interface. A lit field in a night bowl, the next call projected onto the turf before the snap, the plays on LED ribbon boards, and a second scoreboard where SHADOW plays LEAGUE."
colors:
  night-sky: "#0D1424"
  bowl-haze: "#26314C"
  light-cone-white: "#F4F1E6"
  turf-mow-dark: "#3F8C3B"
  turf-mow-light: "#46983F"
  field-paint-white: "#F5F7F2"
  line-to-gain-yellow: "#FFD400"
  line-of-scrimmage-blue: "#4A90FF"
  pylon-orange: "#FF6A13"
  goalpost-gold: "#FFC425"
  day-sky: "#A9C4DF"
  day-haze: "#D6E0EA"
  afternoon-sun: "#FFF1DA"
  led-panel: "#0F1114"
  led-unlit-pixel: "#2A2622"
  led-warm-white: "#FFF3D1"
  led-gold: "#FFD27A"
  led-amber: "#FFB21E"
  led-dim: "#B9AD92"
  segment-lit: "#FFB21E"
  segment-unlit: "#3A2E1C"
  tally-red: "#FF4D3D"
  lamp-green: "#7DDB6A"
  caption-white: "#FFFFFF"
  caption-dark: "#000000"
  scoreboard-steel-neutral: "#33405C"
  fascia-steel: "#1C2333"
  fascia-steel-raised: "#283149"
  steel-seam: "#2E374D"
  steel-edge: "#4A5571"
  scrim-night: "#0D1424B8"
typography:
  led-call-figure:
    fontFamily: "'ULS LED Punct', Doto, ui-monospace, monospace"
    fontSize: "clamp(64px, calc(5vw - 8px), 88px)"
    fontWeight: 800
    lineHeight: 0.85
    letterSpacing: "0"
    fontVariation: "'ROND' 60"
  led-score:
    fontFamily: "'ULS LED Punct', Doto, ui-monospace, monospace"
    fontSize: "clamp(44px, calc(2.5vw + 8px), 56px)"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0"
    fontVariation: "'ROND' 60"
  led-readout:
    fontFamily: "'ULS LED Punct', Doto, ui-monospace, monospace"
    fontSize: "clamp(40px, calc(1.6667vw + 16px), 48px)"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0"
    fontVariation: "'ROND' 60"
  call-name:
    fontFamily: "'Big Shoulders Display', 'Arial Narrow', sans-serif"
    fontSize: "clamp(40px, calc(2.9167vw - 2px), 54px)"
    fontWeight: 800
    lineHeight: 0.95
    letterSpacing: "0"
  scoreboard-caption:
    fontFamily: "'Big Shoulders Display', 'Arial Narrow', sans-serif"
    fontSize: "clamp(19px, calc(1.0417vw + 4px), 24px)"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.06em"
  plate-caption:
    fontFamily: "'Big Shoulders Display', 'Arial Narrow', sans-serif"
    fontSize: "clamp(16px, calc(1.25vw - 2px), 22px)"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.08em"
  key-letter:
    fontFamily: "'Big Shoulders Display', 'Arial Narrow', sans-serif"
    fontSize: "clamp(22px, calc(1.25vw + 4px), 28px)"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0"
  ribbon:
    fontFamily: "'Big Shoulders Text', 'Arial Narrow', sans-serif"
    fontSize: "clamp(22px, calc(1.25vw + 4px), 28px)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.03em"
  board-line:
    fontFamily: "'Big Shoulders Text', 'Arial Narrow', sans-serif"
    fontSize: "clamp(18px, 1.25vw, 24px)"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "0.01em"
  label:
    fontFamily: "'Big Shoulders Text', 'Arial Narrow', sans-serif"
    fontSize: "clamp(16px, calc(1.25vw - 2px), 22px)"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "0.02em"
  body:
    fontFamily: "'Big Shoulders Text', 'Arial Narrow', sans-serif"
    fontSize: "clamp(16px, calc(0.8333vw + 4px), 20px)"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0.01em"
  small:
    fontFamily: "'Big Shoulders Text', 'Arial Narrow', sans-serif"
    fontSize: "clamp(15px, 1.0417vw, 20px)"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "0.02em"
rounded:
  led: "0px"
  steel: "2px"
  lamp: "50%"
spacing:
  pitch: "4px"
  space-1: "4px"
  space-2: "8px"
  space-3: "clamp(12px, 0.8333vw, 16px)"
  space-4: "clamp(16px, calc(0.8333vw + 4px), 20px)"
  space-5: "clamp(24px, 1.6667vw, 32px)"
  space-6: "clamp(32px, calc(1.6667vw + 8px), 40px)"
  gutter: "clamp(24px, calc(5vw - 48px), 48px)"
components:
  ribbon-board:
    backgroundColor: "{colors.led-panel}"
    textColor: "{colors.led-warm-white}"
    typography: "{typography.ribbon}"
    rounded: "{rounded.led}"
    height: "clamp(44px, calc(2.5vw + 8px), 56px)"
    width: "100vw"
  lower-ribbon:
    backgroundColor: "{colors.led-panel}"
    textColor: "{colors.led-warm-white}"
    typography: "{typography.label}"
    rounded: "{rounded.led}"
    height: "clamp(40px, calc(3.3333vw - 8px), 56px)"
    width: "100vw"
  video-board:
    backgroundColor: "{colors.led-panel}"
    textColor: "{colors.led-warm-white}"
    typography: "{typography.call-name}"
    rounded: "{rounded.led}"
    width: "clamp(416px, calc(30vw - 16px), 560px)"
    height: "clamp(324px, calc(22.0833vw + 6px), 430px)"
  caption-plate:
    backgroundColor: "{colors.fascia-steel}"
    textColor: "{colors.caption-white}"
    typography: "{typography.plate-caption}"
    rounded: "{rounded.steel}"
    height: "clamp(24px, 1.6667vw, 32px)"
  scoreboard-band:
    backgroundColor: "{colors.scoreboard-steel-neutral}"
    textColor: "{colors.caption-white}"
    typography: "{typography.scoreboard-caption}"
    rounded: "{rounded.led}"
    height: "clamp(140px, calc(8.3333vw + 20px), 180px)"
    width: "100vw"
  digit-window:
    backgroundColor: "{colors.led-panel}"
    textColor: "{colors.segment-lit}"
    typography: "{typography.led-score}"
    rounded: "{rounded.led}"
    padding: "0 8px"
  control-desk:
    backgroundColor: "{colors.fascia-steel}"
    textColor: "{colors.led-warm-white}"
    typography: "{typography.board-line}"
    rounded: "{rounded.steel}"
    width: "clamp(416px, calc(30vw - 16px), 560px)"
  key:
    backgroundColor: "{colors.fascia-steel-raised}"
    textColor: "{colors.led-warm-white}"
    typography: "{typography.key-letter}"
    rounded: "{rounded.steel}"
    height: "clamp(40px, calc(1.6667vw + 16px), 48px)"
    padding: "0 12px"
  key-lit:
    backgroundColor: "{colors.led-amber}"
    textColor: "{colors.led-panel}"
  key-flag:
    backgroundColor: "{colors.fascia-steel-raised}"
    textColor: "{colors.line-to-gain-yellow}"
  led-input:
    backgroundColor: "{colors.led-panel}"
    textColor: "{colors.led-warm-white}"
    typography: "{typography.board-line}"
    rounded: "{rounded.steel}"
    height: "clamp(40px, calc(1.6667vw + 16px), 48px)"
    padding: "0 12px"
  control-room-drawer:
    backgroundColor: "{colors.fascia-steel}"
    textColor: "{colors.led-warm-white}"
    typography: "{typography.body}"
    rounded: "{rounded.steel}"
    width: "clamp(400px, calc(25vw + 40px), 520px)"
  toast:
    backgroundColor: "{colors.led-panel}"
    textColor: "{colors.led-warm-white}"
    typography: "{typography.body}"
    rounded: "{rounded.led}"
    padding: "12px 16px"
  conn-banner:
    backgroundColor: "{colors.led-panel}"
    textColor: "{colors.led-warm-white}"
    typography: "{typography.ribbon}"
    rounded: "{rounded.led}"
    height: "40px"
  lamp-live:
    backgroundColor: "{colors.tally-red}"
    rounded: "{rounded.lamp}"
    size: "clamp(10px, calc(0.4167vw + 4px), 12px)"
---

<!-- SEED: established with the user before implementation; re-run /impeccable document once there's code to capture the actual tokens and components. Chosen world: "Under the Lights" (docs/design/directions.md, Direction 5). Contract: docs/design/direction-contract.md. Every clamp() above is exact at the two reference viewports (1440x900 and 1920x1080) and holds its laptop value below 1440. Values measured during the seed are marked (measured); values the first build must confirm are marked (provisional). -->

# Design System: Shadow Play-Caller

## Overview

**Creative North Star: "The Stadium Is the Interface"**

The screen is a window into a football stadium on game night, and everything that reads is something a stadium already owns. The next call is on the video board. The plays step across the LED ribbon boards. The game score and the model's own score sit on a painted scoreboard, where SHADOW plays LEAGUE in the row under the game. The prediction itself is light: before every caller snap the stadium dims and projects the call onto the turf in coarse pixels, then the ball flies through it or past it. Nothing on screen is interface chrome that a stadium would not own: no cards, no glass, no gradient panels, no floating tooltips.

This is an Operate surface carrying demo weight. Sam reads it between snaps on a laptop in a dark room, and Conor reads it from 8 to 14 feet on a meeting-room TV. So the layout follows stadium signage, which is built to be read from 100 yards: the field owns the middle; information sits at the edges where stadiums hang it (a ribbon across the top, the video board upper right, the lower ribbon and the scoreboard band across the bottom); every board holds one message at a time; and the next call is the brightest readout on screen. Density is moderate. Depth is real, because the bowl is a 3D scene, so the HUD itself stays flat, opaque and bolted in front of it like fixtures.

Light is the medium, and it is disciplined. Glow exists only where a physical fixture emits it (light towers, LED fascia boards, the ball's tracer). LED panels are opaque black with their unlit pixels visible, which makes them a material rather than a glow. LED copy is warm white and amber, never neon. Day games render in afternoon sun with the stadium's shadow line across the turf, so the world is not a night-only mood. Everything the feed cannot measure is drawn in coarse pixels or a checkerboard, so approximations look approximate. Rejected on purpose: the dark sports-analytics dashboard (near-black ground, neon accents, KPI cards, a flat green rectangle), its light data-journalism opposite, and the current cool-gray card UI.

**Key Characteristics:**

- A full-bleed 3D bowl under every pixel; the HUD is stadium hardware in front of it.
- Three materials only: LED panel (black, visible pixel grid, warm-white and amber light), painted steel (flat, opaque, 2 px corners), and the lit field.
- The offense paints the scoreboard: the band across the bottom is the team in possession's ESPN color.
- One message per board at a time; text steps in and holds, never crawls.
- Doto dot-matrix for big LED readouts only (40 px and up); Big Shoulders for every word.
- The signature moment is the projection: lights dip, the call lights up on the turf, the snap brings the lights back.

### Motion grammar

Native motion is what stadium hardware does between states. One authored moment per snap, driven by state; every item below becomes an instant state change under `prefers-reduced-motion` (`html[data-motion="reduced"]`), and the engine skips world moments there.

- **LED steps (12 fps).** Ribbon and board text changes in discrete frames of 83 ms (`--sc-dur-fast`): a new message steps in from the right in 5 frames (`steps(5, jump-end)`, 415 ms), holds, and the old one steps out left. Never a continuous crawl, never a smooth slide, never a crossfade.
- **Scanline fade-up (400 ms).** The projection and the video board's call appear row by row, top to bottom in 10 steps (`--sc-dur-slow`, `steps(10, jump-end)`).
- **Light dip (20%, 300 ms).** At the pre-snap moment the stadium lights fall to 80% in 300 ms (`--sc-dur-med`) around the projection, and come back to 100% in 300 ms at the snap. The LED boards and the two broadcast lines keep their brightness; only the stadium lights fall. Live games carry an OFF setting (Components, control-room drawer); Watch this game always dips unless motion is reduced.
- **Segment digits snap.** Scoreboard digits change with no tween. When a SHADOW v LEAGUE pair changes leader, its lamp relights with one 83 ms blink.
- **Camera by altitude.** Blimp holds the whole game, wide holds the drive, tight holds the snap. The snap cuts to tight and the ball is followed; after the play the camera settles back to wide (damped, about 1.1 s). In Watch this game the camera rises to blimp between drives and drifts (at most 3 degrees of yaw per second), then descends to wide for the next drive and locks to the ball at the snap.
- **Hardware moves like hardware.** The control-room drawer runs out on rails (240 ms, `--sc-ease-out`); steel never bounces, fades or scales. A possession change repaints the scoreboard band at once and moves the possession lamp; paint does not crossfade.

## Colors

Drenched: the surface is the stadium, colored by its own fixtures and paint. The night sky, the lit turf and the painted scoreboard are the big color fields; LED warm white and amber are the light; the offense's team color owns the scoreboard band.

### Primary
- **LED Warm White** (`led-warm-white`): the lit pixel. The next call, ribbon copy, every word on an LED panel, the projection on the turf, focus rings. 17.1:1 on `led-panel` (measured).
- **LED Amber** (`led-amber`, also `segment-lit`): the scoreboard's digits, percentages on the boards, the run family, lit keys, lamps that mean "on". 10.5:1 on `led-panel`; 7.3:1 lit against `segment-unlit`, so an unlit 8 stays readable as off (measured).
- **LED Gold** (`led-gold`): the midpoint of the warm ramp, used only for the RPO family, which is half of each (13.3:1 on `led-panel`). Pass, RPO and run read as three steps of one ramp: warm white, gold, amber. Labels always name the family; the ramp is a second cue, never the only one.

### Secondary
- **Scoreboard Steel** (runtime `--sc-team-off`): the offense's ESPN primary, exact, painted flat across the scoreboard band. It repaints when possession changes. With no team colors (manual mode before ESPN, DC C2) it is **Neutral Scoreboard Steel** (`scoreboard-steel-neutral`, white captions 10.4:1).
- **Caption White / Caption Dark** (`caption-white`, `caption-dark`): the paint for captions on team steel, white or black, whichever contrasts more (runtime `--sc-team-off-ink`, A10 `inkOn`). White on DAL navy is 14.1:1 and on TB red 6.2:1; the worst color in the gamut still gets 4.58:1 (measured), and captions are 19 px bold or larger, so every team passes.
- **Line to Gain Yellow** (`line-to-gain-yellow`): the line to gain on the turf, the penalty flag, the X key, warnings (retrying, the estimated-clock flag). 2.9:1 against `turf-mow-dark`, 13.2:1 on `led-panel`.
- **Line of Scrimmage Blue** (`line-of-scrimmage-blue`): the line of scrimmage, painted, and its meaning token. It reads by hue, not luminance (1.3:1 against the turf; every broadcast blue sits at 1.1 to 1.8:1, measured), so it is a full-width band of at least 0.4 yd with the white ball ring always on it.

### Tertiary
- **Turf** (`turf-mow-dark`, `turf-mow-light`): 5-yard mow stripes, albedo before light.
- **Field Paint** (`field-paint-white`): yard lines, numerals, hashes, sidelines; lit to about 0.85 linear so it never blooms (recipe pitfall 1).
- **Pylon Orange** (`pylon-orange`) and **Goalpost Gold** (`goalpost-gold`): the eight foam pylons and the posts, with orange ribbons on the uprights.
- **Light-Cone White** (`light-cone-white`): the color of the tower lights and of the lit field's falloff; also the light core mixed into every drawn path (see The Light Core Rule).
- **Day** (`day-sky`, `day-haze`, `afternoon-sun`, all provisional): the afternoon variant for games that kick off before 5 pm Eastern.

### Neutral
- **Night Sky** (`night-sky`): the deep blue above the bowl and the page ground behind the canvas. Never black.
- **Bowl Haze** (`bowl-haze`): the exponential haze and the sky at the rim of the bowl (1.4:1 above the night sky, so the bowl's silhouette reads).
- **LED Panel** (`led-panel`): the face of every ribbon, board, digit window, input and toast. Opaque.
- **Unlit Pixel** (`led-unlit-pixel`, 1.26:1 on the panel) and **Unlit Segment** (`segment-unlit`, 1.43:1): the pixels and digit cells that are off. They are always visible; they are what makes LED a material.
- **LED Dim** (`led-dim`): secondary LED copy (labels, league values, hints); 8.5:1 on the panel, 7.1:1 on steel.
- **Fascia Steel** (`fascia-steel`), **Raised Steel** (`fascia-steel-raised`), **Steel Seam** (`steel-seam`), **Steel Edge** (`steel-edge`): the painted structure: board cabinets, the desk, the drawer, key caps, rules and the 2 px light-catch on top edges. Steel is 1.17:1 against the night sky, so every cabinet carries its steel-edge top line.
- **Tally Red** (`tally-red`) and **Lamp Green** (`lamp-green`): lamp colors. Red is ESPN live (the on-air tally), errors and misses; green is better and hits. Both appear only as lamps, glyphs or text with a word beside them (5.8:1 and 11.0:1 on the panel).
- **Night Scrim** (`scrim-night`, 72%): the only translucent color, for the stat board (G) and the drawer on a phone.

### Named Rules

**The Fixture Rule.** Light glows only where a physical fixture emits it: the tower lamps, the LED fascia ribbons in the bowl, and the ball's tracer. HUD panels, text, lines, the projection and team colors never glow, never get a halo, never pulse.

**The Unlit Pixel Rule.** Every LED surface shows its off pixels: a 4 px pitch dot grid of `led-unlit-pixel` on `led-panel`, and an unlit `8` behind every digit cell. A black rectangle with glowing text is the rut; a panel with visible dark pixels is a board.

**The Offense Paints the Board Rule.** The team color is paint, never light. It covers the scoreboard band and the end zones; it never appears as LED text, an LED bar, a glow or a border on an LED panel (a team's own logo image, shown in an LED window, is the one exception). On LED, the caller is warm white and the opponent is amber.

**The Light Core Rule.** Every drawn path on the field (tracer trail, run lane, yards-after-catch stroke, return) has a light core, the team color mixed 65% toward `light-cone-white`, and carries the team color only on its edge or fill. TB red has the turf's luminance (1.03:1 on the contract's reference turf `#2e6b3a`, 1.49:1 on `turf-mow-dark`) and DAL navy vanishes at night (1.30:1 on `night-sky`), so a team color alone is never a signal.

**The No-Neon Rule.** LED hues are warm white, gold and amber; lamps are tally red and lamp green. No cyan, magenta, lime, electric violet or any fully saturated hue outside the team colors ESPN sends.

### Token map (`--sc-*`, ui-architecture 2.7)

| Token | Value | Token | Value |
| --- | --- | --- | --- |
| `--sc-bg` | `night-sky` | `--sc-pass` | `led-warm-white` |
| `--sc-surface` | `fascia-steel` | `--sc-run` | `led-amber` |
| `--sc-surface-2` | `led-panel` | `--sc-rpo` | `led-gold` |
| `--sc-surface-raised` | `fascia-steel-raised` | `--sc-gain` | `line-to-gain-yellow` |
| `--sc-scrim` | `scrim-night` | `--sc-los` | `line-of-scrimmage-blue` |
| `--sc-ink` | `led-warm-white` | `--sc-good` | `lamp-green` |
| `--sc-ink-muted` | `led-dim` | `--sc-bad` | `tally-red` |
| `--sc-ink-inverse` | `led-panel` | `--sc-warn` | `line-to-gain-yellow` |
| `--sc-rule` | `steel-seam` | `--sc-live` | `tally-red` |
| `--sc-rule-strong` | `steel-edge` | `--sc-focus` | `led-warm-white` (with a `night-sky` gutter) |

World-private tokens use the `--uls-` prefix (for example `--uls-unlit`, `--uls-segment-unlit`, `--uls-led-font`, `--uls-scan`). Team tokens (`--sc-team-*`) are runtime and read-only.

## Typography

**Display Font:** Big Shoulders Display (with Arial Narrow, sans-serif)
**Text Font:** Big Shoulders Text (with Arial Narrow, sans-serif)
**LED Font:** Doto, the variable dot-matrix face, at `wght` 800 and `ROND` 60 (fat round dots that nearly touch), behind a one-face patch, "ULS LED Punct": an `@font-face` that maps Big Shoulders Display to U+002E and U+003A only (`unicode-range`), so the decimal point and the clock's colon are square dots

**Character:** Big Shoulders is condensed Chicago signage lettering: painted captions and the call in the Display cut, every label, button and line of copy in the Text cut. Doto is the board's own lettering for big numbers. All three are OFL and self-hosted under `static/fonts/under-the-lights/` (G28), latin subsets, each with its `OFL.txt`: Big Shoulders Display 35.5 KB, Big Shoulders Text 36.3 KB, Doto 6.0 KB (measured woff2 sizes). Canvas and turf text waits for `document.fonts.load()` before drawing (recipe pitfall 9).

Measured facts the build depends on:

- Doto is monospaced at 0.6 em per character on a 0.1 em dot grid (38.4 px per character at 64 px). The call names run to 23 characters ("PA intermediate (10–19)", "RPO, handed off or kept", 883 px at 64 px), so a call name never fits Doto at board size. The name is Big Shoulders Display; the percentage is Doto.
- Big Shoulders Display 800 in caps, tracking 0, sets every one of the 14 call names on one line: widest "RPO, HANDED OFF OR KEPT" 357.9 px at 40 px (1440 board measure 372 px), 483.1 px at 54 px (1920 measure 504 px), 286.3 px at 32 px (phone measure 322 px). Tracking of +0.01em would eat 9 of the 14 spare pixels at 1440, so the call name is set at 0.
- Big Shoulders has no tabular figures: `1111` sets at 41.8 px and `8888` at 73.8 px at 40 px, with or without `tnum`. Doto's digits are all 0.6 em.
- Doto draws its period and colon as plus-shaped dot clusters: `.421` reads as "+421" and `8:41` as "8‡41" (rendered and checked). The "ULS LED Punct" patch fixes both; ghost and lit text share the stack, so cells still align. Doto has no ▲ ▼ or block glyphs (they fall back to a system font), so hot arrows are drawn as pixel triangles.

### Hierarchy

Sizes are 1440x900 / 1920x1080 / 390 px phone; the frontmatter clamps hit the first two exactly.

- **LED call figure** (Doto 800, 64 / 88 / 48 px, line-height 0.85): the call's percentage on the video board, the largest text on screen.
- **Call name** (Big Shoulders Display 800 caps, 40 / 54 / 32 px, line-height 0.95, tracking 0): the predicted play, one line at every size (measured above).
- **LED score** (Doto 800, 44 / 56 / 40 px): scoreboard row one, scores, quarter, clock, down and distance, ball on.
- **LED readout** (Doto 800, 40 / 48 / 40 px): the SHADOW v LEAGUE values and any other number that ticks in place on an LED window.
- **Scoreboard caption** (Big Shoulders Display 800 caps, +0.06em, 19 / 24 / 19 px): team names, QTR, TIME, DOWN, BALL ON, the pair captions. 19 px bold is large text, so the team-paint ink rule always passes.
- **Plate caption** (Big Shoulders Display 800 caps, +0.08em, 16 / 22 / 16 px): painted plates: "NEXT CALL · SNAP 23", rack names in the drawer, "WHAT DID HE CALL?".
- **Key letter** (Big Shoulders Display 800, 22 / 28 / 22 px): the key printed on a key cap (J, K, L, P, A, N, O, X, U, V, B, G).
- **Ribbon** (Big Shoulders Text 700 caps, +0.03em, 22 / 28 / 16 px): ribbon board copy, one message per board.
- **Board line** (Big Shoulders Text 700, 18 / 24 / 16 px, line-height 1.15): the then-line, the why lines, the desk's play name and chosen line.
- **Label** (Big Shoulders Text 600 caps, +0.02em, 16 / 22 / 15 px): family names, key names, window labels.
- **Body** (Big Shoulders Text 500, 16 / 20 / 15 px, line-height 1.3, measure 60 to 70 characters): drawer copy, hints, toasts, ESPN's play text.
- **Small** (Big Shoulders Text 600, 15 / 20 / 14 px): the field legend, snap counts, the scorecard note. At 1920 nothing visible in the first viewport is smaller than 20 px.

### Token map (type)

| Token | Value |
| --- | --- |
| `--sc-font-display`, `--sc-font-text` | Big Shoulders Display, Big Shoulders Text (with their fallbacks) |
| `--sc-font-num` | Big Shoulders Text; Doto is the world token `--uls-led-font`, used only at 40 px and up |
| `--sc-size-call`, `--sc-size-xl`, `--sc-size-l` | LED call figure (64 / 88), LED score (44 / 56), call name (40 / 54); a component skin gives the call name `--sc-size-l`, never `--sc-size-call` |
| `--sc-size-m`, `--sc-size-s`, `--sc-size-xs` | board line (18 / 24), label (16 / 22), small (15 / 20) |
| `--sc-weight-regular`, `--sc-weight-strong`, `--sc-weight-display` | 500, 700, 800 |
| `--sc-case-label`, `--sc-tracking-label` | `uppercase`, 0.06em |
| `--sc-leading-tight`, `--sc-leading-body` | 0.95, 1.3 |

### Named Rules

**The 40 Pixel Rule.** Doto appears at 40 px or larger, only, at every viewport. Below 40 px an LED says it in Big Shoulders Text, warm white or amber.

**The Whole Name Rule.** The call's name is never truncated, abbreviated, ellipsized or shrunk to fit; the board is sized to the measured widest name. If a future name breaks the measure, it wraps to a second line.

**The Ticking Number Rule.** A number that changes in place (the clock, scores, down, the call's percentage, the SHADOW v LEAGUE values) is Doto in a digit cell, so it never jitters; an unlit `8` sits behind every digit position (`88` behind a score, `88:88` behind the clock, `88%` behind a percentage), right-aligned, hidden from assistive tech (`content: "88" / ""`). The ghost sets the cell's width: stack the ghost and the value in one grid area (`display: inline-grid`, both `grid-area: 1 / 1`, `justify-self: end`), so a one-digit score sits in the right-hand cell with an unlit 8 beside it and nothing spills over the caption. Letter fields (down and distance words, the ball-on side) carry no ghost.

**The Caps Rule.** Painted captions and LED copy are set in caps with `text-transform`, from the sentence-case copy in `model/copy.js`; the source strings never change. ESPN's play text on the desk, the why lines, hints and toasts stay in sentence case.

## Layout

The bowl is full bleed: the field host fills the viewport behind everything (`--sc-field-aspect` follows the viewport; no letterbox). The HUD is signage hung at the edges of that window, positioned in viewport pixels on the 4 px LED pitch (`pitch`), never in a card grid. The field owns the middle, and the camera keeps the line of scrimmage, the line to gain and the projection inside the free area (`setSafeArea` right inset, fit margins top 0.07 and bottom 0.22, because the ribbons and the band cover those edges).

**The Edge Rule.** Information lives where a stadium hangs it: a ribbon across the top, the video board upper right with the desk under it, the lower ribbon and the scoreboard band across the bottom. Nothing floats over the middle of the field except the projection, which is part of the field.

### First viewport, 1440x900 (Sam's laptop), Direction 5 exactly

| Element | Box (x, y, w x h) | What it holds |
| --- | --- | --- |
| Bowl | 0, 0, 1440 x 900 | The 3D stadium, camera wide; free area x 0 to 984, y 44 to 716 (safe right inset 456 px) |
| Upper ribbon | 0, 0, 1440 x 44 | Left: the masthead's nameplate (title, game, modelled caller). Middle: the play feed, the newest play stepping in and holding ("Q2 8:41 · DAL · PASS SHORT RIGHT TO LAMB +8 · TOP PICK"). Right: the feed region in compact form (lamp, status), then the masthead's keys: Undo, Export CSV, Reset, and V, B, G |
| Video board | 1000, 64, 416 x 324 | A 24 px caption plate ("NEXT CALL · SNAP 23") over the LED face (8 px steel frame, 372 px measure inside 14 px padding): the call name at 40 px, the call figure at 64 px with the tilt tag, the then-line, the pass/run split with the league tick, the five families as LED bars with league ticks |
| Desk | 1000, 404, 416 x 296 | The mode's controls: manual, the entry line and keypad; feed, the last ESPN play and its retag keys; watch, the transport over the last play |
| Field legend | 16, 684 | "Ball shown mid-field; ESPN gives no hash." on a small LED tag |
| Lower ribbon | 0, 716, 1440 x 40 | Left 1168 px: the drive chart on a 100-yard LED scale. Right 264 px: the caller's win probability |
| Scoreboard band | 0, 760, 1440 x 140 | Painted in the offense's color. Row one (y 768 to 828): both teams, QTR, TIME, DOWN, BALL ON. Row two (y 832 to 892): SHADOW v LEAGUE |

Vertical budget, measured in a HUD mock with the real fonts and the longest call name: the board face is 400 x 290 at 1440 and its content (name, figure row, then-line, split, five family rows at 6 px gaps) ends 276 px down, exactly inside the 14 px padding; at 1920 it ends 359 px down a 388 px face. Scoreboard row one ends at x 1394 of 1440 (row two at 1331); at 1920 at 1670 and 1585. Nothing in the first viewport has room to grow, so a new item there replaces one.

### First viewport, 1920x1080 (the TV)

| Element | Box (x, y, w x h) |
| --- | --- |
| Upper ribbon | 0, 0, 1920 x 56 |
| Video board | 1312, 80, 560 x 430 (32 px caption plate; 504 px measure; call name 54 px, call figure 88 px) |
| Desk | 1312, 526, 560 x 298 |
| Lower ribbon | 0, 840, 1920 x 56 (drive chart 1568 px, win probability 352 px) |
| Scoreboard band | 0, 900, 1920 x 180 (rows of 78 px) |

Free area x 0 to 1296, y 56 to 840 (safe right inset 624 px). The right edge of every panel sits 48 px in from the screen edge (`gutter`), 24 px on the laptop. Everything legible across a room is large: the call figure 88 px, scores 56 px, ribbon copy 28 px, captions 24 px, nothing under 20 px.

### Manual mode

With the feed off and no watch, the scorer's strip (the editable situation: Qtr, Clock, both scores, Down, To go, Ball on with its side chip, the drive line and the end-of-drive keys) hangs directly under the upper ribbon as a row of LED input windows on fascia steel (52 px at 1440, 64 px at 1920), and the board moves down by that height while the desk keeps its bottom edge (it scrolls under its pinned entry line when full). The strip sits above the board because the off-field copy says "click Ball on above". The desk shows the entry line first (chosen play, Yards, Touchdown, Turnover, Log play), then the keypad (Run J K L; Pass P A N; RPO O; Result I S C X), then the shorthand bar and the hint. The entry line is never moved into the drawer (ui-architecture 4.4).

### Phone, 390x844

One column, no horizontal scroll (G17, checklist #8), 12 px gutters: the upper ribbon (up to two lines), the field as a 390 x 300 band in the flow (crowd hidden, as in recipe 6.4), the video board at full width (call name 32 px on one line; figure 48 px), the desk, the lower ribbon (drive chart, then the win probability as its own 40 px ribbon), and the scoreboard band wrapping to four rows (teams; QTR and TIME; DOWN and BALL ON; SHADOW v LEAGUE with each pair on its own line). Doto stays at 40 px or more. The drawer and the stat board become full-screen sheets over `scrim-night`.

### The control-room drawer (B)

B runs a steel cabinet out from the left between the upper ribbon and the band: at 1440, x 0, y 44 to 760, 400 px wide; at 1920, x 0, y 56 to 900, 520 px wide; full screen on the phone. It is opaque `fascia-steel` with a `steel-edge` on its open side, scrolls inside itself, and stacks rack panels, each under a painted plate caption: FEED (the feed region docks here while the drawer is open and shows all of itself: the ESPN feed key and its tally lamp, game id, Replay this game, Watch this game, status, the background message), SITUATION (the scorer's strip, outside manual mode), FLAGS (the flag panel; X opens the drawer to it, Escape or X closes both) and SETTINGS (light dip for live games ON or OFF; room lights dark or room). The world declares `booth: { holds: ["flags", "feed", "situation"] }`. Keys work with the drawer closed, and the field keeps playing behind it.

**The Whole Region Rule.** A region lives in one place at a time (`arrange` and CSS move whole regions, never parts of one): masthead and plays and feed on the upper ribbon, call on the board, entry and transport on the desk, drives and wp on the lower ribbon, scoreboard and score on the band, situation, flags and the docked feed in the drawer, and box, tendencies and log on the stat board. A list that does not fit its ribbon unrolls downward on hover or keyboard focus into a taller LED board (the play feed into recent plays, the drive chart into the drive list), every row a button.

### The stat board (G)

G lowers a large LED board over the field's free area (1440: x 24 to 984, y 64 to 700; 1920: x 48 to 1296, y 80 to 824) on a `scrim-night` scrim: the score region at full size (all three groups, every pair, and the note "Lower log loss is better. One game is a pipeline test, not proof."), with the tendencies, box and log regions beside and below it (his tendencies as an LED forest plot, team stats, the play log). G or Escape raises it.

### Token map (space, shape, motion)

| Token | Value |
| --- | --- |
| `--sc-space-1` to `--sc-space-6` | `spacing.space-1` to `space-6` (4, 8, 12, 16, 24, 32 px at 1440; 4, 8, 16, 20, 32, 40 px at 1920) |
| `--sc-gutter` | `spacing.gutter` (24 px at 1440, 48 px at 1920) |
| `--sc-radius-s`, `--sc-radius-m`, `--sc-radius-l` | 0 px (LED), 2 px (steel), 2 px (cabinets) |
| `--sc-border-w`, `--sc-focus-w` | 2 px, 3 px |
| `--sc-field-aspect` | `auto`: the field host fills the viewport |
| `--sc-dur-fast`, `--sc-dur-med`, `--sc-dur-slow` | 83 ms (one LED frame at 12 fps), 300 ms (the light dip), 400 ms (the scanline) |
| `--sc-ease-out`, `--sc-ease-in-out` | `cubic-bezier(0.16, 1, 0.3, 1)`, `cubic-bezier(0.65, 0, 0.35, 1)`; LED changes use `steps(5, jump-end)` and scans `steps(10, jump-end)` (world tokens `--uls-step`, `--uls-scan`) |

### Order, back to front

Bowl canvas (with the projection and turf lettering) → field legend and review banner → ribbons, scoreboard band, video board, desk → stat board → drawer → connection banner → toasts → boot screen.

## Elevation & Depth

The HUD is flat and the stadium is deep. Depth is physical: the bowl is a real 3D scene with real light, and the HUD is hardware mounted in front of the window. Panels separate from the scene by material (opaque LED black or painted steel), by a 2 px light-catch along their top edge (`steel-edge` on fascia steel; the band's own color mixed 30% toward white on the scoreboard), and by 1 px `steel-seam` lines between parts. There is no shadow vocabulary.

**The Flat Hardware Rule.** No `box-shadow`, drop shadow, `backdrop-filter`, blur, glass or decorative gradient on any HUD element. The only CSS gradient in the HUD is the unlit-pixel grid, which is texture, and the only spread-ring is the focus ring's 2 px `night-sky` gutter.

**The Opaque Panel Rule.** Every panel is opaque. The bowl shows through nothing except the stat board's scrim and the phone's sheets.

### The stadium (3D art direction)

- **The bowl.** Tiered stands as dark low-poly superellipse rings (recipe 4.8: 84 by 50 yd, 30 rows) in steel and haze tones; a seeded crowd of points tinted by both teams at 25 to 60% brightness (hidden below aspect 1); two LED fascia ribbons on the front edges of the decks, diegetic copies of the HUD ribbons (warm white and amber on LED black, `FrontSide` only, stepping at the same 12 fps); four light towers at the corners (x ±90, z ±60 yd, 34 yd high) whose lamp banks are the brightest objects in the scene.
- **Night.** The towers carry spot lights in `light-cone-white` aimed across the field; only the two home-side towers cast shadows (budget: 2 shadow lights, maps at most 2048). The field is brightest at its center and falls off toward the corners. `FogExp2` in `bowl-haze` (density about 0.0035, provisional) softens the stands and towers under a sky dome graded from `bowl-haze` at the rim to `night-sky` overhead. Top quality tier only: faint additive light shafts from each tower, at most 6% opacity, never above the bloom threshold.
- **Day.** Kickoff before 5 pm Eastern (the first row's ESPN `wall`; unknown counts as night): `afternoon-sun` as one directional light from the west-southwest about 35 degrees up, a `day-sky` dome with `day-haze`, the stadium rim casting its shadow line across part of the field (a rim mesh in the shadow map), tower lamps off, LED boards still lit. Provisional until the first day render.
- **The field.** The turf shader (recipe 4.3) with 5-yard mow stripes in `turf-mow-dark` and `turf-mow-light` and every line in `field-paint-white`; each end zone in its defending team's exact ESPN primary, the team name painted in white (or the alternate) with an outline; eight `pylon-orange` pylons; `goalpost-gold` single-standard posts with orange ribbons; the home logo at midfield.
- **The lines.** The line of scrimmage and the line to gain are paint on the turf, at least 0.4 yd wide, coplanar through `polygonOffset`, with no halo and no bloom; the line to gain hides on goal to go. The ball rests on the line of scrimmage, mid-field, inside a white ring.
- **Bloom.** `UnrealBloomPass` at half resolution, threshold 1.05, strength 0.5, radius 0.5 (recipe 10.3), Neutral tone mapping at exposure 1.0. Only the tower lamps (about x9), the LED fascia (about x1.1) and the ball's tracer head (about x2.5) exceed 1.0. White paint sits near 0.85 linear; the projection stays below 1.0.
- **Cameras by altitude.** The camera's height says how much of the game you are looking at, the one idea taken from the dealt "spatial navigation by zoom" staging. V cycles them; FOV is vertical (`PerspectiveCamera.fov`).

| Mode | Holds | Rig (provisional) |
| --- | --- | --- |
| `wide` (default) | the drive: line of scrimmage, line to gain, the projection, the first ring of stands | home sideline, about 27 degrees down (height 40, back 80 yd), 20 degrees (about 34 horizontal at 16:9) |
| `tight` | the snap: the ball and 16 yd around it | sideline at press level (height 12, back 34 yd), 16 degrees, follows the ball; the snap cuts to it |
| `blimp` | the game: the whole field and the bowl | 65 degrees down, about 220 yd out, 22 degrees; drifts between drives in Watch this game |

- **Team colors in the scene.** End zones keep the exact primary with white or alternate lettering and a white outline. Every path follows The Light Core Rule. The projection is never team-colored.
- **Budget** (ui-architecture 6.1). At most 150 draw calls and 300k triangles per frame, props at most 40 draw calls, 2 shadow-casting lights, bloom at half resolution, render on demand (0 frames while nothing moves; the blimp drift keeps the loop alive only while it runs), 60 fps at 1440x900 and 1920x1080 on Sam's laptop. The bowl with bloom is the heaviest of the five worlds, so quality tiers drop the light shafts first, then the crowd, then bloom.
- **Room lights** (`html[data-ambient]`). `dark` is the default. `room` (a lit meeting room or a projector) lifts the scene about +0.5 EV and the sky one step toward `bowl-haze`, so a projector does not crush the bowl to mud; the HUD stays the same. The engine has no ambient hook yet (see the surface brief).
- **The 2D fallback** (no WebGL2, software GL, `?scene=2d`) is the same world seen from straight above: a `night-sky` ground, the striped field with team end zones, the same pixel projection, lanes and rings in SVG, and the same HUD.

## Shapes

- **LED faces:** square corners (`rounded.led`, 0 px). A face is a rectangle on the 4 px pitch, and its edge is where the pixel grid ends; it has no border of its own.
- **Steel:** 2 px corners (`rounded.steel`), folded sheet metal, never more. Cabinets are rectangles with a caption plate on top and an 8 px frame around the face.
- **Lamps:** perfect circles, 10 px at 1440 and 12 px at 1920 (`rounded.lamp`), always paired with a word. With the ball's ring, the only round things on screen.
- **Pixel glyphs:** results (TD, INC, 1ST, FLAG, turnover, the check, the X) and the hot arrows on a 9 by 9 pixel grid, lit in the LED palette; referee signal pictograms, drawn as pixel art, on the video board for touchdowns and turnovers only.
- **The turf grid:** everything the stadium projects is quantized to a 1-yard grid, a 0.8 yd lit square with a 0.2 yd dark gap.
- **Refused shapes:** pills, rounded cards, cards inside cards, cut corners and slanted ends (broadcast graphics), icon tiles, circles used as decoration.

## Components

Every component is stadium hardware built from the three materials. States come from the attribute hooks in ui-architecture 2.7 and 5 (`data-phase`, `data-mode`, `aria-pressed`, `aria-expanded`, `data-verdict`, `data-tone`, `data-hot`), never from new markup.

### Ribbon boards

- **Upper ribbon** (`ribbon-board`, 44 / 56 px, full width): LED face with the unlit-pixel grid. Left end: a steel nameplate (plate caption "SHADOW PLAY-CALLER", the game and the modelled caller under it in small type). Middle: one message at a time, the newest play: time, offense, ESPN's text in caps, yards and, for the caller's plays only, the verdict: TOP PICK (warm white with a pixel check), IN HIS TOP 3 (amber with a pixel 3), MISS (tally red with a pixel X). Right end: the feed region in compact form, its lamp (tally red "ESPN LIVE", yellow "RETRYING", unlit when off) and the updated time, then the masthead's keys (Undo, Export CSV, Reset, V, B, G); V's cap names the camera mode. On hover or keyboard focus the play feed unrolls under the ribbon into a replay board of recent plays, newest first, each row a button that reviews its play.
- **Behavior:** a message steps in from the right in 5 frames, holds until the next one, and steps out left; the background message (G12) uses the same step. A message longer than the face pages a screenful at a time, holding each page about 2 s; it never crawls and never shrinks. Until paging exists it is cut at the face's edge, and the full text is on the desk and in PLAYS.
- **Lower ribbon** (`lower-ribbon`, 40 / 56 px): the drive chart and the win probability, below.

### Video board (the next call)

- **Cabinet:** `fascia-steel`, 8 px frame, `steel-edge` light-catch, `caption-plate` on top: "NEXT CALL" and the snap number. Off the field, the face shows "DAL IS OFF THE FIELD" at call-name size and the mode's off-field copy in body type.
- **Face, top to bottom:** the call name (`call-name`, warm white, one line); the figure row: the percentage (`led-call-figure`, warm white over an unlit `88%`) and, at the right, the tilt tag (an LED tag: TILT PASS, LEAN RUN, NO EDGE in label caps; amber for a tilt or lean, `led-dim` for no edge); the then-line ("THEN" in `led-dim`, names warm white, percentages amber); the pass/run split as one LED bar (pass cells warm white, run cells amber) with the league as a 2-cell warm-white notch above and below the bar; five family rows: name (`label`, `led-dim`), an LED bar of lit cells in the family's tone to the family's percentage and unlit cells to 100%, the league notch, his percentage, and the hot arrow as a pixel triangle (`data-hot="up"` lit in the family tone, `"down"` in `led-dim`).
- **States:** a row under the pointer or focus gets a 2 px warm-white frame and lights its projection on the turf (`highlightGhost`). A new prediction scans in (400 ms). The board never shows a verdict; the ribbon and the scoreboard do.
- **Expanded:** while the pointer or keyboard focus is inside the board, the face grows from its top-right corner to 600 x 560 (1440) or 800 x 746 (1920) and scans in the rest: every specific play under its family as a button (bar scaled to the top pick, his percentage, the hot arrow), the why lines in sentence case (pass points warm white, run points amber), the opening-script note and the legend in `small`.

### Scoreboard band and SHADOW v LEAGUE

- **Paint:** `--sc-team-off` exactly as ESPN sends it, `scoreboard-steel-neutral` without team colors; a 2 px light-catch of the band's color mixed 30% toward white; captions in `--sc-team-off-ink`. Logos sit in square LED windows using ESPN's dark-background variant (`logo_dark`), never directly on the paint.
- **Row one, the game:** for each team in ESPN order (away, then home): logo window, team name caption ("COWBOYS"), score cell (`digit-window`, `led-score`, lit `segment-lit` over an unlit `88`), the possession lamp (amber) and three timeout lamps (amber when a timeout remains). Then QTR (over an unlit `8`), TIME (over `88:88`, with a yellow EST caption when the clock is estimated), DOWN ("2ND & 7", "1ST & GOAL") and BALL ON ("DAL 38"). Digits snap.
- **Row two, SHADOW v LEAGUE:** a plate reading "SHADOW V LEAGUE" with the snap count under it ("59 SNAPS"), then exactly three pairs from `scorecardVm().pairs`, in this order: Called right (85% v 81%), Actual play in his top 3 (47 v 48), Pass vs run log loss (.421 v .424, the pair's `brief`). Each pair is a caption, the SHADOW cell, a small "V", the LEAGUE cell (`led-readout`), and an amber leader lamp beside whichever side the pair's `leader` names (none when even). The play-type and specific-play log-loss pairs live on the stat board. There is no league top-pick count and no league tilt count, so no such cell exists on any board, at any size.
- **Empty:** before the first logged snap every cell shows only its unlit 8s, and row two reads "SCORES APPEAR AFTER THE FIRST LOGGED SNAP." in `led-dim`. The plate opens the stat board (same as G).

### Lower ribbon: drive chart and win probability

- **Drive chart:** a 100-yard LED scale, goal line to goal line, the caller's own goal on the left as on the field; a dim tick every 10 yards. The current drive is lit from its start to the ball (warm white when the caller has it, amber for the opponent), each play a one-cell break, the line to gain a yellow cell column, and the result tag (TD, FG, PUNT, INT, DOWNS) at the end once the drive is complete. Earlier drives stay as a thin dim row above it, newest brightest. Each drive is a button; hover or focus lights it fully and shows its line ("DAL TD · 9 PLAYS · 70 YDS · 4:09"), and the chart unrolls upward into the game's drive list.
- **Win probability:** the caller's percentage ("DAL 63%", label, warm white) beside an LED line of the game so far: lit pixels on a stepped line, the 50% line in unlit pixels, the newest point a 2 x 2 warm-white pixel. Hand-entered games show the WP copy in `small`, `led-dim`.

### Control desk

- **Cabinet:** `control-desk` under the board, the same width, a caption plate naming the mode: "WHAT DID HE CALL?" (manual), "LAST PLAY FROM ESPN" (feed), "WATCH THIS GAME" (watch).
- **Manual:** the entry line pinned at the top (the chosen play in `board-line`, or "Pick the play" in `led-dim`; the Yards LED input; Touchdown (T) and Turnover (F) as lamp switches; Log play as the widest key, lit amber when a pick exists); the keypad in two rows of keys; the shorthand bar as a full-width LED input; the hint in `small`. When the content outgrows the desk, the desk scrolls under the pinned entry line.
- **Feed:** the play name with TD or turnover, "8 yds · retagged" in `small`, ESPN's text in `body`, and the retag keys. The key that matches the play's family carries a lit frame (`aria-current`). After each caller play the retag keys light amber for 8 s, then rest unlit and visible.
- **Watch:** the transport across the top (play or pause, step, the speed keys 1x 2x 4x 10x lit one at a time, the progress "104 / 183" as an `led-readout`, stop; "Back to my game" and "Watch again" when done), with Space, 1 to 4 and Left/Right printed on their keys; under it, the last play and its retag keys.

### Watch transport

Lives at the top of the desk during Watch this game (Layout and Control desk): play or pause, step, stop, the four speed keys with exactly one lit, and the progress readout. Every key prints its keyboard key on its cap (Space, Left, Right, 1 to 4), because Sam drives the transport from the keyboard and Conor learns it by watching. While playing, the play key's window is lit amber; paused, it is unlit; an error shows the watch error copy beside a tally-red lamp.

### Keys, lamps and LED inputs

- **Key** (`key`): a raised steel cap, 2 px corners, 1 px `steel-edge` light-catch on top; at its left a square LED window carrying the key letter (`key-letter`, warm white), then its name (`label`, `led-dim`). Hover: the letter lights amber. On or pressed (`aria-pressed="true"`, `.on`): the window lights (`key-lit`: amber ground, `led-panel` letter). Focus: a 3 px `led-warm-white` outline with a 2 px `night-sky` gutter, never hidden. Disabled: the window goes dark (`segment-unlit` letter) and the cap stays. The X (flag) key prints its letter in `line-to-gain-yellow` and lights yellow while the flag panel is open.
- **Lamp:** a circle that is lit (fill in its color) or unlit (`led-unlit-pixel`, still visible), always beside a word. Tally red: ESPN live, errors. Amber: possession, leader, timeouts, on. Lamp green: better, a hit. Yellow: retrying, estimated.
- **LED input** (`led-input`): an LED face in a 2 px `steel-edge` frame, warm-white text, amber caret, placeholder in `led-dim`; invalid (`aria-invalid`, `.bad`) turns the frame tally red and keeps the typed value; focus uses the focus ring. Checkboxes are lamp switches: a lamp plus its label, lit when checked.

### Control-room drawer

A tall steel rack (`control-room-drawer`) running out from the left on B (Layout gives its box and racks). Each rack is a plate caption over its contents: keys, LED inputs and lists on LED faces. Its SETTINGS rack holds the two switches this world adds: **Light dip in live games** (ON by default; OFF skips the dip whenever the ESPN feed or manual entry is running, while Watch this game always dips) and **Room lights** (dark or room, `actions.setAmbient`; the world's default is `ambient: "dark"`). The dip setting is stored per viewer as `sc:uls:dip-live` inside `try`/`catch`; room lights use the app's own `sc:ambient`.

### Stat board (G)

A big LED face lowered over the field (Layout gives its box): "TONIGHT'S SCORECARD" as a plate caption; each scorecard group as rows of LED readouts with their labels; every SHADOW v LEAGUE pair with its leader lamp; the note "Lower log loss is better. One game is a pipeline test, not proof." in `body`; his tendencies as an LED forest plot (pass terms warm white, run terms amber, filled pixels when the interval excludes zero, hollow otherwise; axis words "more run" and "more pass"); team stats and the play log as LED tables in `label` and `body`.

### Toasts, connection banner, review banner, boot screen

- **Toast** (`toast`): an LED strip that steps in above the lower ribbon, centered on the field's free area (at most 560 px wide at 1440, 720 at 1920): an amber lamp (info) or tally-red lamp (error) and the message in `body`, sentence case. Holds 2.6 s (FI 4.5), steps out. `role="status"`.
- **Connection banner** (`conn-banner`): a full-width LED strip directly under the upper ribbon: a yellow lamp and "RECONNECTING…", or a tally-red lamp and "CAN'T REACH THE APP SERVER. RETRYING IN 4 S.", with a RETRY NOW key at its right end. It covers the bowl, never the board.
- **Review banner:** an LED tag with an amber lamp at the top left of the field's free area: "REVIEWING DAL, Q2 8:41, PASS SHORT RIGHT. ESC RETURNS TO LIVE."
- **Field legend:** "Ball shown mid-field; ESPN gives no hash." on a small LED tag at the bottom left of the free area, in `small`, `led-dim`, always present.
- **Boot screen:** the stadium before the lights come on: the `night-sky` ground and a single centered LED board, "LOADING THE GAME…" in ribbon type; failed and restart states are the same board with a tally-red lamp, the copy, and `bash start.sh` in an LED window.

### The projection (signature)

- **When:** before every caller snap, while a prediction is up (`data-phase="presnap"`). Opponent snaps get none (the opponent has no model).
- **Sequence:** the stadium lights dip to 80% (300 ms) → the top call scans onto the turf (400 ms, 10 rows) → it holds until the snap → at the snap the lights come back (300 ms), the top call's projection falls to 15% and stays under the real play until the next prediction, and the second and third clear. With the live OFF setting there is no dip; under reduced motion everything is instant and there is no dip.
- **Look:** the top call's zone from `field/ghosts.js` (a run lane through its gap, a pass depth band across the field width, a screen's two flats, an RPO's read mark) quantized to the 1-yard turf grid: every cell whose center falls inside the zone lights `led-warm-white` at about 0.9 (under the bloom threshold). The second and third calls light only their outline cells, at 45% and 25%. The top call's name and percentage are projected beside it in Doto pixel lettering about 3 yd tall ("DEEP SHOT (20+) 48%"), lettered flat on the turf between the zone and the near sideline so it reads upright from the home-side camera; the second and third show their percentage only. The coarse grid is the honesty: the zone is a category, never a route.
- **Linked:** focus or hover on a board row lights that play's outline as a full fill and dims the rest. The projection never changes color with the verdict.

### Plays on the field

- **Ball:** the football at 2.2x scale with a tracer head (warm white, about x2.5, the only blooming thing on the field) and a short spark trail that fades in 400 ms; the trail core follows The Light Core Rule and the sparks carry the team color lifted to a luminance of at least 0.08.
- **Pass:** the tracer flies a true-length arc of generic height. A completion lands in a pixel ring (warm white, about 3 yd across) and continues as a straight pixel lane for the yards after the catch. An incompletion lights its short or deep band in the side's third as checkerboard pixels with a dim ring.
- **Run:** a projected pixel lane through the gap, its length the yards gained, light-core cells along the middle and team-colored cells at the edges; no cutbacks. A sack drives the lane backward to the spot and bursts tally-red pixels there.
- **Kicks:** tracer arcs at true distances and a pixel ring where the ball comes down; a turnover is a pixel X at the spot and the return is a pixel lane.
- **Flags:** a yellow flag lands at the line, the wiped play redraws as a checkerboard at 35% (visibly not counted), and the ball walks to the enforced spot.
- **Approximate versus measured:** every estimated segment (drop, mesh point, lateral lanes, incompletion depth, kick heights) is a checkerboard at 60%; every measured one is solid (`strokes[*].approx = "pixel"`). The last play stays until the next snap; the drive's earlier plays stay as 20% residue until the drive ends.
- **Result words** ("TOUCHDOWN", "SACK", "INCOMPLETE", "FLAG: DEFENSIVE HOLDING") are projected onto the turf in pixel lettering near the spot for 2.1 s, as well as on the ribbon.

## Do's and Don'ts

### Do:

- **Do** keep a stadium behind every pixel: the `night-sky` ground and the lit bowl at night, `day-sky` and sun in the afternoon.
- **Do** make every LED surface show its unlit pixels (4 px grid of `led-unlit-pixel`) and every digit cell its unlit 8s.
- **Do** keep panels opaque and flat: LED black or painted steel, a 2 px light-catch on top, 1 px seams.
- **Do** paint the scoreboard band in the offense's exact ESPN primary and repaint it on every possession change.
- **Do** set the call's name on one line in Big Shoulders Display (40 px at 1440, 54 px at 1920) and its percentage in Doto (64 px, 88 px); the call is the brightest, largest readout on screen.
- **Do** put a light core in every drawn path and carry team colors only on edges and fills.
- **Do** draw every estimate as coarse pixels or a checkerboard, and every measured fact solid.
- **Do** show only pairs the scorecard computes on the SHADOW v LEAGUE row: called right, actual play in his top 3, pass vs run log loss.
- **Do** step LED text in at 12 fps and hold it; scan in the projection and the call over 400 ms; snap digits; make every motion instant under reduced motion.
- **Do** honor the live-game light-dip OFF setting, and check every screen at 1440x900, 1920x1080 and 390x844 with real copy, including the longest call name ("RPO, handed off or kept").

### Don't:

- **Don't** use a black or near-black flat UI ground, a neon hue, or a glowing edge: that is the dark analytics dashboard this world was chosen against.
- **Don't** give anything a glow, halo, bloom or pulse unless it is a physical fixture (tower lamps, LED fascia in the bowl) or the ball's tracer.
- **Don't** use `box-shadow` (the focus ring's gutter is the one exception), `backdrop-filter`, glass, blur, decorative gradients, pills, rounded cards or nested cards anywhere in the HUD.
- **Don't** set Doto below 40 px, type ▲ ▼ in Doto, or put a ticking number in Big Shoulders (no tabular figures).
- **Don't** truncate, abbreviate or ellipsize the call's name.
- **Don't** put team colors on LED (text, bars, glows; a team's own logo image is the one exception) or use a team color as the only signal of a path.
- **Don't** invent a statistic: no league top-pick count, no league tilt count, and no more precision than the scorecard shows (whole percentages, 3 decimals for pass vs run log loss, 2 for the others).
- **Don't** draw players, routes, formations, or a side for a pass prediction; the projection is a zone or a lane.
- **Don't** crawl ribbon text continuously, crossfade boards, or animate paint.
- **Don't** let any panel cover the line of scrimmage, the line to gain or the projection: the camera's safe area keeps them in the free field.
