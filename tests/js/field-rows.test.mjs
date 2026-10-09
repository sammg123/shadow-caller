// The contract rows the field tests fall back to must say exactly what the real capture says (DC B2, B5, G).
import assert from "node:assert/strict";
import test from "node:test";

import { CONTRACT_ROWS, META_FAMILIES, META_LEAVES, capture } from "./field-rows.mjs";

const SIT_KEYS = ["poss", "down", "togo", "yardline_100", "goal_to_go"];

function pick(obj, keys) {
  return obj == null ? obj : Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));
}

function sameOn(mine, real, keys, label) {
  assert.deepEqual(pick(real, keys), pick(mine, keys), label);
}

test("contract rows agree with the real capture on every field the geometry reads", () => {
  const body = capture();
  const byId = new Map(body.rows.map((r) => [r.id, r]));
  for (const mine of CONTRACT_ROWS) {
    const real = byId.get(mine.id);
    assert.ok(real, `capture has ${mine.id}`);
    for (const key of ["seq", "drive", "team", "kind", "offense_is_caller"]) {
      assert.equal(mine[key], real[key], `${mine.id} ${key}`);
    }
    assert.deepEqual(mine.geo, real.geo, `${mine.id} geo`);
    if (mine.call) sameOn(mine.call, real.call, Object.keys(mine.call), `${mine.id} call`);
    if (mine.kick) sameOn(mine.kick, real.kick, Object.keys(mine.kick), `${mine.id} kick`);
    if (mine.result) sameOn(mine.result, real.result, Object.keys(mine.result), `${mine.id} result`);
    sameOn(mine.pre, real.pre, SIT_KEYS, `${mine.id} pre`);
    sameOn(mine.post, real.post, SIT_KEYS, `${mine.id} post`);
    assert.deepEqual(mine.scoring, real.scoring, `${mine.id} scoring`);
    if (mine.pred) assert.deepEqual(mine.pred, real.pred, `${mine.id} pred`);
  }
});

test("the canonical orders match the capture's meta", () => {
  const body = capture();
  assert.deepEqual([...META_LEAVES], body.meta.leaves);
  assert.deepEqual([...META_FAMILIES], body.meta.families);
});
