// Under the Lights: the world's moments (DESIGN.md motion grammar; docs/design/play-drawing.md 4; surface brief #4;
// ui-architecture.md 2.7, 14.6; owner: home frame for the camera, W1 for the rest). The engine calls them, never under
// reduced motion, with { THREE, scene, camera, rig, lights, requestRender, tween, reducedMotion, look, frame }. They
// drive the stadium's parts that props.js built (found in the scene by name, so a rebuilt stadium is picked up at
// once). The camera is the viewer's alone (restructure-v2.md 4: Wide or Blimp by V, no push-in at the snap, no rise
// between drives), so no moment moves it.
//   presnap(ctx, set)    before a Dallas snap: the stadium lights dip to 80% in 300 ms (unless the viewer turned the
//                        dip off for live games: booth.js shouldDipNow; a watched game always dips), and the
//                        field-wall ribbon steps in the next call once the last play's words have had their moment
//                        (G3-6)
//   snap(ctx, row)       the caller's snap: the lights come back up in 300 ms
//   play(ctx, row)       any animated play starts (v1.4 hook): lights up; a call still queued on the ribbon is dropped
//   landed(ctx, row)     the play is down (v1.4 hook): the LED ribbons step in the play's words, TOUCHDOWN with the
//                        scorer's logo, INTERCEPTED or FLAG for a moment; a touchdown flares the tower lamps (G3-7)
//   verdict(ctx, v)      the caller's play is graded: TOP PICK, IN HIS TOP 3 or MISS joins its words on the ribbon
//                        (never over the next call once it is up); TOP PICK flares the tower lamps (G3-7)
//   possession(ctx, t)   the ball changes hands: the upper ribbon goes back to the game
//   placed(ctx, rows)    rows drawn at once, with no motion (restructure-v2.md 5: a jump, a page load; a hidden page):
//                        no snap or play moment comes, so the lights come up, a call that was up (or queued) goes,
//                        and the ribbons rest: the field wall on the newest play's words (the title when nothing is
//                        drawn), the upper ribbon on the game. A call where the game landed comes after (presnap).
import { shouldDipNow } from "./booth.js";
import { STADIUM } from "./props.js";
import { callMessage, gameMessage, idleMessage, plainMessage, playMessage, textOf, withVerdict }
  from "./stadium/messages.js";

/** DESIGN.md's timings when the look's world.uls gives none: the play's words dwell before the next call steps in
 * over them (G3-6), and the lamp banks' flare when he is right or on a touchdown (G3-7). */
const DWELL_MS = 1500;
const FLARE = Object.freeze({ peak: 1.15, ms: 300 });
/** The last caller play the ribbons show, so its grade can join its words. Per stadium (WeakMap: no leaks). */
const LAST = new WeakMap();

/** The newest stadium in the scene: while a new game frame's is built (hidden, to be swapped in), the old one is on its
 * way out, and a call queued on it would be lost at the swap. */
function stadiumOf(ctx) {
  let found = null;
  ctx?.scene?.traverse?.((o) => {
    if (o.name === STADIUM && o.userData?.uls) found = o.userData.uls;
  });
  return found;
}
const docOf = () => globalThis.document ?? null;

function withStadium(ctx, fn) {
  const s = stadiumOf(ctx);
  if (!s) return;
  fn(s);
  ctx.requestRender?.();
}

const dwellOf = (s) => (Number.isFinite(s.look?.world?.uls?.ribbons?.dwellMs) ? s.look.world.uls.ribbons.dwellMs
  : DWELL_MS);

/** The tower lamps flare (G3-7): moments never run under reduced motion, and a flare asks for frames of its own. */
function flare(s, ctx) {
  if (ctx?.reducedMotion) return;
  const f = s.look?.world?.uls?.flare ?? FLARE;
  s.dim.flare?.(Number.isFinite(f.peak) ? f.peak : FLARE.peak, Number.isFinite(f.ms) ? f.ms : FLARE.ms);
}

function presnap(ctx, set) {
  withStadium(ctx, (s) => {
    if (shouldDipNow(docOf() ?? undefined)) s.dim.to(s.dip.level, s.dip.ms, ctx.lights);
    const call = callMessage(set);
    if (call) s.ribbons.queue?.("A", call, dwellOf(s));
  });
}

function lightsUp(ctx) {
  withStadium(ctx, (s) => s.dim.to(1, s.dip.ms, ctx.lights));
}

function play(ctx) {
  withStadium(ctx, (s) => {
    s.dim.to(1, s.dip.ms, ctx.lights);
    s.ribbons.drop?.("A");
  });
}

/** The ribbons' words for a play that is down: a moment (held, then the play's own words), else its words. */
function announce(s, row) {
  const moment = playMessage(row, s.frame.teams);
  if (!moment) return;
  const plain = plainMessage(row) ?? moment;
  LAST.set(s, { seq: row.seq, plain, held: moment.holdMs > 0 });
  s.ribbons.show("A", moment, plain);
  if (moment.holdMs > 0 && moment.kind !== "flag") s.ribbons.show("B", moment, gameMessage(s.frame));
}

function landed(ctx, row) {
  withStadium(ctx, (s) => {
    if (row) announce(s, row);
    if (row?.result?.td) flare(s, ctx);
  });
}

function verdict(ctx, v) {
  withStadium(ctx, (s) => {
    const last = LAST.get(s);
    const onRibbon = last && last.seq === v?.seq && s.ribbons.message?.("A")?.kind !== "call";
    if (onRibbon) s.ribbons.revise("A", withVerdict(last.plain, v.key));
    if (v?.key === "top1") flare(s, ctx);
  });
}

function possession(ctx) {
  withStadium(ctx, (s) => {
    if (!LAST.get(s)?.held) s.ribbons.revise("B", gameMessage(s.frame));
  });
}

/** The newest of `rows` with words on the ribbon (an admin row has none), as LAST keeps it; null when none has. */
function newestPlay(rows) {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const plain = plainMessage(rows[i]);
    if (plain) return { seq: rows[i].seq, plain, held: false };
  }
  return null;
}

/** A ribbon steps to `msg` unless it says just that already (the same words never step in twice). */
function rest(s, id, msg) {
  if (textOf(s.ribbons.message?.(id)) !== textOf(msg)) s.ribbons.show(id, msg);
}

function placed(ctx, rows) {
  const list = Array.isArray(rows) ? rows : [];
  const last = newestPlay(list);
  if (!last && list.length) return;              // admin rows only (a timeout between his snaps): the call stays up
  withStadium(ctx, (s) => {
    s.dim.to(1, s.dip.ms, ctx.lights);
    LAST.set(s, last);
    s.ribbons.drop?.("A");
    rest(s, "A", last ? last.plain : idleMessage());
    rest(s, "B", gameMessage(s.frame));
  });
}

export const moments = Object.freeze({ presnap, snap: lightsUp, play, landed, verdict, possession, placed });

export default moments;
