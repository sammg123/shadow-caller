// Under the Lights: the world's moments (DESIGN.md motion grammar; docs/design/play-drawing.md 4; surface brief #3,
// #4; ui-architecture.md 2.7, 14.6; owner W1). The engine calls them, never under reduced motion, with { THREE, scene,
// camera, rig, lights, requestRender, tween, reducedMotion, look, frame }. They drive the stadium's parts that
// props.js built (found in the scene by name, so a rebuilt stadium is picked up at once):
//   presnap(ctx, set)    before a Dallas snap: the stadium lights dip to 80% in 300 ms (unless the viewer turned the
//                        dip off for live games: booth.js shouldDipNow; Watch this game always dips), and the
//                        camera comes back to wide so his top 2 shadow plays and their words read
//   snap(ctx, row)       the caller's snap: the lights come back up in 300 ms
//   play(ctx, row)       any animated play starts (v1.4 hook): lights up, the camera pushes in to tight and follows
//                        the ball, or rises to the blimp for a kick's whole flight
//   landed(ctx, row)     the play is down (v1.4 hook): the camera settles back to wide (or, in Watch this game, rises
//                        to the blimp and drifts when the drive is over); the LED ribbons step in the play's words,
//                        TOUCHDOWN with the scorer's logo, INTERCEPTED or FLAG for a moment
//   verdict(ctx, v)      the caller's play is graded: TOP PICK, IN HIS TOP 3 or MISS joins its words on the ribbon
//   possession(ctx, t)   the ball changes hands: the upper ribbon goes back to the game
import { shouldDipNow } from "./booth.js";
import { STADIUM } from "./props.js";
import { gameMessage, plainMessage, playMessage, withVerdict } from "./stadium/messages.js";

const WATCH = "watch";
/** The last caller play the ribbons show, so its grade can join its words. Per stadium (WeakMap: no leaks). */
const LAST = new WeakMap();

const stadiumOf = (ctx) => ctx?.scene?.getObjectByName?.(STADIUM)?.userData?.uls ?? null;
const docOf = () => globalThis.document ?? null;
const appMode = () => docOf()?.getElementById?.("app")?.getAttribute?.("data-mode") ?? null;
const envOf = (ctx) => ({ viewerMode: ctx?.rig?.mode?.() ?? null, watch: appMode() === WATCH });

function withStadium(ctx, fn) {
  const s = stadiumOf(ctx);
  if (!s) return;
  s.choreo.attach(ctx);
  fn(s);
  ctx.requestRender?.();
}

function presnap(ctx) {
  withStadium(ctx, (s) => {
    s.choreo.presnap(envOf(ctx));
    if (shouldDipNow(docOf() ?? undefined)) s.dim.to(s.dip.level, s.dip.ms, ctx.lights);
  });
}

function lightsUp(ctx) {
  withStadium(ctx, (s) => s.dim.to(1, s.dip.ms, ctx.lights));
}

function play(ctx, row) {
  withStadium(ctx, (s) => {
    s.dim.to(1, s.dip.ms, ctx.lights);
    s.choreo.play(row, envOf(ctx));
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
    s.choreo.landed(row, envOf(ctx));
    if (row) announce(s, row);
  });
}

function verdict(ctx, v) {
  withStadium(ctx, (s) => {
    const last = LAST.get(s);
    if (!last || last.seq !== v?.seq) return;
    s.ribbons.revise("A", withVerdict(last.plain, v.key));
  });
}

function possession(ctx) {
  withStadium(ctx, (s) => {
    if (!LAST.get(s)?.held) s.ribbons.revise("B", gameMessage(s.frame));
  });
}

export const moments = Object.freeze({ presnap, snap: lightsUp, play, landed, verdict, possession });

export default moments;
