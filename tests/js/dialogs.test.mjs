// ui/dialogs.js (owner A9; ui-architecture.md 2.6): confirmAction is window.confirm behind a promise, so the
// Reset (#89), Replay (#106) and Watch confirms stay real browser dialogs that tests can accept or dismiss.
import assert from "node:assert/strict";
import test from "node:test";
import { confirmAction } from "../../static/js/ui/dialogs.js";

async function withConfirm(fn, body) {
  const had = Object.hasOwn(globalThis, "confirm");
  const before = globalThis.confirm;
  globalThis.confirm = fn;
  try {
    return await body();
  } finally {
    if (had) globalThis.confirm = before;
    else delete globalThis.confirm;
  }
}

test("confirmAction asks the browser with the exact text and resolves its answer", async () => {
  const asked = [];
  await withConfirm((text) => { asked.push(text); return true; }, async () => {
    assert.equal(await confirmAction("Clear every snap logged for this game?"), true);
  });
  await withConfirm(() => false, async () => {
    assert.equal(await confirmAction("Stop watching and put your game back?"), false);
  });
  assert.deepEqual(asked, ["Clear every snap logged for this game?"]);
});

test("the answer is always a boolean, and the question always text", async () => {
  const asked = [];
  await withConfirm((text) => { asked.push(text); return "yes"; }, async () => {
    assert.equal(await confirmAction(42), true);
  });
  assert.deepEqual(asked, ["42"]);
});

test("no confirm, or one that throws, counts as No: nothing destructive happens", async () => {
  await withConfirm(undefined, async () => {
    assert.equal(await confirmAction("Reset?"), false);
  });
  await withConfirm(() => { throw new Error("blocked by the browser"); }, async () => {
    assert.equal(await confirmAction("Reset?"), false);
  });
});
