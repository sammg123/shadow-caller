// Under the Lights: what the camera does around a play (DESIGN.md "Camera by altitude": blimp holds the game, wide
// holds the drive, tight holds the snap; surface brief unresolved #3; owner W1). Pure decisions: a moment, the
// choreography's state ({ shot, drifting }) and the page's facts ({ viewerMode, watch }) in; the next shot out
// ({ shot: "tight" | "blimp" | null, ms, drift, delayMs }) or null for no change. stadium/choreo.js carries them out.
//   - The snap pushes in to tight and the ball is followed; a kick rises to the blimp, so its whole flight shows.
//   - After the play the camera settles back to wide. In Watch this game, a play that ends the drive takes the
//     camera up to the blimp, drifting, until the next drive comes down to the ball; a touchdown or a turnover is
//     held first (delayMs: the camera stays on the play that scored or turned it over, then rises).
//   - The choreography only rides on the wide camera: a viewer who picked another one (V) keeps it.

export const SHOTS = Object.freeze({ tight: "tight", blimp: "blimp" });
export const WIDE_MODE = "wide";
/** DESIGN.md's timings when the look's world.uls.camera gives none. */
const DEFAULT_MS = Object.freeze({ pushMs: 650, settleMs: 900, riseMs: 1700, descendMs: 1100, holdScoreMs: 2000 });
/** The kick kinds (timeline.py KICKS, DC B5): their flights go up to the blimp. */
export const KICK_KINDS = Object.freeze(["kickoff", "punt", "fg", "fg_miss"]);
const KICKS = new Set(KICK_KINDS);
/** Kicks that hand the ball over at the end of a drive (a kickoff starts one). */
const DRIVE_ENDING_KICKS = new Set(["punt", "fg", "fg_miss"]);

const msOf = (timing, key) => (Number.isFinite(timing?.[key]) && timing[key] >= 0 ? timing[key] : DEFAULT_MS[key]);
const move = (shot, ms, drift = false, delayMs = 0) => ({ shot, ms, drift, delayMs });
const owned = (env) => env?.viewerMode === WIDE_MODE;
/** The viewer chose another camera: drop any shot of ours at once, else leave everything alone. */
const release = (state) => (state?.shot ? move(null, 0) : null);

/** A kickoff, a punt, or a field goal made or missed. */
export const isKick = (row) => KICKS.has(row?.kind);

/** The play ends its team's drive: a touchdown, a turnover, a safety, downs, a punt or a field goal attempt. */
export function endsDrive(row) {
  const r = row?.result ?? {};
  return Boolean(r.td || r.turnover || r.safety || r.downs || DRIVE_ENDING_KICKS.has(row?.kind));
}

/** A play worth holding on before the camera leaves it: a touchdown or a turnover. */
const isScoreOrTurnover = (row) => Boolean(row?.result?.td || row?.result?.turnover);

/** An animated play starts. */
export function onPlay(state, row, env, timing) {
  if (!owned(env)) return release(state);
  if (isKick(row)) {
    return state?.shot === SHOTS.blimp ? move(SHOTS.blimp, 0, Boolean(state.drifting))
      : move(SHOTS.blimp, msOf(timing, "riseMs"));
  }
  return move(SHOTS.tight, msOf(timing, "pushMs"));
}

/** An animated play ends (the ball is down, the words are on the field). */
export function onLanded(state, row, env, timing) {
  if (!owned(env)) return release(state);
  const from = state?.shot ?? null;
  if (env.watch && endsDrive(row)) {
    if (from === SHOTS.blimp) return move(SHOTS.blimp, 0, true);
    const hold = isScoreOrTurnover(row) ? msOf(timing, "holdScoreMs") : 0;
    return move(SHOTS.blimp, msOf(timing, "riseMs"), true, hold);
  }
  if (from === SHOTS.blimp) return move(null, msOf(timing, "descendMs"));
  return from ? move(null, msOf(timing, "settleMs")) : null;
}

/** The next call goes up (the caller's presnap): back to wide, so the shadow plays and their words read. */
export function onPresnap(state, env, timing) {
  if (!owned(env)) return release(state);
  const from = state?.shot ?? null;
  if (from === SHOTS.blimp) return move(null, msOf(timing, "descendMs"));
  return from ? move(null, msOf(timing, "settleMs")) : null;
}
