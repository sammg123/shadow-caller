# Play drawing: Sam's direction (2026-10-09), binding

Status: **binding. Overrides** every earlier rule about how plays and predictions are drawn: ui-architecture.md 2.4 and 2.5 (snap step, corridors, bands, ghost zones), directions.md "Shared approximation grammar" (drop, corridor, band rows), DESIGN.md (the pixel-zone "projection" shapes), and any task prompt that says otherwise (QB drop, handoff mesh, pixel-grid ghost zones). If a prompt and this file disagree, this file wins.

Sam's words, verbatim: "there's no point in putting the ball behind the line to show a drop back, it should start on the line of scrimmage, and either show an arch if it was a pass, an arch with an x if it was incomplete pass, or a straight line with yards if it was a run (2d not 3). and it should say the play it was on the diagram (deep pass, short pass, inside run, outside run, etc) as descriptive as espn gets, then, before the next play, it should shadow the most likely plays overlayed on the 3d model along with the text underneath on a clear shadow sense (dashed or opacity) maybe show top 2 most likely plays or something?"

## 1. Every play starts on the line of scrimmage

- The ball starts at the line of scrimmage (`geo.x0`), on the center line between the hashes (ESPN gives no hash).
- **No dropback, no handoff mesh, no play-action fake step, no ball behind the line.** Remove the snap step from the drawing and from the animation (the `DROP_YD`, `MESH_YD` and `PA_FAKE_YD` constants no longer shape any drawing).

## 2. The shape of each play

