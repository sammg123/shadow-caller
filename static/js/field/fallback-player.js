/**
 * Animates one play on a stage of the 2D field (ui-architecture.md 2.5 playRow and 6.2, owner A6). DOM side, but no
 * clock and no frame loop of its own: the engine calls tick(now) from its requestAnimationFrame loop. The plan comes
 * from field/timing.js (planDrawing fitted to the duration the conductor gives, DC E4); each frame sets every part
 * to its step's eased progress (fallback-plays partAt: strokes grow from the line of scrimmage with the ball at their
 * tip, marks pop in) and moves the ball, its shadow and its trail.
 */
import { ballNodes } from "./fallback-draw.js";
import { partAt, playSpec, shownBall, trailNodes } from "./fallback-plays.js";
import { applyAttrs, buildNode, patchInto, renderInto } from "./fallback-svg.js";
import { ballAt, easeFor, fitPlan, planDrawing, progressAt } from "./timing.js";
import { clear, svgEl } from "../ui/dom.js";

function mountSpec(layer, spec) {
  clear(layer);
  const root = svgEl("g", { class: "sc-fb-play", "data-seq": spec.seq });
  const parts = [];
  for (const step of spec.steps) {
    const g = svgEl("g", { opacity: step.opacity, "data-step": step.t, "data-role": step.role });
    for (const part of step.parts) {
      const el = buildNode(part);
      g.appendChild(el);
      parts.push({ el, part, index: step.index });
    }
    root.appendChild(g);
  }
  layer.appendChild(root);
  return parts;
}

/** Each step's progress at t, eased as the ball moves (timing.easeFor), so a stroke's tip is where the ball is: a run
 * grows from the line of scrimmage and slows into the tackle with it. */
function apply(run, t) {
  const { drawing } = run.job.entry;
  const progress = new Map(progressAt(run.plan, t).map((p) => [p.index, easeFor(drawing.steps[p.index])(p.u)]));
  for (const { el, part, index } of run.parts) applyAttrs(el, partAt(part, progress.get(index) ?? 0));
  const ball = shownBall(drawing, run.plan, t);
  const team = run.spec.steps[Math.max(0, ball?.index ?? 0)]?.team ?? drawing.team;
  const nodes = ball ? [...trailNodes(drawing, run.plan, t, run.job.ctx, team), ...ballNodes(ball, run.job.ctx)] : [];
  renderInto(run.job.stage.ball, nodes);
}

function mount(job) {
  const { entry, ctx, stage, durationMs, labelPx = null } = job;
  const plan = fitPlan(planDrawing(entry.drawing, ctx.look.motion), durationMs);
  const spec = playSpec(entry.drawing, entry.row, ctx, { verdict: entry.verdict, labelPx });
  return { job, plan, spec, parts: mountSpec(stage.play, spec), start: null, t: 0 };
}

const shapeOf = (spec) => spec.steps.map((st) => st.parts.map((p) => `${p.tag}:${p.children?.length ?? 0}`).join(","))
  .join("|");

/** The same play in a new layout (a camera move, a resize): its parts patched in place when they keep their shape
 * (nothing inserted, only what moved written), else mounted anew; it carries on from the same time. */
function remount(run, ctx, labelPx) {
  const job = { ...run.job, ctx, labelPx };
  const spec = playSpec(job.entry.drawing, job.entry.row, ctx, { verdict: job.entry.verdict, labelPx });
  if (shapeOf(spec) !== shapeOf(run.spec)) return { ...mount(job), t: run.t };
  const parts = spec.steps.flatMap((step) => step.parts.map((part) => ({ part, index: step.index })))
    .map((p, i) => {
      patchInto(run.parts[i].el, p.part);
      return { ...p, el: run.parts[i].el };
    });
  return { ...run, job, spec, parts, start: null };
}

/**
 * @returns {{ start(job: { entry, ctx, stage, durationMs, labelPx? }): void, tick(now: number): boolean,
 *   finish(): object|null, rebuild(ctx, labelPx?): void, active(): object|null, elapsed(): number,
 *   ball(): ({x: number, y: number, h: number} | null) }}
 *   tick returns true while the play still runs; finish jumps to the end, clears the play layer and returns the job.
 */
export function createPlayer() {
  let run = null;
  return {
    start(job) {
      run = mount(job);
      apply(run, 0);
    },
    tick(now) {
      if (!run) return false;
      if (run.start === null) run.start = now - run.t;
      run.t = Math.min(run.plan.totalMs, Math.max(0, now - run.start));
      apply(run, run.t);
      return run.t < run.plan.totalMs;
    },
    finish() {
      if (!run) return null;
      const done = run;
      run = null;
      clear(done.job.stage.play);
      clear(done.job.stage.ball);
      return { ...done.job, plan: done.plan };
    },
    /** The layout changed mid-play (a camera move, a resize): the parts move to the new context, and the play
     * carries on from the same time. */
    rebuild(ctx, labelPx = run?.job.labelPx ?? null) {
      if (!run) return;
      run = remount(run, ctx, labelPx);
      apply(run, run.t);
    },
    active: () => run?.job ?? null,
    elapsed: () => run?.t ?? 0,
    /** The ball now, in field yards at its true height (the WebGL engine's debugState().ball), or null. */
    ball() {
      const b = run ? ballAt(run.job.entry.drawing, run.plan, run.t) : null;
      return b && run.start !== null ? { x: b.x, y: b.y, h: b.h } : null;
    },
  };
}
