/**
 * Animates one play on a stage of the 2D field (ui-architecture.md 2.5 playRow and 6.2, owner A6). DOM side, but no
 * clock and no frame loop of its own: the engine calls tick(now) from its requestAnimationFrame loop. The plan comes
 * from field/timing.js (planDrawing fitted to the duration the conductor gives, DC E4); each frame sets every part
 * to its step's progress (fallback-plays partAt: strokes grow along their paths, lanes grow with the ball, marks
 * and areas pop in) and moves the ball, its shadow and its trail.
 */
import { ballNodes } from "./fallback-draw.js";
import { partAt, playSpec, trailNodes } from "./fallback-plays.js";
import { applyAttrs, buildNode, renderInto } from "./fallback-svg.js";
import { ballAt, fitPlan, planDrawing, progressAt } from "./timing.js";
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

function apply(run, t) {
  const { drawing } = run.job.entry;
  const progress = new Map(progressAt(run.plan, t).map((p) => [p.index, p.u]));
  for (const { el, part, index } of run.parts) applyAttrs(el, partAt(part, progress.get(index) ?? 0));
  const ball = ballAt(drawing, run.plan, t);
  const team = run.spec.steps[Math.max(0, ball?.index ?? 0)]?.team ?? drawing.team;
  const nodes = ball ? [...trailNodes(drawing, run.plan, t, run.job.ctx, team), ...ballNodes(ball, run.job.ctx)] : [];
  renderInto(run.job.stage.ball, nodes);
}

function mount(job) {
  const { entry, ctx, stage, durationMs } = job;
  const plan = fitPlan(planDrawing(entry.drawing, ctx.look.motion), durationMs);
  const spec = playSpec(entry.drawing, entry.row, ctx, { verdict: entry.verdict });
  return { job, plan, spec, parts: mountSpec(stage.play, spec), start: null, t: 0 };
}

/**
 * @returns {{ start(job: { entry, ctx, stage, durationMs }): void, tick(now: number): boolean, finish(): object|null,
 *   rebuild(ctx): void, active(): object|null, elapsed(): number }}
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
    /** The layout changed mid-play: rebuild the parts in the new context and carry on from the same time. */
    rebuild(ctx) {
      if (!run) return;
      const t = run.t;
      run = { ...mount({ ...run.job, ctx }), start: null, t };
      apply(run, t);
    },
    active: () => run?.job ?? null,
    elapsed: () => run?.t ?? 0,
  };
}
