// Football and server-shape facts every core module shares (ui-architecture.md 2.2, owner A1). Pure.

/** Play families in the canonical order the timeline meta sends (DC B2). */
export const FAMILIES = Object.freeze(["run", "dropback", "pa", "screen", "rpo"]);

/** The 14 specific plays in canonical order (DC B2). */
export const LEAVES = Object.freeze([
  "run_inside", "run_ot_left", "run_edge_left", "run_ot_right", "run_edge_right",
  "dropback_short", "dropback_mid", "dropback_deep", "pa_short", "pa_mid", "pa_deep",
  "screen", "rpo_run", "rpo_throw",
]);

/** Row kinds that are a down the offense snapped (DC B3 `offense_is_caller`). */
export const CALLER_SNAP_KINDS = Object.freeze(["play", "penalty", "kneel", "spike", "other", "punt", "fg", "fg_miss"]);

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const LOGO_RE = /^\/api\/logo\/[A-Z]{2,4}(\?v=(default|dark))?$/;

/** The family a leaf belongs to, by prefix ("pa_mid" gives "pa"); anything else gives null. */
export function familyOf(leaf) {
  if (typeof leaf !== "string") return null;
  if (leaf === "screen") return "screen";
  const family = FAMILIES.find((f) => f !== "screen" && leaf.startsWith(`${f}_`));
  return family ?? null;
}

/** A team color from the server, or null when it is not exactly #rrggbb (DC C2). */
export function safeHex(value) {
  return typeof value === "string" && HEX_RE.test(value) ? value : null;
}

/** A logo URL from the server, or null unless it is the app's own logo proxy (DC C2). */
export function safeLogoUrl(value) {
  return typeof value === "string" && LOGO_RE.test(value) ? value : null;
}

/** Freeze a JSON-shaped value and everything under it, in place (bodies the store owns), and return it. */
export function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/** table[key] only when the table itself has it, never an inherited Object property ("toString", "__proto__"). */
export function own(table, key) {
  return table !== null && typeof table === "object" && Object.hasOwn(table, key) ? table[key] : undefined;
}

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** True for a full /api/state body (also what POSTs return); 409 bodies may hold only `error` (DC E1). */
export function isStateBody(body) {
  return isPlainObject(body) && isPlainObject(body.sit) && isPlainObject(body.game);
}

/**
 * Report an error without throwing into the caller: it is rethrown on a microtask, so the browser's own error
 * reporting (window.onerror, the console) and node's still see it. The default `onError` of the store and sync.
 */
export function reportLater(err) {
  queueMicrotask(() => { throw err; });
}

/** Wrap an injected onError so a reporter that throws can never break the code that reports. */
export function reporterOf(onError) {
  if (typeof onError !== "function") throw new TypeError("onError must be a function");
  return (err) => {
    try {
      onError(err);
    } catch (reporterErr) {
      reportLater(reporterErr);
    }
  };
}
