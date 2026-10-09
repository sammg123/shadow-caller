// The engine's dynamic layers (ui-architecture 2.5, 14.4, and the v1.4 A5 part 2 note; owner A5). scene.js owns
// timing, tokens, deferral, events and hooks; a layer only draws. Part 2, the action layer, fills the table
// (docs/design/play-drawing.md, binding):
//   player:   player.js       the live play: a pass's 3D arc, a run's flat line, the X, the marks, the ball and its
//                             tracer, the play's words; the play on display dimmed once the next call is up
//             createPlayer(stage) -> { start(drawing, plan, row) -> job, placeAll(items), review(item | null),
//                                      relabel(rows), verdict(v), clear(), dispose() }
//             job = { update(tMs) -> boolean (true while it still draws), ball() -> field point | null,
//                     finish(), dispose() }
//   ghosts:   ghost-layer.js  the top 2 shadow plays before a caller snap, dashed and translucent, text underneath
//             createGhostLayer(stage) -> { show(set), highlight(leaf), fade(k, ms), clear(), dispose() }
//   overlays: overlays.js     the verdict chip under the play's words; the situation the facade painted
//             createOverlays(stage)   -> { situation(sit), clear(), dispose() }
//   residue:  residue.js      past plays, faint (look.residue), merged per material; Left/Right review
//             createResidue(stage)    -> { add(drawing, row), relabel(rows), clear(), dispose() }
// Every method but start/show/situation/clear/dispose is optional for the facade. Layers add their objects under
// stage.roots.<name> and dispose what they own (dispose.js disposeTree; the kit's materials are shared). The action
// layers also call each other through stage.layers (the player hands a finished play to residue, the ghost layer
// dims the play on display, the player shows its verdict through overlays).
import { createGhostLayer } from "./ghost-layer.js";
import { createOverlays } from "./overlays.js";
import { createPlayer } from "./player.js";
import { createResidue } from "./residue.js";

/** The layer factories scene.js instantiates. */
export const LAYER_FACTORIES = Object.freeze({
  residue: createResidue,
  overlays: createOverlays,
  ghosts: createGhostLayer,
  player: createPlayer,
});

/** Instantiate every layer for a stage, residue first (the player may hand finished plays to it). */
export function createLayers(stage, factories = LAYER_FACTORIES) {
  const out = {};
  for (const name of ["residue", "overlays", "ghosts", "player"]) out[name] = factories[name](stage);
  return out;
}