| Play | Shape |
| --- | --- |
| Completed pass | A 3D **arc** through the air from the line of scrimmage to the catch point (`x_catch`, in the side's lane: left / middle / right), then a **straight line on the turf** for the yards after the catch to where he went down (`x_end`). A small catch dot at the catch point is fine; no catch-area circle. |
| Incomplete pass | The **arc** from the line of scrimmage to the target spot (exact air yards when known, else ESPN's "short" or "deep" estimate, in the side's lane), ending in a clear **X** on the turf. No depth band. |
| Interception | The arc to the interception spot, an **INT** mark, then the return as a straight line on the turf (in the defense's color). |
| Run (any gap) | A **straight flat line on the turf (2D, no 3D runner path, no corridor, no cutback)** from the line of scrimmage to the end spot, angled toward its gap (lane offsets in grammar.js), with the yards. Drawn by growing the line from the line of scrimmage. |
| Sack | A straight line on the turf backward from the line of scrimmage to the sack spot, in a loss color. |
| QB scramble / kneel | A straight line on the turf, like a run. |
| Punt / kickoff / field goal | Arcs, as before (true length), with the result mark (touchback, fair catch, FG good / no good). |
| No play (flag wipes it out) | The same shape drawn dimmed and dashed, a flag mark, then the ball moves to the enforced spot. |
| Penalty with no play | A flag mark at the line, the ball moves to the new spot. |
| Touchdown | The shape ends in the end zone with a TD mark. |

Arcs may stay 3D (the pass is in the air). Runs, YAC, returns and sacks are flat 2D lines on the turf.

## 3. The label on the diagram

Every drawn play carries one label, placed on the field near the end of the play (never covering the ball), as descriptive as ESPN gets. Format: `<what it was> · <result>`.

| Play | Label (real TB at DAL examples) |
| --- | --- |
| Incomplete | "Short pass middle · incomplete" (first DAL snap) |
| Completion | "Short pass middle · +8"; "Deep pass middle · +21"; "Short pass left · +27" |
| TD pass | "Deep pass left · TD" (D.Prescott to G.Pickens, 18) |
| Interception | "Pass intercepted · short middle" |
| Inside run | "Inside run (up the middle) · +4"; "Inside run (left guard) · −2" |
| Off-tackle | "Off-tackle left · +72" (TB, B.Irving) |
| Outside run | "Outside run right · +2"; "Outside run left · TD" |
| Sack | "Sack · −11" |
| Scramble | "QB scramble right · +5" |
| Kneel | "Kneel · −1" |
| Punt | "Punt · 53 yds · out of bounds" |
| Field goal | "FG 41 yds · good" |
| Kickoff | "Kickoff · touchback"; "Kickoff · return to DAL 30" |
| No play | "No play · defensive offside on TB" |
| Flag, no snap | "Flag · false start on TB · −5" |

Rules:

- Pass words come from ESPN's gamebook text: depth word (`call.depth`: short / deep) and side (`geo.lat`). Gap words come from `geo.gap`: "up the middle" and the guards give "Inside run (…)"; the tackles give "Off-tackle left/right"; the ends give "Outside run left/right".
- Rows typed by hand (no gap words) use the engine's leaf names (`run_inside` gives "Inside run", `run_ot_left` gives "Off-tackle left", `run_edge_left` gives "Outside run left", passes give "Short / Intermediate / Deep pass").
- On Dallas plays, a retag wins for the play type (Sam's retag is the model's truth): play-action gives "Play-action deep pass left · +21", screen gives "Screen · +6", RPO gives "RPO handoff · +4" or "RPO throw · +9". Geometry still follows ESPN's text.
- Results: `+N` / `−N` yards (true minus sign), `incomplete`, `TD`, `INT`, `fumble lost`, `safety`.
- Labels are text, never HTML (G27), and must stay readable on the field at 1440x900 and 1920x1080 (the world styles them).

## 4. Before each Dallas snap: the shadow plays

- Show the **top 2 most likely specific plays** for the next Dallas snap (by his model's probability, `prediction.top` order), drawn **in the same shape language as real plays** (pass = arc, run = straight line on the turf, screen = short arc to the flat, RPO handoff = line, RPO throw = short arc), starting at the line of scrimmage.
- They must read clearly as **shadows**: dashed strokes and low opacity (about 50% for #1, 35% for #2), never solid. The world may tint them, but they stay dashed and translucent.
- **Text underneath each shadow**: rank, play name and probability, e.g. "1 · Deep shot (20+) · 31%" and "2 · Inside run (A/B gap) · 22%". Use the engine's leaf names (LEAF_NAMES).
- Geometry for a predicted play (the model predicts the play type, not the side): passes to the middle lane at the bucket's typical air yards (short 6, intermediate 14, deep 25; cap inside the end zone); play-action uses the same arcs; screen a short arc to the flat (about 1 yard behind the line, 10 yards wide, toward the wider side of the field); runs a straight line about 4 yards long angled to the gap (inside straight ahead; off-tackle about 4 yards wide; outside about 9 yards wide). Labels must not overlap: stack them.
- When the snap happens, the shadows fade out and the real play draws solid with its label. The previous real play stays visible but dimmed until the next snap's play is drawn.
- Hovering or focusing a play in the prediction panel highlights its shadow (and draws a shadow for a play outside the top 2 while hovered).
- Only for the modeled caller's offense (Dallas tonight). The opponent's plays draw normally, with no shadows.

## 4b. Clarity and separation: Sam, 2026-10-10 (binding, refines section 4)

Sam's words after the first preview, verbatim: "when it projects a run it's way too congested because it's usually inside and outside. And those two yellow arrows are like overlaid on top of each other. So maybe make the predicted thing, even though it's very obvious the predictions because they're like dashed, maybe make them like a little bit more narrow and thin. You also need to make it clear which ones were the previous play and which ones are the predictions. Like predict like kinda cut like color code them and organize it a little bit better. So when two things are really close to each other, like a short pass and an inside run, figure a way to separate them so they're not congested in the predictions. And make it clear which ones are predictions and which ones are previous plays and make sure they don't overlap on each other or the ball. Or like the overlapping is a big issue. It's either on top of each other, on top of the ball, on top of the previous play, etc"

What was wrong in his screenshots (Watch, wide camera, 1440 class): the inside-run shadow was drawn as thick translucent blocks with a broad arrow, sitting on top of the play-action short arc at the ball; the short and intermediate pass shadows were chunky dashed bands with dashed landing ellipses; the previous play's label and verdict chip sat on the ball; nothing said which marks were the last play and which were predictions.

Rules (they override any looser wording in section 4):

1. **Thin, not chunky.** A prediction is a thin dashed stroke (about 2 to 3 px at the 1440x900 wide camera; scale with the view), short dashes with clear gaps, a small arrowhead or end tick at most. No filled lanes, no thick blocks, no broad arrows, no landing ellipses or rings.
2. **Colour-coded and tagged.** Predictions: #1 in the world's amber, #2 in warm white, both dashed (#2 slightly fainter). The previous play: a solid stroke in a muted steel or slate (never amber or warm white), dimmed while the predictions are up. Every label carries its role: prediction plates read "NEXT 1 · Inside run (A/B gap) · 21%" / "NEXT 2 · PA short (0–9) · 16%" with a tab in the prediction's colour; the previous play's plate reads "LAST · Short pass left · +11" with its verdict ("TOP PICK · 19%", "MISS · #4 Intermediate · 10%") in the same muted plate. A small legend on the field edge shows the three styles (last play / next 1 / next 2).
3. **Separated, never stacked.** The two predictions never share a lane or overlap anywhere beyond the line of scrimmage: when their natural shapes come within about 3 yards of each other (a short pass and an inside run, an inside and an outside run, two short passes), fan them apart to distinct lateral lanes (at least about 4 yards apart) and keep runs flat on the turf and passes arcing above it. Both strokes start just past the ball (about 1.5 yards), never on it.
4. **Nothing on the ball, nothing on each other.** No label, verdict chip or stroke covers the ball. Labels never overlap each other, the other prediction's stroke, or the previous play's stroke or label. Placement is solved in screen space after projection (try positions around each label's anchor, use a thin leader line when a label has to move). The previous play's label goes at the start or along its path, never at its end (its end is where the ball now sits).
5. **Acceptance.** Across all 59 Dallas pre-snaps of the saved TB at DAL game, at 1440x900 and 1920x1080 on the default wide pre-snap camera: zero label-label overlaps, zero label-ball overlaps, zero prediction-on-prediction stroke overlaps beyond the first 1.5 yards, and the previous play is visibly different (style and tag) from both predictions. Checked by measurement and by screenshot, including the two situations Sam captured (Inside run (A/B gap) 21% with PA short (0–9) 16%; snap 41, Short (0–9 air yds) 47% with Intermediate (10–19) 11%).

## 5. What stays the same

- The data contract (DC), the timeline rows and every field the server sends.
- Approximation honesty: estimated air yards on incompletions stay estimates (the label says "short" or "deep"; no fake precision). Lane positions are approximate by nature; no player figures, no routes.
- Line of scrimmage (blue), line to gain (yellow), cameras, the world's lighting and the light dip before a Dallas snap (the dip can accompany the shadows).
