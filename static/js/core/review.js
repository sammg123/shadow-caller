// Left/Right review cursor over drawn rows (ui-architecture.md 2.2, owner A2). Client only: the server is never
// rewound. At the live edge, Right steps a paused watch and pauses then steps a playing one. Pure.

/** Seqs a review can show: drawn rows that draw something (admin rows draw nothing). */
export function drawableSeqs(rows, drawnThrough) {
  return rows.filter((r) => r.kind !== "admin" && r.seq <= drawnThrough).map((r) => r.seq);
}

function liveEdgeEffect(watchState) {
  if (watchState === "paused") return "server-step";
  if (watchState === "playing") return "pause-then-step";
  return null;
}

function stepBack(seqs, reviewSeq) {
  if (reviewSeq === null) return seqs.length ? seqs[seqs.length - 1] : null;
  const earlier = seqs.filter((s) => s < reviewSeq);
  return earlier.length ? earlier[earlier.length - 1] : reviewSeq;
}

/** One press of Left (-1) or Right (+1). Returns the new cursor (null = live edge) and any server effect. */
export function stepReview({ reviewSeq, rows, drawnThrough, watchState }, delta) {
  const seqs = drawableSeqs(rows, drawnThrough);
  if (delta === -1) return { reviewSeq: stepBack(seqs, reviewSeq), effect: null };
  if (delta !== 1) return { reviewSeq, effect: null };
  if (reviewSeq === null) return { reviewSeq: null, effect: liveEdgeEffect(watchState) };
  const later = seqs.find((s) => s > reviewSeq);
  return { reviewSeq: later ?? null, effect: null };
}
