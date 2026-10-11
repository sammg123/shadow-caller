// The drive chart on the Model Report (pure): the app's own (model/vm-drives.js, ui/drive-chart.js), where there is no
// field to show a play on. A drive of his points at its first call in the table below (the chart's button jumps there,
// report/main.js); an opponent's drive points nowhere, so its button rests disabled.
import * as AppCopy from "../../model/copy.js";
import { freezeDeep } from "../../model/format.js";
import { drivesVm } from "../../model/vm-drives.js";
import { callerCalls } from "./calls.js";
import { DRIVE_LINKS } from "./copy.js";

/** The app's copy with the drive chart's button words for this page (ui/drive-chart.js reads ctx.copy.DRIVES). */
export const REPORT_DRIVES_COPY = Object.freeze({
  ...AppCopy,
  DRIVES: Object.freeze({ ...AppCopy.DRIVES, review: DRIVE_LINKS.review }),
});

/** drive idx -> the seq of his first call in it (built from the last call back, so the first one stays). */
function firstCalls(tl) {
  return new Map([...callerCalls(tl)].reverse().map((row) => [row.drive, row.seq]));
}

/**
 * @param {object} pv  presented view
 * @returns {object} frozen drivesVm(pv) with firstSeq = his first call in the drive (else null)
 */
export function reportDrivesVm(pv) {
  const vm = drivesVm(pv);
  const first = firstCalls(pv && pv.tl);
  return freezeDeep({ ...vm, drives: vm.drives.map((d) => ({ ...d, firstSeq: first.get(d.idx) ?? null })) });
}
