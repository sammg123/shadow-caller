// Small DOM pieces the board shares (owner A7; ui-architecture.md 9.6, v1.2): bar geometry as CSS custom properties,
// and running an action from an event handler without ever throwing into the page. DOM side. (The inputs it once
// served, key caps and select-on-focus, are gone: the page takes no user input into the game, restructure-v2.md 1.)

const PCT_MIN = 0;
const PCT_MAX = 100;

/** The browser's error report (a page error, so tests and the console see it), never a silent swallow. */
function report(err) {
  if (typeof globalThis.reportError === "function") globalThis.reportError(err);
  else queueMicrotask(() => { throw err; });
}

/**
 * Run an action from an event handler. Resolves with its result; a throw or a rejection is reported and resolves
 * undefined, so a handler can chain `.then` without a try/catch of its own.
 * @param {() => unknown} fn
 * @returns {Promise<unknown>}
 */
export function act(fn) {
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      return result.then((value) => value, (err) => {
        report(err);
        return undefined;
      });
    }
    return Promise.resolve(result);
  } catch (err) {
    report(err);
    return Promise.resolve(undefined);
  }
}

/**
 * A percentage custom property for bar geometry ("47.5%"), clamped to 0..100; null or a non-number removes it, so
 * the stylesheet's own default applies.
 */
export function setPct(node, name, pct) {
  const style = node.style;
  if (!Number.isFinite(pct)) {
    if (style.getPropertyValue(name) !== "") style.removeProperty(name);
    return;
  }
  const value = `${Math.min(PCT_MAX, Math.max(PCT_MIN, pct))}%`;
  if (style.getPropertyValue(name) !== value) style.setProperty(name, value);
}
