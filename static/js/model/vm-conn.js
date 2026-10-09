// Connection banner and boot screens (G11, #119, #120). The online/retrying/offline rule is core/sync-plan.js's.
import { connState } from "../core/sync-plan.js";
import { BOOT, CONN } from "./copy.js";
import { freezeDeep } from "./format.js";

const MS_PER_S = 1000;

function secondsUntil(at, now) {
  if (!Number.isFinite(at) || !Number.isFinite(now)) return null;
  return Math.max(0, Math.ceil((at - now) / MS_PER_S));
}

function bannerText(state, retryInS) {
  if (state === "online") return "";
  if (state === "retrying") return CONN.retrying;
  return retryInS > 0 ? CONN.offline(retryInS) : CONN.retryingNow;
}

/**
 * @param {object} pv  presented view
 * @returns {object} frozen {state: "online"|"retrying"|"offline", text, retryInS, retryLabel}
 */
export function connVm(pv) {
  const conn = (pv && pv.conn) || {};
  const state = connState({ failures: conn.failures || 0 });
  const retryInS = state === "online" ? null : secondsUntil(conn.retryAt, pv && pv.now);
  return freezeDeep({ state, text: bannerText(state, retryInS), retryInS, retryLabel: CONN.retryNow });
}

const screen = (phase, fields) => freezeDeep({ phase, hidden: false, heading: "", text: "", body: [], retryLabel: "",
  ...fields });

/**
 * @param {object} pv  presented view
 * @returns {object} frozen {phase, hidden, heading, text, body: {text, strong}[], retryLabel}
 */
export function bootVm(pv) {
  const phase = (pv && pv.boot && pv.boot.phase) || "loading";
  if (phase === "ready") return freezeDeep({ phase, hidden: true, heading: "", text: "", body: [], retryLabel: "" });
  if (phase === "restart") {
    const body = BOOT.restartBody.map((s) => ({ text: s.text, strong: Boolean(s.strong) }));
    return screen(phase, { heading: BOOT.restartHeading, text: body.map((s) => s.text).join(""), body });
  }
  if (phase === "failed") {
    const s = secondsUntil(pv.conn && pv.conn.retryAt, pv.now);
    return screen(phase, { heading: BOOT.failedHeading, text: BOOT.failedText(s ?? 0), retryLabel: CONN.retryNow });
  }
  return screen("loading", { heading: BOOT.loading });
}
